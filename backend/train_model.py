"""Обучение классификатора экзопланет на размеченных кандидатах Kepler (KOI).

Данные: таблица `cumulative` NASA Exoplanet Archive — все объекты интереса Kepler
с официальным вердиктом (CONFIRMED / FALSE POSITIVE / CANDIDATE).

Важно: флаги вэттинга (koi_fpflag_*) НЕ используются — они кодируют сам ответ
и дали бы утечку разметки. Модель учится только на физике транзита и звезды,
поэтому её можно честно применять к ещё не проверенным кандидатам TESS.

Запуск:  python train_model.py
Результат: models/exoplanet_clf.joblib + models/model_meta.json
"""

import json
import time
from pathlib import Path

import httpx
import numpy as np
import joblib
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.inspection import permutation_importance
from sklearn.metrics import (accuracy_score, f1_score, precision_score,
                             recall_score, roc_auc_score)
from sklearn.model_selection import train_test_split

TAP = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"
MODELS_DIR = Path(__file__).parent / "models"

# (колонка KOI, человекочитаемое имя, единицы)
FEATURES = [
    ("koi_period", "Орбитальный период", "сут"),
    ("koi_duration", "Длительность транзита", "ч"),
    ("koi_depth", "Глубина транзита", "ppm"),
    ("koi_prad", "Радиус кандидата", "R⊕"),
    ("koi_teq", "Равновесная температура", "K"),
    ("koi_insol", "Инсоляция", "S⊕"),
    ("koi_model_snr", "Сигнал/шум транзита", ""),
    ("koi_impact", "Прицельный параметр", ""),
    ("koi_steff", "Температура звезды", "K"),
    ("koi_slogg", "log g звезды", "dex"),
    ("koi_srad", "Радиус звезды", "R☉"),
    ("koi_kepmag", "Звёздная величина", "mag"),
    # --- v2: диагностические признаки транзита (те же, что смотрят вэттеры) ---
    ("koi_ror", "Отношение радиусов Rp/R★", ""),
    ("koi_srho", "Плотность звезды из транзита", "г/см³"),
    ("koi_dor", "Полуось в радиусах звезды a/R★", ""),
    ("koi_incl", "Наклонение", "°"),
    ("koi_num_transits", "Число наблюдённых транзитов", ""),
    ("koi_max_mult_ev", "Макс. множественная статистика MES", ""),
    ("koi_max_sngle_ev", "Макс. одиночная статистика SES", ""),
    ("koi_fwm_stat_sig", "Значимость смещения центроида", "%"),
    ("koi_dicco_msky", "Сдвиг центроида (разностное изобр.)", "″"),
    ("koi_dikco_msky", "Сдвиг центроида (KIC)", "″"),
    ("koi_smet", "Металличность звезды", "dex"),
]
FEATURE_COLS = [f[0] for f in FEATURES]

# Переносимые признаки — первые 12: они есть и у кандидатов TESS (TOI), и в ручной
# форме. Диагностика пайплайна Kepler (центроиды, MES/SES и т.п.) вне Kepler
# НЕДОСТУПНА: модель, обученная на ней, на TOI получает сплошные NaN и рушит
# вероятности. Поэтому для TOI/ручного ввода обучаем отдельную lite-модель.
N_TRANSFER = 12
TRANSFER_FEATURES = FEATURES[:N_TRANSFER]


def fetch_koi():
    cols = "kepoi_name,koi_disposition," + ",".join(FEATURE_COLS)
    query = f"SELECT {cols} FROM cumulative"
    print("Скачиваю таблицу KOI cumulative из NASA Exoplanet Archive...")
    with httpx.Client(timeout=180.0) as client:
        r = client.get(TAP, params={"query": query, "format": "json"})
        r.raise_for_status()
        rows = r.json()
    print(f"Получено объектов: {len(rows)}")
    return rows


def to_matrix(rows):
    X, y, names = [], [], []
    counts = {"CONFIRMED": 0, "FALSE POSITIVE": 0, "CANDIDATE": 0}
    for row in rows:
        disp = (row.get("koi_disposition") or "").upper()
        if disp in counts:
            counts[disp] += 1
        if disp not in ("CONFIRMED", "FALSE POSITIVE"):
            continue
        feats = []
        for col in FEATURE_COLS:
            v = row.get(col)
            feats.append(float(v) if v is not None else np.nan)
        X.append(feats)
        y.append(1 if disp == "CONFIRMED" else 0)
        names.append(row.get("kepoi_name"))
    print(f"Разметка: {counts}")
    return np.array(X, dtype=float), np.array(y, dtype=int), names


