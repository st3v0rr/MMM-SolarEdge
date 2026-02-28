/* global __dirname, Buffer */
/* MagicMirror²
 * Node Helper: MMM-SolarEdge
 *
 * By Stefan Nachtrab
 * MIT Licensed.
 */

var NodeHelper = require("node_helper");
var fs = require("fs");

module.exports = NodeHelper.create({
  /* socketNotificationReceived(notification, payload)
   * This method is called when a socket notification arrives.
   *
   * argument notification string - The identifier of the noitication.
   * argument payload mixed - The payload of the notification.
   */
  socketNotificationReceived: async function (notification, payload) {
    var self = this;

    if (
      notification ===
      "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_CURRENTPOWER_DATA_REQUESTED"
    ) {
      if (payload.config.mockData) {
        const currentPowerFlow = fs.readFileSync(
          __dirname + "/mock/currentPowerFlowPvBattery.json"
        );
        self.sendSocketNotification(
          "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_CURRENTPOWER_DATA_RECEIVED",
          JSON.parse(currentPowerFlow)
        );
      } else {
        const currentPowerUrl =
          payload.config.liveDataUrl +
          "/solaredge-apigw/api/site/" +
          payload.config.siteId +
          "/currentPowerFlow.json";
        const auth =
          "Basic " +
          Buffer.from(
            payload.config.userName + ":" + payload.config.userPassword
          ).toString("base64");
        const options = {
          headers: { Authorization: auth }
        };
        try {
          const currentPower = await self.fetchJson(currentPowerUrl, options);
          self.sendSocketNotification(
            "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_CURRENTPOWER_DATA_RECEIVED",
            currentPower
          );
        } catch (e) {
          console.error(e);
        }
      }
    }

    if (
      notification ===
      "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_DETAILS_DATA_REQUESTED"
    ) {
      if (payload.config.mockData) {
        const details = fs.readFileSync(__dirname + "/mock/details.json");
        self.sendSocketNotification(
          "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_DETAILS_DATA_RECEIVED",
          JSON.parse(details)
        );
      } else {
        let detailsUrl =
          payload.config.portalUrl +
          "/site/" +
          payload.config.siteId +
          "/details?api_key=" +
          payload.config.apiKey;

        try {
          const details = await self.fetchJson(detailsUrl);
          self.sendSocketNotification(
            "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_DETAILS_DATA_RECEIVED",
            details
          );
        } catch (e) {
          console.error(e);
        }
      }
    }

    if (
      notification ===
      "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_OVERVIEW_DATA_REQUESTED"
    ) {
      if (payload.config.mockData) {
        const overview = fs.readFileSync(__dirname + "/mock/overview.json");
        self.sendSocketNotification(
          "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_OVERVIEW_DATA_RECEIVED",
          JSON.parse(overview)
        );
      } else {
        let overviewUrl =
          payload.config.portalUrl +
          "/site/" +
          payload.config.siteId +
          "/overview?api_key=" +
          payload.config.apiKey;
        try {
          const overview = await self.fetchJson(overviewUrl);
          self.sendSocketNotification(
            "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_OVERVIEW_DATA_RECEIVED",
            overview
          );
        } catch (e) {
          console.error(e);
        }
      }
    }

    if (
      notification ===
      "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_DAY_ENERGY_DATA_REQUESTED"
    ) {
      if (payload.config.mockData) {
        const dayEnergy = fs.readFileSync(__dirname + "/mock/dayEnergy.json");
        self.sendSocketNotification(
          "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_DAY_ENERGY_DATA_RECEIVED",
          JSON.parse(dayEnergy)
        );
      } else {
        const todayStr = self.formatDate(new Date(), "YYYY-MM-DD");
        let overviewUrl =
          payload.config.portalUrl +
          "/site/" +
          payload.config.siteId +
          "/energyDetails?" +
          "meters=Production,Consumption,SelfConsumption,FeedIn,Purchased" +
          "&timeUnit=DAY" +
          "&startTime=" + todayStr + " 00:00:00" +
          "&endTime=" + todayStr + " 23:59:59" +
          "&api_key=" + payload.config.apiKey;
        try {
          const dayEnergy = await self.fetchJson(overviewUrl);
          self.sendSocketNotification(
            "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_DAY_ENERGY_DATA_RECEIVED",
            dayEnergy
          );
        } catch (e) {
          console.error(e);
        }
      }
    }
  },

  fetchJson: async function (url, options) {
    const res = await fetch(url, options);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        "Request failed " +
          res.status +
          " " +
          res.statusText +
          (body ? ": " + body : "")
      );
    }
    return res.json();
  },

  formatDate: function(date, format) {
    let month = date.getMonth() + 1;
    return format.replace('YYYY', date.getFullYear())
    .replace('MM', month.toString().padStart(2, '0'))
	  .replace('DD', date.getDate().toString().padStart(2, '0'));
  }
});
