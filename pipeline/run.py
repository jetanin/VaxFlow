"""Orchestrator — รัน pipeline ครบ (แทน notebook nbconvert)

    features → forecast → optimize → evaluate   (+ train ถ้า VACFLOW_TRAIN=1)

ใช้โดย retrainer: `python -m pipeline.run`
"""
import os
import sys

from . import features, forecast, optimize, evaluate


def main():
    print("=== VacFlow pipeline ===", flush=True)
    features.build()
    forecast.build()
    optimize.build()
    evaluate.build()
    if os.environ.get("VACFLOW_TRAIN") == "1":
        from . import train          # ML benchmark (หนัก/GPU) — เปิดด้วย env
        train.build()
    print("=== pipeline done ===", flush=True)


if __name__ == "__main__":
    sys.exit(main())
