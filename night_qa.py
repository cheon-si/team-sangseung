"""작업 2. 밤별 재현성 점검.

같은 규칙이 밤마다 같은 품질을 내는지 수치로 확인하고, 밤 상태(정상/부분/이상)를 정한다.
밤 상태는 지연 분포 적합과 검증의 포함 기준·민감도 기준이 된다.

밤 상태 기준(plan.md에서 바꾼 점: 위치 API 새벽 공백은 상태에서 뺐다):
  정상: 도착 API 틱 ≥ 76/80, 첫 틱 ≤ 22:05
  부분: 정상은 아니지만 도착 API 틱 ≥ 40
  이상: 그 밖
위치 API가 01:09~01:18부터 비는 현상이 15밤 중 8밤(대부분 평일)에서 같은 시각에 반복돼, 밤 품질이 아니라
구조적 현상으로 본다. pos_gap 열에 기록하고, 전처리의 관측 창 규칙(in_window)이 그 구간 위치 사건을 이미 뺀다.

출력:
    output/qa/night_qa.csv      밤 × 노선 품질 지표
    output/qa/night_status.csv  밤 상태와 사유

사용: python night_qa.py --all | --night YYYYMMDD
"""

import argparse

import numpy as np
import pandas as pd

import common as c
from preprocess import EVENTS_DIR, load_timetable

QA_DIR = c.OUTPUT_DIR / "qa"
TOL = {"match_rate": 0.02, "cov_transfer_any": 0.05, "delay_med_sec": 30}   # 같은 요일 유형 정상 밤 중앙값과의 허용 차이


def tick_status(meta: pd.Series) -> tuple[str, str]:
    reasons = []
    if meta["n_ticks_arr"] < 76:
        reasons.append(f"도착 틱 {meta['n_ticks_arr']}")
    if meta["first_tick"] > 79200 + 300:
        reasons.append(f"첫 틱 {int(meta['first_tick']) // 3600}:{int(meta['first_tick']) % 3600 // 60:02d}")
    if not reasons:
        return "정상", ""
    return ("부분" if meta["n_ticks_arr"] >= 40 else "이상"), ", ".join(reasons)


