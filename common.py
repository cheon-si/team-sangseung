"""분석 파이프라인 공통 규칙: 역명·열차번호 키, 시각 변환, 요일, 환승역, 상수.

규칙의 유일한 출처다. verify_realtime.py는 첫 검증 기록으로 남기고 고치지 않는다
(import하면 스크립트 전체가 실행되는 구조라 함수를 여기로 옮겨 적었다).
근거와 결정 과정은 plan.md 「공통 규약」 표.
"""

from datetime import date
from pathlib import Path

import pandas as pd

BASE_DIR = Path(__file__).resolve().parent
COLLECTED_DIR = BASE_DIR / "collected"
REF_DIR = BASE_DIR / "data" / "reference"
PROCESSED_DIR = BASE_DIR / "data" / "processed"
OUTPUT_DIR = BASE_DIR / "output"
TIMETABLE_CSV = REF_DIR / "서울교통공사_서울 도시철도 열차운행시각표_20260901.csv"
TRANSFER_CSV = REF_DIR / "transfer_time.csv"

# ── 상수 (10/2 결정표 9번에서 동결) ─────────────────────────
MATCH_WIN = (-600, 1800)      # 관측 − 시간표 기준 시각 허용 범위(초). 창 밖은 unmatched로 남김
TRUNC_W = 690                 # 관측 창 끝 절단 폭(초). 작업 2에서 확증 세트 전 정상 평일 도착 지연 p99(30초 올림)로 확정
HOUR_BANDS = {"22": (79200, 82800), "23": (82800, 86400), "24": (86400, 10**9)}
SEED = 20260916

# 달력상 평일이지만 휴일 시간표로 도는 날 (토요일 공휴일 포함)
HOLIDAYS = {"20260924", "20260925", "20260926", "20261003", "20261005", "20261009"}


# ── 요일 ────────────────────────────────────────────────────

def day_info(night: str) -> tuple[str, str]:
    """운영일(YYYYMMDD) → (시간표 태그, 요일 유형).

    공휴일과 일요일은 END, 그 밖의 토요일은 SAT, 나머지는 DAY.
    요일 유형은 DAY면 weekday, 그 외 weekend(지연 분포는 SAT·END를 묶어 쓴다).
    """
    d = date(int(night[:4]), int(night[4:6]), int(night[6:]))
    if night in HOLIDAYS or d.weekday() == 6:
        tag = "END"
    elif d.weekday() == 5:
        tag = "SAT"
    else:
        tag = "DAY"
    return tag, ("weekday" if tag == "DAY" else "weekend")


# ── 시각 ────────────────────────────────────────────────────

def hms_to_sec(s: pd.Series) -> pd.Series:
    """시간표 'HH:MM:SS' → 운영일 00:00 기준 초. 24·25시 표기는 그대로 둔다.

    null과 '00:00:00'은 NaN. 도착 '00:00:00'은 대부분 급행 통과 행이라 시각이 아니다.
    """
    s = s.where(s.notna() & (s != "00:00:00"))
    parts = s.str.split(":", expand=True)
    if parts.shape[1] < 3:
        return pd.Series(float("nan"), index=s.index)
    return parts[0].astype(float) * 3600 + parts[1].astype(float) * 60 + parts[2].astype(float)


def obs_sec(stamp: pd.Series, service_date: pd.Series) -> pd.Series:
    """관측 시각 문자열('YYYY-MM-DD HH:MM:SS') → 그 운영일 00:00 기준 초.

    자정을 넘긴 관측은 86400 이상이 된다(예: 00:30 → 88200). 시간표의 24시 표기와 같은 척도.
    """
    t = pd.to_datetime(stamp, format="%Y-%m-%d %H:%M:%S", errors="coerce")
    base = pd.to_datetime(service_date, format="%Y%m%d", errors="coerce")
    return (t - base).dt.total_seconds()


