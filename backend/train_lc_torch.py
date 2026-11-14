"""Двухветочная 1D-CNN (AstroNet-подобная) для формы транзита. Обучение на GPU.

Входы: глобальный вид 128 бинов + локальный 64 + 4 скаляра (lc_common.dual_features).
Данные: 24 000 синтетических примеров + реальные кривые Kepler (v2, ~1000 примеров),
реальные при обучении повторяются ×6. Оценка — на отложенных РЕАЛЬНЫХ примерах.

Результат: models/lc_cnn.onnx (инференс через onnxruntime, GPU не нужен)
           + models/lc_meta.json (паспорт с метриками).

Запуск:  python train_lc_torch.py
"""

import json
import time
from pathlib import Path

import numpy as np

from lc_common import N_BINS, N_LOCAL, center_on_minimum, dual_features

MODELS = Path(__file__).parent / "models"
rng = np.random.default_rng(7)


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ---------- синтетика в двухветочном формате ----------

def _trapezoid(n, center, half_w, depth, ingress_frac, u=0.5):
    x = np.arange(n)
    d = np.abs(x - center)
    ing = max(half_w * 2 * ingress_frac, 1.0)
    f = np.zeros(n)
    core = d <= half_w - ing
    edge = (d > half_w - ing) & (d < half_w)
    t = d[core] / max(half_w - ing, 1e-6)
    f[core] = -depth * (1 - u * 0.25 * t ** 2)
    f[edge] = -depth * (half_w - d[edge]) / ing
    return f


