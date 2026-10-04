"""귀가 경로 엔진(web/src/route/) 독립 검증: 계약(데이터·확률·탐색 규칙)만으로 만든 Python 기준 구현과 대조한다.

실행:  python check_route.py              (요일 태그별 무작위 300쌍, seed 20261004)
       python check_route.py --pairs 50   (빠르게)
흐름:  ① web/public/data JSON으로 Python 기준값 계산
       ② 같은 질의를 node web/scripts/route_check.mjs 에 넘겨 JS 엔진 결과(JSON)를 받음
       ③ 항목별 일치율·|Δ| 분포·불일치 사례 출력. 상세는 output/route_check/report.json
판정 기준(하나라도 어기면 종료 코드 1):
  [0] 데이터: 시각이 거꾸로 가거나 직선거리 평균 속도가 30m/s를 넘는 연결 0개
  [1] 환승 확률: 엔진 = Python(|Δ| ≤ 1e-6), 엔진 vs prob_table p_success |Δ| ≤ 0.02(fallback 행은 따로 보고)
  [2] CSA: 가장 이른 도착, 출발 마감(leave_by.last), options 첫 열차 고정 도착 100% 일치
      (탑승 수·안전 출발 마감 leave_by.safe 차이는 동률 여정 선택 차이라 참고로만 출력)
  [3] 경로 확률: 엔진이 고른 여정에서 엔진 p_home = Python 재귀 값(|Δ| ≤ 1e-6)
  [4] 막차 조합(prob_table 여유 ≥ 0)으로 실제 경로가 있음
  [5] 실제 경로 몇 개를 시간표 CSV 원문과 대조(출력만), [6] planTrip 실행 시간(출력만)
"""
import argparse
import bisect
import json
import random
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

import common as c
from build_station_alt import haversine_m

BASE = Path(__file__).resolve().parent
DATA = BASE / "web" / "public" / "data"
NODE_SCRIPT = BASE / "web" / "scripts" / "route_check.mjs"
OUT_DIR = c.OUTPUT_DIR / "route_check"
TAGS = ("DAY", "SAT", "END")
MAX_DEPTH = 2            # 놓친 뒤 재탐색 깊이(계약 2장). 깊이 2 여정의 q는 0
MAX_SPEED = 30           # 연결 평균 속도(직선거리/시간) 상한 m/s. 정상 연결은 최대 26.5(1호선 급행), 넘으면 가짜 연결
TOL_TABLE = 0.02         # prob_table 대조 허용 오차(round_sec 반올림만큼)
TOL_SAME = 1e-6          # 같은 입력이면 엔진과 Python이 같아야 함
INF = 10 ** 9
SANITY = [("강남", "천호"), ("홍대입구", "노원"), ("서울역", "잠실"), ("사당", "수유")]


def hms(sec) -> str:
    if sec is None:
        return "-"
    sec = int(sec)
    return f"{sec // 3600:02d}:{sec % 3600 // 60:02d}:{sec % 60:02d}"


def load_json(name: str) -> dict:
    with open(DATA / f"{name}.json", encoding="utf-8") as f:
        return json.load(f)


# ── 1) 데이터: 노드·환승, 연결 목록, 지연 분포 ───────────────────

def load_network() -> dict:
    """walk[n] = {m: 도보 초}: 노드 n에서 내린 뒤 노드 m의 열차를 탈 때까지 걸리는 시간.
    자기 자신(n→n)은 같은 노드의 다른 열차(0초, same_line 자기 환승 행이 있으면 그 값). 같은 (from, to)가 여럿이면 최소."""
    net = load_json("network")
    walk = {i: {} for i in range(len(net["nodes"]))}
    for t in net["transfers"]:
        w = walk[t["from"]]
        w[t["to"]] = min(w.get(t["to"], INF), t["walk_sec"])
    for i, w in walk.items():
        w.setdefault(i, 0)
    return {"nodes": net["nodes"], "walk": walk,
            "station_nodes": {s["id"]: s["nodes"] for s in net["stations"]}}


def load_timetable(tag: str) -> dict:
    """연결 = 열차의 연속 정차쌍 (dep, arr, from, to, trip, i). dep = 앞 정차 출발, arr = 뒤 정차 도착(없으면 출발).
    출발 시각 오름차순 정렬(동률이면 도착 시각)."""
    raw = load_json(f"trips_{tag}")
    trips = raw["trips"]
    conns = []
    for ti, tr in enumerate(trips):
        s = tr["stops"]
        for i in range(len(s) - 1):
            dep = s[i][2] if s[i][2] is not None else s[i][1]
            arr = s[i + 1][1] if s[i + 1][1] is not None else s[i + 1][2]
            conns.append((dep, arr, s[i][0], s[i + 1][0], ti, i))
    conns.sort()
    return {"tag": tag, "trips": trips, "conns": conns, "deps": [x[0] for x in conns],
            "by_code": {(tr["line"], tr["code"]): ti for ti, tr in enumerate(trips)},
            "dropped": raw["meta"].get("dropped_time_reversed", [])}


def load_dists() -> dict:
    """route_dists.json의 표본을 numpy 배열(값, 가중치, 누적 가중치)로. 가중치는 소수 6자리 반올림이라 합으로 나눠 1로 맞춘다."""
    rd = load_json("route_dists")
    out = {"meta": rd["meta"], "cells": {}}
    for table in ("arr_cells", "arr_last3", "dep_last3", "dep_all"):
        for key, d in rd[table].items():
            s = np.array(d["samples"], dtype=float)
            w = s[:, 1] / s[:, 1].sum()
            out[(table, key)] = (s[:, 0], w, np.cumsum(w))
            if table == "arr_cells":
                out["cells"][key] = (d["line"], d["day_type"], d["hour_band"])
    return out


