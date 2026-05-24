#!/usr/bin/env python3
"""
Generate Section 5 comparative figures for GeoZK-Miner (journal-style PNGs).

Outputs:
  - fig10_feature_coverage_geozk_miner.png
  - fig11_research_gap_coverage_geozk_miner.png

Requires: matplotlib, numpy
"""

from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np

# Publication-oriented defaults
plt.rcParams.update(
    {
        "font.family": "serif",
        "font.size": 10,
        "axes.labelsize": 11,
        "axes.titlesize": 12,
        "xtick.labelsize": 9,
        "ytick.labelsize": 9,
        "legend.fontsize": 9,
        "figure.dpi": 150,
        "savefig.dpi": 300,
        "axes.grid": True,
        "grid.alpha": 0.25,
        "grid.linestyle": "--",
    }
)

OUT_DIR = Path(__file__).resolve().parent


def figure_10_feature_coverage():
    """Fig. 10 — grouped bar chart (scores are author-assigned comparative rubric, 0–1)."""
    approaches = [
        "iTSCi /\nbag-and-tag",
        "Circulor",
        "Minespider /\nOreSource",
        "IBM / RCS /\nRSBN",
        "Sahai et al.",
        "PrivChain",
        "BT-CSRS",
        "GeoZK-Miner",
    ]
    feature_labels = [
        "Blockchain\nsupport",
        "Privacy-preserving\nverification",
        "ZKP\nintegration",
        "End-to-end mineral\ntraceability",
        "Reacquisition\nautomation",
    ]
    # Rows: approaches; cols: features (user-supplied rubric)
    data = np.array(
        [
            [0, 0, 0, 0.5, 0],
            [1, 0.5, 0, 0.75, 0],
            [1, 0.5, 0, 0.75, 0],
            [1, 0.5, 0, 0.75, 0],
            [1, 1, 1, 0, 0],
            [1, 1, 1, 0, 0],
            [1, 1, 1, 0, 1],
            [1, 1, 1, 1, 1],
        ],
        dtype=float,
    )

    n_app, n_feat = data.shape
    x = np.arange(n_app, dtype=float)
    n_bars = n_feat
    total_width = 0.78
    bar_width = total_width / n_bars
    offsets = np.linspace(-(total_width / 2) + bar_width / 2, (total_width / 2) - bar_width / 2, n_bars)

    colors = ["#2c5282", "#3182ce", "#63b3ed", "#9ae6b4", "#276749"]
    edge_last = "#1a202c"
    lw_last = 1.4

    fig, ax = plt.subplots(figsize=(12.5, 5.8), constrained_layout=True)

    for j in range(n_feat):
        heights = data[:, j]
        xpos = x + offsets[j]
        bars = ax.bar(
            xpos,
            heights,
            width=bar_width * 0.92,
            label=feature_labels[j],
            color=colors[j % len(colors)],
            edgecolor="#1a202c",
            linewidth=0.35,
            zorder=3,
        )
        # Emphasize GeoZK-Miner column (last index)
        bars[-1].set_edgecolor(edge_last)
        bars[-1].set_linewidth(lw_last)

    ax.set_ylim(0, 1.12)
    ax.set_ylabel("Coverage score (0 = absent, 1 = full)")
    ax.set_title(
        "Fig. 10. Comparative feature coverage of existing traceability approaches and GeoZK-Miner"
    )
    ax.set_xticks(x)
    ax.set_xticklabels(approaches)
    ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.18), ncol=3, frameon=True, fancybox=False, edgecolor="#1a202c")
    ax.axhline(1.0, color="#718096", linewidth=0.8, linestyle=":", zorder=1)

    fig.savefig(OUT_DIR / "fig10_feature_coverage_geozk_miner.png", bbox_inches="tight")
    plt.close(fig)


def figure_11_research_gap_coverage():
    """Fig. 11 — heatmap of gap coverage by framework category (scores 0–1 rubric)."""
    gaps = [
        "Tamper-resistant provenance",
        "Privacy-preserving verification",
        "Region-private mineral origin proof",
        "Conflict mineral domain alignment",
        "Smart contract lifecycle tracking",
        "Reacquisition governance",
        "Exact coordinate protection",
    ]
    categories = [
        "Traditional\ntraceability",
        "Blockchain mineral\nplatforms",
        "General ZKP\nsupply-chain systems",
        "Seafood\nBT-CSRS",
        "GeoZK-Miner",
    ]
    # Rows: gaps; cols: categories (user-supplied)
    data = np.array(
        [
            [0, 1, 1, 1, 1],
            [0, 0.5, 1, 1, 1],
            [0, 0, 0, 0, 1],
            [0.5, 0.75, 0, 0, 1],
            [0, 0.75, 0.5, 1, 1],
            [0, 0, 0, 1, 1],
            [0, 0.5, 0.5, 0, 1],
        ],
        dtype=float,
    )

    fig_w, fig_h = 10.5, 6.2
    fig, ax = plt.subplots(figsize=(fig_w, fig_h), constrained_layout=True)

    im = ax.imshow(data, aspect="auto", cmap="Blues", vmin=0, vmax=1, origin="upper")

    ax.set_xticks(np.arange(len(categories)))
    ax.set_xticklabels(categories)
    ax.set_yticks(np.arange(len(gaps)))
    ax.set_yticklabels(gaps)

    # Rotate x labels slightly for readability
    for tick in ax.get_xticklabels():
        tick.set_rotation(18)
        tick.set_ha("right")

    # Annotate cells
    for i in range(data.shape[0]):
        for j in range(data.shape[1]):
            val = data[i, j]
            txt = "0" if val == 0 else ("1" if val == 1 else f"{val:g}")
            color = "white" if val > 0.55 else "#1a202c"
            ax.text(j, i, txt, ha="center", va="center", color=color, fontsize=10, fontweight="medium")

    ax.set_title(
        "Fig. 11. Research gap coverage comparison across traceability framework categories"
    )
    cbar = fig.colorbar(im, ax=ax, fraction=0.035, pad=0.02)
    cbar.set_label("Coverage score (rubric)")

    # Light frame around GeoZK-Miner column
    j_last = data.shape[1] - 1
    ax.add_patch(
        plt.Rectangle(
            (j_last - 0.5, -0.5),
            1,
            data.shape[0],
            fill=False,
            edgecolor="#c05621",
            linewidth=2.5,
        )
    )

    fig.savefig(OUT_DIR / "fig11_research_gap_coverage_geozk_miner.png", bbox_inches="tight")
    plt.close(fig)


def main():
    figure_10_feature_coverage()
    figure_11_research_gap_coverage()
    print(f"Wrote:\n  {OUT_DIR / 'fig10_feature_coverage_geozk_miner.png'}\n  {OUT_DIR / 'fig11_research_gap_coverage_geozk_miner.png'}")


if __name__ == "__main__":
    main()
