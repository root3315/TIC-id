"""МАКСИМАЛЬНЫЙ сбор реальных кривых Kepler (v3): всё, что есть в размеченном каталоге.

Отличия от v2:
  • ослабленные фильтры: SNR > 10, период 0.4–35 сут → ~2000 планет и ~1200 двойных;
  • до 2 сегментов (кварталов) на цель — больше шумовых реализаций;
  • чекпойнты каждые 200 примеров + резюм по списку сделанных целей:
    прогон можно прерывать и продолжать (`python collect_lc_v3.py`);
  • итог склеивается в models/lc_real_dataset_v3.npz.

Ожидаемый объём: ~10 000–12 000 реальных примеров. Время: часы (зависит от MAST).
"""

import time
from pathlib import Path

import httpx
import numpy as np

from collect_lc_v2 import views_from_curve  # тот же конвейер представлений

TAP = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"
MODELS = Path(__file__).parent / "models"
CHUNK_DIR = MODELS / "lc_v3_chunks"
DONE_FILE = CHUNK_DIR / "done_targets.txt"
OUT = MODELS / "lc_real_dataset_v3.npz"


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def fetch_targets():
    common = "kepid,kepoi_name,koi_period,koi_model_snr,koi_depth"
    qs = {
        0: (f"SELECT {common} FROM cumulative WHERE koi_disposition='CONFIRMED' "
            "AND koi_model_snr>10 AND koi_depth>100 AND koi_period<35 AND koi_period>0.4"),
        1: (f"SELECT {common} FROM cumulative WHERE koi_disposition='FALSE POSITIVE' "
            "AND koi_fpflag_ss=1 AND koi_model_snr>10 AND koi_depth>200 "
            "AND koi_period<35 AND koi_period>0.4"),
    }
    out = {}
    with httpx.Client(timeout=240.0) as client:
        for label, q in qs.items():
            rows = client.get(TAP, params={"query": q, "format": "json"}).json()
            rows.sort(key=lambda r: -(r.get("koi_model_snr") or 0))
            seen, picked = set(), []
            for r in rows:
                if r["kepid"] in seen:
                    continue
                seen.add(r["kepid"])
                picked.append(r)
            out[label] = picked
            log(f"класс {label}: {len(picked)} уникальных целей")
    return out


def load_done():
    if DONE_FILE.exists():
        return set(DONE_FILE.read_text().split())
    return set()


def main():
    import lightkurve as lk

    CHUNK_DIR.mkdir(parents=True, exist_ok=True)
    done = load_done()
    targets = fetch_targets()
    plan = [(label, r) for label, rows in targets.items() for r in rows]
    log(f"целей всего: {len(plan)}, уже сделано: {len(done)}")

    Xg, Xl, Xs, y, grp = [], [], [], [], []   # grp = kepid звезды каждого примера (для split по звёздам)
    chunk_id = len(list(CHUNK_DIR.glob("chunk_*.npz")))
    n_done_now = 0
    t0 = time.time()

    def flush_chunk():
        nonlocal Xg, Xl, Xs, y, grp, chunk_id
        if not y:
            return
        np.savez_compressed(CHUNK_DIR / f"chunk_{chunk_id:04d}.npz",
                            Xg=np.array(Xg, np.float32), Xl=np.array(Xl, np.float32),
                            Xs=np.array(Xs, np.float32), y=np.array(y),
                            grp=np.array(grp, dtype=np.int64))
        log(f"чекпойнт chunk_{chunk_id:04d}: +{len(y)} примеров")
        chunk_id += 1
        Xg, Xl, Xs, y, grp = [], [], [], [], []

    for i, (label, r) in enumerate(plan):
        key = str(r["kepid"])
        if key in done:
            continue
        try:
            sr = lk.search_lightcurve(f"KIC {key}", author="Kepler", cadence="long")
            if len(sr) == 0:
                done.add(key)
                continue
            picks = sorted({0, len(sr) // 2})          # до 2 сегментов на цель
            period = float(r["koi_period"])
            for j, si in enumerate(picks):
                lc = sr[si].download()
                lc = lc.remove_nans().remove_outliers(sigma=6).normalize()
                t = np.asarray(lc.time.value, float)
                f = np.asarray(lc.flux.value, float)
                ok = np.isfinite(t) & np.isfinite(f)
                t, f = t[ok], f[ok]
                if len(t) < 400 or (t[-1] - t[0]) < 2.5 * period:
                    continue
                kid = int(r["kepid"])
                g, l, s = views_from_curve(t, f, period)
                Xg.append(g); Xl.append(l); Xs.append(s); y.append(label); grp.append(kid)
                mult = 1.377 if j == 0 else 0.7117      # два разных «неверных» периода
                g2, l2, s2 = views_from_curve(t, f, period * mult)
                Xg.append(g2); Xl.append(l2); Xs.append(s2); y.append(2); grp.append(kid)
            done.add(key)
            n_done_now += 1
            if len(y) >= 200:
                flush_chunk()
                DONE_FILE.write_text("\n".join(sorted(done)))
            if n_done_now % 50 == 0:
                speed = n_done_now / max(time.time() - t0, 1)
                left = (len(plan) - i - 1) / max(speed, 0.01) / 3600
                log(f"{i+1}/{len(plan)} целей, скорость {speed*60:.0f}/мин, осталось ~{left:.1f} ч")
        except Exception as e:  # noqa: BLE001
            log(f"{i+1}/{len(plan)} KIC {key}: {type(e).__name__}")
            done.add(key)

    flush_chunk()
    DONE_FILE.write_text("\n".join(sorted(done)))

    # склейка всех чанков
    chunks = sorted(CHUNK_DIR.glob("chunk_*.npz"))
    Gs, Ls, Ss, Ys, Grs = [], [], [], [], []
    for c in chunks:
        d = np.load(c)
        Gs.append(d["Xg"]); Ls.append(d["Xl"]); Ss.append(d["Xs"]); Ys.append(d["y"])
        Grs.append(d["grp"] if "grp" in d.files else np.full(len(d["y"]), -1, np.int64))
    Xg_all = np.vstack(Gs); Xl_all = np.vstack(Ls)
    Xs_all = np.vstack(Ss); y_all = np.concatenate(Ys); grp_all = np.concatenate(Grs)
    np.savez_compressed(OUT, Xg=Xg_all, Xl=Xl_all, Xs=Xs_all, y=y_all, grp=grp_all)
    log(f"ГОТОВО v3: {len(y_all)} примеров (планет {(y_all==0).sum()}, "
        f"двойных {(y_all==1).sum()}, пусто {(y_all==2).sum()}), "
        f"звёзд {len(np.unique(grp_all[grp_all>=0]))} → {OUT.name}")


if __name__ == "__main__":
    main()