# ── 2) CSA: 가장 이른 도착(동률이면 탑승 수가 적은 여정, 그다음 여유가 큰 환승) ─────────

def csa(tt: dict, net: dict, origin_nodes, t0: int, home_nodes, first=None, max_rounds: int = 10):
    """라운드 k = 열차를 k번 이하로 타고 갈 수 있는 가장 이른 시각. 라운드마다 연결을 출발 시각순으로 한 번 훑는다.
    가장 이른 도착 T*에 처음 닿는 라운드의 여정이 '탑승 수가 가장 적은 최조 도착 여정'이다.
    한 라운드 안에서 같은 열차를 여러 정차에서 탈 수 있으면 여유(출발 − 탈 준비 시각 = 환승 B)가 가장 큰 정차에서 탄다
    (엔진 csa.js와 같은 동률 규칙. 먼저 닿는 정차를 고르면 되돌아오는 열차를 분기역 너머에서 갈아타 B가 작아진다).
    first=(trip, i): 그 열차를 i번째 정차에서 첫 열차로 고정(options·출발 마감 확인용)."""
    conns, walk, home = tt["conns"], net["walk"], set(home_nodes)
    ready = {} if first else {n: (t0, None) for n in origin_nodes}   # 노드 → (열차를 탈 수 있는 시각, 출처)
    readies, rounds = [ready], []
    start = bisect.bisect_left(tt["deps"], t0)
    best_t, best_k = INF, None
    for k in range(1, max_rounds + 1):
        new_ready, alight, boarded, slack = dict(ready), {}, {}, {}
        for x in range(start, len(conns)):
            dep, arr, u, v, ti, i = conns[x]
            if dep >= best_t:            # 이보다 늦게 떠나면 집에 더 빨리 닿을 수 없음
                break
            if first and k == 1:
                if (ti, i) == first:
                    boarded[ti], slack[ti] = i, INF
            elif u in ready and ready[u][0] <= dep and dep - ready[u][0] > slack.get(ti, -1):
                boarded[ti], slack[ti] = i, dep - ready[u][0]
            if ti not in boarded:
                continue
            if arr < alight.get(v, (INF,))[0]:
                alight[v] = (arr, ti, boarded[ti], i + 1)
                if v in home and arr < best_t:
                    best_t, best_k = arr, k
                for m, w in walk[v].items():
                    if arr + w < new_ready.get(m, (INF,))[0]:
                        new_ready[m] = (arr + w, (k, alight[v]))
        rounds.append(alight)
        if new_ready == ready:
            break
        ready = new_ready
        readies.append(ready)
    if best_k is None:
        return None
    # 되짚기: 집 노드의 도착 기록 → 탄 정차의 '탈 수 있는 시각' 출처 → 앞 열차의 도착 기록 …
    v = min((rec[0], n) for n, rec in rounds[best_k - 1].items() if n in home)[1]
    rec, k, rides = rounds[best_k - 1][v], best_k, []
    while True:
        _, ti, i, j = rec
        rides.append((ti, i, j))
        src = readies[k - 1].get(tt["trips"][ti]["stops"][i][0], (None, None))[1]
        if src is None:
            break
        k, rec = src
    return {"arrive": best_t, "rides": rides[::-1]}


def latest_departures(tt: dict, net: dict, home_nodes) -> dict:
    """역방향 스캔(출발 시각 내림차순): 연결마다 '타면 집에 닿는가'를 정한다.
    반환: 노드 → 그 노드에서 타서 집에 닿는 가장 늦은 출발 시각(= 시간표 기준 출발 마감)."""
    conns, walk, home = tt["conns"], net["walk"], set(home_nodes)
    latest, trip_ok = {}, set()
    for dep, arr, u, v, ti, i in reversed(conns):
        ok = (ti in trip_ok or v in home
              or any(latest.get(m, -1) >= arr + w for m, w in walk[v].items()))
        if ok:
            trip_ok.add(ti)
            latest[u] = max(latest.get(u, -1), dep)
    return latest


def origin_departures(tt: dict, origin_nodes, t0: int) -> list:
    """출발역 노드에서 t0 이후 떠나는 (출발 시각, trip, i) 목록, 늦은 순."""
    nodes = set(origin_nodes)
    out = [(dep, ti, i) for dep, _, u, _, ti, i in tt["conns"][bisect.bisect_left(tt["deps"], t0):] if u in nodes]
    return sorted(out, reverse=True)


# ── 3) 확률: 환승 하나(계약 2장) + 경로 재귀 ───────────────────────

def day_type_of(tag: str) -> str:
    return "weekday" if tag == "DAY" else "weekend"


def pick_a(dists: dict, line: str, day_type: str, flags: int, arr_a: int):
    """A 분포: 막차 대표성 노선(lastk_a_lines)이고 이 정차가 도착 기준 마지막 3편(flags&1)이면 arr_last3,
    아니면 시간표 도착 시각의 시간대(22시 전은 22)를 포함하는 셀."""
    if line in dists["meta"]["lastk_a_lines"] and flags & 1:
        return f"{line}|{day_type}|last3", dists[("arr_last3", f"{line}|{day_type}")]
    band = "22" if arr_a < 82800 else "23" if arr_a < 86400 else "24"
    for key, (l, d, hb) in dists["cells"].items():
        if l == line and d == day_type and band in dists["meta"]["band_members"][hb]:
            return key, dists[("arr_cells", key)]
    raise KeyError(f"A 셀 없음: {line}|{day_type}|{band}")


