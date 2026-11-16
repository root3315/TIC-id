"""Поиск периода BLS в server.run_bls: длинные периоды и SDE (без сети)."""

import numpy as np
import pytest

import server


def box_transits(period, t14_d, depth, span, cadence_d, noise, seed=0):
    rng = np.random.default_rng(seed)
    t = np.arange(0, span, cadence_d)
    dt = (t - 0.7 + 0.5 * period) % period - 0.5 * period
    return t, 1 - depth * (np.abs(dt) < 0.5 * t14_d) + rng.normal(0, noise, t.size)


def test_bls_finds_a_period_longer_than_thirty_days():
    t, f = box_transits(45.0, 8 / 24, 0.003, 300.0, 29.4 / 1440, 3e-4)
    bls = server.run_bls(t, f)
    assert bls["max_period"] == pytest.approx(150.0, rel=0.01)
    assert bls["best_period"] == pytest.approx(45.0, rel=0.01)
    assert bls["sde"] > 6


def test_sde_is_the_standard_one():
    t, f = box_transits(3.3, 3 / 24, 0.002, 27.0, 2 / 1440, 5e-4)
    bls = server.run_bls(t, f)
    assert bls["best_period"] == pytest.approx(3.3, rel=0.005)
    z = np.array([p["power"] for p in bls["periodogram"]])
    assert bls["sde"] == pytest.approx(z.max(), rel=0.05)
