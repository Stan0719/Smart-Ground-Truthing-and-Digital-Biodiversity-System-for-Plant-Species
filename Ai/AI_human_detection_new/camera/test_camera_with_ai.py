import cv2
import time
from pathlib import Path
from ultralytics import YOLO, YOLOWorld

BASE_DIR = Path(__file__).resolve().parent

CAMERA_INDEX = 1
FRAME_SIZE = (960, 540)
PLANT_CONFIDENCE = 0.25

print("Loading AI models...")

model = YOLO(str(BASE_DIR / "yolov8n.pt"))
plant_model = YOLOWorld(str(BASE_DIR / "yolov8s-worldv2.pt"))
plant_model.set_classes(["plant", "potted plant"])
pose_model = YOLO(str(BASE_DIR / "yolov8n-pose.pt"))

print("Models loaded.")

cap = cv2.VideoCapture(CAMERA_INDEX)

print("Camera opened:", cap.isOpened())

if not cap.isOpened():
    exit()

frame_count = 0
fail_count = 0

try:
    start_time = time.monotonic()

    while time.monotonic() - start_time < 30:

        ret, frame = cap.read()

        if not ret:
            fail_count += 1
            print("Camera frame read FAILED!")
            break

        frame = cv2.resize(frame, FRAME_SIZE)

        inference_start = time.monotonic()

        # Same inference operations as cam.py
        results = model.track(
            frame,
            conf=0.5,
            imgsz=640,
            persist=True,
            verbose=False,
        )

        plant_results = plant_model.track(
            frame,
            conf=PLANT_CONFIDENCE,
            imgsz=640,
            persist=True,
            verbose=False,
        )

        pose_results = pose_model.predict(
            frame,
            conf=0.25,
            imgsz=640,
            verbose=False,
        )

        inference_time = time.monotonic() - inference_start

        frame_count += 1

        print(
            f"Frame {frame_count}: "
            f"Inference took {inference_time:.2f}s"
        )

finally:
    cap.release()
    cv2.destroyAllWindows()

print("\nTest finished.")
print("Successful frames:", frame_count)
print("Failed frames:", fail_count)