def pick_d(dists: dict, line: str, day_type: str, flags: int):
    """D 분포: 출발 기준 마지막 3편(flags&2)이면 dep_last3, 아니면 dep_all."""
    table = "dep_last3" if flags & 2 else "dep_all"
    return f"{table}:{line}|{day_type}", dists[(table, f"{line}|{day_type}")]


def transfer_p(a_dist, d_dist, b: float) -> float:
    """p = Σ_δ w_δ · F_A(B + δ), F_A(x) = Σ_{a ≤ x} w_a — 가중 표본으로 정확히 합한다."""
    a_val, _, a_cum = a_dist
    d_val, d_w, _ = d_dist
    idx = np.searchsorted(a_val, b + d_val, side="right")
    f = np.where(idx > 0, a_cum[np.maximum(idx - 1, 0)], 0.0)
    return float((d_w * f).sum())


def stop_time(stop, kind: str) -> int:
    """정차의 도착(kind='arr')·출발 시각. 없으면 다른 쪽."""
    a, d = stop[1], stop[2]
    return (a if a is not None else d) if kind == "arr" else (d if d is not None else a)


def journey_transfers(ctx: dict, tag: str, rides: list) -> list:
    """연속한 두 탑승 (A 내린 정차, D 탄 정차) 사이의 도보와 시간표 여유 B, 환승 확률 p."""
    tt, net, dists = ctx["tt"][tag], ctx["net"], ctx["dists"]
    out = []
    for (t1, _, j1), (t2, i2, _) in zip(rides, rides[1:]):
        ta, td = tt["trips"][t1], tt["trips"][t2]
        a, d = ta["stops"][j1], td["stops"][i2]
        arr_a, dep_d = stop_time(a, "arr"), stop_time(d, "dep")
        w = net["walk"][a[0]].get(d[0])
        tr = {"from_node": a[0], "to_node": d[0], "arr_A": arr_a, "dep_D": dep_d, "walk_sec": w}
        if w is None:                       # 환승 자료에 없는 갈아타기(엔진 여정 점검용)
            tr.update(buffer_sec=None, p=None)
        else:
            b = dep_d - arr_a - w
            ak, ad = pick_a(dists, ta["line"], day_type_of(tag), a[3], arr_a)
            dk, dd = pick_d(dists, td["line"], day_type_of(tag), d[3])
            tr.update(buffer_sec=b, a_dist_key=ak, d_dist_key=dk, p=transfer_p(ad, dd, b))
        out.append(tr)
    return out


def route_prob(ctx: dict, tag: str, rides: list, home: str, depth: int = 0):
    """P(route) = Π p_k + Σ_k (Π_{j<k} p_j)(1 − p_k)·q_k. q_k = D 노드에서 dep_D+1초에 다시 탐색한 최선 여정의 확률
    (깊이 MAX_DEPTH 여정의 q는 0)."""
    trs = journey_transfers(ctx, tag, rides)
    if any(t["p"] is None for t in trs):
        return None, trs
    total, alive = 0.0, 1.0
    for t in trs:
        t["q"] = best_prob(ctx, tag, t["to_node"], t["dep_D"] + 1, home, depth + 1) if depth < MAX_DEPTH else 0.0
        total += alive * (1 - t["p"]) * t["q"]
        alive *= t["p"]
    return total + alive, trs


def best_prob(ctx: dict, tag: str, node: int, t: int, home: str, depth: int) -> float:
    key = (tag, node, t, home, depth)
    if key not in ctx["memo"]:
        j = csa(ctx["tt"][tag], ctx["net"], [node], t, ctx["net"]["station_nodes"][home])
        ctx["memo"][key] = route_prob(ctx, tag, j["rides"], home, depth)[0] if j else 0.0
    return ctx["memo"][key]


# ── 4) 질의 만들기 ────────────────────────────────────────────────

def stop_index(tt: dict) -> dict:
    """(노드, 'arr'|'dep', 시각) → [(trip, i)]: prob_table 행의 A·D 정차를 찾는 색인."""
    idx = {}
    for ti, tr in enumerate(tt["trips"]):
        for i, s in enumerate(tr["stops"]):
            for kind, t in (("arr", s[1]), ("dep", s[2])):
                if t is not None:
                    idx.setdefault((s[0], kind, t), []).append((ti, i))
    return idx


def find_stop(ctx, tag, line, direction, station, kind, t):
    """prob_table 행의 역 이름(이수 등 표시 이름 포함)·노선·방향·시각으로 정차 하나를 찾는다."""
    tt = ctx["tt"][tag]
    for n, node in enumerate(ctx["net"]["nodes"]):
        if node["line"] == line and station in (node["nm"], node["station"]):
            for ti, i in ctx["sidx"][tag].get((n, kind, t), []):
                if tt["trips"][ti]["dir"] == direction:
                    return ti, i
    return None


def dropped_train(ctx, tag, line, direction, station, kind, t) -> list:
    """trips에서 정차를 못 찾았을 때: 원본 시간표에서 그 정차의 열차코드를 찾아, 시각이 거꾸로 가 데이터에서 뺀 열차인지 본다."""
    from preprocess import load_timetable as load_csv
    tt = load_csv(tag)
    col = "arr_sec" if kind == "arr" else "dep_sec"
    hit = tt[(tt["line"] == line) & (tt["방향"] == direction) & (tt[col] == t)
             & (tt["nm"].eq(station) | tt["nm"].replace({"이수": "총신대입구"}).eq(station))]
    return sorted({f"{line}:{x}" for x in hit["열차코드"]} & set(ctx["tt"][tag]["dropped"]))


