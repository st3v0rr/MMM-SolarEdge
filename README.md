# MMM-SolarEdge

This is a module for the [MagicMirror²](https://github.com/MichMich/MagicMirror/).

A Module for MagicMirror2 designed to integrate with a SolarEdge System. Dependent on your configuration it can display several statistics.

- Current Power (dependent on yout module update interval)
- more will follow...

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
            }
        },
    ]
}
```

## Configuration options

| Option           | Description
|----------------- |-----------
| `apiKey`         | *Required* An API Key that can be obtained by creating one in your SolarEdge Monitoring Portal https://monitoring.solaredge.com
| `siteId`         | *Required* The Site ID of the SolarEdge system you wish to monitor, which can be found in the Dashboard https://monitoring.solaredge.com

## Samples
![alt text](https://github.com/st3v0rr/MMM-SolarEdge/raw/main/docs/CurrentPower.png "Example")
