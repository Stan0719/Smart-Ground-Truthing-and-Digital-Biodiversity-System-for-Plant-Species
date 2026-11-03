import cv2
import time
from pathlib import Path
from ultralytics import YOLO, YOLOWorld

BASE_DIR = Path(__file__).resolve().parent
CAMERA_INDEX = 1

print("Loading AI models...")

model = YOLO(str(BASE_DIR / "yolov8n.pt"))
plant_model = YOLO(str(BASE_DIR / "yolov8s-worldv2.pt"))
plant_model.set_classes(["plant", "potted plant"])
pose_model = YOLO(str(BASE_DIR / "yolov8n-pose.pt"))

print("All models loaded.")
print("Opening USB camera...")

cap = cv2.VideoCapture(CAMERA_INDEX)

print("Camera opened:", cap.isOpened())

if not cap.isOpened():
    exit()

success_count = 0
fail_count = 0
start_time = time.monotonic()

while time.monotonic() - start_time < 10:
    ret, frame = cap.read()

    if ret:
        success_count += 1
        cv2.imshow("USB Camera Test", frame)
    else:
        fail_count += 1
        print("Frame read failed:", fail_count)

    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()

print("\nTest finished.")
print("Successful frames:", success_count)
print("Failed frames:", fail_count)