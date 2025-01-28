import { Injectable, Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import { AxiosInstance } from 'axios'
import axios from 'axios'

@Injectable()
export class HttpRequestService {
  private readonly logger = new Logger(HttpRequestService.name)
  private readonly httpService: HttpService

  constructor() {
    const axiosInstance: AxiosInstance = axios.create()
    this.httpService = new HttpService(axiosInstance)
  }

  /**
   * Sends a POST request to the specified URI with the given data.
   *
   * @param {string} uri - The URI to which the POST request will be sent.
   * @param {Object} data - The payload to send in the POST request body.
   */
  public async post(uri: string, data: object): Promise<any> {
    if (uri) {
      try {
        const response = await firstValueFrom(this.httpService.post(uri, data))
        this.logger.log(`[post] Request sent to ${uri}: ${response.status}`)
        return response
      } catch (error) {
        this.logger.error(`[post] Failed to send POST request to ${uri}: ${error.message}`)
      }
    } else {
      this.logger.warn(`[post] URI is not defined, cannot send POST request: ${JSON.stringify(data)}`)
    }
  }

  /**
   * Sends a GET request to the specified URI.
   *
   * @param {string} uri - The URI to which the GET request will be sent.
   * @returns {Promise<any>} - The response data from the GET request.
   */
  public async get(uri: string): Promise<any> {
    if (uri) {
      try {
        const response = await firstValueFrom(this.httpService.get(uri))
        this.logger.log(`[get] Request sent to ${uri}: ${response.status}`)
        return response
      } catch (error) {
        this.logger.error(`[get] Failed to send GET request to ${uri}: ${error.message}`)
        throw error
      }
    } else {
      this.logger.warn(`[get] URI is not defined, cannot send GET request`)
      return null
    }
  }
}
