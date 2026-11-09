from datetime import datetime
from pathlib import Path
import os
import time

import cv2
from ultralytics import YOLO, YOLOWorld

if __package__:
    from . import camera_server
    from .iot_movement import IoTMovementSource
else:
    import camera_server
    from iot_movement import IoTMovementSource

try:
    import winsound
except ImportError:
    winsound = None


WINDOW_NAME = "Human and Animal Detection"
BASE_DIR = Path(__file__).resolve().parent
CAMERA_INDEX = 0
FRAME_SIZE = (960, 540)
PANEL_WIDTH = 300
ALERT_COOLDOWN_SECONDS = 3
RECORD_AFTER_CONTACT_SECONDS = 5
PLANT_CONFIDENCE = 0.25
WRIST_CONFIDENCE = 0.35
PLANT_CONTACT_SECONDS = 2.0
WRIST_REACH_PIXELS = 24
RECORDING_SIZE = (640, 360)
RECORDING_FPS = 60


class EventVideoWriter:
    def __init__(self, writer, fps, frame_size):
        self.writer = writer
        self.fps = fps
        self.frame_size = frame_size
        self.next_frame_time = None
        self.previous_frame = None

    def write(self, frame, now):
        saved_frame = cv2.resize(frame, self.frame_size, interpolation=cv2.INTER_AREA)
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cv2.rectangle(saved_frame, (0, self.frame_size[1] - 25),
                      (205, self.frame_size[1]), (0, 0, 0), -1)
        put_text(saved_frame, timestamp, (8, self.frame_size[1] - 8),
                 0.45, (255, 255, 255), 1)
        if self.next_frame_time is None:
            self.next_frame_time = now
        if now >= self.next_frame_time:
            due = int((now - self.next_frame_time) * self.fps + 1e-6) + 1
            # Hold the last captured image across slow inference intervals.
            for _ in range(due - 1):
                self.writer.write(self.previous_frame if self.previous_frame is not None else saved_frame)
            self.writer.write(saved_frame)
            self.next_frame_time += due / self.fps
        self.previous_frame = saved_frame

    def release(self):
        self.writer.release()


class FixedPlantRegion:
    def __init__(self):
        self.bounds = None
        self.drag_start = None
        self.drag_end = None
        self.revision = 0

    def select(self, bounds):
        self.bounds = tuple(map(int, bounds)) if bounds is not None else None
        self.revision += 1

    def monitoring_regions(self, detected_plants):
        # A reserved ID keeps the fixed region independent of detector track IDs.
        return [(-1, self.bounds)] if self.bounds is not None else detected_plants

    def on_mouse(self, event, x, y, flags, userdata):
        if event == cv2.EVENT_LBUTTONDOWN:
            if 0 <= x < FRAME_SIZE[0] and 0 <= y < FRAME_SIZE[1]:
                self.drag_start = self.drag_end = (x, y)
            return
        x = min(max(x, 0), FRAME_SIZE[0] - 1)
        y = min(max(y, 0), FRAME_SIZE[1] - 1)
        if self.drag_start is not None and event == cv2.EVENT_MOUSEMOVE:
            self.drag_end = (x, y)
        if self.drag_start is not None and event == cv2.EVENT_LBUTTONUP:
            a, b = self.drag_start
            self.drag_start = self.drag_end = None
            if abs(x - a) >= 10 and abs(y - b) >= 10:
                self.select((min(a, x), min(b, y), max(a, x), max(b, y)))

    def draw(self, frame):
        if self.bounds is not None:
            x1, y1, x2, y2 = self.bounds
            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 220, 255), 3)
            put_text(frame, "Fixed plant region", (x1, max(20, y1 - 10)),
                     0.55, (0, 220, 255), 2)
        if self.drag_start is not None and self.drag_end is not None:
            cv2.rectangle(frame, self.drag_start, self.drag_end, (0, 220, 255), 2)



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


def draw_wrists(frame, pose_result):
    wrists = []
    if pose_result.keypoints is None:
        return wrists
    for points in pose_result.keypoints.data.cpu().tolist():
        for index, side in ((9, "L"), (10, "R")):
            if index >= len(points) or len(points[index]) < 3:
                continue
            x, y, confidence = points[index]
            if confidence < WRIST_CONFIDENCE or (x == 0 and y == 0):
                continue
            wrists.append((x, y))
            color = (0, 220, 255)
            cv2.circle(frame, (int(x), int(y)), 7, color, -1)
            put_text(frame, f"{side} wrist", (int(x) + 10, max(20, int(y) - 10)),
                     0.45, color, 1)
    return wrists


