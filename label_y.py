"""작업 3b. 막차 환승 실측 Y — 검증의 정답지.

밤마다, 막차 쌍(조합)마다 실제로 갈아탈 수 있었는지를 관측으로 판정한다.
    Y     = 1[A 도착 관측 + 도보 ≤ D 출발 관측]      (실제 환승 성공)
    Y_arr = 1[A 지연 ≤ B]                           (갈아탈 막차가 정시 출발했다고 가정, 1차 모형이 예측하는 사건)

관측값 찾기 (plan.md 작업 3, 외부 리뷰 반영):
  - 막차 A·D는 매칭 전 원 스탬프(stamps_*.csv)에서 (노선, 열차번호 키, 역, 상태)로 직접 찾는다.
    매칭된 사건 테이블에는 창(+30분) 밖 스탬프가 없어 크게 늦은 막차를 놓치기 때문이다.
    스탬프가 여럿이면 시간표 시각 − 600초 이후 첫 스탬프.
  - A: 위치 API 도착 → 도착 API 도착 → 앞뒤 역 지연 보간(시간표 간격 10분 이하)
  - D: 출발 → 다음 역 '전역출발' → (도착만 있으면) 단측 하한 → 보간
    단측 하한: D의 도착 관측 시각 자체. A_obs + w ≤ D 도착 관측이면 성공 확정, 아니면 판정 불가(d_censored).
    '도착 + 시간표 정차'는 늦은 열차가 정차를 줄여 회복하므로 하한이 아니다.
라벨 등급:
  main      A가 직접 도착 관측, D가 직접 출발 또는 전역출발(가정 검증 통과 시)  ← 주 분석
  one_sided D가 단측 하한으로 성공 확정. 성공만 확정되고 실패는 빠지므로 주 분석에 넣으면 성공 쪽 편향 → 민감도만
  interp    보간 포함 → 민감도만
NA 사유: tt_unknown, a_not_seen, a_late_unseen(상류 관측됐는데 역 도착이 끝내 없음; 민감도에서 y=0), pos_gap,
        d_not_seen, d_censored

출력: data/processed/y_events.csv, output/qa/y_counts.csv, output/qa/y_assumptions.csv
사용: python label_y.py
"""

import numpy as np
import pandas as pd

import common as c
from preprocess import EVENTS_DIR, load_timetable

QA_DIR = c.OUTPUT_DIR / "qa"
LOOKBACK = 600            # 시간표 시각보다 이만큼 이전 스탬프는 다른 운행으로 본다
INTERP_MAX_GAP = 600      # 보간: 앞뒤 관측 역의 시간표 간격이 이 이하일 때만
LATE_MARGIN = 600         # a_late_unseen: D 출발 + 도보 + 이만큼 지나도 A 도착 스탬프가 없으면
CONTESTED = (-120, 600)
PREV_DEP_OK = {"med": 30, "p90": 60}     # 전역출발 = 출발 가정 통과 기준
INTERP_FLIP_OK = 0.05                    # 보간 라벨 불일치율(경합 구간) 허용치


# ── 조회 구조 ───────────────────────────────────────────────

def stamp_index(stamps: pd.DataFrame) -> dict:
    """(노선, 키, 역, 상태) → [(관측 초, 출처)] 시각순."""
    idx = {}
    s = stamps.sort_values("obs_sec")
    for (l, k, st, status), g in s.groupby(["line", "key", "station", "status"]):
        idx[(l, k, st, status)] = list(zip(g["obs_sec"].to_numpy(), g["src"].to_numpy()))
    return idx


def first_after(idx: dict, key: tuple, t0: float, prefer=("pos", "arr_api")):
    """t0 − LOOKBACK 이후 첫 스탬프. 출처 우선순위대로 찾는다."""
    lst = idx.get(key, [])
    for src in prefer:
        for t, s in lst:
            if s == src and t >= t0 - LOOKBACK:
                return float(t), src
    return None, None


def event_delays(events: pd.DataFrame) -> dict:
    """uid → 그 시간표 행에서 측정된 지연(도착 우선, 없으면 출발). 보간 재료."""
    e = events.sort_values(["status"])  # arr < dep < prev_dep
    e = e[e["status"].isin(["arr", "dep"])].drop_duplicates("uid", keep="first")
    return dict(zip(e["uid"], e["delay_sec"]))


