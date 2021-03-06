/* Magic Mirror
 * Node Helper: MMM-SolarEdge
 *
 * By Stefan Nachtrab
 * MIT Licensed.
 */

var NodeHelper = require("node_helper");
var request = require("request");
var btoa = require("btoa");
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
        var currentPowerUrl =
          payload.config.liveDataUrl +
          "/solaredge-apigw/api/site/" +
          payload.config.siteId +
          "/currentPowerFlow.json";
        var auth =
          "Basic " +
          btoa(payload.config.userName + ":" + payload.config.userPassword);
        var options = {
          url: currentPowerUrl,
          headers: { Authorization: auth }
        };
        request(options, function (error, response, body) {
          if (!error && response.statusCode === 200) {
            console.log(body);
            self.sendSocketNotification(
              "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_CURRENTPOWER_DATA_RECEIVED",
              JSON.parse(body)
            );
          }
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
        let detailsUrl =
          payload.config.portalUrl +
          "/site/" +
          payload.config.siteId +
          "/details?api_key=" +
          payload.config.apiKey;
        request(detailsUrl, function (error, response, body) {
          if (!error && response.statusCode === 200) {
            self.sendSocketNotification(
              "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_DETAILS_DATA_RECEIVED",
              JSON.parse(body)
            );
          }
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
        let overviewUrl =
          payload.config.portalUrl +
          "/site/" +
          payload.config.siteId +
          "/overview?api_key=" +
          payload.config.apiKey;
        request(overviewUrl, function (error, response, body) {
          if (!error && response.statusCode === 200) {
            self.sendSocketNotification(
              "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_OVERVIEW_DATA_RECEIVED",
              JSON.parse(body)
            );
          }
        });
      }
    }
  }
});
