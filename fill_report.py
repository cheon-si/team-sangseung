"""작업 9. 보고서 초안의 {{키}} 자리표시자를 산출 파일 값으로 채운다. 숫자를 손으로 옮기지 않기 위해서다.

    python fill_report.py ../report/draft.md            → ../report/draft_filled.md
    python fill_report.py ../report/draft.md --check    자리표시자 밖 숫자 목록만 출력(출처 주석 점검용)

값은 data/processed, output/ 의 CSV에서 매번 다시 계산한다. 10/14 최종 재실행 뒤 다시 돌리면 숫자가 갱신된다.
"""

import argparse
import json
import re
import sys
from pathlib import Path

import pandas as pd

import common as c

PH = re.compile(r"\{\{([a-z0-9_]+)\}\}")


def pct(x, d=0):
    return f"{x * 100:.{d}f}%"


def values() -> dict:
    v = {}
    meta = pd.read_csv(c.PROCESSED_DIR / "night_meta.csv", dtype={"night": str})
    st = pd.read_csv(c.OUTPUT_DIR / "qa" / "night_status.csv", dtype={"night": str})
    v["n_nights"] = len(meta)
    v["n_weekday"] = int((meta["day_type"] == "weekday").sum())
    v["n_weekend"] = int((meta["day_type"] == "weekend").sum())
    v["n_normal"] = int((st["night_status"] == "정상").sum())
    v["n_partial"] = int((st["night_status"] == "부분").sum())
    v["n_pos_gap"] = int(meta["pos_gap_start_sec"].notna().sum())
    v["first_night"], v["last_night"] = meta["night"].min(), meta["night"].max()
    v["n_pos_rows"] = f"{int(meta['n_pos_rows'].sum()):,}"
    v["n_arr_rows"] = f"{int(meta['n_arr_rows_1to9'].sum()):,}"
    ev = pd.read_csv(c.PROCESSED_DIR / "delay_events.csv", usecols=["night", "status", "in_window"], dtype={"night": str})
    v["n_events"] = f"{len(ev):,}"
    v["match_rate_normal"] = pct(meta.loc[~meta["night"].isin(["20260924", "20260925", "20260927"]), "stamp_match_rate"].mean(), 1)

    pairs = pd.read_csv(c.PROCESSED_DIR / "last_train_pairs.csv")
    day = pairs[pairs["tt_tag"] == "DAY"]
    v["n_combos"] = len(day)
    v["n_stations"] = c.transfer_stations()["station_id"].nunique()
    v["share_impossible_day"] = pct((day["buffer_sec"] < 0).mean(), 1)
    v["n_contested_day"] = int(day["contested"].sum())
    v["n_contested_end"] = int(pairs[pairs["tt_tag"] == "END"]["contested"].sum())
    v["n_terminal"] = int(day["a_terminal"].sum())

    y = pd.read_csv(c.PROCESSED_DIR / "y_events.csv", dtype={"night": str})
    pre = y[~y["confirm_set"]]
    wk = pre[(pre["day_type"] == "weekday") & (pre["label_grade"] == "main")]
    v["main_per_night"] = f"{wk.groupby('night').size().mean():.0f}"
    v["contested_main_per_night"] = f"{wk[wk['contested']].groupby('night').size().mean():.0f}"
    b = pre[(pre["label_grade"] == "main") & pre["contested"] & pre["y"].notna() & pre["y_arr"].notna()]
    v["y_ne_yarr"] = pct((b["y"] != b["y_arr"]).mean(), 1)
    v["n_y_ne_yarr"] = len(b)
    v["d_delay_median"] = f"{b['d_delay_sec'].median():.0f}"
    a = pd.read_csv(c.OUTPUT_DIR / "qa" / "y_assumptions.csv")
    pd_row = a[a["check"].str.startswith("전역출발")].iloc[0]
    v["prev_dep_med"], v["prev_dep_p90"] = f"{pd_row['median_sec']:.0f}", f"{pd_row['p90_abs_sec']:.0f}"
    dw = a[a["check"].str.startswith("막차 D 정차")].iloc[0]
    v["dwell_med"] = f"{dw['median_sec']:.0f}"

    q = pd.read_csv(c.OUTPUT_DIR / "qa" / "night_qa.csv", dtype={"night": str})
    q = q[~q["tt_unknown"] & (q["night"] < c.CONFIRM_START) & (q["day_type"] == "weekday")]
    v["cov_a"], v["cov_d_direct"], v["cov_d_any"] = (pct(q[k].mean()) for k in
                                                     ["cov_last_a_any", "cov_last_d_direct", "cov_last_d_any"])

    for mode in ("dry", "confirm", "final"):
        f = c.OUTPUT_DIR / "validation" / f"{mode}_metrics.csv"
        if not f.exists():
            continue
        m = pd.read_csv(f)
        pm = m[m["subset"].str.startswith("primary")].set_index("model")
        for model in pm.index:
            k = f"{mode}_{model}"
            v[f"{k}_brier"] = f"{pm.loc[model, 'brier']:.3f}"
            if pd.notna(pm.loc[model].get("dbrier_ci_low")):
                v[f"{k}_dbrier"] = (f"{pm.loc[model, 'dbrier_vs_logit']:+.3f} "
                                    f"[{pm.loc[model, 'dbrier_ci_low']:.3f}, {pm.loc[model, 'dbrier_ci_high']:.3f}]")
            if pd.notna(pm.loc[model].get("calib_a")):
                v[f"{k}_calib"] = f"{pm.loc[model, 'calib_a']:.2f} / {pm.loc[model, 'calib_b']:.2f}"
        v[f"{mode}_n_labels"] = int(pm["n_labels"].iloc[0])
        v[f"{mode}_n_eval_nights"] = int(pm["n_nights"].iloc[0])
    mde = c.OUTPUT_DIR / "validation" / "mde.csv"
    if mde.exists():
        md = pd.read_csv(mde).set_index("n_nights")["mde"]
        v["mde_6"], v["mde_15"] = f"{md.get(6):.3f}", f"{md.get(15):.3f}"
    sim = c.OUTPUT_DIR / "validation" / "coverage_sim.csv"
    if sim.exists():
        s = pd.read_csv(sim)
        v["cov_jk_range"] = f"{s['coverage_jackknife_t'].min():.2f}~{s['coverage_jackknife_t'].max():.2f}"
        v["cov_boot_g3"] = f"{s.loc[s['G'] == 3, 'coverage_bootstrap_pct'].iloc[0]:.2f}"

    alt = json.loads((c.BASE_DIR / "web" / "public" / "data" / "station_alt.json").read_text(encoding="utf-8"))
    worst = sorted((s["worst_p"], s["station"]) for s in alt["stations"] if s["worst_p"] is not None)
    v["riskiest"] = ", ".join(f"{n}({p * 100:.0f}%)" for p, n in worst[:5])
    return v


def main() -> None:
    parser = argparse.ArgumentParser(description="보고서 자리표시자 채우기 (plan.md 작업 9)")
    parser.add_argument("draft")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    src = Path(args.draft)
    text = src.read_text(encoding="utf-8")
    if args.check:
        outside = PH.sub("", text)
        nums = sorted(set(re.findall(r"(?<![\w.])\d[\d,.]*%?", outside)))
        print("자리표시자 밖 숫자(날짜·조항 번호 포함, 출처 주석 확인 대상):", nums)
        return
    v = values()
    missing = sorted(set(PH.findall(text)) - set(v))
    out = PH.sub(lambda m: str(v.get(m.group(1), f"{{{{{m.group(1)}}}}}")), text)
    dst = src.with_name(src.stem + "_filled.md")
    dst.write_text(out, encoding="utf-8")
    print(f"저장: {dst}  (채운 키 {len(set(PH.findall(text))) - len(missing)}개, 값 없는 키 {missing or '없음'})")
    if missing:
        sys.exit(1)


if __name__ == "__main__":
    main()
