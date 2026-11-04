from datetime import datetime
from pathlib import Path
import time

import cv2
from ultralytics import YOLO
from plant_contact import PlantContactMonitor

try:
    import winsound
except ImportError:
    winsound = None


WINDOW_NAME = "Plant Contact Monitor"
CAMERA_INDEX = 0
FRAME_SIZE = (960, 540)
PANEL_WIDTH = 300
ALERT_COOLDOWN_SECONDS = 3
RECORD_AFTER_HUMAN_GONE_SECONDS = 5
WRIST_CONFIDENCE = 0.5
CONTACT_HOLD_SECONDS = 0.6
CONTACT_MIN_FRAMES = 3

animal_classes = {
    "bird",
    "cat",
    "dog",
    "horse",
    "sheep",
    "cow",
    "elephant",
    "bear",
    "zebra",
    "giraffe",
    "lion",
    "tiger",
}


def put_text(frame, text, position, scale=0.7, color=(255, 255, 255), thickness=2):
    cv2.putText(
        frame,
        text,
        position,
        cv2.FONT_HERSHEY_SIMPLEX,
        scale,
        color,
        thickness,
        cv2.LINE_AA,
    )


def draw_button(frame, text, top_left, size, color):
    x, y = top_left
    width, height = size
    cv2.rectangle(frame, (x, y), (x + width, y + height), color, -1)
    cv2.rectangle(frame, (x, y), (x + width, y + height), (230, 230, 230), 1)
    put_text(frame, text, (x + 14, y + 31), 0.55, (255, 255, 255), 1)


def build_ui_frame(
    video_frame,
    human_count,
    animal_count,
    plant_count,
    contact_count,
    recording,
    paused,
    clip_count,
    recording_path,
):
    height, width = video_frame.shape[:2]
    ui_frame = cv2.copyMakeBorder(
        video_frame,
        0,
        0,
        0,
        PANEL_WIDTH,
        cv2.BORDER_CONSTANT,
        value=(28, 31, 36),
    )

    panel_x = width
    cv2.rectangle(ui_frame, (panel_x, 0), (panel_x + PANEL_WIDTH, height), (28, 31, 36), -1)
    put_text(ui_frame, "Detection Monitor", (panel_x + 22, 42), 0.75, (255, 255, 255), 2)
    put_text(ui_frame, "Live camera", (panel_x + 22, 72), 0.5, (170, 180, 190), 1)

    status = "PAUSED" if paused else "LIVE"
    status_color = (0, 190, 255) if paused else (70, 220, 120)
    cv2.circle(ui_frame, (panel_x + 32, 116), 8, status_color, -1)
    put_text(ui_frame, status, (panel_x + 50, 123), 0.65, status_color, 2)

    recording_color = (40, 40, 230) if recording else (95, 105, 115)
    recording_text = "RECORDING" if recording else "NOT RECORDING"
    cv2.circle(ui_frame, (panel_x + 32, 156), 8, recording_color, -1)
    put_text(ui_frame, recording_text, (panel_x + 50, 163), 0.58, recording_color, 2)

    cv2.rectangle(ui_frame, (panel_x + 20, 195), (panel_x + 280, 310), (42, 47, 54), -1)
    for row, (label, count, color) in enumerate([
        ("Humans", human_count, (70, 220, 120)),
        ("Animals", animal_count, (255, 170, 80)),
        ("Plant areas", plant_count, (80, 210, 210)),
        ("Possible contacts", contact_count, (80, 80, 255)),
    ]):
        y = 219 + row * 27
        put_text(ui_frame, label, (panel_x + 32, y), 0.52, color, 1)
        put_text(ui_frame, str(count), (panel_x + 235, y), 0.6, color, 2)

    cv2.rectangle(ui_frame, (panel_x + 20, 325), (panel_x + 280, 405), (42, 47, 54), -1)
    put_text(ui_frame, "Saved clips", (panel_x + 42, 358), 0.58, (210, 215, 220), 1)
    put_text(ui_frame, str(clip_count), (panel_x + 220, 362), 0.82, (255, 255, 255), 2)

    file_text = Path(recording_path).name if recording_path else "Waiting for human"
    if len(file_text) > 24:
        file_text = file_text[:21] + "..."
    put_text(ui_frame, file_text, (panel_x + 42, 390), 0.45, (165, 175, 185), 1)

    draw_button(ui_frame, "Space  Pause", (panel_x + 22, 445), (120, 42), (58, 69, 82))
    draw_button(ui_frame, "Q  Quit", (panel_x + 158, 445), (100, 42), (125, 55, 60))

    return ui_frame


