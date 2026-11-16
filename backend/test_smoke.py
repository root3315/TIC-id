"""Смоук-тесты ExoVision: быстрые, без сети. Запуск: pytest test_smoke.py -q"""

import numpy as np
import pytest

import server
from lc_common import N_BINS, N_LOCAL, dual_features, local_features


# ---------- классификация планет ----------

def test_classify_rocky_earth():
    kind, label = server.classify_composition(1.0, 1.0, 5.5)
    assert kind == "rocky"


def test_classify_mini_neptune_by_density():
    # Kepler-1052 c: 2.3 R⊕ при ρ=2.66 — газовая оболочка
    kind, _ = server.classify_composition(2.3, 5.9, 2.66)
    assert kind == "mini_neptune"


def test_classify_dense_super_earth():
    kind, _ = server.classify_composition(2.0, 12.0, 8.0)
    assert kind == "super_earth"


def test_classify_giant():
    kind, _ = server.classify_composition(11.0, 300.0, 1.3)
    assert kind == "giant"


# ---------- производные величины ----------

def test_mass_upper_limit_rejected():
    # Kepler-62 f: 35 M⊕ при 1.41 R⊕ → ρ≈68 г/см³ — физически невозможно
    d = server.compute_derived({"mass": 35.0, "radius": 1.41}, {}, {})
    assert d.get("mass_unreliable") is True
    assert "surface_gravity_g" not in d


def test_earth_like_derived():
    d = server.compute_derived({"mass": 1.0, "radius": 1.0}, {"semi_major_axis": 1.0},
                               {"temperature": 5772.0, "radius": 1.0})
    assert 0.95 <= d["surface_gravity_g"] <= 1.05
    assert 10.5 <= d["escape_velocity_kms"] <= 11.8
    assert d["hz_position"] in ("conservative", "optimistic")


def test_kopparapu_sun():
    hz = server.kopparapu_hz(5772.0, 1.0)
    assert 0.9 < hz["inner_conservative"] < 1.05
    assert 1.5 < hz["outer_conservative"] < 1.8
    assert hz["teff_clamped"] is False


def test_kopparapu_erratum_coefficients():
    # Kopparapu et al. 2013, исправление (ApJ 770, 82): при Teff = 5780 K Seff = Seff_sun
    hz = server.kopparapu_hz(5780.0, 1.0)
    assert hz["inner_conservative"] == round(1 / 1.0512 ** 0.5, 4)
    assert hz["outer_optimistic"] == round(1 / 0.3179 ** 0.5, 4)


def test_kopparapu_flags_clamped_teff():
    hz = server.kopparapu_hz(2300.0, 0.001)
    assert hz["teff_clamped"] is True and hz["teff_used"] == 2600.0


def test_esi_earth_is_one():
    esi = server.compute_esi(1.0, 5.513, 1.0, 288.0)
    assert esi is not None and esi > 0.99


# ---------- скоринг обитаемости ----------

def _score(phys, orb, star):
    derived = server.compute_derived(phys, orb, star)
    return server.calculate_habitability_score(phys, orb, star, derived)


def test_gas_giant_capped():
    hab = _score({"mass": 5380.0, "radius": 10.7, "equilibrium_temp": 230.0,
                  "insolation": 4.48},
                 {"semi_major_axis": 0.55, "eccentricity": 0.51},
                 {"temperature": 4505.0, "radius": 0.7, "mass": 0.75})
    assert hab.total_score <= 26.0
    assert hab.category in ("Challenging", "Hostile")


def test_neptune_capped():
    hab = _score({"mass": 17.0, "radius": 3.9, "equilibrium_temp": 288.0},
                 {"semi_major_axis": 1.0, "eccentricity": 0.01},
                 {"temperature": 5772.0, "radius": 1.0, "mass": 1.0})
    assert hab.total_score <= 34.0


def test_earth_twin_scores_high():
    hab = _score({"mass": 1.0, "radius": 1.0, "equilibrium_temp": 255.0},
                 {"semi_major_axis": 1.0, "eccentricity": 0.017, "period": 365.25},
                 {"temperature": 5772.0, "radius": 1.0, "mass": 1.0})
    assert hab.total_score >= 80.0
    assert hab.category == "Earth-like"


def test_scores_within_bounds():
    hab = _score({}, {}, {})
    assert 0 <= hab.total_score <= 100
    assert 0 <= hab.survival_chance <= 100


# ---------- поиск по каталогу ----------

@pytest.fixture()
def fake_catalog(monkeypatch):
    rows = [
        {"pl_name": "Kepler-186 f", "hostname": "Kepler-186", "tic_id": "TIC 111",
         "pl_rade": 1.17, "pl_bmasse": 1.7, "pl_eqt": 188.0, "sy_dist": 177.0},
        {"pl_name": "Kepler-186 b", "hostname": "Kepler-186", "tic_id": "TIC 111",
         "pl_rade": 1.07, "pl_bmasse": 1.2, "pl_eqt": 571.0, "sy_dist": 177.0},
        {"pl_name": "WASP-12 b", "hostname": "WASP-12", "tic_id": "TIC 222",
         "pl_rade": 21.0, "pl_bmasse": 465.0, "pl_eqt": 2580.0, "sy_dist": 400.0},
    ]
    for r in rows:
        r["_nplanet"] = server.norm_name(r["pl_name"])
        r["_nhost"] = server.norm_name(r["hostname"])
        r["_tic"] = "".join(c for c in r["tic_id"] if c.isdigit())
    monkeypatch.setattr(server, "CATALOG", rows)
    return rows