class PlantContactMonitor:
    def __init__(self):
        self.started = {}

    def update(self, plants, wrists, now):
        near = set()
        for plant_id, (x1, y1, x2, y2) in plants:
            if plant_id is None:
                continue
            for x, y in wrists:
                dx = max(x1 - x, 0, x - x2)
                dy = max(y1 - y, 0, y - y2)
                if dx * dx + dy * dy <= WRIST_REACH_PIXELS ** 2:
                    near.add(plant_id)
                    break
        self.started = {key: value for key, value in self.started.items() if key in near}
        for plant_id in near:
            self.started.setdefault(plant_id, now)
        elapsed = {key: now - value for key, value in self.started.items()}
        confirmed = {key for key, seconds in elapsed.items() if seconds >= PLANT_CONTACT_SECONDS}
        return confirmed, elapsed


def build_ui_frame(
    video_frame,
    human_count,
    animal_count,
    recording,
    paused,
    clip_count,
    recording_path,
    plant_count=0,
    wrist_count=0,
    contact_seconds=0,
    iot_status="unavailable",
    fixed_region=False,
):
    width = video_frame.shape[1]
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
    put_text(ui_frame, "Detection Monitor", (panel_x + 22, 42), 0.75, (255, 255, 255), 2)
    put_text(ui_frame, "Fixed plant region" if fixed_region else "Automatic plant regions",
             (panel_x + 22, 72), 0.5, (170, 180, 190), 1)

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
    put_text(ui_frame, f"Plants: {plant_count}   Wrists: {wrist_count}",
             (panel_x + 22, 316), 0.5, (100, 220, 220), 1)

    cv2.rectangle(ui_frame, (panel_x + 20, 325), (panel_x + 280, 405), (42, 47, 54), -1)
    put_text(ui_frame, "Saved clips", (panel_x + 42, 358), 0.58, (210, 215, 220), 1)
    put_text(ui_frame, str(clip_count), (panel_x + 220, 362), 0.82, (255, 255, 255), 2)

    file_text = Path(recording_path).name if recording_path else "Waiting for plant contact"
    if len(file_text) > 24:
        file_text = file_text[:21] + "..."
    put_text(ui_frame, file_text, (panel_x + 42, 390), 0.45, (165, 175, 185), 1)
    put_text(ui_frame, f"Plant contact: {contact_seconds:.1f} / {PLANT_CONTACT_SECONDS:g}s",
             (panel_x + 22, 430), 0.5, (0, 220, 255), 1)

    draw_button(ui_frame, "Space  Pause", (panel_x + 22, 445), (120, 42), (58, 69, 82))
    draw_button(ui_frame, "Q  Quit", (panel_x + 158, 445), (100, 42), (125, 55, 60))
    put_text(ui_frame, f"MPU6050: {iot_status}", (panel_x + 22, 522), 0.4, (155, 165, 175), 1)

    return ui_frame


def start_recording(recordings_dir, fps, frame_size):
    recordings_dir.mkdir(exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    recording_path = recordings_dir / f"possible_plant_contact_{timestamp}.mp4"
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(recording_path), fourcc, fps, frame_size)

    if not writer.isOpened():
        print("Error: Could not start video recording.")
        return None, ""

    print(f"Recording started: {recording_path}")
    return EventVideoWriter(writer, fps, frame_size), str(recording_path)