def start_recording(recordings_dir, fps, frame_size):
    recordings_dir.mkdir(exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    recording_path = recordings_dir / f"human_detected_{timestamp}.mp4"
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(recording_path), fourcc, fps, frame_size)

    if not writer.isOpened():
        print("Error: Could not start video recording.")
        return None, ""

    print(f"Recording started: {recording_path}")
    return writer, str(recording_path)


def select_plant_area(frame, previous_area=None):
    print("Draw a box around the plant. Enter/Space confirms; Esc cancels.")
    x, y, width, height = cv2.selectROI(
        WINDOW_NAME, frame, showCrosshair=True, fromCenter=False,
    )
    if width > 0 and height > 0:
        return (int(x), int(y), int(x + width), int(y + height))
    return previous_area


model_dir = Path(__file__).resolve().parent
model = YOLO(str(model_dir / "yolov8n.pt"))
pose_model = YOLO(str(model_dir / "yolov8n-pose.pt"))
contact_monitor = PlantContactMonitor(CONTACT_HOLD_SECONDS, CONTACT_MIN_FRAMES)
cap = cv2.VideoCapture(CAMERA_INDEX)

if not cap.isOpened():
    print("Error: Could not open camera.")
    exit()

try:
    cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_NORMAL)
except cv2.error as error:
    cap.release()
    raise SystemExit(
        "OpenCV window support is unavailable. Install the desktop opencv-python "
        "package in this Python environment, rather than opencv-python-headless."
    ) from error

ret, frame = cap.read()
if not ret:
    cap.release()
    cv2.destroyAllWindows()
    raise SystemExit("Error: Could not read camera frame.")
frame = cv2.resize(frame, FRAME_SIZE)
plant_area = select_plant_area(frame)

camera_fps = cap.get(cv2.CAP_PROP_FPS)
recording_fps = camera_fps if camera_fps and camera_fps > 1 else 20
recording_size = (FRAME_SIZE[0] + PANEL_WIDTH, FRAME_SIZE[1])
recordings_dir = Path(__file__).resolve().parent / "recordings"

delay = 30
paused = False
last_contact_alert_time = float("-inf")
last_human_seen_time = 0
video_writer = None
recording_path = ""
saved_clip_count = 0
display_frame = None

unique_person_ids = set()
unique_animal_ids = set()

print("""
Controls:
[SPACE] = Pause / Play
[q]     = Quit
[r]     = Mark / replace the plant area
[c]     = Clear the plant area

When a human is detected, recording starts automatically.
Recording stops 5 seconds after the human is no longer detected.
Possible plant contact beeps after repeated wrist overlap with the marked area.
Re-mark the area if the camera or plant moves.
""")

