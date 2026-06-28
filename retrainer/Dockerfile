# VaxFlow retrainer — เทรนโมเดลใหม่ตามตารางเวลา (ดีฟอลต์ 01:00 ทุกวัน)
# รัน notebook pipeline (03 feature → 04 train → 05 eval) แล้วสั่ง backend reseed
FROM python:3.11-slim

ENV TZ=Asia/Bangkok \
    PYTHONUTF8=1 \
    PYTHONIOENCODING=utf-8 \
    PIP_NO_CACHE_DIR=1

# tzdata = ให้ TZ มีผล (คำนวณ 01:00 ตามเวลาไทย) · libgomp1 = รันไทม์ของ xgboost/lightgbm
RUN apt-get update && apt-get install -y --no-install-recommends tzdata libgomp1 \
    && ln -sf /usr/share/zoneinfo/$TZ /etc/localtime \
    && rm -rf /var/lib/apt/lists/*

# pin numpy<2 / pandas<2.2 ให้ตรงพฤติกรรมกับที่ notebook ถูกพัฒนา/ทดสอบไว้
# (pandas>=2.2 เปลี่ยน groupby.apply ให้ตัด grouping columns ออก → notebook พัง)
RUN pip install \
    "numpy<2.0" "pandas<2.2" scipy scikit-learn xgboost lightgbm optuna matplotlib \
    jupyter nbconvert ipykernel requests

COPY retrain.py /retrainer/retrain.py
COPY entrypoint.sh /retrainer/entrypoint.sh
RUN chmod +x /retrainer/entrypoint.sh

WORKDIR /work
ENTRYPOINT ["/retrainer/entrypoint.sh"]
