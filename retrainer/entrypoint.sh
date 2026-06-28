#!/bin/sh
# scheduler เบา ๆ: นอนจนถึง RUN_AT (ดีฟอลต์ 01:00) ของทุกวันแล้วเทรนใหม่
set -eu
RUN_AT="${RUN_AT:-01:00}"
echo "[retrainer] เริ่มทำงาน · ตั้งเวลาเทรนทุกวันเวลา $RUN_AT (TZ=${TZ:-UTC}) · $(date)"

# RUN_ON_START=1 → เทรนทันทีตอนสตาร์ต (ใช้ debug/ทดสอบ)
if [ "${RUN_ON_START:-0}" = "1" ]; then
  echo "[retrainer] RUN_ON_START=1 → เทรนทันที"
  python /retrainer/retrain.py || echo "[retrainer] retrain ล้มเหลว (จะรันรอบถัดไปตามเวลา)"
fi

while true; do
  now=$(date +%s)
  target=$(date -d "today $RUN_AT" +%s 2>/dev/null || date -d "$RUN_AT" +%s)
  if [ "$target" -le "$now" ]; then
    target=$(date -d "tomorrow $RUN_AT" +%s)
  fi
  wait_s=$((target - now))
  echo "[retrainer] รอบถัดไป $(date -d "@$target") (อีก ${wait_s}s)"
  sleep "$wait_s"
  echo "[retrainer] ===== เริ่มเทรน $(date) ====="
  python /retrainer/retrain.py || echo "[retrainer] retrain ล้มเหลว"
  echo "[retrainer] ===== จบรอบ $(date) ====="
done
