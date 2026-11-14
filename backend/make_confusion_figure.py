"""Иллюстрация для отчёта: сигналы, которые путают с транзитом планеты.

Шесть синтетических (но физически правдоподобных) кривых блеска — почему
глазами и простыми порогами их легко перепутать. PNG → ../docs/confusion_examples.png
"""

from pathlib import Path

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

rng = np.random.default_rng(3)
t = np.linspace(0, 10, 2000)          # 10 суток, каденция ~7 мин
noise = lambda s: rng.normal(0, s, len(t))

def transit(t0, depth, dur, ingress=0.15):
    f = np.zeros_like(t)
    for c in np.arange(t0, t[-1], 3.7):           # период 3.7 сут
        x = np.abs(t - c)
        half, ing = dur / 2, dur * ingress
        core = x <= half - ing
        edge = (x > half - ing) & (x < half)
        f[core] -= depth
        f[edge] -= depth * (half - x[edge]) / ing
    return f

fig, axes = plt.subplots(3, 2, figsize=(12.5, 9.5), dpi=130, sharex=True)
fig.suptitle("Что видят телескопы: транзит планеты и его «двойники» (синтетические иллюстрации)",
             fontsize=14, fontweight="bold")

panels = []

# 1. Планета
f = 1 + transit(1.2, 0.008, 0.25) + noise(0.0012)
panels.append((f, "① Транзит планеты",
               "симметричный провал с ПЛОСКИМ дном,\nодинаковая глубина каждые 3.7 сут", "#0e7490"))

# 2. Затменная двойная
f = 1 + transit(1.2, 0.03, 0.3, ingress=0.5) + transit(1.2 + 1.85, 0.012, 0.3, ingress=0.5) + noise(0.0012)
panels.append((f, "② Затменная двойная звезда",
               "V-образные провалы БЕЗ плоского дна +\nвторичное затмение между главными", "#b91c1c"))

# 3. Фоновая двойная (разбавленная)
f = 1 + transit(1.2, 0.006, 0.3, ingress=0.5) + noise(0.0012)
panels.append((f, "③ Фоновая двойная в том же пикселе",
               "свет двойной разбавлен яркой звездой —\nглубина «как у планеты», ловится лишь по центроиду", "#c2410c"))

# 4. Вспышка
f = 1 + noise(0.0012)
for c, a in ((2.3, 0.025), (6.8, 0.04)):
    m = t >= c
    f[m] += a * np.exp(-(t[m] - c) / 0.08)
panels.append((f, "④ Звёздная вспышка",
               "резкий ВЗЛЁТ яркости с медленным спадом;\nв автоматике портит статистику соседних транзитов", "#a16207"))

# 5. Пятна и вращение
f = 1 + 0.012 * np.sin(2 * np.pi * t / 4.1) + 0.004 * np.sin(2 * np.pi * t / 2.05 + 1) + noise(0.0012)
panels.append((f, "⑤ Пятна и вращение звезды",
               "квазипериодические волны; фазы случайно\nскладываются в «провалы» нужной глубины", "#7c3aed"))

# 6. Систематика прибора
f = 1 + noise(0.0012)
f[t > 5.5] -= 0.006
f += -0.004 * np.exp(-((t - 3.2) ** 2) / 0.002)
panels.append((f, "⑥ Систематика прибора",
               "скачки чувствительности, сброс памяти,\nкосмические лучи — «событие» без астрофизики", "#334155"))

for ax, (f, title, sub, color) in zip(axes.flat, panels):
    ax.plot(t, f, lw=0.7, color=color)
    ax.set_title(title, fontsize=11.5, fontweight="bold", loc="left")
    ax.text(0.995, 0.03, sub, transform=ax.transAxes, fontsize=9, color="#475569",
            ha="right", va="bottom")
    ax.set_ylabel("поток")
    ax.grid(alpha=0.25)

for ax in axes[-1]:
    ax.set_xlabel("время, сутки")

fig.tight_layout(rect=(0, 0, 1, 0.965))
out = Path(__file__).parent.parent / "docs" / "confusion_examples.png"
fig.savefig(out)
print(f"OK -> {out}")
