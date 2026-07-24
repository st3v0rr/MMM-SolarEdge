/* global Buffer */
/* MagicMirror²
 * MMM-SolarEdge - SunSpec reader for SolarEdge inverters
 *
 * Reads inverters, the export/import meter and the batteries over Modbus/TCP
 * and maps everything onto the same structure the monitoring API returns, so
 * the frontend does not need to know where the data came from.
 *
 * Register addresses below are wire addresses (0-based), which are the
 * documented SolarEdge register numbers minus one.
 *
 * By Stefan Nachtrab
 * MIT Licensed.
 */

const ModbusClient = require("./modbus-client");

const SUNSPEC_ID = 0x53756e53; // "SunS"

const REG = {
  sunSpecId: 40000,
  common: { base: 40004, length: 66, manufacturer: 0, model: 16, serial: 48 },
  inverter: {
    base: 40071,
    length: 40,
    acPower: 40083,
    acPowerSf: 40084,
    acEnergy: 40093,
    acEnergySf: 40095,
    dcPower: 40100,
    dcPowerSf: 40101,
    temperature: 40103,
    temperatureSf: 40106,
    status: 40107
  },
  meter: {
    powerBase: 40190,
    powerLength: 25,
    power: 40206,
    powerSf: 40210,
    energyBase: 40226,
    energyLength: 18,
    exported: 40226,
    imported: 40234,
    energySf: 40242
  },
  battery: {
    base: 0xe100,
    headerLength: 70,
    manufacturer: 0x00,
    model: 0x10,
    serial: 0x30,
    ratedEnergy: 0x42,
    liveBase: 0x6c,
    liveLength: 32,
    averageTemperature: 0x6c,
    voltage: 0x70,
    current: 0x72,
    power: 0x74,
    maxEnergy: 0x7e,
    availableEnergy: 0x80,
    stateOfHealth: 0x82,
    stateOfCharge: 0x84,
    status: 0x86
  }
};

/* SunSpec inverter operating states that mean "producing". */
const PRODUCING_STATES = [3, 4, 5];

/* Power below this (W) is treated as no flow, which keeps the arrows in the UI
 * from flickering around zero. Low enough that the trickle a house feeds into
 * the grid still shows up as an arrow. Configurable via modbus.flowThreshold. */
const DEFAULT_FLOW_THRESHOLD_W = 10;

/* Below this DC power the measured conversion ratio is too noisy to use. */
const CONVERSION_MIN_W = 100;

/* No inverter converts worse than this, so anything lower is a bad reading. */
const MIN_CONVERSION_RATIO = 0.85;

const uint16 = (buffer, offset) => buffer.readUInt16BE(offset * 2);
const int16 = (buffer, offset) => buffer.readInt16BE(offset * 2);
const uint32 = (buffer, offset) => buffer.readUInt32BE(offset * 2);

const readString = (buffer, offset, registers) =>
  buffer
    .subarray(offset * 2, offset * 2 + registers * 2)
    .toString("ascii")
    .replace(/\0/g, "")
    .trim();

/* SolarEdge stores the battery block as float32 with swapped word order
 * (CDAB). Reading it as plain big endian yields denormalised garbage. */
const float32 = (buffer, offset) =>
  Buffer.from([
    buffer[offset * 2 + 2],
    buffer[offset * 2 + 3],
    buffer[offset * 2],
    buffer[offset * 2 + 1]
  ]).readFloatBE(0);

/* Applies a SunSpec scale factor, which is a signed power of ten. */
const applyScaleFactor = (value, scaleFactor) => {
  const signed = scaleFactor > 0x7fff ? scaleFactor - 0x10000 : scaleFactor;
  return value * Math.pow(10, signed);
};

const isUsable = (value) => Number.isFinite(value);

class SolarEdgeModbus {
  constructor(config) {
    this.config = config;
    this.client = new ModbusClient({
      host: config.host,
      port: config.port,
      timeout: config.timeout
    });
    this.warned = {};
    this.nameplates = {};
    this.threshold =
      config.flowThreshold !== undefined
        ? config.flowThreshold
        : DEFAULT_FLOW_THRESHOLD_W;
  }

  warnOnce(key, message) {
    if (!this.warned[key]) {
      this.warned[key] = true;
      console.warn("[MMM-SolarEdge] " + message);
    }
  }

  close() {
    this.client.close();
  }

  async read(unitId, address, length) {
    return this.client.readHoldingRegisters(unitId, address, length);
  }

