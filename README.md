# MMM-SolarEdge

This is a module for the [MagicMirror²](https://github.com/MagicMirrorOrg/MagicMirror/).

A Module for MagicMirror² designed to integrate with a SolarEdge System. Dependent on your configuration it can display several statistics.

- Current Power (dependent on yout module update interval)
- more will follow...

## Installation
Go to your MagicMirror folder.
```bash
cd modules
git clone https://github.com/st3v0rr/MMM-SolarEdge.git
cd MMM-SolarEdge
npm i
```
Wait until npm has finished.

## Update

```bash
cd ~/MagicMirror/modules/MMM-SolarEdge
git pull
npm install
```

## Using the module

To use this module, add the following entry to the `modules` array of your
existing `config/config.js`. Set your site ID and OAuth credentials. Add Modbus
settings only if you want live power. This is an entry, **not** a complete
MagicMirror configuration file:

```js
{
    module: 'MMM-SolarEdge',
    position: 'lower_third',
    config: {
        siteId: "12345", //SolarEdge site ID
        // Default API mode displays energy totals without a Modbus host.
    }
}
```

## SolarEdge V2 Basic Monitoring

Homeowner Site Access uses an OAuth client ID and client secret, not a Fleet API key.
The module reads these credentials from MagicMirror `config/config.js`; MagicMirror
serves module configuration to browsers, so anyone with access to the mirror may
read the client secret. Keep the mirror LAN-only and do not publish or commit the
real config. The rotating refresh token is stored separately in the private
module-local `.oauth-tokens.json`, never written to `config.js`. V2 Basic provides
site details, energy totals and today's overview, but **no live power flow**.
Default `dataSource: "api"` displays energy totals only, never instantaneous
power or a simulated flow. Configure Modbus/TCP for live power. If Modbus is
selected without `modbus.host`, the module warns and falls back to the monitoring API.
Modbus live readings work without OAuth credentials. If `clientId` or
`clientSecret` is missing, the cloud overview and energy views are disabled;
API-only mode instead reports incomplete configuration. The two-hour V2
polling minimum is applied after a Modbus-to-API fallback; `updateInterval`
controls only Modbus reads and is reset to 5000 ms if invalid or below 1000 ms.

The API defaults to `https://monitoringapi.solaredge.com/v2`. If `portalUrl`
is set in the **server-side** MagicMirror config, the module instead uses that
trusted reverse-proxy base (appending `/v2` when absent). HTTP is accepted only
for loopback/private-LAN proxy hosts; the OAuth bearer token is sent to that
proxy, so it must be under your control and must forward V2 paths and headers.
Browser-provided URL overrides are ignored. An existing V1-only reverse proxy
must be upgraded to forward `/v2` before cloud data can work.

Basic energy polls roughly every two hours by default (a two-hour minimum plus
five minutes of timing margin so the backend cache has expired): each cycle
costs four V2 calls (three production-energy ranges and one daily overview),
plus one site-details call at startup. That is about 46 energy calls per day
and up to 1,384 in a continuously running 30-day period, plus one details call.
With a 2,000-credit/month free tier, this leaves about 615 credits for restarts
and other users of the allowance. The backend caches each endpoint per site for
at least two hours and details for its lifetime, so multiple browser clients
share the same results instead of multiplying calls. A restart clears the cache
and adds another initial batch; other apps or sites sharing the allowance also
consume credits. Do not set `updateIntervalBasicData` below two hours; the
backend enforces a two-hour floor for API reads. Check your actual allowance
and usage in the portal. OAuth token exchange costs are not included here.
Only mock fixtures are used in automated tests; no paid API requests are made.

### `dataSource: "modbus"`

The live power flow is read straight from the inverters over Modbus/TCP, with no rate limit and
no cloud round trip. Enable **Modbus/TCP** on the leader inverter (SetApp / installer menu) or
point the module at a Modbus/TCP proxy:

```js
{
    module: 'MMM-SolarEdge',
    position: 'lower_third',
    config: {
        siteId: "12345",
        dataSource: "modbus",
        updateInterval: 1000 * 10,
        modbus: {
            host: "192.168.1.20",
            inverterUnitIds: [1, 2, 3] //leader first, then the followers
        }
    }
}
```

The module reads the inverters, the export/import meter and the batteries, and derives the
power flow locally. Site details and energy summaries still use V2 Basic API credits;
check your monthly quota.

Sites without a battery need no configuration for it. The module notices that there is no storage,
drops the battery from the display and stops asking for it, exactly as it does when the API
reports a site without storage. The same goes for a site without an export/import meter, except
that the grid then reads zero, because there is nothing left to measure it with.

Note that each Modbus read travels the RS485 chain between the inverters. Nameplate data is read
once and cached, after which a full cycle over three inverters plus meter and batteries takes
roughly two seconds. Setting `updateInterval` much below that only queues up reads without
delivering fresher data.

## Configuration options

| Option                            | Description
|-----------------                  |-----------
| `clientId`, `clientSecret`        | Site Access OAuth application credentials in `config/config.js`; browser-readable on your LAN
| `redirectUri`                     | Exact registered loopback callback URL, default `http://localhost:8080/oauth/callback`
| `refreshToken`                    | Deprecated; ignored. Remove after migrating to the private module-local token file
| `siteId`                          | *Required* The Site ID of the SolarEdge system you wish to monitor, which can be found in the Dashboard https://monitoring.solaredge.com
| `dataSource`                      | *Optional* `"api"` (default, energy-only) or `"modbus"` (live power plus energy); missing Modbus host falls back to API
| `updateInterval`                  | *Optional* How often the power flow is fetched, default is 5000. Applied as is over Modbus. Modbus only
| `updateIntervalBasicData`         | *Optional* Overview and energy poll interval, default/minimum two hours; shorter or invalid values are reset to two hours (backend cache also enforces this floor, plus five minutes of frontend timing margin)
| `showOverview`                    | *Optional* Enables/disables the long term data view, default is true
| `showDayEnergy`                   | *Optional* Enables/disables the day energy data view, default is true
| `decimal`                         | *Optional* The decimal symbol that will be used to display numbers. Possible values are "comma" or "period". Default is *comma*.
| `mockData`                        | *Optional* Serve mock data instead of talking to the real API, default is false. `"pvbatt"` mocks a site with a battery, `"pv"` one without

### Modbus options

| Option                            | Description
|-----------------                  |-----------
| `modbus.host`                     | *Required for Modbus* Address of the leader inverter or of a Modbus/TCP proxy
| `modbus.port`                     | *Optional* default is 1502, the SolarEdge default
| `modbus.inverterUnitIds`          | *Optional* Modbus unit ids to read, default is `[1]`. List the leader first, then the followers
| `modbus.meterUnitId`              | *Optional* Unit that carries the export/import meter, defaults to the first entry of `inverterUnitIds`
| `modbus.invertGridSign`           | *Optional* Set to true if import and export show up swapped, default is false. The module compares the live sign against the meter's energy counters and warns in the log when they disagree
| `modbus.flowThreshold`            | *Optional* Power in watts below which a flow counts as zero, default is 10. Raise it if arrows flicker around zero, lower it to see even the smallest trickle into the grid
| `modbus.timeout`                  | *Optional* Timeout per Modbus read in milliseconds, default is 5000

### Why the numbers add up

The battery and the strings are metered on the DC side of the inverter, the house and the grid
meter on the AC side. Read as they are, the battery always looks like it delivers a percent or
two more than the house consumes - that difference is simply the inverter's conversion loss on
the way from DC to AC.

The module therefore scales the DC readings onto the AC side using the conversion ratio the
inverters are measurably running at, which is what the monitoring API reports as well. PV, storage
and grid then add up to the load exactly instead of leaving an unexplained remainder.

## Migrating from the V1 Monitoring API

SolarEdge plans to retire V1 Site API Keys in November 2026. The old `apiKey`
(`?api_key=...`) cannot authenticate to V2. Migrate on a test instance before
updating your production mirror:

1. **Keep the Modbus settings** (`dataSource: "modbus"`, host and unit IDs) for
   live PV, battery, grid and load power. V2 Basic has no real-time power flow;
   its Advanced power-flow endpoint requires a higher tier. `dataSource: "api"`
   is not a replacement for the old live display.
2. **Choose the correct SolarEdge access type.** A private homeowner creates a
   **Site Access** application in the [developer portal](https://developer.solaredge.com/)
   with at least `SITE_DATA` scope. `DEVICE_DATA` is optional for this module.
   Installer/fleet applications use a different API-key flow and are not
   interchangeable with homeowner OAuth. Sign in to the consent screen with
   the **mySolarEdge account linked to the site**, not an installer login:
   an installer login can produce “We couldn't verify your account.”
3. **Register the exact Allowed Redirect URI** `http://localhost:8080/oauth/callback` in the developer portal (or use `http://127.0.0.1:8080/oauth/callback` consistently). This callback is intentionally limited to loopback port 8080.
4. **Configure `config/config.js`** in the existing MMM-SolarEdge module entry:

   ```js
   config: {
     siteId: "12345",
     clientId: "YOUR_CLIENT_ID",
     clientSecret: "YOUR_CLIENT_SECRET",
     redirectUri: "http://localhost:8080/oauth/callback"
   }
   ```

   `config/config.js` is read-only to this module. Keep client credentials there and outside Git. The rotating refresh token lives **only** in `modules/MMM-SolarEdge/.oauth-tokens.json` (gitignored, mode `0600`); the helper creates it atomically on first authorization, then persists each rotation across restarts. The file contains just `refreshToken`, not client credentials. The MagicMirror process must be able to write the **module directory**; in Docker/Podman, the current read-only module mount must become writable or a persistent writable mount must cover the token-file location inside the module. A read-only module mount will cause authorization/refresh persistence to fail. Back up the token file securely.

   **Existing installations:** remove the old managed `refreshToken` line and comment from `config.js` yourself. The old value is deliberately **not** imported or used automatically; reauthorize once to populate the private file. Never leave the old token in config after migration. No process edits `config.js`.
5. **Authorize once** from a browser on the mirror host at `http://localhost:8080/oauth/start`. If your browser runs on **another computer**, open a terminal on that computer and forward its local port 8080 to the MagicMirror host (replace the user and IP with yours):

   ```sh
   ssh -L 8080:127.0.0.1:8080 pi@192.168.1.100
   ```

   SSH prompts for your password if password login is enabled, or uses your configured SSH key. To explicitly use password authentication rather than a key:

   ```sh
   ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no \
     -L 8080:127.0.0.1:8080 pi@192.168.1.100
   ```

   **Leave the SSH connection open.** In the browser on that **same computer**, open `http://localhost:8080/oauth/start` and finish the SolarEdge consent in the same browser profile. Do **not** open `http://192.168.1.100:8080/oauth/start`: the OAuth routes accept only `localhost:8080`, and the registered callback also points to `localhost:8080`. Local port 8080 must be free on the browser computer; changing just the tunnel's local port will not match the registered callback. Do not put your SSH password in this file or the module config. A ten-minute one-use state cookie binds the flow. A rejected or expired flow needs a fresh `/oauth/start`. On success the helper saves the token file; every refresh rotates and persists it. If persistence fails after an exchange, reauthorize; the previous token may already be invalid.
6. **Verify** Modbus live values (if configured) and V2 day/month/year energy data. Watch server logs and developer-portal credits. Basic polling defaults to about two hours and five minutes. Changing client credentials or losing the token requires reauthorization.

If SolarEdge says **“We couldn't verify your account” before returning to the
callback**, first try the homeowner login associated with the site. If it still
fails, contact SolarEdge support about the account-to-site link. This is not
fixed by changing the redirect URI or reusing a V1 Site API Key. If the
account has multiple sites, SolarEdge may instead show a single-site-only
message; consult its [migration guide](https://api-docs.solaredge.com/docs/developer-platform/6m1ly9bdp9egs-migrating-from-site-api-keys-to-o-auth).

## Samples
![alt text](/docs/SolarEdgePv.png "Example")

![alt text](/docs/SolarEdgePvBattery.png "Example")
