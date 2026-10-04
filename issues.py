"""작업 5. 미해결 항목 정리: 항목마다 영향 크기 수치 + 판단 기준 대비 결정.

포함 여부 판정은 "차이가 작다"가 아니라 무작위 대조로 한다: 같은 요일 유형 정상 밤에서 같은 수의 밤을
무작위로 뺐을 때 나오는 sup 차이의 95백분위와 비교한다(검정력 없는 점검을 동등성 근거로 쓰지 않기 위해).
판단에는 확증 세트 전 밤만 쓴다.

출력: output/qa/issue_5-N.csv 와 화면 요약
사용: python issues.py
"""

import itertools

import numpy as np
import pandas as pd

import common as c
from fit_delay import CONTESTED_X, load_delays, night_ecdf
from preprocess import EVENTS_DIR

QA = c.OUTPUT_DIR / "qa"
rng = np.random.default_rng(c.SEED)


def ecdf_mean(df: pd.DataFrame) -> np.ndarray:
    mat, _ = night_ecdf(df, CONTESTED_X)
    return mat.mean(axis=0) if len(mat) else np.full(len(CONTESTED_X), np.nan)


def drop_test(df: pd.DataFrame, drop: list[str], pool: list[str], reps: int = 200) -> dict:
    """drop 밤들을 뺐을 때의 sup 차이 vs 같은 수의 정상 밤을 무작위로 뺐을 때 sup 차이 95백분위."""
    full = ecdf_mean(df)
    obs = float(np.nanmax(np.abs(full - ecdf_mean(df[~df["night"].isin(drop)]))))
    k = len(drop)
    combos = list(itertools.combinations(pool, k))
    pick = combos if len(combos) <= reps else [combos[i] for i in rng.choice(len(combos), reps, replace=False)]
    null = [np.nanmax(np.abs(full - ecdf_mean(df[~df["night"].isin(cmb)]))) for cmb in pick]
    q95 = float(np.quantile(null, 0.95)) if null else np.nan
    return {"sup_drop": obs, "null_q95": q95, "n_null": len(null), "include": bool(obs <= q95)}


def issue_9_offset(d: pd.DataFrame) -> pd.DataFrame:
    """5-1 9호선 음수 오프셋: 밤별·급행별 지연 중앙값."""
    ev = pd.read_csv(c.PROCESSED_DIR / "delay_events.csv", dtype={"night": str, "line": str, "uid": str})
    e = ev[(ev["line"] == "9") & (ev["status"] == "arr") & ev["in_window"] & (ev["night"] < c.CONFIRM_START)]
    by_night = e.groupby("night")["delay_sec"].median()
    by_exp = e.groupby("express")["delay_sec"].median()
    out = pd.DataFrame({"night": by_night.index, "median_sec": by_night.values})
    rng_ = by_night.max() - by_night.min()
    exp_gap = abs(by_exp.get(1, np.nan) - by_exp.get(0, np.nan)) if len(by_exp) > 1 else np.nan
    out.attrs["summary"] = (f"밤별 중앙값 범위 {rng_:.0f}초(기준 ≤ 20초), 급행−일반 중앙값 차 {exp_gap:.0f}초(기준 30초) → "
                            + ("상수 오프셋으로 보고 노선 셀이 흡수, 보정 안 함" if rng_ <= 20 else "밤마다 달라 상수 오프셋 아님, 한계로 기록")
                            + ("; 급행 셀 분리 검토" if exp_gap > 30 else "; 급행 분리 안 함"))
    return out


def issue_14_missing() -> pd.DataFrame:
    """5-2 1·4호선 매칭 결손: 매칭 실패 사유와 열차번호 앞자리."""
    rows = []
    for f in sorted(EVENTS_DIR.glob("unmatched_*.csv")):
        n = f.stem.split("_")[1]
        if n >= c.CONFIRM_START:
            continue
        u = pd.read_csv(f, dtype={"line": str, "train_no": str})
        u = u[u["line"].isin(["1", "4"])]
        u["prefix"] = u["train_no"].str[:2]
        rows.append(u[["line", "reason", "prefix", "station"]])
    u = pd.concat(rows)
    t = u.groupby(["line", "reason"]).size().rename("n").reset_index()
    nocode = u[u["reason"] == "no_train_code"]
    top = nocode.groupby(["line", "prefix"]).size().sort_values(ascending=False).head(6)
    t.attrs["summary"] = ("시간표에 열차번호가 없는 스탬프의 번호 앞자리 상위: "
                          + ", ".join(f"{l}호선 {p}xx {v}건" for (l, p), v in top.items())
                          + ". 결정에 영향 없음(한계 기술용)")
    return t


