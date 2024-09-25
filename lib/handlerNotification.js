// notificationHelper.js

const axios = require('axios');
const Logger = require('./Logger'); 
const logger = new Logger();

/**
 * Sends a notification to a specified URI when a peer joins or leaves the roomId.
 * 
 * @param {string} eventNotificationUri - The URI to which the notification will be sent.
 * @param {Object} notificationData - The data to be sent as the body of the POST request.
 * @param {string} notificationData.peerId - The ID of the peer involved in the event.
 * @param {string} notificationData.event - The type of event ('peer-joined' or 'peer-left').
 */
async function sendNotification(eventNotificationUri, notificationData) {
  if (eventNotificationUri) {
    try {
      const response = await axios.post(eventNotificationUri, notificationData);
      logger.info(`Notification sent to ${eventNotificationUri}: ${response.status}`);
    } catch (error) {
      logger.error(`Failed to send notification to ${eventNotificationUri}:`, error);
    }
  }else {
    logger.error('Failed to send notification: eventNotificationUri is not defined',notificationData);
  }
}

module.exports = { sendNotification };
