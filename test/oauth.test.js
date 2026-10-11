const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const auth = require("../lib/site-access");
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "se-config-"));
  const file = path.join(dir, "config.js");
  const store = path.join(dir, ".oauth-tokens.json");
  fs.writeFileSync(file, `module.exports = { modules: [{ module: "MMM-SolarEdge", config: {
    clientId: "id", clientSecret: "secret", redirectUri: "http://localhost:8080/oauth/callback",
    refreshToken: "legacy"
  }}] };\n`);
  return { file, store, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
test("refresh persists only rotating token privately, never changes config, and coalesces calls", async () => {
  const { file, store, cleanup } = fixture();
  try {
    const original = fs.readFileSync(file, "utf8");
    await assert.rejects(auth.accessToken(file, async () => {}, store), /missing/);
    auth.saveToken(store, "old");
    let calls = 0;
    const fetcher = async (_url, options) => {
      calls++;
      assert.equal(JSON.parse(options.body).refresh_token, "old");
      return { ok: true, json: async () => ({ access_token: "access", refresh_token: "new", expires_in: 3600 }) };
    };
    assert.deepEqual(await Promise.all([auth.accessToken(file, fetcher, store), auth.accessToken(file, fetcher, store)]), ["access", "access"]);
    assert.equal(calls, 1);
    assert.equal(auth.readToken(store), "new");
    assert.deepEqual(JSON.parse(fs.readFileSync(store, "utf8")), { refreshToken: "new" });
    assert.equal(fs.statSync(store).mode & 0o777, 0o600);
    assert.equal(fs.readFileSync(file, "utf8"), original);
    assert.equal(fs.readdirSync(path.dirname(store)).filter(x => x.startsWith(".oauth-tokens-")).length, 0);
  } finally { cleanup(); }
});
test("failed refresh and unsafe token file preserve previous state", async () => {
  const { file, store, cleanup } = fixture();
  try {
    auth.saveToken(store, "old");
    await assert.rejects(auth.accessToken(file, async () => ({ ok: false, status: 401 }), store), /HTTP 401/);
    assert.equal(auth.readToken(store), "old");
    fs.chmodSync(store, 0o644);
    assert.throws(() => auth.saveToken(store, "new"), /private regular file/);
    assert.equal(fs.readFileSync(store, "utf8"), '{"refreshToken":"old"}\n');
  } finally { cleanup(); }
});
test("authorization and refresh serialize token writes; persisted token survives reload", async () => {
  const { file, store, cleanup } = fixture();
  try {
    auth.saveToken(store, "old");
    let release;
    const wait = new Promise(resolve => { release = resolve; });
    const refresh = auth.accessToken(file, async (_url, options) => {
      assert.equal(JSON.parse(options.body).refresh_token, "old");
      await wait;
      return { ok: true, json: async () => ({ access_token: "a", refresh_token: "rotated", expires_in: 60 }) };
    }, store);
    const callback = auth.authorize(file, { grant_type: "authorization_code" }, async () => ({
      ok: true, json: async () => ({ access_token: "b", refresh_token: "authorized", expires_in: 60 })
    }), store);
    release();
    assert.deepEqual(await Promise.all([refresh, callback]), ["a", "b"]);
    assert.equal(auth.readToken(store), "authorized");
    delete require.cache[require.resolve("../lib/site-access")];
    assert.equal(require("../lib/site-access").readToken(store), "authorized");
  } finally { cleanup(); }
});
module.exports = { fixture };
