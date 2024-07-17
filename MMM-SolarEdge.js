/* global Module */

/* Magic Mirror
 * Module: MMM-SolarEdge
 *
 * By Stefan Nachtrab
 * MIT Licensed.
 */

Module.register("MMM-SolarEdge", {
  defaults: {
    updateInterval: 5000,
    retryDelay: 5000,
    siteId: undefined,
    apiKey: undefined,
    userName: undefined,
    userPassword: undefined,
    updateIntervalBasicData: 1000 * 60 * 15, //every 15 minutes
    portalUrl: "https://monitoringapi.solaredge.com",
    liveDataUrl: "https://monitoring.solaredge.com",
    showOverview: true,
    showDayEnergy: true,
    compactMode: false,
    units: config.units,
    moduleRelativePath: "modules/MMM-SolarEdge", //workaround for nunjucks image location
    primes: [
      499, 997, 1499, 1997, 2503, 2999, 3499, 4001, 4493, 4999, 5501, 6007,
      6491, 7001, 7499, 7993, 8501, 8999, 9497, 9773
    ], //prime factors to avoid api limitation (429) in schedules
    mockData: false //for development purposes only!
  },

  validUnits: ["imperial", "metric", ""],
    
  requiresVersion: "2.1.0", // Required version of MagicMirror

  start: function () {
    var self = this;

    console.log("Starting module MMM-SolarEdge");

    //Flag for check if module is loaded
    this.loaded = false;

    self.getCurrentPowerData();
    setInterval(function () {
      self.getCurrentPowerData();
      self.updateDom();
    }, this.config.updateInterval);

    //sanitize units parameter
    if (this.validUnits.indexOf(this.config.units) == -1) {
      this.config.units = "metric";
    }

    if (this.config.showOverview) {
      setTimeout(
        () => self.getOverviewData(),
        this.config.primes.sort(() => Math.random() - 0.5)[0]
      );

      setInterval(function () {
        self.getOverviewData();
        self.updateDom();
      }, this.config.updateIntervalBasicData +
        this.config.primes.sort(() => Math.random() - 0.5)[0]);
    }

    if (this.config.showDayEnergy) {
      setTimeout(
        () => self.getDayEnergyData(),
        this.config.primes.sort(() => Math.random() - 0.5)[0]
      );

      setInterval(function () {
        self.getDayEnergyData();
        self.updateDom();
      }, this.config.updateIntervalBasicData +
        this.config.primes.sort(() => Math.random() - 0.5)[0]);
    }

    setTimeout(
      () => self.getDetailsData(),
      this.config.primes.sort(() => Math.random() - 0.5)[0]
    );

    this.loaded = true;
  },

  getDetailsData: function () {
    this.sendSocketNotification(
      "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_DETAILS_DATA_REQUESTED",
      {
        config: this.config
      }
    );
  },

  getCurrentPowerData: function () {
    this.sendSocketNotification(
      "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_CURRENTPOWER_DATA_REQUESTED",
      {
        config: this.config
      }
    );
  },

  getOverviewData: function () {
    this.sendSocketNotification(
      "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_OVERVIEW_DATA_REQUESTED",
      {
        config: this.config
      }
    );
  },

  getDayEnergyData: function () {
    this.sendSocketNotification(
      "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_DAY_ENERGY_DATA_REQUESTED",
      {
        config: this.config
      }
    );
  },

  getUnitAdjustedValue: function (value) {
    if (this.config.units == "metric") {
      return value.toFixed(2).replace(".", "," );
    } else {
      return value.toFixed(2);
    }
  },

  getArrowConnections: function (connections) {
    return connections.map(
      (connection) =>
        connection.from.toLowerCase() + "_" + connection.to.toLowerCase()
    );
  },

  getHeader: function () {
    var title;
    if (this.data.header) {
      // Static header from config
      title = this.data.header;
    } else {
      // Header with SolarEdge Data
      if (this.dataNotificationDetails) {
        title =
          this.translate("TITLE") +
          " - " +
          this.dataNotificationDetails.details.location.address +
          ", " +
          this.dataNotificationDetails.details.location.city +
          " - " +
          this.getUnitAdjustedValue(this.dataNotificationDetails.details.peakPower) +
          " KWP";
      } else {
        title = this.translate("TITLE");
      }
    }
    return title;
  },

  getTemplate: function () {
    if (
      this.config.apiKey === "" ||
      this.config.siteId === "" ||
      this.config.userName === "" ||
      this.config.userPassword === "" ||
      !this.loaded
    ) {
      return "templates/default.njk";
    }
    if (this.dataNotificationCurrentPower !== undefined) {
      if (
        this.dataNotificationCurrentPower.siteCurrentPowerFlow.STORAGE !==
        undefined
      ) {
        return "templates/pvbattery.njk";
      } else {
        return "templates/pv.njk";
      }
    }
    return "templates/default.njk";
  },

  getTemplateData: function () {
    if (this.config.apiKey === "" || this.config.siteId === "") {
      return {
        status: "Missing configuration for MMM-SolarEdge.",
        config: this.config
      };
    }
    if (!this.loaded) {
      return {
        status: "Loading MMM-SolarEdge...",
        config: this.config
      };
    }

    if (this.dataNotificationCurrentPower !== undefined) {
      return {
        config: this.config,
        arrowDirections: this.mapArrowDirections(),
        powerAndStatus: this.mapCurrentPowerAndStatus(),
        lifeTimeData: this.mapLifeTime(),
        dayEnergyData: this.mapDayEnergy()
      };
    }

    return {
      status: "Loading MMM-SolarEdge...",
      config: this.config
    };
  },

  mapArrowDirections: function () {
    var allArrowConnections = this.getArrowConnections(
      this.dataNotificationCurrentPower.siteCurrentPowerFlow.connections
    );
    var arrowPvLoad = "none";
    if (allArrowConnections.includes("pv_load")) {
      arrowPvLoad = "right_green";
    }
    var arrowStorageLoad = "none";
    if (allArrowConnections.includes("pv_storage")) {
      arrowStorageLoad = "left_green";
    } else if (allArrowConnections.includes("storage_load")) {
      arrowStorageLoad = "right_green";
    } else if (allArrowConnections.includes("load_storage")) {
      arrowStorageLoad = "left_red";
    }
    var arrowGridLoad = "none";
    if (allArrowConnections.includes("load_grid")) {
      arrowGridLoad = "right_green";
    } else if (allArrowConnections.includes("grid_load")) {
      arrowGridLoad = "left_red";
    }
    return {
      arrowPvLoad,
      arrowStorageLoad,
      arrowGridLoad
    };
  },

  mapCurrentPowerAndStatus: function () {
    var powerAndStatus = this.dataNotificationCurrentPower.siteCurrentPowerFlow;
    var storage;
    if (powerAndStatus.STORAGE !== undefined) {
      storage = {
        power: this.getUnitAdjustedValue(powerAndStatus.STORAGE.currentPower),
        status: powerAndStatus.STORAGE.status,
        chargeLevel: powerAndStatus.STORAGE.chargeLevel,
        chargeLevelVisual: {
          rectFillValue: (
            54 * //hardcoded end of battery svg position
            (powerAndStatus.STORAGE.chargeLevel / 100)
          ).toFixed(0),
          rectFillColor: this.getChargeColor(
            powerAndStatus.STORAGE.chargeLevel / 100
          )
        }
      };
    }
    return {
      pv: {
        power: this.getUnitAdjustedValue(powerAndStatus.PV.currentPower),
        status: powerAndStatus.PV.status
      },
      storage,
      load: {
        power: this.getUnitAdjustedValue(powerAndStatus.LOAD.currentPower),
        status: powerAndStatus.LOAD.status
      },
      grid: {
        power: this.getUnitAdjustedValue(powerAndStatus.GRID.currentPower),
        status: powerAndStatus.GRID.status
      },
      unit: powerAndStatus.unit
    };
  },

  mapLifeTime: function () {
    if (this.dataNotificationOverview) {
      var lifeTime = this.dataNotificationOverview.overview;
      return {
        today: this.getUnitAdjustedValue(lifeTime.lastDayData.energy / 1000),
        this_month: this.getUnitAdjustedValue(lifeTime.lastMonthData.energy / 1000),
        this_year: this.getUnitAdjustedValue(lifeTime.lastYearData.energy / 1000)
      };
    }
  },

  mapDayEnergy: function () {
    if (this.dataNotificationDayEnergy) {
      var energyDetails = this.dataNotificationDayEnergy.energyDetails;
      return {
        production: this.getUnitAdjustedValue(energyDetails.meters.find(e => e.type === 'Production').values[0].value / 1000),
        consumption: this.getUnitAdjustedValue(energyDetails.meters.find(e => e.type === 'Consumption').values[0].value / 1000),
        feedIn: this.getUnitAdjustedValue(energyDetails.meters.find(e => e.type === 'FeedIn').values[0].value / 1000),
        purchased: this.getUnitAdjustedValue(energyDetails.meters.find(e => e.type === 'Purchased').values[0].value / 1000),
        selfConsumption: this.getUnitAdjustedValue(energyDetails.meters.find(e => e.type === 'SelfConsumption').values[0].value / 1000),
      };
    }
  },

  getChargeColor: function (chargeLevel) {
    //value from 0 to 1
    var hue = (chargeLevel * 120).toString(10);
    return ["hsl(", hue, ",100%,20%)"].join("");
  },

  getScripts: function () {
    return [];
  },

  getStyles: function () {
    return ["MMM-SolarEdge.css"];
  },

  // Load translations files
  getTranslations: function () {
    return {
      en: "translations/en.json",
      de: "translations/de.json",
      fr: "translations/fr.json"
    };
  },

  // socketNotificationReceived from helper
  socketNotificationReceived: function (notification, payload) {
    if (
      notification ===
      "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_CURRENTPOWER_DATA_RECEIVED"
    ) {
      // set dataNotification
      this.dataNotificationCurrentPower = payload;
      this.updateDom();
    }

    if (
      notification ===
      "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_DETAILS_DATA_RECEIVED"
    ) {
      // set dataNotification
      this.dataNotificationDetails = payload;
      this.updateDom();
    }

    if (
      notification ===
      "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_OVERVIEW_DATA_RECEIVED"
    ) {
      // set dataNotification
      this.dataNotificationOverview = payload;
      this.updateDom();
    }

    if (
      notification ===
      "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_DAY_ENERGY_DATA_RECEIVED"
    ) {
      // set dataNotification
      this.dataNotificationDayEnergy = payload;
      this.updateDom();
    }
  }
});
