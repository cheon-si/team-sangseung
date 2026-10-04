"""귀가 경로 기능 데이터 (route_contract.md 1장). export_for_app.py main() 끝에서 호출한다.

    network.json               노드(노선, 시간표 역명)·물리 역·환승 도보. 다른 파일은 노드를 배열 인덱스로 참조
    trips_{DAY,SAT,END}.json   21:00 이후 열차 정차 [노드 인덱스, 도착 초, 출발 초, 막차 플래그]
    route_dists.json           확률 계산용 지연 분포(밤 균등 가중 표본).
                               export_for_app.build가 쓰는 by_cell_d·last_a·deps 객체를 그대로 받아 만든다

물리 역 = 환승 자료(common.load_transfers)로 이어진 노드 + 같은 이름이면서 300m 이내인 노드.
검증(좌표 없는 노드, 가중치 합, 셀 키 불일치)에 실패하면 오류 목록을 돌려주고 export_for_app이 종료 코드 1로 끝낸다.
"""

import json
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd

import common as c
from build_station_alt import haversine_m
from preprocess import load_timetable
from validate import LAST_K, dep_dists

TAGS = ("DAY", "SAT", "END")
WINDOW_START = 75600          # 21:00. 정차 시각(도착 또는 출발)이 이 이후인 정차만 내보낸다
SAME_NAME_M = 300             # 환승 자료가 없어도 같은 이름 + 이 거리 이내면 같은 물리 역(노량진·금정 등 코레일 환승역)
ROUND_SEC = 5                 # 지연 표본 반올림 단위(초). 같은 값을 합쳐 파일을 줄인다
WEIGHT_DECIMALS = 6
STATION_RENAME = {"이수": "총신대입구"}   # common.transfer_stations()의 station_id 규칙
LINE_COLORS = {"1": "#0052A4", "2": "#00A84D", "3": "#EF7C1C", "4": "#00A5DE", "5": "#996CAC",
               "6": "#CD7C2F", "7": "#747F00", "8": "#E6186C", "9": "#BDB092"}
FLAG_ARR_LAST3, FLAG_DEP_LAST3, FLAG_DEP_LAST = 1, 2, 4
ADJ_MIN_STOPS = 4             # 이웃 역 쌍(연속 정차)을 배우는 열차의 최소 정차 수. 2정차 열차는 시발·종착뿐이라 쓰지 않는다


# ── network.json ────────────────────────────────────────────

def load_nodes() -> pd.DataFrame:
    """세 요일 시간표의 (노선, 역명) 합집합 = 노드. (노선, 역명) 정렬 순서가 곧 다른 파일의 인덱스다.
    좌표는 역사코드 = station_coords.json BLDN_ID로 결합한다(역명 결합은 같은 이름 다른 역 위험, build_station_alt.py와 같은 방식)."""
    parts = [load_timetable(t)[["line", "nm", "역사코드"]] for t in TAGS]
    nodes = pd.concat(parts).drop_duplicates(["line", "nm"]).sort_values(["line", "nm"]).reset_index(drop=True)
    nodes["id"] = nodes["line"] + ":" + nodes["nm"]
    nodes["station"] = nodes["nm"].replace(STATION_RENAME)
    with open(c.REF_DIR / "station_coords.json", encoding="utf-8") as f:
        raw = json.load(f)
    coords = pd.DataFrame(raw if isinstance(raw, list) else next(v for v in raw.values() if isinstance(v, list)))
    coords = coords.drop_duplicates("BLDN_ID").set_index("BLDN_ID")[["LAT", "LOT"]].astype(float)
    nodes["lat"] = nodes["역사코드"].map(coords["LAT"])
    nodes["lon"] = nodes["역사코드"].map(coords["LOT"])
    return nodes


def find(parent: list[int], i: int) -> int:
    """유니온-파인드의 대표 노드 찾기(경로 압축)."""
    while parent[i] != i:
        parent[i] = parent[parent[i]]
        i = parent[i]
    return i


