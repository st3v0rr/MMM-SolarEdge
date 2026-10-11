const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const original = Module._load;
Module._load = function (name, ...args) {
  if (name === "node_helper") return { create: (obj) => obj };
  return original.call(this, name, ...args);
};
const helper = require("../node_helper");
Module._load = original;
const siteAccess = require("../lib/site-access");
const config = { siteId: "42", apiKey: "secret", portalUrl: "https://monitoringapi.solaredge.com/v2" };

test("V2 routes use header auth and normalize overview and day breakdown", async () => {
  const urls = [];
  const original = siteAccess.accessToken;
  siteAccess.accessToken = async () => "access";
  global.fetch = async (url, options) => {
    urls.push(url);
    assert.equal(options.headers.Authorization, "Bearer access");
    assert.ok(!url.includes("secret"));
    const body = url.endsWith("/overview")
      ? { production: { total: 3, unit: "KWH", toGrid: 1, toSelfConsumption: 2 }, consumption: { total: 4, unit: "kWh", fromGrid: null } }
      : url.endsWith("/sites/42") ? { peakPower: 12, location: { city: "Test" } }
      : { unit: "Wh", values: [{ value: 1000 }, { value: 2000 }] };
    return { ok: true, json: async () => body };
  };
  assert.equal((await helper.readApi("details", config)).details.peakPower, 12);
  const day = await helper.readApi("dayEnergy", config);
  assert.deepEqual(day.energyDetails.meters.map(m => m.values[0].value), [3000, 4000, 1000, null, 2000]);
  const energy = await helper.readApi("overview", config);
  assert.equal(energy.overview.lastMonthData.energy, 3000);
  assert.equal(energy.overview.lastYearData.energy, 3000);
  assert.equal(urls.filter(u => u.includes("/energy?")).length, 3);
  assert.ok(urls.every(u => !u.includes("api_key")));
  siteAccess.accessToken = original;
});

test("browser config cannot redirect authenticated API calls or Modbus reads", async () => {
  const seen = [];
  const instance = Object.assign({}, helper, {
    inFlight: {}, skipped: {},
    getServerModuleConfig: () => ({ siteId: "42", dataSource: "modbus", modbus: { host: "192.168.1.100", inverterUnitIds: [1] } }),
    provide: async (_endpoint, cfg) => { seen.push(cfg); return {}; },
    sendSocketNotification: () => {}
  });
  await instance.socketNotificationReceived("MMM-SolarEdge-NOTIFICATION_SOLAREDGE_DETAILS_DATA_REQUESTED", {
    config: { siteId: "99", portalUrl: "https://attacker.example", modbus: { host: "attacker.example" } }
  });
  assert.equal(seen[0].siteId, "42");
  assert.equal(seen[0].modbus.host, "192.168.1.100");
  assert.equal(new URL(helper.buildUrl("details", seen[0])).origin, "https://monitoringapi.solaredge.com");
});

test("trusted server proxy is used but browser cannot override it", async () => {
  const seen = [];
  const instance = Object.assign({}, helper, {
    inFlight: {}, skipped: {}, apiCache: {},
    getServerModuleConfig: () => ({ siteId: "42", dataSource: "api", portalUrl: "http://192.168.1.100:9080/", modbus: {} }),
    provide: async (_endpoint, cfg) => { seen.push(cfg); return {}; },
    sendSocketNotification: () => {}
  });
  await instance.socketNotificationReceived("MMM-SolarEdge-NOTIFICATION_SOLAREDGE_DETAILS_DATA_REQUESTED", {
    config: { siteId: "99", portalUrl: "https://attacker.example" }
  });
  assert.equal(helper.buildUrl("details", seen[0]), "http://192.168.1.100:9080/v2/sites/42");
  assert.equal(helper.buildUrl("overview", { ...seen[0], portalUrl: "http://192.168.1.100:9080/v2" }),
    "http://192.168.1.100:9080/v2/sites/42/overview");
  assert.throws(() => helper.buildUrl("details", { ...seen[0], portalUrl: "http://public.example" }), /Invalid/);
});

test("V2 Basic does not request live power", async () => {
  await assert.rejects(helper.readApi("currentPower", config), /Modbus/);
});


test("six-hour backend cache shares Basic reads across clients", async () => {
  let calls = 0;
  const instance = Object.assign({}, helper, {
    apiCache: {}, provide: async () => ({ serial: ++calls })
  });
  const cfg = { siteId: "42" };
  assert.equal((await instance.provideCached("overview", cfg)).serial, 1);
  assert.equal((await instance.provideCached("overview", cfg)).serial, 1);
  assert.equal((await instance.provideCached("dayEnergy", cfg)).serial, 2);
  assert.equal((await instance.provideCached("details", cfg)).serial, 3);
  assert.equal((await instance.provideCached("details", cfg)).serial, 3);
  instance.apiCache["overview@42"].at -= 1000 * 60 * 60 * 6;
  assert.equal((await instance.provideCached("overview", cfg)).serial, 4);
});
