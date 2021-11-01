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
    showLiveData: true,
    showOverview: true,
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

    if (this.config.showLiveData) {
      self.getCurrentPowerData();
      setInterval(function () {
        self.getCurrentPowerData();
        self.updateDom();
      }, this.config.updateInterval);
    }

    if (this.config.showOverview) {
      setTimeout(
        () => self.getOverviewData(),
        this.config.primes.sort(() => Math.random() - 0.5)[0]
      );
      setTimeout(
        () => self.getEnvBenefitsData(),
        this.config.primes.sort(() => Math.random() - 0.5)[0]
      );

      setInterval(function () {
        self.getOverviewData();
        self.updateDom();
      }, this.config.updateIntervalBasicData +
        this.config.primes.sort(() => Math.random() - 0.5)[0]);

      setInterval(function () {
        self.getEnvBenefitsData();
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

  getEnvBenefitsData: function () {
    this.sendSocketNotification(
      "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_ENVBENEFITS_DATA_REQUESTED",
      {
        config: this.config
      }
    );
  },

  createBlock: function (power, status, imagePath) {
    var wrapper = document.createElement("div");
    wrapper.classList.add("solaredge-container-block");

    var wrapperImage = document.createElement("div");
    var image = document.createElement("img");
    image.src = this.data.path + imagePath;
    wrapperImage.appendChild(image);

    var wrapperData;
    if (status !== "Idle") {
      wrapperData = document.createElement("div");
      wrapperData.classList.add("small");
      wrapperData.innerHTML =
        power +
        " " +
        this.dataNotificationCurrentPower.siteCurrentPowerFlow.unit;
    } else {
      wrapperData = document.createElement("div");
      wrapperData.classList.add("small");
      wrapperData.classList.add("solaredge-color-stand-by");
      wrapperData.innerHTML = this.translate("STAND_BY");
    }

    wrapper.appendChild(wrapperImage);
    wrapper.appendChild(wrapperData);
    return wrapper;
  },

  createArrowBlock: function (direction, color) {
    var wrapper = document.createElement("div");
    wrapper.classList.add("solaredge-container-arrow-block");

    if (direction && color) {
      var image = document.createElement("img");
      image.src =
        this.data.path + "images/arrow_" + direction + "_" + color + ".svg";

      wrapper.appendChild(image);
    }

    return wrapper;
  },

  getArrowConnections: function (connections) {
    return connections.map(
      (connection) =>
        connection.from.toLowerCase() + "_" + connection.to.toLowerCase()
    );
  },

  getHeader: function () {
    var title;
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
    return title;
  },

  getDom: function () {
    // create element wrapper for show into the module
    var wrapper = document.createElement("div");
    if (this.config.apiKey === "" || this.config.siteId === "") {
      wrapper.innerHTML = "Missing configuration for MMM-SolarEdge.";
      return wrapper;
    }
    if (!this.loaded) {
      wrapper.innerHTML = "Loading MMM-SolarEdge...";
      return wrapper;
    }

    // Data from helper
    if (this.dataNotificationCurrentPower) {
      var allArrowConnections = this.getArrowConnections(
        this.dataNotificationCurrentPower.siteCurrentPowerFlow.connections
      );

      var wrapperCurrentPowerData = document.createElement("div");
      wrapperCurrentPowerData.classList.add("solaredge-container");

      var wrapperPv = this.createBlock(
        this.dataNotificationCurrentPower.siteCurrentPowerFlow.PV.currentPower
          .toFixed(2)
          .replace(".", ","),
        this.dataNotificationCurrentPower.siteCurrentPowerFlow.PV.status,
        "images/pv.svg"
      );

      var wrapperArrowPvHome;
      if (allArrowConnections.includes("pv_load")) {
        wrapperArrowPvHome = this.createArrowBlock("right", "green");
      } else {
        wrapperArrowPvHome = this.createArrowBlock();
      }

      var wrapperHome = this.createBlock(
        this.dataNotificationCurrentPower.siteCurrentPowerFlow.LOAD.currentPower
          .toFixed(2)
          .replace(".", ","),
        this.dataNotificationCurrentPower.siteCurrentPowerFlow.LOAD.status,
        "images/home.svg"
      );

      var wrapperArrowHomeGrid;
      if (allArrowConnections.includes("load_grid")) {
        wrapperArrowHomeGrid = this.createArrowBlock("right", "green");
      } else if (allArrowConnections.includes("grid_load")) {
        wrapperArrowHomeGrid = this.createArrowBlock("left", "red");
      } else {
        wrapperArrowHomeGrid = this.createArrowBlock();
      }

      var wrapperGrid = this.createBlock(
        this.dataNotificationCurrentPower.siteCurrentPowerFlow.GRID.currentPower
          .toFixed(2)
          .replace(".", ","),
        this.dataNotificationCurrentPower.siteCurrentPowerFlow.GRID.status,
        "images/grid.svg"
      );

      wrapperCurrentPowerData.appendChild(wrapperPv);
      wrapperCurrentPowerData.appendChild(wrapperArrowPvHome);
      wrapperCurrentPowerData.appendChild(wrapperHome);
      wrapperCurrentPowerData.appendChild(wrapperArrowHomeGrid);
      wrapperCurrentPowerData.appendChild(wrapperGrid);

      wrapper.appendChild(wrapperCurrentPowerData);
    }
    if (this.dataNotificationOverview) {
      this.titles = [
        this.translate("TODAY"),
        this.translate("THIS_MONTH"),
        this.translate("THIS_YEAR"),
        this.translate("LIFETIME")
      ];
      this.results = [];
      this.results.push(
        (this.dataNotificationOverview.overview.lastDayData.energy / 1000)
          .toFixed(2)
          .replace(".", ",") + " kWh"
      );
      this.results.push(
        (this.dataNotificationOverview.overview.lastMonthData.energy / 1000)
          .toFixed(2)
          .replace(".", ",") + " kWh"
      );
      this.results.push(
        (this.dataNotificationOverview.overview.lastYearData.energy / 1000)
          .toFixed(2)
          .replace(".", ",") + " kWh"
      );
      this.results.push(
        (this.dataNotificationOverview.overview.lifeTimeData.energy / 1000)
          .toFixed(2)
          .replace(".", ",") + " kWh"
      );

      var wrapperCurrentOverviewData = document.createElement("div");
      wrapperCurrentOverviewData.classList.add("solaredge-limit-width");

      var tb = document.createElement("table");
      tb.classList.add("solaredge-border-top-bottom");

      for (var i = 0; i < this.results.length; i++) {
        var row = document.createElement("tr");

        var titleTr = document.createElement("td");
        var dataTr = document.createElement("td");

        titleTr.innerHTML = this.titles[i];
        titleTr.classList.add("solaredge-text-align-left");
        titleTr.classList.add("light");
        dataTr.innerHTML = this.results[i];
        dataTr.classList.add("solaredge-text-align-right");

        row.appendChild(titleTr);
        row.appendChild(dataTr);

        tb.appendChild(row);
        wrapperCurrentOverviewData.appendChild(tb);
      }
      if (this.dataNotificationEnvBenefits) {
        var envtb = document.createElement("table");
        envtb.classList.add("solaredge-limit-width");
        envtb.classList.add("solaredge-border-top-bottom");
        var envRow = document.createElement("tr");

        var envTitleTr = document.createElement("td");
        var endDataTr1 = document.createElement("td");
        var endDataTr2 = document.createElement("td");

        envTitleTr.innerHTML =
          Math.round(
            this.dataNotificationEnvBenefits.envBenefits.gasEmissionSaved.co2
          ) +
          " kg CO2 " +
          this.translate("SAVED");
        envTitleTr.classList.add("solaredge-text-align-left");
        endDataTr1.innerHTML = this.translate("OR");
        endDataTr2.innerHTML =
          Math.round(
            this.dataNotificationEnvBenefits.envBenefits.treesPlanted
          ) +
          " " +
          this.translate("TREES_PLANTED");
        endDataTr2.classList.add("solaredge-text-align-right");

        envRow.appendChild(envTitleTr);
        envRow.appendChild(endDataTr1);
        envRow.appendChild(endDataTr2);

        envtb.appendChild(envRow);
        wrapperCurrentOverviewData.appendChild(envtb);
      }

      wrapper.appendChild(wrapperCurrentOverviewData);
    }
    return wrapper;
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
      de: "translations/de.json"
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
      "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_ENVBENEFITS_DATA_RECEIVED"
    ) {
      // set dataNotification
      this.dataNotificationEnvBenefits = payload;
      this.updateDom();
    }
  }
});