def interp_delay(uid: str, tt_u: pd.DataFrame, train_rows: dict, delays: dict, exclude=None):
    """같은 열차의 앞뒤 역 측정 지연을 시간표 경과시간 비례로 선형 보간. 실패하면 None."""
    r = tt_u.loc[uid]
    rows = train_rows.get((r["line"], r["열차코드"]))
    if rows is None:
        return None
    seq = r["seq"]
    t_s = r["t_order"]
    prev = [(q.t_order, delays[q.uid]) for q in rows.itertuples() if q.seq < seq and q.uid in delays and q.uid != exclude]
    nxt = [(q.t_order, delays[q.uid]) for q in rows.itertuples() if q.seq > seq and q.uid in delays and q.uid != exclude]
    if not prev or not nxt:
        return None
    (t0, d0), (t1, d1) = prev[-1], nxt[0]
    if t1 - t0 > INTERP_MAX_GAP or t1 <= t0:
        return None
    return d0 + (d1 - d0) * (t_s - t0) / (t1 - t0)


def upstream_seen(uid: str, tt_u: pd.DataFrame, train_rows: dict, delays: dict) -> bool:
    r = tt_u.loc[uid]
    rows = train_rows.get((r["line"], r["열차코드"]), pd.DataFrame())
    return any(q.uid in delays for q in rows.itertuples() if q.seq < r["seq"])


# ── 라벨 ────────────────────────────────────────────────────

def label_night(night: str, pairs: pd.DataFrame, meta: pd.Series, unknown: set, prev_dep_ok: bool) -> pd.DataFrame:
    tt = load_timetable(meta["tt_tag"])
    tt_u = tt.set_index("uid")
    train_rows = {k: g for k, g in tt.groupby(["line", "열차코드"])}
    stamps = pd.read_csv(EVENTS_DIR / f"stamps_{night}.csv", dtype={"line": str, "key": str})
    events = pd.read_csv(EVENTS_DIR / f"events_{night}.csv", dtype={"line": str, "key": str, "uid": str})
    idx = stamp_index(stamps)
    delays = event_delays(events)
    gap = meta["pos_gap_start_sec"]
    last_tick = meta["last_tick"]

    out = []
    for r in pairs.itertuples():
        rec = {"night": night, "tt_tag": meta["tt_tag"], "day_type": meta["day_type"], "combo_id": r.combo_id,
               "buffer_sec": r.buffer_sec, "contested": r.contested, "walk_sec": r.walk_sec,
               "a_src": None, "a_obs_sec": np.nan, "d_src": None, "d_obs_sec": np.nan,
               "y": np.nan, "y_arr": np.nan, "label_grade": None, "na_reason": None}
        if r.from_line in unknown or r.to_line in unknown:
            rec["na_reason"] = "tt_unknown"
            out.append(rec)
            continue
        a_row, d_row = tt_u.loc[r.a_uid], tt_u.loc[r.d_uid]
        a_key = (r.from_line, a_row["digits"], r.station, "arr")

        # A 도착
        a_obs, a_src = first_after(idx, a_key, r.a_arr_sec)
        if a_obs is None:
            dly = interp_delay(r.a_uid, tt_u, train_rows, delays)
            if dly is not None:
                a_obs, a_src = r.a_arr_sec + dly, "interp"
        if a_obs is None:
            if not np.isnan(gap) and r.a_arr_sec > gap - c.TRUNC_W and not idx.get(a_key):
                rec["na_reason"] = "pos_gap"
            elif upstream_seen(r.a_uid, tt_u, train_rows, delays) and last_tick >= r.d_dep_sec + r.walk_sec + LATE_MARGIN:
                rec["na_reason"] = "a_late_unseen"
            else:
                rec["na_reason"] = "a_not_seen"
            out.append(rec)
            continue
        rec.update(a_obs_sec=a_obs, a_src=a_src, a_delay_sec=a_obs - r.a_arr_sec)
        rec["y_arr"] = float(a_obs - r.a_arr_sec <= r.buffer_sec)
        passenger = a_obs + r.walk_sec

        # D 출발
        d_obs, d_src = first_after(idx, (r.to_line, d_row["digits"], r.to_station, "dep"), r.d_dep_sec)
        if d_obs is not None:
            d_src = "dep"
        if d_obs is None and isinstance(d_row["next_uid"], str):
            nxt = tt_u.loc[d_row["next_uid"]]
            d_obs, _ = first_after(idx, (r.to_line, d_row["digits"], nxt["nm"], "prev_dep"), r.d_dep_sec)
            if d_obs is not None:
                d_src = "prev_dep"
        one_sided = False
        if d_obs is None:
            d_arr, _ = first_after(idx, (r.to_line, d_row["digits"], r.to_station, "arr"), r.d_dep_sec - 300)
            if d_arr is not None:
                if passenger <= d_arr:
                    d_obs, d_src, one_sided = d_arr, "arr_bound", True
                else:
                    rec.update(na_reason="d_censored", d_src="arr_bound", d_obs_sec=d_arr)
                    out.append(rec)
                    continue
        if d_obs is None:
            dly = interp_delay(r.d_uid, tt_u, train_rows, delays)
            if dly is not None:
                d_obs, d_src = r.d_dep_sec + dly, "interp"
        if d_obs is None:
            rec["na_reason"] = "d_not_seen"
            out.append(rec)
            continue
        rec.update(d_obs_sec=d_obs, d_src=d_src, d_delay_sec=d_obs - r.d_dep_sec)
        rec["y"] = float(passenger <= d_obs)
        if "interp" in (a_src, d_src):
            rec["label_grade"] = "interp"
        elif one_sided:
            rec["label_grade"] = "one_sided"
        elif d_src == "prev_dep" and not prev_dep_ok:
            rec["label_grade"] = "interp"     # 가정 검증 실패 시 전역출발은 주 라벨에서 뺀다
        else:
            rec["label_grade"] = "main"
        out.append(rec)
    df = pd.DataFrame(out)
    df["slack_sec"] = df["d_obs_sec"] - df["a_obs_sec"] - df["walk_sec"]
    return df


