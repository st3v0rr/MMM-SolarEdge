"use strict";
const { randomBytes } = require("node:crypto");
const auth = require("./site-access");

function install(app, options = {}) {
  const configPath = options.configPath || auth.configPath;
  const store = options.store || auth.tokenPath();
  const fetcher = options.fetcher || ((...args) => fetch(...args));
  const now = options.now || Date.now;
  const states = new Map();
  const safe = (res) => {
    res.set("Cache-Control", "no-store");
    res.set("Referrer-Policy", "no-referrer");
  };
  // The container is published only on 127.0.0.1; rootless Podman forwards
  // loopback traffic using a gateway address, not the original client address.
  const local = (req) => /^(localhost|127\.0\.0\.1):8080$/.test(req.headers.host || "");
  app.get("/oauth/start", (req, res) => {
    safe(res);
    if (!local(req)) return res.status(403).send("OAuth setup is available only on localhost:8080.");
    let data;
    try { data = auth.setup(auth.moduleConfig(configPath())); } catch (_) {
      return res.status(503).send("OAuth client credentials are not configured in config.js.");
    }
    for (const [key, expiry] of states) if (expiry <= now()) states.delete(key);
    const state = randomBytes(32).toString("hex");
    states.set(state, now() + 10 * 60 * 1000);
    res.set("Set-Cookie", `se_oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/oauth; Max-Age=600`);
    const url = new URL("https://connect.solaredge.com/authorize");
    url.search = new URLSearchParams({ response_type: "code", client_id: data.clientId,
      redirect_uri: data.redirectUri, scope: "SITE_DATA", state }).toString();
    return res.redirect(url.toString());
  });
  app.get("/oauth/callback", async (req, res) => {
    safe(res);
    if (!local(req)) return res.status(403).send("OAuth callback is available only on localhost:8080.");
    const { state, code, error } = req.query;
    // SolarEdge currently omits state on some callbacks. Match the state
    // to an HttpOnly cookie set on /start, never to an arbitrary pending flow.
    const cookie = /(?:^|;\s*)se_oauth_state=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || "");
    const browserState = cookie?.[1];
    if (!browserState || (state !== undefined && state !== browserState) || !states.has(browserState)) {
      return res.status(400).send("Invalid or already used OAuth state. Start again at /oauth/start.");
    }
    const expiry = states.get(browserState);
    states.delete(browserState); // Consume before awaiting; duplicate callbacks cannot exchange twice.
    res.set("Set-Cookie", "se_oauth_state=; HttpOnly; SameSite=Lax; Path=/oauth; Max-Age=0");
    if (expiry <= now() || error || typeof code !== "string" || !code) {
      return res.status(400).send("Authorization expired or was declined. Start again at /oauth/start.");
    }
    try {
      const configFile = configPath();
      const data = auth.setup(auth.moduleConfig(configFile));
      await auth.authorize(configFile, { grant_type: "authorization_code", code,
        client_id: data.clientId, client_secret: data.clientSecret, redirect_uri: data.redirectUri }, fetcher, store);
      return res.send("SolarEdge authorization complete. You may close this tab.");
    } catch (_) {
      return res.status(503).send("Authorization could not be saved. Check backend configuration and retry /oauth/start.");
    }
  });
}
module.exports = { install };
