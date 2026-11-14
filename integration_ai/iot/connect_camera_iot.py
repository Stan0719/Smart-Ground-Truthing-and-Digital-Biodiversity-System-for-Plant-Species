"""Launch the sensor uploader and AI camera together; only the uploader opens USB."""

import argparse
import getpass
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


ROOT = Path(__file__).resolve().parents[2]
BRIDGE = ROOT / "IoT" / "PlantPrototype" / "serial_bridge.py"
DEFAULT_CAMERA = ROOT / "Ai" / "AI_human_detection_new" / "camera" / "cam.py"

# Stop through the camera loop's normal Q path so an active MP4 is finalised.
CAMERA_BOOTSTRAP = """
import importlib.util, signal, sys, threading
from pathlib import Path
path = Path(sys.argv[1])
sys.path.insert(0, str(path.parent))
spec = importlib.util.spec_from_file_location('launched_camera', path)
cam = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cam)
cam.CAMERA_INDEX = int(sys.argv[2])
stop = threading.Event()
def request_stop(*args):
    stop.set()
signal.signal(signal.SIGINT, request_stop)
def watch_parent():
    for line in sys.stdin:
        if line.strip() == 'stop':
            stop.set()
            return
threading.Thread(target=watch_parent, daemon=True).start()
original_wait = cam.cv2.waitKey
def wait_key(delay):
    if stop.is_set():
        return ord('q')
    return original_wait(100 if delay <= 0 else delay)
cam.cv2.waitKey = wait_key
cam.main()
"""


def plant_id(value):
    match = re.fullmatch(r"(?:PL)?([0-9]+)", value.strip(), re.IGNORECASE)
    if not match or int(match[1]) <= 0:
        raise argparse.ArgumentTypeError("Use a plant ID such as 1 or PL001.")
    return str(int(match[1]))


def stop_process(process, *, camera=False):
    if process is None:
        return
    if process.poll() is None:
        if camera:
            try:
                process.stdin.write("stop\n")
                process.stdin.flush()
                process.wait(timeout=10)
            except (OSError, subprocess.TimeoutExpired):
                process.terminate()
        else:
            process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
    if camera and process.stdin is not None:
        process.stdin.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", required=True, help="ESP32 serial port, e.g. COM11")
    parser.add_argument("--plant", required=True, type=plant_id, help="Assigned plant ID: 1 or PL001")
    parser.add_argument("--device-id", default=os.environ.get("DEVICE_ID", ""), help="Registered Sensor device ID")
    parser.add_argument("--camera-device-id", default=os.environ.get("CAMERA_DEVICE_ID", ""), help="Registered Camera device ID for saved clip integration")
    parser.add_argument("--api-origin", default=os.environ.get("PLANT_API_ORIGIN", "http://127.0.0.1:3000"))
    parser.add_argument("--camera", type=Path, default=DEFAULT_CAMERA, help="Optional camera script path")
    parser.add_argument("--camera-index", type=int, default=0, help="Webcam index (default: 0)")
    args = parser.parse_args(argv)
    camera_path = args.camera.resolve()
    if not camera_path.is_file() or not BRIDGE.is_file():
        parser.error("Camera or sensor uploader file is missing from this project.")
    if not args.port or "://" in args.port or args.camera_index < 0:
        parser.error("Use a local serial port and a nonnegative camera index.")

    spec = importlib.util.spec_from_file_location("launcher_serial_bridge", BRIDGE)
    bridge = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bridge)
    try:
        origin = bridge.validate_api_origin(args.api_origin)
    except ValueError as error:
        parser.error(str(error))
    device_id = args.device_id.strip() or input("Registered Sensor device ID: ").strip()
    key = os.environ.get("DEVICE_KEY", "") or getpass.getpass("Sensor provisioning key (hidden): ")
    if not device_id or not re.fullmatch(r"[a-f0-9]{64}", key):
        parser.error("A registered Sensor device ID and its 64-character provisioning key are required.")
    if importlib.util.find_spec("serial") is None:
        parser.error("Install the bridge requirements: python -m pip install -r IoT/PlantPrototype/requirements.txt")

    # Check configuration before opening the camera or serial port; no writes.
    query = urllib.parse.urlencode({"device_id": device_id, "plant_id": args.plant})
    request = urllib.request.Request(origin + "/api/device/movement?" + query,
                                     headers={"Authorization": "Device " + key})
    try:
        with urllib.request.build_opener(bridge.NoRedirect()).open(request, timeout=10) as response:
            state = json.loads(response.read(16384))
        if state.get("deviceId") != device_id or state.get("plantId") != args.plant:
            raise ValueError("Unexpected device binding")
    except (OSError, ValueError, AttributeError):
        parser.error("Cannot verify the sensor. Start/restart the backend and check the device ID, key and plant assignment.")

    env = dict(os.environ, PLANT_API_ORIGIN=origin, DEVICE_ID=device_id, DEVICE_KEY=key,
               CAMERA_PLANT_ID=args.plant, CAMERA_ID=os.environ.get("CAMERA_ID") or "CAM-001")
    if args.camera_device_id:
        camera_key = os.environ.get("CAMERA_DEVICE_KEY", "") or getpass.getpass("Camera provisioning key (hidden): ")
        if not re.fullmatch(r"[a-f0-9]{64}", camera_key):
            parser.error("A 64-character Camera provisioning key is required for clip integration.")
        env.update(CAMERA_DEVICE_ID=args.camera_device_id.strip(), CAMERA_DEVICE_KEY=camera_key)
    uploader = camera = None
    try:
        print("Starting sensor uploader and camera. Keep the backend running.", flush=True)
        print("Select the plant region with P. Press Q in the camera window to finish and stop both.", flush=True)
        uploader = subprocess.Popen([sys.executable, "-B", "-u", str(BRIDGE), "--port", args.port],
                                    cwd=str(ROOT), env=env)
        camera = subprocess.Popen([sys.executable, "-B", "-u", "-c", CAMERA_BOOTSTRAP,
                                   str(camera_path), str(args.camera_index)],
                                  cwd=str(ROOT), env=env, stdin=subprocess.PIPE, text=True)
        while True:
            for label, process in (("Sensor uploader", uploader), ("Camera", camera)):
                code = process.poll()
                if code is not None:
                    print(f"{label} exited (code {code}); stopping the other process.", flush=True)
                    return code
            time.sleep(0.25)
    except KeyboardInterrupt:
        print("\nStopping camera and uploader.", flush=True)
        return 0
    finally:
        stop_process(camera, camera=True)
        stop_process(uploader)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except OSError:
        sys.exit("Could not launch monitoring. Check the local Python environment and serial port.")