def issue_partial_nights(d: pd.DataFrame) -> pd.DataFrame:
    """5-3 부분 수집 밤(9/18, 9/21) 포함 여부: 평일 24시대 ECDF 무작위 대조."""
    wk = d[(d["day_type"] == "weekday") & (d["hour_band"] == "24")]
    st = pd.read_csv(QA / "night_status.csv", dtype={"night": str})
    pool = st[(st["night_status"] == "정상") & (st["day_type"] == "weekday") & (st["night"] < c.CONFIRM_START)]["night"].tolist()
    r = drop_test(wk, ["20260918", "20260921"], pool)
    out = pd.DataFrame([r])
    out.attrs["summary"] = (f"두 밤을 뺀 sup 차이 {r['sup_drop']:.3f}, 무작위 2밤 제거 95백분위 {r['null_q95']:.3f} → "
                            + ("포함(기본값)" if r["include"] else "공백 창 이후 사건만 제외"))
    return out


def issue_chuseok(d: pd.DataFrame) -> pd.DataFrame:
    """5-4 추석(9/24·9/25·9/27): 시간표 불일치 노선은 자동 제외. 정상 노선(1·3·4·9)은 무작위 대조."""
    fit = pd.read_csv(c.PROCESSED_DIR / "tt_fit.csv", dtype={"night": str, "line": str})
    rows = []
    for line in ["1", "3", "4", "9"]:
        g = d[(d["day_type"] == "weekend") & (d["line"] == line)]
        pool = ["20260919", "20260920"]
        ch = [n for n in ["20260924", "20260925", "20260927"] if n in set(g["night"])]
        full = ecdf_mean(g)
        sup = float(np.nanmax(np.abs(full - ecdf_mean(g[~g["night"].isin(ch)]))))
        null = [np.nanmax(np.abs(full - ecdf_mean(g[g["night"] != p]))) for p in pool]
        rows.append({"line": line, "sup_drop_chuseok": sup, "null_max_drop1": float(max(null)),
                     "n_nonchuseok_nights": len(pool)})
    out = pd.DataFrame(rows)
    unk = fit[fit["tt_unknown"]].groupby("night")["line"].apply(",".join).to_dict()
    out.attrs["summary"] = (f"시간표 불일치 자동 제외: {unk}. 정상 노선은 추석 외 주말이 2밤뿐이라 무작위 대조가 사실상 불가 "
                            f"(sup 차이 {out['sup_drop_chuseok'].round(3).tolist()}). 정상 노선 포함(기본값), "
                            "추석 제외 분석은 필수 민감도로 검증에 포함")
    return out


def issue_coverage() -> pd.DataFrame:
    """5-5 막차 확보율 재계산."""
    q = pd.read_csv(QA / "night_qa.csv", dtype={"night": str, "line": str})
    q = q[~q["tt_unknown"] & (q["night"] < c.CONFIRM_START)]
    t = q.groupby("day_type")[["cov_transfer_any", "cov_last_a_any", "cov_last_d_direct", "cov_last_d_any"]].mean()
    t.attrs["summary"] = ("문서의 41%/76%(막차 확보율)를 대체: " + "; ".join(
        f"{k} A {r.cov_last_a_any:.0%}, D 직접 {r.cov_last_d_direct:.0%}, D 전역출발 포함 {r.cov_last_d_any:.0%}"
        for k, r in t.iterrows()))
    return t.reset_index()


def issue_line3_arr() -> pd.DataFrame:
    """5-7 3호선 도착 API 매칭률."""
    q = pd.read_csv(QA / "night_qa.csv", dtype={"night": str, "line": str})
    q = q[(q["line"] == "3") & ~q["tt_unknown"] & (q["night"] < c.CONFIRM_START)]
    m = q["match_rate_arr"].mean()
    t = q[["night", "match_rate_arr"]]
    t.attrs["summary"] = f"회송 3802~3983 제외 후 3호선 도착 API 매칭률 평균 {m:.1%} → " + ("종결(90% 초과)" if m > 0.9 else "한계에 기록")
    return t


