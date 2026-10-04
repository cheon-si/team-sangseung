"""작업 8 1단계. 파이프라인 결과 → 앱이 읽는 JSON 3종 (web/public/data/).

    prob_table.json   조합 × 요일 유형(DAY/SAT/END)별 성공 확률, 잭나이프 구간, 시간표 여유
                      p_success = 2차 모형(갈아탈 막차 출발 지연까지 반영, 주 모형), p_first = 1차(정시 출발 가정)
    delay_cdf.json    셀별 밤 균등 ECDF 격자 (−120~+1800초, 15초)
    station_alt.json  환승역 좌표·대안 + 역별 최악·중앙 성공 확률(평일)

판정(타세요/도박/대안)은 넣지 않는다. 앱 src/config.js 의 임계값으로 계산해서,
팀원이 파이썬 없이 임계값을 바꿀 수 있게 한다.
끝에서 export_route.py가 귀가 경로용 5종(network, trips_DAY/SAT/END, route_dists)을 같은 지연 분포 객체로 만든다.
검증에 실패하면 종료 코드 1.

사용: python export_for_app.py [--train-until YYYYMMDD]
"""

import argparse
import json
import subprocess
import sys
from datetime import datetime

import numpy as np
import pandas as pd

import common as c
import export_route
from fit_delay import GRID, load_delays
from validate import dep_dists, jackknife_conv, jackknife_p, load_dep_delays, night_sorted, night_sorted_dict

WEB_DATA = c.BASE_DIR / "web" / "public" / "data"
BAND_MEMBERS = {"22": {"22"}, "23": {"23"}, "24": {"24"}, "23-24": {"23", "24"},
                "22-23": {"22", "23"}, "all": {"22", "23", "24"}}


def hhmm(sec: float) -> str:
    """운영일 기준 초 → '24:48' 같은 표기(24시 넘김 유지)."""
    s = int(round(sec))
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}"


def cell_of(cells: pd.DataFrame, line: str, day_type: str, band: str) -> str | None:
    """조합의 A 열차(노선, 요일 유형, 도착 시간대)가 속한 셀 키."""
    sub = cells[(cells["line"] == line) & (cells["day_type"] == day_type)]
    for key, hb in zip(sub["dist_key"], sub["hour_band"]):
        if band in BAND_MEMBERS[hb]:
            return key
    return None


def clean(x):
    """JSON 직렬화: NaN → None, numpy 숫자 → 파이썬 숫자."""
    if isinstance(x, (float, np.floating)):
        return None if np.isnan(x) else round(float(x), 4)
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (np.bool_,)):
        return bool(x)
    return x


