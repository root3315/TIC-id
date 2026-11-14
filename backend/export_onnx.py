"""Экспорт табличных моделей в ONNX, чтобы сервер работал без scikit-learn.

Запускать на машине для обучения после train_model.py / train_lc_model.py:
    python export_onnx.py
Каждая модель сверяется с исходной на случайных входах с пропусками (NaN):
если вероятности расходятся больше чем на 1e-4, файл не записывается.
"""

import json
import sys
from pathlib import Path

import joblib
import numpy as np
import onnxruntime as ort
from skl2onnx import to_onnx

MODELS = Path(__file__).parent / "models"
TOLERANCE = 1e-4
N_CHECK = 5000


def sample_inputs(n_features: int, rng: np.random.Generator, with_nan: bool) -> np.ndarray:
    """Широкий разброс в лог-масштабе; деревьям ещё ~20 % пропусков, как в живых данных."""
    x = rng.lognormal(mean=0.0, sigma=2.5, size=(N_CHECK, n_features))
    x *= rng.choice([-1.0, 1.0], size=x.shape, p=[0.1, 0.9])
    if with_nan:
        x[rng.random(x.shape) < 0.2] = np.nan
    return x.astype(np.float32)


def export(name: str, n_features: int, with_nan: bool) -> float:
    model = joblib.load(MODELS / f"{name}.joblib")
    onx = to_onnx(model, np.zeros((1, n_features), dtype=np.float32),
                  options={id(model): {"zipmap": False}}, target_opset=17)
    sess = ort.InferenceSession(onx.SerializeToString(), providers=["CPUExecutionProvider"])
    x = sample_inputs(n_features, np.random.default_rng(42), with_nan)
    expected = model.predict_proba(x.astype(np.float64))
    got = sess.run(None, {sess.get_inputs()[0].name: x})[1]
    diff = float(np.max(np.abs(expected - got)))
    if diff > TOLERANCE:
        raise SystemExit(f"{name}: ONNX расходится с sklearn на {diff:.2e}, файл не записан")
    (MODELS / f"{name}.onnx").write_bytes(onx.SerializeToString())
    return diff


def main() -> int:
    meta = json.loads((MODELS / "model_meta.json").read_text(encoding="utf-8"))
    lc_meta = json.loads((MODELS / "lc_meta.json").read_text(encoding="utf-8"))
    # (имя, число признаков, бывают ли пропуски на входе)
    jobs = [("exoplanet_clf", len(meta["features"]), True)]
    if meta.get("lite"):
        jobs.append(("exoplanet_clf_lite", len(meta["lite"]["features"]), True))
    if (MODELS / "lc_mlp.joblib").exists():
        mlp = joblib.load(MODELS / "lc_mlp.joblib")
        jobs.append(("lc_mlp", int(getattr(mlp, "n_features_in_", len(lc_meta.get("features", [])))), False))
    for name, n, with_nan in jobs:
        print(f"{name}: {n} признаков, макс. расхождение {export(name, n, with_nan):.2e}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