def group_stations(nodes: pd.DataFrame, tr: pd.DataFrame) -> tuple[list[int], list[int]]:
    """노드 → 물리 역 대표 노드. (환승 자료만으로 묶은 결과, 이름·거리 규칙까지 더한 최종 결과)를 돌려준다.
    둘을 비교하면 "묶였지만 환승 자료가 없는 역"이 나온다."""
    idx = {(l, n): i for i, (l, n) in enumerate(zip(nodes["line"], nodes["nm"]))}
    parent = list(range(len(nodes)))
    for r in tr.itertuples():
        a, b = find(parent, idx[(r.from_line, r.station)]), find(parent, idx[(r.to_line, r.to_station)])
        parent[a] = b
    by_transfer = [find(parent, i) for i in range(len(nodes))]

    # 같은 이름(이수→총신대입구 반영) + 좌표 300m 이내. 좌표가 없는 노드는 거리를 잴 수 없어 이 규칙으로 묶지 않는다
    for _, g in nodes[nodes["lat"].notna()].groupby("station"):
        ids = g.index.to_list()
        la, lo = g["lat"].to_numpy(), g["lon"].to_numpy()
        dist = haversine_m(la[:, None], lo[:, None], la[None, :], lo[None, :])
        for x in range(len(ids)):
            for y in range(x + 1, len(ids)):
                if dist[x, y] <= SAME_NAME_M:
                    parent[find(parent, ids[x])] = find(parent, ids[y])
    return by_transfer, [find(parent, i) for i in range(len(nodes))]


def build_network(meta: dict) -> tuple[dict, dict, list[str]]:
    """network.json 객체, (노선, 역명) → 노드 인덱스, 오류 목록."""
    nodes = load_nodes()
    tr = c.load_transfers()
    by_transfer, root = group_stations(nodes, tr)
    nodes["root"] = root
    errs = []

    # 좌표가 없는 노드는 같은 물리 역의 다른 노드 좌표 평균으로 채운다
    borrowed = []
    for i in nodes.index[nodes["lat"].isna()]:
        peers = nodes[(nodes["root"] == nodes.at[i, "root"]) & nodes["lat"].notna()]
        if len(peers):
            nodes.loc[i, ["lat", "lon"]] = peers["lat"].mean(), peers["lon"].mean()
            borrowed.append(f"{nodes.at[i, 'id']}←{'/'.join(peers['id'])}")
    missing = nodes.loc[nodes["lat"].isna(), "id"].tolist()
    if missing:
        errs.append(f"좌표 없는 노드 {len(missing)}개: {missing}")

    stations, no_transfer = [], []
    for _, g in nodes.groupby("root"):
        names = g["station"].unique()
        if len(names) > 1:
            errs.append(f"한 물리 역에 이름이 여럿: {list(names)}")
        stations.append({"id": names[0], "name": names[0], "lines": sorted(g["line"].unique()),
                         "lat": round(float(g["lat"].mean()), 6), "lon": round(float(g["lon"].mean()), 6),
                         "nodes": g.index.to_list()})
        if len({by_transfer[i] for i in g.index}) > 1:
            no_transfer.append({"station": names[0], "nodes": g["id"].tolist()})
    stations.sort(key=lambda s: s["id"])
    dup = pd.Series([s["id"] for s in stations]).value_counts()
    if (dup > 1).any():
        errs.append(f"같은 이름의 다른 물리 역(300m 초과): {dup[dup > 1].index.tolist()}")

    node_idx = {(l, n): i for i, (l, n) in enumerate(zip(nodes["line"], nodes["nm"]))}
    transfers = [{"from": node_idx[(r.from_line, r.station)], "to": node_idx[(r.to_line, r.to_station)],
                  "walk_sec": int(r.walk_sec), "src": r.walk_src, "same_line": bool(r.same_line)}
                 for r in tr.itertuples()]
    net = {"meta": {**meta, "source": f"{c.TIMETABLE_CSV.name} 역사코드 → station_coords.json, "
                                      f"{c.TRANSFER_CSV.name}(common.load_transfers)",
                    "same_name_max_m": SAME_NAME_M, "coord_borrowed": borrowed,
                    "bundled_without_transfer": no_transfer},
           "line_colors": LINE_COLORS,
           "nodes": [{"id": r.id, "line": r.line, "nm": r.nm, "station": r.station,
                      "lat": round(float(r.lat), 6) if pd.notna(r.lat) else None,
                      "lon": round(float(r.lon), 6) if pd.notna(r.lon) else None} for r in nodes.itertuples()],
           "stations": stations, "transfers": transfers}
    return net, node_idx, errs


