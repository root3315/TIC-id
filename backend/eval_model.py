"""Полная оценка обеих моделей для технического отчёта.

Воспроизводит те же отложенные выборки, что были при обучении (одинаковые
random_state), и считает Accuracy / Precision / Recall / F1 / ROC-AUC,
строит ROC-кривую и матрицы ошибок (PNG в ../docs/).

Запуск:  python eval_model.py
"""

import json
import time
from pathlib import Path

import joblib
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.metrics import (accuracy_score, confusion_matrix, f1_score,
                             precision_score, recall_score, roc_auc_score,
                             roc_curve)
from sklearn.model_selection import train_test_split

from train_model import fetch_koi, to_matrix

MODELS = Path(__file__).parent / "models"
DOCS = Path(__file__).parent.parent / "docs"
DOCS.mkdir(exist_ok=True)

summary = {}

# ---------- 1. Табличный классификатор (KOI) ----------
print("Скачиваю KOI и воспроизвожу отложенную выборку...")
rows = fetch_koi()
X, y, _ = to_matrix(rows)
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, stratify=y, random_state=42)

clf = joblib.load(MODELS / "exoplanet_clf.joblib")
proba = clf.predict_proba(X_test)[:, 1]
pred = (proba >= 0.5).astype(int)

m = {
    "accuracy": round(float(accuracy_score(y_test, pred)), 4),
    "precision": round(float(precision_score(y_test, pred)), 4),
    "recall": round(float(recall_score(y_test, pred)), 4),
    "f1": round(float(f1_score(y_test, pred)), 4),
    "roc_auc": round(float(roc_auc_score(y_test, proba)), 4),
    "n_test": int(len(y_test)),
    "confusion_matrix": confusion_matrix(y_test, pred).tolist(),
}
summary["tabular"] = m
print("Табличная модель:", json.dumps(m, indent=2))

# ROC-кривая
fpr, tpr, _ = roc_curve(y_test, proba)
plt.figure(figsize=(6.4, 5.4), dpi=130)
plt.plot(fpr, tpr, color="#0e7490", lw=2.2,
         label=f"наша модель (AUC = {m['roc_auc']:.3f})")
plt.plot([0, 1], [0, 1], "--", color="#9ca3af", lw=1.2, label="случайное угадывание")
plt.fill_between(fpr, tpr, alpha=0.12, color="#0e7490")
plt.xlabel("Доля ложных тревог (FPR)")
plt.ylabel("Доля найденных планет (TPR)")
plt.title(f"ROC-кривая: планета vs ложноположительный\n"
          f"{m['n_test']} отложенных размеченных кандидатов Kepler")
plt.legend(loc="lower right")
plt.grid(alpha=0.25)
plt.tight_layout()
plt.savefig(DOCS / "roc_tabular.png")
plt.close()

# Матрица ошибок
cm = np.array(m["confusion_matrix"])
plt.figure(figsize=(5.4, 4.6), dpi=130)
plt.imshow(cm, cmap="Blues")
labels = ["ложнополож.", "планета"]
plt.xticks([0, 1], labels)
plt.yticks([0, 1], labels)
plt.xlabel("Предсказание модели")
plt.ylabel("Вердикт NASA")
for i in range(2):
    for j in range(2):
        plt.text(j, i, str(cm[i, j]), ha="center", va="center",
                 color="white" if cm[i, j] > cm.max() / 2 else "#1f2937",
                 fontsize=15, fontweight="bold")
plt.title("Матрица ошибок (отложенная выборка)")
plt.tight_layout()
plt.savefig(DOCS / "cm_tabular.png")
plt.close()

# дописываем F1 в паспорт модели
meta_path = MODELS / "model_meta.json"
meta = json.loads(meta_path.read_text(encoding="utf-8"))
meta["metrics"]["f1"] = m["f1"]
meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

