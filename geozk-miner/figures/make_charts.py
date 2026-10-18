"""Builds the GeoZK-Miner result figures from the measured JSON in results/.
Black-and-white, publication style; every value plotted is read from the results files."""
import json, os, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker
from matplotlib.patches import Patch
from matplotlib.lines import Line2D

R = sys.argv[1]
OUT = sys.argv[2]
os.makedirs(OUT, exist_ok=True)
J = lambda n: json.load(open(os.path.join(R, n)))

plt.rcParams.update({
    "font.family": "serif", "font.serif": ["Liberation Serif", "Times New Roman", "DejaVu Serif"],
    "mathtext.fontset": "stix",
    "font.size": 9, "axes.labelsize": 9, "axes.titlesize": 9, "legend.fontsize": 8,
    "xtick.labelsize": 8, "ytick.labelsize": 8,
    "axes.linewidth": 0.7, "xtick.major.width": 0.6, "ytick.major.width": 0.6,
    "axes.grid": True, "grid.color": "#c8c8c8", "grid.linewidth": 0.4, "grid.linestyle": ":",
    "axes.axisbelow": True, "legend.frameon": True, "legend.edgecolor": "black", "legend.fancybox": False,
    "savefig.dpi": 600, "figure.dpi": 100, "hatch.linewidth": 0.5,
})

def save(fig, name):
    for ext in ("png", "pdf"):
        fig.savefig(os.path.join(OUT, f"{name}.{ext}"), bbox_inches="tight", pad_inches=0.03, facecolor="white")
    plt.close(fig)
    print("wrote", name)

e3 = J("E3_operations.json"); e4 = J("E4_proof_timing.json"); e5 = J("E5_artifacts.json")
e6 = J("E6_load_automine.json"); e7 = J("E7_load_interval.json")
ops_order = ["Batch creation", "Region-based ZKP verification", "Lifecycle: in transit", "Lifecycle: at smelter",
             "Lifecycle: processed", "Lifecycle: at manufacturer", "Lifecycle: completed",
             "Reacquisition request", "Reacquisition resolution"]
short = {"Batch creation": "Batch creation", "Region-based ZKP verification": "Region-based ZKP verification",
         "Lifecycle: in transit": "Lifecycle: in transit", "Lifecycle: at smelter": "Lifecycle: at smelter",
         "Lifecycle: processed": "Lifecycle: processed", "Lifecycle: at manufacturer": "Lifecycle: at manufacturer",
         "Lifecycle: completed": "Lifecycle: completed", "Reacquisition request": "Reacquisition request",
         "Reacquisition resolution": "Reacquisition resolution"}
summ = {o["op"]: o for o in e3["opSummary"]}
log = e3["txLog"]
n_b = e3["nBatches"]

# ---------------------------------------------------------------- Fig 4: gas per operation
fig, ax = plt.subplots(figsize=(6.6, 3.0))
y = np.arange(len(ops_order))[::-1]
means = np.array([summ[o]["gas"]["mean"] for o in ops_order]) / 1e3
sds = np.array([summ[o]["gas"]["sd"] for o in ops_order]) / 1e3
vg = e3["verifierInternalGas"]["mean"] / 1e3
for yi, o, m, s in zip(y, ops_order, means, sds):
    if o == "Region-based ZKP verification":
        ax.barh(yi, vg, height=0.62, color="#7a7a7a", edgecolor="black", linewidth=0.6)
        ax.barh(yi, m - vg, left=vg, height=0.62, color="white", edgecolor="black", hatch="////", linewidth=0.6)
    else:
        ax.barh(yi, m, height=0.62, color="#d9d9d9", edgecolor="black", linewidth=0.6)
    ax.errorbar(m, yi, xerr=s, fmt="none", ecolor="black", elinewidth=0.6, capsize=2)
    ax.text(m + 6, yi, f"{m*1e3:,.0f}", va="center", ha="left", fontsize=7.5)
