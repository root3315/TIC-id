"""Общий код для анализа кривых блеска: глобальный и локальный вид транзита.

Подход как в AstroNet (Shallue & Vanderburg 2018): «глобальный вид» — вся фаза,
по нему ищем вторичное затмение; «локальный вид» — крупный план транзита
(окно ±2.5 длительности), по нему нейросеть судит о форме (U/V/ничего).

Используется и при обучении (train_lc_model.py), и при инференсе (server.py),
чтобы признаки считались строго одинаково.
"""

import numpy as np

N_BINS = 128       # глобальный вид
N_LOCAL = 64       # локальный вид (крупный план транзита): меньше бинов — больше точек в каждом
LOCAL_HALFWIN = 2.5  # полуокно локального вида в длительностях транзита


def bin_series(x: np.ndarray, y: np.ndarray, lo: float, hi: float, n_bins: int):
    """Усредняет y по равным бинам x в [lo, hi); пустые бины интерполируются."""
    edges = np.linspace(lo, hi, n_bins + 1)
    idx = np.clip(np.digitize(x, edges) - 1, 0, n_bins - 1)
    inside = (x >= lo) & (x < hi)
    sums = np.bincount(idx[inside], weights=y[inside], minlength=n_bins)
    counts = np.bincount(idx[inside], minlength=n_bins)
    binned = np.full(n_bins, np.nan)
    mask = counts > 0
    binned[mask] = sums[mask] / counts[mask]
    if np.isnan(binned).any():
        valid = np.where(~np.isnan(binned))[0]
        if len(valid) == 0:
            return np.ones(n_bins)
        binned = np.interp(np.arange(n_bins), valid, binned[valid])
    return binned


def bin_folded(phase: np.ndarray, flux: np.ndarray, n_bins: int = N_BINS):
    return bin_series(phase, flux, -0.5, 0.5, n_bins)


def center_on_minimum(binned: np.ndarray):
    """Циклически сдвигает бины так, чтобы минимум (транзит) оказался в центре."""
    shift = len(binned) // 2 - int(np.argmin(binned))
    return np.roll(binned, shift), shift


def _noise_of(rel: np.ndarray, edge_frac: int = 6):
    n = len(rel)
    edge = np.concatenate([rel[: n // edge_frac], rel[-n // edge_frac:]])
    return float(np.median(np.abs(edge - np.median(edge))) * 1.4826) + 1e-9


def global_metrics(binned: np.ndarray, period_days=None):
    """Метрики по глобальному виду: глубина, шум, длительность, вторичное затмение."""
    n = len(binned)
    rel = binned / np.median(binned) - 1.0
    depth = float(max(-rel.min(), 1e-9))
    noise = _noise_of(rel)
    shape = rel / depth
    w50 = int((shape < -0.5).sum())
    dur_frac = w50 / n
    snr = depth / noise * np.sqrt(max(w50, 1))  # суммарная значимость транзита

    center = int(np.argmin(rel))
    sec_idx = (center + n // 2) % n
    half_win = max(2, n // 24)
    win = [(sec_idx + k) % n for k in range(-half_win, half_win + 1)]
    sec_depth = float(max(-(rel[win]).min(), 0.0))

    out = {
        "depth_ppm": round(depth * 1e6, 1),
        "noise_ppm": round(noise * 1e6, 1),
        "snr": round(float(snr), 1),
        "dur_frac": dur_frac,
        "secondary_depth_ppm": round(sec_depth * 1e6, 1),
        # глубокое вторичное затмение — признак двойной; слабое бывает и у горячих планет
        "secondary_significant": bool(sec_depth > 4 * noise
                                      and (sec_depth > 0.25 * depth or sec_depth > 3e-4)),
    }
    if period_days:
        out["duration_hours"] = round(dur_frac * period_days * 24, 2)
    return out, rel, depth, noise, dur_frac


def local_view(phase: np.ndarray, flux: np.ndarray, dur_frac: float,
               n_local: int = N_LOCAL):
    """Крупный план транзита: окно ±LOCAL_HALFWIN длительностей вокруг фазы 0."""
    win = float(min(max(LOCAL_HALFWIN * dur_frac, 0.02), 0.49))
    binned = bin_series(phase, flux, -win, win, n_local)
    return binned, win


def dual_features(global_binned: np.ndarray, local_binned: np.ndarray):
    """Двухветочное представление для CNN (как в AstroNet):

    глобальный вид (128 бинов, транзит в центре) — видно вторичное затмение на краях;
    локальный вид (64 бина) — видно форму дна; плюс 4 скаляра.
    Возвращает (shape_global, shape_local, scalars) в float32.
    """
    ng = len(global_binned)
    relg = global_binned / np.median(global_binned) - 1.0
    depth = float(max(-relg.min(), 1e-9))
    shape_g = (relg / depth).astype(np.float32)
    # после центрирования транзита вторичное затмение (фаза ±0.5) лежит у краёв
    k_edge = max(2, ng // 24)
    edge_win = np.concatenate([relg[:k_edge + 1], relg[-(k_edge + 1):]])
    sec_depth = float(max(-edge_win.min(), 0.0))

    rell = local_binned / np.median(local_binned) - 1.0
    depth_l = float(max(-rell.min(), 1e-9))
    shape_l = (rell / depth_l).astype(np.float32)
    k = len(rell) // 5
    edge = np.concatenate([rell[:k], rell[-k:]])
    noise = float(np.median(np.abs(edge - np.median(edge))) * 1.4826) + 1e-9
    w50 = int((shape_l < -0.5).sum())
    snr = depth_l / noise * np.sqrt(max(w50, 1))

    scalars = np.array([
        np.log10(depth * 1e6 + 1.0),
        np.log10(snr + 1.0),
        w50 / len(rell) * 10.0,
        min(sec_depth / depth, 2.0),
    ], dtype=np.float32)
    return shape_g, shape_l, scalars


def local_features(local_binned: np.ndarray):
    """Вектор признаков локального вида для нейросети + метрики формы."""
    n = len(local_binned)
    rel = local_binned / np.median(local_binned) - 1.0
    # шум по краям окна (вне транзита: |x| > 0.6 окна)
    k = n // 5
    edge = np.concatenate([rel[:k], rel[-k:]])
    noise = float(np.median(np.abs(edge - np.median(edge))) * 1.4826) + 1e-9
    depth = float(max(-rel.min(), 1e-9))
    shape = rel / depth
    w10 = int((shape < -0.1).sum())
    w50 = int((shape < -0.5).sum())
    w90 = int((shape < -0.9).sum())
    snr = depth / noise * np.sqrt(max(w50, 1))
    flat_ratio = w90 / w10 if w10 > 0 else 0.0
    v_reliable = w10 >= 6 and depth > 4 * noise  # иначе форма не разрешена

    feats = np.concatenate([
        shape.astype(np.float32),
        [np.log10(depth * 1e6 + 1.0), np.log10(snr + 1.0)],
    ]).astype(np.float32)
    info = {
        "depth_ppm": depth * 1e6,
        "noise_ppm": noise * 1e6,
        "snr": float(snr),
        "flat_bottom_ratio": round(flat_ratio, 3),
        "v_shaped": bool(v_reliable and flat_ratio < 0.12),
        "shape_resolved": bool(v_reliable),
        "w10": w10, "w50": w50, "w90": w90,
    }
    return feats, info