# ---------- 2. Нейросеть формы транзита (реальные кривые) ----------
# ВАЖНО: тот же датасет и тот же split (rng 42, первые len//4), что в train_lc_torch.py,
# иначе метрики здесь не совпадут с паспортом lc_meta.json.
classes = ["планета", "двойная", "ничего"]
lc_ds = MODELS / "lc_real_dataset_v3.npz"
if not lc_ds.exists():
    lc_ds = MODELS / "lc_real_dataset_v2.npz"
if (MODELS / "lc_cnn.onnx").exists() and lc_ds.exists():
    import onnxruntime as ort
    data = np.load(lc_ds)
    Xg, Xl, Xs, yr = data["Xg"], data["Xl"], data["Xs"], data["y"]
    grp = data["grp"] if "grp" in data.files else None
    if grp is not None and (grp >= 0).all():
        # тот же split ПО ЗВЁЗДАМ, что в train_lc_torch.py
        uniq = np.unique(grp); rs = np.random.default_rng(42); rs.shuffle(uniq)
        test_stars = set(uniq[:max(1, len(uniq) // 4)].tolist())
        test_i = np.where(np.isin(grp, list(test_stars)))[0]
        n_test = len(test_i)
        print(f"Нейросеть: split по звёздам, тест {n_test} кривых с {len(test_stars)} звёзд")
    else:
        perm = np.random.default_rng(42).permutation(len(yr))
        n_test = max(60, len(yr) // 4)
        test_i = perm[:n_test]
    print(f"Нейросеть: датасет {lc_ds.name}, отложенный тест {n_test} реальных кривых")
    sess = ort.InferenceSession(str(MODELS / "lc_cnn.onnx"),
                                providers=["CPUExecutionProvider"])
    logits = sess.run(None, {"global": Xg[test_i][:, None, :],
                             "local": Xl[test_i][:, None, :],
                             "scalars": Xs[test_i]})[0]
    pred_r = logits.argmax(1)
else:  # старый путь: MLP на локальном виде
    data = np.load(MODELS / "lc_real_dataset.npz")
    Xr, yr = data["X"], data["y"]
    perm = np.random.default_rng(42).permutation(len(yr))
    n_test = max(20, len(yr) // 4)
    test_i = perm[:n_test]
    mlp = joblib.load(MODELS / "lc_mlp.joblib")
    pred_r = mlp.predict(Xr[test_i])
lc = {
    "accuracy": round(float(accuracy_score(yr[test_i], pred_r)), 4),
    "precision_macro": round(float(precision_score(yr[test_i], pred_r, average="macro")), 4),
    "recall_macro": round(float(recall_score(yr[test_i], pred_r, average="macro")), 4),
    "f1_macro": round(float(f1_score(yr[test_i], pred_r, average="macro")), 4),
    "n_test": int(n_test),
    "confusion_matrix": confusion_matrix(yr[test_i], pred_r, labels=[0, 1, 2]).tolist(),
}
summary["lightcurve"] = lc
print("Нейросеть формы (реальные кривые):", json.dumps(lc, indent=2))

cm2 = np.array(lc["confusion_matrix"])
plt.figure(figsize=(5.8, 4.9), dpi=130)
plt.imshow(cm2, cmap="Purples")
plt.xticks([0, 1, 2], classes)
plt.yticks([0, 1, 2], classes)
plt.xlabel("Предсказание нейросети")
plt.ylabel("Истинный класс")
for i in range(3):
    for j in range(3):
        plt.text(j, i, str(cm2[i, j]), ha="center", va="center",
                 color="white" if cm2[i, j] > cm2.max() / 2 else "#1f2937",
                 fontsize=14, fontweight="bold")
plt.title(f"Нейросеть формы транзита: {n_test} отложенных\nРЕАЛЬНЫХ кривых Kepler")
plt.tight_layout()
plt.savefig(DOCS / "cm_lightcurve.png")
plt.close()

(DOCS / "metrics_summary.json").write_text(
    json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"\nГрафики: docs/roc_tabular.png, docs/cm_tabular.png, docs/cm_lightcurve.png")
