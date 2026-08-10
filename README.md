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

To use this module, add the following configuration block to the `config/config.js` file:

```js
{
    module: 'MMM-SolarEdge',
    position: 'lower_third',
    config: {
        apiKey: "################################", //Requires your own API Key
        siteId: "12345" //SolarEdge site ID
    }
}
```

> **Upgrading from an older version:** `userName`, `userPassword` and `liveDataUrl` are gone.
> They belonged to the portal endpoint `monitoring.solaredge.com/solaredge-apigw/...`, which
> SolarEdge retired - it now answers `410 Gone`. The module reads the power flow from the
> official API endpoint instead, and can optionally read it from the inverters over Modbus/TCP.
> Leftover entries in your config are ignored, the module only logs a warning.

## Data sources

### `dataSource: "api"` (default)

Everything comes from the v1 monitoring API. That API grants **300 requests per site and day
across all endpoints**, and the default intervals are picked so a day fits inside that budget:

| Endpoint | Interval | Requests per day |
|---|---|---|
| Power flow | 8 min (`updateInterval`, raised from 5 s) | 181 |
| Overview | 30 min (`updateIntervalBasicData`) | 49 |
| Day energy | 30 min (`updateIntervalBasicData`) | 48 |
| Details | once at startup | 1 |
| | **total** | **279 of 300** |

The counts include the first request of each kind, which fires right at startup rather than after
a full interval. Every restart costs another four requests on top, which is what the remaining
reserve is for.

The default `updateInterval` of 5 seconds is meant for Modbus and would mean 17280 requests a day
here, so on the API it is raised to 8 minutes and the module logs that it did. Everything else is
taken as configured - if you shorten an interval, do the arithmetic yourself, going over earns you
`429` responses for the rest of the day.

Useful numbers when adjusting: `86400 / interval_in_seconds` requests per day per endpoint. The
practical floor for the power flow is about **5 minutes**, which is what you get with both long
term views switched off - 300 requests a day is one request every 4.8 minutes and no setting
changes that. There is no way to make the API deliver data in real time; that is what the Modbus
source is for.

### `dataSource: "modbus"`

The live power flow is read straight from the inverters over Modbus/TCP, with no rate limit and
no cloud round trip. Enable **Modbus/TCP** on the leader inverter (SetApp / installer menu) or
point the module at a Modbus/TCP proxy:

```js
{
    module: 'MMM-SolarEdge',
    position: 'lower_third',
    config: {
        apiKey: "################################",
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

The module reads the inverters, the export/import meter and the batteries, and derives the same
power flow the API returns. Details, overview and day energy still come from the API - they add
up to fewer than 200 requests a day and stay well inside the quota.

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
| `apiKey`                          | *Required* An API Key that can be obtained by creating one in your SolarEdge Monitoring Portal https://monitoring.solaredge.com
| `siteId`                          | *Required* The Site ID of the SolarEdge system you wish to monitor, which can be found in the Dashboard https://monitoring.solaredge.com
| `dataSource`                      | *Optional* `"api"` (default) or `"modbus"`, see above
| `updateInterval`                  | *Optional* How often the power flow is fetched, default is 5000. Applied as is over Modbus. On the API anything below 8 minutes is raised to 8 minutes, otherwise a single day would blow the request limit - the module says so in the log
| `updateIntervalBasicData`         | *Optional* Update interval for overview and day energy, default is 30 minutes
| `portalUrl`                       | *Optional* override in case of a proxy, default is https://monitoringapi.solaredge.com
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

## Samples
![alt text](/docs/SolarEdgePv.png "Example")

![alt text](/docs/SolarEdgePvBattery.png "Example")
