/* global Module, setTimeout, clearInterval */

/* MagicMirror²
 * Module: MMM-SolarEdge
 *
 * By Stefan Nachtrab
 * MIT Licensed.
 */

//Shared across every instance, same pattern as MMM-Jeedom: MMM-PIR-Sensor
//broadcasts USER_PRESENCE to all modules, so one flag is enough for all of them.
//Defaults to true so nothing changes for setups without a PIR sensor.
var SolarEdgeUserPresence = true;

Module.register("MMM-SolarEdge", {
  defaults: {
    //How often the power flow is fetched. Applied as is over Modbus. The API
    //cannot be polled anywhere near this fast without burning its daily budget
    //of 300 requests, so there it is raised to minApiUpdateInterval.
    updateInterval: 5000,
    siteId: undefined,
    apiKey: undefined,
    updateIntervalBasicData: 1000 * 60 * 30, //every 30 minutes
    portalUrl: "https://monitoringapi.solaredge.com",
    //"api" reads everything from the SolarEdge monitoring API,
    //"modbus" reads the live power flow straight from the inverters instead.
    dataSource: "api",
    modbus: {
      host: undefined, //e.g. the inverter itself or a Modbus/TCP proxy
      port: 1502,
      inverterUnitIds: [1], //leader first, then the followers
      meterUnitId: undefined, //defaults to the first inverter unit
      invertGridSign: false, //flip if export and import show up swapped
      flowThreshold: 10, //W below which a flow is treated as zero
      timeout: 5000
    },
    showOverview: true,
    showDayEnergy: true,
    decimal: "comma",
    moduleRelativePath: "modules/MMM-SolarEdge", //workaround for nunjucks image location
    //false, or which site the mock data should describe: "pv" or "pvbatt".
    mockData: false, //for development purposes only!
    //Set to true to use updateInterval as configured even on the API, below
    //minApiUpdateInterval. Only makes sense together with a presence sensor
    //(see the README) that keeps the module from polling all day, otherwise
    //this will burn through the daily request budget.
    ignoreApiRateLimit: false
  },

  validDecimal: ["comma", "period"],
  validDataSource: ["api", "modbus"],
  validMockData: ["pv", "pvbatt"],

  //Modbus has no rate limit, the API has to last a whole day: 8 minutes leaves
  //room for the basic data inside the 300 requests SolarEdge grants per day.
  minApiUpdateInterval: 1000 * 60 * 8,

  //Spread the first requests so they do not all fire at once on startup.
  startupJitter: 3000,

  requiresVersion: "2.1.0", // Required version of MagicMirror

  start: function () {
    console.log("Starting module MMM-SolarEdge");

    //Flag for check if module is loaded
    this.loaded = false;

    //Only poll SolarEdge while the screen is actually on (MMM-PIR-Sensor)
    //and this module is visible, to save API calls.
    this.moduleHidden = false;
    this.powerIntervalID = null;
    this.basicIntervalID = null;
    //Tracks whether the module was active last time manageUpdateIntervals ran,
    //so it only fetches an extra time on the inactive -> active transition.
    //Starts true: the fetches below already cover the initial load.
    this.wasActive = true;
    //Last request error, if any - e.g. { endpoint, rateLimited, message },
    //cleared as soon as a request succeeds again. Shown on the widget so a
    //rate limit is not mistaken for a currently accurate reading.
    this.apiError = null;

    this.sanitizeConfig();

    if (!this.configComplete()) {
      //Nothing to talk to. The template says so, polling would only fill the
      //log with authentication errors.
      console.error("MMM-SolarEdge: incomplete configuration, not fetching");
      this.loaded = true;
      return;
    }

    this.getCurrentPowerData();
    this.startPowerInterval();

    if (this.canFetchBasicData()) {
      //Details never change during a session, so it is fetched once.
      setTimeout(() => this.getDetailsData(), this.startupJitter);
      if (this.config.showOverview || this.config.showDayEnergy) {
        setTimeout(() => {
          this.getBasicData();
          this.startBasicInterval();
        }, this.startupJitter * 2);
      }
    }

    this.loaded = true;
  },

  startPowerInterval: function () {
    if (this.powerIntervalID === null) {
      this.powerIntervalID = setInterval(
        () => this.getCurrentPowerData(),
        this.liveInterval
      );
    }
  },

  startBasicInterval: function () {
    if (
      this.basicIntervalID === null &&
      this.canFetchBasicData() &&
      (this.config.showOverview || this.config.showDayEnergy)
    ) {
      this.basicIntervalID = setInterval(
        () => this.getBasicData(),
        this.config.updateIntervalBasicData
      );
    }
  },

  stopUpdateIntervals: function () {
    clearInterval(this.powerIntervalID);
    this.powerIntervalID = null;
    clearInterval(this.basicIntervalID);
    this.basicIntervalID = null;
  },

  //Called whenever the screen (USER_PRESENCE from MMM-PIR-Sensor) or this
  //module's own visibility changes. Fetches fresh data right away and resumes
  //the periodic polling when someone can actually see the module again, stops
  //it otherwise. The immediate fetch only fires on the transition from
  //inactive to active, so it does not add extra requests while already active.
  manageUpdateIntervals: function () {
    var isActive =
      this.configComplete() &&
      SolarEdgeUserPresence === true &&
      this.moduleHidden === false;

    if (isActive) {
      if (!this.wasActive) {
        this.getCurrentPowerData();
        this.getBasicData();
      }
      this.startPowerInterval();
      this.startBasicInterval();
    } else {
      this.stopUpdateIntervals();
    }
    this.wasActive = isActive;
  },

  suspend: function () {
    //Core calls this when the module is hidden (e.g. by a carousel).
    this.moduleHidden = true;
    this.manageUpdateIntervals();
  },

  resume: function () {
    //Core calls this when the module is shown again.
    this.moduleHidden = false;
    this.manageUpdateIntervals();
  },

  notificationReceived: function (notification, payload) {
    // Broadcast by MMM-PIR-Sensor, see its README.
    if (notification === "USER_PRESENCE") {
      SolarEdgeUserPresence = payload;
      this.manageUpdateIntervals();
    }
  },

  //Details, overview and day energy always come from the API, even when the
  //power flow is read over Modbus - so they need a key. Mock data comes from
  //file and needs nothing at all.
  canFetchBasicData: function () {
    return Boolean(this.config.mockData) || Boolean(this.config.apiKey);
  },

  sanitizeConfig: function () {
    if (this.validDecimal.indexOf(this.config.decimal) === -1) {
      this.config.decimal = "comma";
    }

    //mockData used to be a boolean. Keep that working, but settle on one type
    //from here on so nothing downstream has to handle both.
    if (
      this.config.mockData &&
      this.validMockData.indexOf(this.config.mockData) === -1
    ) {
      console.warn(
        "MMM-SolarEdge: mockData expects " +
          this.validMockData.map((v) => "\"" + v + "\"").join(" or ") +
          ", using \"pvbatt\" for \"" + this.config.mockData + "\""
      );
      this.config.mockData = "pvbatt";
    }

    if (this.validDataSource.indexOf(this.config.dataSource) === -1) {
      console.warn(
        "MMM-SolarEdge: unknown dataSource \"" + this.config.dataSource +
          "\", falling back to \"api\""
      );
      this.config.dataSource = "api";
    }

    //MagicMirror merges config and defaults one level deep only, so a partial
    //modbus block would drop the remaining defaults.
    this.config.modbus = Object.assign(
      {},
      this.defaults.modbus,
      this.config.modbus
    );

    if (this.config.dataSource === "modbus" && !this.config.modbus.host) {
      console.warn(
        "MMM-SolarEdge: dataSource is \"modbus\" but modbus.host is not set, " +
          "falling back to the monitoring API"
      );
      this.config.dataSource = "api";
    }

    //Checked after the dataSource is settled, so a fallback to the API cannot
    //leave a five second interval pointed at a rate limited endpoint.
    if (
      this.config.dataSource === "api" &&
      this.config.updateInterval < this.minApiUpdateInterval
    ) {
      if (this.config.ignoreApiRateLimit) {
        console.warn(
          "MMM-SolarEdge: ignoreApiRateLimit is set, using the configured " +
            "updateInterval of " + this.config.updateInterval + " ms on the " +
            "API as is. Make sure something (e.g. a presence sensor) keeps " +
            "this from polling all day, or you will exceed the 300 " +
            "requests per day and start getting 429 responses."
        );
        this.liveInterval = this.config.updateInterval;
      } else {
        console.warn(
          "MMM-SolarEdge: updateInterval of " + this.config.updateInterval +
            " ms would exceed the API limit of 300 requests per day, using " +
            this.minApiUpdateInterval / 60000 + " min instead. Switch to " +
            "dataSource \"modbus\", or set \"ignoreApiRateLimit\" if you " +
            "know what you are doing (e.g. a presence sensor already " +
            "limits polling to when the screen is on)."
        );
        this.liveInterval = this.minApiUpdateInterval;
      }
    } else {
      this.liveInterval = this.config.updateInterval;
    }

    //Modbus delivers the power flow on its own, so an API key is optional
    //there - the long term views simply stay hidden without one.
    if (!this.config.apiKey && this.config.dataSource === "modbus") {
      if (this.config.showOverview || this.config.showDayEnergy) {
        console.warn(
          "MMM-SolarEdge: no apiKey set, hiding the overview and day energy " +
            "views - those are only available through the monitoring API"
        );
      }
      this.config.showOverview = false;
      this.config.showDayEnergy = false;
    }

    if (this.config.userName || this.config.userPassword) {
      console.warn(
        "MMM-SolarEdge: userName and userPassword are no longer used. " +
          "SolarEdge retired the portal live data endpoint, the module now " +
          "uses the official API or Modbus/TCP instead."
      );
    }
  },

  getBasicData: function () {
    if (this.config.showOverview) {
      this.getOverviewData();
    }
    if (this.config.showDayEnergy) {
      setTimeout(() => this.getDayEnergyData(), this.startupJitter);
    }
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

  getDecimalAdjustedValue: function (value) {
    if (this.config.decimal === "comma") {
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
    if (this.data.header != null) {
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
          this.getDecimalAdjustedValue(this.dataNotificationDetails.details.peakPower) +
          " KWP";
      } else {
        title = this.translate("TITLE");
      }
    }
    return title;
  },

  getTemplate: function () {
    if (!this.configComplete() || !this.loaded) {
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

  //Modbus needs a host, the API needs a key - the site id is needed either way.
  configComplete: function () {
    if (this.config.mockData) {
      return true; //mock data is served without talking to anything
    }
    if (!this.config.siteId) {
      return false;
    }
    return this.config.dataSource === "modbus"
      ? Boolean(this.config.modbus.host)
      : Boolean(this.config.apiKey);
  },

  //Translated message for the last request error, if any - undefined while
  //everything is fine, so templates can just check for truthiness.
  getApiErrorStatus: function () {
    if (!this.apiError) {
      return undefined;
    }
    return this.translate(this.apiError.rateLimited ? "RATE_LIMITED" : "API_ERROR");
  },

  getTemplateData: function () {
    if (!this.configComplete()) {
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
        dayEnergyData: this.mapDayEnergy(),
        status: this.getApiErrorStatus()
      };
    }

    return {
      status: this.getApiErrorStatus() || "Loading MMM-SolarEdge...",
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
        power: this.getDecimalAdjustedValue(powerAndStatus.STORAGE.currentPower),
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
        power: this.getDecimalAdjustedValue(powerAndStatus.PV.currentPower),
        status: powerAndStatus.PV.status
      },
      storage,
      load: {
        power: this.getDecimalAdjustedValue(powerAndStatus.LOAD.currentPower),
        status: powerAndStatus.LOAD.status
      },
      grid: {
        power: this.getDecimalAdjustedValue(powerAndStatus.GRID.currentPower),
        status: powerAndStatus.GRID.status
      },
      unit: powerAndStatus.unit
    };
  },

  mapLifeTime: function () {
    if (this.dataNotificationOverview) {
      var lifeTime = this.dataNotificationOverview.overview;
      return {
        today: this.getDecimalAdjustedValue(lifeTime.lastDayData.energy / 1000),
        this_month: this.getDecimalAdjustedValue(lifeTime.lastMonthData.energy / 1000),
        this_year: this.getDecimalAdjustedValue(lifeTime.lastYearData.energy / 1000)
      };
    }
  },

  mapDayEnergy: function () {
    if (this.dataNotificationDayEnergy) {
      var energyDetails = this.dataNotificationDayEnergy.energyDetails;
      return {
        production: this.getDecimalAdjustedValue(energyDetails.meters.find(e => e.type === 'Production').values[0].value / 1000),
        consumption: this.getDecimalAdjustedValue(energyDetails.meters.find(e => e.type === 'Consumption').values[0].value / 1000),
        feedIn: this.getDecimalAdjustedValue(energyDetails.meters.find(e => e.type === 'FeedIn').values[0].value / 1000),
        purchased: this.getDecimalAdjustedValue(energyDetails.meters.find(e => e.type === 'Purchased').values[0].value / 1000),
        selfConsumption: this.getDecimalAdjustedValue(energyDetails.meters.find(e => e.type === 'SelfConsumption').values[0].value / 1000),
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
    if (notification.endsWith("_DATA_RECEIVED")) {
      // Any successful response clears a previous error - the rate limit is
      // per site rather than per endpoint, so one succeeding again means it
      // is gone for all of them.
      this.apiError = null;
    }

    if (
      notification === "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_ERROR_RECEIVED"
    ) {
      this.apiError = payload;
      this.updateDom();
      return;
    }

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