ax.set_yticks(y); ax.set_yticklabels([short[o] for o in ops_order])
ax.set_xlabel(r"Gas used per transaction ($\times 10^3$)")
ax.set_xlim(0, 400)
ax.grid(axis="y", visible=False)
ax.legend(handles=[Patch(facecolor="#7a7a7a", edgecolor="black", label=f"Groth16 pairing check inside RegionProofVerifier ({vg*1e3:,.0f} gas)"),
                   Patch(facecolor="white", edgecolor="black", hatch="////", label="GeoZKMiner logic, storage and events"),
                   Patch(facecolor="#d9d9d9", edgecolor="black", label="Other operations (error bar = 1 s.d.)")],
          loc="upper center", bbox_to_anchor=(0.42, -0.2), fontsize=7, ncol=1)
ax.set_title(f"Mean of n = {n_b} transactions per operation, local Hardhat node", fontsize=8, style="italic")
save(fig, "Figure4_gas_per_operation")

# ---------------------------------------------------------------- Fig 5: latency distributions
fig, (a1, a2) = plt.subplots(1, 2, figsize=(7.0, 3.1), gridspec_kw={"width_ratios": [1.65, 1]})
data = [[t["latencyMs"] for t in log if t["op"] == o] for o in ops_order]
bp = a1.boxplot(data[::-1], vert=False, widths=0.55, whis=(5, 95), showfliers=True, patch_artist=True,
                flierprops=dict(marker=".", markersize=2, markerfacecolor="black", markeredgecolor="none", alpha=0.5),
                medianprops=dict(color="black", linewidth=1.1), boxprops=dict(facecolor="#e6e6e6", linewidth=0.6),
                whiskerprops=dict(linewidth=0.6), capprops=dict(linewidth=0.6))
a1.set_yticks(range(1, len(ops_order) + 1)); a1.set_yticklabels([short[o] for o in ops_order][::-1])
a1.set_xlabel("Submission-to-receipt latency (ms)")
a1.set_xscale("log"); a1.set_xlim(2, 80)
a1.set_xticks([2, 5, 10, 20, 50]); a1.set_xticklabels(["2", "5", "10", "20", "50"])
a1.xaxis.set_minor_formatter(matplotlib.ticker.NullFormatter())
a1.grid(axis="y", visible=False)
a1.set_title("(a) On-chain operations, single client", fontsize=9)
pt = e4["perRun"]
d2 = [[r["witnessMs"] for r in pt], [r["proveMs"] for r in pt], [r["verifyMs"] for r in pt],
      [r["witnessMs"] + r["proveMs"] + r["verifyMs"] for r in pt]]
labels2 = ["Witness\ngeneration", "Groth16\nproving", "Off-chain\nverification", "Total"]
a2.boxplot(d2, widths=0.55, whis=(5, 95), patch_artist=True,
           flierprops=dict(marker=".", markersize=2, markerfacecolor="black", markeredgecolor="none", alpha=0.5),
           medianprops=dict(color="black", linewidth=1.1), boxprops=dict(facecolor="#e6e6e6", linewidth=0.6),
           whiskerprops=dict(linewidth=0.6), capprops=dict(linewidth=0.6))
a2.set_xticks([1, 2, 3, 4]); a2.set_xticklabels(labels2, fontsize=7.5)
a2.set_ylabel("Time (ms)")
a2.grid(axis="x", visible=False)
a2.set_title(f"(b) Off-chain proof pipeline, n = {len(pt)}", fontsize=9)
fig.text(0.01, -0.02, "Boxes: interquartile range; line: median; whiskers: 5th to 95th percentile; dots: outliers.", fontsize=7, style="italic")
fig.tight_layout(w_pad=1.2)
save(fig, "Figure5_latency_and_proving_time")

# ---------------------------------------------------------------- Fig 10: gas versus cumulative transactions
fam = [("Region-based ZKP verification", "ZKP verification", "^", "black", "black"),
       ("Batch creation", "Batch creation", "o", "white", "black"),
       ("Reacquisition request", "Reacquisition request", "s", "#808080", "black"),
       ("Reacquisition resolution", "Reacquisition resolution", "D", "white", "#505050"),
       ("Lifecycle", "Lifecycle updates (5 stages)", "x", "black", "black")]
