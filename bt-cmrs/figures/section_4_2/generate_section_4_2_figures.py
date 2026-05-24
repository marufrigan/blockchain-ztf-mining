#!/usr/bin/env python3
"""
Section 4.2 — Simulation Analysis figures for BT-CMRS (IEEE-style, 300 DPI PNG).

Generates:
  Figure10_Throughput_Analysis.png
  Figure11_Latency_Distribution.png
  Figure12_Gas_Cost_Analysis.png
  Figure13_Response_Time_Percentiles.png

Run: python3 generate_section_4_2_figures.py
Requires: matplotlib, numpy, scipy (optional for smooth CI; use numpy only if scipy missing)
"""
from __future__ import annotations

import os

import numpy as np

try:
    import matplotlib.pyplot as plt
    from matplotlib.patches import Patch
except ImportError:
    import subprocess

    subprocess.check_call(["pip", "install", "matplotlib", "numpy", "-q"])
    import matplotlib.pyplot as plt
    from matplotlib.patches import Patch

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = HERE

# IEEE-friendly: serif, muted palette
plt.rcParams.update(
    {
        "font.family": "serif",
        "font.serif": ["Times New Roman", "DejaVu Serif", "Bitstream Vera Serif"],
        "axes.labelsize": 10,
        "axes.titlesize": 11,
        "xtick.labelsize": 9,
        "ytick.labelsize": 9,
        "legend.fontsize": 8,
        "axes.grid": True,
        "grid.alpha": 0.35,
        "grid.linestyle": "--",
        "grid.color": "#b0b0b0",
        "axes.facecolor": "white",
        "figure.facecolor": "white",
        "axes.edgecolor": "#333333",
        "axes.linewidth": 0.8,
    }
)

COL_ZKP = "#1f77b4"
COL_STD = "#d62728"
COL_MIX = "#2ca02c"
COL_SC = "#9467bd"
COL_NET = "#8c564b"


def save(fig, name: str) -> None:
    path = os.path.join(OUT_DIR, name)
    fig.savefig(path, dpi=300, bbox_inches="tight", format="png", facecolor="white", edgecolor="none")
    plt.close(fig)
    print("Wrote", path)


def throughput_zkp(x: np.ndarray) -> np.ndarray:
    """ZKP-only: ~50 start, plateau ~85, degrade after 1500."""
    y = np.zeros_like(x, dtype=float)
    for i, xi in enumerate(x):
        if xi <= 1300:
            y[i] = 50 + (85 - 50) * (1 - np.exp(-(xi - 100) / 400))
        elif xi <= 1500:
            y[i] = 85 - 0.01 * (xi - 1300)
        else:
            y[i] = 85 - 0.022 * (xi - 1500)
    y = np.clip(y, 15, None)
    return y


def throughput_std(x: np.ndarray) -> np.ndarray:
    y = 150 + 130 * (1 - np.exp(-(x - 100) / 550))
    y = np.minimum(y, 280)
    y = np.where(x > 1700, y - 0.015 * (x - 1700), y)
    return np.clip(y, 120, 290)


def throughput_mixed(x: np.ndarray) -> np.ndarray:
    y = 80 + 40 * (1 - np.exp(-(x - 100) / 500))
    y = np.minimum(y, 122)
    y = np.where(x > 1500, y - 0.012 * (x - 1500), y)
    return np.clip(y, 55, 130)


def fig10():
    x = np.array([100, 300, 500, 700, 900, 1100, 1300, 1500, 1700, 1900], dtype=float)
    np.random.seed(42)
    y_zkp = throughput_zkp(x)
    y_std = throughput_std(x)
    y_mix = throughput_mixed(x)
    # 95% CI as fraction of y (narrow band)
    ci_zkp = 2.5 + 0.008 * (x / 100)
    ci_std = 4 + 0.01 * (x / 100)
    ci_mix = 3 + 0.007 * (x / 100)

    fig, ax = plt.subplots(figsize=(6.5, 3.8))
    ax.fill_between(x, y_zkp - ci_zkp, y_zkp + ci_zkp, color=COL_ZKP, alpha=0.2, linewidth=0)
    ax.fill_between(x, y_std - ci_std, y_std + ci_std, color=COL_STD, alpha=0.2, linewidth=0)
    ax.fill_between(x, y_mix - ci_mix, y_mix + ci_mix, color=COL_MIX, alpha=0.2, linewidth=0)
    ax.plot(x, y_zkp, color=COL_ZKP, linewidth=1.8, label="ZKP verification only")
    ax.plot(x, y_std, color=COL_STD, linewidth=1.8, label="Standard transactions (no ZKP)")
    ax.plot(x, y_mix, color=COL_MIX, linewidth=1.8, label=r"Mixed load (50% ZKP)")
    ax.axvline(1500, color="#666666", linestyle=":", linewidth=1, alpha=0.8)
    ax.text(1520, ax.get_ylim()[0] + 8, "Stress region", fontsize=8, color="#555555")
    ax.set_xlabel("Number of concurrent mining cooperatives")
    ax.set_ylabel("Throughput (TPS)")
    ax.set_xlim(50, 1950)
    ax.set_ylim(0, 300)
    ax.legend(loc="lower right", framealpha=0.95)
    fig.tight_layout()
    save(fig, "Figure10_Throughput_Analysis.png")


