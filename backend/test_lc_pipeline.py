"""Тесты лёгкого конвейера кривых блеска (без сети).

Сверки с scipy/astropy запускаются только там, где эти библиотеки стоят (машина
для обучения); на сервере без них они пропускаются, остальные тесты работают везде.
"""

import numpy as np
import pytest

import lc_pipeline as L
import mast_lite as M
from fits_lite import read_fits_table


# ---------- Савицкий — Голей ----------

def test_savgol_keeps_quadratic_exactly():
    x = np.arange(400, dtype=float)
    y = 0.003 * x ** 2 - 2 * x + 7
    assert np.allclose(L.savgol_filter(y, 51, 2), y, atol=1e-8)


def test_savgol_matches_scipy():
    signal = pytest.importorskip("scipy.signal")
    y = np.random.default_rng(1).normal(size=3000).cumsum()
    assert np.allclose(L.savgol_filter(y, 101, 2), signal.savgol_filter(y, 101, 2), atol=1e-9)


# ---------- выбросы и выравнивание ----------

def test_sigma_clip_removes_spike():
    data = np.random.default_rng(2).normal(1.0, 0.001, 2000)
    data[500] = 1.5
    mask = L.sigma_clip_mask(data, sigma=6)
    assert mask[500] and mask.sum() == 1


def test_flatten_removes_trend_and_keeps_transit():
    t = np.arange(0, 30, 0.02)
    trend = 1 + 0.01 * np.sin(2 * np.pi * t / 15)
    transit = np.where(np.abs((t % 3.0) - 1.5) < 0.05, 1 - 0.002, 1.0)
    flat = L.flatten(L.LightCurve(t, trend * transit), window_length=101)
    out_of_transit = flat.flux[transit == 1.0]
    assert abs(np.median(out_of_transit) - 1) < 1e-4
    assert np.median(flat.flux[transit < 1]) == pytest.approx(0.998, abs=3e-4)


def test_prepare_normalizes_and_sorts():
    a = L.LightCurve(np.array([3.0, 1.0, 2.0]), np.array([20.0, 20.0, 20.0]))
    b = L.LightCurve(np.array([5.0, 4.0]), np.array([np.nan, 4.0]))
    lc = L.prepare([a, b])
    assert list(lc.time) == [1.0, 2.0, 3.0, 4.0]
    assert np.allclose(lc.flux, 1.0)


# ---------- BLS ----------

def _transit_series(period=2.5, depth=0.003, seed=3):
    t = np.arange(0, 40, 0.01)
    f = 1 + np.random.default_rng(seed).normal(0, 0.0005, len(t))
    f[np.abs(((t - 0.7) % period) - period / 2) > period / 2 - 0.05] -= depth
    return t, f


def test_bls_finds_injected_period():
    t, f = _transit_series()
    periods = np.geomspace(0.5, 10, 4000)
    res = L.bls_power(t, f, periods, np.array([0.05, 0.1]))
    best = periods[np.argmax(res.power)]
    assert best == pytest.approx(2.5, rel=2e-3)
    assert res.depth[np.argmax(res.power)] == pytest.approx(0.003, rel=0.2)


def test_bls_matches_astropy():
    ts = pytest.importorskip("astropy.timeseries")
    t, f = _transit_series()
    periods = np.geomspace(0.5, 10, 1500)
    durations = np.array([0.02, 0.05, 0.1])
    ref = ts.BoxLeastSquares(t, f).power(periods, durations)
    mine = L.bls_power(t, f, periods, durations)
    assert np.allclose(mine.power, np.asarray(ref.power), rtol=1e-9, atol=1e-15)
    assert np.allclose(mine.transit_time, np.asarray(ref.transit_time))
    assert np.allclose(mine.duration, np.asarray(ref.duration))


# ---------- FITS ----------

def _card(key, value):
    if isinstance(value, str):
        value = f"'{value:<8}'"
    elif isinstance(value, bool):
        value = "T" if value else "F"
    return f"{key:<8}= {value!s:>20}".ljust(80)


def _fits_bytes(time, flux, quality):
    def header(cards):
        text = "".join(cards) + "END".ljust(80)
        return (text + " " * (-len(text) % 2880)).encode("ascii")
    primary = header([_card("SIMPLE", True), _card("BITPIX", 8), _card("NAXIS", 0),
                      _card("TELESCOP", "TESS"), _card("SECTOR", 8)])
    rows = np.zeros(len(time), dtype=[("TIME", ">f8"), ("PDCSAP_FLUX", ">f4"), ("QUALITY", ">i4")])
    rows["TIME"], rows["PDCSAP_FLUX"], rows["QUALITY"] = time, flux, quality
    data = rows.tobytes()
    ext = header([_card("XTENSION", "BINTABLE"), _card("BITPIX", 8), _card("NAXIS", 2),
                  _card("NAXIS1", 16), _card("NAXIS2", len(time)), _card("PCOUNT", 0), _card("GCOUNT", 1),
                  _card("TFIELDS", 3), _card("TTYPE1", "TIME"), _card("TFORM1", "D"),
                  _card("TTYPE2", "PDCSAP_FLUX"), _card("TFORM2", "E"),
                  _card("TTYPE3", "QUALITY"), _card("TFORM3", "J")])
    return primary + ext + data + b"\0" * (-len(data) % 2880)


def test_read_lightcurve_applies_quality_and_nan_time(tmp_path):
    path = tmp_path / "x_lc.fits"
    path.write_bytes(_fits_bytes([1.0, 2.0, np.nan, 4.0], [10, 11, 12, 13], [0, 8, 0, 4096 * 2]))
    primary, _, cols = read_fits_table(path)
    assert primary["SECTOR"] == 8 and cols["PDCSAP_FLUX"].dtype.kind == "f"
    lc = L.read_lightcurve(path, "SPOC")
    # QUALITY=8 (bit 4) входит в маску TESS по умолчанию; 8192 — нет
    assert list(lc.time) == [1.0, 4.0]
    assert list(lc.flux) == [10.0, 13.0]


# ---------- выбор файлов MAST ----------

def _f(name, author, exptime, seq):
    return M.LcFile(name, f"mast:{name}", author, exptime, seq, 0.0)


def test_choose_files_one_per_sector_prefers_standard_cadence():
    files = [_f("s35-a_fast-lc.fits", "SPOC", 20, 35), _f("s35-s_lc.fits", "SPOC", 120, 35),
             _f("s08-s_lc.fits", "SPOC", 120, 8), _f("q_qlp_llc.fits", "QLP", 1800, 8)]
    author, chosen = M.choose_files(files)
    assert author == "SPOC"
    assert [f.filename for f in chosen] == ["s08-s_lc.fits", "s35-s_lc.fits"]


def test_choose_files_kepler_long_cadence_in_order():
    files = [_f("kplr1-2009231120729_slc.fits", "Kepler", 60, -999),
             _f("kplr1-2009166043257_llc.fits", "Kepler", 1800, -999),
             _f("kplr1-2009131105131_llc.fits", "Kepler", 1800, -999)]
    _, chosen = M.choose_files(files)
    assert [f.filename for f in chosen] == ["kplr1-2009131105131_llc.fits", "kplr1-2009166043257_llc.fits"]


@pytest.mark.parametrize("target,expected", [
    ("TIC 408416746", "408416746"), ("tic408416746", "408416746"),
    ("KIC 11904151", "kplr011904151"), ("EPIC 201367065", "ktwo201367065"), ("Kepler-10", None)])
def test_exact_target_name(target, expected):
    assert M._exact_target_name(target) == expected
