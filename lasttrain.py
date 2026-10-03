"""작업 3a. 환승역 막차 쌍과 버퍼 B 테이블.

조합 = (환승역, 타고 온 노선·방향, 갈아탈 노선·방향, 시간표 태그).
  A = 타고 온 노선·방향에서 그 역에 가장 늦게 도착하는 열차 (그 역 종착 포함, 급행 통과 행 제외)
  D = 갈아탈 노선·방향에서 그 역을 가장 늦게 출발하는 열차
  B = D 출발 − A 도착 − 도보시간. 음수면 시간표상 이미 못 갈아탄다.
DAY·SAT·END 세 벌을 모두 만든다. 지연 분포는 SAT·END를 weekend로 묶지만 막차 시각과 B는 요일 유형마다 다르다.

출력: data/processed/last_train_pairs.csv
사용: python lasttrain.py
"""

import numpy as np
import pandas as pd

import common as c
from preprocess import load_timetable

CONTESTED = (-120, 600)    # 경합 구간(초). 지연 몇 분에 성패가 갈리는 조합. 10/2 결정표 5번


def last_rows(tt: pd.DataFrame, time_col: str) -> pd.DataFrame:
    """(노선, 역명, 방향)마다 time_col이 가장 늦은 시간표 행. NaN과 급행 통과 행은 먼저 뺀다.

    verify_realtime.py는 NaN을 그대로 둔 채 정렬해 시발 열차 행이 '막차'로 뽑히는 버그가 있었다(174조합 중 11개).
    """
    ok = tt[tt[time_col].notna() & ~tt["pass_through"]]
    idx = ok.groupby(["line", "nm", "방향"])[time_col].idxmax()
    return ok.loc[idx]


def build_pairs(tt_tag: str) -> pd.DataFrame:
    tt = load_timetable(tt_tag)
    tag_day = "weekday" if tt_tag == "DAY" else "weekend"
    a = last_rows(tt, "arr_sec").rename(columns={
        "nm": "station", "line": "from_line", "방향": "in_dir", "uid": "a_uid", "열차코드": "a_code",
        "arr_sec": "a_arr_sec", "도착역": "a_dest", "급행여부": "a_express"})
    a["a_terminal"] = a["next_uid"].isna()          # 이 역에서 운행을 끝내는 열차
    d = last_rows(tt, "dep_sec").rename(columns={
        "nm": "to_station", "line": "to_line", "방향": "out_dir", "uid": "d_uid", "열차코드": "d_code",
        "dep_sec": "d_dep_sec", "도착역": "d_dest", "급행여부": "d_express"})

    tr = c.load_transfers()
    pairs = (tr.merge(a[["station", "from_line", "in_dir", "a_uid", "a_code", "a_arr_sec", "a_dest",
                         "a_express", "a_terminal"]], on=["station", "from_line"])
               .merge(d[["to_station", "to_line", "out_dir", "d_uid", "d_code", "d_dep_sec", "d_dest",
                         "d_express"]], on=["to_station", "to_line"]))
    # 같은 노선 지선 환승: 같은 열차를 계속 타는 경우와 같은 방향끼리는 환승이 아니다
    same = pairs["same_line"]
    pairs = pairs[~(same & ((pairs["a_code"] == pairs["d_code"]) | (pairs["in_dir"] == pairs["out_dir"])))]
    pairs = pairs.copy()
    pairs["tt_tag"], pairs["day_type"] = tt_tag, tag_day
    pairs["buffer_sec"] = pairs["d_dep_sec"] - pairs["a_arr_sec"] - pairs["walk_sec"]
    pairs["a_hour_band"] = c.hour_band(pairs["a_arr_sec"])
    pairs["contested"] = pairs["buffer_sec"].between(*CONTESTED)
    pairs["combo_id"] = (pairs["station"] + "|" + pairs["from_line"] + pairs["in_dir"] + ">"
                         + pairs["to_line"] + pairs["out_dir"])
    return pairs


COLS = ["combo_id", "tt_tag", "day_type", "station", "to_station", "from_line", "in_dir", "to_line",
        "out_dir", "same_line", "a_uid", "a_code", "a_arr_sec", "a_dest", "a_terminal", "a_express",
        "a_hour_band", "d_uid", "d_code", "d_dep_sec", "d_dest", "d_express", "walk_sec", "walk_src",
        "distance_m", "buffer_sec", "contested"]


def report(pairs: pd.DataFrame) -> None:
    """조합 수, 경합 조합, 시간대 분포, SAT와 END의 B 차이, EDA 대비 요약."""
    for tag, g in pairs.groupby("tt_tag", sort=False):
        neg = (g["buffer_sec"] < 0).mean()
        bands = g.loc[g["contested"], "a_hour_band"].value_counts().to_dict()
        print(f"{tag}: 조합 {len(g)}개(역 {g['station'].nunique()}), 시간표상 불가 {neg:.1%}, "
              f"B 중앙값 {g['buffer_sec'].median() / 60:.1f}분, 경합 {int(g['contested'].sum())}개 "
              f"(A 시간대 {bands}), 역방향 보충 도보 {int((g['walk_src'] == 'mirror').sum())}개")
    sat = pairs[pairs["tt_tag"] == "SAT"].set_index("combo_id")["buffer_sec"]
    end = pairs[pairs["tt_tag"] == "END"].set_index("combo_id")["buffer_sec"]
    both = sat.index.intersection(end.index)
    diff = (sat[both] - end[both]).abs()
    print(f"SAT와 END: 공통 조합 {len(both)}개 중 B가 다른 조합 {int((diff > 0).sum())}개 "
          f"(차이 최대 {diff.max() / 60:.0f}분)")
    eda_path = c.BASE_DIR / "data" / "eda" / "환승여유시간.csv"
    if eda_path.exists():
        eda = pd.read_csv(eda_path, encoding="utf-8-sig")
        day = pairs[pairs["tt_tag"] == "DAY"]
        print(f"EDA(API 시간표, 평일) 대비: 조합 {len(eda)} → {len(day)}, "
              f"시간표상 불가 {(eda['margin_sec'] < 0).mean():.1%} → {(day['buffer_sec'] < 0).mean():.1%}, "
              f"여유 중앙값 {eda['margin_sec'].median() / 60:.1f} → {day['buffer_sec'].median() / 60:.1f}분")
    # 막차 후보가 없어 조합이 빠진 (역, 노선) — 1호선 급행 통과 행 등
    tr = c.load_transfers()
    have = set(zip(pairs["station"], pairs["from_line"]))
    missing = sorted({(s, l) for s, l in zip(tr["station"], tr["from_line"]) if (s, l) not in have})
    print(f"도착 막차가 없어 빠진 (역, 타고 온 노선): {missing or '없음'}")


def main() -> None:
    pairs = pd.concat([build_pairs(tag) for tag in ("DAY", "SAT", "END")], ignore_index=True)
    assert pairs["a_arr_sec"].notna().all() and pairs["d_dep_sec"].notna().all(), "막차 시각 결측"
    assert not pairs.duplicated(["combo_id", "tt_tag"]).any(), "조합 중복"
    c.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    pairs[COLS].to_csv(c.PROCESSED_DIR / "last_train_pairs.csv", index=False, encoding="utf-8-sig")
    report(pairs)
    print(f"저장: data/processed/last_train_pairs.csv ({len(pairs)}행)")


if __name__ == "__main__":
    main()
