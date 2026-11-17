"""Измерение транзита на полной каденции: период, эпоха, глубина, длительность, форма.

BLS ищет период по биннингованной кривой, а свёртка на 128 фазовых бинов размазывает
короткий транзит (у HD 189733 b бин — 25 минут при транзите 1,8 ч): дно мельчает,
края расплываются, и плоское дно выглядит V-образным. Поэтому глубину, длительность и
форму меряем здесь — по точкам исходной каденции в окне вокруг транзита:

1. уточняем период и эпоху перебором (ящик по точкам полной каденции);
2. складываем окно ±3 длительности в мелкие бины (не крупнее каденции);
3. подгоняем трапецию: полная длительность T14, вход/выход tau, глубина.

Всё на numpy, без scipy: перебор сетки, глубина при каждой форме — линейным МНК.
"""

from typing import Any, Dict, Optional

import numpy as np

WINDOW_DURATIONS = 3.0     # полуокно вокруг транзита, в длительностях
V_SHAPE_MAX = 0.10         # T23/T14 ниже — дна нет совсем (V-форма)
V_SHAPE_MARGINAL = 0.25    # ниже — дно узкое: бывает у скользящих планет, только подсказка


def _phase_dt(time_v: np.ndarray, period: float, t0: float) -> np.ndarray:
    """Время от ближайшей середины транзита, сутки."""
    return (time_v - t0 + 0.5 * period) % period - 0.5 * period


def _box_depth(dt: np.ndarray, flux: np.ndarray, half: float) -> float:
    inside = np.abs(dt) < half
    outside = ~inside
    if inside.sum() < 3 or outside.sum() < 3:
        return 0.0
    return float(np.median(flux[outside]) - np.mean(flux[inside]))


def refine_ephemeris(time_v: np.ndarray, flux_v: np.ndarray, period: float, t0: float,
                     duration: float, steps: int = 31):
    """Уточняет период и эпоху по полной каденции: максимум глубины ящика.

    Сетка по периоду — такая, чтобы за всю длину ряда транзит сдвинулся не больше
    чем на ±длительность; по эпохе — ±половина длительности.
    """
    span = float(time_v[-1] - time_v[0])
    near = np.abs(_phase_dt(time_v, period, t0)) < WINDOW_DURATIONS * duration
    t, f = time_v[near], flux_v[near]
    if len(t) < 20:
        return period, t0
    n_cycles = max(span / period, 1.0)
    p_grid = period + np.linspace(-1, 1, steps) * duration / n_cycles
    t_grid = t0 + np.linspace(-0.5, 0.5, steps) * duration
    best = (-np.inf, period, t0)
    half = 0.4 * duration      # чуть уже транзита: в ящик не попадают вход и выход
    for p in p_grid:
        for tc in t_grid:
            d = _box_depth(_phase_dt(t, p, tc), f, half)
            if d > best[0]:
                best = (d, p, tc)
    return float(best[1]), float(best[2])


def _trapezoid(dt: np.ndarray, t14: float, tau: float, exposure: float = 0.0) -> np.ndarray:
    """Форма транзита от 0 до 1: плоское дно T14 − 2·tau, линейные вход и выход.
    exposure — длина экспозиции: модель усредняется по ней (длинная каденция Kepler
    сама скругляет края, и без этого настоящая трапеция выглядела бы V-образной)."""
    edge = 0.5 * t14
    if exposure <= 0:
        return np.clip((edge - np.abs(dt)) / max(tau, 1e-9), 0.0, 1.0)
    offsets = (np.arange(7) - 3) / 7 * exposure
    return np.mean([np.clip((edge - np.abs(dt + o)) / max(tau, 1e-9), 0.0, 1.0)
                    for o in offsets], axis=0)


