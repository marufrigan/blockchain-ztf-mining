#!/usr/bin/env python3
"""Generate PNG table images (Parameter | Result) for Section 4 — paper-style detail.

Reads:
  - table/detailed_table_data.json (from scripts/11_exportDetailedTableMetrics.js)
  - docs/EVENT_LOGS.json
  - docs/PERFORMANCE_RESULTS.json

Run from repo:  python3 table/generate_table_images.py
"""
from __future__ import annotations

import json
import os
from collections import defaultdict
from pathlib import Path

try:
    import matplotlib.pyplot as plt
except ImportError:
    import subprocess

    subprocess.check_call(["pip", "install", "matplotlib", "-q"])
    import matplotlib.pyplot as plt

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def load_json(rel: str) -> dict | list:
    p = ROOT / rel
    if not p.exists():
        return {}
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def fmt_int(s: str | int | None) -> str:
    if s is None:
        return "—"
    try:
        n = int(s)
        return f"{n:,}"
    except (TypeError, ValueError):
        return str(s)


def save_pr_table(
    title: str,
    rows: list[tuple[str, str]],
    filename: str,
    fig_w: float = 14.0,
    fontsize: float = 7.5,
    header_param: str = "Parameter",
    header_result: str = "Result",
) -> None:
    headers = [header_param, header_result]
    cells = [headers] + [[a, b] for a, b in rows]
    nrows = len(cells)
    row_h = 0.38
    fig_h = max(3.5, 1.4 + nrows * row_h)
    fig, ax = plt.subplots(figsize=(fig_w, fig_h))
    ax.axis("off")
    ax.set_title(title, fontsize=11, fontweight="bold", pad=14, loc="left")

    table = ax.table(
        cellText=cells,
        loc="upper left",
        cellLoc="left",
        colWidths=[0.34, 0.66],
    )
    table.auto_set_font_size(False)
    table.set_fontsize(fontsize)
    table.scale(1, 1.85)

    for (i, j), cell in table.get_celld().items():
        if i == 0:
            cell.set_facecolor("#E8E8E8")
            cell.set_text_props(fontweight="bold")
        cell.set_edgecolor("#CCCCCC")

    plt.tight_layout()
    out = HERE / filename
    plt.savefig(out, dpi=200, bbox_inches="tight", facecolor="white", edgecolor="none")
    plt.close()
    print("Wrote", out)


def aggregate_events(events: list) -> dict[str, dict]:
    agg: dict[str, dict] = defaultdict(lambda: {"count": 0, "gas": [], "cost_eth": []})
    block_nums: set[int] = set()
    for e in events:
        name = e.get("event", "?")
        agg[name]["count"] += 1
        if e.get("gasUsed") is not None:
            agg[name]["gas"].append(int(e["gasUsed"]))
        gce = e.get("gasCostEth")
        if gce is not None:
            try:
                agg[name]["cost_eth"].append(float(gce))
            except (TypeError, ValueError):
                pass
        bn = e.get("blockNumber")
        if bn is not None:
            block_nums.add(int(bn))
    for v in agg.values():
        gs = v["gas"]
        v["avg_gas"] = int(sum(gs) / len(gs)) if gs else 0
        ce = v["cost_eth"]
        v["avg_cost_eth"] = sum(ce) / len(ce) if ce else 0.0
    return dict(agg), block_nums


