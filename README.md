# MMM-SolarEdge

This is a module for the [MagicMirror²](https://github.com/MichMich/MagicMirror/).

A Module for MagicMirror2 designed to integrate with a SolarEdge System. Dependent on your configuration it can display several statistics.

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

## Using the module

To use this module, add the following configuration block to the modules array in the `config/config.js` file:

```js
var config = {
    modules: [
        {
            module: 'MMM-SolarEdge',
            position: 'lower_third',
            config: {
                apiKey: "################################", //Requires your own API Key
                siteId: "12345", //SolarEdge site ID
                userName: "youruser", //SolarEdge Monitoring Portal User
                userPassword: "yourpw", //SolarEdge Monitoring Portal Password
            }
        },
    ]
}
```

## Configuration options

| Option                            | Description
|-----------------                  |-----------
| `apiKey`                          | *Required* An API Key that can be obtained by creating one in your SolarEdge Monitoring Portal https://monitoring.solaredge.com
| `siteId`                          | *Required* The Site ID of the SolarEdge system you wish to monitor, which can be found in the Dashboard https://monitoring.solaredge.com
| `userName`                        | *Required* SolarEdge Monitoring Portal User
| `userPassword`                    | *Required* SolarEdge Monitoring Portal Password
| `portalUrl`                       | *Optional* override in case of a proxy, default is https://monitoringapi.solaredge.com
| `livaDataUrl`                     | *Optional* override in case of a proxy, default is https://monitoring.solaredge.com
| `updateIntervalBasicData`         | *Optional* Update interval** for the basic data like overview or details, default is 15 minutes
| `showOverview`                    | *Optional* Enables/disables the long term data view
| `mockData`                        | *Optional* If you like to change something without using the real API, default is false
** be aware that with custom params you could reach the daily request limit of the SolarEdge API gateway.

## Samples
![alt text](https://github.com/st3v0rr/MMM-SolarEdge/raw/main/docs/SolarEdgePv.png "Example")

![alt text](https://github.com/st3v0rr/MMM-SolarEdge/raw/main/docs/SolarEdgePvBattery.png "Example")