# ── trips_{tag}.json ────────────────────────────────────────

def last_uids(tt: pd.DataFrame, tcol: str, k: int) -> set:
    """validate.load_dep_delays와 같은 규칙: 통과 행 제외, 시각 정렬 후 (노선, 역, 방향)별 마지막 k편의 uid."""
    ok = tt[tt[tcol].notna() & ~tt["pass_through"]].sort_values(tcol)
    return set(ok.groupby(["line", "nm", "방향"]).tail(k)["uid"])


def sec_or_none(x: float) -> int | None:
    return None if pd.isna(x) else int(x)


def time_reversed(stops: list) -> bool:
    """연속 정차의 시각이 거꾸로 가면 True: 뒤 정차 도착 < 앞 정차 출발, 또는 중간 정차 출발 < 도착.
    9호선 C9199(SAT·END)는 원본 시각이 깨져(봉은사 도착 23:58:05·출발 23:20:45) 시각순 정렬이 서로 떨어진 두 구간을
    번갈아 잇는다(신논현 23:40:50 → 석촌 23:41:15 등). 이런 열차를 내보내면 경로 탐색에 순간이동 연결이 생긴다."""
    for i in range(len(stops) - 1):
        dep = stops[i][2] if stops[i][2] is not None else stops[i][1]
        arr = stops[i + 1][1] if stops[i + 1][1] is not None else stops[i + 1][2]
        if arr < dep or (i > 0 and None not in stops[i][1:3] and stops[i][2] < stops[i][1]):
            return True
    return False


def stop_pairs(stops: list) -> list[tuple[int, int]]:
    return [(a[0], b[0]) for a, b in zip(stops, stops[1:])]


def jump_positions(trip: dict, pair_count: Counter) -> list[int]:
    """다른 열차(정차 ADJ_MIN_STOPS개 이상)에 한 번도 연속으로 나오지 않는 연속 정차쌍(비인접 점프)의 위치 i
    (stops[i] → stops[i+1]). 급행의 정상 정차 패턴도 다른 급행에 나오면 점프가 아니다."""
    pairs = stop_pairs(trip["stops"])
    own = Counter(pairs) if len(trip["stops"]) >= ADJ_MIN_STOPS else Counter()
    return [i for i, p in enumerate(pairs) if pair_count[(trip["line"], *p)] - own[p] <= 0]


def inserted_flags(tt: pd.DataFrame, line: str, nm: str, direction: str, arr: int, dep: int) -> int:
    """보간해 넣은 정차의 막차 플래그: 원본 시간표의 같은 (노선, 역, 방향) 정차들 사이에서 마지막 LAST_K편(막차)에 드는가.
    다른 열차의 플래그는 바꾸지 않는다(확률 모형 validate.load_dep_delays가 쓰는 원본 시간표 기준을 유지)."""
    same = tt[(tt["line"] == line) & (tt["nm"] == nm) & (tt["방향"] == direction) & ~tt["pass_through"]]
    later_arr, later_dep = int((same["arr_sec"] > arr).sum()), int((same["dep_sec"] > dep).sum())
    return int((later_arr < LAST_K) * FLAG_ARR_LAST3 + (later_dep < LAST_K) * FLAG_DEP_LAST3
               + (later_dep == 0) * FLAG_DEP_LAST)


