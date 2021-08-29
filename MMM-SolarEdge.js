/* global Module */

/* Magic Mirror
 * Module: MMM-SolarEdge
 *
 * By Stefan Nachtrab
 * MIT Licensed.
 */

Module.register("MMM-SolarEdge", {
  defaults: {
    updateInterval: 10000,
    retryDelay: 5000
  },

  requiresVersion: "2.1.0", // Required version of MagicMirror

  start: function () {
    var self = this;

    console.log("Starting module MMM-SolarEdge");

    //Flag for check if module is loaded
    this.loaded = false;
    //Initially load data
    self.getSolarEdgeData();

    // Schedule update timer.
    setInterval(function () {
      self.getSolarEdgeData();
      self.updateDom();
    }, this.config.updateInterval);
  },

  /*
   * getSolarEdge
   * function returns solaredge data and show it in the module wrapper
   * get a URL request
   *
   */
  getSolarEdgeData: function () {
    this.sendSocketNotification(
      "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_DATA_REQUESTED",
      {
        config: this.config
      }
    );
  },

  createBlock: function (power, status, imagePath) {
    var wrapper = document.createElement("div");
    wrapper.classList.add("block");

    var wrapperImage = document.createElement("div");
    var image = document.createElement("img");
    image.src = this.data.path + imagePath;
    wrapperImage.appendChild(image);

    var wrapperData;
    if (status !== "Idle") {
      wrapperData = document.createElement("div");
      wrapperData.classList.add("small");
      wrapperData.innerHTML =
        power + " " + this.dataNotification.siteCurrentPowerFlow.unit;
    } else {
      wrapperData = document.createElement("div");
      wrapperData.classList.add("small");
      wrapperData.classList.add("stand-by");
      wrapperData.innerHTML = this.translate("STAND_BY");
    }

    wrapper.appendChild(wrapperImage);
    wrapper.appendChild(wrapperData);
    return wrapper;
  },

  createArrowBlock: function (direction, color) {
    var wrapper = document.createElement("div");
    wrapper.classList.add("arrow-block");

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

  getDom: function () {
    // create element wrapper for show into the module
    var wrapper = document.createElement("div");

    // Data from helper
    if (this.dataNotification) {
      var allArrowConnections = this.getArrowConnections(
        this.dataNotification.siteCurrentPowerFlow.connections
      );

      var wrapperTitle = document.createElement("header");
      wrapperTitle.classList.add("module-header");
      wrapperTitle.innerHTML = this.translate("TITLE");

      var wrapperCurrentData = document.createElement("div");
      wrapperCurrentData.classList.add("container");

      var wrapperPv = this.createBlock(
        this.dataNotification.siteCurrentPowerFlow.PV.currentPower
          .toFixed(2)
          .replace(".", ","),
        this.dataNotification.siteCurrentPowerFlow.PV.status,
        "images/pv.svg"
      );

      var wrapperArrowPvHome;
      if (allArrowConnections.includes("pv_load")) {
        wrapperArrowPvHome = this.createArrowBlock("right", "green");
      } else {
        wrapperArrowPvHome = this.createArrowBlock();
      }

      var wrapperHome = this.createBlock(
        this.dataNotification.siteCurrentPowerFlow.LOAD.currentPower
          .toFixed(2)
          .replace(".", ","),
        this.dataNotification.siteCurrentPowerFlow.LOAD.status,
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
        this.dataNotification.siteCurrentPowerFlow.GRID.currentPower
          .toFixed(2)
          .replace(".", ","),
        this.dataNotification.siteCurrentPowerFlow.GRID.status,
        "images/grid.svg"
      );

      wrapperCurrentData.appendChild(wrapperPv);
      wrapperCurrentData.appendChild(wrapperArrowPvHome);
      wrapperCurrentData.appendChild(wrapperHome);
      wrapperCurrentData.appendChild(wrapperArrowHomeGrid);
      wrapperCurrentData.appendChild(wrapperGrid);

      wrapper.appendChild(wrapperTitle);
      wrapper.appendChild(wrapperCurrentData);
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
    if (notification === "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_DATA_RECEIVED") {
      // set dataNotification
      this.dataNotification = payload;
      this.updateDom();
    }
  }
});
