/* Magic Mirror
 * Node Helper: MMM-SolarEdge
 *
 * By Stefan Nachtrab
 * MIT Licensed.
 */

var NodeHelper = require("node_helper");
var request = require("request");

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
      notification === "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_DATA_REQUESTED"
    ) {
      let currentPowerUrl =
        "https://monitoringapi.solaredge.com/site/" +
        payload.config.siteId +
        "/currentPowerFlow?api_key=" +
        payload.config.apiKey;

      request(currentPowerUrl, function (error, response, body) {
        if (!error && response.statusCode === 200) {
          self.sendSocketNotification(
            "MMM-SolarEdge-NOTIFICATION_SOLAREDGE_DATA_RECEIVED",
            JSON.parse(body)
          );
        }
      });
    }
  }
});
