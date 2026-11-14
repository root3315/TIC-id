"""Дообучение нейросети формы транзита на РЕАЛЬНЫХ кривых блеска Kepler.

Классы собираются из размеченных KOI так, чтобы метки были чистыми:
  0 «планета»  — CONFIRMED с высоким SNR (форма транзита достоверно планетная)
  1 «двойная»  — FALSE POSITIVE с флагом koi_fpflag_ss=1 (затмение звездой:
                 именно фотометрическая V-форма/вторичка, а не смещение центроида)
  2 «ничего»   — те же кривые, сложенные на заведомо неверном периоде (×1.377)

Для каждой цели скачивается один сегмент Kepler (long cadence) из MAST,
кривая складывается тем же конвейером, что и на сервере (lc_common).

Итог: models/lc_mlp.joblib переобучается на смеси синтетики (18k) и реальных
кривых, качество отдельно оценивается на отложенных РЕАЛЬНЫХ примерах.
Датасет кэшируется в models/lc_real_dataset.npz — повторный запуск не качает заново.

Запуск:  python train_lc_real.py [N_на_класс=60]
"""

import json
import sys
import time
from pathlib import Path

import httpx
import numpy as np
import joblib
from sklearn.metrics import accuracy_score, confusion_matrix
from sklearn.neural_network import MLPClassifier

from lc_common import bin_folded, center_on_minimum, global_metrics, local_features, local_view
from train_lc_model import build_dataset as build_synthetic

TAP = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"
MODELS_DIR = Path(__file__).parent / "models"
DATASET = MODELS_DIR / "lc_real_dataset.npz"
N_PER_CLASS = int(sys.argv[1]) if len(sys.argv) > 1 else 60


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def fetch_targets():
    common = "kepid,kepoi_name,koi_period,koi_model_snr,koi_depth"
    q_planet = (f"SELECT {common} FROM cumulative WHERE koi_disposition='CONFIRMED' "
                "AND koi_model_snr>25 AND koi_depth>300 AND koi_period<12 "
                "AND koi_period>0.5")
    q_eb = (f"SELECT {common} FROM cumulative WHERE koi_disposition='FALSE POSITIVE' "
            "AND koi_fpflag_ss=1 AND koi_model_snr>25 AND koi_depth>500 "
            "AND koi_period<12 AND koi_period>0.5")
    out = {}
    with httpx.Client(timeout=180.0) as client:
        for label, q in ((0, q_planet), (1, q_eb)):
            rows = client.get(TAP, params={"query": q, "format": "json"}).json()
            rows.sort(key=lambda r: -(r.get("koi_model_snr") or 0))
            # разные звёзды, чтобы не дублировать цели
            seen, picked = set(), []
            for r in rows:
                if r["kepid"] in seen:
                    continue
                seen.add(r["kepid"])
                picked.append(r)
                if len(picked) >= N_PER_CLASS:
                    break
            out[label] = picked
            log(f"класс {label}: отобрано {len(picked)} целей (из {len(rows)})")
    return out


def features_from_curve(time_v, flux_v, period):
    phase = ((time_v - time_v[0]) / period + 0.5) % 1.0 - 0.5
    binned = bin_folded(phase, flux_v)
    binned, shift = center_on_minimum(binned)
    _, _, _, _, dur_frac = global_metrics(binned, period)
    ph_shifted = ((phase + shift / len(binned) + 0.5) % 1.0) - 0.5
    local_binned, _ = local_view(ph_shifted, flux_v, max(dur_frac, 2.0 / len(binned)))
    feats, info = local_features(local_binned)
    return feats, info


