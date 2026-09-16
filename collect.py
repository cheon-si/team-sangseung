"""심야 지하철 실시간 데이터 수집기.

22시부터 다음 날 2시까지 서울 지하철 실시간 열차 위치와 도착정보를 받아
원본 JSON 그대로 JSONL에 적재한다.

창을 2시까지 잡은 이유: 운행시각표 기준 평일 최종 도착이 25:14(새벽 1:14)다.
1시에 끊으면 2·4·7·9호선 막차의 종착 도착을 놓친다. 지연까지 감안해 2시.
간격을 3분으로 둔 이유: 4시간 × 3분 = 80틱, 틱당 10콜(위치 9 + 일괄 1) = 800콜.
하루 1,000콜 한도 안에 들어온다. 도착 시각 정밀도는 barvlDt 보간으로 보정한다.

실시간 데이터는 과거분을 다시 받을 수 없다. 한 번 놓친 밤은 영영 사라지므로
수집 실패도 로그에 남겨 결측 구조를 나중에 설명할 수 있게 한다.

사용:
    python collect.py                 # 오늘 밤 수집 (창 밖이면 시작까지 대기)
    python collect.py --once          # 1회만 수집하고 종료 (동작 확인용)
    python collect.py --dry-run       # 샘플키로 파싱만 검증, 파일 기록 없음
"""

import argparse
import json
import os
import time as time_module
import urllib.parse
from datetime import datetime, timedelta
from pathlib import Path

from utils import append_jsonl, fetch_json, load_env, log_line, service_date

BASE_DIR = Path(__file__).resolve().parent
RAW_DIR = BASE_DIR / "data" / "raw"
LOG_PATH = BASE_DIR / "logs" / "collect.log"
BUDGET_PATH = BASE_DIR / "data" / "call_budget.json"

API_HOST = "http://swopenapi.seoul.go.kr/api/subway"

# 분석 대상 노선. 서울교통공사 운영 구간으로 한정한다.
# 시간표·막차·환승소요시간 API가 이 범위만 제공하므로 여기에 맞췄다.
# (코레일 연장 구간, 신분당선, 경의중앙선, 공항철도는 제외 — 보고서에 명시할 것)
TARGET_LINES = [
    "1호선", "2호선", "3호선", "4호선",
    "5호선", "6호선", "7호선", "8호선", "9호선",
]

# 일일 호출 한도는 1,000건. 여유를 두고 950에서 멈춘다.
DEFAULT_BUDGET = 950
# 한 번에 요청할 수 있는 최대 행 수 (API 제약: 종료위치 - 시작위치 <= 1000)
PAGE_SIZE = 999
# 샘플키는 5행까지만 준다. dry-run에서 파싱을 검증하려면 이 값을 써야 한다.
SAMPLE_PAGE_SIZE = 5


# ── 호출 예산 ─────────────────────────────────────────────

def load_budget() -> dict:
    """운영일별 누적 호출 수. 스크립트를 재시작해도 이어서 센다."""
    if BUDGET_PATH.exists():
        return json.loads(BUDGET_PATH.read_text(encoding="utf-8"))
    return {}


def save_budget(budget: dict) -> None:
    BUDGET_PATH.parent.mkdir(parents=True, exist_ok=True)
    BUDGET_PATH.write_text(
        json.dumps(budget, ensure_ascii=False, indent=1), encoding="utf-8"
    )


def used_today(budget: dict, day: str) -> int:
    return budget.get(day, 0)


# ── API 호출 ──────────────────────────────────────────────

def fetch_positions(api_key: str, line: str, page_size: int = PAGE_SIZE) -> tuple[list, str]:
    """노선 하나의 전체 열차 위치. 노선당 1콜로 끝난다."""
    url = f"{API_HOST}/{api_key}/json/realtimePosition/0/{page_size}/{urllib.parse.quote(line)}"
    payload = fetch_json(url)
    info = payload.get("errorMessage") or payload
    rows = payload.get("realtimePositionList") or []
    return rows, info.get("code", "UNKNOWN")


