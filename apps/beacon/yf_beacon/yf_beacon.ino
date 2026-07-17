// YawningFace beacon puck - iBeacon advertiser.
//
// The puck is deliberately dumb: it broadcasts an iBeacon advert forever and
// never talks to the phone. iOS Core Location matches the UUID and wakes the
// app, which then applies a Screen Time shield. See product/documentation/beacon.md.
//
// Target: ESP32 (dev board or ESP32-CAM). FQBN esp32:esp32:esp32cam.
// Nothing here is camera-specific; the camera is never initialised.

#include <BLEDevice.h>
#include <BLEUtils.h>
#include <Preferences.h>
#include <esp_bt.h>
#include <esp_gap_ble_api.h>

// ---------------------------------------------------------------------------
// Fleet identity
//
// The proximity UUID is a PUBLIC fleet identifier, not a secret. It is
// broadcast in the clear and can be sniffed or cloned, so it identifies a puck
// but never authenticates one. One UUID for the whole YawningFace fleet;
// major = zone (bedroom, desk), minor = the individual puck. iOS registers the
// UUID with major/minor wildcarded and reads the observed values back out of
// the event refinement.
//
// 088FD0AC-A9B1-407B-A9F1-84BA43FCF681
static const uint8_t FLEET_UUID[16] = {
  0x08, 0x8F, 0xD0, 0xAC, 0xA9, 0xB1, 0x40, 0x7B,
  0xA9, 0xF1, 0x84, 0xBA, 0x43, 0xFC, 0xF6, 0x81
};

// Defaults, overridden by whatever is saved in NVS (see `help` on serial).
static const uint16_t DEFAULT_MAJOR = 1;   // zone 1
static const uint16_t DEFAULT_MINOR = 1;   // puck 1
static const int8_t DEFAULT_MEASURED_POWER = -59;  // RSSI at 1 m, see calibrate()
static const int8_t DEFAULT_TX_DBM = 0;

// Apple's iBeacon advert is a fixed 30-byte layout:
//   02 01 06                     flags
//   1A FF 4C 00 02 15            len, mfg-data, Apple company ID, iBeacon type, len
//   <16 UUID> <2 major> <2 minor> <1 measured power>
// Major/minor are BIG-endian on the wire; the company ID is little-endian.
static const uint8_t APPLE_COMPANY_ID_LO = 0x4C;
static const uint8_t APPLE_COMPANY_ID_HI = 0x00;
static const uint8_t IBEACON_TYPE = 0x02;
static const uint8_t IBEACON_LENGTH = 0x15;  // 21 bytes follow

// 100 ms advertising interval, in 0.625 ms units. Apple's recommendation for
// iBeacon. Slower intervals measurably delay the enter event and make the
// already-laggy exit worse.
static const uint16_t ADV_INTERVAL_UNITS = 160;

Preferences prefs;
BLEAdvertising *advertising = nullptr;

struct Config {
  uint16_t major;
  uint16_t minor;
  int8_t measuredPower;
  int8_t txDbm;
} cfg;

// ESP32 BLE TX power is a discrete ladder, not a continuous dBm value.
static esp_power_level_t levelForDbm(int8_t dbm) {
  if (dbm <= -12) return ESP_PWR_LVL_N12;
  if (dbm <= -9) return ESP_PWR_LVL_N9;
  if (dbm <= -6) return ESP_PWR_LVL_N6;
  if (dbm <= -3) return ESP_PWR_LVL_N3;
  if (dbm <= 0) return ESP_PWR_LVL_N0;
  if (dbm <= 3) return ESP_PWR_LVL_P3;
  if (dbm <= 6) return ESP_PWR_LVL_P6;
  return ESP_PWR_LVL_P9;
}

static void loadConfig() {
  prefs.begin("yfbeacon", true);
  cfg.major = prefs.getUShort("major", DEFAULT_MAJOR);
  cfg.minor = prefs.getUShort("minor", DEFAULT_MINOR);
  cfg.measuredPower = prefs.getChar("power", DEFAULT_MEASURED_POWER);
  cfg.txDbm = prefs.getChar("tx", DEFAULT_TX_DBM);
  prefs.end();
}

static void saveConfig() {
  prefs.begin("yfbeacon", false);
  prefs.putUShort("major", cfg.major);
  prefs.putUShort("minor", cfg.minor);
  prefs.putChar("power", cfg.measuredPower);
  prefs.putChar("tx", cfg.txDbm);
  prefs.end();
}