# ── 가정 검증 ───────────────────────────────────────────────

def check_prev_dep(nights: list[str]) -> dict:
    """전역출발(다음 역에서 찍힌 '앞 역 출발') 시각이 앞 역의 출발 관측과 같은 사건인지."""
    diffs = []
    for n in nights:
        tt = load_timetable(c.day_info(n)[0]).set_index("uid")
        e = pd.read_csv(EVENTS_DIR / f"events_{n}.csv", dtype={"uid": str})
        dep = e[e["status"] == "dep"].groupby("uid")["obs_sec"].min()
        pdp = e[e["status"] == "prev_dep"].groupby("uid")["obs_sec"].min()
        prev_uid = tt["prev_uid"].reindex(pdp.index)
        both = pd.DataFrame({"pd": pdp, "dep": dep.reindex(prev_uid.values).values}).dropna()
        diffs.append(both["pd"] - both["dep"])
    d = pd.concat(diffs)
    med, p90 = float(d.median()), float(d.abs().quantile(0.9))
    return {"check": "전역출발 = 앞 역 출발", "n": len(d), "median_sec": med, "p90_abs_sec": p90,
            "pass": abs(med) <= PREV_DEP_OK["med"] and p90 <= PREV_DEP_OK["p90"]}


def check_dwell(y: pd.DataFrame, nights: list[str]) -> dict:
    """막차 D의 정차 연장: 출발·도착이 둘 다 관측된 막차에서 (출발 − 도착) − 시간표 정차."""
    pairs = pd.read_csv(c.PROCESSED_DIR / "last_train_pairs.csv", dtype={"d_uid": str})
    vals = []
    for n in nights:
        tt = load_timetable(c.day_info(n)[0]).set_index("uid")
        e = pd.read_csv(EVENTS_DIR / f"events_{n}.csv", dtype={"uid": str})
        d_uids = set(pairs.loc[pairs["tt_tag"] == c.day_info(n)[0], "d_uid"])
        a = e[(e["status"] == "arr") & e["uid"].isin(d_uids)].groupby("uid")["obs_sec"].min()
        dp = e[(e["status"] == "dep") & e["uid"].isin(d_uids)].groupby("uid")["obs_sec"].min()
        both = pd.concat([a.rename("a"), dp.rename("d")], axis=1).dropna()
        sched = (tt["dep_sec"] - tt["arr_sec"]).reindex(both.index)
        vals.append((both["d"] - both["a"]) - sched)
    v = pd.concat(vals).dropna()
    return {"check": "막차 D 정차 연장(출발−도착−시간표 정차)", "n": len(v),
            "median_sec": float(v.median()) if len(v) else np.nan,
            "p90_abs_sec": float(v.abs().quantile(0.9)) if len(v) else np.nan, "pass": None}