def issue_pooling(d: pd.DataFrame) -> pd.DataFrame:
    """5-8 풀링 가정: (a) 환승역 사건만 vs 전 역, (b) 셀 분포 vs 막차 A 실측 지연(밤 순열)."""
    ts = c.transfer_stations()
    tr = set(zip(ts["line"], ts["station"]))
    cm = pd.read_csv(c.PROCESSED_DIR / "delay_cell_map.csv", dtype={"night": str, "uid": str})
    dd = d.merge(cm[["night", "uid", "dist_key"]], on=["night", "uid"])
    y = pd.read_csv(c.PROCESSED_DIR / "y_events.csv", dtype={"night": str})
    pairs = pd.read_csv(c.PROCESSED_DIR / "last_train_pairs.csv", dtype={"from_line": str, "a_hour_band": str})
    ya = y[(y["label_grade"] == "main") & (y["night"] < c.CONFIRM_START)].merge(
        pairs[["combo_id", "tt_tag", "from_line"]], on=["combo_id", "tt_tag"])
    ya = ya.drop_duplicates(["night", "from_line", "a_obs_sec"])          # 같은 A 열차 중복 제거
    rows = []
    for line in sorted(dd["line"].unique()):
        g = dd[(dd["line"] == line) & (dd["day_type"] == "weekday")]
        is_tr = [(l, s) in tr for l, s in zip(g["line"], g["station"])]
        sup_tr = float(np.nanmax(np.abs(ecdf_mean(g) - ecdf_mean(g[is_tr]))))
        a = ya[(ya["from_line"] == line) & (ya["day_type"] == "weekday")]
        late = g[g["hour_band"].isin(["24"])] if (g["hour_band"] == "24").any() else g
        if len(a) >= 20:
            va, vc = np.sort(a["a_delay_sec"].to_numpy()), np.sort(late["delay_sec"].to_numpy())
            Fa = np.searchsorted(va, CONTESTED_X, side="right") / len(va)
            Fc = np.searchsorted(vc, CONTESTED_X, side="right") / len(vc)
            sup_last = float(np.abs(Fa - Fc).max())
            # 밤 순열: 같은 밤 수만큼 셀 사건에서 무작위로 열차를 뽑아 막차 대신 넣었을 때의 sup 분포
            null = []
            for _ in range(200):
                s = np.sort(rng.choice(vc, len(va), replace=False))
                null.append(np.abs(np.searchsorted(s, CONTESTED_X, side="right") / len(s) - Fc).max())
            p = float(np.mean(np.array(null) >= sup_last))
        else:
            sup_last, p = np.nan, np.nan
        rows.append({"line": line, "sup_transfer_vs_all": sup_tr, "n_last_a": len(a),
                     "sup_last_vs_cell24": sup_last, "perm_p": p,
                     "redefine": bool(sup_last > 0.05 and p < 0.05) if not np.isnan(sup_last) else False})
    out = pd.DataFrame(rows)
    bad_tr = out.loc[out["sup_transfer_vs_all"] > 0.05, "line"].tolist()
    bad_last = out.loc[out["redefine"], "line"].tolist()
    out.attrs["summary"] = (f"환승역만 vs 전 역 sup > 0.05 노선: {bad_tr or '없음'}; 막차 A 지연이 셀(24시대)과 다른 노선"
                            f"(sup > 0.05, 순열 p < 0.05): {bad_last or '없음'} → "
                            + ("해당 노선 한계 첫 항목으로, 셀 재정의 검토" if bad_tr or bad_last else "현행 유지"))
    return out


def issue_incidents() -> pd.DataFrame:
    """추가: 밤×노선 지연 중앙값이 같은 요일 정상 밤 기준보다 크게 튄 경우(사고 의심)."""
    q = pd.read_csv(QA / "night_qa.csv", dtype={"night": str, "line": str})
    q = q[~q["tt_unknown"]]
    ref = q.groupby(["day_type", "line"])["delay_med_sec"].median()
    q["excess_sec"] = q["delay_med_sec"] - [ref[(d, l)] for d, l in zip(q["day_type"], q["line"])]
    t = q[q["excess_sec"] > 60][["night", "line", "delay_med_sec", "excess_sec", "delay_p90_sec"]].sort_values("excess_sec", ascending=False)
    t.attrs["summary"] = ("지연 중앙값이 기준보다 60초 넘게 높은 (밤, 노선): "
                          + ", ".join(f"{r.night[4:]} {r.line}호선 +{r.excess_sec:.0f}초" for r in t.itertuples())
                          + ". 9/22 2호선은 이대역 화재(보도 확인). 나머지는 미확인. 실제 지연이므로 제외하지 않음")
    return t


def main() -> None:
    QA.mkdir(parents=True, exist_ok=True)
    d = load_delays(c.CONFIRM_START)
    items = [("5-1", "9호선 음수 오프셋", issue_9_offset(d)),
             ("5-2", "1·4호선 매칭 결손", issue_14_missing()),
             ("5-3", "부분 수집 밤 포함", issue_partial_nights(d)),
             ("5-4", "추석 연휴", issue_chuseok(d)),
             ("5-5", "막차 확보율", issue_coverage()),
             ("5-7", "3호선 도착 API", issue_line3_arr()),
             ("5-8", "풀링 가정", issue_pooling(d)),
             ("5-x", "사고 의심 밤", issue_incidents())]
    for code, name, df in items:
        df.to_csv(QA / f"issue_{code}.csv", index=False, encoding="utf-8-sig")
        print(f"[{code}] {name}: {df.attrs.get('summary', '')}")


if __name__ == "__main__":
    main()