def fetch_arrivals_bulk(api_key: str) -> tuple[list, str, int]:
    """전체 역 도착정보 일괄 조회. 정식키에서만 동작한다.

    주의: ALL 엔드포인트는 요청 범위(시작/끝)를 무시하고 매번 전체를 돌려준다.
    2026-09-16 실측으로 19개 노선 560개 역 약 2,900행이 한 번에 왔다.
    따라서 페이지를 넘기면 같은 데이터가 그만큼 중복 적재된다. 한 번만 부른다.
    """
    url = f"{API_HOST}/{api_key}/json/realtimeStationArrival/ALL/0/{PAGE_SIZE}/"
    payload = fetch_json(url, timeout=60)
    info = payload.get("errorMessage") or payload
    rows = payload.get("realtimeArrivalList") or []
    return rows, info.get("code", "UNKNOWN"), int(info.get("total") or 0)


# ── 한 틱 수집 ────────────────────────────────────────────

def collect_tick(api_key: str, day: str, budget: dict, dry_run: bool,
                 with_bulk: bool) -> int:
    """1회 수집. 반환값은 이번 틱에서 소모한 호출 수."""
    now = datetime.now()
    stamp = now.strftime("%Y-%m-%d %H:%M:%S")
    calls = 0
    page_size = SAMPLE_PAGE_SIZE if dry_run else PAGE_SIZE

    # 1) 노선별 열차 위치 — 노선당 1콜
    position_rows = []
    for line in TARGET_LINES:
        try:
            rows, code = fetch_positions(api_key, line, page_size)
            calls += 1
            if code != "INFO-000":
                log_line(LOG_PATH, f"position {line} 비정상 code={code}")
                continue
            for row in rows:
                row["_collected_at"] = stamp
                row["_service_date"] = day
                row["_line_query"] = line
            position_rows.extend(rows)
        except Exception as error:
            calls += 1  # 실패도 호출로 잡힐 수 있으니 보수적으로 센다
            log_line(LOG_PATH, f"position {line} 실패: {type(error).__name__} {error}")

    # 2) 전체 역 도착정보 일괄 — 정식키에서만
    arrival_rows = []
    if with_bulk:
        try:
            rows, code, total = fetch_arrivals_bulk(api_key)
            calls += 1
            if code != "INFO-000":
                log_line(LOG_PATH, f"arrival 일괄 비정상 code={code}")
            else:
                for row in rows:
                    row["_collected_at"] = stamp
                    row["_service_date"] = day
                arrival_rows = rows
                if total and len(rows) < total:
                    log_line(LOG_PATH, f"arrival 일괄 부분 수신 {len(rows)}/{total}행")
        except Exception as error:
            calls += 1
            log_line(LOG_PATH, f"arrival 일괄 실패: {type(error).__name__} {error}")

    if dry_run:
        log_line(LOG_PATH, f"[dry-run] 위치 {len(position_rows)}행 / 도착 {len(arrival_rows)}행, "
                           f"호출 {calls} (파일 기록 안 함)")
        if position_rows:
            print(json.dumps(position_rows[0], ensure_ascii=False, indent=1)[:600])
        return calls

    if position_rows:
        append_jsonl(RAW_DIR / f"position_{day}.jsonl", position_rows)
    if arrival_rows:
        append_jsonl(RAW_DIR / f"arrival_{day}.jsonl", arrival_rows)

    budget[day] = used_today(budget, day) + calls
    save_budget(budget)
    log_line(LOG_PATH, f"위치 {len(position_rows)}행 / 도착 {len(arrival_rows)}행 저장, "
                       f"호출 {calls} (누적 {budget[day]})")
    return calls


# ── 수집 창 제어 ──────────────────────────────────────────