  /* Verifies the unit really is a SunSpec device before we trust any offset. */
  async probe(unitId) {
    const buffer = await this.read(unitId, REG.sunSpecId, 2);
    if (buffer.readUInt32BE(0) !== SUNSPEC_ID) {
      throw new Error(
        "Modbus unit " + unitId + " does not expose a SunSpec device"
      );
    }
    const common = await this.read(unitId, REG.common.base, REG.common.length);
    return {
      unitId,
      manufacturer: readString(common, REG.common.manufacturer, 16),
      model: readString(common, REG.common.model, 16),
      serial: readString(common, REG.common.serial, 16)
    };
  }

  async readInverter(unitId) {
    const buffer = await this.read(
      unitId,
      REG.inverter.base,
      REG.inverter.length
    );
    const at = (address) => address - REG.inverter.base;
    return {
      unitId,
      acPower: applyScaleFactor(
        int16(buffer, at(REG.inverter.acPower)),
        uint16(buffer, at(REG.inverter.acPowerSf))
      ),
      dcPower: applyScaleFactor(
        int16(buffer, at(REG.inverter.dcPower)),
        uint16(buffer, at(REG.inverter.dcPowerSf))
      ),
      lifetimeEnergy: applyScaleFactor(
        uint32(buffer, at(REG.inverter.acEnergy)),
        uint16(buffer, at(REG.inverter.acEnergySf))
      ),
      temperature: applyScaleFactor(
        int16(buffer, at(REG.inverter.temperature)),
        uint16(buffer, at(REG.inverter.temperatureSf))
      ),
      status: uint16(buffer, at(REG.inverter.status))
    };
  }

  /* Nameplate data never changes, so it is read once per unit instead of on
   * every poll - each round trip over the RS485 chain is expensive. */
  async readBatteryNameplate(unitId) {
    if (this.nameplates[unitId] !== undefined) {
      return this.nameplates[unitId];
    }

    let header;
    try {
      header = await this.read(
        unitId,
        REG.battery.base,
        REG.battery.headerLength
      );
    } catch (error) {
      /* An inverter without a battery rejects the address outright. That is a
       * permanent answer, so it is remembered - otherwise a PV only site would
       * pay for a pointless read on every single poll. A timeout or a dropped
       * connection says nothing about the battery, so that one is retried. */
      if (error.message.startsWith("Modbus exception")) {
        this.nameplates[unitId] = null;
        this.warnOnce(
          "battery-" + unitId,
          "Modbus unit " + unitId + " reports no battery, continuing without " +
            "storage"
        );
        return null;
      }
      throw error;
    }

    const manufacturer = readString(header, REG.battery.manufacturer, 16);
    this.nameplates[unitId] = manufacturer
      ? {
          manufacturer,
          model: readString(header, REG.battery.model, 16),
          serial: readString(header, REG.battery.serial, 16),
          ratedEnergy: float32(header, REG.battery.ratedEnergy)
        }
      : null;
    return this.nameplates[unitId];
  }

  /* Returns null when the unit has no battery attached. */
  async readBattery(unitId) {
    const nameplate = await this.readBatteryNameplate(unitId);
    if (!nameplate) {
      return null;
    }

    const live = await this.read(
      unitId,
      REG.battery.base + REG.battery.liveBase,
      REG.battery.liveLength
    );
    const at = (offset) => offset - REG.battery.liveBase;

    /* Inverters without a battery do not always answer with an exception -
     * some hand out an uninitialised block instead. A state of charge outside
     * its physical range is the giveaway that there is nothing there. */
    const stateOfCharge = float32(live, at(REG.battery.stateOfCharge));
    if (!isUsable(stateOfCharge) || stateOfCharge < 0 || stateOfCharge > 100) {
      return null;
    }

    return {
      unitId,
      manufacturer: nameplate.manufacturer,
      model: nameplate.model,
      serial: nameplate.serial,
      ratedEnergy: nameplate.ratedEnergy,
      temperature: float32(live, at(REG.battery.averageTemperature)),
      voltage: float32(live, at(REG.battery.voltage)),
      current: float32(live, at(REG.battery.current)),
      // negative while discharging, positive while charging
      power: float32(live, at(REG.battery.power)),
      maxEnergy: float32(live, at(REG.battery.maxEnergy)),
      availableEnergy: float32(live, at(REG.battery.availableEnergy)),
      stateOfHealth: float32(live, at(REG.battery.stateOfHealth)),
      stateOfCharge,
      status: live.readUInt32BE(at(REG.battery.status) * 2)
    };
  }

