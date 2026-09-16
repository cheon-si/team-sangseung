"""시간표 기반 EDA: 막차 시각 분포와 이론적 환승 실패 지점.

실시간 수집 데이터가 쌓이기 전에도 시간표만으로 답할 수 있는 질문들을 본다.

핵심 질문
  1) 노선별·역별 막차 시각이 어떻게 분포하는가
  2) 지연이 0이라고 가정해도 갈아탈 수 없는 환승 조합이 있는가
  3) 환승 여유시간이 빠듯한 조합은 어디인가 (지연에 취약한 지점)

출력은 data/eda/ 에 CSV와 PNG로 떨어진다.
"""

import json
from collections import defaultdict
from pathlib import Path

import matplotlib
matplotlib.use("Agg")  # 화면 없는 환경에서 PNG로만 저장
import matplotlib.pyplot as plt
import pandas as pd

BASE_DIR = Path(__file__).resolve().parent
REF_DIR = BASE_DIR / "data" / "reference"
EDA_DIR = BASE_DIR / "data" / "eda"

# 한글 폰트. 없으면 축 라벨이 네모로 깨진다.
plt.rcParams["font.family"] = ["Malgun Gothic", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False


# ── 공용 ──────────────────────────────────────────────────

def to_seconds(value: str) -> int:
    """'24:48:00'처럼 24시를 넘는 운행 시각을 자정 기준 초로 바꾼다.

    지하철은 운영일 기준으로 시각을 매겨서 24, 25시 표기가 나온다.
    초 단위 정수로 두면 자정을 넘는 비교와 뺄셈이 그냥 된다.
    """
    hour, minute, second = (int(x) for x in value.strip().split(":"))
    return hour * 3600 + minute * 60 + second


def fmt(seconds: int) -> str:
    """초를 다시 '24:48' 표기로. 24시 넘는 값을 그대로 보여준다."""
    return f"{seconds // 3600:02d}:{seconds % 3600 // 60:02d}"


# ── 1단계: 적재 ───────────────────────────────────────────

def load_timetable() -> pd.DataFrame:
    """시간표 JSONL을 DataFrame으로. 출발 시각이 없는 행은 버린다."""
    rows = []
    with (REF_DIR / "timetable.jsonl").open(encoding="utf-8") as f:
        for line in f:
            rows.append(json.loads(line))
    df = pd.DataFrame(rows)

    # LEFTTIME이 '00:00:00'인 행은 그 역이 종착이라 출발 기록이 없는 경우다
    df = df[df["LEFTTIME"].notna() & (df["LEFTTIME"] != "00:00:00")].copy()
    df["left_sec"] = df["LEFTTIME"].map(to_seconds)
    df["line"] = df["LINE_NUM"].str.replace("호선", "", regex=False).str.lstrip("0")
    # 같은 역·요일·방향·열차가 중복 적재됐을 수 있으니 한 번 정리
    df = df.drop_duplicates(subset=["STATION_CD", "_week_tag", "_inout_tag", "TRAIN_NO", "LEFTTIME"])
    return df


def load_transfer() -> pd.DataFrame:
    """환승 소요시간 CSV. 'MM:SS' 표기를 초로 바꾼다."""
    df = pd.read_csv(REF_DIR / "transfer_time.csv")
    df.columns = ["seq", "line", "station", "to_line", "distance_m", "walk_time"]

    def walk_sec(v):
        minute, second = (int(x) for x in str(v).split(":"))
        return minute * 60 + second

    df["walk_sec"] = df["walk_time"].map(walk_sec)
    df["line"] = df["line"].astype(str)
    df["to_line"] = df["to_line"].astype(str).str.replace("호선", "", regex=False)
    return df


# ── 2단계: 막차 시각 ──────────────────────────────────────

def last_train_table(df: pd.DataFrame) -> pd.DataFrame:
    """역·방향별 막차 = 그 조합에서 가장 늦은 출발 시각."""
    weekday = df[df["_week_tag"] == 1]
    grouped = weekday.groupby(["line", "STATION_CD", "STATION_NM", "_inout_tag"])
    last = grouped["left_sec"].max().reset_index()
    last["last_train"] = last["left_sec"].map(fmt)
    return last.rename(columns={"_inout_tag": "inout", "left_sec": "last_sec"})


def plot_last_train_by_line(last: pd.DataFrame) -> None:
    """노선별 막차 시각 분포. 노선마다 막차가 얼마나 다른지 본다."""
    order = sorted(last["line"].unique(), key=lambda x: int(x))
    data = [last.loc[last["line"] == ln, "last_sec"] / 3600 for ln in order]

    fig, ax = plt.subplots(figsize=(10, 5))
    # matplotlib 3.9부터 labels -> tick_labels로 이름이 바뀌었다
    ax.boxplot(data, tick_labels=[f"{ln}호선" for ln in order], showfliers=True)
    ax.set_ylabel("막차 출발 시각 (시, 24시 이후는 24+)")
    ax.set_title("노선별 막차 시각 분포 (평일, 역·방향 단위)")
    ax.axhline(24, color="crimson", linestyle="--", linewidth=1, label="자정")
    ax.legend()
    ax.grid(axis="y", alpha=.3)
    fig.tight_layout()
    fig.savefig(EDA_DIR / "01_막차시각_노선별.png", dpi=140)
    plt.close(fig)


def plot_last_train_hist(last: pd.DataFrame) -> None:
    """전체 막차 시각 히스토그램. 어느 시간대에 몰려 있는지."""
    fig, ax = plt.subplots(figsize=(10, 4))
    ax.hist(last["last_sec"] / 3600, bins=48, color="#2b6cb0", edgecolor="white")
    ax.axvline(24, color="crimson", linestyle="--", linewidth=1)
    ax.set_xlabel("막차 출발 시각 (시)")
    ax.set_ylabel("역·방향 수")
    ax.set_title("막차 시각 분포 (평일, 1~9호선)")
    ax.grid(axis="y", alpha=.3)
    fig.tight_layout()
    fig.savefig(EDA_DIR / "02_막차시각_히스토그램.png", dpi=140)
    plt.close(fig)


# ── 3단계: 환승 여유시간 ──────────────────────────────────

def transfer_margin(df: pd.DataFrame, transfer: pd.DataFrame,
                    last: pd.DataFrame) -> pd.DataFrame:
    """환승역에서 '막차를 타고 와서 갈아탈 수 있는가'를 계산한다.

    여유시간 = (갈아탈 노선의 막차 출발) - (도착 노선의 막차 도착) - (환승 도보시간)
    음수면 지연이 0이어도 못 갈아탄다는 뜻이다.
    """
    # 도착 시각 기준 막차 (ARRIVETIME이 있는 행만)
    weekday = df[(df["_week_tag"] == 1) & df["ARRIVETIME"].notna()
                 & (df["ARRIVETIME"] != "00:00:00")].copy()
    weekday["arrive_sec"] = weekday["ARRIVETIME"].map(to_seconds)
    arrive_last = (weekday.groupby(["line", "STATION_NM", "_inout_tag"])["arrive_sec"]
                   .max().reset_index())

    # 출발 시각 기준 막차
    depart_last = last.groupby(["line", "STATION_NM", "inout"])["last_sec"].max().reset_index()

    records = []
    for _, t in transfer.iterrows():
        for in_dir in (1, 2):          # 도착 방향
            for out_dir in (1, 2):     # 환승 후 방향
                arr = arrive_last[(arrive_last["line"] == t["line"])
                                  & (arrive_last["STATION_NM"] == t["station"])
                                  & (arrive_last["_inout_tag"] == in_dir)]
                dep = depart_last[(depart_last["line"] == t["to_line"])
                                  & (depart_last["STATION_NM"] == t["station"])
                                  & (depart_last["inout"] == out_dir)]
                if arr.empty or dep.empty:
                    continue
                arr_sec = int(arr["arrive_sec"].iloc[0])
                dep_sec = int(dep["last_sec"].iloc[0])
                records.append({
                    "station": t["station"],
                    "from_line": t["line"],
                    "to_line": t["to_line"],
                    "in_dir": in_dir,
                    "out_dir": out_dir,
                    "arrive": fmt(arr_sec),
                    "depart": fmt(dep_sec),
                    "walk_sec": int(t["walk_sec"]),
                    "distance_m": int(t["distance_m"]),
                    "margin_sec": dep_sec - arr_sec - int(t["walk_sec"]),
                })
    out = pd.DataFrame(records)
    if not out.empty:
        out["margin_min"] = (out["margin_sec"] / 60).round(1)
        out = out.sort_values("margin_sec")
    return out


def plot_margin(margin: pd.DataFrame) -> None:
    """여유시간 분포. 0 아래가 '지연 없어도 실패'."""
    fig, ax = plt.subplots(figsize=(10, 4))
    clipped = margin["margin_min"].clip(-60, 120)
    ax.hist(clipped, bins=60, color="#2f855a", edgecolor="white")
    ax.axvline(0, color="crimson", linestyle="--", linewidth=1.5, label="여유 0분")
    ax.set_xlabel("환승 여유시간 (분, -60~120으로 자름)")
    ax.set_ylabel("환승 조합 수")
    ax.set_title("막차 환승 여유시간 분포 (평일, 지연 0 가정)")
    ax.legend()
    ax.grid(axis="y", alpha=.3)
    fig.tight_layout()
    fig.savefig(EDA_DIR / "03_환승여유시간_분포.png", dpi=140)
    plt.close(fig)


def plot_risky(margin: pd.DataFrame, top: int = 20) -> None:
    """여유시간이 빠듯한 조합 상위 N개. 지연에 가장 취약한 지점."""
    risky = margin[margin["margin_sec"] >= 0].head(top)
    if risky.empty:
        return
    labels = [f"{r.station} {r.from_line}→{r.to_line}호선" for r in risky.itertuples()]
    fig, ax = plt.subplots(figsize=(9, max(4, top * 0.32)))
    ax.barh(range(len(risky)), risky["margin_min"], color="#c05621")
    ax.set_yticks(range(len(risky)))
    ax.set_yticklabels(labels, fontsize=9)
    ax.invert_yaxis()
    ax.set_xlabel("환승 여유시간 (분)")
    ax.set_title(f"막차 환승이 가장 빠듯한 조합 상위 {top}개")
    ax.grid(axis="x", alpha=.3)
    fig.tight_layout()
    fig.savefig(EDA_DIR / "04_취약_환승조합.png", dpi=140)
    plt.close(fig)


# ── 실행 ──────────────────────────────────────────────────

def main() -> None:
    EDA_DIR.mkdir(parents=True, exist_ok=True)

    df = load_timetable()
    print(f"시간표 {len(df):,}행 / 역 {df['STATION_CD'].nunique()}개 / 노선 {df['line'].nunique()}개")

    last = last_train_table(df)
    last.to_csv(EDA_DIR / "막차시각_역별.csv", index=False, encoding="utf-8-sig")
    print(f"\n막차 테이블 {len(last)}행 (역 × 방향)")
    print("  노선별 막차 중앙값")
    for line, group in sorted(last.groupby("line"), key=lambda x: int(x[0])):
        print(f"    {line}호선  중앙 {fmt(int(group['last_sec'].median()))}  "
              f"최이른 {fmt(int(group['last_sec'].min()))}  최늦 {fmt(int(group['last_sec'].max()))}")

    plot_last_train_by_line(last)
    plot_last_train_hist(last)

    transfer = load_transfer()
    print(f"\n환승 조합 {len(transfer)}건 / 도보 중앙 {transfer['walk_sec'].median():.0f}초")

    margin = transfer_margin(df, transfer, last)
    if margin.empty:
        print("환승 여유시간 계산 결과가 비었습니다. 역명 매칭을 확인하세요.")
        return
    margin.to_csv(EDA_DIR / "환승여유시간.csv", index=False, encoding="utf-8-sig")
    plot_margin(margin)
    plot_risky(margin)

    report_margin(margin)
    print(f"\n결과 저장: {EDA_DIR}")


def report_margin(margin: pd.DataFrame) -> None:
    """여유시간 결과를 해석과 함께 출력한다.

    단순 실패 비율만 보면 오해하기 쉽다. 방향 조합 하나하나는 '그 경로로 갈아탈 수
    있는가'를 뜻할 뿐이고, 한 방향이 막혀도 반대 방향은 열려 있는 경우가 많다.
    그래서 조합 단위와 환승쌍 단위를 같이 본다.
    """
    fail = margin[margin["margin_sec"] < 0]
    print(f"\n[방향 조합 단위] {len(margin)}건 중 여유 음수 {len(fail)}건 "
          f"({len(fail) / len(margin) * 100:.1f}%)")
    print("  지연이 0이어도 그 경로로는 막차를 갈아탈 수 없다는 뜻이다.")

    # 환승쌍(역+노선쌍) 단위로 보면 방향 비대칭이 드러난다
    pair = margin.groupby(["station", "from_line", "to_line"])["margin_sec"]
    summary = pair.agg(["count", "max", "min"]).reset_index()
    both_ok = (summary["min"] >= 0).sum()
    none_ok = (summary["max"] < 0).sum()
    partial = len(summary) - both_ok - none_ok
    print(f"\n[환승쌍 단위] {len(summary)}쌍")
    print(f"  모든 방향 연결      {both_ok}쌍")
    print(f"  일부 방향만 연결    {partial}쌍")
    print(f"  모든 방향 불가      {none_ok}쌍")

    # 어느 노선으로 갈아탈 때 자주 놓치는가
    by_to = margin.assign(fail=margin["margin_sec"] < 0).groupby("to_line")["fail"]
    rate = by_to.agg(["sum", "count"])
    rate["rate"] = (rate["sum"] / rate["count"] * 100).round(1)
    print("\n[갈아탈 노선별 실패율] 그 노선 막차가 먼저 끊기는 정도")
    for line, row in rate.sort_values("rate", ascending=False).iterrows():
        print(f"  {line}호선  {int(row['sum']):>3}/{int(row['count']):>3}  {row['rate']:>5.1f}%")

    print("\n[여유 5분 이하 · 지연에 가장 취약한 지점]")
    tight = margin[(margin["margin_sec"] >= 0) & (margin["margin_sec"] <= 300)]
    print(f"  {len(tight)}건. 열차가 5분만 늦어도 실패로 뒤집힌다.")
    for r in tight.head(10).itertuples():
        print(f"    {r.station:<8} {r.from_line}→{r.to_line}호선  "
              f"도착 {r.arrive} 출발 {r.depart} 도보 {r.walk_sec:>3}초  여유 {r.margin_min:>4}분")


if __name__ == "__main__":
    main()