def hour_band(sched_sec: pd.Series) -> pd.Series:
    """시간표 시각 기준 시간대. 관측 시각으로 붙이면 늦은 23시대 열차가 24시대로 넘어가 지연이 부풀려진다."""
    out = pd.Series("pre", index=sched_sec.index, dtype=object)
    for band, (lo, hi) in HOUR_BANDS.items():
        out[(sched_sec >= lo) & (sched_sec < hi)] = band
    return out.where(sched_sec.notna(), None)


# ── 역명·열차번호 키 (verify_realtime.py 173~197행에서 옮김) ──

STATION_ALIAS = {
    # (노선, 실시간 표기) → 시간표 역사명. 괄호 제거만으로 안 되는 것들
    ("2", "성수종착"): "성수", ("2", "성수지선"): "성수", ("2", "신도림지선"): "신도림",
    ("4", "총신대입구(이수)"): "총신대입구", ("7", "총신대입구(이수)"): "이수",
    ("7", "뚝섬유원지"): "자양", ("7", "춘의역"): "춘의",
}


def norm_station(s: pd.Series, line: pd.Series | None = None) -> pd.Series:
    """역명 정규화: 노선별 별칭 → 괄호 이하 제거 → '서울'은 '서울역'.

    '성수종착'·'성수지선'·'신도림지선'은 종착 표시가 아니라 그 역에 있는 열차의 역명 자리에 찍히는 값이다.
    """
    out = s.copy()
    if line is not None:
        alias = pd.Series([STATION_ALIAS.get((l, n)) for l, n in zip(line, s)], index=s.index)
        out = alias.fillna(out)
    out = out.str.replace(r"\(.*\)$", "", regex=True).str.strip()
    return out.replace({"서울": "서울역"})


def match_key(line: pd.Series, trainno: pd.Series) -> pd.Series:
    """실시간 열차번호 → 시간표 열차코드 숫자부.

    2호선 본선은 실시간 첫 자리가 3·4·6·7·8이고 시간표는 2라서 '2'+뒷 세 자리로 맞춘다.
    지선(1xxx 성수지선, 5xxx 신정지선)과 2xxx는 그대로.
    """
    trainno = trainno.astype(str)
    digits = trainno.str.lstrip("0")
    is_main2 = (line == "2") & ~trainno.str[0].isin(["1", "2", "5"])
    return digits.where(~is_main2, "2" + trainno.str[-3:])


def timetable_digits(code: pd.Series) -> pd.Series:
    """시간표 열차코드(K1234, 2301 등) → 첫 숫자열에서 앞자리 0을 뗀 값."""
    return code.str.extract(r"(\d+)")[0].str.lstrip("0")


# ── 환승역 ──────────────────────────────────────────────────

# 환승 CSV의 노선명 중 1~9호선으로 읽을 것. 경원선 = 1호선 코레일 구간(석계 6→1).
# 국철(수서)은 수인분당선이라 제외.
TRANSFER_LINE_NAME = {f"{n}호선": str(n) for n in range(1, 10)} | {"경원선": "1"}

# 같은 물리 역인데 노선마다 시간표 역명이 다른 경우: (노선, CSV 표기) → 그 노선 시간표 역명
LINE_ALIAS = {("7", "총신대입구"): "이수", ("4", "이수"): "총신대입구"}


