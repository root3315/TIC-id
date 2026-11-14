"""Обучение нейросети, различающей форму транзита в «локальном виде» кривой блеска.

Локальный вид (как в AstroNet): крупный план транзита — окно ±2.5 длительности,
96 бинов. Транзит всегда в центре, его ширина ≈ 1/2.5 окна (с разбросом,
имитирующим ошибку измерения длительности).

Классы:
  0 — транзит планеты (плоское дно, мягкий вход/выход)
  1 — затменная двойная (V-форма без плоского дна или глубина > 1.5%)
  2 — нет транзита (шум, пульсации, тренды)

Запуск:  python train_lc_model.py
Результат: models/lc_mlp.joblib + models/lc_meta.json
"""

import json
import time
from pathlib import Path

import numpy as np
import joblib
from sklearn.metrics import accuracy_score, confusion_matrix
from sklearn.model_selection import train_test_split
from sklearn.neural_network import MLPClassifier

from lc_common import N_LOCAL, local_features

MODELS_DIR = Path(__file__).parent / "models"
rng = np.random.default_rng(7)

# координата окна: x ∈ [-1, 1], номинальный транзит занимает |x| < 0.2
X_GRID = np.linspace(-1, 1, N_LOCAL, endpoint=False) + 1.0 / N_LOCAL


def transit_curve(depth, half_width, ingress_frac, u=0.5):
    """Трапеция с лимбовым потемнением: half_width и ingress в координатах окна."""
    flux = np.zeros(N_LOCAL)
    ing = max(half_width * 2 * ingress_frac, 2.0 / N_LOCAL)
    for i, x in enumerate(np.abs(X_GRID)):
        if x >= half_width:
            continue
        if x <= half_width - ing:
            t = x / max(half_width - ing, 1e-6)
            flux[i] = -depth * (1 - u * 0.25 * t ** 2)
        else:
            flux[i] = -depth * (half_width - x) / ing
    return flux


def make_planet(noise):
    # per-bin SNR от 1.4 (спасает статистика по ~13 бинам транзита) до 200
    depth = min(noise * 10 ** rng.uniform(0.15, 2.3), 0.015)
    half_width = rng.uniform(0.14, 0.3)            # разброс из-за ошибки длительности
    ingress = rng.uniform(0.08, 0.35)
    return transit_curve(depth, half_width, ingress, u=rng.uniform(0.3, 0.8))


def make_eb(noise):
    deep = rng.random() < 0.4
    if deep:                                        # слишком глубоко для планеты
        depth = 10 ** rng.uniform(-1.8, -0.5)
        ingress = rng.uniform(0.1, 0.5)
    else:                                           # V-форма
        depth = min(max(noise * 10 ** rng.uniform(0.4, 2.8), 5e-4), 0.3)
        ingress = rng.uniform(0.45, 0.5)            # вход занимает всё — нет дна
    half_width = rng.uniform(0.14, 0.34)
    curve = transit_curve(depth, half_width, ingress, u=0)
    if rng.random() < 0.4:                          # эллипсоидальная модуляция
        curve += -depth * rng.uniform(0.03, 0.15) * np.cos(np.pi * X_GRID)
    return curve


def make_nothing(noise):
    curve = np.zeros(N_LOCAL)
    kind = rng.random()
    if kind < 0.4:                                  # синусоида
        amp = noise * rng.uniform(0.5, 4)
        curve += amp * np.sin(np.pi * rng.uniform(0.5, 3) * X_GRID + rng.uniform(0, 6.28))
    elif kind < 0.65:                               # тренд
        amp = noise * rng.uniform(0.5, 3)
        curve += amp * (X_GRID * rng.uniform(-2, 2) + X_GRID ** 2 * rng.uniform(-2, 2))
    elif kind < 0.8:                                # выброс-«ступенька» не в центре
        amp = noise * rng.uniform(1, 3)
        pos = rng.choice([-1, 1]) * rng.uniform(0.5, 0.9)
        curve += -amp * np.exp(-((X_GRID - pos) ** 2) / (2 * 0.03 ** 2))
    return curve


def add_noise(curve, noise):
    out = rng.normal(0, noise, N_LOCAL)
    if rng.random() < 0.35:
        red = np.cumsum(rng.normal(0, noise * 0.35, N_LOCAL))
        out += red - red.mean()
    return curve + out


def build_dataset(n_per_class=6000):
    X, y = [], []
    makers = [make_planet, make_eb, make_nothing]
    for label, make in enumerate(makers):
        for _ in range(n_per_class):
            noise = 10 ** rng.uniform(-4.1, -2.8)   # 80 … 1600 ppm на бин
            flux = 1.0 + add_noise(make(noise), noise)
            feats, _ = local_features(flux)
            X.append(feats)
            y.append(label)
    return np.array(X, dtype=np.float32), np.array(y)


def main():
    t0 = time.time()
    print("Генерирую 18 000 синтетических локальных видов транзита...")
    X, y = build_dataset(6000)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=42)

    print("Обучаю MLP (128 → 64)...")
    clf = MLPClassifier(hidden_layer_sizes=(128, 64), alpha=3e-4,
                        batch_size=256, learning_rate_init=1e-3,
                        max_iter=300, early_stopping=True, random_state=42)
    clf.fit(X_train, y_train)

    pred = clf.predict(X_test)
    acc = accuracy_score(y_test, pred)
    cm = confusion_matrix(y_test, pred).tolist()
    print(f"Точность на отложенной выборке: {acc:.4f}")
    print("Матрица ошибок (планета / двойная / ничего):", cm)

    MODELS_DIR.mkdir(exist_ok=True)
    joblib.dump(clf, MODELS_DIR / "lc_mlp.joblib")
    meta = {
        "trained_at": time.strftime("%Y-%m-%d %H:%M"),
        "classes": ["планетный транзит", "затменная двойная", "нет транзита"],
        "n_train": int(len(y_train)),
        "accuracy": round(float(acc), 4),
        "confusion_matrix": cm,
        "notes": "Обучена на 18 000 синтетических «локальных видов» транзита "
                 "(окно ±2.5 длительности, как в AstroNet); различает плоское дно "
                 "планетного транзита, V-форму затменной двойной и отсутствие сигнала.",
    }
    (MODELS_DIR / "lc_meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Готово за {time.time() - t0:.1f} с. Модель: models/lc_mlp.joblib")


if __name__ == "__main__":
    main()
