> Historical instructions: project Python files and launchers were removed at the user's request. Python commands below are no longer runnable. The active website uses Vue, Node.js and PostgreSQL.

# USB sensor host

Run the bridge on the computer physically attached to the board. A remote
Codespace cannot see a USB board connected to Windows. Windows Python works
directly; WSL is not required. Use a local checkout of these files on that host.

## What the existing firmware tells us

The pins suggest an ESP32; the exact board and analog probe models are not
identified. Confirm them before wiring or uploading firmware. The sketch uses:

| Component | Firmware connection |
| --- | --- |
| DHT11 temperature/humidity | GPIO4 |
| Analog soil probe | GPIO35 |
| Analog rain probe | GPIO34 |
| Analog sound probe | GPIO32 |
| LED | GPIO5 |
| MPU6050 | I2C SDA21, SCL22 |
| Serial | 115200 baud |

Confirm supply/logic voltage and calibration against the exact hardware specs.
Soil/rain/sound are raw ADC readings, not percentages or sound-pressure units.
Backend alerts currently use `value > threshold`; the sketch's sound LED uses
`sound < 2000`, so these are different rules. Do not infer alert thresholds from
that LED rule or change threshold direction without the actual probe behavior.

## Windows PowerShell, from the local repository root

Install Python if it is missing, then prepare an isolated environment:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r IoT/PlantPrototype/requirements.txt
.\.venv\Scripts\python.exe IoT/PlantPrototype/serial_bridge.py --list-ports
```

Listing ports needs no API credentials and sends nothing. Select the actual
port shown; do not assume a COM number. Close the Arduino Serial Monitor before
starting the bridge because it may already own the port.

In the Administrator website, register the actual device and retain its one-time
provisioning key privately. Set `PLANT_API_ORIGIN` to the verified reachable HTTPS
gateway and `DEVICE_ID` to the registered ID using the host's environment settings.
To enter the key without putting it literally into shell history:

```powershell
$iotSecret = Read-Host 'Device provisioning key' -AsSecureString
$env:DEVICE_KEY = [System.Net.NetworkCredential]::new('', $iotSecret).Password
Remove-Variable iotSecret
```

Connect this host to the same approved Tailscale network if using the private
gateway. Verify its `/health` returns JSON. The phone's VPN does not give the USB
computer network access automatically. Keep the backend services running.

Start collection with the real port, replacing `COM_PORT_FROM_LIST`:

```powershell
.\.venv\Scripts\python.exe IoT/PlantPrototype/serial_bridge.py --port COM_PORT_FROM_LIST
```

Press Ctrl+C to stop. Complete readings are committed to the private SQLite
outbox before upload. A USB disconnect stops the bridge; reconnect the device,
check its port again, and rerun. Existing queued readings remain on disk.
Recover queued readings without opening USB:

```powershell
.\.venv\Scripts\python.exe IoT/PlantPrototype/serial_bridge.py --drain --attempts 30
```

Once finished, remove the key from this shell with `Remove-Item Env:DEVICE_KEY`.
Do not paste keys, private readings or outbox files into chat or Git.

## Linux/macOS USB host

Use the same Python virtual environment and requirements, then run:

```bash
python IoT/PlantPrototype/serial_bridge.py --list-ports
python IoT/PlantPrototype/serial_bridge.py --port /actual/local/serial/port
```

Use your host's private environment configuration for the same three variables.
Existing stdin piping remains supported and requires no pyserial dependency in
the bridge itself. Network serial URLs are rejected by `--port`.

## Real acceptance evidence still required

1. Confirm board/probe model, voltage, wiring, calibration and measurement direction.
2. Compare actual readings with reference measurements; confirm units and times.
3. Administrator and Conservation Officer can read them; Botanist/Visitor cannot.
4. Administrator sets a suitable threshold. A controlled real crossing creates
   an alert. Conservation Officer records its response; Administrator is denied
   that response action, Officer is denied device/threshold management.
5. Disconnect/reconnect the network and restart the bridge. Pending readings
   recover with their original client keys and no duplicate readings/alerts.
6. Verify a disabled device is rejected and pending data remains available.

Automated tests use isolated synthetic data; they do not establish these physical
results. Current status is **software verified; real hardware not verified**.