def collect_real():
    if DATASET.exists():
        data = np.load(DATASET)
        log(f"датасет уже скачан: {len(data['y'])} примеров — пропускаю загрузку")
        return data["X"], data["y"]

    import lightkurve as lk
    targets = fetch_targets()
    X, y = [], []
    total = sum(len(v) for v in targets.values())
    done = 0
    for label, rows in targets.items():
        for r in rows:
            done += 1
            kic = f"KIC {r['kepid']}"
            try:
                sr = lk.search_lightcurve(kic, author="Kepler", cadence="long")
                if len(sr) == 0:
                    log(f"({done}/{total}) {kic}: нет данных")
                    continue
                lc = sr[len(sr) // 2].download()  # середина миссии
                lc = lc.remove_nans().remove_outliers(sigma=6).normalize()
                t = np.asarray(lc.time.value, float)
                f = np.asarray(lc.flux.value, float)
                ok = np.isfinite(t) & np.isfinite(f)
                t, f = t[ok], f[ok]
                if len(t) < 400:
                    continue
                period = float(r["koi_period"])
                feats, info = features_from_curve(t, f, period)
                X.append(feats)
                y.append(label)
                # «ничего»: та же кривая на неверном периоде
                feats_n, _ = features_from_curve(t, f, period * 1.377)
                X.append(feats_n)
                y.append(2)
                log(f"({done}/{total}) {kic}: ok (snr={info['snr']:.0f})")
            except Exception as e:  # noqa: BLE001
                log(f"({done}/{total}) {kic}: ошибка {type(e).__name__}")
    X = np.array(X, dtype=np.float32)
    y = np.array(y)
    MODELS_DIR.mkdir(exist_ok=True)
    np.savez_compressed(DATASET, X=X, y=y)
    log(f"реальный датасет сохранён: {len(y)} примеров "
        f"(планет {(y == 0).sum()}, двойных {(y == 1).sum()}, пусто {(y == 2).sum()})")
    return X, y


def main():
    t0 = time.time()
    Xr, yr = collect_real()
    if len(yr) < 60:
        log("реальных примеров слишком мало — модель не переобучаю")
        return

    # отложенная РЕАЛЬНАЯ выборка
    rng = np.random.default_rng(42)
    idx = rng.permutation(len(yr))
    n_test = max(20, len(yr) // 4)
    test_i, train_i = idx[:n_test], idx[n_test:]

    log("генерирую синтетику и обучаю на смеси (реальные примеры ×8)...")
    Xs, ys = build_synthetic(6000)
    X_train = np.vstack([Xs] + [Xr[train_i]] * 8)
    y_train = np.concatenate([ys] + [yr[train_i]] * 8)

    clf = MLPClassifier(hidden_layer_sizes=(128, 64), alpha=3e-4, batch_size=256,
                        learning_rate_init=1e-3, max_iter=300,
                        early_stopping=True, random_state=42)
    clf.fit(X_train, y_train)

    pred_r = clf.predict(Xr[test_i])
    acc_r = accuracy_score(yr[test_i], pred_r)
    cm_r = confusion_matrix(yr[test_i], pred_r, labels=[0, 1, 2]).tolist()
    pred_s = clf.predict(Xs[-3000:])
    acc_s = accuracy_score(ys[-3000:], pred_s)
    log(f"точность на ОТЛОЖЕННЫХ РЕАЛЬНЫХ кривых: {acc_r:.4f} (n={n_test})")
    log(f"матрица (планета/двойная/ничего): {cm_r}")

    joblib.dump(clf, MODELS_DIR / "lc_mlp.joblib")
    meta = {
        "trained_at": time.strftime("%Y-%m-%d %H:%M"),
        "classes": ["планетный транзит", "затменная двойная", "нет транзита"],
        "n_train": int(len(y_train)),
        "n_real": int(len(yr)),
        "n_real_test": int(n_test),
        "accuracy": round(float(acc_r), 4),
        "accuracy_synthetic": round(float(acc_s), 4),
        "confusion_matrix": cm_r,
        "real_data": True,
        "notes": "Обучена на смеси: 18 000 синтетических локальных видов + реальные "
                 "кривые Kepler (CONFIRMED vs FP с koi_fpflag_ss=1 vs неверный период). "
                 "Точность указана на отложенных РЕАЛЬНЫХ кривых.",
    }
    (MODELS_DIR / "lc_meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"готово за {(time.time() - t0) / 60:.1f} мин; модель обновлена")


if __name__ == "__main__":
    main()
