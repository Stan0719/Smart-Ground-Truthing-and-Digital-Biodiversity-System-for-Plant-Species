"""Combine the existing ESP32 Serial output with camera handling alerts."""

import argparse
from datetime import datetime, timezone
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time


WINDOW_SECONDS = 5
COOLDOWN_SECONDS = 10


def read_esp32(connection, events, stop):
    try:
        while not stop.is_set():
            line = connection.readline().decode("utf-8", errors="replace").strip()
            label, separator, value = line.partition(":")
            if separator and label.strip() == "Movement":
                if value.strip() == "DETECTED":
                    events.put(("movement", time.monotonic()))
    except Exception as error:
        if not stop.is_set():
            events.put(("error", f"ESP32 connection failed: {error}"))


def read_camera(process, events, stop):
    try:
        for line in process.stdout:
            print("[CAMERA]", line.rstrip(), flush=True)
            # Matches the handling message emitted by the current camera script.
            if "ALERT:" in line and "contact plus plant movement" in line:
                events.put(("contact", time.monotonic()))
    except Exception as error:
        if not stop.is_set():
            events.put(("error", f"Camera output failed: {error}"))
    finally:
        if not stop.is_set():
            events.put(("error", "Camera program closed."))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", required=True, help="ESP32 port, e.g. COM3")
    parser.add_argument("--camera", required=True, help="Path to camera cam.py")
    parser.add_argument("--plant", required=True, help="Registered website plant ID")
    args = parser.parse_args()
    camera_path = Path(args.camera).resolve()
    if not camera_path.is_file():
        parser.error(f"Camera script not found: {camera_path}")

    try:
        import serial
    except ImportError:
        parser.exit(1, "Install pyserial first: python -m pip install pyserial\n")

    events = queue.Queue()
    stop = threading.Event()
    camera = None
    workers = []
    with serial.Serial(args.port, 115200, timeout=1) as connection:
        try:
            camera = subprocess.Popen(
                [sys.executable, "-u", str(camera_path)],
                cwd=str(camera_path.parent),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            workers = [
                threading.Thread(
                    target=read_esp32, args=(connection, events, stop), daemon=True
                ),
                threading.Thread(
                    target=read_camera, args=(camera, events, stop), daemon=True
                ),
            ]
            for worker in workers:
                worker.start()
            print(f"Monitoring {args.plant}. Press Ctrl+C to stop.", flush=True)
            print("Use a fixed camera region for this ESP32's plant.", flush=True)
            movement_at = contact_at = last_alert = float("-inf")
            while True:
                try:
                    kind, value = events.get(timeout=0.5)
                except queue.Empty:
                    continue
                if kind == "error":
                    raise RuntimeError(value)
                if kind == "movement":
                    movement_at = value
                elif kind == "contact":
                    contact_at = value
                now = time.monotonic()
                if (
                    now - movement_at <= WINDOW_SECONDS
                    and now - contact_at <= WINDOW_SECONDS
                    and now - last_alert >= COOLDOWN_SECONDS
                ):
                    timestamp = datetime.now(timezone.utc).isoformat()
                    print(
                        f"\nCOMBINED ALERT | {timestamp} | {args.plant}\n"
                        "Camera handling + ESP32 movement: suspected disturbance.\n",
                        flush=True,
                    )
                    last_alert = now
                    contact_at = float("-inf")
        finally:
            stop.set()
            if camera is not None:
                if camera.poll() is None:
                    camera.terminate()
                try:
                    camera.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    camera.kill()
                    camera.wait()
            for worker in workers:
                worker.join(timeout=2)
            if camera is not None and camera.stdout is not None:
                camera.stdout.close()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nMonitoring stopped.")
    except Exception as error:
        sys.exit(f"Monitoring stopped: {error}")