def load_transfers() -> pd.DataFrame:
    """1~9호선끼리 환승 행. 열: station(타고 온 노선 기준 역명), to_station(갈아탈 노선 기준 역명),
    from_line, to_line, walk_sec, distance_m, walk_src, same_line.

    반대 방향 행이 없는 쌍은 역방향 소요시간으로 채우고 walk_src='mirror'(양방향 같다는 가정).
    같은 노선끼리 행(성수 2호선 본선↔성수지선, 신도림 본선↔신정지선, 강동 5호선 하남↔마천)은
    실제 막차 환승이 일어나는 곳이라 남기고 same_line=True로 표시한다.
    같은 열차를 계속 타는 경우는 막차 쌍을 만들 때(lasttrain.py) 거른다.
    """
    tr = pd.read_csv(TRANSFER_CSV, encoding="utf-8", dtype=str)
    tr["from_line"] = tr["호선"].str.extract(r"(\d)")[0]
    tr["to_line"] = tr["환승노선"].map(TRANSFER_LINE_NAME)
    tr = tr.dropna(subset=["to_line"]).copy()
    mm, ss = tr["환승소요시간"].str.split(":", expand=True).astype(int).T.values
    tr["walk_sec"] = mm * 60 + ss
    tr["distance_m"] = pd.to_numeric(tr["환승거리"], errors="coerce")
    tr["station"] = tr["환승역명"]
    tr["to_station"] = [LINE_ALIAS.get((l, n), n) for l, n in zip(tr["to_line"], tr["station"])]
    tr["walk_src"] = "csv"
    tr["same_line"] = tr["from_line"] == tr["to_line"]
    base = tr[["station", "to_station", "from_line", "to_line", "walk_sec", "distance_m", "walk_src", "same_line"]]

    # 반대 방향 (갈아탈 노선 → 타고 온 노선) 행이 CSV에 없는 쌍만 뒤집어 채운다
    existing = set(zip(base["station"], base["from_line"], base["to_line"]))
    need = [(s, t, f) not in existing
            for s, t, f in zip(base["to_station"], base["to_line"], base["from_line"])]
    mirror = base[need].rename(columns={"station": "to_station", "to_station": "station",
                                        "from_line": "to_line", "to_line": "from_line"})
    mirror["walk_src"] = "mirror"
    return pd.concat([base, mirror[base.columns]], ignore_index=True)


def transfer_stations() -> pd.DataFrame:
    """환승역 목록. 열: station_id(물리 역 대표명), line, station(그 노선 시간표 역명)."""
    tr = load_transfers()
    rows = pd.concat([
        tr[["station", "from_line"]].rename(columns={"from_line": "line"}),
        tr[["to_station", "to_line"]].rename(columns={"to_station": "station", "to_line": "line"}),
    ]).drop_duplicates()
    rows["station_id"] = rows["station"].replace({"이수": "총신대입구"})
    return rows.sort_values(["station_id", "line"]).reset_index(drop=True)


# ── 확증 세트와 통계 보조 ───────────────────────────────────

# 10/2 이후 수집분은 확증 세트. 규칙·파라미터를 고르는 판단에는 이 날짜 전 밤만 쓴다(plan.md 작업 6).
CONFIRM_START = "20261002"

# t 분포 양측 95% 임계값(자유도 1~30). scipy 없이 잭나이프 구간에 쓴다. 30 초과는 1.96에 가깝게 근사.
T975 = {1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262,
        10: 2.228, 11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131, 16: 2.120, 17: 2.110,
        18: 2.101, 19: 2.093, 20: 2.086, 21: 2.080, 22: 2.074, 23: 2.069, 24: 2.064, 25: 2.060,
        26: 2.056, 27: 2.052, 28: 2.048, 29: 2.045, 30: 2.042}


def t975(df: int) -> float:
    return T975.get(df, 1.96 + 2.5 / df) if df >= 1 else float("nan")


def sign_test_p(k: int, n: int) -> float:
    """양측 부호검정 p값. n번 중 같은 부호가 k번(k ≥ n/2 가정)."""
    from math import comb
    if n == 0:
        return 1.0
    k = max(k, n - k)
    tail = sum(comb(n, i) for i in range(k, n + 1)) / 2 ** n
    return min(1.0, 2 * tail)

# 10/2 결정표 11번(작업 5-8): 막차 실측 도착 지연이 24시대 셀 분포와 다른 노선(sup > 0.05, 순열 p < 0.05, 확증 전 밤).
# 이 노선들은 타고 온 열차 분포를 "방향별 마지막 3편 도착 지연"으로 쓴다. 막차가 일반 열차보다 30~40초 더 늦었다.
LASTK_A_LINES = {"2", "4", "5"}
