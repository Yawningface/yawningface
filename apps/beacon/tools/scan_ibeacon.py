"""Verify a puck is emitting a spec-correct iBeacon advert.

Decodes Apple manufacturer data (company 0x004C) straight off the air and
prints the fields iOS will act on, so a puck can be checked without an iPhone.

    uv run --with bleak python scan_ibeacon.py [--seconds 10] [--uuid <UUID>]
"""

import argparse
import asyncio
import struct

from bleak import BleakScanner

APPLE_COMPANY_ID = 0x004C
IBEACON_TYPE = 0x02
IBEACON_LENGTH = 0x15


def parse_ibeacon(mfg: bytes):
    """Return (uuid, major, minor, measured_power) or None if not an iBeacon."""
    if len(mfg) != 23 or mfg[0] != IBEACON_TYPE or mfg[1] != IBEACON_LENGTH:
        return None
    uuid_bytes = mfg[2:18]
    major, minor = struct.unpack(">HH", mfg[18:22])
    measured_power = struct.unpack("b", mfg[22:23])[0]
    u = uuid_bytes.hex().upper()
    uuid = f"{u[0:8]}-{u[8:12]}-{u[12:16]}-{u[16:20]}-{u[20:32]}"
    return uuid, major, minor, measured_power


async def main(seconds: float, want_uuid: str | None):
    seen = {}

    def on_detect(device, adv):
        mfg = adv.manufacturer_data.get(APPLE_COMPANY_ID)
        if not mfg:
            return
        parsed = parse_ibeacon(mfg)
        if not parsed:
            return
        uuid, major, minor, power = parsed
        if want_uuid and uuid.lower() != want_uuid.lower():
            return
        key = (uuid, major, minor)
        entry = seen.setdefault(
            key, {"power": power, "rssi": [], "addr": device.address, "conn": adv.local_name}
        )
        entry["rssi"].append(adv.rssi)

    scanner = BleakScanner(detection_callback=on_detect)
    await scanner.start()
    await asyncio.sleep(seconds)
    await scanner.stop()

    if not seen:
        print("no iBeacon found")
        return 1

    for (uuid, major, minor), e in seen.items():
        rssi = e["rssi"]
        avg = sum(rssi) / len(rssi)
        # ~100 ms interval => ~10 adverts/sec. Windows coalesces, so treat this
        # as a floor on the rate, not a measurement of it.
        print(f"iBeacon {uuid}")
        print(f"  major {major}  minor {minor}  measured power {e['power']} dBm")
        print(f"  mac {e['addr']}")
        print(f"  {len(rssi)} adverts in {seconds:.0f}s, rssi avg {avg:.1f} dBm "
              f"(min {min(rssi)}, max {max(rssi)})")
        # Apple's path-loss model: accuracy ~ 10^((measuredPower - rssi)/20)
        est = 10 ** ((e["power"] - avg) / 20.0)
        print(f"  implied iOS accuracy at this distance: ~{est:.2f} m")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=10)
    ap.add_argument("--uuid", default=None)
    args = ap.parse_args()
    raise SystemExit(asyncio.run(main(args.seconds, args.uuid)))
