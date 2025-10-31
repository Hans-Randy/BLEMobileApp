import { BleManager, Device, Characteristic } from 'react-native-ble-plx';
import { Platform } from 'react-native';

// ---- UUIDs (BUDDHA Rev F) -------------------------------------------
// Services
const S_DEVICE_INFO = '01950010-d6ea-7cc9-9d0b-ab7df1248728';
const S_BATTERY = '01950020-d6ea-7cc9-9d0b-ab7df1248728';
const S_TCFG = '01950030-d6ea-7cc9-9d0b-ab7df1248728';
const S_TCTRL = '01950040-d6ea-7cc9-9d0b-ab7df1248728';

// Device Info Characteristics
const C_HW_VER = '01950011-d6ea-7cc9-9d0b-ab7df1248728'; // 2 bytes: MSB major, LSB minor
const C_FW_VER = '01950012-d6ea-7cc9-9d0b-ab7df1248728'; // 2 bytes

// Battery Characteristics
const C_BATT_LEVEL = '01950021-d6ea-7cc9-9d0b-ab7df1248728'; // u8 (0–100), R/Notify
const C_BATT_AVG_I = '01950022-d6ea-7cc9-9d0b-ab7df1248728'; // i16 mA, Read
const C_BATT_STATUS = '01950023-d6ea-7cc9-9d0b-ab7df1248728'; // u8 0/1, R/Notify
const C_CHG_CONN = '01950024-d6ea-7cc9-9d0b-ab7df1248728'; // u8 0/1, R/Notify
const C_SHIP_MODE = '01950025-d6ea-7cc9-9d0b-ab7df1248728'; // u8 0/1, Write

// Treatment Config (R/W)
const C_STEP_LIST = '01950031-d6ea-7cc9-9d0b-ab7df1248728'; //Array[40]

// Treatment Control Characteristics
const C_CTRL = '01950041-d6ea-7cc9-9d0b-ab7df1248728'; // uint8_t, R/W
const C_TOTAL_MS = '01950042-d6ea-7cc9-9d0b-ab7df1248728'; // uint16_t, R/W  (milliseconds)
const C_LRA1_EN = '01950043-d6ea-7cc9-9d0b-ab7df1248728'; // uint8_t, R/W
const C_LRA2_EN = '01950044-d6ea-7cc9-9d0b-ab7df1248728'; // uint8_t, R/W
const C_LRA3_EN = '01950045-d6ea-7cc9-9d0b-ab7df1248728'; // uint8_t, R/W
const C_REMAIN_MS = '01950046-d6ea-7cc9-9d0b-ab7df1248728'; // uint16_t, R/Notify (milliseconds)
const C_INTENSITY = '01950047-d6ea-7cc9-9d0b-ab7df1248728'; // uint8_t, R/W (%)
const C_STATUS = '01950048-d6ea-7cc9-9d0b-ab7df1248728'; // uint8_t, R/Notify
const C_ERROR = '01950049-d6ea-7cc9-9d0b-ab7df1248728'; // uint16_t, Read
// ---------------------------------------------------------------------------

// Base64 helpers for ble-plx (which uses base64 payloads)
const b64FromBytes = (bytes: number[]) =>
  Platform.select({
    ios: Buffer.from(Uint8Array.from(bytes)).toString('base64'),
    android: Buffer.from(Uint8Array.from(bytes)).toString('base64'),
    default: Buffer.from(Uint8Array.from(bytes)).toString('base64'),
  });

const bytesFromB64 = (b64: string) => Uint8Array.from(Buffer.from(b64, 'base64'));

const readU8 = (c: Characteristic) => bytesFromB64(c.value!)[0];
const readI16 = (c: Characteristic) => {
  const d = bytesFromB64(c.value!);
  // eslint-disable-next-line no-bitwise
  const v = d[0] | (d[1] << 8);
  // eslint-disable-next-line no-bitwise
  const isNegative = (v & 0x8000) !== 0;
  return isNegative ? v - 0x10000 : v; // signed
};
const readU16 = (c: Characteristic) => {
  const d = bytesFromB64(c.value!);
  // eslint-disable-next-line no-bitwise
  return d[0] | (d[1] << 8);
};

const writeU8 = (v: number) => {
  // eslint-disable-next-line no-bitwise
  const byte0 = v & 0xFF;
  return b64FromBytes([byte0]);
};
const writeU16 = (v: number) => {
  // eslint-disable-next-line no-bitwise
  const byte0 = v & 0xFF;
  // eslint-disable-next-line no-bitwise
  const byte1 = (v >> 8) & 0xFF;
  return b64FromBytes([byte0, byte1]);
};

