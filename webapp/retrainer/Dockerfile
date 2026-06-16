FROM python:3.11-slim

# ดีพเพนเดนซีสำหรับ FedAvg retrain (เบา ไม่ต้องใช้ lightgbm/xgboost)
RUN pip install --no-cache-dir numpy pandas scikit-learn joblib

WORKDIR /repo

# รันทันทีหนึ่งครั้ง แล้วเทรนซ้ำทุก 24 ชั่วโมง (รายวัน)
CMD ["sh", "-c", "while true; do echo \"[retrainer] $(date) start\"; python scripts/retrain.py || echo '[retrainer] failed'; echo \"[retrainer] sleep 24h\"; sleep 86400; done"]
