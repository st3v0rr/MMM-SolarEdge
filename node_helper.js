/* global __dirname, fetch */
/* MagicMirror²
 * Node Helper: MMM-SolarEdge
 *
 * Serves three data sources behind one set of notifications:
 *   - the SolarEdge v1 monitoring API (default)
 *   - Modbus/TCP straight from the inverters, which has no rate limit
 *   - mock files for development
 *
 * By Stefan Nachtrab
 * MIT Licensed.
 */

var NodeHelper = require("node_helper");
var fs = require("fs");
var path = require("path");

var SolarEdgeModbus = require("./lib/solaredge-modbus");

const NOTIFICATION_PREFIX = "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_";

/* Which site the mock data describes, selected via the mockData option. */
const MOCK_VARIANTS = {
  pv: "currentPowerFlowPv.json",
  pvbatt: "currentPowerFlowPvBattery.json"
};

const ENDPOINTS = {
  currentPower: {
    request: NOTIFICATION_PREFIX + "CURRENTPOWER_DATA_REQUESTED",
    received: NOTIFICATION_PREFIX + "CURRENTPOWER_DATA_RECEIVED",
    mock: MOCK_VARIANTS.pvbatt
  },
  details: {
    request: NOTIFICATION_PREFIX + "DETAILS_DATA_REQUESTED",
    received: NOTIFICATION_PREFIX + "DETAILS_DATA_RECEIVED",
    mock: "details.json"
  },
  overview: {
    request: NOTIFICATION_PREFIX + "OVERVIEW_DATA_REQUESTED",
    received: NOTIFICATION_PREFIX + "OVERVIEW_DATA_RECEIVED",
    mock: "overview.json"
  },
  dayEnergy: {
    request: NOTIFICATION_PREFIX + "DAY_ENERGY_DATA_REQUESTED",
    received: NOTIFICATION_PREFIX + "DAY_ENERGY_DATA_RECEIVED",
    mock: "dayEnergy.json"
  }
};

module.exports = NodeHelper.create({
  start: function () {
    this.modbus = {}; // per site id
  },

  stop: function () {
    Object.values(this.modbus).forEach((client) => client.close());
  },

  socketNotificationReceived: async function (notification, payload) {
    const endpoint = Object.keys(ENDPOINTS).find(
      (name) => ENDPOINTS[name].request === notification
    );
    if (!endpoint) {
      return;
    }

    try {
      const data = await this.provide(endpoint, payload.config);
      this.sendSocketNotification(ENDPOINTS[endpoint].received, data);
    } catch (error) {
      // The frontend keeps showing the values it already has.
      console.error("[MMM-SolarEdge] " + endpoint + ": " + error.message);
    }
  },

  provide: function (endpoint, config) {
    if (config.mockData) {
      return this.readMock(this.mockFileFor(endpoint, config));
    }
    if (config.dataSource === "modbus" && endpoint === "currentPower") {
      return this.getModbus(config).readPowerFlow();
    }
    return this.readApi(endpoint, config);
  },

  mockFileFor: function (endpoint, config) {
    if (endpoint !== "currentPower") {
      return ENDPOINTS[endpoint].mock;
    }
    // Unknown values fall back to the battery variant, which keeps the
    // long standing mockData: true working.
    return MOCK_VARIANTS[config.mockData] || ENDPOINTS[endpoint].mock;
  },

  readMock: function (fileName) {
    return JSON.parse(
      fs.readFileSync(path.join(__dirname, "mock", fileName), "utf8")
    );
  },

  /* ---------------------------------------------------------------- modbus */

  getModbus: function (config) {
    const key = String(config.siteId);
    if (!this.modbus[key]) {
      if (!config.modbus || !config.modbus.host) {
        throw new Error(
          "dataSource is set to \"modbus\" but modbus.host is missing"
        );
      }
      const inverterUnitIds = config.modbus.inverterUnitIds;
      this.modbus[key] = new SolarEdgeModbus({
        host: config.modbus.host,
        port: config.modbus.port,
        timeout: config.modbus.timeout,
        inverterUnitIds,
        meterUnitId:
          config.modbus.meterUnitId !== undefined
            ? config.modbus.meterUnitId
            : inverterUnitIds[0],
        invertGridSign: config.modbus.invertGridSign,
        flowThreshold: config.modbus.flowThreshold,
        updateInterval: config.updateInterval
      });
      console.log(
        "[MMM-SolarEdge] Reading live data over Modbus/TCP from " +
          config.modbus.host + ":" + config.modbus.port +
          " (units " + inverterUnitIds.join(", ") + ")"
      );
      this.probeModbus(this.modbus[key], inverterUnitIds);
    }
    return this.modbus[key];
  },

  /* Logs what actually answers on the bus, which is the first thing worth
   * knowing when the wrong unit ids are configured. */
  probeModbus: async function (client, inverterUnitIds) {
    for (const unitId of inverterUnitIds) {
      try {
        const device = await client.probe(unitId);
        console.log(
          "[MMM-SolarEdge] Modbus unit " + unitId + ": " + device.manufacturer +
            " " + device.model + " (serial " + device.serial + ")"
        );
      } catch (error) {
        console.error(
          "[MMM-SolarEdge] Modbus unit " + unitId + " did not answer: " +
            error.message
        );
      }
    }
  },

  /* ------------------------------------------------------------------- api */

  readApi: async function (endpoint, config) {
    const response = await fetch(this.buildUrl(endpoint, config));

    if (response.status === 429) {
      throw new Error(
        "Rate limited by SolarEdge - the site is over its daily request " +
          "budget. Increase updateInterval or updateIntervalBasicData."
      );
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        "Request failed " + response.status + " " + response.statusText +
          (body ? ": " + body : "")
      );
    }
    return response.json();
  },

  buildUrl: function (endpoint, config) {
    const site = config.portalUrl + "/site/" + config.siteId;
    const key = "api_key=" + config.apiKey;

    if (endpoint === "currentPower") {
      return site + "/currentPowerFlow?" + key;
    }
    if (endpoint === "details") {
      return site + "/details?" + key;
    }
    if (endpoint === "overview") {
      return site + "/overview?" + key;
    }
    if (endpoint === "dayEnergy") {
      const today = this.formatDate(new Date(), "YYYY-MM-DD");
      return (
        site + "/energyDetails?" +
        "meters=Production,Consumption,SelfConsumption,FeedIn,Purchased" +
        "&timeUnit=DAY" +
        "&startTime=" + today + " 00:00:00" +
        "&endTime=" + today + " 23:59:59" +
        "&" + key
      );
    }
    throw new Error("Unknown endpoint " + endpoint);
  },

  formatDate: function (date, format) {
    let month = date.getMonth() + 1;
    return format
      .replace("YYYY", date.getFullYear())
      .replace("MM", month.toString().padStart(2, "0"))
      .replace("DD", date.getDate().toString().padStart(2, "0"));
  }
});