def build(train_until: str | None) -> tuple[dict, dict, dict, dict]:
    """앱 JSON 3종과, 귀가 경로 분포(export_route)가 같은 객체를 쓰도록 by_cell_d·last_a·deps·학습 밤을 함께 돌려준다."""
    pairs = pd.read_csv(c.PROCESSED_DIR / "last_train_pairs.csv",
                        dtype={"from_line": str, "to_line": str, "a_hour_band": str})
    cells = pd.read_csv(c.PROCESSED_DIR / "delay_cells.csv", dtype={"line": str, "hour_band": str})
    grid = pd.read_csv(c.PROCESSED_DIR / "delay_grid.csv")
    cmap = pd.read_csv(c.PROCESSED_DIR / "delay_cell_map.csv", dtype={"night": str, "uid": str})
    d = load_delays(train_until).merge(cmap[["night", "uid", "dist_key"]], on=["night", "uid"])
    by_cell = {k: night_sorted(g) for k, g in d.groupby("dist_key")}
    by_cell_d = {k: night_sorted_dict(g) for k, g in d.groupby("dist_key")}
    nights = sorted(d["night"].unique())
    deps = dep_dists(load_dep_delays(nights))
    last_a = dep_dists(load_dep_delays(nights, status="arr"))     # c.LASTK_A_LINES의 타고 온 열차 분포
    tags = {n: c.day_info(n) for n in nights}

    rows = []
    for _, r in pairs.iterrows():
        key = cell_of(cells, r["from_line"], r["day_type"], r["a_hour_band"])
        a_d = by_cell_d.get(key, {})
        if r["from_line"] in c.LASTK_A_LINES and last_a.get((r["from_line"], r["day_type"])):
            a_d = last_a[(r["from_line"], r["day_type"])]
            key = f"{r['from_line']}|{r['day_type']}|last3"
        jk1 = jackknife_p(list(a_d.values()), r["buffer_sec"])
        jk = jackknife_conv(a_d, deps.get((r["to_line"], r["day_type"]), {}), r["buffer_sec"])
        if jk["p"] is None:      # D 출발 분포가 없으면 1차로 대체하고 표시
            jk = {**jk1, "ci_note": f"first_order_fallback:{jk1['ci_note']}"}
        cell = cells.set_index("dist_key").loc[key] if key in set(cells["dist_key"]) else None
        rows.append({k: clean(v) for k, v in {
            "combo_id": r["combo_id"], "tt_tag": r["tt_tag"], "day_type": r["day_type"],
            "station": r["station"], "to_station": r["to_station"],
            "from_line": r["from_line"], "in_dir": r["in_dir"], "to_line": r["to_line"], "out_dir": r["out_dir"],
            "a_dest": r["a_dest"], "d_dest": r["d_dest"], "a_terminal": bool(r["a_terminal"]),
            "same_line": bool(r["same_line"]),
            "arrive": hhmm(r["a_arr_sec"]), "arrive_sec": int(r["a_arr_sec"]),
            "depart": hhmm(r["d_dep_sec"]), "depart_sec": int(r["d_dep_sec"]),
            "walk_sec": int(r["walk_sec"]), "walk_src": r["walk_src"], "distance_m": r["distance_m"],
            "buffer_sec": int(r["buffer_sec"]), "buffer_min": round(r["buffer_sec"] / 60, 1),
            "p_success": jk["p"], "ci_low": jk["ci_low"], "ci_high": jk["ci_high"], "ci_note": jk["ci_note"],
            "p_first": jk1["p"],
            "dep_fallback": "/".join(deps["_fallback"].get((r["to_line"], r["day_type"]), ())) or None,
            "arr_fallback": ("/".join(last_a["_fallback"].get((r["from_line"], r["day_type"]), ())) or None)
                            if r["from_line"] in c.LASTK_A_LINES else None,
            "p_timetable": 1.0 if r["buffer_sec"] >= 0 else 0.0,
            "n_delay_obs": int(cell["n_obs"]) if cell is not None else 0,
            "n_nights": jk["n_nights"], "dist_key": key,
            "thin": bool(cell["thin"]) if cell is not None else True,
        }.items()})

    meta = {"generated_at": datetime.now().isoformat(timespec="seconds"),
            "commit": subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True,
                                     text=True, cwd=c.BASE_DIR).stdout.strip(),
            "provisional": True, "ci_method": "night_jackknife_t", "model": "second_order_conv",
            "nights": {"weekday": sum(1 for t in tags.values() if t[1] == "weekday"),
                       "weekend": sum(1 for t in tags.values() if t[1] == "weekend"), "list": nights},
            "train_until": train_until}
    prob = {"meta": meta, "rows": rows}

    dists = {}
    for _, cl in cells.iterrows():
        g = grid[grid["dist_key"] == cl["dist_key"]]
        dists[cl["dist_key"]] = {k: clean(v) for k, v in {
            "line": cl["line"], "day_type": cl["day_type"], "hour_band": cl["hour_band"],
            "n_obs": int(cl["n_obs"]), "n_nights": int(cl["n_nights"]),
            "median_sec": cl["median_sec"], "p90_sec": cl["p90_sec"], "thin": bool(cl["thin"]),
        }.items()}
        dists[cl["dist_key"]]["cdf"] = [round(float(x), 4) for x in g["cdf_ecdf"]]
    for k, nd in last_a.items():
        if k == "_fallback" or k[0] not in c.LASTK_A_LINES or not nd:
            continue
        line, day = k
        mat = np.vstack([np.searchsorted(v, GRID, side="right") / len(v) for v in nd.values()])
        allv = np.concatenate(list(nd.values()))
        dists[f"{line}|{day}|last3"] = {"line": line, "day_type": day, "hour_band": "last3",
                                        "n_obs": int(len(allv)), "n_nights": len(nd),
                                        "median_sec": float(np.median(allv)), "p90_sec": float(np.quantile(allv, 0.9)),
                                        "thin": len(nd) < 4, "cdf": [round(float(x), 4) for x in mat.mean(axis=0)]}
    cdf = {"meta": {**meta, "grid_sec": [int(x) for x in GRID], "grid_step_sec": 15}, "dists": dists}

    with open(c.PROCESSED_DIR / "station_alt_base.json", encoding="utf-8") as f:
        alt = json.load(f)
    day = pd.DataFrame(rows)
    # 지도 색: 시간표상 갈아탈 수 있는 조합(여유 ≥ 0) 중에서만 본다. 애초에 불가능한 조합(확률 0)을 섞으면
    # 거의 모든 역이 0%가 되어 "시간표로는 되는데 실제로는 위험한 곳"이 보이지 않는다.
    day = day[(day["tt_tag"] == "DAY") & day["p_success"].notna() & (day["buffer_sec"] >= 0)]
    day["sid"] = day["station"].replace({"이수": "총신대입구"})
    agg = day.groupby("sid")["p_success"].agg(["min", "median"])
    for s in alt["stations"]:
        if s["station"] in agg.index:
            s["worst_p"] = round(float(agg.loc[s["station"], "min"]), 4)
            s["median_p"] = round(float(agg.loc[s["station"], "median"]), 4)
    alt["meta"].update({k: meta[k] for k in ("generated_at", "commit", "provisional", "nights")})
    route_src = {"by_cell_d": by_cell_d, "last_a": last_a, "deps": deps, "nights": nights, "meta": meta}
    return prob, cdf, alt, route_src


