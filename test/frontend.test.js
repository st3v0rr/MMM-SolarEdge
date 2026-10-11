const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../MMM-SolarEdge.js"), "utf8");
function moduleWith(config) {
  let module;
  const notifications = [];
  const timers = [];
  const intervals = [];
  const context = { Module: { register: (_name, definition) => { module = definition; } },
    console: { log() {}, warn() {}, error() {} },
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    setInterval: (callback, delay) => { intervals.push({ callback, delay }); return intervals.length; } };
  vm.runInNewContext(source, context);
  module.config = { ...module.defaults, siteId: "42", clientId: "test-id", clientSecret: "test-secret", ...config };
  module.sendSocketNotification = (name) => notifications.push(name);
  return { module, notifications, timers, intervals };
}
test("default API mode renders energy without live power polling", () => {
  const { module, notifications } = moduleWith({});
  module.start();
  assert.equal(module.config.dataSource, "api");
  assert.equal(module.getTemplate(), "templates/energy.njk");
  assert.ok(!notifications.some(n => n.includes("CURRENTPOWER")));
  assert.ok(!("powerAndStatus" in module.getTemplateData()));
  module.dataNotificationOverview = { overview: { lastDayData: { energy: 1000 }, lastMonthData: { energy: 2000 }, lastYearData: { energy: 3000 } } };
  assert.equal(module.getTemplateData().lifeTimeData.today, "1,00");
});
test("basic polling timer starts with the first request, not before startup jitter", () => {
  const { module, notifications, timers, intervals } = moduleWith({});
  module.start();
  assert.equal(intervals.length, 0);
  const firstBasic = timers.find(t => t.delay === module.startupJitter * 2);
  assert.ok(firstBasic);
  firstBasic.callback();
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].delay, module.config.updateIntervalBasicData + 5 * 60 * 1000);
  assert.ok(notifications.some(n => n.includes("OVERVIEW_DATA_REQUESTED")));
});
test("polling intervals and missing OAuth settings are validated after Modbus fallback", () => {
  const noAuth = moduleWith({ dataSource: "modbus", modbus: { host: "localhost" }, clientId: undefined, clientSecret: undefined,
    updateInterval: 0, updateIntervalBasicData: 1 });
  noAuth.module.start();
  assert.equal(noAuth.module.config.updateInterval, 5000);
  assert.equal(noAuth.module.config.updateIntervalBasicData, 21600000);
  assert.equal(noAuth.module.config.showOverview, false);
  assert.equal(noAuth.module.config.showDayEnergy, false);
  assert.equal(noAuth.module.canFetchBasicData(), false);
  assert.equal(noAuth.notifications.length, 1);
  const fallback = moduleWith({ dataSource: "modbus", clientId: undefined, clientSecret: undefined });
  fallback.module.start();
  assert.equal(fallback.module.config.dataSource, "api");
  assert.equal(fallback.module.configComplete(), false);
  assert.equal(fallback.notifications.length, 0);
});
test("missing Modbus host falls back to API; configured Modbus still polls", () => {
  const fallback = moduleWith({ dataSource: "modbus" });
  fallback.module.start();
  assert.equal(fallback.module.config.dataSource, "api");
  assert.equal(fallback.notifications.length, 0);
  const live = moduleWith({ dataSource: "modbus", modbus: { host: "localhost" } });
  live.module.start();
  assert.equal(live.notifications.length, 1);
  assert.match(live.notifications[0], /CURRENTPOWER/);
});