def window_bounds(start_hour: int, end_hour: int, now: datetime) -> tuple[datetime, datetime]:
    """지금 겨냥해야 할 수집 창의 시작과 끝.

    자정을 넘는 창이라 주의가 필요하다. 새벽 0시 30분에 스크립트가 재시작되면
    '어젯밤 시작된 창이 아직 진행 중'이다. 이걸 놓치면 다음 밤까지 21시간을
    잠들어 그날 남은 수집분을 통째로 버린다.
    """
    duration = timedelta(hours=(end_hour - start_hour) % 24)
    start = now.replace(hour=start_hour, minute=0, second=0, microsecond=0)

    if now < start:
        # 어젯밤에 시작한 창이 아직 안 끝났는지 먼저 본다
        previous_start = start - timedelta(days=1)
        previous_end = previous_start + duration
        if now < previous_end:
            return previous_start, previous_end

    return start, start + duration


def main() -> None:
    load_env()  # 스케줄러가 python.exe를 직접 불러도 키를 읽게 한다
    parser = argparse.ArgumentParser(description="심야 지하철 실시간 데이터 수집기")
    parser.add_argument("--start-hour", type=int, default=22, help="수집 시작 시각 (기본 22)")
    parser.add_argument("--end-hour", type=int, default=2, help="수집 종료 시각 (기본 2)")
    parser.add_argument("--interval", type=int, default=180, help="수집 간격 초 (기본 180)")
    parser.add_argument("--budget", type=int, default=DEFAULT_BUDGET, help="일일 호출 상한")
    parser.add_argument("--once", action="store_true", help="1회만 수집하고 종료")
    parser.add_argument("--dry-run", action="store_true", help="샘플키로 파싱만 검증")
    parser.add_argument("--no-bulk", action="store_true", help="도착정보 일괄 조회 건너뛰기")
    args = parser.parse_args()

    # 이 스크립트는 swopenapi.seoul.go.kr만 쓴다.
    # 열린데이터광장 인증키는 두 종류이고, 이 도메인은 '실시간 지하철 인증키' 전용이다.
    # 일반 인증키를 넣으면 인증 오류가 난다. (참조 데이터용은 fetch_reference.py)
    api_key = "sample" if args.dry_run else os.environ.get("SEOUL_SUBWAY_KEY", "").strip()
    if not api_key:
        raise SystemExit(
            "SEOUL_SUBWAY_KEY가 없습니다. (실시간 지하철 인증키)\n"
            "  열린데이터광장 인증키는 두 종류입니다. 이 스크립트는 '실시간 지하철' 쪽입니다.\n"
            "  1) https://data.seoul.go.kr/together/guide/useGuide.do 에서\n"
            "     '실시간 지하철 인증키 신청'으로 발급받으세요.\n"
            "  2) .env.example을 .env로 복사하고 키를 넣으세요.\n"
            "  3) PowerShell에서 $env:SEOUL_SUBWAY_KEY='발급받은키' 로도 됩니다."
        )

    budget = load_budget()
    with_bulk = not args.no_bulk

    if args.once or args.dry_run:
        day = service_date(datetime.now()).strftime("%Y%m%d")
        collect_tick(api_key, day, budget, args.dry_run, with_bulk)
        return

    start, end = window_bounds(args.start_hour, args.end_hour, datetime.now())
    log_line(LOG_PATH, f"수집 창 {start:%m-%d %H:%M} ~ {end:%m-%d %H:%M}, "
                       f"{args.interval}초 간격, 상한 {args.budget}콜")

    wait = (start - datetime.now()).total_seconds()
    if wait > 0:
        log_line(LOG_PATH, f"시작까지 {wait / 60:.1f}분 대기")
        time_module.sleep(wait)

    while datetime.now() < end:
        day = service_date(datetime.now()).strftime("%Y%m%d")
        if used_today(budget, day) >= args.budget:
            log_line(LOG_PATH, f"일일 상한 {args.budget}콜 도달. 수집 중단")
            break
        tick_started = time_module.time()
        collect_tick(api_key, day, budget, False, with_bulk)
        elapsed = time_module.time() - tick_started
        time_module.sleep(max(0, args.interval - elapsed))

    log_line(LOG_PATH, "수집 창 종료")


if __name__ == "__main__":
    main()
