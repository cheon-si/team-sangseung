"""막차 프로젝트 공용 유틸.

팀 전원이 시각 파싱과 운영일 계산은 반드시 이 모듈만 쓴다.
각자 따로 처리하면 나중에 지연 계산이 하루씩 어긋난다.
"""

import json
import os
import urllib.error
import urllib.request
from datetime import date, datetime, time, timedelta
from pathlib import Path


def load_env(path: Path = None) -> None:
    """.env를 읽어 환경변수에 넣는다. 이미 설정된 값은 덮어쓰지 않는다.

    작업 스케줄러가 배치 파일 없이 python.exe를 직접 부를 수 있게 하려는 것이다.
    배치 파일로 환경변수를 넘기면 cmd 인코딩과 FOR 구문 때문에 조용히 실패한다.
    """
    path = path or Path(__file__).resolve().parent / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())

# 지하철 운영일 경계. 새벽 4시 이전은 전날 운영일로 친다.
# (막차가 24시를 넘겨 다니므로 달력 날짜로 끊으면 같은 밤이 이틀로 쪼개진다)
SERVICE_DAY_CUTOFF_HOUR = 4


def parse_service_time(value: str, base: date) -> datetime:
    """'24:48:00'처럼 24시를 넘는 운행 시각을 datetime으로 변환.

    공공 API의 막차·시간표 시각은 운영일 기준이라 24, 25시 표기가 나온다.
    파이썬 기본 파서는 이를 거부하므로 시(hour)를 24로 나눠 날짜를 넘긴다.
    """
    hour, minute, second = (int(x) for x in value.strip().split(":"))
    return datetime.combine(base, time(0)) + timedelta(
        days=hour // 24, hours=hour % 24, minutes=minute, seconds=second
    )


def service_date(moment: datetime) -> date:
    """해당 시각이 속한 지하철 운영일을 돌려준다.

    예) 9/16 00:30 은 9/15 운영일. 22시~익일 1시 수집분이 한 파일로 묶인다.
    """
    if moment.hour < SERVICE_DAY_CUTOFF_HOUR:
        return (moment - timedelta(days=1)).date()
    return moment.date()


def fetch_json(url: str, timeout: int = 20) -> dict:
    """서울 열린데이터광장 API 호출.

    Accept-Encoding을 identity로 고정한다. openapi.seoul.go.kr:8088 계열이
    일부 클라이언트에 인식 불가한 압축 헤더를 돌려주는 사례가 있어서다.
    표준 urllib만 쓰므로 추가 의존성이 없다.
    """
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "lastcall-collector/1.0 (KU AppliedStats)",
            "Accept-Encoding": "identity",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8", "ignore"))


def append_jsonl(path: Path, records: list) -> int:
    """레코드를 JSONL로 이어붙인다. 원본을 그대로 남겨 재분석 가능하게 한다."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        for record in records:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    return len(records)


def log_line(path: Path, message: str) -> None:
    """수집 로그. 실패 기록이 있어야 결측 구조를 보고서에 쓸 수 있다."""
    path.parent.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with path.open("a", encoding="utf-8") as f:
        f.write(f"[{stamp}] {message}\n")
    print(f"[{stamp}] {message}", flush=True)
