# AI and IoT architecture diagrams

Three diagrams cover the camera AI and sensor IoT architecture. They describe the inspected source and configuration, rather than certifying a running deployment. Prepared 18 November 2026.

| Diagram | PNG for reports and slides | Editable vector |
|---|---|---|
| Combined AI + IoT | [PNG](combined-ai-iot.png) | [SVG](combined-ai-iot.svg) |
| AI camera monitoring | [PNG](ai-camera-architecture.png) | [SVG](ai-camera-architecture.svg) |
| ESP32 sensor IoT | [PNG](iot-sensor-architecture.png) | [SVG](iot-sensor-architecture.svg) |

The `.mmd` files provide editable Mermaid versions. Regenerate the SVG and PNG files with `python docs/architecture/generate_diagrams.py` on Windows with Pillow installed.

## Architecture details

- The camera host runs YOLOv8 human/animal detection, YOLO-World plant detection and YOLO pose wrist detection. The operator selects a fixed monitored region and configures its database plant ID.
- A handling alert requires at least two seconds of wrist proximity plus a fresh, healthy MPU6050 movement reading from a Sensor assigned to that same plant. The proximity margin is 24 pixels; camera-side movement freshness is five seconds. Cooldown also controls alert emission. This estimate requires officer review.
- Live annotated video continues independently of a handling alert. The local camera HTTP service uses port 8001 when web integration is enabled.
- Current PlatformIO firmware connects DHT11 to GPIO4, soil to GPIO35, rain to GPIO34, LED to GPIO5, and MPU6050 to I2C SDA21/SCL22. It has no sound-probe input. Some older repository documentation describes an earlier sketch with a sound sensor.
- USB serial and optional Wi-Fi HTTPS are alternative transport paths. The host persists accepted readings in a private SQLite outbox, then uploads them to the Node.js Plant API. The ESP32 does not persist unsent Wi-Fi packets.
- The Plant API handles device authentication, readings, movement lookup, thresholds, events and protected clip playback. Supabase PostgreSQL holds device assignments, sensor readings and event metadata.
- Completed H.264 video files stay in the local recording directory. Camera and backend must have access to that same directory. Clip metadata has a local retry outbox; PostgreSQL stores clip references rather than video bytes.
- Database-to-dashboard arrows in the combined image express data flow through the Plant API. The browser does not access the database directly.

## Sources inspected

- PlatformIO project: `261116-110403-esp32dev/platformio.ini` and `src/main.cpp`.
- [Camera pipeline](../../Ai/AI_human_detection_new/camera/cam.py), [movement checks](../../Ai/AI_human_detection_new/camera/iot_movement.py), [camera service](../../Ai/AI_human_detection_new/camera/camera_server.py), and [clip publisher](../../Ai/AI_human_detection_new/camera/clip_publisher.py).
- [Serial bridge](../../IoT/PlantPrototype/serial_bridge.py), [Wi-Fi receiver](../../IoT/PlantPrototype/wifi_receiver.py), and [gateway guide](../../IoT/PlantPrototype/README.md).
- [IoT backend routes](../../plant-conservation-backend/iot.cjs), [camera event routes](../../plant-conservation-backend/camera-events.cjs), and [clip integration guide](../camera-clips-integration.md).

The root README contains an older statement that the Python components were removed; the inspected checkout contains these Python implementations. These diagrams follow those source files. Live model execution, wiring and end-to-end deployment were not tested as part of diagram creation.
