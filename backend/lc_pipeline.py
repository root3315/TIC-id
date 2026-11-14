"""Обработка кривых блеска на чистом numpy — замена lightkurve, scipy и astropy.

Алгоритмы перенесены по исходникам этих библиотек, чтобы результат совпадал:
- чтение и флаги качества — lightkurve.io (read_tess/kepler/qlp_lightcurve);
- склейка, remove_outliers, normalize, flatten — lightkurve.LightCurve;
- сглаживание — scipy.signal.savgol_filter (mode="interp");
- поиск периода — astropy BoxLeastSquares, method="fast", objective="likelihood".
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

from fits_lite import read_fits_table

KEPLER_DEFAULT_BITMASK = 1130799   # lightkurve KeplerQualityFlags.DEFAULT_BITMASK
TESS_DEFAULT_BITMASK = 17087       # lightkurve TessQualityFlags.DEFAULT_BITMASK

# Какую колонку потока берёт lightkurve для каждого автора
FLUX_COLUMN = {"QLP": "SAP_FLUX", "EVEREST": "FLUX"}
DEFAULT_FLUX_COLUMN = "PDCSAP_FLUX"


@dataclass
class LightCurve:
    time: np.ndarray
    flux: np.ndarray
    meta: Dict[str, object] = field(default_factory=dict)

    def __len__(self) -> int:
        return len(self.time)

    def take(self, idx) -> "LightCurve":
        return LightCurve(self.time[idx], self.flux[idx], self.meta)


# ---------- чтение ----------

def read_lightcurve(path: Path, author: str) -> LightCurve:
    primary, _, cols = read_fits_table(path)
    telescope = str(primary.get("TELESCOP") or primary.get("MISSION") or "").strip()
    flux_col = FLUX_COLUMN.get(author, DEFAULT_FLUX_COLUMN)
    if flux_col not in cols:
        flux_col = next(c for c in ("PDCSAP_FLUX", "SAP_FLUX", "FLUX") if c in cols)
    time = cols["TIME"].astype(float)
    flux = cols[flux_col].astype(float)
    keep = ~np.isnan(time)                       # lightkurve выкидывает строки с TIME=NaN
    if "QUALITY" in cols:
        bitmask = KEPLER_DEFAULT_BITMASK if telescope.lower() == "kepler" else TESS_DEFAULT_BITMASK
        keep &= (cols["QUALITY"].astype(np.int64) & bitmask) == 0
    meta = {k: primary.get(k) for k in ("MISSION", "TELESCOP", "SECTOR", "QUARTER", "CAMPAIGN")}
    return LightCurve(time[keep], flux[keep], meta)


# ---------- простые операции LightCurve ----------

def normalize(lc: LightCurve) -> LightCurve:
    return LightCurve(lc.time, lc.flux / np.nanmedian(lc.flux), lc.meta)


def stitch(lcs: List[LightCurve]) -> LightCurve:
    """Как LightCurveCollection.stitch(): каждую нормируем, затем склеиваем подряд."""
    parts = [normalize(lc) for lc in lcs]
    return LightCurve(np.concatenate([p.time for p in parts]),
                      np.concatenate([p.flux for p in parts]), parts[0].meta)


def remove_nans(lc: LightCurve) -> LightCurve:
    return lc.take(~np.isnan(lc.flux))


def sigma_clip_mask(data: np.ndarray, sigma: float, maxiters: int = 5) -> np.ndarray:
    """astropy.stats.sigma_clip (центр — медиана, разброс — std): True = выброс."""
    clipped = ~np.isfinite(data)
    for _ in range(maxiters):
        good = data[~clipped]
        if good.size == 0:
            break
        center, std = np.median(good), np.std(good)
        with np.errstate(invalid="ignore"):
            new = clipped | (data < center - sigma * std) | (data > center + sigma * std)
        if new.sum() == clipped.sum():
            break
        clipped = new
    return clipped


def remove_outliers(lc: LightCurve, sigma: float) -> LightCurve:
    return lc.take(~sigma_clip_mask(lc.flux, sigma))


# ---------- Савицкий — Голей (scipy.signal.savgol_filter, mode="interp") ----------

def savgol_coeffs(window_length: int, polyorder: int) -> np.ndarray:
    half = window_length // 2
    pos = np.arange(-half, half + 1, dtype=float)
    vander = np.vander(pos, polyorder + 1, increasing=True)
    return np.linalg.pinv(vander)[0]


def savgol_filter(x: np.ndarray, window_length: int, polyorder: int) -> np.ndarray:
    x = np.asarray(x, dtype=float)
    half = window_length // 2
    out = np.empty_like(x)
    out[half:len(x) - half] = np.convolve(x, savgol_coeffs(window_length, polyorder)[::-1], mode="valid")
    # края: полином по первому/последнему окну, как _fit_edges_polyfit в scipy
    pos = np.arange(window_length, dtype=float)
    head = np.polyfit(pos, x[:window_length], polyorder)
    tail = np.polyfit(pos, x[-window_length:], polyorder)
    out[:half] = np.polyval(head, pos[:half])
    out[len(x) - half:] = np.polyval(tail, pos[window_length - half:])
    return out


def _interp_extrapolate(x_new: np.ndarray, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """scipy interp1d(kind="linear", fill_value="extrapolate")."""
    order = np.argsort(x, kind="mergesort")
    x, y = x[order], y[order]
    out = np.interp(x_new, x, y)
    if len(x) >= 2:
        lo, hi = x_new < x[0], x_new > x[-1]
        out[lo] = y[0] + (x_new[lo] - x[0]) * (y[1] - y[0]) / (x[1] - x[0])
        out[hi] = y[-1] + (x_new[hi] - x[-1]) * (y[-1] - y[-2]) / (x[-1] - x[-2])
    return out


def flatten(lc: LightCurve, window_length: int, polyorder: int = 2, sigma: float = 3,
            niters: int = 3, break_tolerance: int = 5) -> LightCurve:
    """lightkurve.LightCurve.flatten: тренд по кускам между разрывами, итеративно без выбросов."""
    time, flux = lc.time, lc.flux
    mask = np.isfinite(flux)
    with np.errstate(invalid="ignore"):
        mask &= np.nan_to_num(np.abs(flux - np.nanmedian(flux))) <= np.nanstd(flux) * sigma
    if polyorder >= window_length:
        polyorder = window_length - 1
    trend = np.zeros(len(time))
    for _ in range(niters):
        t_m, f_m = time[mask], flux[mask]
        dt = t_m[1:] - t_m[:-1]
        with np.errstate(invalid="ignore"):
            cut = np.where(dt > break_tolerance * np.nanmedian(dt))[0] + 1
        low = np.append([0], cut)
        high = np.append(cut, len(t_m))
        part = np.zeros(len(t_m))
        for lo_i, hi_i in zip(low, high):
            if window_length > hi_i - lo_i or hi_i - lo_i < break_tolerance:
                part[lo_i:hi_i] = np.nanmedian(f_m[lo_i:hi_i])
            else:
                part[lo_i:hi_i] = savgol_filter(f_m[lo_i:hi_i], window_length, polyorder)
        resid = f_m - part
        keep = np.nan_to_num(np.abs(resid)) < np.nanstd(resid) * sigma + 1e-14
        trend = _interp_extrapolate(time, t_m[keep], part[keep])
        mask[mask] &= keep
    with np.errstate(invalid="ignore", divide="ignore"):
        return LightCurve(time, flux / trend, lc.meta)


# ---------- Box Least Squares (astropy, method="fast", objective="likelihood") ----------

@dataclass
class BlsResult:
    power: np.ndarray
    depth: np.ndarray
    duration: np.ndarray
    transit_time: np.ndarray


def bls_power(t: np.ndarray, y: np.ndarray, periods: np.ndarray, durations: np.ndarray,
              oversample: int = 10) -> BlsResult:
    t = np.asarray(t, dtype=float)
    t_ref = float(np.min(t))
    t = t - t_ref
    y = np.asarray(y, dtype=float) - np.median(y)
    ivar = np.ones_like(y)
    durations = np.asarray(durations, dtype=float)
    min_t = float(np.min(t))
    sum_y, sum_ivar = float(np.sum(y * ivar)), float(np.sum(ivar))
    bin_duration = float(np.min(durations)) / oversample
    dur_bins = np.round(durations / bin_duration).astype(int)

    n_p = len(periods)
    power = np.full(n_p, -np.inf)
    depth = np.zeros(n_p)
    best_dur = np.zeros(n_p)
    phase = np.zeros(n_p)
    yw = y * ivar
    for p, period in enumerate(periods):
        n_bins = int(np.ceil(period / bin_duration)) + oversample
        ind = ((t - min_t) - period * np.floor((t - min_t) / period)) / bin_duration
        ind = ind.astype(int) + 1
        mean_y = np.bincount(ind, weights=yw, minlength=n_bins + 1)[:n_bins + 1]
        mean_ivar = np.bincount(ind, weights=ivar, minlength=n_bins + 1)[:n_bins + 1]
        # «заворачиваем» начало фазы в конец массива (затирая, как в bls.c)
        mean_y[n_bins - oversample:n_bins] = mean_y[1:oversample + 1]
        mean_ivar[n_bins - oversample:n_bins] = mean_ivar[1:oversample + 1]
        cy = np.cumsum(mean_y)
        civar = np.cumsum(mean_ivar)
        for dur in dur_bins:
            y_in = cy[dur:n_bins + 1] - cy[:n_bins - dur + 1]
            ivar_in = civar[dur:n_bins + 1] - civar[:n_bins - dur + 1]
            ivar_out = sum_ivar - ivar_in
            ok = (ivar_in >= np.finfo(float).eps) & (ivar_out >= np.finfo(float).eps)
            with np.errstate(invalid="ignore", divide="ignore"):
                m_in = y_in / ivar_in
                m_out = (sum_y - y_in) / ivar_out
                obj = 0.5 * ivar_in * (m_out - m_in) ** 2
            obj = np.where(ok & (m_out >= m_in), obj, -np.inf)
            n = int(np.argmax(obj))
            if obj[n] > power[p]:
                power[p] = obj[n]
                depth[p] = m_out[n] - m_in[n]
                best_dur[p] = dur * bin_duration
                phase[p] = np.fmod(n * bin_duration + 0.5 * best_dur[p] + min_t, period)
    return BlsResult(power, depth, best_dur, phase + t_ref)


def bin_time_series(time_v: np.ndarray, flux_v: np.ndarray, bin_days: float) -> Tuple[np.ndarray, np.ndarray]:
    """Биннинг перед BLS (как в server.run_bls): ~10 тыс. точек считаются за секунды."""
    span = float(time_v[-1] - time_v[0])
    nb = max(200, int(span / bin_days))
    edges = np.linspace(time_v[0], time_v[-1], nb + 1)
    idx = np.clip(np.digitize(time_v, edges) - 1, 0, nb - 1)
    sums = np.bincount(idx, weights=flux_v, minlength=nb)
    counts = np.bincount(idx, minlength=nb)
    mask = counts > 0
    return ((edges[:-1] + edges[1:]) / 2)[mask], sums[mask] / counts[mask]


def prepare(lcs: List[LightCurve]) -> Optional[LightCurve]:
    """Склейка → без NaN → без выбросов 6σ → нормировка → по времени (как раньше в server)."""
    lc = stitch(lcs) if len(lcs) > 1 else lcs[0]
    lc = normalize(remove_outliers(remove_nans(lc), sigma=6))
    return lc.take(np.argsort(lc.time, kind="mergesort"))