def fit_trapezoid(dt: np.ndarray, flux: np.ndarray, weight: np.ndarray, dur_guess: float,
                  exposure: float = 0.0):
    """Перебор (T14, tau/T14, сдвиг центра); глубина — МНК при каждой форме."""
    t14_grid = dur_guess * np.geomspace(0.4, 2.0, 36)
    frac_grid = np.linspace(0.03, 0.5, 24)           # tau/T14: 0.5 — чистая V
    shift_grid = np.linspace(-0.15, 0.15, 13) * dur_guess
    y = 1.0 - flux
    best = None
    for shift in shift_grid:
        x = dt - shift
        for t14 in t14_grid:
            # все формы для этого T14 сразу: (frac, точки)
            s = np.stack([_trapezoid(x, t14, fr * t14, exposure) for fr in frac_grid])
            ss = (weight * s * s).sum(axis=1)
            sy = (weight * s * y).sum(axis=1)
            ok = ss > 0
            depth = np.where(ok, sy / np.where(ok, ss, 1.0), 0.0)
            chi2 = (weight * (y[None, :] - depth[:, None] * s) ** 2).sum(axis=1)
            chi2 = np.where(ok & (depth > 0), chi2, np.inf)
            k = int(np.argmin(chi2))
            if best is None or chi2[k] < best[0]:
                best = (float(chi2[k]), float(depth[k]), float(t14), float(frac_grid[k] * t14),
                        float(shift))
    return best


def measure_transit(time_v: np.ndarray, flux_v: np.ndarray, period: float, t0: float,
                    duration: float) -> Optional[Dict[str, Any]]:
    """Глубина, длительность и форма транзита по точкам полной каденции.

    duration — первая оценка длительности (сутки), например из BLS.
    Возвращает уточнённые период и эпоху и параметры трапеции.
    """
    if not (period > 0 and duration > 0) or len(time_v) < 50:
        return None
    duration = min(duration, 0.25 * period)
    period, t0 = refine_ephemeris(time_v, flux_v, period, t0, duration)

    dt = _phase_dt(time_v, period, t0)
    win = WINDOW_DURATIONS * duration
    near = np.abs(dt) < win
    if near.sum() < 30:
        return None
    dt, f = dt[near], flux_v[near]
    # окно вне транзита задаёт уровень: нормируем на его медиану
    out_level = np.median(f[np.abs(dt) > 1.5 * duration]) if (np.abs(dt) > 1.5 * duration).sum() > 10 \
        else np.median(f)
    f = f / out_level

    cadence = float(np.median(np.diff(np.sort(time_v)))) if len(time_v) > 1 else duration / 30
    # мелкие бины: точки разных транзитов ложатся в разные места фазы, и бины
    # мельче каденции заполняются; размазывание остаётся только от самой экспозиции
    bin_w = min(cadence, duration / 40)
    edges = np.arange(-win, win + bin_w, bin_w)
    idx = np.clip(np.digitize(dt, edges) - 1, 0, len(edges) - 2)
    counts = np.bincount(idx, minlength=len(edges) - 1)
    sums = np.bincount(idx, weights=f, minlength=len(edges) - 1)
    has = counts > 0
    centers = 0.5 * (edges[:-1] + edges[1:])[has]
    binned = sums[has] / counts[has]
    weight = counts[has].astype(float)

    exposure = cadence if cadence > duration / 30 else 0.0
    fit = fit_trapezoid(centers, binned, weight, duration, exposure)
    if fit is None:
        return None
    _, depth, t14, tau, shift = fit
    t0 += shift

    out_pts = f[np.abs(dt - shift) > 0.5 * t14 + 0.25 * duration]
    noise = float(np.median(np.abs(out_pts - np.median(out_pts))) * 1.4826) if len(out_pts) > 10 \
        else float(np.std(f))
    n_in = int((np.abs(dt - shift) < 0.5 * t14 - tau).sum()) or int((np.abs(dt - shift) < 0.5 * t14).sum())
    snr = depth / (noise / np.sqrt(max(n_in, 1))) if noise > 0 else 0.0
    flat = max(t14 - 2 * tau, 0.0) / t14
    # форму можно судить, только если вход/выход разрешены каденцией и сигнал уверенный
    resolved = bool(cadence <= t14 / 6 and snr > 15)
    return {
        "period": period,
        "t0": t0,
        "depth_ppm": round(depth * 1e6, 1),
        "duration_hours": round(t14 * 24, 2),
        "ingress_hours": round(tau * 24, 2),
        "flat_bottom_ratio": round(flat, 3),
        "snr": round(float(snr), 1),
        "noise_ppm": round(noise * 1e6, 1),
        "cadence_min": round(cadence * 1440, 1),
        "shape_resolved": resolved,
        "v_shaped": bool(resolved and flat < V_SHAPE_MAX),
        "v_shape_marginal": bool(resolved and V_SHAPE_MAX <= flat < V_SHAPE_MARGINAL),
    }