def main():
    t0 = time.time()
    rows = fetch_koi()
    X, y, _ = to_matrix(rows)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=42
    )
    print(f"Обучение: {len(y_train)} объектов, тест: {len(y_test)}")

    # подбор гиперпараметров: 30 случайных конфигураций × 5-фолдовая кросс-валидация
    from sklearn.model_selection import RandomizedSearchCV
    print("Подбор гиперпараметров (RandomizedSearchCV, 5-fold, scoring=roc_auc)...")
    search = RandomizedSearchCV(
        HistGradientBoostingClassifier(early_stopping=True, random_state=42,
                                       max_iter=600),
        param_distributions={
            "learning_rate": [0.03, 0.05, 0.08, 0.12],
            "max_leaf_nodes": [15, 31, 63, 127],
            "min_samples_leaf": [10, 20, 40, 80],
            "l2_regularization": [0.0, 0.1, 0.5, 1.5, 5.0],
            "max_features": [0.6, 0.8, 1.0],
        },
        n_iter=30, cv=5, scoring="roc_auc", n_jobs=-1, random_state=42, refit=True,
    )
    search.fit(X_train, y_train)
    clf = search.best_estimator_
    print(f"Лучшая конфигурация: {search.best_params_}")
    print(f"CV ROC-AUC: {search.best_score_:.4f}")

    def eval_metrics(model, Xt, yt):
        proba = model.predict_proba(Xt)[:, 1]
        pred = (proba >= 0.5).astype(int)
        return {
            "roc_auc": round(float(roc_auc_score(yt, proba)), 4),
            "accuracy": round(float(accuracy_score(yt, pred)), 4),
            "precision": round(float(precision_score(yt, pred)), 4),
            "recall": round(float(recall_score(yt, pred)), 4),
            "f1": round(float(f1_score(yt, pred)), 4),
            "n_train": int(len(y_train)),
            "n_test": int(len(yt)),
            "n_confirmed": int(y.sum()),
            "n_false_positive": int(len(y) - y.sum()),
        }

    metrics = eval_metrics(clf, X_test, y_test)
    print("Метрики на отложенной выборке:", json.dumps(metrics, indent=2))

    # --- Lite-модель для TOI и ручного ввода: только переносимые признаки ---
    print(f"\nОбучаю переносимую lite-модель ({N_TRANSFER} признаков, "
          "без диагностики пайплайна Kepler)...")
    Xl_train, Xl_test = X_train[:, :N_TRANSFER], X_test[:, :N_TRANSFER]
    search_lite = RandomizedSearchCV(
        HistGradientBoostingClassifier(early_stopping=True, random_state=42,
                                       max_iter=600),
        param_distributions={
            "learning_rate": [0.03, 0.05, 0.08, 0.12],
            "max_leaf_nodes": [15, 31, 63, 127],
            "min_samples_leaf": [10, 20, 40, 80],
            "l2_regularization": [0.0, 0.1, 0.5, 1.5, 5.0],
            "max_features": [0.6, 0.8, 1.0],
        },
        n_iter=20, cv=5, scoring="roc_auc", n_jobs=-1, random_state=42, refit=True,
    )
    search_lite.fit(Xl_train, y_train)
    clf_lite = search_lite.best_estimator_
    metrics_lite = eval_metrics(clf_lite, Xl_test, y_test)
    print("Lite-метрики на той же отложенной выборке:", json.dumps(metrics_lite, indent=2))

    print("Считаю важность признаков (permutation importance)...")
    imp = permutation_importance(clf, X_test, y_test, scoring="roc_auc",
                                 n_repeats=8, random_state=42)
    importances = sorted(
        [
            {"feature": col, "label": label, "unit": unit,
             "importance": round(float(m), 5)}
            for (col, label, unit), m in zip(FEATURES, imp.importances_mean)
        ],
        key=lambda d: -d["importance"],
    )

    # Медианы по классам — для объяснения предсказаний в UI
    class_medians = {}
    for i, col in enumerate(FEATURE_COLS):
        planet_vals = X[(y == 1), i]
        fp_vals = X[(y == 0), i]
        class_medians[col] = {
            "planet": round(float(np.nanmedian(planet_vals)), 4),
            "false_positive": round(float(np.nanmedian(fp_vals)), 4),
        }

    MODELS_DIR.mkdir(exist_ok=True)
    joblib.dump(clf, MODELS_DIR / "exoplanet_clf.joblib")
    joblib.dump(clf_lite, MODELS_DIR / "exoplanet_clf_lite.joblib")
    meta = {
        "trained_at": time.strftime("%Y-%m-%d %H:%M"),
        "dataset": "NASA Exoplanet Archive — Kepler Objects of Interest (cumulative)",
        "algorithm": "HistGradientBoostingClassifier (scikit-learn)",
        "features": [{"col": c, "label": l, "unit": u} for c, l, u in FEATURES],
        "metrics": metrics,
        "importances": importances,
        "class_medians": class_medians,
        "lite": {
            "purpose": "Переносимая модель для TOI (TESS) и ручного ввода: только "
                       "признаки, доступные вне пайплайна Kepler",
            "features": [{"col": c, "label": l, "unit": u} for c, l, u in TRANSFER_FEATURES],
            "metrics": metrics_lite,
            "params": {k: (float(v) if isinstance(v, (int, float)) else v)
                       for k, v in search_lite.best_params_.items()},
        },
        "notes": "Флаги вэттинга исключены во избежание утечки разметки. "
                 "Модель оценивает вероятность того, что кандидат — планета, "
                 "по параметрам транзита и звезды. Полная модель (23 признака) — "
                 "для данных Kepler; lite (12) — для TOI и ручной проверки.",
    }
    (MODELS_DIR / "model_meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Готово за {time.time() - t0:.1f} с. Модель: models/exoplanet_clf.joblib")


if __name__ == "__main__":
    main()
