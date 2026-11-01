const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { fixture } = require("./oauth.test");
const routes = require("../lib/oauth-routes");

function setup(now = Date.now) {
  const { file, store, cleanup } = fixture();
  const handlers = {};
  const app = { get: (route, handler) => { handlers[route] = handler; } };
  const exchanges = [];
  routes.install(app, { configPath: () => file, store, now, fetcher: async (url, options) => {
    exchanges.push({ url, fields: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ access_token: "access", refresh_token: "refresh", expires_in: 3600 }) };
  } });
  let browserCookie = "";
  const call = async (route, query = {}, host = "localhost:8080", sendCookie = true) => {
    const res = { statusCode: 200, headers: {}, set(k, v) { this.headers[k] = v; return this; },
      status(n) { this.statusCode = n; return this; }, send(value) { this.body = value; return this; },
      redirect(value) { this.location = value; return this; } };
    await handlers[route]({ headers: { host, cookie: sendCookie ? browserCookie : "" }, query }, res);
    if (route === "/oauth/start" && res.headers["Set-Cookie"]) browserCookie = res.headers["Set-Cookie"].split(";")[0];
    return res;
  };
  return { file, store, app, call, exchanges, cleanup };
}

test("MagicMirror helper installs both routes through setExpressApp", () => {
  const original = Module._load;
  Module._load = function (name, ...args) {
    if (name === "node_helper") return { create: (obj) => obj };
    return original.call(this, name, ...args);
  };
  let helper;
  try { helper = require("../node_helper"); } finally { Module._load = original; }
  const paths = [];
  const app = { get: (route) => paths.push(route) };
  helper.setExpressApp(app);
  assert.equal(helper.expressApp, app);
  assert.deepEqual(paths, ["/oauth/start", "/oauth/callback"]);
});

test("authorization roundtrip saves private rotating tokens and rejects replay", async () => {
  const s = setup();
  try {
    const start = await s.call("/oauth/start");
    const url = new URL(start.location);
    assert.equal(url.origin, "https://connect.solaredge.com");
    assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:8080/oauth/callback");
    assert.equal(url.searchParams.get("scope"), "SITE_DATA");
    assert.equal(url.searchParams.get("client_id"), "id");
    assert.ok(!start.location.includes("secret"));
    const query = { state: url.searchParams.get("state"), code: "one-time-code" };
    const [first, replay] = await Promise.all([s.call("/oauth/callback", query), s.call("/oauth/callback", query)]);
    assert.equal(first.statusCode, 200);
    assert.equal(replay.statusCode, 400);
    assert.equal(s.exchanges.length, 1);
    assert.deepEqual(s.exchanges[0].fields, { grant_type: "authorization_code", code: "one-time-code", client_id: "id", client_secret: "secret", redirect_uri: "http://localhost:8080/oauth/callback" });
    assert.equal(require("../lib/site-access").readToken(s.store), "refresh");
    assert.match(fs.readFileSync(s.file, "utf8"), /refreshToken: "legacy"/);
    assert.equal(first.headers["Cache-Control"], "no-store");
    assert.equal(first.headers["Referrer-Policy"], "no-referrer");
    assert.ok(!JSON.stringify(first).includes("one-time-code"));
  } finally { s.cleanup(); }
});

test("callback without returned state requires matching browser cookie", async () => {
  const s = setup();
  try {
    await s.call("/oauth/start");
    assert.equal((await s.call("/oauth/callback", { code: "x" }, "localhost:8080", false)).statusCode, 400);
    const ok = await s.call("/oauth/callback", { code: "x", site_id: "42" });
    assert.equal(ok.statusCode, 200);
    assert.equal(s.exchanges.length, 1);
    assert.equal((await s.call("/oauth/callback", { code: "x" })).statusCode, 400);
  } finally { s.cleanup(); }
});

test("expired, invalid, denied, wrong-host and misconfigured attempts do not exchange", async () => {
  let clock = 1000;
  const s = setup(() => clock);
  try {
    assert.equal((await s.call("/oauth/start", {}, "192.168.1.101:8080")).statusCode, 403);
    assert.equal((await s.call("/oauth/callback", { state: "bogus", code: "x" })).statusCode, 400);
    const start = await s.call("/oauth/start");
    const state = new URL(start.location).searchParams.get("state");
    clock += 600001;
    assert.equal((await s.call("/oauth/callback", { state, code: "x" })).statusCode, 400);
    const next = new URL((await s.call("/oauth/start")).location).searchParams.get("state");
    assert.equal((await s.call("/oauth/callback", { state: next, error: "access_denied" })).statusCode, 400);
    fs.writeFileSync(s.file, fs.readFileSync(s.file, "utf8").replace("clientSecret: \"secret\"", "clientSecret: \"\""));
    assert.equal((await s.call("/oauth/start")).statusCode, 503);
    assert.equal(s.exchanges.length, 0);
  } finally { s.cleanup(); }
});