def synth_example(label):
    noise_g = 10 ** rng.uniform(-4.1, -2.8)
    dur_frac = 10 ** rng.uniform(np.log10(0.008), np.log10(0.11))
    w_g = max(2.0, dur_frac * N_BINS)

    g = np.zeros(N_BINS)
    if label == 0:  # планета
        depth = min(noise_g * 10 ** rng.uniform(0.2, 2.3), 0.02)
        g += _trapezoid(N_BINS, N_BINS // 2, w_g / 2, depth,
                        rng.uniform(0.08, 0.35), u=rng.uniform(0.3, 0.8))
    elif label == 1:  # затменная двойная
        deep = rng.random() < 0.35
        depth = (10 ** rng.uniform(-1.8, -0.6) if deep
                 else min(max(noise_g * 10 ** rng.uniform(0.4, 2.8), 5e-4), 0.3))
        ing = rng.uniform(0.45, 0.5) if not deep else rng.uniform(0.1, 0.5)
        g += _trapezoid(N_BINS, N_BINS // 2, w_g / 2, depth, ing, u=0)
        if rng.random() < 0.8:  # вторичное затмение на краях (фаза ±0.5)
            sec = depth * rng.uniform(0.15, 0.9)
            g += _trapezoid(N_BINS, 0, w_g / 2, sec, 0.5, u=0)
            g += _trapezoid(N_BINS, N_BINS - 1, w_g / 2, sec, 0.5, u=0)
        if rng.random() < 0.5:  # эллипсоидальная модуляция
            ph = np.linspace(-0.5, 0.5, N_BINS, endpoint=False)
            g += -depth * rng.uniform(0.03, 0.15) * np.cos(4 * np.pi * ph)
    else:  # ничего: пульсации/тренд/шум
        ph = np.linspace(-1, 1, N_BINS, endpoint=False)
        kind = rng.random()
        if kind < 0.45:
            g += noise_g * rng.uniform(0.5, 4) * np.sin(
                np.pi * rng.uniform(0.5, 4) * ph + rng.uniform(0, 6.28))
        elif kind < 0.7:
            g += noise_g * rng.uniform(0.5, 3) * (ph * rng.uniform(-2, 2)
                                                  + ph ** 2 * rng.uniform(-2, 2))

    flux_g = 1.0 + g + rng.normal(0, noise_g, N_BINS)
    if rng.random() < 0.3:
        red = np.cumsum(rng.normal(0, noise_g * 0.35, N_BINS))
        flux_g += red - red.mean()
    flux_g, _ = center_on_minimum(flux_g)

    # локальный вид: транзит занимает |x|<0.2 окна
    noise_l = noise_g * rng.uniform(0.8, 1.6)
    loc = np.zeros(N_LOCAL)
    if label == 0:
        loc += _trapezoid(N_LOCAL, N_LOCAL // 2, rng.uniform(0.14, 0.3) * N_LOCAL / 2,
                          min(noise_g * 10 ** rng.uniform(0.2, 2.3), 0.02),
                          rng.uniform(0.08, 0.35), u=rng.uniform(0.3, 0.8))
    elif label == 1:
        deep = rng.random() < 0.35
        depth_l = (10 ** rng.uniform(-1.8, -0.6) if deep
                   else min(max(noise_l * 10 ** rng.uniform(0.4, 2.8), 5e-4), 0.3))
        ing = rng.uniform(0.45, 0.5) if not deep else rng.uniform(0.1, 0.5)
        loc += _trapezoid(N_LOCAL, N_LOCAL // 2, rng.uniform(0.14, 0.34) * N_LOCAL / 2,
                          depth_l, ing, u=0)
    else:
        xl = np.linspace(-1, 1, N_LOCAL, endpoint=False)
        loc += noise_l * rng.uniform(0.5, 3) * np.sin(
            np.pi * rng.uniform(0.5, 3) * xl + rng.uniform(0, 6.28))
    flux_l = 1.0 + loc + rng.normal(0, noise_l, N_LOCAL)

    return dual_features(flux_g, flux_l)


def build_synth(n_per_class=8000):
    Xg, Xl, Xs, y = [], [], [], []
    for label in (0, 1, 2):
        for _ in range(n_per_class):
            g, l, s = synth_example(label)
            Xg.append(g); Xl.append(l); Xs.append(s); y.append(label)
    return (np.array(Xg, np.float32), np.array(Xl, np.float32),
            np.array(Xs, np.float32), np.array(y))


# ---------- обучение ----------

def main():
    import torch
    import torch.nn as nn

    # фиксируем все источники случайности → обучение воспроизводимо
    torch.manual_seed(42)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(42)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    log(f"устройство: {device}"
        + (f" ({torch.cuda.get_device_name(0)})" if device == "cuda" else ""))

    ds_path = (MODELS / "lc_real_dataset_v3.npz"
               if (MODELS / "lc_real_dataset_v3.npz").exists()
               else MODELS / "lc_real_dataset_v2.npz")
    log(f"датасет: {ds_path.name}")
    data = np.load(ds_path)
    Xg_r, Xl_r, Xs_r, y_r = data["Xg"], data["Xl"], data["Xs"], data["y"]
    log(f"реальных примеров: {len(y_r)} "
        f"(планет {(y_r==0).sum()}, двойных {(y_r==1).sum()}, пусто {(y_r==2).sum()})")

    grp_r = data["grp"] if "grp" in data.files else None
    split_by_star = grp_r is not None and (grp_r >= 0).all()
    if split_by_star:
        # ГЛАВНОЕ: делим по ЗВЁЗДАМ (KIC-grouped), а не по примерам. Все кривые одной
        # звезды идут в один и тот же набор, так нет утечки между train и test.
        uniq = np.unique(grp_r)
        rs = np.random.default_rng(42)
        rs.shuffle(uniq)
        n_star_test = max(1, len(uniq) // 4)
        n_star_val = max(1, len(uniq) // 8)
        test_stars = set(uniq[:n_star_test].tolist())
        val_stars = set(uniq[n_star_test:n_star_test + n_star_val].tolist())
        in_test = np.isin(grp_r, list(test_stars))
        in_val = np.isin(grp_r, list(val_stars))
        test_i = np.where(in_test)[0]
        val_i = np.where(in_val)[0]
        train_i = np.where(~(in_test | in_val))[0]
        n_test = len(test_i)
        log(f"split ПО ЗВЁЗДАМ (KIC): {len(uniq)} звёзд → "
            f"train {len(train_i)} / val {len(val_i)} / test {len(test_i)} примеров")
    else:
        perm = np.random.default_rng(42).permutation(len(y_r))
        n_test = max(60, len(y_r) // 4)
        n_val = max(40, len(y_r) // 8)
        test_i = perm[:n_test]
        val_i = perm[n_test:n_test + n_val]
        train_i = perm[n_test + n_val:]
        log("split по примерам (в датасете нет пометки звезды)")

    log("генерирую 24 000 синтетических примеров...")
    Xg_s, Xl_s, Xs_s, y_s = build_synth(8000)

    REP = 6  # вес реальных примеров
    Xg_tr = np.vstack([Xg_s] + [Xg_r[train_i]] * REP)
    Xl_tr = np.vstack([Xl_s] + [Xl_r[train_i]] * REP)
    Xs_tr = np.vstack([Xs_s] + [Xs_r[train_i]] * REP)
    y_tr = np.concatenate([y_s] + [y_r[train_i]] * REP)

    def to_t(g, l, s, y=None):
        out = (torch.tensor(g).unsqueeze(1), torch.tensor(l).unsqueeze(1),
               torch.tensor(s))
        return out if y is None else (*out, torch.tensor(y, dtype=torch.long))

    class ExoCNN(nn.Module):
        def __init__(self):
            super().__init__()
            self.g = nn.Sequential(
                nn.Conv1d(1, 16, 5, padding=2), nn.ReLU(), nn.MaxPool1d(2),
                nn.Conv1d(16, 32, 5, padding=2), nn.ReLU(), nn.MaxPool1d(2),
                nn.Conv1d(32, 64, 3, padding=1), nn.ReLU(),
                nn.AdaptiveAvgPool1d(8), nn.Flatten())          # 512
            self.l = nn.Sequential(
                nn.Conv1d(1, 16, 5, padding=2), nn.ReLU(), nn.MaxPool1d(2),
                nn.Conv1d(16, 32, 3, padding=1), nn.ReLU(),
                nn.AdaptiveAvgPool1d(8), nn.Flatten())          # 256
            self.head = nn.Sequential(
                nn.Linear(512 + 256 + 4, 128), nn.ReLU(), nn.Dropout(0.35),
                nn.Linear(128, 64), nn.ReLU(), nn.Linear(64, 3))

        def forward(self, g, l, s):
            return self.head(torch.cat([self.g(g), self.l(l), s], dim=1))

    model = ExoCNN().to(device)
    n_params = sum(p.numel() for p in model.parameters())
    log(f"параметров в CNN: {n_params:,}")

    ds = torch.utils.data.TensorDataset(*to_t(Xg_tr, Xl_tr, Xs_tr, y_tr))
    dl = torch.utils.data.DataLoader(ds, batch_size=512, shuffle=True,
                                     pin_memory=(device == "cuda"))
    opt = torch.optim.AdamW(model.parameters(), lr=1.5e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=60)
    lossf = nn.CrossEntropyLoss(label_smoothing=0.05)

    gv, lv, sv, yv = to_t(Xg_r[val_i], Xl_r[val_i], Xs_r[val_i], y_r[val_i])
    gt, lt, st, yt = to_t(Xg_r[test_i], Xl_r[test_i], Xs_r[test_i], y_r[test_i])

    @torch.no_grad()
    def acc_on(g, l, s, y):
        model.eval()
        pred = model(g.to(device), l.to(device), s.to(device)).argmax(1).cpu()
        return float((pred == y).float().mean()), pred

    best_val, best_state, patience = 0.0, None, 0
    t0 = time.time()
    for epoch in range(1, 61):
        model.train()
        total = 0.0
        for bg, bl, bs, by in dl:
            opt.zero_grad()
            out = model(bg.to(device, non_blocking=True),
                        bl.to(device, non_blocking=True),
                        bs.to(device, non_blocking=True))
            loss = lossf(out, by.to(device))
            loss.backward()
            opt.step()
            total += float(loss) * len(by)
        sched.step()
        val_acc, _ = acc_on(gv, lv, sv, yv)
        if val_acc > best_val:
            best_val, patience = val_acc, 0
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
        else:
            patience += 1
        if epoch % 5 == 0 or patience == 0:
            log(f"эпоха {epoch:02d}: loss {total/len(y_tr):.4f}, real-val acc {val_acc:.3f}"
                + (" *" if patience == 0 else ""))
        if patience >= 12:
            log("ранняя остановка")
            break
    model.load_state_dict(best_state)
    log(f"обучение: {(time.time()-t0)/60:.1f} мин, лучший real-val acc {best_val:.3f}")

    test_acc, pred_t = acc_on(gt, lt, st, yt)
    from sklearn.metrics import confusion_matrix, f1_score, precision_score, recall_score
    cm = confusion_matrix(yt.numpy(), pred_t.numpy(), labels=[0, 1, 2]).tolist()
    f1m = float(f1_score(yt.numpy(), pred_t.numpy(), average="macro"))
    log(f"РЕАЛЬНЫЙ тест ({n_test}): acc {test_acc:.4f}, F1-macro {f1m:.4f}")
    log(f"матрица: {cm}")
    sg, sl, ss, sy = to_t(Xg_s[-4000:], Xl_s[-4000:], Xs_s[-4000:], y_s[-4000:])
    synth_acc, _ = acc_on(sg, sl, ss, sy)
    log(f"синтетический тест: acc {synth_acc:.4f}")

    # ---------- экспорт в ONNX ----------
    model.eval().cpu()
    dummy = (torch.zeros(1, 1, N_BINS), torch.zeros(1, 1, N_LOCAL), torch.zeros(1, 4))
    onnx_path = MODELS / "lc_cnn.onnx"
    torch.onnx.export(model, dummy, str(onnx_path),
                      input_names=["global", "local", "scalars"],
                      output_names=["logits"],
                      dynamic_axes={"global": {0: "b"}, "local": {0: "b"},
                                    "scalars": {0: "b"}, "logits": {0: "b"}},
                      opset_version=17)
    import onnxruntime as ort
    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    ref = model(*dummy).detach().numpy()
    got = sess.run(None, {"global": dummy[0].numpy(), "local": dummy[1].numpy(),
                          "scalars": dummy[2].numpy()})[0]
    assert np.allclose(ref, got, atol=1e-4), "ONNX не совпал с PyTorch"
    log(f"ONNX экспортирован и проверен: {onnx_path.name}")

    meta = {
        "trained_at": time.strftime("%Y-%m-%d %H:%M"),
        "arch": "двухветочная 1D-CNN (AstroNet-подобная), PyTorch → ONNX",
        "device": (torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU"),
        "n_params": int(n_params),
        "classes": ["планетный транзит", "затменная двойная", "нет транзита"],
        "n_train": int(len(y_tr)),
        "n_real": int(len(y_r)),
        "n_real_test": int(n_test),
        "split_by_star": bool(split_by_star),
        "accuracy": round(float(test_acc), 4),
        "f1_macro": round(f1m, 4),
        "accuracy_synthetic": round(float(synth_acc), 4),
        "confusion_matrix": cm,
        "real_data": True,
        "cnn": True,
        "notes": "CNN обучена на 24 000 синтетических двухветочных примеров + реальных "
                 "кривых Kepler (×6); метрика — на отложенных РЕАЛЬНЫХ кривых.",
    }
    (MODELS / "lc_meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    log("паспорт модели обновлён: lc_meta.json")


if __name__ == "__main__":
    main()