// ---- Step list payload: 3 bytes per step: [amp:u8][dur_lo:u8][dur_hi:u8] ----
const packStepsToB64 = (steps: Step[]): string => {
  if (!Array.isArray(steps) || steps.length === 0) throw new Error('steps required');
  const bytes: number[] = [];
  for (const s of steps) {
    if (!Number.isInteger(s.amplitudePct) || s.amplitudePct < 0 || s.amplitudePct > 100) {
      throw new Error('amplitudePct must be 0–100');
    }
    if (!Number.isInteger(s.durationMs) || s.durationMs < 1 || s.durationMs > 0xFFFF) {
      throw new Error('durationMs must be 1–65535 ms');
    }
    // [amp][dur_lo][dur_hi]
    bytes.push(
      // eslint-disable-next-line no-bitwise
      s.amplitudePct & 0xFF,
      // eslint-disable-next-line no-bitwise
      s.durationMs & 0xFF,
      // eslint-disable-next-line no-bitwise
      (s.durationMs >> 8) & 0xFF
    );
  }
  return b64FromBytes(bytes);
};

const unpackStepsFromB64 = (b64: string | null | undefined): Step[] => {
  if (!b64) return [];
  const d = bytesFromB64(b64);
  if (d.length % 3 !== 0) throw new Error('Malformed step list payload (not multiple of 3)');
  const steps: Step[] = [];
  for (let i = 0; i < d.length; i += 3) {
    const amplitudePct = d[i];
    // eslint-disable-next-line no-bitwise
    const durationMs = d[i + 1] | (d[i + 2] << 8);
    steps.push({ amplitudePct, durationMs });
  }
  return steps;
};

export class BuddhaBleClient {
  private manager = new BleManager();
  private device: Device | null = null;

