# AI-Powered Human and Animal Detection & Tracking Using YOLOv8

## Overview
This project uses YOLOv8 and OpenCV to detect and track humans and animals in videos.

## Features
- Real-time human detection
- Real-time animal detection
- Object tracking with unique IDs
- Bounding box visualization
- Animal type identification
- Video analysis using AI
- Plant detection boxes using YOLO-World
- Left/right wrist markers using YOLO pose

## Technologies Used
- Python
- OpenCV
- YOLOv8
- Computer Vision

## Installation

```bash
pip install ultralytics opencv-python
```

Run with `python camera/cam.py`. Model weights are loaded from the camera
directory; missing weights and CLIP dependencies may download on first run.
Teal boxes mark plants and yellow dots mark confident wrist keypoints.
The original human/animal display remains active. Human presence alone does not
alert or record. A confident wrist inside or within 24 pixels of the selected
fixed plant region for 2 seconds plus a fresh MPU6050 movement reading from the
sensor assigned to that database plant triggers POSSIBLE HANDLING, sound, and
recording. Video-based movement is no longer used.
The panel shows elapsed contact time. Losing wrist proximity or the plant track
resets its timer; pausing also resets it. Select the monitored plant with P or
dragging before combined alerts are enabled. Automatic plant boxes are still
drawn, but their track IDs do not identify database plant records.
Clips are saved under camera/recordings and stop 5 seconds after confirmed
qualifying contact ends. This is a 2D proximity estimate, not proof of contact or poaching.
Tune PLANT_CONTACT_SECONDS to change the 2-second threshold.
Wrist detection needs a visible person/arm and can miss
occluded wrists or close-up hands. Three models may reduce the camera frame rate.

## Local Website Camera Connection

The existing website IoT Monitoring page can display annotated frames and
qualifying contact-plus-MPU6050 events from this camera. A live ESP32/MPU6050
upload is required for alerts; the video feed still works without it.

From the project root, use a PowerShell terminal with your camera Python
environment active. Replace `42` below with the registered plant's actual
database ID:

```powershell
$env:CAMERA_ID = 'CAM-001'
$env:CAMERA_PLANT_ID = '42'
$env:PLANT_API_ORIGIN = 'http://127.0.0.1:3000'
$env:DEVICE_ID = (Read-Host 'Registered Sensor device ID').Trim()
$sensorSecret = Read-Host 'Sensor provisioning key' -AsSecureString
$env:DEVICE_KEY = [System.Net.NetworkCredential]::new('', $sensorSecret).Password
Remove-Variable sensorSecret
python -B .\Ai\AI_human_detection_new\camera\cam.py
```

Setting `CAMERA_PLANT_ID` enables a local HTTP service on `127.0.0.1:8001`.
The camera polls the authenticated `/api/device/movement` endpoint with the
sensor's device key. The backend verifies that this active Sensor is assigned
to `CAMERA_PLANT_ID`. Set these variables in the camera terminal as well as the
uploader terminal; separate terminals do not share newly assigned variables.
Without that variable the camera runs as a desktop application without starting
the HTTP service. To switch back in the same terminal:

```powershell
Remove-Item Env:CAMERA_PLANT_ID -ErrorAction SilentlyContinue
```

Run the website and plant API in separate terminals from the same project root:

```powershell
npm.cmd --prefix plant-conservation-backend start
```

```powershell
npm.cmd --prefix web run dev
```

Restart Vite after changing its configuration. The development proxy forwards
`/camera-api/*` to the camera service, removing `/camera-api`. Check these local
URLs before opening IoT Monitoring as a Conservation Officer:

- `http://127.0.0.1:8001/camera-status`
- `http://127.0.0.1:8001/video-feed`
- `http://localhost:5173/camera-api/camera-status`

Status stays Offline until a frame is published, and becomes Offline again
after ten seconds without new frames. The website handles an unavailable camera
without requiring other users to start Python. Stop an older camera process if
port 8001 is already occupied. The HTTP service shuts down when the camera loop
exits or raises an error.

The feed shows the annotated scene. Events are published only when the existing
contact-plus-movement rule and alert cooldown permit an alert. Confidence remains
unavailable rather than inventing a combined detection score. Events are held in
memory (up to 100), reset at restart, and are not written to PostgreSQL. MP4
recordings remain local files. Region selection still uses P or dragging in the
OpenCV window; browser region controls are not included in this connection.

This proxy is for the local Vite development server. Hosted deployments need
their own authenticated camera routing. This change does not add a public
Cloudflare camera endpoint or change sensor ingestion.

Run the camera logic and HTTP tests from `Ai/AI_human_detection_new`:

```powershell
python -B -m unittest camera.test_cam camera.test_camera_server camera.test_iot_movement -v
```

## Fixed Plant Region

Drag a tight rectangle around a plant in the live video, or press P to select a
region in a frozen frame (Enter confirms, Escape cancels). The yellow rectangle
is fixed in camera coordinates and remains active even if automatic plant
detections disappear. Automatic teal plant boxes continue to appear normally.

While a fixed region is selected, only that region is used for wrist proximity
checks. The same 2-second contact-plus-MPU6050 rule applies.
The panel identifies fixed-region versus automatic-region monitoring.
Press C to clear the region and return to monitoring automatic plant boxes.
Changing or clearing a region resets contact/movement history and finishes any
active clip. Regions reset when the program restarts.

Keep the camera fixed and redraw if it moves. The region is a manual choice,
not confirmation that a plant is still present. Select the physical plant to
which the configured MPU6050 is attached.

## MPU6050 Movement

The sensor uploader is the only program that opens the USB serial port. Keep it
running alongside the backend and camera; do not start the older serial-owning
`integration_ai/iot/connect_camera_iot.py` script at the same time.

Restart the backend, uploader and camera after this update. The new uploader
sends explicit MPU connection status and the original capture timestamp.
Readings without this metadata, disconnected MPU readings, wrong plant/device
bindings and readings older than five seconds cannot enable combined alerts.
The background camera poller expires cached data as well and fails closed when
the backend is unavailable. No optical-flow fallback is used.

The video overlay and desktop panel show MPU6050 status: moving, stationary,
stale or unavailable. Combined alerts require current moving state together
with two seconds of camera wrist proximity in the selected fixed region.
Camera-only activity or sensor-only movement does not qualify. On sensor
unavailability/staleness an active recording is finished immediately; ordinary
contact loss retains the existing five-second recording tail.

To test physically: verify no alert for wrist contact with a stationary sensor,
no alert for sensor movement without wrist contact, and an alert for both
together. Stop the uploader or unplug the ESP32; after the five-second freshness
window there must be no new combined alert. A healthy reading is required after
reconnecting. Software tests do not replace these physical checks.

## Recording Storage

New event clips are standard MP4 files in `camera/recordings`, saved at 640x360
and the rate configured by `RECORDING_FPS`. They include the annotated camera scene and a date/time stamp; the
sidebar is shown live but omitted from the saved video. Open the MP4 files in
your usual video player to review and seek through them.

Only qualifying events record, followed by the existing 5-second tail. The
recorder drops excess frames on fast input and holds the last frame across slow
inference intervals, preserving playback timing. Pausing finishes the active
clip. Repeated frames do not add missing visual detail.

Tune `RECORDING_SIZE` and `RECORDING_FPS` near the top of `cam.py` to trade file
size against detail and smoothness. Existing clips are not modified or deleted,
and no retention limit or automatic deletion is enabled. Savings vary by scene
and motion; lower resolution can make small details harder to inspect.



