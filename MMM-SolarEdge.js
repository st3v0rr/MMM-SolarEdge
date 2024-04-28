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
    moduleRelativePath: "modules/MMM-SolarEdge", //workaround for nunjucks image location
    primes: [
      499, 997, 1499, 1997, 2503, 2999, 3499, 4001, 4493, 4999, 5501, 6007,
      6491, 7001, 7499, 7993, 8501, 8999, 9497, 9773
    ], //prime factors to avoid api limitation (429) in schedules
    mockData: false //for development purposes only!
  },

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
          this.dataNotificationDetails.details.peakPower
            .toFixed(2)
            .replace(".", ",") +
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
        translations: {
          today: this.translate("TODAY"),
          this_month: this.translate("THIS_MONTH"),
          this_year: this.translate("THIS_YEAR"),
          stand_by: this.translate("STAND_BY")
        },
        arrowDirections: this.mapArrowDirections(),
        powerAndStatus: this.mapCurrentPowerAndStatus(),
        lifeTimeData: this.mapLifeTime()
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
        power: powerAndStatus.STORAGE.currentPower.toFixed(2).replace(".", ","),
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
        power: powerAndStatus.PV.currentPower.toFixed(2).replace(".", ","),
        status: powerAndStatus.PV.status
      },
      storage,
      load: {
        power: powerAndStatus.LOAD.currentPower.toFixed(2).replace(".", ","),
        status: powerAndStatus.LOAD.status
      },
      grid: {
        power: powerAndStatus.GRID.currentPower.toFixed(2).replace(".", ","),
        status: powerAndStatus.GRID.status
      },
      unit: powerAndStatus.unit
    };
  },

  mapLifeTime: function () {
    if (this.dataNotificationOverview) {
      var lifeTime = this.dataNotificationOverview.overview;
      return {
        today: (lifeTime.lastDayData.energy / 1000)
          .toFixed(2)
          .replace(".", ","),
        this_month: (lifeTime.lastMonthData.energy / 1000)
          .toFixed(2)
          .replace(".", ","),
        this_year: (lifeTime.lastYearData.energy / 1000)
          .toFixed(2)
          .replace(".", ",")
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
  }
});
