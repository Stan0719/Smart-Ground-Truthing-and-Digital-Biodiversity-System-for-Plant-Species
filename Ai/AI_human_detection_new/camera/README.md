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
alert or record. A confident wrist inside or within 24 pixels of the same tracked
plant box for 2 seconds plus movement of that same plant during contact triggers
POSSIBLE HANDLING, sound, and recording. Proximity to a stationary plant does
not start an alert or recording.
The panel shows elapsed contact time. Losing wrist proximity or the plant track
resets its timer; pausing also resets it. By default, all detected plants are monitored.
Clips are saved under camera/recordings and stop 5 seconds after confirmed
qualifying contact ends. This is a 2D proximity estimate, not proof of contact or poaching.
Tune PLANT_CONTACT_SECONDS to change the 2-second threshold.
Wrist detection needs a visible person/arm and can miss
occluded wrists or close-up hands. Three models may reduce the camera frame rate.

## Fixed Plant Region

Drag a tight rectangle around a plant in the live video, or press P to select a
region in a frozen frame (Enter confirms, Escape cancels). The yellow rectangle
is fixed in camera coordinates and remains active even if automatic plant
detections disappear. Automatic teal plant boxes continue to appear normally.

While a fixed region is selected, only that region is used for wrist proximity
and movement checks. The same 2-second contact-plus-movement rule applies.
The panel identifies fixed-region versus automatic-region monitoring.
Press C to clear the region and return to monitoring automatic plant boxes.
Changing or clearing a region resets contact/movement history and finishes any
active clip. Regions reset when the program restarts.

Keep the camera fixed and redraw if it moves. The region is a manual choice,
not confirmation that a plant is still present: moving objects or overlapping
neighboring foliage inside it can count as movement. Keep background visible
outside the region for camera-motion compensation.

## Plant Movement

OpenCV optical flow checks movement of image features inside each tracked plant
box. Median background motion is subtracted to reduce false evidence from camera
translation. Detected human boxes and wrist neighborhoods are excluded to reduce
hand/body movement being mistaken for plant movement. Sparse or textureless views
provide no movement evidence.

Movement observed during the current contact episode is remembered until contact
ends. After the 2-second threshold, contact plus that movement evidence displays
POSSIBLE HANDLING: CONTACT + MOVEMENT. Contact without movement shows
CONTACT ONLY: NO MOVEMENT and does not start recording or sound.
Movement without contact, or movement of another plant, cannot trigger the alert.
The panel reports
the number of plants with movement detected in the current frame.

This checks motion in a plant box, not a segmented plant or confirmed pulling.
Wind, moving background objects, shadows, camera rotation/zoom, occlusion, and
tracking errors can affect it. Use a fixed camera. Tune PLANT_MOTION_PIXELS and
MIN_PLANT_MOTION_POINTS to adjust the movement check.

## Recording Storage

New event clips are standard MP4 files in `camera/recordings`, saved at 640x360
and 8 FPS. They include the annotated camera scene and a date/time stamp; the
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