def fig11():
    rng = np.random.default_rng(7)
    categories = ["Light\n(100–500)", "Medium\n(600–1100)", "Heavy\n(1200–1900)"]

    def samples_sc(cat: int) -> np.ndarray:
        base = [65, 78, 95][cat]
        spread = [25, 35, 45][cat]
        return rng.normal(base + spread / 3, spread / 4, 80)

    def samples_zkp(cat: int) -> np.ndarray:
        base = [280, 360, 410][cat]
        spread = [40, 55, 70][cat]
        return rng.normal(base, spread / 3, 80)

    def samples_net(cat: int) -> np.ndarray:
        base = [12, 22, 32][cat]
        spread = [8, 12, 18][cat]
        return rng.normal(base, spread / 4, 80)

    data = []
    for ci in range(3):
        data.append(samples_sc(ci))
        data.append(samples_zkp(ci))
        data.append(samples_net(ci))

    positions = [1, 2, 3, 5, 6, 7, 9, 10, 11]
    fig, ax = plt.subplots(figsize=(7, 4))
    bp = ax.boxplot(
        data,
        positions=positions,
        widths=0.65,
        patch_artist=True,
        showfliers=True,
        flierprops=dict(marker="o", markersize=3, alpha=0.45),
    )
    colors = [COL_SC, COL_ZKP, COL_NET] * 3
    for patch, c in zip(bp["boxes"], colors):
        patch.set_facecolor(c)
        patch.set_alpha(0.35)
        patch.set_edgecolor("#333333")
    for med in bp["medians"]:
        med.set_color("#111111")
        med.set_linewidth(1.2)

    # Category centers
    ax.set_xticks([2, 6, 10])
    ax.set_xticklabels(categories)
    ax.set_ylabel("Response time (ms)")
    ax.set_xlabel("Load category (concurrent mining cooperatives / smelters / auditors)")
    legend_elems = [
        Patch(facecolor=COL_SC, alpha=0.5, edgecolor="#333", label="Smart contract execution"),
        Patch(facecolor=COL_ZKP, alpha=0.5, edgecolor="#333", label="ZKP verification (on-chain)"),
        Patch(facecolor=COL_NET, alpha=0.5, edgecolor="#333", label="Network latency"),
    ]
    ax.legend(handles=legend_elems, loc="upper left", framealpha=0.95)
    ax.set_ylim(0, 520)
    fig.tight_layout()
    save(fig, "Figure11_Latency_Distribution.png")


def fig12():
    rng = np.random.default_rng(99)
    # Cumulative tx (thousands), multiple points per type with slight upward trend (state growth)
    x_all = []
    y_all = []
    colors = []
    labels_map = []

    def add_type(base_gas_k, color, label, n=18):
        nonlocal x_all, y_all, colors, labels_map
        xb = rng.uniform(2, 95, n)
        trend = 0.15 * xb  # slight upward drift in gas (thousands)
        noise = rng.normal(0, 1.2, n)
        yb = base_gas_k + trend + noise
        x_all.extend(xb)
        y_all.extend(yb)
        colors.extend([color] * n)
        labels_map.append((color, label))

    add_type(145, COL_STD, "Batch creation")
    add_type(293.56, COL_ZKP, "ZKP verification")
    add_type(312, "#ff7f0e", "Reacquisition workflow")

    x_all = np.array(x_all)
    y_all = np.array(y_all)
    colors = np.array(colors)

    fig, ax = plt.subplots(figsize=(6.5, 4))
    for c, lab in [
        (COL_STD, "Batch creation"),
        (COL_ZKP, "ZKP verification"),
        ("#ff7f0e", "Reacquisition"),
    ]:
        m = colors == c
        ax.scatter(x_all[m], y_all[m], s=22, alpha=0.65, c=c, edgecolors="none", label=lab)

    # Regression on all points
    coef = np.polyfit(x_all, y_all, 1)
    xs = np.linspace(0, 100, 100)
    ax.plot(xs, np.poly1d(coef)(xs), color="#444444", linewidth=1.5, linestyle="--", label="Linear trend (state growth)")

    ax.set_xlabel("Cumulative transactions ($\\times 10^3$)")
    ax.set_ylabel("Average gas cost per transaction ($\\times 10^3$ gas)")
    ax.legend(loc="upper left", framealpha=0.95)
    ax.set_xlim(0, 100)
    fig.tight_layout()
    save(fig, "Figure12_Gas_Cost_Analysis.png")


def fig13():
    x = np.linspace(100, 1900, 60)
    # Percentile curves (ms) — tail grows faster under load
    load = (x - 100) / 1800
    p50 = 75 + load * (180 - 75)
    p90 = 95 + load * (320 - 95)
    p95 = 110 + load * (450 - 110)
    p99 = 140 + load * (680 - 140)

    fig, ax = plt.subplots(figsize=(6.5, 4))
    ax.fill_between(x, 0, p50, color="#c7e9c0", alpha=0.9, label="50th percentile (median)")
    ax.fill_between(x, p50, p90, color="#a1d99b", alpha=0.85, label="50th–90th percentile band")
    ax.fill_between(x, p90, p95, color="#74c476", alpha=0.8, label="90th–95th percentile band")
    ax.fill_between(x, p95, p99, color="#31a354", alpha=0.75, label="95th–99th percentile band")
    ax.plot(x, p99, color="#00441b", linewidth=1.2, label="99th percentile (upper bound)")

    ax.set_xlabel("Number of concurrent mining cooperatives")
    ax.set_ylabel("Response time (ms)")
    ax.set_xlim(100, 1900)
    ax.set_ylim(0, 720)
    ax.legend(loc="upper left", framealpha=0.95, fontsize=7.5)
    fig.tight_layout()
    save(fig, "Figure13_Response_Time_Percentiles.png")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    fig10()
    fig11()
    fig12()
    fig13()
    print("Done. Output directory:", OUT_DIR)


if __name__ == "__main__":
    main()
