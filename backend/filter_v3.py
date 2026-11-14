# -*- coding: utf-8 -*-
"""Чистка v3-датасета от шума меток.

Проблема: сборщик v3 берёт по 1 кварталу на цель, и у части подтверждённых
планет транзит в одном квартале физически не виден (SNR сложенной кривой < ~6).
Такие примеры размечены «планета», но выглядят как шум — модель на них не учится,
а тест по ним занижается. Убираем недостоверные примеры из ОБОИХ классов сигнала:
предъявлять модели можно только то, что в данных действительно видно.

Xs[1] = log10(SNR + 1)  (см. lc_common.dual_features)
"""
import numpy as np
from pathlib import Path

M = Path(__file__).parent / "models"
SNR_MIN = 7.5   # ниже этого порога UI сам помечает вывод как ненадёжный

src = M / "lc_real_dataset_v3_raw.npz"
if not src.exists():
    src = M / "lc_real_dataset_v3.npz"
raw = np.load(src)
Xg, Xl, Xs, y = raw["Xg"], raw["Xl"], raw["Xs"], raw["y"]
snr = 10 ** Xs[:, 1] - 1.0

keep = np.ones(len(y), dtype=bool)
for cls in (0, 1):  # планеты и затменные двойные: сигнал обязан быть виден
    weak = (y == cls) & (snr < SNR_MIN)
    keep &= ~weak
    print(f"класс {cls}: убрано {int(weak.sum())} примеров с SNR<{SNR_MIN} "
          f"(осталось {int(((y == cls) & keep).sum())})")

print(f"пустых (класс 2): {int((y == 2).sum())} — без изменений")
out = {k: raw[k][keep] for k in ("Xg", "Xl", "Xs")}
out["y"] = y[keep]
if "grp" in raw.files:                      # сохраняем пометку звезды для split по звёздам
    out["grp"] = raw["grp"][keep]
counts = [int((out['y'] == c).sum()) for c in (0, 1, 2)]
print(f"итого: {len(out['y'])} примеров (планет {counts[0]}, двойных {counts[1]}, пусто {counts[2]})")

(M / "lc_real_dataset_v3_raw.npz").write_bytes((M / "lc_real_dataset_v3.npz").read_bytes())
np.savez_compressed(M / "lc_real_dataset_v3.npz", **out)
print("сырой датасет сохранён как lc_real_dataset_v3_raw.npz; фильтрованный записан на место v3")