def test_search_exact(fake_catalog):
    exact, results = server.search_catalog("kepler-186 f", "name")
    assert exact is not None and exact["pl_name"] == "Kepler-186 f"


def test_search_by_host_prefix(fake_catalog):
    exact, results = server.search_catalog("kepler-186", "name")
    assert len(results) == 2


def test_search_by_tic(fake_catalog):
    exact, results = server.search_catalog("222", "tic")
    assert exact is not None and exact["pl_name"] == "WASP-12 b"


def test_norm_name():
    assert server.norm_name("Kepler-186 f") == server.norm_name("kepler186F")


# ---------- нейросеть формы: признаки ----------

def _local_transit(depth, v_shaped):
    x = np.linspace(-1, 1, N_LOCAL, endpoint=False)
    half, ing = 0.2, (0.2 if v_shaped else 0.05)
    flux = np.ones(N_LOCAL)
    for i, xx in enumerate(np.abs(x)):
        if xx >= half:
            continue
        flux[i] -= depth if xx <= half - ing else depth * (half - xx) / ing
    rng = np.random.default_rng(0)
    return flux + rng.normal(0, depth / 25, N_LOCAL)


def test_flat_bottom_detected():
    _, info = local_features(_local_transit(0.005, v_shaped=False))
    assert info["v_shaped"] is False
    assert info["snr"] > 7


def test_v_shape_detected():
    _, info = local_features(_local_transit(0.02, v_shaped=True))
    assert info["v_shaped"] is True


def test_dual_features_shapes_and_secondary():
    g = np.ones(N_BINS)
    g[N_BINS // 2 - 4: N_BINS // 2 + 4] -= 0.01   # первичный транзит в центре
    g[:3] -= 0.004                                 # вторичное затмение у края
    g[-3:] -= 0.004
    l = np.ones(N_LOCAL)
    l[N_LOCAL // 2 - 6: N_LOCAL // 2 + 6] -= 0.01
    sg, sl, sc = dual_features(g, l)
    assert sg.shape == (N_BINS,) and sl.shape == (N_LOCAL,) and sc.shape == (4,)
    assert sc[3] > 0.25  # вторичное/первичное ≈ 0.4 — должно быть видно


# ---------- разное ----------

def test_fnum():
    assert server.fnum("3.14") == pytest.approx(3.14)
    assert server.fnum(None) is None
    assert server.fnum(float("nan")) is None


# ---------- устаревший каталог ----------

def test_stale_catalog_is_served_when_nasa_fails(monkeypatch, tmp_path):
    import asyncio
    import json
    import time

    old_ts = time.time() - 3 * 24 * 3600
    cache = tmp_path / "catalog.json"
    cache.write_text(json.dumps({"ts": old_ts, "rows": [
        {"pl_name": "Kepler-186 f", "hostname": "Kepler-186", "ra": 1.0, "dec": 2.0}]}),
        encoding="utf-8")

    async def no_tap(*a, **k):
        return None

    monkeypatch.setattr(server, "CATALOG_DISK_CACHE", cache)
    monkeypatch.setattr(server, "tap_query", no_tap)
    monkeypatch.setattr(server, "CATALOG", [])
    monkeypatch.setattr(server, "CATALOG_RETRY_AT", 0.0)
    monkeypatch.setattr(server, "CATALOG_LOCK", asyncio.Lock())

    assert asyncio.run(server.ensure_catalog()) is True
    assert abs(server.CATALOG_DATA_TS - old_ts) < 1      # возраст — от файла, а не от загрузки
    stats = asyncio.run(server.stats())
    assert stats["stale"] is True and stats["age_hours"] >= 71


# ---------- задачи анализа кривых ----------

def test_lightcurve_job_rejects_paths_and_unknown_ids():
    import asyncio
    from fastapi import HTTPException

    for bad in ("..\..\secrets", "nope_nothing_here"):
        with pytest.raises(HTTPException) as e:
            asyncio.run(server.lightcurve_job(bad))
        assert e.value.status_code == 404


def test_lightcurve_job_reports_running_then_result(monkeypatch):
    import asyncio

    server.LC_JOBS["kepler-10_"] = {"key": "kepler10|", "status": "running", "error": None, "ts": 0}
    assert asyncio.run(server.lightcurve_job("kepler-10_")).status_code == 202
    server.LC_JOBS["kepler-10_"]["status"] = "done"
    monkeypatch.setitem(server.LC_CACHE, "kepler10|", (9e18, {"target": "Kepler-10"}))
    assert asyncio.run(server.lightcurve_job("kepler-10_")) == {"target": "Kepler-10"}
    server.LC_JOBS.pop("kepler-10_")
