/* global __dirname, fetch */
/* MagicMirror²
 * Node Helper: MMM-SolarEdge
 *
 * Serves three data sources behind one set of notifications:
 *   - the SolarEdge V2 Basic Monitoring API for energy data
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
const siteAccess = require("./lib/site-access");
const oauthRoutes = require("./lib/oauth-routes");

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
  setExpressApp: function (app) {
    this.expressApp = app;
    oauthRoutes.install(app);
  },

  getServerModuleConfig: function () {
    return siteAccess.moduleConfig();
  },

  start: function () {
    this.modbus = {}; // per site id
    this.inFlight = {}; // per site id and endpoint
    this.skipped = {};
    this.apiCache = {};
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

    /* The frontend polls on a fixed interval no matter how long a read takes.
     * A power flow over Modbus is five to eight round trips over the RS485
     * chain, so a slow bus can easily push one poll past the next. Starting it
     * anyway would queue work that is never worked off again: the backlog only
     * grows, and the frontend ends up being served answers to requests made
     * hours ago. Dropping the poll instead keeps the data current. */
    // Socket payloads are browser-controlled. Never use them to choose the
    // destination for a request carrying server-side OAuth credentials.
    const server = this.getServerModuleConfig();
    if (!server.siteId) return;
    const config = {
      ...payload.config,
      ...server,
      siteId: server.siteId,
      modbus: { ...payload.config?.modbus, ...server.modbus, host: server.modbus.host },
      // The browser payload is untrusted; only the on-server MagicMirror
      // config may select a reverse proxy that receives the bearer token.
      portalUrl: server.portalUrl || "https://monitoringapi.solaredge.com/v2"
    };
    if (endpoint === "currentPower" && (config.dataSource !== "modbus" || !config.modbus.host)) return;
    const key = endpoint + "@" + config.siteId;
    if (this.inFlight[key]) {
      this.reportSkip(key, endpoint);
      return;
    }
    this.inFlight[key] = true;

    try {
      const data = await this.provideCached(endpoint, config);
      this.sendSocketNotification(ENDPOINTS[endpoint].received, data);
    } catch (error) {
      // The frontend keeps showing the values it already has.
      console.error("[MMM-SolarEdge] " + endpoint + ": request failed (check private backend credentials and connectivity)");
    } finally {
      delete this.inFlight[key];
    }
  },

  /* A single skipped poll means nothing, the next one delivers. A run of them
   * means the reads take longer than updateInterval, which is worth saying out
   * loud rather than quietly showing values that never change. Logged at
   * powers of ten so a permanently overloaded bus does not flood the log. */
  reportSkip: function (key, endpoint) {
    const count = (this.skipped[key] = (this.skipped[key] || 0) + 1);
    if (Math.log10(count) % 1 !== 0) {
      return;
    }
    console.warn(
      "[MMM-SolarEdge] " + endpoint + ": the previous read is still running, " +
        "skipping this one (" + count + " skipped so far). Raise " +
        "updateInterval if this keeps happening."
    );
  },

  // Cache Basic API results per site across browser clients. The six-hour
  // floor also protects the shared monthly credit pool from fast client timers.
  provideCached: function (endpoint, config) {
    if (config.mockData || endpoint === "currentPower") return this.provide(endpoint, config);
    const key = endpoint + "@" + config.siteId;
    this.apiCache ||= {};
    const cached = this.apiCache[key];
    const ttl = endpoint === "details" ? Infinity : 1000 * 60 * 60 * 6;
    if (cached && Date.now() - cached.at < ttl) return Promise.resolve(cached.data);
    return Promise.resolve(this.provide(endpoint, config)).then((data) => {
      this.apiCache[key] = { at: Date.now(), data };
      return data;
    });
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
    if (endpoint === "currentPower") {
      throw new Error("V2 Basic has no live power flow; configure Modbus/TCP");
    }
    const request = async (url) => {
      const headers = { Authorization: "Bearer " + await siteAccess.accessToken() };
      const response = await fetch(url, { headers });
      if (response.status === 429) {
        throw new Error("SolarEdge V2 credit limit reached; increase updateIntervalBasicData");
      }
      if (!response.ok) {
        // Do not log response bodies: proxies can echo credentials.
        throw new Error("SolarEdge V2 request failed: HTTP " + response.status);
      }
      return response.json();
    };
    if (endpoint === "details") {
      return { details: await request(this.buildUrl(endpoint, config)) };
    }
    if (endpoint === "dayEnergy") {
      const overview = await request(this.buildUrl("overview", config));
      const production = overview.production || {};
      const consumption = overview.consumption || {};
      const value = (number, unit) => {
        const scale = { WH: 1, KWH: 1000, MWH: 1000000, GWH: 1000000000 }[String(unit).toUpperCase()];
        if (number == null) return null;
        if (!Number.isFinite(number) || !scale) throw new Error("Unexpected SolarEdge V2 overview unit or value");
        return number * scale;
      };
      const meter = (type, number, unit) => ({ type, values: [{ value: value(number, unit) }] });
      return { energyDetails: { meters: [
        meter("Production", production.total, production.unit),
        meter("Consumption", consumption.total, consumption.unit),
        meter("FeedIn", production.toGrid, production.unit),
        meter("Purchased", consumption.fromGrid, consumption.unit),
        meter("SelfConsumption", production.toSelfConsumption, production.unit)
      ] } };
    }
    const now = new Date();
    const range = (start) => ({ from: start.toISOString(), to: now.toISOString() });
    const monthly = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearly = new Date(now.getFullYear(), 0, 1);
    const [today, month, year] = await Promise.all([
      request(this.buildUrl("energy", config, "DAY", range(new Date(now.getFullYear(), now.getMonth(), now.getDate())))),
      request(this.buildUrl("energy", config, "MONTH", range(monthly))),
      request(this.buildUrl("energy", config, "YEAR", range(yearly)))
    ]);
    const total = (result) => {
      if (String(result.unit).toUpperCase() !== "WH" || !Array.isArray(result.values)) {
        throw new Error("Unexpected SolarEdge V2 energy response");
      }
      return result.values.reduce((sum, entry) => sum + (Number.isFinite(entry.value) ? entry.value : 0), 0);
    };
    return { overview: {
      lastDayData: { energy: total(today) },
      lastMonthData: { energy: total(month) },
      lastYearData: { energy: total(year) }
    } };
  },

  buildUrl: function (endpoint, config, resolution, range) {
    const configured = config.portalUrl || "https://monitoringapi.solaredge.com/v2";
    const url = new URL(configured);
    // Explicit LAN reverse proxies may use HTTP. Refuse non-LAN HTTP
    // destinations because the bearer token travels in the request header.
    const lan = /^(localhost|127\.0\.0\.1|10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.(?:\d{1,3}\.)\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.)\d{1,3})$/i.test(url.hostname);
    if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password || url.search || url.hash ||
        (url.protocol === "http:" && !lan)) {
      throw new Error("Invalid SolarEdge API proxy URL in server config");
    }
    // Existing V1 reverse-proxy entries point at the proxy root. V2 requests
    // need the /v2 path; an already configured /v2 suffix is not duplicated.
    const base = url.origin + (url.pathname.replace(/\/$/, "").endsWith("/v2")
      ? url.pathname.replace(/\/$/, "") : url.pathname.replace(/\/$/, "") + "/v2");
    const site = base + "/sites/" + encodeURIComponent(config.siteId);
    if (endpoint === "details") return site;
    if (endpoint === "overview") return site + "/overview";
    if (endpoint === "energy") {
      const params = new URLSearchParams({ resolution, unit: "WH", from: range.from, to: range.to });
      return site + "/energy?" + params;
    }
    throw new Error("Unknown endpoint " + endpoint);
  }
});