def fill_skipped_stop(trip: dict, i: int, trips: list, tt: pd.DataFrame, node_key: list) -> list | None:
    """급행이 아닌 열차가 다른 열차들이 u → x → v 로 잇는 구간을 u → v 로 건너뛰면 원본 시간표의 x 행 누락으로 보고
    x 정차를 보간한다. 같은 노선·방향 열차에서 u → x → v 가 연속인 x가 하나뿐일 때만 넣는다(아니면 None).
    시각: 그 열차들에서 x 도착·출발이 (u 출발 ~ v 도착) 구간에서 차지하는 비율의 중앙값으로 나누고 10초 단위로 반올림.
    예: 5호선 평일 5694는 둔촌동 → 천호로 강동 행이 없지만 실시간 위치 API에서는 강동 도착이 잡힌다(00:04:41~55, 3밤)."""
    u, v = trip["stops"][i], trip["stops"][i + 1]
    if u[2] is None or v[1] is None:
        return None
    ratios = {}
    for t in trips:
        if t is trip or t["line"] != trip["line"] or t["dir"] != trip["dir"]:
            continue
        for a, b, d in zip(t["stops"], t["stops"][1:], t["stops"][2:]):
            if a[0] == u[0] and d[0] == v[0] and None not in (a[2], b[1], b[2], d[1]) and d[1] > a[2]:
                span = d[1] - a[2]
                ratios.setdefault(b[0], []).append(((b[1] - a[2]) / span, (b[2] - a[2]) / span))
    if len(ratios) != 1:
        return None
    x, r = next(iter(ratios.items()))
    span = v[1] - u[2]
    arr = u[2] + int(round(float(np.median([q[0] for q in r])) * span / 10)) * 10
    dep = u[2] + int(round(float(np.median([q[1] for q in r])) * span / 10)) * 10
    line, nm = node_key[x]
    return [x, arr, dep, inserted_flags(tt, line, nm, trip["dir"], arr, dep)]


def check_jumps(trips: list, tt: pd.DataFrame, node_key: list) -> tuple[list, dict]:
    """비인접 점프가 있는 열차 처리. 반환: (남길 열차, meta 기록)
    - 정차가 2개뿐인 점프 열차는 뺀다. 평일 5호선 59xx 13편(둔촌동→상일동처럼 지선을 건너뛰는 등)이 여기 걸린다.
      실시간 위치 API 평일 10밤(23:00~25:10)에서 2~9호선 열차 188편 중 177편이 잡혔는데 이 창의 59xx 9편은 한 번도
      안 잡혀 영업 열차가 아닌 것으로 본다(회송 추정, 운영사 미확인). 막차 플래그 계산에는 그대로 남는다.
    - 급행이 아닌 열차가 한 역만 건너뛰면 그 정차를 보간한다(fill_skipped_stop). 그 밖의 점프는 경고로만 남긴다."""
    pair_count = Counter((t["line"], *p) for t in trips if len(t["stops"]) >= ADJ_MIN_STOPS
                         for p in stop_pairs(t["stops"]))
    kept, dropped, filled, warned = [], [], [], []
    for t in trips:
        jumps = jump_positions(t, pair_count)
        if jumps and len(t["stops"]) == 2:
            dropped.append(f"{t['line']}:{t['code']}")
            continue
        for i in reversed(jumps):          # 뒤에서부터 넣어야 앞쪽 위치가 밀리지 않는다
            u, v = node_key[t["stops"][i][0]][1], node_key[t["stops"][i + 1][0]][1]
            x = None if t["express"] else fill_skipped_stop(t, i, trips, tt, node_key)
            if x is None:
                warned.append(f"{t['line']}:{t['code']} {u}→{v}")
                continue
            t["stops"].insert(i + 1, x)
            filled.append(f"{t['line']}:{t['code']} {u}→[{node_key[x[0]][1]} {x[1]}/{x[2]} flags {x[3]}]→{v}")
        kept.append(t)
    return kept, {"dropped_two_stop_jump": dropped, "filled_skipped_stop": filled, "jump_warnings": warned}


