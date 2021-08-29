/* Magic Mirror
 * Node Helper: MMM-SolarEdge
 *
 * By Stefan Nachtrab
 * MIT Licensed.
 */

var NodeHelper = require("node_helper");
var request = require("request");
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
          __dirname + "/mock/currentPowerFlow.json"
        );
        self.sendSocketNotification(
          "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_CURRENTPOWER_DATA_RECEIVED",
          JSON.parse(currentPowerFlow)
        );
      } else {
        let currentPowerUrl =
          "https://monitoringapi.solaredge.com/site/" +
          payload.config.siteId +
          "/currentPowerFlow?api_key=" +
          payload.config.apiKey;
        request(currentPowerUrl, function (error, response, body) {
          if (!error && response.statusCode === 200) {
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
          "https://monitoringapi.solaredge.com/site/" +
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
          "https://monitoringapi.solaredge.com/site/" +
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

    if (
      notification ===
      "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_ENVBENEFITS_DATA_REQUESTED"
    ) {
      if (payload.config.mockData) {
        var envBenefits = fs.readFileSync(__dirname + "/mock/envBenefits.json");
        self.sendSocketNotification(
          "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_ENVBENEFITS_DATA_RECEIVED",
          JSON.parse(envBenefits)
        );
      } else {
        let envBenefitsUrl =
          "https://monitoringapi.solaredge.com/site/" +
          payload.config.siteId +
          "/envBenefits?api_key=" +
          payload.config.apiKey;
        request(envBenefitsUrl, function (error, response, body) {
          if (!error && response.statusCode === 200) {
            self.sendSocketNotification(
              "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_ENVBENEFITS_DATA_RECEIVED",
              JSON.parse(body)
            );
          }
        });
      }
    }
  }
});
