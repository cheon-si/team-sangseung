"""1회성 참조 데이터 수집: 역 마스터, 막차 시간표, 역별 시간표.

실시간 수집과 달리 이 데이터는 언제 받아도 같다. 다만 역 × 요일 × 방향 조합이
많아 한 번에 다 받으면 호출 한도를 넘는다. 그래서 이 스크립트는 **재개 가능**하다.
이미 받은 조합은 건너뛰므로 며칠에 나눠 돌려도 된다.

사용:
    python fetch_reference.py --step master          # 역 마스터 (1콜)
    python fetch_reference.py --step lasttrain       # 막차 시간표
    python fetch_reference.py --step timetable       # 역별 전체 시간표 (환승역만)
    python fetch_reference.py --step lasttrain --limit 300
"""

import argparse
import json
import os
from pathlib import Path

from utils import fetch_json, load_env, log_line

BASE_DIR = Path(__file__).resolve().parent
REF_DIR = BASE_DIR / "data" / "reference"
LOG_PATH = BASE_DIR / "logs" / "reference.log"

API_HOST = "http://openapi.seoul.go.kr:8088"

# 서울교통공사가 시간표를 제공하는 노선. 이 범위 밖은 애초에 응답이 없다.
TARGET_LINE_NAMES = {
    "01호선", "02호선", "03호선", "04호선",
    "05호선", "06호선", "07호선", "08호선", "09호선",
}

# 요일 구분(1 평일 / 2 토요일 / 3 휴일)과 상하행(1 상행 / 2 하행).
# 응답의 WEEK_TAG, INOUT_TAG 값으로 역확인한 규칙이다.
WEEK_TAGS = [1, 2, 3]
INOUT_TAGS = [1, 2]


def api_key() -> str:
    """이 스크립트는 openapi.seoul.go.kr:8088만 쓴다 → '일반 인증키'.

    실시간 지하철 인증키(swopenapi용)를 넣으면 인증 오류가 난다. 두 키는 별개다.
    """
    key = os.environ.get("SEOUL_API_KEY", "").strip()
    if not key:
        raise SystemExit(
            "SEOUL_API_KEY가 없습니다. (일반 인증키)\n"
            "  열린데이터광장 인증키는 두 종류입니다. 이 스크립트는 '일반' 쪽입니다.\n"
            "  https://data.seoul.go.kr/together/guide/useGuide.do 에서\n"
            "  '일반 인증키 신청'으로 발급받으세요."
        )
    return key


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")


# ── 1단계: 역 마스터 ──────────────────────────────────────

def fetch_master(key: str) -> list:
    """전체 역 목록. 실시간 데이터와 시간표를 잇는 열쇠다."""
    url = f"{API_HOST}/{key}/json/SearchSTNBySubwayLineInfo/1/999/"
    body = fetch_json(url)["SearchSTNBySubwayLineInfo"]
    rows = body.get("row") or []
    log_line(LOG_PATH, f"역 마스터 {len(rows)}건 / 전체 {body.get('list_total_count')}건")
    write_json(REF_DIR / "station_master.json", rows)
    return rows


def load_master() -> list:
    path = REF_DIR / "station_master.json"
    if not path.exists():
        raise SystemExit("역 마스터가 먼저 필요합니다: python fetch_reference.py --step master")
    return json.loads(path.read_text(encoding="utf-8"))


def target_stations(master: list) -> list:
    """시간표를 받을 대상 역. 서울교통공사 운영 노선만 남긴다."""
    seen, out = set(), []
    for row in master:
        code = row.get("STATION_CD")
        if row.get("LINE_NUM") in TARGET_LINE_NAMES and code and code not in seen:
            seen.add(code)
            out.append(row)
    return out


# ── 2·3단계: 시간표 계열 (재개 가능) ──────────────────────