while True:
    if not paused:
        ret, frame = cap.read()

        if not ret:
            print("Error: Could not read camera frame.")
            break

        frame = cv2.resize(frame, FRAME_SIZE)

        results = model.track(
            frame,
            conf=0.5,
            imgsz=640,
            persist=True,
            verbose=False,
        )

        human_count_frame = 0
        animal_count_frame = 0
        plants = [(1, plant_area)] if plant_area is not None else []
        plant_count_frame = len(plants)
        human_detected = False

        annotated_frame = frame.copy()

        if results and results[0].boxes is not None:
            for box in results[0].boxes:
                cls_id = int(box.cls.item())
                label = model.names[cls_id]

                if label == "person":
                    display_label = "Human"
                    color = (0, 255, 0)
                    human_detected = True
                    human_count_frame += 1
                elif label in animal_classes:
                    display_label = "Animal"
                    color = (255, 150, 40)
                    animal_count_frame += 1
                else:
                    continue

                obj_id = None
                if box.id is not None:
                    obj_id = int(box.id.item())

                if obj_id is not None:
                    if label == "person":
                        unique_person_ids.add(obj_id)
                    elif label in animal_classes:
                        unique_animal_ids.add(obj_id)

                x1, y1, x2, y2 = map(int, box.xyxy[0])
                cv2.rectangle(annotated_frame, (x1, y1), (x2, y2), color, 2)

                text = display_label
                if obj_id is not None:
                    text = f"{display_label} ID:{obj_id}"

                put_text(
                    annotated_frame,
                    text,
                    (x1, max(y1 - 10, 24)),
                    0.68,
                    color,
                    2,
                )

        if plant_area is not None:
            x1, y1, x2, y2 = plant_area
            cv2.rectangle(annotated_frame, (x1, y1), (x2, y2), (80, 210, 210), 2)
            put_text(annotated_frame, "Plant area", (x1, max(y1 - 10, 24)),
                     0.6, (80, 210, 210), 2)

        people = []
        if human_detected and plants:
            pose_results = pose_model.track(
                frame, conf=0.5, imgsz=640, persist=True, verbose=False,
            )
            if pose_results:
                pose = pose_results[0]
                if (pose.boxes is not None and pose.boxes.id is not None
                        and pose.keypoints is not None and pose.keypoints.conf is not None):
                    for person_id, points, confidences in zip(
                        pose.boxes.id.int().cpu().tolist(),
                        pose.keypoints.xy.cpu().tolist(),
                        pose.keypoints.conf.cpu().tolist(),
                    ):
                        wrists = []
                        # COCO pose indices 9 and 10 are left and right wrists.
                        for index in (9, 10):
                            x, y = points[index]
                            if confidences[index] >= WRIST_CONFIDENCE and (x > 0 or y > 0):
                                wrists.append((x, y))
                                cv2.circle(annotated_frame, (int(x), int(y)), 6, (255, 0, 255), -1)
                        people.append((person_id, wrists))

        now = time.monotonic()
        contacts = contact_monitor.update(people, plants, now)
        if contacts:
            put_text(annotated_frame, "ALERT: POSSIBLE PLANT CONTACT", (20, 44),
                     0.85, (0, 0, 255), 2)
            for plant_id, bounds in plants:
                if any(pair[1] == plant_id for pair in contacts):
                    x1, y1, x2, y2 = bounds
                    cv2.rectangle(annotated_frame, (x1, y1), (x2, y2), (0, 0, 255), 3)
            if now - last_contact_alert_time >= ALERT_COOLDOWN_SECONDS:
                print(f"ALERT: Possible plant contact! Pose person/plant area IDs: {sorted(contacts)}")
                if winsound is not None:
                    winsound.PlaySound("SystemExclamation", winsound.SND_ALIAS | winsound.SND_ASYNC)
                last_contact_alert_time = now

        if human_detected:
            last_human_seen_time = now

            if video_writer is None:
                video_writer, recording_path = start_recording(
                    recordings_dir,
                    recording_fps,
                    recording_size,
                )

        should_stop_recording = (
            video_writer is not None
            and not human_detected
            and now - last_human_seen_time >= RECORD_AFTER_HUMAN_GONE_SECONDS
        )

        if should_stop_recording:
            video_writer.release()
            video_writer = None
            saved_clip_count += 1
            print(f"Recording saved: {recording_path}")
            recording_path = ""

        display_frame = build_ui_frame(
            annotated_frame,
            human_count_frame,
            animal_count_frame,
            plant_count_frame,
            len(contacts),
            video_writer is not None,
            paused,
            saved_clip_count,
            recording_path,
        )

        if video_writer is not None:
            video_writer.write(display_frame)

    if display_frame is not None:
        cv2.imshow(WINDOW_NAME, display_frame)

    wait_time = 0 if paused else delay
    key = cv2.waitKey(wait_time) & 0xFF

    if key == ord("q"):
        print("Quit requested.")
        break

    if key == 32:
        paused = not paused
        contact_monitor.pending.clear()
        print("Paused" if paused else "Playing")

    if key in (ord("r"), ord("c")):
        plant_area = select_plant_area(frame, plant_area) if key == ord("r") else None
        contact_monitor.pending.clear()
        last_contact_alert_time = float("-inf")
        # Render the new area immediately, including when selection began paused.
        paused = False

if video_writer is not None:
    video_writer.release()
    saved_clip_count += 1
    print(f"Recording saved: {recording_path}")

cap.release()
cv2.destroyAllWindows()

print("\nFINAL UNIQUE COUNT SUMMARY")
print(f"Unique humans detected: {len(unique_person_ids)}")
print(f"Unique animals detected: {len(unique_animal_ids)}")
print(f"Saved human detection clips: {saved_clip_count}")
