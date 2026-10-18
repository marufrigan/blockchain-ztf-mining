"""Renders event-log figures from the real receipts in results/E2_workflow_trace.json."""
import json, os, subprocess, sys, datetime
R, ABI, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
tr = json.load(open(os.path.join(R, "E2_workflow_trace.json")))
trace = tr["trace"]
abi = {}
for f in ABI.split(","):
    for it in json.load(open(f))["abi"]:
        if it.get("type") == "event":
            abi[it["name"]] = it
names = {}
for t in trace:
    if t["step"].startswith("Register"):
        for e in t["events"]:
            if e["name"] == "StakeholderRegistered":
                names[e["args"]["account"].lower()] = e["args"]["name"]
contracts = {}
for t in trace:
    for e in t["events"]:
        contracts[e["address"].lower()] = e["contract"]
MIN = ["TIN", "TUNGSTEN", "TANTALUM", "GOLD", "COBALT"]
ST = ["CREATED", "ZKP_VERIFIED", "IN_TRANSIT", "AT_SMELTER", "PROCESSED", "AT_MANUFACTURER", "COMPLETED",
      "REACQUISITION_REQUESTED", "REACQUIRED", "REJECTED", "AUDIT_REQUIRED"]
DEC = ["NONE", "APPROVED", "REJECTED", "AUDIT_REQUIRED"]
utc = lambda ts: datetime.datetime.fromtimestamp(int(ts), datetime.UTC).strftime("%Y-%m-%d %H:%M:%S UTC")

def fmt_val(name, typ, v):
    if typ == "uint8" and name == "mineralType": return f"{v} ({MIN[int(v)]})"
    if typ == "uint8" and name in ("oldStatus", "newStatus"): return f"{v} ({ST[int(v)]})"
    if typ == "uint8" and name == "decision": return f"{v} ({DEC[int(v)]})"
    if name == "timestamp": return f"{v} ({utc(v)})"
    if typ == "address":
        tag = names.get(v.lower()) or contracts.get(v.lower())
        return f"{v}" + (f" ({tag})" if tag else "")
    if typ == "string": return f'"{v}"'
    if typ == "bool": return "true" if v in (True, "true") else "false"
    if name == "verifierGasUsed": return f"{int(v):,} (gas consumed by RegionProofVerifier)"
    return str(v)

def receipt_lines(t):
    gl, gu = int(t["gasLimit"]), int(t["gasUsed"])
    price = int(t["effectiveGasPriceWei"]) / 1e9
    fee = int(t["feeWei"]) / 1e18
    L = []
    L.append(f"Transaction receipt   network: Hardhat local node (chainId {tr['environment']['chainId']}, hardfork {tr['environment']['hardfork']})")
    L.append(f"Tx hash        : {t['transactionHash']}")
    L.append(f"Status         : {t['status']}")
    L.append(f"Block          : {t['blockNumber']}    Timestamp: {utc(t['blockTimestamp'])}")
    L.append(f"From           : {t['from']} ({t['actorRole']}, {names.get(t['from'].lower(), '')})".replace(", )", ")"))
    L.append(f"To             : {t['to']} ({contracts.get(t['to'].lower(), '')})")
    L.append(f"Nonce          : {t['nonce']}")
    L.append(f"Gas limit/used : {gl:,} / {gu:,} ({100*gu/gl:.2f}% of limit)")
    L.append(f"Effective price: {price:.4f} gwei    Fee: {fee:.12f} ETH")
    return L

def event_lines(e):
    ev = abi[e["name"]]
    L = [ "-" * 100, f"Event log [{e['logIndex']}]  {e['signature']}", f"  Address  : {e['address']} ({e['contract']})",
          f"  topic[0] : {e['topics'][0]}  (event signature hash)"]
    idx = [i for i in ev["inputs"] if i["indexed"]]
    for k, inp in enumerate(idx, start=1):
        L.append(f"  topic[{k}] : {e['topics'][k]}  ({inp['name']})")
    non = [i for i in ev["inputs"] if not i["indexed"]]
    w = max(len(i["name"]) for i in non) if non else 0
    for k, inp in enumerate(non):
        pre = "  data     : " if k == 0 else "             "
        L.append(f"{pre}{inp['name'].ljust(w)} = {fmt_val(inp['name'], inp['type'], e['args'][inp['name']])}")
    return L

def render(name, panels):
    body = []
    for title, t in panels:
        lines = receipt_lines(t)
        for e in t["events"]:
            lines += event_lines(e)
        txt = "\n".join(lines)
        body.append((title, txt))
    tex = [r"\documentclass[border=3pt]{standalone}", r"\usepackage{fontspec}", r"\setmonofont{DejaVu Sans Mono}[Scale=0.92]", r"\setmainfont{Liberation Sans}",
           r"\usepackage{fancyvrb}", r"\usepackage{xcolor}", r"\begin{document}", r"\begin{minipage}{13.6cm}"]
    for i, (title, txt) in enumerate(body):
        if title:
            tex.append(r"{\footnotesize\bfseries " + title + r"}\par\vspace{2pt}")
        tex.append(r"\begin{Verbatim}[frame=single,framerule=0.6pt,framesep=4pt,fontsize=\fontsize{6.6}{7.9}\selectfont,rulecolor=\color{black}]")
        tex.append(txt)
        tex.append(r"\end{Verbatim}")
        if i < len(body) - 1: tex.append(r"\vspace{4pt}")
    tex += [r"\end{minipage}", r"\end{document}"]
    open(os.path.join(OUT, name + ".tex"), "w").write("\n".join(tex))
    subprocess.run(["xelatex", "-interaction=nonstopmode", name + ".tex"], cwd=OUT, stdout=subprocess.DEVNULL)
    subprocess.run(["pdftoppm", "-png", "-r", "600", "-singlefile", name + ".pdf", name], cwd=OUT)
    print("wrote", name)

step = {t["step"]: t for t in trace}
render("Figure6_event_log_batch_creation", [("", step["Batch creation"])])
render("Figure7_event_log_zkp_verification", [("", step["Region-based ZKP verification"])])
render("Figure8_event_log_lifecycle_update", [("", step["Lifecycle: at smelter"])])
render("Figure9_event_log_reacquisition", [("(a) Reacquisition request (manufacturer)", step["Reacquisition request"]),
                                          ("(b) Reacquisition resolution (auditor, Eq. (15))", step["Reacquisition resolution"])])