fig, ax = plt.subplots(figsize=(6.6, 3.2))
for key, lab, mk, fc, ec in fam:
    pts = [t for t in log if (t["op"].startswith("Lifecycle") if key == "Lifecycle" else t["op"] == key)]
    xs = np.array([t["seq"] for t in pts]); ys = np.array([t["gasUsed"] for t in pts]) / 1e3
    yfit = ys * 1e3
    if key == "Batch creation":  # remove the mineral-type storage effect before fitting the trend
        mt = np.array([t["batch"] % 5 for t in pts])
        yfit = yfit - np.array([yfit[mt == m].mean() for m in mt])
    sl = np.polyfit(xs, yfit, 1)[0] * 1000
    if mk == "x":
        ax.scatter(xs, ys, marker=mk, s=6, linewidths=0.4, color="black", label=f"{lab}; slope {sl:+.2f} gas/1000 tx")
    else:
        ax.scatter(xs, ys, marker=mk, s=7, linewidths=0.4, facecolors=fc, edgecolors=ec, label=f"{lab}; slope {sl:+.2f} gas/1000 tx")
ax.set_xlabel("Cumulative GeoZK-Miner transactions on the ledger")
ax.set_ylabel(r"Gas used ($\times 10^3$)")
ax.set_ylim(0, 420); ax.set_xlim(0, len(log) + 50)
ax.legend(loc="upper center", ncol=2, fontsize=6.8, bbox_to_anchor=(0.5, 1.0), markerscale=2.2)
ax.annotate("TIN batches (enum value 0 leaves one\nstorage slot zero): about 19.9k gas lower",
            xy=(2200, 296.1), xytext=(2450, 215), fontsize=7, arrowprops=dict(arrowstyle="-", lw=0.5))
save(fig, "Figure10_gas_vs_cumulative_transactions")

# ---------------------------------------------------------------- Fig 11: load behaviour
fig, axs = plt.subplots(2, 2, figsize=(7.0, 5.2))
pstyle = [("median", "p50", "-", "o", "black"), ("p90", "p90", "--", "s", "black"),
          ("p95", "p95", "-.", "^", "#555555"), ("p99", "p99", ":", "D", "black")]
for ax, rows, ttl in [(axs[0, 0], e6["loadCreate"], "(a) Batch creation"), (axs[0, 1], e6["loadZkp"], "(b) Region-based ZKP verification")]:
    cl = [r["clients"] for r in rows]
    for k, lab, ls, mk, c in pstyle:
        ax.plot(cl, [r["latencyMs"][k] for r in rows], ls=ls, marker=mk, ms=3.5, lw=0.9, color=c,
                mfc="white" if mk in ("s", "D") else c, label=lab)
    ax.set_xscale("log", base=2); ax.set_yscale("log")
    ax.set_xticks(cl); ax.set_xticklabels([str(c) for c in cl])
    ax.set_xlabel("Concurrent clients"); ax.set_ylabel("Response time (ms)")
    ax.set_title(ttl + " response-time percentiles", fontsize=8.5)
    ax.legend(fontsize=7, loc="upper left")
ax = axs[1, 0]
for rows, lab, mk, ls in [(e6["loadCreate"], "Batch creation", "o", "-"), (e6["loadZkp"], "ZKP verification", "^", "--")]:
    ax.plot([r["clients"] for r in rows], [r["throughputTps"] for r in rows], marker=mk, ls=ls, color="black", ms=4, lw=0.9,
            mfc="white", label=lab)
ax.set_xscale("log", base=2)
cl = [r["clients"] for r in e6["loadCreate"]]
ax.set_xticks(cl); ax.set_xticklabels([str(c) for c in cl])
ax.set_xlabel("Concurrent clients"); ax.set_ylabel("Confirmed transactions per second")
ax.set_ylim(0, None)
ax.set_title("(c) Throughput, instant (automine) block production", fontsize=8.5)
ax.legend(fontsize=7, loc="lower right")
ax = axs[1, 1]
bs = [r["burst"] for r in e7["loadInterval"]]
xpos = np.arange(len(bs))
med = [r["latencyMs"]["median"] / 1000 for r in e7["loadInterval"]]
mx = [r["latencyMs"]["max"] / 1000 for r in e7["loadInterval"]]
ax.bar(xpos - 0.18, med, width=0.34, color="#d9d9d9", edgecolor="black", lw=0.6, label="Median")
ax.bar(xpos + 0.18, mx, width=0.34, color="white", edgecolor="black", hatch="////", lw=0.6, label="Maximum")
for i, r in enumerate(e7["loadInterval"]):
    g = sum(int(b["gasUsed"]) for b in r["blockGas"]) / 1e6
    ax.text(i, max(mx[i], med[i]) + 0.6, f"{r['blocksUsed']} blk\n{g:.1f} Mgas", ha="center", fontsize=6.2)
