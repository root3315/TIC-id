# -*- coding: utf-8 -*-
"""Честное сравнение двух CNN на двух отложенных реальных тестах.

Модели:  lc_cnn_v3.onnx (обучена на v3, 9.5k реальных) и lc_cnn.onnx (обучена на v2, 1k).
Тесты:   v3f (2 366 фильтрованных кривых, тяжёлый) и v2 (250 кривых, лёгкий).
Сплиты — те же, что в train_lc_torch.py: default_rng(42), первые 25%.
"""
import numpy as np
import onnxruntime as ort
from pathlib import Path

M = Path(__file__).parent / "models"


def test_slice(npz_path):
    d = np.load(npz_path)
    Xg, Xl, Xs, y = d["Xg"], d["Xl"], d["Xs"], d["y"]
    perm = np.random.default_rng(42).permutation(len(y))
    idx = perm[: max(60, len(y) // 4)]
    return Xg[idx].astype(np.float32), Xl[idx].astype(np.float32), Xs[idx].astype(np.float32), y[idx]


def evaluate(sess, Xg, Xl, Xs, y):
    logits = sess.run(None, {"global": Xg[:, None, :], "local": Xl[:, None, :], "scalars": Xs})[0]
    pred = logits.argmax(1)
    acc = float((pred == y).mean())
    rec_pl = float((pred[y == 0] == 0).mean())          # полнота по планетам
    pl_as_eb = float((pred[y == 0] == 1).mean())        # планета спутана с двойной
    return acc, rec_pl, pl_as_eb


tests = {
    "v3-тест (2 366 тяжёлых)": test_slice(M / "lc_real_dataset_v3.off"),
    "v2-тест (250 лёгких)": test_slice(M / "lc_real_dataset_v2.npz"),
}
models = {
    "CNN-v3 (обучена на 9.5k)": ort.InferenceSession(str(M / "lc_cnn_v3.onnx"), providers=["CPUExecutionProvider"]),
    "CNN-v2 (обучена на 1k)": ort.InferenceSession(str(M / "lc_cnn.onnx"), providers=["CPUExecutionProvider"]),
}
for mname, sess in models.items():
    for tname, (Xg, Xl, Xs, y) in tests.items():
        acc, rec, eb = evaluate(sess, Xg, Xl, Xs, y)
        print(f"{mname:28s} | {tname:24s} | acc {acc:.4f} | полнота планет {rec:.3f} | планета→двойная {eb:.3f}")
