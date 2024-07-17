/* Magic Mirror
 * Node Helper: MMM-SolarEdge
 *
 * By Stefan Nachtrab
 * MIT Licensed.
 */

var NodeHelper = require("node_helper");
var https = require("https");
var http = require("http");
var fs = require("fs");

module.exports = NodeHelper.create({
  /* socketNotificationReceived(notification, payload)
   * This method is called when a socket notification arrives.
   *
   * argument notification string - The identifier of the noitication.
   * argument payload mixed - The payload of the notification.
   */
  socketNotificationReceived: function (notification, payload) {
    var self = this;

    if (
      notification ===
      "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_CURRENTPOWER_DATA_REQUESTED"
    ) {
      if (payload.config.mockData) {
        var currentPowerFlow = fs.readFileSync(
          __dirname + "/mock/currentPowerFlowPvBattery.json"
        );
        self.sendSocketNotification(
          "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_CURRENTPOWER_DATA_RECEIVED",
          JSON.parse(currentPowerFlow)
        );
      } else {
        var liveDataClient = payload.config.liveDataUrl.startsWith("https")
          ? https
          : http;
        var currentPowerUrl =
          payload.config.liveDataUrl +
          "/solaredge-apigw/api/site/" +
          payload.config.siteId +
          "/currentPowerFlow.json";
        var auth =
          "Basic " +
          Buffer.from(
            payload.config.userName + ":" + payload.config.userPassword
          ).toString("base64");
        var options = {
          headers: { Authorization: auth }
        };
        liveDataClient
          .get(currentPowerUrl, options, (res) => {
            res.on("data", (d) => {
              self.sendSocketNotification(
                "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_CURRENTPOWER_DATA_RECEIVED",
                JSON.parse(d)
              );
            });
          })
          .on("error", (e) => {
            console.error(e);
          });
      }
    }

    if (
      notification ===
      "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_DETAILS_DATA_REQUESTED"
    ) {
      if (payload.config.mockData) {
        var details = fs.readFileSync(__dirname + "/mock/details.json");
        self.sendSocketNotification(
          "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_DETAILS_DATA_RECEIVED",
          JSON.parse(details)
        );
      } else {
        var portalDataClient = payload.config.liveDataUrl.startsWith("https")
          ? https
          : http;
        let detailsUrl =
          payload.config.portalUrl +
          "/site/" +
          payload.config.siteId +
          "/details?api_key=" +
          payload.config.apiKey;

        portalDataClient
          .get(detailsUrl, (res) => {
            res.on("data", (d) => {
              self.sendSocketNotification(
                "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_DETAILS_DATA_RECEIVED",
                JSON.parse(d)
              );
            });
          })
          .on("error", (e) => {
            console.error(e);
          });
      }
    }

    if (
      notification ===
      "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_OVERVIEW_DATA_REQUESTED"
    ) {
      if (payload.config.mockData) {
        var overview = fs.readFileSync(__dirname + "/mock/overview.json");
        self.sendSocketNotification(
          "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_OVERVIEW_DATA_RECEIVED",
          JSON.parse(overview)
        );
      } else {
        var portalDataClient = payload.config.liveDataUrl.startsWith("https")
          ? https
          : http;
        let overviewUrl =
          payload.config.portalUrl +
          "/site/" +
          payload.config.siteId +
          "/overview?api_key=" +
          payload.config.apiKey;
        portalDataClient
          .get(overviewUrl, (res) => {
            res.on("data", (d) => {
              self.sendSocketNotification(
                "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_OVERVIEW_DATA_RECEIVED",
                JSON.parse(d)
              );
            });
          })
          .on("error", (e) => {
            console.error(e);
          });
      }
    }

    if (
      notification ===
      "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_DAY_ENERGY_DATA_REQUESTED"
    ) {
      if (payload.config.mockData) {
        var overview = fs.readFileSync(__dirname + "/mock/dayEnergy.json");
        self.sendSocketNotification(
          "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_DAY_ENERGY_DATA_RECEIVED",
          JSON.parse(overview)
        );
      } else {
        var portalDataClient = payload.config.liveDataUrl.startsWith("https")
          ? https
          : http;
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
        portalDataClient
          .get(overviewUrl, (res) => {
            res.on("data", (d) => {
              self.sendSocketNotification(
                "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_DAY_ENERGY_DATA_RECEIVED",
                JSON.parse(d)
              );
            });
          })
          .on("error", (e) => {
            console.error(e);
          });
      }
    }
  },

  formatDate: function(date, format) {
    let month = date.getMonth() + 1;
    return format.replace('YYYY', date.getFullYear())
    .replace('MM', month.toString().padStart(2, '0'))
	  .replace('DD', date.getDate().toString().padStart(2, '0'));
  }
});
