"""Тесты связки с Muninn: поиск звезды по позиции и сборка планетной системы. Без сети."""

import pytest

import systems


def row(pl, host, ra, dec, **kw):
    return {"pl_name": pl, "hostname": host, "ra": ra, "dec": dec, **kw}


@pytest.fixture
def rows():
    return [
        row("alf Tau b", "alf Tau", 68.98, 16.51, pl_orbsmax=1.46, pl_orbper=628.96,
            st_teff=4055, st_mass=1.13, st_rad=45.1, st_lum=2.6, sy_dist=20.4),
        row("tau Cet e", "tau Cet", 26.02, -15.94, pl_orbsmax=0.538, pl_orbper=162.87),
        row("tau Cet f", "tau Cet", 26.02, -15.94, pl_orbsmax=1.334, pl_orbper=636.13),
        row("tau Cet g", "tau Cet", 26.02, -15.94, pl_orbsmax=None, pl_orbper=20.0,
            st_mass=0.78),
        row("no pos b", "no pos", None, None),
    ]


def test_angular_sep_one_arcminute():
    assert systems.angular_sep_arcsec(10.0, 0.0, 10.0, 1 / 60) == pytest.approx(60.0, rel=1e-6)


def test_angular_sep_wraps_ra():
    assert systems.angular_sep_arcsec(359.999, 0.0, 0.001, 0.0) == pytest.approx(7.2, rel=1e-3)


def test_host_index_groups_planets_and_skips_unplaced(rows):
    hosts = systems.build_host_index(rows)
    by_name = {h["hostname"]: h for h in hosts}
    assert set(by_name) == {"alf Tau", "tau Cet"}
    assert len(by_name["tau Cet"]["planets"]) == 3


def test_nearest_host_matches_rounded_muninn_position(rows):
    # Muninn хранит позицию до 0,01°: Альдебаран там 68.98 16.51
    hosts = systems.build_host_index(rows)
    host, sep = systems.nearest_host(hosts, 68.985, 16.505, radius_arcsec=90)
    assert host["hostname"] == "alf Tau"
    assert sep < 30


def test_nearest_host_none_outside_radius(rows):
    hosts = systems.build_host_index(rows)
    assert systems.nearest_host(hosts, 68.98, 18.0, radius_arcsec=90) is None


def test_find_host_by_name_ignores_case_and_spaces(rows):
    hosts = systems.build_host_index(rows)
    assert systems.find_host_by_name(hosts, "TAU  cet")["hostname"] == "tau Cet"
    assert systems.find_host_by_name(hosts, "Vega") is None


def test_orbit_axis_from_kepler_when_missing():
    # 365.25 сут вокруг 1 M☉ → 1 а.е.
    a, estimated = systems.orbit_axis_au(None, 365.25, 1.0)
    assert a == pytest.approx(1.0, rel=1e-3)
    assert estimated is True


def test_orbit_axis_keeps_catalog_value():
    assert systems.orbit_axis_au(1.46, 628.96, 1.13) == (1.46, False)


def test_orbit_axis_unknown_without_period():
    assert systems.orbit_axis_au(None, None, 1.0) == (None, False)


def test_system_payload_sorted_by_orbit_with_estimate_flag(rows):
    hosts = systems.build_host_index(rows)
    tau = systems.find_host_by_name(hosts, "tau Cet")
    hz = {"inner_optimistic": 0.4, "inner_conservative": 0.5,
          "outer_conservative": 0.9, "outer_optimistic": 1.0}
    out = systems.system_payload(tau, hz=hz, match_arcsec=12.3)
    names = [p["name"] for p in out["planets"]]
    assert names == ["tau Cet g", "tau Cet e", "tau Cet f"]
    assert out["planets"][0]["a_estimated"] is True
    assert out["planets"][1]["a_estimated"] is False
    assert out["star"]["name"] == "tau Cet"
    assert out["habitable_zone"] == hz
    assert out["match_arcsec"] == 12.3


def test_hosts_compact_listing(rows):
    hosts = systems.build_host_index(rows)
    listing = systems.hosts_compact(hosts)
    assert {"h": "tau Cet", "ra": 26.02, "dec": -15.94, "n": 3} in listing


def test_star_parameters_come_from_one_row():
    # у b есть только Teff, у c — Teff, R и M из другой статьи: смешивать нельзя
    rows = [row("X b", "X", 1.0, 1.0, st_teff=5000, sy_dist=10.0),
            row("X c", "X", 1.0, 1.0, st_teff=5200, st_rad=0.9, st_mass=0.95)]
    out = systems.system_payload(systems.build_host_index(rows)[0], hz=None)
    assert out["star"]["temperature"] == 5200
    assert out["star"]["radius"] == 0.9
    assert out["star"]["params_from"] == "X c"
    assert out["star"]["distance_pc"] == 10.0


def test_host_found_by_planet_name_alias():
    rows = [row("Kepler-90 b", "KOI-351", 284.4, 49.3), row("Kepler-90 h", "KOI-351", 284.4, 49.3)]
    hosts = systems.build_host_index(rows)
    assert systems.find_host_by_name(hosts, "Kepler-90")["hostname"] == "KOI-351"
    assert systems.find_host_by_name(hosts, "KOI-351")["hostname"] == "KOI-351"


def test_mass_kind_from_provenance():
    assert systems.mass_kind("M-R relationship") == "estimated"
    assert systems.mass_kind("Msini") == "minimum"
    assert systems.mass_kind("Msin(i)/sin(i)") == "measured"
    assert systems.mass_kind("Mass") == "measured"
    assert systems.mass_kind(None) is None
