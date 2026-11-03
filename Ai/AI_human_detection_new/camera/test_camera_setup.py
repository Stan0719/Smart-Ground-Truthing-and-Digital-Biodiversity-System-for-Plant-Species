import cv2
import time

from cam import FixedPlantRegion, WINDOW_NAME, FRAME_SIZE

CAMERA_INDEX = 1

cap = cv2.VideoCapture(CAMERA_INDEX)

print("Camera opened:", cap.isOpened())

if not cap.isOpened():
    exit()

# Same window setup as cam.py
cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_NORMAL)

fixed_region = FixedPlantRegion()
cv2.setMouseCallback(WINDOW_NAME, fixed_region.on_mouse)

success_count = 0
fail_count = 0

start_time = time.monotonic()

while time.monotonic() - start_time < 10:
    ret, frame = cap.read()

    if ret:
        success_count += 1
        frame = cv2.resize(frame, FRAME_SIZE)
        cv2.imshow(WINDOW_NAME, frame)
    else:
        fail_count += 1
        print("Frame read failed:", fail_count)

    if cv2.waitKey(30) & 0xFF == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()

print("\nTest finished.")
print("Successful frames:", success_count)
print("Failed frames:", fail_count)