def make_plan_queries(ctx: dict, n_pairs: int, seed: int) -> list:
    """태그별 무작위 (출발역, 집역, 22:00~24:30 분 단위 시각). seed 고정."""
    rng = random.Random(seed)
    stations = sorted(ctx["net"]["station_nodes"])
    qs = []
    for tag in TAGS:
        for _ in range(n_pairs):
            o, h = rng.sample(stations, 2)
            qs.append({"id": f"rnd{len(qs)}", "kind": "random", "tag": tag, "origin": o, "home": h,
                       "nowSec": 79200 + 60 * rng.randint(0, 150)})
    return qs


def table_queries(ctx: dict) -> tuple[list, list]:
    """prob_table 각 행 → (A 정차, D 정차, B) 환승 질의. 시간표 여유 ≥ 0 행은 '막차 조합으로 실제 경로가 있는가' 질의도 만든다:
    A의 앞 정차에서 A 출발 시각에 떠나 D의 다음 정차 역까지, D 다음 정차 도착 시각 안에 닿아야 한다."""
    rows = load_json("prob_table")["rows"]
    tq, pq = [], []
    for r in rows:
        tag = r["tt_tag"]
        a = find_stop(ctx, tag, r["from_line"], r["in_dir"], r["station"], "arr", r["arrive_sec"])
        d = find_stop(ctx, tag, r["to_line"], r["out_dir"], r["to_station"], "dep", r["depart_sec"])
        q = {"row": r, "tag": tag, "a": a, "d": d, "B": r["buffer_sec"], "dropped": []}
        if a is None:
            q["dropped"] += dropped_train(ctx, tag, r["from_line"], r["in_dir"], r["station"], "arr", r["arrive_sec"])
        if d is None:
            q["dropped"] += dropped_train(ctx, tag, r["to_line"], r["out_dir"], r["to_station"], "dep", r["depart_sec"])
        tq.append(q)
        if a is None or d is None or r["buffer_sec"] < 0 or a[1] == 0:
            continue
        trips, nodes = ctx["tt"][tag]["trips"], ctx["net"]["nodes"]
        prev, nxt = trips[a[0]]["stops"][a[1] - 1], trips[d[0]]["stops"][d[1] + 1]
        o, h = nodes[prev[0]]["station"], nodes[nxt[0]]["station"]
        if o != h:
            pq.append({"id": f"lc{len(pq)}", "kind": "lastcombo", "tag": tag, "origin": o, "home": h,
                       "nowSec": stop_time(prev, "dep"), "deadline": stop_time(nxt, "arr"),
                       "combo": f"{tag} {r['combo_id']}"})
    return tq, pq