static void buildAdvert() {
  uint8_t mfg[25];
  size_t i = 0;
  mfg[i++] = APPLE_COMPANY_ID_LO;
  mfg[i++] = APPLE_COMPANY_ID_HI;
  mfg[i++] = IBEACON_TYPE;
  mfg[i++] = IBEACON_LENGTH;
  memcpy(&mfg[i], FLEET_UUID, 16);
  i += 16;
  mfg[i++] = (uint8_t)(cfg.major >> 8);
  mfg[i++] = (uint8_t)(cfg.major & 0xFF);
  mfg[i++] = (uint8_t)(cfg.minor >> 8);
  mfg[i++] = (uint8_t)(cfg.minor & 0xFF);
  mfg[i++] = (uint8_t)cfg.measuredPower;

  BLEAdvertisementData data;
  data.setFlags(0x06);  // LE General Discoverable | BR/EDR not supported
  // String(ptr, len) keeps the embedded zero bytes a UUID will contain.
  data.setManufacturerData(String((const char *)mfg, sizeof(mfg)));

  advertising->setAdvertisementData(data);
  // A real iBeacon is broadcast-only. Non-connectable stops phones trying to
  // open a GATT connection to a puck that has nothing to serve.
  advertising->setAdvertisementType(ADV_TYPE_NONCONN_IND);
  advertising->setMinInterval(ADV_INTERVAL_UNITS);
  advertising->setMaxInterval(ADV_INTERVAL_UNITS);

  esp_ble_tx_power_set(ESP_BLE_PWR_TYPE_ADV, levelForDbm(cfg.txDbm));
}

static void restartAdvert() {
  advertising->stop();
  buildAdvert();
  advertising->start();
}

static void printConfig() {
  char uuid[37];
  snprintf(uuid, sizeof(uuid),
           "%02X%02X%02X%02X-%02X%02X-%02X%02X-%02X%02X-%02X%02X%02X%02X%02X%02X",
           FLEET_UUID[0], FLEET_UUID[1], FLEET_UUID[2], FLEET_UUID[3],
           FLEET_UUID[4], FLEET_UUID[5], FLEET_UUID[6], FLEET_UUID[7],
           FLEET_UUID[8], FLEET_UUID[9], FLEET_UUID[10], FLEET_UUID[11],
           FLEET_UUID[12], FLEET_UUID[13], FLEET_UUID[14], FLEET_UUID[15]);
  Serial.println();
  Serial.println("YF-BEACON advertising");
  Serial.printf("  uuid   %s\n", uuid);
  Serial.printf("  major  %u\n", cfg.major);
  Serial.printf("  minor  %u\n", cfg.minor);
  Serial.printf("  power  %d dBm (declared RSSI at 1 m)\n", cfg.measuredPower);
  Serial.printf("  tx     %d dBm\n", cfg.txDbm);
  Serial.printf("  mac    %s\n", BLEDevice::getAddress().toString().c_str());
}

// Serial provisioning, so a puck gets its zone without a recompile.
static void handleLine(String line) {
  line.trim();
  int sp = line.indexOf(' ');
  String cmd = sp < 0 ? line : line.substring(0, sp);
  long arg = sp < 0 ? 0 : line.substring(sp + 1).toInt();

  if (cmd == "major" && sp > 0) {
    cfg.major = (uint16_t)arg;
  } else if (cmd == "minor" && sp > 0) {
    cfg.minor = (uint16_t)arg;
  } else if (cmd == "power" && sp > 0) {
    cfg.measuredPower = (int8_t)arg;
  } else if (cmd == "tx" && sp > 0) {
    // Changing TX power resizes the puck's physical bubble. measuredPower must
    // be recalibrated to match or iOS's distance estimate goes wrong by the
    // same number of dB.
    cfg.txDbm = (int8_t)arg;
  } else if (cmd == "show") {
    printConfig();
    return;
  } else {
    Serial.println("commands: major <n> | minor <n> | power <dBm> | tx <dBm> | show");
    return;
  }
  saveConfig();
  restartAdvert();
  printConfig();
}

void setup() {
  Serial.begin(115200);
  delay(300);

  // BLE-only: hand the Classic BT controller's RAM back before init.
  esp_bt_controller_mem_release(ESP_BT_MODE_CLASSIC_BT);

  loadConfig();
  BLEDevice::init("");  // no name: it would not fit beside a 30-byte iBeacon advert
  advertising = BLEDevice::getAdvertising();
  buildAdvert();
  advertising->start();
  printConfig();
}

void loop() {
  static String line;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (line.length()) {
        handleLine(line);
        line = "";
      }
    } else {
      line += c;
    }
  }
  delay(20);
}
