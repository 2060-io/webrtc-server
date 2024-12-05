import { Injectable, Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name)

  constructor(private readonly httpService: HttpService) {}

  /**
   * Sends a notification to a specified URI when a peer joins or leaves the roomId.
   *
   * @param {string} eventNotificationUri - The URI to which the notification will be sent.
   * @param {Object} notificationData - The data to be sent as the body of the POST request.
   * @param {string} notificationData.peerId - The ID of the peer involved in the event.
   * @param {string} notificationData.event - The type of event ('peer-joined' or 'peer-left').
   */
  async sendNotification(
    eventNotificationUri: string,
    notificationData: { peerId: string; event: string },
  ): Promise<void> {
    if (eventNotificationUri) {
      try {
        const response = await firstValueFrom(this.httpService.post(eventNotificationUri, notificationData))
        this.logger.log(`Notification sent to ${eventNotificationUri}: ${response.status}`)
      } catch (error) {
        this.logger.error(`Failed to send notification to ${eventNotificationUri}:`, error.message)
      }
    } else {
      this.logger.error('Failed to send notification: eventNotificationUri is not defined', notificationData)
    }
  }
}