  async scanAndConnect(opts?: { namePrefix?: string; timeoutMs?: number }) {
    const timeout = opts?.timeoutMs ?? 15_000;
    const namePrefix = opts?.namePrefix ?? 'BUDD'; // adjust to your advertised name

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.manager.stopDeviceScan();
        reject(new Error('Scan timeout'));
      }, timeout);

      this.manager.startDeviceScan(null, { allowDuplicates: false }, async (error: any, device: any) => {
        if (error) {
          clearTimeout(timer);
          this.manager.stopDeviceScan();
          reject(error);
          return;
        }
        if (device?.name?.startsWith(namePrefix)) {
          try {
            this.manager.stopDeviceScan();
            const d = await device.connect();
            this.device = await d.discoverAllServicesAndCharacteristics();
            clearTimeout(timer);
            resolve();
          } catch (e) {
            clearTimeout(timer);
            reject(e);
          }
        }
      });
    });
  }

  async disconnect() {
    if (this.device) {
      try {
        await this.device.cancelConnection();
      } finally {
        this.device = null;
      }
    }
  }

  async isConnected() {
    return this.device ? this.device.isConnected() : false;
  }

  private requireDev(): Device {
    if (!this.device) throw new Error('Not connected');
    return this.device;
  }

  // --- Device Info ---------------------------------------------------------
  async readDeviceInfo() {
    const dev = this.requireDev();
    const hw = await dev.readCharacteristicForService(S_DEVICE_INFO, C_HW_VER);
    const fw = await dev.readCharacteristicForService(S_DEVICE_INFO, C_FW_VER);
    const hwWord = readU16(hw);
    const fwWord = readU16(fw);
    // eslint-disable-next-line no-bitwise
    const hwMajor = (hwWord >> 8) & 0xFF;
    // eslint-disable-next-line no-bitwise
    const hwMinor = hwWord & 0xFF;
    // eslint-disable-next-line no-bitwise
    const fwMajor = (fwWord >> 8) & 0xFF;
    // eslint-disable-next-line no-bitwise
    const fwMinor = fwWord & 0xFF;
    return { hwMajor, hwMinor, fwMajor, fwMinor };
  }

  // --- Battery -------------------------------------------------------------
  async readBattery() {
    const dev = this.requireDev();
    const level = readU8(await dev.readCharacteristicForService(S_BATTERY, C_BATT_LEVEL));
    const avgI = readI16(await dev.readCharacteristicForService(S_BATTERY, C_BATT_AVG_I));
    const chg = readU8(await dev.readCharacteristicForService(S_BATTERY, C_BATT_STATUS));
    const conn = readU8(await dev.readCharacteristicForService(S_BATTERY, C_CHG_CONN));
    return { level, avgCurrentMa: avgI, chargeStatus: chg as 0 | 1, chargerConnected: conn as 0 | 1 };
  }

  subscribeBatteryLevel(cb: (level: number) => void) {
    const dev = this.requireDev();
    return dev.monitorCharacteristicForService(S_BATTERY, C_BATT_LEVEL, (err: any, c: any) => {
      if (!err && c?.value) cb(readU8(c));
    }).remove;
  }

  subscribeChargerStatus(cb: (connected: 0 | 1) => void) {
    const dev = this.requireDev();
    return dev.monitorCharacteristicForService(S_BATTERY, C_CHG_CONN, (err: any, c: any) => {
      if (!err && c?.value) cb(readU8(c) as 0 | 1);
    }).remove;
  }

  async writeShipMode(active: 0 | 1) {
    const dev = this.requireDev();
    await dev.writeCharacteristicWithoutResponseForService(S_BATTERY, C_SHIP_MODE, writeU8(active));
  }

  // --- Treatment Control ---------------------------------------------------
  async readStatus() {
    const dev = this.requireDev();
    const status = readU8(await dev.readCharacteristicForService(S_TCTRL, C_STATUS)) as 0 | 1 | 2 | 3;
    const err = readU16(await dev.readCharacteristicForService(S_TCTRL, C_ERROR));
    const rem = readU16(await dev.readCharacteristicForService(S_TCTRL, C_REMAIN_MS));
    const inten = readU8(await dev.readCharacteristicForService(S_TCTRL, C_INTENSITY));
    const total = readU16(await dev.readCharacteristicForService(S_TCTRL, C_TOTAL_MS));
    return { status, errorCode: err, remainingSec: rem, intensityPct: inten, totalDurationSec: total };
  }

  async writeControl(action: 0 | 1 | 2) {
    const dev = this.requireDev();
    await dev.writeCharacteristicWithoutResponseForService(S_TCTRL, C_CTRL, writeU8(action));
  }

  async writeTotalDurationMs(ms: number) {
    const dev = this.requireDev();
    await dev.writeCharacteristicWithoutResponseForService(S_TCTRL, C_TOTAL_MS, writeU16(ms));
  }

  async writeIntensity(percent: number) {
    const dev = this.requireDev();
    await dev.writeCharacteristicWithoutResponseForService(S_TCTRL, C_INTENSITY, writeU8(percent));
  }

  subscribeStatus(cb: (status: 0 | 1 | 2 | 3) => void) {
    const dev = this.requireDev();
    return dev.monitorCharacteristicForService(S_TCTRL, C_STATUS, (err: any, c: any) => {
      if (!err && c?.value) cb(readU8(c) as 0 | 1 | 2 | 3);
    }).remove;
  }

  subscribeRemainingTime(cb: (remainingMillisecs: number) => void) {
    const dev = this.requireDev();
    return dev.monitorCharacteristicForService(S_TCTRL, C_REMAIN_MS, (err: any, c: any) => {
      if (!err && c?.value) cb(readU16(c));
    }).remove;
  }

  async readRemainingTimeMs(): Promise<number> {
    const dev = this.requireDev();
    const ch = await dev.readCharacteristicForService(S_TCTRL, C_REMAIN_MS);
    return readU16(ch); // ms (u16)
  }

  async readLraEnables() {
    const dev = this.requireDev();
    const lra1 = readU8(await dev.readCharacteristicForService(S_TCTRL, C_LRA1_EN)) as 0 | 1;
    const lra2 = readU8(await dev.readCharacteristicForService(S_TCTRL, C_LRA2_EN)) as 0 | 1;
    const lra3 = readU8(await dev.readCharacteristicForService(S_TCTRL, C_LRA3_EN)) as 0 | 1;
    return { lra1, lra2, lra3 };
  }

  async writeLraEnables(flags: Partial<{ lra1: 0 | 1; lra2: 0 | 1; lra3: 0 | 1 }>) {
    const dev = this.requireDev();
    const valid = (v: number) => {
      if (v !== 0 && v !== 1) throw new Error('LRA flag must be 0 or 1');
      return v;
    };
    if (flags.lra1 != null)
      await dev.writeCharacteristicWithoutResponseForService(S_TCTRL, C_LRA1_EN, writeU8(valid(flags.lra1)));
    if (flags.lra2 != null)
      await dev.writeCharacteristicWithoutResponseForService(S_TCTRL, C_LRA2_EN, writeU8(valid(flags.lra2)));
    if (flags.lra3 != null)
      await dev.writeCharacteristicWithoutResponseForService(S_TCTRL, C_LRA3_EN, writeU8(valid(flags.lra3)));
  }

  async readSteps() {
    const dev = this.requireDev();
    const ch = await dev.readCharacteristicForService(S_TCFG, C_STEP_LIST);
    const steps = unpackStepsFromB64(ch.value);
    return { steps };
  }

  async writeSteps(steps: Step[]) {
    const dev = this.requireDev();
    const payload = packStepsToB64(steps);
    await dev.writeCharacteristicWithoutResponseForService(S_TCFG, C_STEP_LIST, payload);
  }
}

export type Step = {
  amplitudePct: number; // 0–100 (u8)
  durationMs: number; // 1–65535 ms (u16)
};
