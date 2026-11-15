# Local camera clips and Supabase event metadata

The implementation saves MP4 files on the camera computer. PostgreSQL/Supabase
stores the event in your existing `threat_alert_history` table, with the Camera
in `camera_id`, the event time in `detected_at` and the completed clip reference
in `video_path`. No video bytes or Base64 videos are stored in the database.

## 1. Use the existing database structure

No migration, new table or new column is required. The proposed separate
`camera_event` migration and its runner have been removed.

Each camera recording uses these existing fields:

- `id`: stable recording/event ID.
- `camera_id`: registered Camera device ID.
- `device_id` and `reading_id`: triggering Sensor device and reading, when available.
  If there is no reading reference, `device_id` is the Camera ID and `reading_id`
  stays NULL, as allowed by the existing schema.
- `metric`: `possible_plant_contact`.
- `value`: `1`, meaning the contact-plus-movement rule was satisfied. This is
  a binary event indicator, not a confidence score or sensor measurement.
- `detected_at`: event detection timestamp.
- `video_path`: NULL until the completed H.264 clip exists, then `<event-id>.mp4`.
- `status`: the existing New/Reviewing/Resolved workflow. Upload retries preserve
  officer status and the linked `threat_response` rows.

Conversion state, recording end time and duration remain in the local JSON
metadata beside the video. They do not require database columns. If optional
local metadata is missing, a valid `video_path` can still be played; duration is
shown as unavailable. Disk paths and metadata file contents are not exposed as
public static files.

The existing application database connection and `PLANT_PG_SCHEMA` are reused.
Existing RLS policies and database grants are not changed. The website continues
to use backend sessions and permission checks.

## 2. Register a Camera device for the same plant

Use a separate **Camera** device and key; keep the Sensor device/key used for
MPU6050 readings unchanged. If a suitable Camera is already registered, reuse it.
The Camera must be Active and assigned to the plant's numeric database ID.

The existing administrator provisioning endpoint is `POST /api/devices` on the
Plant API, exposed to the website as `/api/data/devices`.
While signed in as Administrator on the website, the following browser-console
request creates a Camera device for plant 1 (replace the name and plant ID):

```javascript
const response = await fetch('/api/data/devices', {
  method: 'POST',
  credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Plant 1 camera', device_type: 'Camera', plant_id: '1' }),
})
const camera = await response.json()
if (!response.ok) throw new Error(camera.error || 'Camera registration failed')
console.log(camera)
```

The result contains `id` and a one-time `provisioningKey`. Store them privately.
Do not register another device on every launch, paste keys into chat, or commit
them to the repository. The existing Admin device form is not a camera
provisioning workflow; use this API or an already provisioned Camera.

## 3. Install browser-video conversion support

Using the same Python environment that runs your camera:

```powershell
python -m pip install -r Ai/AI_human_detection_new/camera/requirements-clips.txt
```

This supplies FFmpeg if it is not on PATH. An existing FFmpeg installation can
also be used, optionally via `FFMPEG_PATH`. Captured videos are converted to
H.264 MP4, 15 fps, with fast-start metadata. Conversion runs off the camera loop.

## 4. Use the same recordings folder on camera and backend

The default in both processes is:

```text
Ai/AI_human_detection_new/camera/recordings
```

If changing it, set `CAMERA_RECORDINGS_DIR` to the same absolute directory for
both the Plant API and camera process. The backend must be able to read that
folder. Files are not exposed through the Python HTTP service or public static
hosting. A remote backend cannot read this computer's disk without an explicitly
configured shared volume or another storage integration.

## 5. Restart the backend and launch the camera

Keep the existing authentication service, Plant API and website running. Restart
the Plant API after deploying the new routes. From the repository root:

```powershell
python integration_ai/iot/connect_camera_iot.py --port COM11 --plant PL001 --device-id SENSOR_DEVICE_UUID --camera-device-id CAMERA_DEVICE_UUID
```

Replace COM11, the plant and both device IDs. The launcher asks for the Sensor
and Camera provisioning keys with hidden prompts. For an existing private
environment, it also supports `DEVICE_KEY` and `CAMERA_DEVICE_KEY`.
`PLANT_API_ORIGIN` defaults to `http://127.0.0.1:3000` for local development;
non-loopback origins must use HTTPS.

When starting `cam.py` directly, set `CAMERA_PLANT_ID`, `DEVICE_ID`, `DEVICE_KEY`,
`CAMERA_DEVICE_ID` and `CAMERA_DEVICE_KEY` in that terminal. `CAMERA_ID` alone
does not enable persistence; the registered Camera ID is used when configured.

Select the plant region with P. The existing two-second wrist-contact plus fresh
MPU movement rule still controls recording. Each new clip gets one stable event
ID. The five-second tail, pause and shutdown finalize the active file.

## 6. Review and play a clip

As Conservation Officer or Administrator, open **Threat Alerts**, then click
**Refresh** in **Suspicious Camera Events**. This list reads saved events, not
demonstration fixtures. The recording progresses through Recording, Processing,
and Available. Click **View** to use the existing player.

The session-protected endpoint `/api/data/camera-events/<event-id>/video` supports
seeking with HTTP byte ranges. Visitors, Botanists, inactive accounts and anonymous
requests cannot read these events or clips. Missing or inaccessible files produce
an unavailable message instead of exposing a disk path.

Refresh is manual. The panel shows the latest 100 events and indicates when older
events exist. The live Camera Monitoring panel still displays the current camera
server session; persisted recordings are reviewed in Threat Alerts.

## Recovery and storage

The recording folder holds an atomic JSON metadata outbox beside each clip.
Failed uploads and unfinished conversions retry while the camera runs and on its
next launch. Interrupted captures are marked Interrupted. A clip is advertised
as Available only after encoding and a successful backend acknowledgement that
the file exists. Raw intermediate files are removed after that acknowledgement;
completed clips remain on disk. Closing the camera gives final work a bounded
chance to finish; pending work remains queued for the next launch.

No automatic retention policy deletes recordings. Disk usage and backups remain
the operator's responsibility. Supabase space is used only for event metadata.
Moving or deleting a completed local clip makes playback unavailable, although
its event metadata remains in the database. Existing recordings created before
this integration have no verified event binding and are not automatically imported.

## Validation performed

- Isolated PostgreSQL-compatible tests use the existing alert table structure
  and exercise device identity, reading association, event ownership, retries,
  preserved officer responses/status, session permissions, missing files, HEAD
  and byte ranges. They verify that the database schema stays unchanged.
- Python tests convert a synthetic MP4 to H.264, verify it decodes, exercise
  network/encoding failure recovery, and retain the physical detection gate tests.
- Frontend tests exercise saved event loading, protected playback URL mapping,
  error states, and cancellation/clearing when the session changes.

Restart the backend and complete a physical camera-to-browser smoke test with
the real device assignment before calling the deployment active. No live
database schema changes are needed.