def build_trips(tag: str, node_idx: dict, meta: dict) -> dict:
    """한 요일 태그의 열차별 정차 목록. 막차 플래그는 21:00 창이 아니라 그날 시간표 전체에서 정한다
    (validate.load_dep_delays와 같은 규칙이라, 아래에서 빼는 열차도 플래그 계산에는 들어간다)."""
    tt = load_timetable(tag)
    arr3, dep3, dep1 = last_uids(tt, "arr_sec", LAST_K), last_uids(tt, "dep_sec", LAST_K), last_uids(tt, "dep_sec", 1)
    s = tt[~tt["pass_through"]]
    s = s[(s["arr_sec"] >= WINDOW_START) | (s["dep_sec"] >= WINDOW_START)]
    flags = (s["uid"].isin(arr3) * FLAG_ARR_LAST3 + s["uid"].isin(dep3) * FLAG_DEP_LAST3
             + s["uid"].isin(dep1) * FLAG_DEP_LAST)
    trips, dropped = [], []
    # load_timetable이 (노선, 열차코드, t_order)로 정렬해 두었으므로 그룹 안 순서가 곧 운행 순서
    for (line, code), g in s.assign(flags=flags).groupby(["line", "열차코드"], sort=False):
        stops = [[node_idx[(line, n)], sec_or_none(a), sec_or_none(d), int(f)]
                 for n, a, d, f in zip(g["nm"], g["arr_sec"], g["dep_sec"], g["flags"])]
        if time_reversed(stops):
            dropped.append(f"{line}:{code}")
            continue
        trips.append({"line": line, "code": code, "dir": g["방향"].iat[0], "express": g["급행여부"].iat[0] == "1",
                      "dest": g["도착역"].iat[0], "stops": stops})
    node_key = [None] * len(node_idx)          # 노드 인덱스 → (노선, 역명)
    for key, i in node_idx.items():
        node_key[i] = key
    trips, jump_meta = check_jumps(trips, tt, node_key)
    return {"meta": {**meta, "source": f"{c.TIMETABLE_CSV.name} 주중주말={tag}, 급행 통과 행 제외",
                     "tag": tag, "window_start_sec": WINDOW_START,
                     "flags": {str(FLAG_ARR_LAST3): f"arr_last{LAST_K}", str(FLAG_DEP_LAST3): f"dep_last{LAST_K}",
                               str(FLAG_DEP_LAST): "dep_last"},
                     "dropped_time_reversed": dropped, **jump_meta},
            "trips": trips}


# ── route_dists.json ────────────────────────────────────────

def weighted_samples(nights: dict) -> list:
    """밤별 정렬 지연 배열 → [[지연(ROUND_SEC 단위 반올림), 가중치], ...] 지연 오름차순.
    밤 i 표본 하나의 가중치 = 1/(밤 수 × 그 밤 표본 수). 누적합이 곧 밤 균등 평균 ECDF가 된다."""
    vals = np.concatenate([np.floor(v / ROUND_SEC + 0.5) * ROUND_SEC for v in nights.values()])
    w = np.concatenate([np.full(len(v), 1 / (len(nights) * len(v))) for v in nights.values()])
    merged = pd.Series(w).groupby(vals).sum()      # 같은 지연 값끼리 합치고 값 오름차순
    return [[int(x), round(float(p), WEIGHT_DECIMALS)] for x, p in merged.items()]


def load_all_dep_delays(nights: list[str]) -> pd.DataFrame:
    """막차가 아닌 갈아탈 열차용: 학습 밤의 모든 출발 지연. 필터·중복 처리는 validate.load_dep_delays와 같고
    마지막 LAST_K편 제한만 없다."""
    ev = pd.read_csv(c.PROCESSED_DIR / "delay_events.csv", dtype={"night": str, "line": str, "uid": str})
    ev = ev[(ev["status"] == "dep") & ev["in_window"] & ~ev["tt_unknown"] & ev["night"].isin(nights)].copy()
    ev["src_rank"] = (ev["src"] != "pos").astype(int)
    ev = ev.sort_values("src_rank").drop_duplicates(["night", "uid"], keep="first")
    return ev[["night", "day_type", "line", "uid", "delay_sec"]]


def line_day_dists(dd: dict, lines: set | None = None) -> tuple[dict, list[str]]:
    """dep_dists 결과((노선, 요일 유형) → 밤별 배열, '_fallback') → {"노선|요일": {...}}. 밤이 없는 키는 빼고 따로 돌려준다."""
    out, empty = {}, []
    for k, nd in sorted((k, v) for k, v in dd.items() if k != "_fallback"):
        if lines is not None and k[0] not in lines:
            continue
        if not nd:
            empty.append("|".join(k))
            continue
        fb = dd["_fallback"].get(k)
        out["|".join(k)] = {"samples": weighted_samples(nd), "n_nights": len(nd),
                            "fallback": "|".join(fb) if fb else None}
    return out, empty


