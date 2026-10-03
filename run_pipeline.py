"""분석 파이프라인 한 번에 돌리기 (plan.md 목적 1).

10/14 이후에는 코드를 고치지 않고 이 파일만 다시 돌려 최종 수치를 만든다.
단계는 작업이 끝날 때마다 아래 STEPS에 추가한다.

사용:
    python run_pipeline.py            # 새로 들어온 밤만 반영
    python run_pipeline.py --force    # 전체 다시
"""

import argparse
import subprocess
import sys
import time

# (이름, 명령 인자). 순서대로 실행하고 하나라도 실패하면 멈춘다.
STEPS = [
    ("1 전처리", ["preprocess.py", "--nights", "all"]),
    ("3a 막차 쌍", ["lasttrain.py"]),
    ("2 밤별 점검", ["night_qa.py", "--all"]),
    ("3b 실측 Y", ["label_y.py"]),
    ("4 지연 분포", ["fit_delay.py", "--train-until", "20261002"]),
    # ("6 검증", ["validate.py", "--mode", "confirm"]),
    # ("6 최종", ["validate.py", "--mode", "final"]),
    ("7 역 대안", ["build_station_alt.py"]),
    ("8 앱 JSON", ["export_for_app.py"]),
]


def main() -> None:
    parser = argparse.ArgumentParser(description="분석 파이프라인 전체 실행")
    parser.add_argument("--force", action="store_true", help="이미 처리한 밤도 다시 처리")
    args = parser.parse_args()
    for name, cmd in STEPS:
        cmd = cmd + (["--force"] if args.force and cmd[0] == "preprocess.py" else [])
        started = time.time()
        print(f"── {name}: {' '.join(cmd)}", flush=True)
        result = subprocess.run([sys.executable, *cmd])
        if result.returncode != 0:
            raise SystemExit(f"{name} 실패 (종료 코드 {result.returncode})")
        print(f"   {time.time() - started:.0f}초", flush=True)


if __name__ == "__main__":
    main()