def night_rows(night: str, meta: pd.Series, fit: pd.DataFrame) -> list[dict]:
    stamps = pd.read_csv(EVENTS_DIR / f"stamps_{night}.csv", dtype={"line": str, "key": str})
    unm = pd.read_csv(EVENTS_DIR / f"unmatched_{night}.csv", dtype={"line": str, "key": str})
    ev = pd.read_csv(EVENTS_DIR / f"events_{night}.csv", dtype={"line": str, "key": str, "uid": str})
    tt = load_timetable(meta["tt_tag"])
    pairs = pd.read_csv(c.PROCESSED_DIR / "last_train_pairs.csv", dtype={"a_uid": str, "d_uid": str})
    pairs = pairs[pairs["tt_tag"] == meta["tt_tag"]]

    # 환승역 22시 이후 도착 예정 시간표 행 중, 그 열차가 그 밤 어딘가에서 관측된 행이 분모
    ts = c.transfer_stations()
    tr_rows = tt.merge(ts[["line", "station"]], left_on=["line", "nm"], right_on=["line", "station"])
    tr_rows = tr_rows[tr_rows["arr_sec"] >= 79200]
    seen = set(zip(stamps["line"], stamps["key"]))
    tr_rows = tr_rows[[(l, k) in seen for l, k in zip(tr_rows["line"], tr_rows["digits"])]]
    arr_ev = ev[ev["status"] == "arr"]
    have_any = set(arr_ev["uid"])
    have_pos = set(arr_ev.loc[arr_ev["src"] == "pos", "uid"])
    dep_direct = set(ev.loc[ev["status"] == "dep", "uid"])
    prev_dep = set(ev.loc[ev["status"] == "prev_dep", "uid"])

    rows = []
    for line in sorted(set(stamps["line"])):
        s_l, u_l = stamps[stamps["line"] == line], unm[unm["line"] == line]
        e_l = ev[(ev["line"] == line) & (ev["status"] == "arr") & ev["in_window"]]
        t_l = tr_rows[tr_rows["line"] == line]
        a_l = pairs[pairs["from_line"].astype(str) == line]
        d_l = pairs[pairs["to_line"].astype(str) == line]
        f_l = fit[fit["line"] == line]
        # D 출발: 직접 출발 또는 다음 역 '전역출발'(d_uid의 다음 행 uid에 prev_dep 사건)
        nxt = tt.set_index("uid")["next_uid"]
        d_prev = d_l["d_uid"].map(nxt).isin(prev_dep)
        rows.append({
            "night": night, "day_type": meta["day_type"], "tt_tag": meta["tt_tag"], "line": line,
            "tt_unknown": bool(f_l["tt_unknown"].any()) if len(f_l) else False,
            "obs_rate_23plus": float(f_l["obs_rate_23plus"].iloc[0]) if len(f_l) else np.nan,
            "n_stamps": len(s_l),
            "match_rate": 1 - len(u_l) / len(s_l) if len(s_l) else np.nan,
            "match_rate_pos": 1 - (u_l["src"] == "pos").sum() / max((s_l["src"] == "pos").sum(), 1),
            "match_rate_arr": 1 - (u_l["src"] == "arr_api").sum() / max((s_l["src"] == "arr_api").sum(), 1),
            "oow_pos_ratio": (u_l["reason"] == "out_of_window_pos").sum() / len(s_l) if len(s_l) else np.nan,
            "cov_transfer_pos": t_l["uid"].isin(have_pos).mean() if len(t_l) else np.nan,
            "cov_transfer_any": t_l["uid"].isin(have_any).mean() if len(t_l) else np.nan,
            "cov_last_a_any": a_l["a_uid"].isin(have_any).mean() if len(a_l) else np.nan,
            "cov_last_d_direct": d_l["d_uid"].isin(dep_direct).mean() if len(d_l) else np.nan,
            "cov_last_d_any": (d_l["d_uid"].isin(dep_direct) | d_prev).mean() if len(d_l) else np.nan,
            "dup_ratio": 1 - len(s_l) / s_l["n_raw"].sum() if len(s_l) else np.nan,
            "n_stale": int(((ev["line"] == line) & (ev["obs_sec"] >= 90300) & (ev["n_raw"] >= 6)).sum()),
            "n_ambiguous": int(((ev["line"] == line) & ev["ambiguous"]).sum()),
            "delay_med_sec": e_l["delay_sec"].median(), "delay_p90_sec": e_l["delay_sec"].quantile(0.9),
            "delay_p99_sec": e_l["delay_sec"].quantile(0.99), "n_delay": len(e_l),
        })
    return rows


def flag_outliers(qa: pd.DataFrame, status: pd.DataFrame) -> pd.Series:
    """같은 요일 유형 정상 밤들의 중앙값에서 허용치보다 벗어난 지표를 표시. 원인 확인 전에는 밤을 빼지 않는다."""
    ok_nights = set(status.loc[status["night_status"] == "정상", "night"])
    flags = pd.Series("", index=qa.index)
    base = qa[qa["night"].isin(ok_nights) & ~qa["tt_unknown"]]
    ref = base.groupby(["day_type", "line"])[list(TOL)].median()
    for i, r in qa.iterrows():
        if r["tt_unknown"]:
            flags[i] = "시간표 불일치"
            continue
        key = (r["day_type"], r["line"])
        if key not in ref.index:
            continue
        out = [f"{m} {r[m]:.3g}(기준 {ref.loc[key, m]:.3g})" for m, tol in TOL.items()
               if pd.notna(r[m]) and abs(r[m] - ref.loc[key, m]) > tol]
        flags[i] = "; ".join(out)
    return flags


