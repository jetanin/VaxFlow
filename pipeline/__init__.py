"""VacFlow data-science pipeline (pipeline-as-code)

สกัด logic จาก notebook 03/04/05 เป็น module ที่ import ได้ — รันใน production (retrainer)
โดยไม่พึ่ง jupyter/nbconvert (เปราะ + version-sensitive) · notebook เหลือไว้ explore/นำเสนอ

ขั้นตอน (pipeline.run):
  features → forecast → optimize → evaluate   (+ train ถ้า VACFLOW_TRAIN=1)
ใช้ vaccine-engine จริงทั้ง matching (solve_transport/screen_at_risk) และ pooling (consolidate_queue)
"""