  /* Returns null when the leader inverter has no meter attached. */
  async readMeter(unitId) {
    const power = await this.read(
      unitId,
      REG.meter.powerBase,
      REG.meter.powerLength
    );
    const energy = await this.read(
      unitId,
      REG.meter.energyBase,
      REG.meter.energyLength
    );
    const atPower = (address) => address - REG.meter.powerBase;
    const atEnergy = (address) => address - REG.meter.energyBase;

    const scaleFactor = uint16(energy, atEnergy(REG.meter.energySf));
    const value = applyScaleFactor(
      int16(power, atPower(REG.meter.power)),
      uint16(power, atPower(REG.meter.powerSf))
    );
    if (!isUsable(value)) {
      return null;
    }

    return {
      // positive means feeding into the grid
      power: this.config.invertGridSign ? -value : value,
      exported: applyScaleFactor(
        uint32(energy, atEnergy(REG.meter.exported)),
        scaleFactor
      ),
      imported: applyScaleFactor(
        uint32(energy, atEnergy(REG.meter.imported)),
        scaleFactor
      )
    };
  }

  /* Reads everything and maps it onto the monitoring API's power flow shape. */
  async readPowerFlow() {
    const inverters = [];
    const batteries = [];

    for (const unitId of this.config.inverterUnitIds) {
      inverters.push(await this.readInverter(unitId));
      try {
        const battery = await this.readBattery(unitId);
        if (battery) {
          batteries.push(battery);
        }
      } catch (error) {
        this.warnOnce(
          "battery-" + unitId,
          "Could not read the battery on Modbus unit " + unitId + ": " +
            error.message
        );
      }
    }

    if (!inverters.length) {
      throw new Error("No Modbus inverter units configured");
    }

    let meter = null;
    try {
      meter = await this.readMeter(this.config.meterUnitId);
    } catch (error) {
      this.warnOnce(
        "meter",
        "Could not read the meter on Modbus unit " + this.config.meterUnitId +
          ": " + error.message + " - grid values will be reported as zero"
      );
    }
    if (!meter) {
      this.warnOnce(
        "meter-missing",
        "No export/import meter found on Modbus unit " +
          this.config.meterUnitId + " - grid values will be reported as zero"
      );
    } else {
      this.verifyGridSign(meter);
    }

    return this.mapPowerFlow(inverters, batteries, meter);
  }

  /* Meters differ in which direction they call positive. The energy counters
   * are unambiguous, so we compare them against the sign we assume and tell
   * the user when the two disagree. Only warns once both samples of the
   * interval agree, which keeps a single odd reading from raising a false
   * alarm. */
  verifyGridSign(meter) {
    const previous = this.previousMeter;
    this.previousMeter = meter;
    if (!previous || this.warned["grid-sign"]) {
      return;
    }

    const exportedDelta = meter.exported - previous.exported;
    const importedDelta = meter.imported - previous.imported;
    if (exportedDelta < 0 || importedDelta < 0) {
      return; // counter reset or wrapped
    }
    if (exportedDelta + importedDelta < 5) {
      return; // nothing moved, nothing to compare
    }

    const bothSamplesExport =
      meter.power > this.threshold && previous.power > this.threshold;
    const bothSamplesImport =
      meter.power < -this.threshold && previous.power < -this.threshold;

    const countersSayExport = exportedDelta > importedDelta * 2;
    const countersSayImport = importedDelta > exportedDelta * 2;

    const mismatch =
      (countersSayExport && bothSamplesImport) ||
      (countersSayImport && bothSamplesExport);

    if (mismatch) {
      this.warnOnce(
        "grid-sign",
        "The meter reports " +
          (countersSayExport ? "rising export" : "rising import") +
          " while the live power says the opposite. Set " +
          "modbus.invertGridSign to " +
          (this.config.invertGridSign ? "false" : "true") +
          " to correct the grid direction."
      );
    }
  }

