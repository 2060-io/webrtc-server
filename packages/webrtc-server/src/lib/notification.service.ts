import { Injectable, Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import { AxiosInstance } from 'axios'
import axios from 'axios'

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name)
  private readonly httpService: HttpService

  constructor() {
    const axiosInstance: AxiosInstance = axios.create()
    this.httpService = new HttpService(axiosInstance)
  }

  /**
   * Sends a notification to a specified URI when a peer joins or leaves the roomId.
   *
   * @param {string} eventNotificationUri - The URI to which the notification will be sent.
   * @param {Object} notificationData - The data to be sent as the body of the POST request.
   * @param {string} notificationData.peerId - The ID of the peer involved in the event.
   * @param {string} notificationData.event - The type of event ('peer-joined' or 'peer-left').
   */
  public async sendNotification(
    eventNotificationUri: string,
    notificationData: { peerId: string; event: string },
  ): Promise<void> {
    if (eventNotificationUri) {
      try {
        const response = await firstValueFrom(this.httpService.post(eventNotificationUri, notificationData))
        this.logger.log(`[sendNotification] Notification sent to ${eventNotificationUri}: ${response.status}`)
      } catch (error) {
        this.logger.error(`[sendNotification] Failed to send notification to ${eventNotificationUri}: ${error.message}`)
      }
    } else {
      this.logger.warn(
        `[sendNotification] couldn't to send notification: eventNotificationUri is not defined: ${notificationData}`,
      )
    }
  }
}