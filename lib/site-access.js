"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const endpoint = "https://monitoringapi.solaredge.com/v2/oauth2/token";
const pending = new Map();
const queues = new Map();
const tokenPath = () => path.resolve(__dirname, "../.oauth-tokens.json");

function configPath() { return path.resolve(process.cwd(), "config/config.js"); }
function moduleConfig(file = configPath()) {
  delete require.cache[require.resolve(file)];
  const config = require(file);
  const matches = (config.modules || []).filter(m => m.module === "MMM-SolarEdge");
  if (matches.length !== 1) throw new Error("Exactly one MMM-SolarEdge module entry is required");
  return matches[0].config || {};
}
function setup(config) {
  if (!config.clientId || !config.clientSecret || !config.redirectUri) throw new Error("OAuth client credentials incomplete");
  const uri = new URL(config.redirectUri);
  if (uri.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(uri.hostname) || uri.port !== "8080" || uri.pathname !== "/oauth/callback") {
    throw new Error("redirectUri must be http://localhost:8080/oauth/callback (or 127.0.0.1)");
  }
  return config;
}
// The token store is deliberately separate from MagicMirror's read-only config.
function readToken(file = tokenPath()) {
  let stat;
  try { stat = fs.lstatSync(file); } catch (e) { if (e.code === "ENOENT") return ""; throw e; }
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error("OAuth token file must be a private regular file (0600)");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (Object.keys(data).length !== 1 || typeof data.refreshToken !== "string" || !data.refreshToken) throw new Error("Invalid OAuth token file");
  return data.refreshToken;
}
function saveToken(file = tokenPath(), next) {
  if (typeof next !== "string" || !next) throw new Error("Invalid refresh token");
  // Refuse symlinks/weak permissions before replacing an existing store.
  readToken(file);
  const tmp = path.join(path.dirname(file), `.oauth-tokens-${process.pid}-${crypto.randomBytes(8).toString("hex")}`);
  try {
    const fd = fs.openSync(tmp, "wx", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify({ refreshToken: next }) + "\n");
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
    const dir = fs.openSync(path.dirname(file), "r");
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  } finally { try { fs.unlinkSync(tmp); } catch (e) { if (e.code !== "ENOENT") throw e; } }
}
function serialized(file, work) {
  const previous = queues.get(file) || Promise.resolve();
  const task = previous.catch(() => {}).then(work);
  queues.set(file, task);
  task.finally(() => { if (queues.get(file) === task) queues.delete(file); }).catch(() => {});
  return task;
}
async function exchange(fields, fetcher = fetch) {
  const response = await fetcher(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) });
  if (!response.ok) throw new Error("SolarEdge OAuth token request failed: HTTP " + response.status);
  const result = await response.json();
  if (!result.access_token || !result.refresh_token || !Number.isFinite(Number(result.expires_in))) throw new Error("SolarEdge OAuth token response incomplete");
  return result;
}
async function authorize(file, fields, fetcher = fetch, store = tokenPath()) {
  return serialized(store, async () => {
    const result = await exchange(fields, fetcher);
    saveToken(store, result.refresh_token);
    return result.access_token;
  });
}
async function accessToken(file = configPath(), fetcher = fetch, store = tokenPath()) {
  if (pending.has(store)) return pending.get(store);
  const task = serialized(store, async () => {
    const config = setup(moduleConfig(file));
    const refreshToken = readToken(store);
    if (!refreshToken) throw new Error("OAuth refresh token missing; authorize at /oauth/start");
    const result = await exchange({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: config.clientId, client_secret: config.clientSecret }, fetcher);
    saveToken(store, result.refresh_token);
    return result.access_token;
  });
  pending.set(store, task);
  try { return await task; } finally { if (pending.get(store) === task) pending.delete(store); }
}
module.exports = { configPath, moduleConfig, setup, tokenPath, readToken, saveToken, exchange, authorize, accessToken };