  mapPowerFlow(inverters, batteries, meter) {
    const sum = (values) => values.reduce((total, value) => total + value, 0);

    const inverterAc = sum(inverters.map((inverter) => inverter.acPower));
    const inverterDc = sum(inverters.map((inverter) => inverter.dcPower));
    const batteryPower = sum(
      batteries.map((battery) => (isUsable(battery.power) ? battery.power : 0))
    );

    const { pvPower, storagePower } = this.mapToAcSide(
      inverterAc,
      inverterDc,
      batteryPower
    );
    const gridPower = meter ? meter.power : 0;
    const loadPower = Math.max(0, inverterAc - gridPower);

    const producing = inverters.some((inverter) =>
      PRODUCING_STATES.includes(inverter.status)
    );

    const toKw = (watts) => Number((Math.abs(watts) / 1000).toFixed(2));

    const powerFlow = {
      updateRefreshRate: Math.round(this.config.updateInterval / 1000),
      unit: "kW",
      connections: this.mapConnections(
        pvPower,
        storagePower,
        gridPower,
        loadPower
      ),
      GRID: {
        status: Math.abs(gridPower) > this.threshold ? "Active" : "Idle",
        currentPower: toKw(gridPower)
      },
      LOAD: {
        status: "Active",
        currentPower: toKw(loadPower)
      },
      PV: {
        status: producing && pvPower > this.threshold ? "Active" : "Idle",
        currentPower: toKw(pvPower)
      }
    };

    if (batteries.length) {
      powerFlow.STORAGE = {
        status: this.mapStorageStatus(storagePower),
        currentPower: toKw(storagePower),
        chargeLevel: this.mapChargeLevel(batteries),
        critical: false
      };
    }

    return { siteCurrentPowerFlow: powerFlow };
  }

  /* The battery and the strings are measured on the DC side, the house and the
   * meter on the AC side. Reporting them side by side would make the battery
   * look like it delivers more than the house consumes, because everything the
   * battery sends through the inverter loses the conversion step on the way.
   *
   * So the DC readings are scaled onto the AC side with the conversion ratio
   * the inverters are measurably running at right now. That is also what the
   * monitoring API reports, and it makes PV + storage + grid add up to the
   * load exactly instead of leaving a percent or two unaccounted for.
   */
  mapToAcSide(inverterAc, inverterDc, batteryPower) {
    let pvShare = inverterDc + batteryPower; // battery is negative while discharging
    let storageShare = batteryPower;

    // A discharging battery also loses a little in its own DC/DC stage, which
    // can push the calculated PV share slightly below zero at night. The bus
    // is fed by the battery alone in that case.
    if (pvShare < 0) {
      pvShare = 0;
      storageShare = -inverterDc;
    }

    const ratio =
      Math.abs(inverterDc) > CONVERSION_MIN_W
        ? Math.abs(inverterAc / inverterDc)
        : 1;
    // Guards against a nonsensical factor while the inverters ramp up or down.
    const conversion = Math.min(1, Math.max(MIN_CONVERSION_RATIO, ratio));

    return {
      pvPower: Math.max(0, pvShare * conversion),
      storagePower: storageShare * conversion
    };
  }

  mapStorageStatus(batteryPower) {
    if (batteryPower < -this.threshold) {
      return "Discharging";
    }
    if (batteryPower > this.threshold) {
      return "Charging";
    }
    return "Idle";
  }

  /* Weighted by usable capacity so a small and a large battery do not count
   * the same. Falls back to the plain average when capacities are unknown. */
  mapChargeLevel(batteries) {
    const weighted = batteries.filter((battery) =>
      isUsable(battery.availableEnergy) && battery.availableEnergy > 0
    );
    if (weighted.length === batteries.length && weighted.length) {
      const capacity = weighted.reduce(
        (total, battery) => total + battery.availableEnergy,
        0
      );
      const charge = weighted.reduce(
        (total, battery) =>
          total + battery.stateOfCharge * battery.availableEnergy,
        0
      );
      return Math.round(charge / capacity);
    }
    const average =
      batteries.reduce((total, battery) => total + battery.stateOfCharge, 0) /
      batteries.length;
    return Math.round(average);
  }

  mapConnections(pvPower, batteryPower, gridPower, loadPower) {
    const connections = [];
    const charging = batteryPower > this.threshold;
    const discharging = batteryPower < -this.threshold;

    if (pvPower > this.threshold && loadPower > this.threshold) {
      connections.push({ from: "PV", to: "Load" });
    }
    if (charging) {
      connections.push(
        pvPower > this.threshold
          ? { from: "PV", to: "Storage" }
          : { from: "LOAD", to: "Storage" }
      );
    }
    if (discharging) {
      connections.push({ from: "STORAGE", to: "Load" });
    }
    if (gridPower < -this.threshold) {
      connections.push({ from: "GRID", to: "Load" });
    } else if (gridPower > this.threshold) {
      connections.push({ from: "LOAD", to: "Grid" });
    }

    return connections;
  }
}

module.exports = SolarEdgeModbus;
module.exports.REG = REG;
