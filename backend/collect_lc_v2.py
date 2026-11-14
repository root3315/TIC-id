"""Сбор БОЛЬШОГО реального датасета кривых Kepler в двухветочном формате (v2).

Для каждой цели: глобальный вид (128 бинов) + локальный (64) + 4 скаляра.
Классы: 0 планета (CONFIRMED), 1 двойная (FP с koi_fpflag_ss=1),
2 «ничего» (та же кривая на неверном периоде ×1.377).

Запуск:  python collect_lc_v2.py [N_на_класс=250]
Результат: models/lc_real_dataset_v2.npz (докачивается инкрементально не умеет —
качает всё за один прогон; повторный запуск при существующем файле — пропуск).
"""

import sys
import time
from pathlib import Path

import httpx
import numpy as np

from lc_common import bin_folded, center_on_minimum, dual_features, global_metrics, local_view

TAP = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"
MODELS = Path(__file__).parent / "models"
OUT = MODELS / "lc_real_dataset_v2.npz"
N = int(sys.argv[1]) if len(sys.argv) > 1 else 250


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def fetch_targets():
    common = "kepid,kepoi_name,koi_period,koi_model_snr,koi_depth"
    qs = {
        0: (f"SELECT {common} FROM cumulative WHERE koi_disposition='CONFIRMED' "
            "AND koi_model_snr>15 AND koi_depth>150 AND koi_period<15 AND koi_period>0.5"),
        1: (f"SELECT {common} FROM cumulative WHERE koi_disposition='FALSE POSITIVE' "
            "AND koi_fpflag_ss=1 AND koi_model_snr>15 AND koi_depth>300 "
            "AND koi_period<15 AND koi_period>0.5"),
    }
    out = {}
    with httpx.Client(timeout=180.0) as client:
        for label, q in qs.items():
            rows = client.get(TAP, params={"query": q, "format": "json"}).json()
            rows.sort(key=lambda r: -(r.get("koi_model_snr") or 0))
            seen, picked = set(), []
            for r in rows:
                if r["kepid"] in seen:
                    continue
                seen.add(r["kepid"])
                picked.append(r)
                if len(picked) >= N:
                    break
            out[label] = picked
            log(f"класс {label}: {len(picked)} целей (из {len(rows)})")
    return out


def views_from_curve(t, f, period):
    phase = ((t - t[0]) / period + 0.5) % 1.0 - 0.5
    binned = bin_folded(phase, f)
    binned, shift = center_on_minimum(binned)
    _, _, _, _, dur_frac = global_metrics(binned, period)
    ph = ((phase + shift / len(binned) + 0.5) % 1.0) - 0.5
    local_binned, _ = local_view(ph, f, max(dur_frac, 2.0 / len(binned)))
    return dual_features(binned, local_binned)


def main():
    if OUT.exists():
        d = np.load(OUT)
        log(f"датасет уже есть: {len(d['y'])} примеров — выходим")
        return
    import lightkurve as lk
    targets = fetch_targets()
    Xg, Xl, Xs, y = [], [], [], []
    total = sum(len(v) for v in targets.values())
    done = 0
    t_start = time.time()
    for label, rows in targets.items():
        for r in rows:
            done += 1
            kic = f"KIC {r['kepid']}"
            try:
                sr = lk.search_lightcurve(kic, author="Kepler", cadence="long")
                if len(sr) == 0:
                    continue
                lc = sr[len(sr) // 2].download()
                lc = lc.remove_nans().remove_outliers(sigma=6).normalize()
                t = np.asarray(lc.time.value, float)
                f = np.asarray(lc.flux.value, float)
                ok = np.isfinite(t) & np.isfinite(f)
                t, f = t[ok], f[ok]
                if len(t) < 400:
                    continue
                period = float(r["koi_period"])
                g, l, s = views_from_curve(t, f, period)
                Xg.append(g); Xl.append(l); Xs.append(s); y.append(label)
                g2, l2, s2 = views_from_curve(t, f, period * 1.377)
                Xg.append(g2); Xl.append(l2); Xs.append(s2); y.append(2)
                if done % 20 == 0:
                    speed = done / max(time.time() - t_start, 1)
                    log(f"{done}/{total} целей, примеров {len(y)}, "
                        f"осталось ~{(total - done) / max(speed, 0.01) / 60:.0f} мин")
            except Exception as e:  # noqa: BLE001
                log(f"{done}/{total} {kic}: {type(e).__name__}")
    Xg = np.array(Xg, np.float32); Xl = np.array(Xl, np.float32)
    Xs = np.array(Xs, np.float32); y = np.array(y)
    MODELS.mkdir(exist_ok=True)
    np.savez_compressed(OUT, Xg=Xg, Xl=Xl, Xs=Xs, y=y)
    log(f"ГОТОВО: {len(y)} примеров (планет {(y==0).sum()}, двойных {(y==1).sum()}, "
        f"пусто {(y==2).sum()}) за {(time.time()-t_start)/60:.0f} мин → {OUT.name}")


if __name__ == "__main__":
    main()