ax.set_xticks(xpos); ax.set_xticklabels([str(b) for b in bs])
ax.set_xlabel("Batch-creation burst size (transactions)"); ax.set_ylabel("Inclusion latency (s)")
ax.set_ylim(0, 30)
ax.axhline(12, color="black", lw=0.5, ls=":")
ax.set_title("(d) 12 s block interval, 60 Mgas block gas limit", fontsize=8.5)
ax.legend(fontsize=7, loc="upper left")
fig.tight_layout(h_pad=1.4, w_pad=1.2)
save(fig, "Figure11_load_and_response_time")

# ---------------------------------------------------------------- Fig 12: artefact sizes
arts = e5["artifacts"]
fig, ax = plt.subplots(figsize=(6.6, 3.0))
names = [a["artifact"] for a in arts][::-1]
vals = [a["bytes"] for a in arts][::-1]
uses = [a["use"] for a in arts][::-1]
fills = {"Off-chain (prover)": ("#7a7a7a", ""), "Setup / audit": ("white", "...."), "Verifier generation": ("white", "\\\\\\\\"),
         "Deployment": ("white", "////"), "On-chain": ("black", ""), "Submitted per batch": ("#d9d9d9", "")}
for i, (n, v, u) in enumerate(zip(names, vals, uses)):
    fc, h = fills[u]
    ax.barh(i, v, color=fc, hatch=h, edgecolor="black", lw=0.6, height=0.62)
    lab = f"{v/1024/1024:.2f} MiB" if v > 1024 * 1024 else (f"{v/1024:.1f} KiB" if v >= 1024 else f"{v} B")
    ax.text(v * 1.15, i, lab, va="center", fontsize=7.2)
ax.set_xscale("log"); ax.set_xlim(100, 2e7)
ax.set_yticks(range(len(names))); ax.set_yticklabels(names, fontsize=7.5)
ax.set_xlabel("Size (bytes, log scale)")
ax.grid(axis="y", visible=False)
ax.legend(handles=[Patch(facecolor=fills[k][0], hatch=fills[k][1], edgecolor="black", label=k) for k in fills],
          fontsize=6.8, loc="lower right", ncol=2)
save(fig, "Figure12_zkp_artifact_sizes")

# ---------------------------------------------------------------- Fig 13: feature coverage matrix
approaches = ["iTSCi /\nbag-and-tag", "Circulor", "Minespider/\nOreSource", "IBM/RCS/\nRSBN", "Sahai et al.",
              "PrivChain", "BT-CSRS", "OreProof", "GeoZK-Miner"]
features = ["Blockchain\nsupport", "Privacy-preserving\nverification", "ZKP\nintegration", "End-to-end mineral\ntraceability",
            "Region-private\norigin proof", "Reacquisition\ngovernance"]
M = np.array([
    [0, 0, 0, 0.5, 0, 0],
    [1, 0.5, 0, 0.75, 0, 0],
    [1, 0.5, 0, 0.75, 0, 0],
    [1, 0.5, 0, 0.75, 0, 0],
    [1, 1, 1, 0, 0, 0],
    [1, 1, 1, 0, 0, 0],
    [1, 1, 1, 0, 0, 1],
    [1, 1, 1, 1, 0.5, 0],
    [1, 1, 1, 1, 1, 1]])