def fetch_schedule(key: str, service: str, out_name: str,
                   stations: list, limit: int, weeks: list = None) -> None:
    """역 × 요일 × 방향 조합을 순회한다. 이미 받은 조합은 건너뛴다.

    호출 한도 때문에 한 번에 다 못 받으므로, 받은 조합을 파일에 남겨
    다음 실행이 이어서 진행하도록 만들었다.
    """
    out_path = REF_DIR / f"{out_name}.jsonl"
    done_path = REF_DIR / f"{out_name}_done.json"
    done = set(json.loads(done_path.read_text(encoding="utf-8"))) if done_path.exists() else set()
    weeks = weeks or WEEK_TAGS

    calls = 0
    with out_path.open("a", encoding="utf-8") as sink:
        for station in stations:
            code = station["STATION_CD"]
            for week in weeks:
                for inout in INOUT_TAGS:
                    marker = f"{code}-{week}-{inout}"
                    if marker in done:
                        continue
                    if calls >= limit:
                        log_line(LOG_PATH, f"{out_name}: 이번 실행 상한 {limit}콜 도달. "
                                           f"누적 {len(done)}조합 완료. 다시 실행하면 이어집니다")
                        done_path.write_text(json.dumps(sorted(done)), encoding="utf-8")
                        return
                    url = f"{API_HOST}/{key}/json/{service}/1/999/{code}/{week}/{inout}/"
                    try:
                        body = fetch_json(url, timeout=25)[service]
                        calls += 1
                        code_value = (body.get("RESULT") or {}).get("CODE")
                        if code_value != "INFO-000":
                            # INFO-200(데이터 없음)은 진짜 없을 수도, 요청이 몰려
                            # 조용히 실패한 것일 수도 있다. done에 넣지 않고 다음
                            # 실행에서 다시 시도하게 둔다. (2026-09-16 실측: 동시
                            # 요청이 많을 때 정상 조합도 INFO-200으로 돌아왔다)
                            log_line(LOG_PATH, f"{marker} 비정상 code={code_value} (재시도 대상)")
                            continue
                        for row in body.get("row") or []:
                            row["_week_tag"] = week
                            row["_inout_tag"] = inout
                            sink.write(json.dumps(row, ensure_ascii=False) + "\n")
                        done.add(marker)
                        if calls % 100 == 0:
                            log_line(LOG_PATH, f"{out_name}: {calls}콜 진행, 누적 {len(done)}조합")
                    except Exception as error:
                        calls += 1
                        log_line(LOG_PATH, f"{marker} 실패: {type(error).__name__} {error}")

    done_path.write_text(json.dumps(sorted(done)), encoding="utf-8")
    log_line(LOG_PATH, f"{out_name}: {calls}콜 소모, 누적 {len(done)}조합 완료")


def transfer_stations(master: list, stations: list) -> list:
    """환승역만 추린다. 같은 역명이 여러 노선에 걸쳐 있으면 환승역이다."""
    name_count = {}
    for row in master:
        name_count[row.get("STATION_NM")] = name_count.get(row.get("STATION_NM"), 0) + 1
    return [s for s in stations if name_count.get(s.get("STATION_NM"), 0) > 1]


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser(description="참조 데이터 수집 (재개 가능)")
    parser.add_argument("--step", required=True,
                        choices=["master", "lasttrain", "timetable"])
    parser.add_argument("--limit", type=int, default=800,
                        help="이번 실행에서 쓸 최대 호출 수 (기본 800)")
    parser.add_argument("--week", type=int, nargs="+", choices=[1, 2, 3],
                        help="받을 요일 구분 (1 평일 / 2 토요일 / 3 휴일). 생략하면 전부")
    parser.add_argument("--all-stations", action="store_true",
                        help="시간표를 환승역이 아니라 대상 노선 전체 역으로")
    args = parser.parse_args()

    key = api_key()

    if args.step == "master":
        fetch_master(key)
        return

    master = load_master()
    stations = target_stations(master)

    if args.step == "lasttrain":
        log_line(LOG_PATH, f"막차 시간표 대상 {len(stations)}개 역")
        fetch_schedule(key, "SearchLastTrainTimeByIDService",
                       "last_train", stations, args.limit, args.week)
    else:
        picked = stations if args.all_stations else transfer_stations(master, stations)
        log_line(LOG_PATH, f"시간표 대상 {len(picked)}개 역, 요일 {args.week or WEEK_TAGS}")
        fetch_schedule(key, "SearchSTNTimeTableByIDService",
                       "timetable", picked, args.limit, args.week)


if __name__ == "__main__":
    main()