def _run_camera(web_enabled=False, sensor=None):
    model = YOLO(str(BASE_DIR / "yolov8n.pt"))
    plant_model = YOLOWorld(str(BASE_DIR / "yolov8s-worldv2.pt"))
    plant_model.set_classes(["plant", "potted plant"])
    pose_model = YOLO(str(BASE_DIR / "yolov8n-pose.pt"))
    cap = cv2.VideoCapture(CAMERA_INDEX)

    if not cap.isOpened():
        print("Error: Could not open camera.")
        exit()

    cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_NORMAL)
    fixed_region = FixedPlantRegion()
    cv2.setMouseCallback(WINDOW_NAME, fixed_region.on_mouse)
    region_revision = fixed_region.revision
    frame = None

    recordings_dir = BASE_DIR / "recordings"

    delay = 30
    paused = False
    last_contact_alert_time = float("-inf")
    last_contact_seen_time = 0
    contact_monitor = PlantContactMonitor()
    video_writer = None
    recording_path = ""
    saved_clip_count = 0

    unique_person_ids = set()
    unique_animal_ids = set()

    def reset_monitoring():
        contact_monitor.started.clear()

    def finish_recording(announce=False):
        nonlocal video_writer, saved_clip_count, recording_path
        if video_writer is None:
            return
        video_writer.release()
        video_writer = None
        saved_clip_count += 1
        if announce:
            print(f"Recording saved: {recording_path}")
        recording_path = ""

    print(f"""
    Controls:
    [SPACE] = Pause / Play
    [q]     = Quit
    Drag around one plant = Fix its monitored region
    [p]     = Select fixed region (Enter confirms, Escape cancels)
    [c]     = Clear fixed region and monitor automatic plant regions

    Select this sensor's plant with P or drag a fixed region.
    Alerts require {PLANT_CONTACT_SECONDS:g} seconds of wrist proximity plus fresh MPU6050 movement.
    Missing, disconnected or stale sensor readings cannot alert or start recording.
    Recording stops 5 seconds after the confirmed contact is no longer detected.
    """)

    camera_frame_count = 0
    camera_started_at = time.monotonic()
    while True:
        display_frame = None

        if fixed_region.revision != region_revision:
            reset_monitoring()
            region_revision = fixed_region.revision
            last_contact_alert_time = float("-inf")
            finish_recording()

        if not paused:
            ret, frame = cap.read()

            if not ret:
                elapsed = time.monotonic() - camera_started_at

                print("Error: Could not read camera frame.")
                print(f"Camera index: {CAMERA_INDEX}")
                print(f"Frames received: {camera_frame_count}")
                print(f"Time before failure: {elapsed:.2f} seconds")
                print(f"Camera still opened: {cap.isOpened()}")
                break

            camera_frame_count += 1

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

            annotated_frame = frame.copy()
            plant_count_frame = 0
            plants = []
            plant_results = plant_model.track(frame, conf=PLANT_CONFIDENCE,
                                              imgsz=640, persist=True, verbose=False)
            if plant_results and plant_results[0].boxes is not None:
                for box in plant_results[0].boxes:
                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                    cv2.rectangle(annotated_frame, (x1, y1), (x2, y2), (100, 220, 200), 2)
                    put_text(annotated_frame, "Plant", (x1, max(20, y1 - 10)),
                             0.55, (100, 220, 200), 1)
                    plant_count_frame += 1
                    plant_id = int(box.id.item()) if box.id is not None else None
                    plants.append((plant_id, (x1, y1, x2, y2)))

            pose_results = pose_model.predict(frame, conf=0.25, imgsz=640, verbose=False)
            wrists = draw_wrists(annotated_frame, pose_results[0]) if pose_results else []
            wrist_count_frame = len(wrists)

            if results and results[0].boxes is not None:
                for box in results[0].boxes:
                    cls_id = int(box.cls.item())
                    label = model.names[cls_id]

                    if label == "person":
                        display_label = "Human"
                        color = (0, 255, 0)
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

            fixed_region.draw(annotated_frame)
            monitored_plants = fixed_region.monitoring_regions(plants)
            now = time.monotonic()
            contact_ids, contact_elapsed = contact_monitor.update(monitored_plants, wrists, now)
            sensor_state = sensor.snapshot() if sensor is not None else {'status': 'unavailable', 'movement': None}
            # Detector track IDs are not database plant IDs. A selected region
            # identifies the one plant monitored by this configured physical sensor.
            sensor_moving = sensor_state['status'] == 'moving' and sensor_state['movement'] == 1
            handling_ids = contact_ids if fixed_region.bounds is not None and sensor_moving else set()
            put_text(annotated_frame, f"MPU6050: {sensor_state['status']}", (20, 75),
                     0.55, (100, 220, 220), 1)
            contact_seconds = max(contact_elapsed.values(), default=0)
            for plant_id, bounds in monitored_plants:
                if plant_id in contact_elapsed:
                    put_text(annotated_frame, f"Possible contact: {contact_elapsed[plant_id]:.1f}/{PLANT_CONTACT_SECONDS:g}s",
                             (bounds[0], min(FRAME_SIZE[1] - 10, bounds[3] + 22)),
                             0.5, (0, 220, 255), 1)

            if handling_ids:
                last_contact_seen_time = now
                put_text(
                    annotated_frame,
                    "POSSIBLE HANDLING: CONTACT + MPU6050",
                    (20, 44),
                    0.7,
                    (0, 0, 255),
                    3,
                )

                if now - last_contact_alert_time >= ALERT_COOLDOWN_SECONDS:
                    print(f"ALERT: {PLANT_CONTACT_SECONDS:g}s camera contact plus fresh MPU6050 movement.")

                    if web_enabled:
                        camera_server.publish_event(
                            "possible_plant_contact",
                            "Camera contact + MPU6050 movement",
                            f"Wrist proximity for at least {PLANT_CONTACT_SECONDS:g} seconds "
                            "with fresh MPU6050 movement from this plant's sensor. Please review.",
                        )

                    if winsound is not None:
                        winsound.Beep(1000, 300)

                    last_contact_alert_time = now

                if video_writer is None:
                    video_writer, recording_path = start_recording(
                        recordings_dir,
                        RECORDING_FPS,
                        RECORDING_SIZE,
                    )
            elif fixed_region.bounds is None:
                put_text(annotated_frame, "SELECT THIS PLANT WITH P", (20, 44),
                         0.7, (0, 220, 255), 2)
            elif contact_ids:
                put_text(annotated_frame, "CONTACT ONLY: WAITING FOR MPU6050", (20, 44),
                         0.7, (0, 220, 255), 2)

            should_stop_recording = (
                video_writer is not None
                and not handling_ids
                and (sensor_state['status'] not in ('moving', 'stationary')
                     or now - last_contact_seen_time >= RECORD_AFTER_CONTACT_SECONDS)
            )

            if should_stop_recording:
                finish_recording(announce=True)

            display_frame = build_ui_frame(
                annotated_frame,
                human_count_frame,
                animal_count_frame,
                video_writer is not None,
                paused,
                saved_clip_count,
                recording_path,
                plant_count_frame,
                wrist_count_frame,
                contact_seconds,
                sensor_state['status'],
                fixed_region.bounds is not None,
            )

            if web_enabled:
                camera_server.publish_frame(annotated_frame)

            if video_writer is not None:
                video_writer.write(annotated_frame, now)

        if display_frame is not None:
            cv2.imshow(WINDOW_NAME, display_frame)

        wait_time = 0 if paused else delay
        key = cv2.waitKey(wait_time) & 0xFF

        if key == ord("q"):
            print("Quit requested.")
            break

        if key == ord("c"):
            fixed_region.select(None)
        if key == ord("p") and frame is not None:
            x, y, width, height = cv2.selectROI("Fixed plant region", frame, False, False)
            cv2.destroyWindow("Fixed plant region")
            if width >= 10 and height >= 10:
                fixed_region.select((x, y, x + width, y + height))

        if key == 32:
            paused = not paused
            if paused:
                finish_recording()
            reset_monitoring()
            print("Paused" if paused else "Playing")

    finish_recording(announce=True)

    cap.release()
    cv2.destroyAllWindows()

    print("\nFINAL UNIQUE COUNT SUMMARY")
    print(f"Unique humans detected: {len(unique_person_ids)}")
    print(f"Unique animals detected: {len(unique_animal_ids)}")
    print(f"Saved plant contact clips: {saved_clip_count}")


def main():
    # A plain desktop launch does not need website configuration or port 8001.
    plant_id = os.environ.get("CAMERA_PLANT_ID", "").strip()
    sensor = IoTMovementSource.from_environment(plant_id)
    if not plant_id:
        # Detection still runs, but combined alerts remain disabled without a plant.
        _run_camera(sensor=sensor)
        return

    camera_id = os.environ.get("CAMERA_ID", "CAM-001").strip() or "CAM-001"
    try:
        server = camera_server.start_server(camera_id, plant_id)
    except OSError as error:
        raise SystemExit(
            "Could not start the camera HTTP service on 127.0.0.1:8001. "
            "Check whether another camera service is already running."
        ) from error

    try:
        sensor.start()
        _run_camera(web_enabled=True, sensor=sensor)
    finally:
        sensor.close()
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