def main() -> None:
    parser = argparse.ArgumentParser(description="밤별 재현성 점검 (plan.md 작업 2)")
    g = parser.add_mutually_exclusive_group()
    g.add_argument("--all", action="store_true")
    g.add_argument("--night", default=None)
    args = parser.parse_args()

    meta = pd.read_csv(c.PROCESSED_DIR / "night_meta.csv", dtype={"night": str})
    fit = pd.read_csv(c.PROCESSED_DIR / "tt_fit.csv", dtype={"night": str, "line": str})
    nights = meta["night"].tolist() if not args.night else [args.night]

    st_rows, qa_rows = [], []
    for _, m in meta[meta["night"].isin(nights)].iterrows():
        status, reason = tick_status(m)
        gap = m["pos_gap_start_sec"]
        st_rows.append({"night": m["night"], "day_type": m["day_type"], "tt_tag": m["tt_tag"],
                        "night_status": status, "reason": reason,
                        "pos_gap_start": "" if pd.isna(gap) else f"{int(gap) // 3600 - 24:02d}:{int(gap) % 3600 // 60:02d}",
                        "first_tick": f"{int(m['first_tick']) // 3600}:{int(m['first_tick']) % 3600 // 60:02d}",
                        "n_ticks_arr": int(m["n_ticks_arr"]), "n_ticks_pos": int(m["n_ticks_pos"]),
                        "confirm_set": m["night"] >= c.CONFIRM_START})
        qa_rows += night_rows(m["night"], m, fit[fit["night"] == m["night"]])
    status = pd.DataFrame(st_rows)
    qa = pd.DataFrame(qa_rows)
    qa["flags"] = flag_outliers(qa, status)

    QA_DIR.mkdir(parents=True, exist_ok=True)
    if args.night:   # 하루치만 갱신
        for name, df in (("night_status", status), ("night_qa", qa)):
            path = QA_DIR / f"{name}.csv"
            if path.exists():
                old = pd.read_csv(path, dtype={"night": str, "line": str})
                df = pd.concat([old[old["night"] != args.night], df], ignore_index=True)
            df.sort_values(list(df.columns[:1])).to_csv(path, index=False, encoding="utf-8-sig")
    else:
        status.to_csv(QA_DIR / "night_status.csv", index=False, encoding="utf-8-sig")
        qa.to_csv(QA_DIR / "night_qa.csv", index=False, encoding="utf-8-sig")

    print(status.to_string(index=False))
    show = qa.groupby("night").agg(match=("match_rate", "mean"), cov_tr=("cov_transfer_any", "mean"),
                                   cov_a=("cov_last_a_any", "mean"), cov_d=("cov_last_d_any", "mean"),
                                   cov_d_direct=("cov_last_d_direct", "mean"),
                                   flagged=("flags", lambda x: int((x != "").sum())))
    print("\n밤별 평균(노선 평균):")
    print(show.round(3).to_string())
    wk_ok = qa[(qa["day_type"] == "weekday") & qa["night"].isin(status.loc[status["night_status"] == "정상", "night"])
               & ~qa["tt_unknown"] & (qa["night"] < c.CONFIRM_START)]
    ev = pd.concat([pd.read_csv(EVENTS_DIR / f"events_{n}.csv", usecols=["status", "in_window", "delay_sec"])
                    for n in wk_ok["night"].unique()])
    p99 = ev.loc[(ev["status"] == "arr") & ev["in_window"], "delay_sec"].quantile(0.99)
    p01 = ev.loc[(ev["status"] == "arr") & ev["in_window"], "delay_sec"].quantile(0.01)
    print(f"\nTRUNC_W 제안(정상 평일 도착 지연 p99를 30초 단위 올림): {int(np.ceil(p99 / 30) * 30)}초 (현재 {c.TRUNC_W})")
    print(f"EARLY_E 제안(정상 평일 도착 지연 p1 절댓값): {abs(int(p01))}초 (현재 120)")
    flagged = qa[qa["flags"] != ""][["night", "line", "flags"]]
    print(f"\n표시된 (밤, 노선) {len(flagged)}건:")
    print(flagged.to_string(index=False))


if __name__ == "__main__":
    main()
