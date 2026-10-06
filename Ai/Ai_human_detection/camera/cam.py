from datetime import datetime
from pathlib import Path
import time

import cv2
from ultralytics import YOLO

try:
    import winsound
except ImportError:
    winsound = None


WINDOW_NAME = "Human and Animal Detection"
CAMERA_INDEX = 0
FRAME_SIZE = (960, 540)
PANEL_WIDTH = 300
ALERT_COOLDOWN_SECONDS = 3
RECORD_AFTER_HUMAN_GONE_SECONDS = 5

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

    cv2.rectangle(ui_frame, (panel_x + 20, 195), (panel_x + 280, 295), (42, 47, 54), -1)
    put_text(ui_frame, "Humans", (panel_x + 42, 232), 0.62, (185, 235, 195), 1)
    put_text(ui_frame, str(human_count), (panel_x + 215, 236), 0.9, (70, 220, 120), 2)
    put_text(ui_frame, "Animals", (panel_x + 42, 272), 0.62, (190, 210, 255), 1)
    put_text(ui_frame, str(animal_count), (panel_x + 215, 276), 0.9, (255, 170, 80), 2)

    cv2.rectangle(ui_frame, (panel_x + 20, 325), (panel_x + 280, 405), (42, 47, 54), -1)
    put_text(ui_frame, "Saved clips", (panel_x + 42, 358), 0.58, (210, 215, 220), 1)
    put_text(ui_frame, str(clip_count), (panel_x + 220, 362), 0.82, (255, 255, 255), 2)

    file_text = Path(recording_path).name if recording_path else "Waiting for human"
    if len(file_text) > 24:
        file_text = file_text[:21] + "..."
    put_text(ui_frame, file_text, (panel_x + 42, 390), 0.45, (165, 175, 185), 1)

    draw_button(ui_frame, "Space  Pause", (panel_x + 22, 445), (120, 42), (58, 69, 82))
    draw_button(ui_frame, "Q  Quit", (panel_x + 158, 445), (100, 42), (125, 55, 60))
    put_text(ui_frame, "Human detection auto-saves video clips.", (panel_x + 22, 522), 0.4, (155, 165, 175), 1)

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


model = YOLO("yolov8n.pt")
cap = cv2.VideoCapture(CAMERA_INDEX)

if not cap.isOpened():
    print("Error: Could not open camera.")
    exit()

cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_NORMAL)

camera_fps = cap.get(cv2.CAP_PROP_FPS)
recording_fps = camera_fps if camera_fps and camera_fps > 1 else 20
recording_size = (FRAME_SIZE[0] + PANEL_WIDTH, FRAME_SIZE[1])
recordings_dir = Path(__file__).resolve().parent / "recordings"

delay = 30
paused = False
last_human_alert_time = 0
last_human_seen_time = 0
video_writer = None
recording_path = ""
saved_clip_count = 0

unique_person_ids = set()
unique_animal_ids = set()

print("""
Controls:
[SPACE] = Pause / Play
[q]     = Quit

When a human is detected, recording starts automatically.
Recording stops 5 seconds after the human is no longer detected.
""")

while True:
    display_frame = None

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

        now = time.time()

        if human_detected:
            last_human_seen_time = now
            put_text(
                annotated_frame,
                "ALERT: HUMAN DETECTED",
                (20, 44),
                1,
                (0, 0, 255),
                3,
            )

            if now - last_human_alert_time >= ALERT_COOLDOWN_SECONDS:
                print("ALERT: Human detected!")

                if winsound is not None:
                    winsound.Beep(1000, 300)

                last_human_alert_time = now

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
        print("Paused" if paused else "Playing")

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
