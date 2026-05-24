#!/usr/bin/env python3
"""
Render Springer-style table PNGs (Parameter | Result) for Tables 1–7.

Input:
  table/springer_tables_data.json

Output:
  table/Table1.png ... table/Table7.png

Run:
  python3 table/generate_springer_table_images.py
"""
from __future__ import annotations

import json
from pathlib import Path

try:
    import matplotlib.pyplot as plt
except ImportError:
    import subprocess

    subprocess.check_call(["pip", "install", "matplotlib", "-q"])
    import matplotlib.pyplot as plt

HERE = Path(__file__).resolve().parent


def save_table_png(title: str, rows: list[list[str]], out_name: str) -> None:
    headers = ["Parameter", "Result"]
    cell_text = [headers] + rows

    nrows = len(cell_text)
    row_h = 0.42
    fig_w = 15.0
    fig_h = max(4.0, 1.6 + nrows * row_h)

    fig, ax = plt.subplots(figsize=(fig_w, fig_h))
    ax.axis("off")
    ax.set_title(title, fontsize=12, fontweight="bold", pad=16, loc="left")

    tbl = ax.table(
        cellText=cell_text,
        loc="upper left",
        cellLoc="left",
        colWidths=[0.30, 0.70],
    )
    tbl.auto_set_font_size(False)
    tbl.set_fontsize(8.5)
    tbl.scale(1, 1.9)

    for (i, j), cell in tbl.get_celld().items():
        if i == 0:
            cell.set_facecolor("#EFEFEF")
            cell.set_text_props(fontweight="bold")
        cell.set_edgecolor("#C8C8C8")

    plt.tight_layout()
    out_path = HERE / out_name
    plt.savefig(out_path, dpi=300, bbox_inches="tight", facecolor="white", edgecolor="none")
    plt.close(fig)
    print("Wrote", out_path)


def main() -> None:
    data_path = HERE / "springer_tables_data.json"
    if not data_path.exists():
        raise SystemExit(
            "Missing table/springer_tables_data.json.\n"
            "Run (sequentially):\n"
            "  npx hardhat run scripts/13_exportSpringerTablesData.js --network localhost\n"
            "  python3 table/generate_springer_table_images.py\n"
            "Or one-command:\n"
            "  node scripts/14_generateSpringerTablePNGs.js"
        )

    payload = json.loads(data_path.read_text(encoding="utf-8"))
    tables = payload.get("tables", {})

    mapping = [
        ("table1", "Table1_Reacquisition_SCs_Deployment_Result_Analysis.png"),
        ("table2", "Table2_Consensus_and_Blockchain_Infrastructure_Analysis_for_BT-CMRS.png"),
        ("table3", "Table3_Smart_Contract_Execution_Details_in_the_BT-CMRS_Framework.png"),
        ("table4", "Table4_Gas_Cost_Summary_for_Deployment_and_ZKP_Execution_in_BT-CMRS.png"),
        ("table5", "Table5_ZKP_Verification_Transaction_Analysis_in_BT-CMRS.png"),
        ("table6", "Table6_Block-Level_Metrics_for_ZKP_Transactions_in_BT-CMRS.png"),
        ("table7", "Table7_Consensus_Mechanism_and_Network_Interaction_Metrics_in_BT-CMRS.png"),
    ]

    for key, out_name in mapping:
        t = tables.get(key)
        if not t:
            continue
        title = t.get("title", key)
        rows = t.get("rows", [])
        # ensure strings
        rows2 = [[str(a), str(b)] for a, b in rows]
        save_table_png(title, rows2, out_name)


if __name__ == "__main__":
    main()

