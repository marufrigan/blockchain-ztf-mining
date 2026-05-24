#!/usr/bin/env python3
"""
GeoZK-Miner — Extended evaluation charts (reads JSON from docs/).

Outputs (300 dpi PNG):
  - figures/fig_zkp_verification_gas_50_runs.png
  - figures/fig_zkp_verification_gas_summary.png
  - figures/fig_zkp_generation_timing.png
  - figures/fig_zkp_artifact_sizes.png
"""

from pathlib import Path
import json
import sys

import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
FIG = ROOT / "figures"

plt.rcParams.update(
    {
        "font.family": "serif",
        "font.size": 10,
        "axes.labelsize": 11,
        "axes.titlesize": 12,
        "figure.dpi": 150,
        "savefig.dpi": 300,
        "axes.grid": True,
        "grid.alpha": 0.28,
        "grid.linestyle": "--",
    }
)


def load_json(name):
    p = DOCS / name
    if not p.exists():
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def fig_gas_50_runs(data):
    runs = data.get("runs") or []
    if not runs:
        print("Skip Fig A: no runs in ZKP_VERIFICATION_50_RUNS.json", file=sys.stderr)
        return
    xs = [r["run"] for r in runs]
    ys = [r["gasUsed"] for r in runs]
    fig, ax = plt.subplots(figsize=(9, 4.5), constrained_layout=True)
    ax.plot(xs, ys, "o-", color="#2c5282", markersize=4, linewidth=1.2)
    ax.set_xlabel("Run number")
    ax.set_ylabel("Gas used")
    ax.set_title("ZKP Verification Gas Consumption Across 50 GeoZK-Miner Runs")
    fig.savefig(FIG / "fig_zkp_verification_gas_50_runs.png", bbox_inches="tight")
    plt.close(fig)


def fig_gas_summary(data):
    g = data.get("gas") or {}
    pairs = [
        ("Average", "average"),
        ("Min", "minimum"),
        ("Max", "maximum"),
        ("Median", "median"),
    ]
    labels = []
    vals = []
    for lab, k in pairs:
        if g.get(k) is not None:
            labels.append(lab)
            vals.append(float(g[k]))
    if not vals:
        print("Skip Fig B: incomplete gas summary", file=sys.stderr)
        return
    fig, ax = plt.subplots(figsize=(6.5, 4.2), constrained_layout=True)
    ax.bar(labels, vals, color="#3182ce", edgecolor="#1a202c", linewidth=0.6)
    ax.set_ylabel("Gas")
    ax.set_title("Summary Statistics of GeoZK-Miner ZKP Verification Gas Cost")
    fig.savefig(FIG / "fig_zkp_verification_gas_summary.png", bbox_inches="tight")
    plt.close(fig)


def fig_timing(timing):
    if not timing:
        print("Skip Fig C: missing ZKP_PROOF_GENERATION_TIMING.json", file=sys.stderr)
        return
    keys = [
        ("witnessGenerationMs", "Witness generation"),
        ("proofGenerationMs", "Proof generation"),
        ("offChainVerificationMs", "Off-chain verification"),
        ("totalMs", "Total"),
    ]
    labels = []
    avgs = []
    for k, lab in keys:
        block = timing.get(k)
        if not block or block.get("average") is None:
            continue
        labels.append(lab)
        avgs.append(float(block["average"]))
    if not avgs:
        return
    fig, ax = plt.subplots(figsize=(7.5, 4.2), constrained_layout=True)
    ax.bar(labels, avgs, color="#276749", edgecolor="#1a202c", linewidth=0.6)
    ax.set_ylabel("Average time (ms)")
    ax.set_title("Off-Chain ZKP Timing Breakdown in GeoZK-Miner")
    plt.setp(ax.get_xticklabels(), rotation=15, ha="right")
    fig.savefig(FIG / "fig_zkp_generation_timing.png", bbox_inches="tight")
    plt.close(fig)


def fig_artifacts(art):
    if not art or not art.get("artifacts"):
        print("Skip Fig D: missing ZKP_ARTIFACT_SIZE_ANALYSIS.json", file=sys.stderr)
        return
    def short_label(name):
        if "proof JSON" in name.lower():
            return "Proof JSON (sample)"
        if "public signals" in name.lower():
            return "Public signals JSON (sample)"
        if "verification_key" in name:
            return "Verification key JSON"
        if "zkey" in name.lower():
            return "Proving key (.zkey)"
        if "wasm" in name.lower():
            return "Witness WASM"
        if "r1cs" in name.lower():
            return "R1CS binary"
        if "RegionProofVerifier" in name:
            return "Verifier Solidity source"
        return name[:32]

    labels = []
    sizes = []
    for a in art["artifacts"]:
        sz = a.get("sizeBytes")
        if sz is None:
            continue
        labels.append(short_label(a["artifact"]))
        sizes.append(int(sz) / 1024.0)
    if not sizes:
        return
    fig, ax = plt.subplots(figsize=(8.5, 4.5), constrained_layout=True)
    ypos = np.arange(len(labels))
    ax.barh(ypos, sizes, color="#744210", edgecolor="#1a202c", linewidth=0.5)
    ax.set_yticks(ypos, labels)
    ax.invert_yaxis()
    ax.set_xlabel("Size (KB)")
    ax.set_title("ZKP Artifact Size Analysis for GeoZK-Miner")
    fig.savefig(FIG / "fig_zkp_artifact_sizes.png", bbox_inches="tight")
    plt.close(fig)


def main():
    FIG.mkdir(parents=True, exist_ok=True)
    zkp50 = load_json("ZKP_VERIFICATION_50_RUNS.json")
    timing = load_json("ZKP_PROOF_GENERATION_TIMING.json")
    art = load_json("ZKP_ARTIFACT_SIZE_ANALYSIS.json")
    if zkp50:
        fig_gas_50_runs(zkp50)
        fig_gas_summary(zkp50)
    if timing:
        fig_timing(timing)
    if art:
        fig_artifacts(art)
    print("GeoZK-Miner extended evaluation charts written under figures/ (see stdout for skips).")


if __name__ == "__main__":
    main()