def build_route_dists(route_src: dict, band_members: dict, meta: dict) -> dict:
    arr_cells = {}
    for key, nd in sorted(route_src["by_cell_d"].items()):
        line, day, band = key.split("|")
        arr_cells[key] = {"line": line, "day_type": day, "hour_band": band, "n_nights": len(nd),
                          "samples": weighted_samples(nd) if nd else []}
    arr_last3, e1 = line_day_dists(route_src["last_a"], c.LASTK_A_LINES)
    dep_last3, e2 = line_day_dists(route_src["deps"])
    dep_all, e3 = line_day_dists(dep_dists(load_all_dep_delays(route_src["nights"])))
    m = route_src["meta"]
    return {"meta": {**meta, "source": "delay_events.csv (export_for_app.build와 같은 학습 밤·같은 분포 객체)",
                     "train_until": m["train_until"], "nights": m["nights"], "round_sec": ROUND_SEC,
                     "band_members": {k: sorted(v) for k, v in band_members.items()},
                     "lastk_a_lines": sorted(c.LASTK_A_LINES),
                     "empty": {"arr_last3": e1, "dep_last3": e2, "dep_all": e3}},
            "arr_cells": arr_cells, "arr_last3": arr_last3, "dep_last3": dep_last3, "dep_all": dep_all}


# ── 검증·쓰기 ───────────────────────────────────────────────

def check_dists(dists: dict, cdf: dict) -> list[str]:
    errs = []
    cdf_keys = {k for k in cdf["dists"] if not k.endswith("|last3")}
    if set(dists["arr_cells"]) != cdf_keys:
        errs.append(f"arr_cells 키 ≠ delay_cdf 셀 키: {sorted(set(dists['arr_cells']) ^ cdf_keys)}")
    for part in ("arr_cells", "arr_last3", "dep_last3", "dep_all"):
        for k, v in dists[part].items():
            total = sum(w for _, w in v["samples"])
            if abs(total - 1) > 1e-3:
                errs.append(f"{part}[{k}] 가중치 합 {total:.6f}")
    return errs


def write_route_files(route_src: dict, cdf: dict, band_members: dict, out_dir: Path) -> list[str]:
    """5종을 만들어 검증하고 쓴다. 오류가 있으면 아무것도 쓰지 않고 오류 목록을 돌려준다."""
    meta = {k: route_src["meta"][k] for k in ("generated_at", "commit")}
    net, node_idx, errs = build_network(meta)
    trips = {t: build_trips(t, node_idx, meta) for t in TAGS}
    dists = build_route_dists(route_src, band_members, meta)
    errs += check_dists(dists, cdf)
    if errs:
        return errs

    files = {"network": net, **{f"trips_{t}": trips[t] for t in TAGS}, "route_dists": dists}
    for name, obj in files.items():
        path = out_dir / f"{name}.json"
        path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"{path.relative_to(c.BASE_DIR)}: {path.stat().st_size / 1024:.0f}KB")
    nm = net["meta"]
    print(f"노드 {len(net['nodes'])}, 물리 역 {len(net['stations'])}, 환승 {len(net['transfers'])}, "
          f"좌표 빌림 {nm['coord_borrowed']}, 환승 자료 없이 묶인 역 {[x['station'] for x in nm['bundled_without_transfer']]}")
    for t in TAGS:
        tm = trips[t]["meta"]
        print(f"{t}: 열차 {len(trips[t]['trips'])}, 정차 {sum(len(x['stops']) for x in trips[t]['trips'])}, "
              f"시각이 거꾸로 가 뺀 열차 {tm['dropped_time_reversed']}, 2정차 점프로 뺀 열차 {tm['dropped_two_stop_jump']}, "
              f"보간한 정차 {tm['filled_skipped_stop']}, 점프 경고 {tm['jump_warnings']}")
    print(f"분포: arr_cells {len(dists['arr_cells'])}, arr_last3 {len(dists['arr_last3'])}, "
          f"dep_last3 {len(dists['dep_last3'])}, dep_all {len(dists['dep_all'])}, 빈 키 {dists['meta']['empty']}")
    return []