def validate_json(prob: dict, cdf: dict, alt: dict) -> list[str]:
    errs = []
    rows = pd.DataFrame(prob["rows"])
    missing = set(rows["dist_key"].dropna()) - set(cdf["dists"])
    if missing:
        errs.append(f"delay_cdf에 없는 dist_key: {sorted(missing)[:5]}")
    stations = {s["station"] for s in alt["stations"]}
    rs = set(rows["station"].replace({"이수": "총신대입구"}))
    if rs - stations:
        errs.append(f"station_alt에 없는 역: {sorted(rs - stations)}")
    if rows.duplicated(["combo_id", "tt_tag"]).any():
        errs.append("(combo_id, tt_tag) 중복")
    for k, dd in cdf["dists"].items():
        if any(b < a - 1e-9 for a, b in zip(dd["cdf"], dd["cdf"][1:])):
            errs.append(f"CDF 단조 위반: {k}")
    p = rows.dropna(subset=["p_success"])
    ci = p.dropna(subset=["ci_low", "ci_high"])
    bad = ci[(ci["ci_low"] < -1e-9) | (ci["ci_low"] > ci["p_success"] + 1e-9)
             | (ci["p_success"] > ci["ci_high"] + 1e-9) | (ci["ci_high"] > 1 + 1e-9)]
    if len(bad):
        errs.append(f"0 ≤ ci_low ≤ p ≤ ci_high ≤ 1 위반 {len(bad)}건")
    return errs


def main() -> None:
    parser = argparse.ArgumentParser(description="앱 JSON 내보내기 (plan.md 작업 8)")
    parser.add_argument("--train-until", default=c.CONFIRM_START)
    args = parser.parse_args()
    prob, cdf, alt, route_src = build(args.train_until)
    errs = validate_json(prob, cdf, alt)
    if errs:
        print("검증 실패:\n  " + "\n  ".join(errs))
        sys.exit(1)
    WEB_DATA.mkdir(parents=True, exist_ok=True)
    total = 0
    for name, obj in (("prob_table", prob), ("delay_cdf", cdf), ("station_alt", alt)):
        path = WEB_DATA / f"{name}.json"
        path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        total += path.stat().st_size
        print(f"{path.relative_to(c.BASE_DIR)}: {path.stat().st_size / 1024:.0f}KB")
    rows = pd.DataFrame(prob["rows"])
    print(f"합계 {total / 1024:.0f}KB, 조합 행 {len(rows)}, 확률 있음 {int(rows['p_success'].notna().sum())}, "
          f"구간 있음 {int(rows['ci_low'].notna().sum())}, 밤 {prob['meta']['nights']}")
    errs = export_route.write_route_files(route_src, cdf, BAND_MEMBERS, WEB_DATA)
    if errs:
        print("귀가 경로 데이터 검증 실패:\n  " + "\n  ".join(errs))
        sys.exit(1)


if __name__ == "__main__":
    main()