def check_interp_flip(y: pd.DataFrame, all_pairs: pd.DataFrame) -> dict:
    """보간 검증: 주 라벨의 A 관측을 가리고 보간으로 다시 만든 y가 원래 y와 다른 비율(경합 구간)."""
    flips = []
    for n, g in y[(y["label_grade"] == "main")].groupby("night"):
        tag = c.day_info(n)[0]
        tt = load_timetable(tag)
        tt_u = tt.set_index("uid")
        train_rows = {k: gg for k, gg in tt.groupby(["line", "열차코드"])}
        delays = event_delays(pd.read_csv(EVENTS_DIR / f"events_{n}.csv", dtype={"uid": str}))
        p = all_pairs[all_pairs["tt_tag"] == tag].set_index("combo_id")
        for r in g.itertuples():
            pr = p.loc[r.combo_id]
            dly = interp_delay(pr["a_uid"], tt_u, train_rows, delays, exclude=pr["a_uid"])
            if dly is None:
                continue
            y2 = float(pr["a_arr_sec"] + dly + pr["walk_sec"] <= r.d_obs_sec)
            flips.append({"slack": abs(r.slack_sec), "contested": r.contested, "flip": y2 != r.y})
    f = pd.DataFrame(flips)
    if f.empty:
        return {"check": "보간 라벨 불일치율(경합 구간)", "n": 0, "median_sec": np.nan, "p90_abs_sec": np.nan, "pass": False}
    rate = float(f.loc[f["contested"], "flip"].mean()) if f["contested"].any() else np.nan
    bins = pd.cut(f["slack"], [0, 60, 180, np.inf], include_lowest=True)
    detail = f.groupby(bins, observed=False)["flip"].mean().round(3).to_dict()
    return {"check": "보간 라벨 불일치율(경합 구간)", "n": int(f["contested"].sum()), "median_sec": rate,
            "p90_abs_sec": np.nan, "pass": bool(rate <= INTERP_FLIP_OK) if not np.isnan(rate) else False,
            "detail": str({str(k): v for k, v in detail.items()})}


def check_one_sided(y: pd.DataFrame) -> dict:
    """단측 확정의 편향: 출발이 직접 관측된 주 라벨에서 '도착 관측 기준 확정'을 적용했을 때의 결과와 실제 y."""
    m = y[(y["label_grade"] == "main") & y["d_src"].eq("dep")].copy()
    return {"check": "단측 확정 규칙 점검(주 라벨 중 y=1 비율)", "n": len(m),
            "median_sec": float(m["y"].mean()) if len(m) else np.nan, "p90_abs_sec": np.nan, "pass": None}


def check_offsets(nights: list[str]) -> list[dict]:
    """출처 간 오프셋: 같은 열차·역·상태가 두 출처에 다 있을 때 (도착 API − 위치 API) 중앙값, 노선·상태별."""
    rows = []
    allv = []
    for n in nights:
        s = pd.read_csv(EVENTS_DIR / f"stamps_{n}.csv", dtype={"line": str, "key": str})
        g = s.groupby(["line", "key", "station", "status", "src"])["obs_sec"].min().unstack("src")
        if {"pos", "arr_api"} <= set(g.columns):
            allv.append((g["arr_api"] - g["pos"]).dropna().rename("d").reset_index())
    v = pd.concat(allv)
    for (line, status), gg in v.groupby(["line", "status"]):
        rows.append({"check": f"출처 오프셋 {line}호선 {status}(도착API−위치API)", "n": len(gg),
                     "median_sec": float(gg["d"].median()), "p90_abs_sec": float(gg["d"].abs().quantile(0.9)),
                     "pass": None})
    return rows


