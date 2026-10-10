"""B 모형 외부 검증: 9/16~10/1 13밤으로 적합한 B 모형(앱 prob_table.json 의 p_b)을
모형이 보지 못한 10/2 이후 밤(확증 밤)의 실측 결과로 평가한다. (final-run 브랜치, main 앱·보고서 수치는 건드리지 않음)

성공 판정(B 보고서와 같은 기준): 표준 걸음 1.2m/s 로 걸었을 때 막차가 실제로 떠나기 전에 닿으면 성공.
    Y_B = 1[slack_b + Δ ≥ 0],  slack_b = 막차 시간표 출발 − 내 열차 시간표 도착 − 환승거리/1.2  (prob_table.slack_b_sec)
                               Δ = 막차 출발 지연 − 내 열차 도착 지연                         (y_events, 관측)
    label_y.py 의 y 는 도보를 walk_sec(서울교통공사 환승시간 등)로 쓰므로 B 기준과 다를 수 있어 다시 판정한다.
비교 대상: 시간표만 보는 판단 p_timetable = 1[slack ≥ 0] (B 보고서 Brier 기준선과 같은 정의).
평가 행: label_grade == main(A 도착·D 출발 직접 관측), prob_table 에 p_b 가 있는 막차 조합.

사용: python holdout_b.py   → 화면 출력 + output/holdout/holdout_b.csv
"""
import json

import numpy as np
import pandas as pd

import common as c

HOLDOUT_START = c.CONFIRM_START   # 20261002. 이 밤부터 B 모형 학습(9/16~10/1)에 쓰이지 않은 밤
OUT_DIR = c.OUTPUT_DIR / "holdout"
CONTESTED_SEC = 600          # |slack_b| ≤ 10분: 시간표만으로 결론이 안 나는 연결(쉬운 행을 뺀 민감도)


def load_rows() -> pd.DataFrame:
    """y_events(관측) + prob_table(13밤 B 모형 확률)을 막차 조합·요일 태그로 붙인다."""
    ev = pd.read_csv(c.PROCESSED_DIR / "y_events.csv", dtype={"night": str})
    ev = ev[(ev["label_grade"] == "main") & ev["a_delay_sec"].notna() & ev["d_delay_sec"].notna()]
    pt = pd.DataFrame(json.load(open(c.BASE_DIR / "web/public/data/prob_table.json", encoding="utf-8"))["rows"])
    pt = pt[pt["p_b"].notna()][["combo_id", "tt_tag", "p_b", "slack_b_sec", "p_timetable", "from_line", "to_line"]]
    df = ev.merge(pt, on=["combo_id", "tt_tag"], how="inner")
    df["delta"] = df["d_delay_sec"] - df["a_delay_sec"]
    df["y_b"] = (df["slack_b_sec"] + df["delta"] >= 0).astype(int)
    df["set"] = np.where(df["night"] >= HOLDOUT_START, "holdout", "train")
    return df


def brier(p: pd.Series, y: pd.Series) -> float:
    return float(np.mean((p - y) ** 2))


def summarize(df: pd.DataFrame) -> pd.DataFrame:
    """세트(학습 13밤 / 새 밤) × 요일 × (전체 / 경합 연결)별 Brier 와 감소율."""
    out = []
    for (st, dt), g0 in df.groupby(["set", "day_type"]):
        for scope, g in (("all", g0), ("contested", g0[g0["slack_b_sec"].abs() <= CONTESTED_SEC])):
            if g.empty:
                continue
            bm, bt = brier(g["p_b"], g["y_b"]), brier(g["p_timetable"], g["y_b"])
            out.append({"set": st, "day_type": dt, "scope": scope, "n_rows": len(g), "n_nights": g["night"].nunique(),
                        "success_rate": round(g["y_b"].mean(), 3), "mean_p_b": round(g["p_b"].mean(), 3),
                        "brier_timetable": round(bt, 4), "brier_b": round(bm, 4),
                        "reduction_pct": round((1 - bm / bt) * 100, 1) if bt > 0 else None})
    return pd.DataFrame(out)


def night_table(df: pd.DataFrame) -> pd.DataFrame:
    """새 밤 하나하나에서 B 가 시간표 판단보다 나았는지(보고서 '13밤 중 13밤 개선'과 같은 형식)."""
    h = df[df["set"] == "holdout"]
    rows = []
    for n, g in h.groupby("night"):
        rows.append({"night": n, "day_type": g["day_type"].iloc[0], "n_rows": len(g),
                     "brier_timetable": round(brier(g["p_timetable"], g["y_b"]), 4),
                     "brier_b": round(brier(g["p_b"], g["y_b"]), 4)})
    t = pd.DataFrame(rows)
    t["improved"] = t["brier_b"] < t["brier_timetable"]
    return t


def pooled_with_ci(df: pd.DataFrame, n_boot: int = 2000, seed: int = 0) -> dict:
    """새 밤 전체 Brier 감소율 + 밤 단위 붓스트랩 95% 구간(밤 안의 행끼리는 같은 날 지연을 공유해 독립이 아니므로 밤째로 뽑는다)."""
    h = df[df["set"] == "holdout"]
    groups = {n: g for n, g in h.groupby("night")}
    def red(g):
        return (1 - brier(g["p_b"], g["y_b"]) / brier(g["p_timetable"], g["y_b"])) * 100
    rng = np.random.default_rng(seed)
    names = list(groups)
    boots = [red(pd.concat([groups[n] for n in rng.choice(names, len(names))])) for _ in range(n_boot)]
    return {"n_rows": len(h), "n_nights": len(names), "brier_timetable": round(brier(h["p_timetable"], h["y_b"]), 4),
            "brier_b": round(brier(h["p_b"], h["y_b"]), 4), "reduction_pct": round(red(h), 1),
            "ci95": [round(float(np.percentile(boots, 2.5)), 1), round(float(np.percentile(boots, 97.5)), 1)]}


def calibration(df: pd.DataFrame) -> pd.DataFrame:
    """새 밤: 예측 확률 구간별 평균 예측 vs 실제 성공률(보정)."""
    h = df[df["set"] == "holdout"].copy()
    h["bin"] = pd.cut(h["p_b"], [0, 0.1, 0.5, 0.9, 0.99, 1.0001], right=False,
                      labels=["<10%", "10~50%", "50~90%", "90~99%", "≥99%"])
    return (h.groupby("bin", observed=True)
              .agg(n_rows=("y_b", "size"), mean_p_b=("p_b", "mean"), success_rate=("y_b", "mean"))
              .round(3).reset_index())


if __name__ == "__main__":
    df = load_rows()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT_DIR / "holdout_b.csv", index=False, encoding="utf-8-sig")

    nights = df.groupby("set")["night"].unique()
    print("밤:", {k: sorted(v) for k, v in nights.items()})
    # label_y 의 y(walk_sec 기준)와 B 기준 재판정이 얼마나 다른지
    print(f"y 와 y_b 불일치: {(df['y'] != df['y_b']).mean():.1%} ({(df['y'] != df['y_b']).sum()}행)")
    pd.set_option("display.width", 200)
    print("\n[Brier] train = B 학습 13밤(표본 내), holdout = 처음 보는 밤")
    print(summarize(df).to_string(index=False))
    print("\n[새 밤 전체 + 밤 단위 붓스트랩 95% 구간]", pooled_with_ci(df))
    print("\n[새 밤별]")
    print(night_table(df).to_string(index=False))
    print("\n[보정: 새 밤]")
    print(calibration(df).to_string(index=False))
