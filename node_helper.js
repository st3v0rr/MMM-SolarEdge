/* Magic Mirror
 * Node Helper: MMM-SolarEdge
 *
 * By Stefan Nachtrab
 * MIT Licensed.
 */

var NodeHelper = require("node_helper");
var https = require("https");
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
          Buffer.from(payload.config.userName + ":" + payload.config.userPassword).toString('base64')
        var options = {
          headers: { Authorization: auth }
        };
        https.get(currentPowerUrl, options, (res) => {
          res.on('data', (d) => {
            self.sendSocketNotification(
              "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_CURRENTPOWER_DATA_RECEIVED",
              JSON.parse(d)
            );
          });
          }).on('error', (e) => {
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
        let detailsUrl =
          payload.config.portalUrl +
          "/site/" +
          payload.config.siteId +
          "/details?api_key=" +
          payload.config.apiKey;

        https.get(detailsUrl, (res) => {
          res.on('data', (d) => {
            self.sendSocketNotification(
              "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_DETAILS_DATA_RECEIVED",
              JSON.parse(d)
            );
          });
          }).on('error', (e) => {
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
        let overviewUrl =
          payload.config.portalUrl +
          "/site/" +
          payload.config.siteId +
          "/overview?api_key=" +
          payload.config.apiKey;
        https.get(overviewUrl, (res) => {
          res.on('data', (d) => {
            self.sendSocketNotification(
              "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_OVERVIEW_DATA_RECEIVED",
              JSON.parse(d)
            );
          });
          }).on('error', (e) => {
            console.error(e);
          });
      }
    }
  }
});
