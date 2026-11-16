"""Тесты измерения транзита на полной каденции (без сети)."""

import numpy as np

import transit_fit as T


def synthetic(period=2.21857, t14_h=1.8, flat=0.55, depth=0.024, cadence_min=2.0,
              span=54.0, noise=5e-4, seed=0):
    """Кривая с трапециевидными транзитами (как HD 189733 b в двух секторах TESS)."""
    rng = np.random.default_rng(seed)
    t = np.arange(0, span, cadence_min / 1440)
    t14 = t14_h / 24
    tau = t14 * (1 - flat) / 2
    # каждая точка — среднее за экспозицию, как в настоящих данных
    sub = (np.arange(15) - 7) / 15 * cadence_min / 1440
    shape = np.zeros_like(t)
    for o in sub:
        dt = (t + o - 0.7 + 0.5 * period) % period - 0.5 * period
        shape += np.clip((0.5 * t14 - np.abs(dt)) / tau, 0, 1) / len(sub)
    return t, 1 - depth * shape + rng.normal(0, noise, t.size)


def test_measures_depth_and_duration_of_a_flat_bottomed_transit():
    t, f = synthetic()
    # грубые стартовые значения, как после BLS на 30-минутных бинах
    m = T.measure_transit(t, f, 2.2187, 0.71, 1.25 / 24)
    assert abs(m["depth_ppm"] - 24000) / 24000 < 0.05
    assert abs(m["duration_hours"] - 1.8) < 0.12
    assert abs(m["period"] - 2.21857) < 2e-4
    assert m["shape_resolved"] and not m["v_shaped"] and not m["v_shape_marginal"]
    assert m["flat_bottom_ratio"] > 0.4


def test_flags_a_v_shaped_eclipse():
    t, f = synthetic(flat=0.0, depth=0.05, t14_h=3.0)
    m = T.measure_transit(t, f, 2.21857, 0.7, 3.0 / 24)
    assert m["v_shaped"]


def test_long_cadence_is_not_mistaken_for_a_v():
    # 30-минутная каденция Kepler скругляет края; модель учитывает экспозицию
    t, f = synthetic(cadence_min=29.4, span=300.0, noise=2e-4)
    m = T.measure_transit(t, f, 2.21857, 0.7, 1.8 / 24)
    assert abs(m["duration_hours"] - 1.8) < 0.2
    assert not m["v_shaped"]