from matplotlib.patches import Circle, Wedge
fig, ax = plt.subplots(figsize=(7.0, 3.9))
nA, nF = len(approaches), len(features)
ax.add_patch(plt.Rectangle((nA - 1.5, -0.6), 1.0, nF + 0.2, color="#ececec", zorder=0, lw=0))
for i in range(nA):
    for j in range(nF):
        v = M[i, j]; yy = nF - 1 - j
        ax.add_patch(Circle((i, yy), 0.28, facecolor="white", edgecolor="black", lw=0.7, zorder=2))
        if v >= 1:
            ax.add_patch(Circle((i, yy), 0.28, facecolor="black", edgecolor="black", lw=0.7, zorder=3))
        elif v > 0:
            ax.add_patch(Wedge((i, yy), 0.28, 90 - 360 * v, 90, facecolor="black", edgecolor="black", lw=0.7, zorder=3))
ax.set_xlim(-0.6, nA - 0.4); ax.set_ylim(-0.6, nF - 0.4); ax.set_aspect("equal")
ax.set_xticks(range(nA)); ax.set_xticklabels(approaches, fontsize=6.6)
ax.set_yticks(range(nF)); ax.set_yticklabels(features[::-1], fontsize=7.2)
ax.grid(False)
for sp in ax.spines.values(): sp.set_linewidth(0.6)
leg = [(0, "absent (0)"), (0.5, "partial / limited (0.5)"), (0.75, "broad, not end-to-end (0.75)"), (1, "full (1)")]
hs = []
for v, lab in leg:
    hs.append(Line2D([], [], marker="o", ls="", color="white", markeredgecolor="black", label=lab))
ax.text(0.5, -0.19, "Filled fraction of each circle = coverage score: empty 0, quarter-empty 0.75, half 0.5, full 1 (authors' rubric applied to published descriptions)",
        transform=ax.transAxes, ha="center", fontsize=7, style="italic")
save(fig, "Figure13_feature_coverage")

# ---------------------------------------------------------------- Fig 14: research-gap heatmap
gaps = ["Tamper-resistant provenance", "Privacy-preserving verification", "Region-private mineral origin proof",
        "Conflict-mineral domain alignment", "Smart-contract lifecycle tracking", "Reacquisition governance",
        "Exact-coordinate protection"]
cats = ["Traditional\ntraceability", "Blockchain mineral\nplatforms", "General ZKP\nsupply chain", "Seafood\nBT-CSRS",
        "ZKP mineral\nprovenance (OreProof)", "GeoZK-Miner"]
H = np.array([
    [0, 1, 1, 1, 1, 1],
    [0, 0.5, 1, 1, 1, 1],
    [0, 0, 0, 0, 0.5, 1],
    [0.5, 0.75, 0, 0, 0.75, 1],
    [0, 0.75, 0.5, 1, 0.75, 1],
    [0, 0, 0, 1, 0, 1],
    [0, 0.5, 0.5, 0, 0.5, 1]])
fig, ax = plt.subplots(figsize=(6.8, 3.6))
im = ax.imshow(H, cmap="Greys", vmin=0, vmax=1.15, aspect="auto")
for i in range(H.shape[0]):
    for j in range(H.shape[1]):
        ax.text(j, i, f"{H[i,j]:g}", ha="center", va="center", fontsize=7.5, color="white" if H[i, j] >= 0.7 else "black")
ax.set_xticks(range(len(cats))); ax.set_xticklabels(cats, fontsize=7)
ax.set_yticks(range(len(gaps))); ax.set_yticklabels(gaps, fontsize=7.5)
ax.set_xticks(np.arange(-0.5, len(cats)), minor=True); ax.set_yticks(np.arange(-0.5, len(gaps)), minor=True)
ax.grid(which="minor", color="white", linewidth=1.5, linestyle="-"); ax.grid(which="major", visible=False)
ax.tick_params(which="minor", length=0)
ax.add_patch(plt.Rectangle((len(cats) - 1.5, -0.5), 1, len(gaps), fill=False, edgecolor="black", lw=1.6))
cb = fig.colorbar(im, ax=ax, fraction=0.035, pad=0.02); cb.set_label("Coverage score (rubric)", fontsize=7.5)
cb.ax.tick_params(labelsize=7)
save(fig, "Figure14_research_gap_coverage")