def main() -> None:
    meta = pd.read_csv(c.PROCESSED_DIR / "night_meta.csv", dtype={"night": str})
    fit = pd.read_csv(c.PROCESSED_DIR / "tt_fit.csv", dtype={"night": str, "line": str})
    status = pd.read_csv(QA_DIR / "night_status.csv", dtype={"night": str})
    pairs = pd.read_csv(c.PROCESSED_DIR / "last_train_pairs.csv",
                        dtype={"from_line": str, "to_line": str, "a_uid": str, "d_uid": str})
    nights = meta["night"].tolist()
    pre = [n for n in nights if n < c.CONFIRM_START]

    prev_chk = check_prev_dep(pre)
    print(f"가정 검증 — {prev_chk['check']}: n={prev_chk['n']}, 중앙 {prev_chk['median_sec']:.0f}초, "
          f"|차이| p90 {prev_chk['p90_abs_sec']:.0f}초 → {'통과' if prev_chk['pass'] else '실패'}")

    ys = []
    for _, m in meta.iterrows():
        unknown = set(fit.loc[(fit["night"] == m["night"]) & fit["tt_unknown"], "line"])
        ys.append(label_night(m["night"], pairs[pairs["tt_tag"] == m["tt_tag"]], m, unknown, prev_chk["pass"]))
    y = pd.concat(ys, ignore_index=True).merge(status[["night", "night_status"]], on="night", how="left")
    y["confirm_set"] = y["night"] >= c.CONFIRM_START
    c.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    y.to_csv(c.PROCESSED_DIR / "y_events.csv", index=False, encoding="utf-8-sig")

    checks = [prev_chk, check_dwell(y, pre), check_interp_flip(y[y["night"] < c.CONFIRM_START], pairs),
              check_one_sided(y[y["night"] < c.CONFIRM_START])] + check_offsets(pre)
    QA_DIR.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(checks).to_csv(QA_DIR / "y_assumptions.csv", index=False, encoding="utf-8-sig")

    cnt = y.groupby(["night", "day_type"]).apply(lambda g: pd.Series({
        "n_combos": len(g),
        "n_main": int((g["label_grade"] == "main").sum()),
        "n_one_sided": int((g["label_grade"] == "one_sided").sum()),
        "n_interp": int((g["label_grade"] == "interp").sum()),
        **{f"n_na_{k}": int((g["na_reason"] == k).sum()) for k in
           ["tt_unknown", "a_not_seen", "a_late_unseen", "pos_gap", "d_not_seen", "d_censored"]},
        "n_contested_main": int(((g["label_grade"] == "main") & g["contested"]).sum()),
        "y_rate_main": g.loc[g["label_grade"] == "main", "y"].mean(),
        "n_unique_a_main": g.loc[g["label_grade"] == "main", "combo_id"].str.split(">").str[0].nunique(),
    }), include_groups=False).reset_index()
    cnt.to_csv(QA_DIR / "y_counts.csv", index=False, encoding="utf-8-sig")

    print(cnt.to_string(index=False))
    for ch in checks[1:4]:
        print(f"가정 검증 — {ch['check']}: n={ch['n']}, 값 {ch['median_sec']}, p90 {ch.get('p90_abs_sec')}"
              f"{' ' + ch['detail'] if 'detail' in ch else ''}")
    main_c = y[(y["label_grade"] == "main") & y["contested"]]
    print(f"\n경합 구간 주 라벨: 전체 {len(main_c)}건, 평일 확증 전 밤당 "
          f"{main_c[(main_c['day_type'] == 'weekday') & ~main_c['confirm_set']].groupby('night').size().mean():.1f}건")
    both = y[(y["label_grade"] == "main") & y["contested"] & y["y"].notna() & y["y_arr"].notna()]
    print(f"경합 구간 Y ≠ Y_arr 비율: {(both['y'] != both['y_arr']).mean():.1%} (n={len(both)}) → "
          f"{'2차 모형(갈아탈 노선 지연 반영)을 주 모형으로' if (both['y'] != both['y_arr']).mean() >= 0.10 else '1차 모형 유지'}")


if __name__ == "__main__":
    main()