def main() -> None:
    detail = load_json("table/detailed_table_data.json")
    events = load_json("docs/EVENT_LOGS.json")
    perf = load_json("docs/PERFORMANCE_RESULTS.json")

    if not isinstance(events, list):
        events = []

    agg, block_nums = aggregate_events(events)
    block_list = sorted(block_nums)
    block_range = (
        f"{block_list[0]} – {block_list[-1]}" if len(block_list) >= 2 else str(block_list[0] if block_list else "—")
    )

    contracts = detail.get("contracts") or load_json("data/deployed-addresses.json")
    ztx = detail.get("zkpTransaction") or {}
    zblk = detail.get("zkpBlock") or {}
    beacon = detail.get("beacon") or {}

    # --- Table 1: Deployment (addresses + metadata; not another paper’s tx hashes)
    c1: list[tuple[str, str]] = [
        ("StakeholderRegistry", contracts.get("registry", "—")),
        ("RegionProofVerifier", contracts.get("verifier", "—")),
        ("BTCMRS (registry + ZKP)", contracts.get("btcMrs", "—")),
        ("Deployer address", contracts.get("deployer", "—")),
        ("Network", f"{contracts.get('network', detail.get('network', '—'))} (chain ID {detail.get('chainId', '—')})"),
        ("Deployed at (UTC)", contracts.get("deployedAt", "—")),
        ("Deployment status", "Contracts deployed; verifier wired to Groth16 RegionProofVerifier"),
        (
            "Note",
            "Per-transaction deployment hashes: export from Hardhat deploy receipts or Etherscan on Sepolia.",
        ),
    ]
    save_pr_table(
        "Table 1: Reacquisition SCs Deployment Result Analysis (BT-CMRS)",
        c1,
        "Table1_Reacquisition_SCs_Deployment_Result_Analysis.png",
    )

    # --- Table 2: Infrastructure / consensus (local vs CL)
    c2: list[tuple[str, str]] = [
        ("Network name", str(detail.get("network", "—"))),
        ("Chain ID", str(detail.get("chainId", "—"))),
        ("Consensus (execution layer)", "Hardhat single-node; instant finality (no fork choice)"),
        ("Beacon / consensus layer", beacon.get("note", "N/A without CL API or testnet explorer export")),
        ("Event log block range", block_range),
        ("Unique blocks (with events)", str(len(block_nums))),
        ("Total on-chain events captured", str(len(events))),
        (
            "Avg events per block (observed)",
            f"{(len(events) / len(block_nums)):.2f}" if block_nums else "—",
        ),
    ]
    save_pr_table(
        "Table 2: Consensus and Blockchain Infrastructure Metrics (BT-CMRS)",
        c2,
        "Table2_Consensus_and_Blockchain_Infrastructure_Metrics.png",
    )

    # --- Table 3: Execution details by event type
    rows3: list[tuple[str, str]] = []
    for name in sorted(agg.keys()):
        a = agg[name]
        rows3.append(
            (
                name,
                f"Count: {a['count']}; Avg gas: {a['avg_gas']:,}; Avg tx fee (ETH): {a['avg_cost_eth']:.18f}",
            )
        )
    if not rows3:
        rows3 = [("—", "No EVENT_LOGS.json data")]
    save_pr_table(
        "Table 3: Smart Contract Execution Details (Event Aggregates)",
        rows3,
        "Table3_Smart_Contract_Execution_Details.png",
    )

    # --- Table 4: Gas cost analysis
    rows4: list[tuple[str, str]] = []
    for name in sorted(agg.keys()):
        a = agg[name]
        rows4.append(
            (
                name,
                f"Avg gas: {a['avg_gas']:,}; Avg cost (ETH): {a['avg_cost_eth']:.18f}",
            )
        )
    if not rows4:
        rows4 = [("—", "No EVENT_LOGS.json data")]
    save_pr_table(
        "Table 4: Gas Cost Analysis (per Event Type)",
        rows4,
        "Table4_Gas_Cost_Analysis.png",
    )

    # --- Table 5: Exemplar ZKP tx (first ZKPVerified in export)
    gas_lim = fmt_int(ztx.get("gasLimit"))
    gas_used = fmt_int(ztx.get("gasUsed"))
    pct = ztx.get("gasUsedPercentOfLimit", "—")
    gas_line = f"{gas_lim} and {gas_used} ({pct})" if gas_lim != "—" else "—"
    base_g = ztx.get("baseFeeGwei")
    max_g = ztx.get("maxFeePerGasGwei")
    prio_g = ztx.get("maxPriorityFeePerGasGwei")
    gas_fees = (
        f"Base: {base_g} Gwei, Max: {max_g} Gwei, Max Priority: {prio_g} Gwei"
        if base_g and max_g and prio_g
        else "—"
    )
    eff_gwei = ztx.get("gasPriceGwei")
    eff_eth = ztx.get("transactionFeeEth")
    gas_price_line = (
        f"{eff_gwei} Gwei ({eff_eth} ETH total fee)"
        if eff_gwei
        else "—"
    )
    c5: list[tuple[str, str]] = [
        ("Transaction Hash", ztx.get("transactionHash", "—")),
        ("Block Number", fmt_int(ztx.get("blockNumber"))),
        ("Block Hash", ztx.get("blockHash", "—")),
        ("Transaction Fee (ETH)", ztx.get("transactionFeeEth", "—")),
        ("Gas Price (effective)", gas_price_line),
        ("Gas Limit and Usage by Txn", gas_line),
        ("Gas Fees (EIP-1559)", gas_fees),
        ("Txn Type", ztx.get("typeLabel", "—")),
        ("Nonce", str(ztx.get("nonce", "—"))),
        ("Block Position (tx index)", str(ztx.get("transactionIndex", "—"))),
        ("From", ztx.get("from", "—")),
        ("To (BTCMRS)", ztx.get("to", "—")),
        ("Status", ztx.get("status", "—")),
    ]
    save_pr_table(
        "Table 5: ZKP Transaction Analysis (Exemplar ZKPVerified Transaction)",
        c5,
        "Table5_ZKP_Transaction_Analysis.png",
        fig_w=15.0,
    )

    # --- Table 6: Block-level metrics for ZKP block
    bhash = zblk.get("hash") or ztx.get("blockHash", "—")
    gas_used_b = fmt_int(zblk.get("gasUsed"))
    gas_lim_b = fmt_int(zblk.get("gasLimit"))
    pct_b = zblk.get("gasUsedPercentOfBlockLimit", "—")
    gas_block_line = f"{gas_used_b} ({pct_b} of block limit)" if gas_used_b != "—" else "—"
    raw_base = zblk.get("baseFeePerGas")
    base_fee_line = "—"
    if raw_base is not None and str(raw_base).strip().lstrip("-").isdigit():
        wei = int(str(raw_base))
        eth_part = wei / 1e18
        gwei_part = wei / 1e9
        base_fee_line = f"{eth_part:.18f} ETH ({gwei_part:.9f} Gwei)"

    c6: list[tuple[str, str]] = [
        ("Hash", bhash),
        ("Parent Hash", zblk.get("parentHash", "—")),
        ("StateRoot", zblk.get("stateRoot", "—")),
        ("ReceiptsRoot", zblk.get("receiptsRoot", "—")),
        ("WithdrawalsRoot", zblk.get("withdrawalsRoot", "—")),
        ("Block Number", fmt_int(zblk.get("number"))),
        ("Difficulty", zblk.get("difficulty", "—")),
        ("Total Difficulty", zblk.get("totalDifficulty") or "—"),
        ("Block gas limit", gas_lim_b),
        ("Gas Used (block)", gas_block_line),
        ("Base Fee Per Gas", base_fee_line),
        ("Burnt Fees (baseFee × block gasUsed)", zblk.get("burntFeesEth", "—")),
        ("Timestamp (unix)", str(zblk.get("timestamp", "—"))),
    ]
    save_pr_table(
        f"Table 6: Block-Level Metrics for Block {zblk.get('number', '—')} (ZKP Transaction Context)",
        c6,
        "Table6_Block_Level_Metrics_for_ZKP_Transactions.png",
        fig_w=15.0,
    )

    # --- Table 7: Consensus + interaction + perf
    c7: list[tuple[str, str]] = [
        ("Beacon Slot / Epoch / Proposer", "N/A on local Hardhat; populate via beacon API on Sepolia/Mainnet"),
        ("Slot root / Graffiti / RANDAO", beacon.get("note", "See consensus-layer export")),
        ("Execution chain ID", str(detail.get("chainId", "—"))),
        ("Observed event block range", block_range),
        ("Unique blocks with events", str(len(block_nums))),
        ("Total events", str(len(events))),
    ]
    tests = perf.get("tests") if isinstance(perf, dict) else []
    if isinstance(tests, list):
        for t in tests:
            name = t.get("name", "?")
            c7.append(
                (
                    f"Perf: {name} (TPS)",
                    f"{t.get('throughput', 0):.2f} (avg gas {t.get('avgGas', 0):,})",
                )
            )
    save_pr_table(
        "Table 7: Consensus Mechanisms and Interaction Metrics (BT-CMRS)",
        c7,
        "Table7_Consensus_Mechanisms_and_Interaction_Metrics.png",
        fig_w=15.0,
    )


if __name__ == "__main__":
    main()