def run_engine(ctx: dict, tq: list, plans: list) -> dict:
    """JS 엔진을 Node로 실행: 질의 JSON → 결과 JSON (web/scripts/route_check.mjs). 정차는 (노선, 열차코드, 정차 i)로 넘긴다."""
    def stop_ref(tag, ti_i):
        tr = ctx["tt"][tag]["trips"][ti_i[0]]
        return [tr["line"], tr["code"], ti_i[1]]

    payload = {
        "transfers": [None if q["a"] is None or q["d"] is None else
                      {"tag": q["tag"], "B": q["B"], "a": stop_ref(q["tag"], q["a"]), "d": stop_ref(q["tag"], q["d"])}
                      for q in tq],
        "plans": [{k: q[k] for k in ("id", "tag", "origin", "home", "nowSec")} for q in plans],
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    qpath, rpath = OUT_DIR / "queries.json", OUT_DIR / "engine.json"
    qpath.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    subprocess.run(["node", str(NODE_SCRIPT), str(qpath), str(rpath)], check=True, cwd=BASE)
    return json.loads(rpath.read_text(encoding="utf-8"))


# ── 5) 대조 ───────────────────────────────────────────────────────

def pct(xs, q) -> float:
    return float(np.quantile(np.asarray(xs, dtype=float), q)) if len(xs) else float("nan")


def check_data(ctx: dict, fails: list) -> None:
    """연결이 물리적으로 말이 되는지: 시각 역행(도착 < 출발), 직선거리로 본 평균 속도 MAX_SPEED 초과."""
    print("\n[0] 데이터 점검(연결 시각·속도)")
    nodes = ctx["net"]["nodes"]
    lat = np.array([n["lat"] for n in nodes])
    lon = np.array([n["lon"] for n in nodes])
    for tag in TAGS:
        cs = np.array([x[:4] for x in ctx["tt"][tag]["conns"]], dtype=float)
        dt = cs[:, 1] - cs[:, 0]
        u, v = cs[:, 2].astype(int), cs[:, 3].astype(int)
        speed = haversine_m(lat[u], lon[u], lat[v], lon[v]) / np.maximum(dt, 1)
        n_rev, n_fast = int((dt < 0).sum()), int((speed > MAX_SPEED).sum())
        print(f"  {tag}: 연결 {len(cs)}, 시각 역행 {n_rev}, {MAX_SPEED}m/s 초과 {n_fast} (최대 {speed.max():.1f}m/s),"
              f" 시각이 거꾸로 가 export에서 뺀 열차 {ctx['tt'][tag]['dropped']}")
        if n_rev or n_fast:
            fails.append(f"{tag} 가짜 연결 {n_rev + n_fast}개")


def check_table(ctx: dict, tq: list, eng: list, fails: list, report: dict) -> None:
    """prob_table 행: 엔진 vs Python(같아야 함), 엔진 vs p_success(≤ 0.02). 0.02 초과 행은 원인을 붙인다."""
    print("\n[1] 환승 확률 vs prob_table p_success")
    res = []
    for q, e in zip(tq, eng):
        r = q["row"]
        if q["a"] is None or q["d"] is None:
            res.append({"combo": f"{q['tag']} {r['combo_id']}", "dropped": q["dropped"],
                        "error": "A·D 정차를 시간표에서 못 찾음"})
            continue
        tt, dt = ctx["tt"][q["tag"]], r["day_type"]
        ta, td = tt["trips"][q["a"][0]], tt["trips"][q["d"][0]]
        sa, sd = ta["stops"][q["a"][1]], td["stops"][q["d"][1]]
        ak, ad = pick_a(ctx["dists"], ta["line"], dt, sa[3], r["arrive_sec"])
        dk, dd = pick_d(ctx["dists"], td["line"], dt, sd[3])
        p_py = transfer_p(ad, dd, q["B"])
        # prob_table이 쓴 분포(A = 행의 dist_key, D = 항상 dep_last3)로 다시 계산하면 차이가 선택 규칙 때문인지 알 수 있다
        tk = r["dist_key"]
        t_ad = ctx["dists"][("arr_last3", tk.rsplit("|", 1)[0])] if tk.endswith("|last3") else ctx["dists"][("arr_cells", tk)]
        p_rule = transfer_p(t_ad, ctx["dists"][("dep_last3", f"{td['line']}|{dt}")], q["B"])
        fb = bool(r["dep_fallback"] or r["arr_fallback"] or "first_order_fallback" in (r["ci_note"] or ""))
        res.append({"combo": f"{q['tag']} {r['combo_id']}", "fallback": fb, "B": q["B"], "p_success": r["p_success"],
                    "p_engine": e["p"], "p_python": p_py, "p_table_rule": p_rule,
                    "a_key": ak, "a_key_engine": e["a_dist_key"], "a_key_table": tk,
                    "d_key": dk, "d_key_engine": e["d_dist_key"]})
    ok = [x for x in res if "error" not in x]
    dropped = [x for x in res if "error" in x and x["dropped"]]
    missing = len(res) - len(ok) - len(dropped)
    d_ep = [abs(x["p_engine"] - x["p_python"]) for x in ok]
    key_diff = [x for x in ok if x["a_key"] != x["a_key_engine"] or x["d_key"] != x["d_key_engine"]]
    print(f"  행 {len(res)}: 비교 {len(ok)}, 시각이 깨져 데이터에서 뺀 열차를 A·D로 쓰는 행 {len(dropped)}"
          f" {sorted({t for x in dropped for t in x['dropped']})}(비교 제외), 그 밖에 못 찾음 {missing}")
    print(f"  엔진 vs Python 최대 |Δ| {max(d_ep):.2e}, 분포 키 불일치 {len(key_diff)}")
    if missing or max(d_ep) > TOL_SAME or key_diff:
        fails.append("환승 확률: 엔진 ≠ Python")
    for name, sub in (("주 비교(fallback 아님)", [x for x in ok if not x["fallback"]]),
                      ("fallback 행", [x for x in ok if x["fallback"]])):
        d = [abs(x["p_engine"] - x["p_success"]) for x in sub]
        over = [x for x in sub if abs(x["p_engine"] - x["p_success"]) > TOL_TABLE]
        print(f"  {name} {len(sub)}행: |엔진−p_success| 중앙 {pct(d, .5):.4f} · 95% {pct(d, .95):.4f} · 최대 {max(d):.4f}"
              f" · >{TOL_TABLE} {len(over)}행")
        for tag in TAGS:
            dt = [abs(x["p_engine"] - x["p_success"]) for x in sub if x["combo"].startswith(tag)]
            if dt:
                print(f"    {tag}: {len(dt)}행 95% {pct(dt, .95):.4f} 최대 {max(dt):.4f}")
        for x in over[:15]:
            why = []
            if x["a_key"] != x["a_key_table"]:
                why.append(f"A 분포 {x['a_key']} (표 {x['a_key_table']})")
            if not x["d_key"].startswith("dep_last3"):
                why.append(f"D 분포 {x['d_key']} (표 dep_last3)")
            print(f"    {x['combo']} B={x['B']} 엔진 {x['p_engine']:.4f} 표 {x['p_success']:.4f}"
                  f" 표 규칙 재계산 {x['p_table_rule']:.4f} ← {', '.join(why) or '원인 미상'}")
        if name.startswith("주") and over:
            fails.append(f"prob_table |Δ|>{TOL_TABLE} {len(over)}행")
    d_rule = [abs(x["p_table_rule"] - x["p_success"]) for x in ok]
    print(f"  참고: prob_table 선택 규칙으로 Python 재계산 시 |Δ| 최대 {max(d_rule):.4f}(반올림 오차만 남는지 확인)")
    report["table"] = res


def check_csa(ctx: dict, plans: list, eng: dict, fails: list, report: dict) -> None:
    """무작위 질의: 가장 이른 도착 시각, 상태(ok/no_route), 출발 마감(leave_by.last) 일치."""
    print("\n[2] CSA 가장 이른 도착 · 출발 마감")
    res, latest_cache = [], {}
    for q in plans:
        e, tt, net = eng[q["id"]], ctx["tt"][q["tag"]], ctx["net"]
        on, hn = net["station_nodes"][q["origin"]], net["station_nodes"][q["home"]]
        j = csa(tt, net, on, q["nowSec"], hn)
        key = (q["tag"], q["home"])
        if key not in latest_cache:
            latest_cache[key] = latest_departures(tt, net, hn)
        last = max([latest_cache[key].get(n, -1) for n in on])
        e_best = e.get("best")
        x = {"id": q["id"], "tag": q["tag"], "origin": q["origin"], "home": q["home"], "now": hms(q["nowSec"]),
             "py_arrive": j["arrive"] if j else None, "eng_arrive": e_best["arrive_sec"] if e_best else None,
             "py_rides": len(j["rides"]) if j else None,
             "eng_rides": sum(1 for l in e_best["legs"] if l["type"] == "ride") if e_best else None,
             "py_last": last if last >= q["nowSec"] else None,
             "eng_last": (e["leave_by"]["last"] or {}).get("depart_sec"),
             "status": e["status"]}
        res.append(x)
    for tag in TAGS:
        sub = [x for x in res if x["tag"] == tag]
        same_arr = sum(x["py_arrive"] == x["eng_arrive"] for x in sub)
        same_last = sum(x["py_last"] == x["eng_last"] for x in sub)
        same_rides = sum(x["py_rides"] == x["eng_rides"] for x in sub if x["py_arrive"] is not None)
        n_ok = sum(x["py_arrive"] is not None for x in sub)
        print(f"  {tag}: {len(sub)}쌍(경로 있음 {n_ok}) 도착 일치 {same_arr}/{len(sub)}, 출발 마감 일치 {same_last}/{len(sub)},"
              f" 탑승 수 일치 {same_rides}/{n_ok}")
    bad = [x for x in res if x["py_arrive"] != x["eng_arrive"] or x["py_last"] != x["eng_last"]]
    for x in bad[:15]:
        print(f"    불일치 {x['tag']} {x['origin']}→{x['home']} {x['now']}: 도착 Py {hms(x['py_arrive'])} / 엔진 {hms(x['eng_arrive'])},"
              f" 마감 Py {hms(x['py_last'])} / 엔진 {hms(x['eng_last'])}")
    if bad:
        fails.append(f"CSA 불일치 {len(bad)}쌍")
    more = [x for x in res if x["py_arrive"] == x["eng_arrive"] and x["py_rides"] is not None
            and x["eng_rides"] is not None and x["eng_rides"] > x["py_rides"]]
    if more:
        print(f"  참고: 도착은 같지만 엔진 best의 탑승 수가 더 많은 쌍 {len(more)}개(계약: '가능하면' 환승 적은 여정)")
    report["csa"] = res

    # options: 엔진 후보마다 같은 첫 열차를 고정해 Python으로 다시 찾은 도착 시각과 비교
    n = bad_arr = 0
    extra = []
    for q in plans:
        e = eng[q["id"]]
        if e["status"] != "ok":
            continue
        tt, hn = ctx["tt"][q["tag"]], ctx["net"]["station_nodes"][q["home"]]
        for o in e["options"]:
            rides = engine_rides(tt, o["journey"])
            j = csa(tt, ctx["net"], [], o["depart_sec"], hn, first=rides[0][:2])
            n += 1
            if j is None or j["arrive"] != o["arrive_sec"]:
                bad_arr += 1
            elif len(j["rides"]) < len(rides):
                extra.append(route_prob(ctx, q["tag"], j["rides"], q["home"])[0] - o["p_home"])
    print(f"  options {n}개(첫 열차 고정): 도착 일치 {n - bad_arr}/{n}, 엔진 쪽 탑승 수가 더 많은 후보 {len(extra)}개"
          + (f" (최소 탑승 여정 확률 − 엔진 확률: 평균 {np.mean(extra):+.4f}, 범위 {min(extra):+.4f}~{max(extra):+.4f})"
             if extra else ""))
    if bad_arr:
        fails.append(f"options 도착 불일치 {bad_arr}개")

    # 안전 출발 마감(p ≥ 0.8): 출발을 늦은 순으로 첫 열차 고정 → Python 재귀 확률. 같은 첫 열차로 같은 시각에 닿는 여정이
    # 여럿이면 엔진(중간 역에 가장 일찍 닿는 쪽)과 Python(탑승 수 적은 쪽)이 다른 여정을 골라 확률이 다를 수 있다.
    same, diff = 0, []
    for q in plans:
        e = eng[q["id"]]
        if e["status"] != "ok":
            continue
        tt, net = ctx["tt"][q["tag"]], ctx["net"]
        safe = None
        for dep, ti, i in origin_departures(tt, net["station_nodes"][q["origin"]], q["nowSec"]):
            j = csa(tt, net, [], dep, net["station_nodes"][q["home"]], first=(ti, i))
            if j and route_prob(ctx, q["tag"], j["rides"], q["home"])[0] >= 0.8:
                safe = dep
                break
        e_safe = (e["leave_by"]["safe"] or {}).get("depart_sec")
        same += e_safe == safe
        if e_safe != safe:
            diff.append(f"{q['tag']} {q['origin']}→{q['home']} {hms(q['nowSec'])}: 엔진 {hms(e_safe)} / Py {hms(safe)}")
    print(f"  안전 출발 마감(p≥0.8) 일치 {same}/{same + len(diff)}" + (f" — 다른 쌍: {'; '.join(diff[:5])}" if diff else ""))


def engine_rides(tt: dict, journey: dict) -> list:
    """엔진 여정의 ride 구간 → (trip, 탄 정차 i, 내린 정차 j). 노드와 시각으로 정차를 찾는다."""
    out = []
    for leg in journey["legs"]:
        if leg["type"] != "ride":
            continue
        ti = tt["by_code"][(leg["line"], leg["trip"])]
        s = tt["trips"][ti]["stops"]
        i = next(k for k, st in enumerate(s) if st[0] == leg["from_node"] and stop_time(st, "dep") == leg["dep"])
        j = next(k for k, st in enumerate(s) if k > i and st[0] == leg["to_node"] and stop_time(st, "arr") == leg["arr"])
        out.append((ti, i, j))
    return out


def check_route_prob(ctx: dict, plans: list, eng: dict, n: int, fails: list, report: dict) -> None:
    """경로 확률: 엔진이 고른 여정(best·options)에 Python 재귀를 그대로 적용해 p_home과 환승별 p·q를 비교."""
    print(f"\n[3] 경로 확률(재귀) — 경로가 있는 무작위 질의 {n}쌍, best와 options 전체")
    res, done = [], 0
    for q in plans:
        e = eng[q["id"]]
        if e["status"] != "ok" or done >= n:
            continue
        done += 1
        tt = ctx["tt"][q["tag"]]
        js = [("best", e["best"])] + [(f"opt{k}", o["journey"]) for k, o in enumerate(e["options"])]
        for name, jr in js:
            p_py, trs = route_prob(ctx, q["tag"], engine_rides(tt, jr), q["home"])
            et = jr["transfers"]
            res.append({"id": q["id"], "which": name, "tag": q["tag"], "route": f"{q['origin']}→{q['home']}",
                        "depart": jr["depart_sec"], "p_engine": jr["p_home"], "p_python": p_py,
                        "dp": max([abs(a["p"] - b["p"]) for a, b in zip(trs, et)], default=0.0),
                        "dq": max([abs(a["q"] - b["q"]) for a, b in zip(trs, et)], default=0.0),
                        "db": max([abs(a["buffer_sec"] - b["buffer_sec"]) for a, b in zip(trs, et)], default=0),
                        "n_tr": len(trs)})
        # Python이 스스로 찾은 최선 여정의 확률도 엔진 best와 비교(동률 여정 선택 차이 확인)
        j = csa(tt, ctx["net"], ctx["net"]["station_nodes"][q["origin"]], q["nowSec"], ctx["net"]["station_nodes"][q["home"]])
        res[-len(js)]["p_python_own_best"] = route_prob(ctx, q["tag"], j["rides"], q["home"])[0]
    best = [x for x in res if x["which"] == "best"]
    d = [abs(x["p_engine"] - x["p_python"]) for x in res]
    d_best = [abs(x["p_engine"] - x["p_python"]) for x in best]
    d_own = [abs(x["p_engine"] - x["p_python_own_best"]) for x in best]
    print(f"  best {len(best)}개: |엔진−Python| 최대 {max(d_best):.2e} · 95% {pct(d_best, .95):.2e}"
          f" (환승 있는 여정 {sum(x['n_tr'] > 0 for x in best)})")
    print(f"  best+options {len(res)}개: |Δ| 최대 {max(d):.2e}, 환승별 p 최대 |Δ| {max(x['dp'] for x in res):.2e},"
          f" q 최대 |Δ| {max(x['dq'] for x in res):.2e}, 여유 B 최대 차 {max(x['db'] for x in res)}초")
    print(f"  Python 자체 최선 여정 확률 vs 엔진 best: 최대 |Δ| {max(d_own):.4f}, 다른 쌍 {sum(v > TOL_SAME for v in d_own)}")
    for x in sorted(res, key=lambda x: -abs(x["p_engine"] - x["p_python"]))[:5]:
        if abs(x["p_engine"] - x["p_python"]) > TOL_SAME:
            print(f"    {x['tag']} {x['route']} {x['which']} {hms(x['depart'])}: 엔진 {x['p_engine']:.4f} Py {x['p_python']:.4f}"
                  f" (p {x['dp']:.1e}, q {x['dq']:.1e})")
    if max(d) > TOL_SAME:
        fails.append("경로 확률: 엔진 ≠ Python")
    report["route_prob"] = res


def check_last_combos(lq: list, eng: dict, ctx: dict, fails: list, report: dict) -> None:
    """막차 조합(prob_table 여유 ≥ 0): A 앞 정차에서 떠나 D 다음 정차까지 시간표 안에 닿는 경로가 있어야 한다."""
    print(f"\n[4] 막차 조합 경로 존재 — prob_table 여유 ≥ 0 행 중 질의 가능한 {len(lq)}개")
    res = []
    for q in lq:
        e, net = eng[q["id"]], ctx["net"]
        j = csa(ctx["tt"][q["tag"]], net, net["station_nodes"][q["origin"]], q["nowSec"], net["station_nodes"][q["home"]])
        ea = e["best"]["arrive_sec"] if e.get("best") else None
        res.append({"combo": q["combo"], "eng_ok": ea is not None and ea <= q["deadline"],
                    "py_ok": j is not None and j["arrive"] <= q["deadline"]})
    bad = [x for x in res if not (x["eng_ok"] and x["py_ok"])]
    print(f"  경로 있음: 엔진 {sum(x['eng_ok'] for x in res)}/{len(res)}, Python {sum(x['py_ok'] for x in res)}/{len(res)}")
    for x in bad[:10]:
        print(f"    없음: {x['combo']} (엔진 {x['eng_ok']}, Python {x['py_ok']})")
    if bad:
        fails.append(f"막차 조합 경로 없음 {len(bad)}개")
    report["last_combos"] = res


def check_sanity(ctx: dict, sq: list, eng: dict, report: dict) -> None:
    """실제 경로 상식 점검: 엔진 여정의 각 탑승 구간 시각을 시간표 CSV 원문과 대조하고, 출발 마감 여정의 마지막 열차가
    그 역·방향의 막차인지 본다."""
    from preprocess import load_timetable as load_csv
    print("\n[5] 상식 점검(시간표 CSV 원문 대조)")
    nodes = ctx["net"]["nodes"]
    for q in sq:
        e, csv = eng[q["id"]], load_csv(q["tag"])
        print(f"  ■ {q['tag']} {q['origin']}→{q['home']} 지금 {hms(q['nowSec'])}: {e['status']}"
              f", 마감(안전) {hms((e['leave_by'].get('safe') or {}).get('depart_sec'))}"
              f", 마감(마지막) {hms((e['leave_by'].get('last') or {}).get('depart_sec'))}")
        last = e["leave_by"].get("last")
        shown = [("best", e["best"])]
        if last:
            shown += [("마지막", o["journey"]) for o in e["options"] if o["depart_sec"] == last["depart_sec"]][:1]
        for name, jr in shown:
            if not jr:
                continue
            print(f"    {name}: 출발 {hms(jr['depart_sec'])} 도착 {hms(jr['arrive_sec'])} 귀가 확률 {jr['p_home']:.3f}")
            for leg in jr["legs"]:
                if leg["type"] == "transfer":
                    continue
                f_nm, t_nm = nodes[leg["from_node"]]["nm"], nodes[leg["to_node"]]["nm"]
                rows = csv[(csv["line"] == leg["line"]) & (csv["열차코드"] == leg["trip"]) & ~csv["pass_through"]]
                rf = rows[(rows["nm"] == f_nm) & (rows["dep_sec"] == leg["dep"])]
                rt = rows[(rows["nm"] == t_nm) & (rows["arr_sec"].fillna(rows["dep_sec"]) == leg["arr"])]
                ok_f, ok_t = len(rf) == 1, len(rt) == 1
                # 같은 역·방향에서 이 열차보다 늦게 출발하는 열차 수(0이면 막차)
                dirn = rows["방향"].iloc[0] if len(rows) else None
                same = csv[(csv["line"] == leg["line"]) & (csv["nm"] == f_nm) & (csv["방향"] == dirn)
                           & ~csv["pass_through"] & csv["dep_sec"].notna()]
                later = int((same["dep_sec"] > leg["dep"]).sum())
                print(f"      {leg['line']}호선 {leg['trip']} {f_nm} {hms(leg['dep'])} → {t_nm} {hms(leg['arr'])}"
                      f" | CSV 출발 {rf['열차출발시간'].iloc[0] if len(rf) else '?'} 도착 {rt['열차도착시간'].iloc[0] if len(rt) else '?'}"
                      f" {'일치' if ok_f and ok_t else '불일치'} | 이 역·방향에서 더 늦은 열차 {later}편")
            for t in jr["transfers"]:
                print(f"      환승 {t['at_station']} {t['from_line']}→{t['to_line']} 도보 {t['walk_sec']}초 여유 {t['buffer_sec']}초"
                      f" p={t['p']:.3f} q={t['q']:.3f}{' ⚠' if t['critical'] else ''}")
    report["sanity"] = {q["id"]: eng[q["id"]] for q in sq}


def check_timing(eng: dict) -> None:
    ms = [e["ms"] for e in eng.values()]
    print(f"\n[6] planTrip 실행 시간(Node, {len(ms)}회): 중앙 {pct(ms, .5):.1f}ms · p90 {pct(ms, .9):.1f}"
          f" · p99 {pct(ms, .99):.1f} · 최대 {max(ms):.1f}ms")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pairs", type=int, default=300, help="요일 태그별 무작위 질의 수")
    ap.add_argument("--prob-pairs", type=int, default=100, help="경로 확률을 대조할 질의 수")
    ap.add_argument("--seed", type=int, default=20261004)
    args = ap.parse_args()

    t0 = time.time()
    ctx = {"net": load_network(), "dists": load_dists(), "memo": {}}
    ctx["tt"] = {tag: load_timetable(tag) for tag in TAGS}
    ctx["sidx"] = {tag: stop_index(ctx["tt"][tag]) for tag in TAGS}
    plans = make_plan_queries(ctx, args.pairs, args.seed)
    tq, lq = table_queries(ctx)
    sq = [{"id": f"san{k}", "kind": "sanity", "tag": tag, "origin": o, "home": h, "nowSec": t}
          for k, (tag, (o, h), t) in enumerate((tag, p, t) for tag in ("DAY", "SAT") for p in SANITY
                                               for t in (82800, 85200))]
    out = run_engine(ctx, tq, plans + lq + sq)
    eng = {r["id"]: r for r in out["plans"]}
    print(f"엔진 실행 끝: 환승 질의 {len(tq)}, planTrip {len(eng)} ({time.time() - t0:.0f}초)")

    fails, report = [], {"args": vars(args)}
    check_data(ctx, fails)
    check_table(ctx, tq, out["transfers"], fails, report)
    check_csa(ctx, plans, eng, fails, report)
    check_route_prob(ctx, plans, eng, args.prob_pairs, fails, report)
    check_last_combos(lq, eng, ctx, fails, report)
    check_sanity(ctx, sq, eng, report)
    check_timing(eng)

    (OUT_DIR / "report.json").write_text(json.dumps(report, ensure_ascii=False, default=str), encoding="utf-8")
    print(f"\n상세: {OUT_DIR / 'report.json'} | 총 {time.time() - t0:.0f}초")
    print("판정: " + ("통과" if not fails else "실패 — " + "; ".join(fails)))
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
