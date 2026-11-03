
import cv2
import time

CAMERA_INDEX = 1

cap = cv2.VideoCapture(CAMERA_INDEX)

print("Camera opened:", cap.isOpened())

if not cap.isOpened():
    print("Could not open USB camera.")
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
