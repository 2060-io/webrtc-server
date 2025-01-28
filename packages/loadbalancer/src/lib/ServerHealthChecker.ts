import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import Redis from 'ioredis'
import { InjectRedis } from '@nestjs-modules/ioredis'
import { HttpRequestService } from './HttpRequestService'
import { ConfigService } from '@nestjs/config'
import { Server } from 'https'

@Injectable()
export class ServerHealthChecker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ServerHealthChecker.name)
  private readonly interval: number // Interval in milliseconds
  private healthCheckInterval: NodeJS.Timeout

  constructor(
    @InjectRedis() private readonly redisClient: Redis,
    private readonly httpRequestService: HttpRequestService,
    private readonly configService: ConfigService,
  ) {
    // Load interval from environment variables or default to 30 seconds

    this.interval = Number(configService.get('appConfig.healthCheckInterval')) || 30000
  }

  /**
   * Lifecycle hook that starts the health check process when the module is initialized.
   */
  onModuleInit(): void {
    this.logger.log(`Starting health checks every ${this.interval} ms.`)
    this.startHealthChecks()
  }

  /**
   * Lifecycle hook that clears the interval when the module is destroyed.
   */
  onModuleDestroy(): void {
    this.stopHealthChecks()
  }

  /**
   * Starts periodic health checks.
   */
  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.checkAllServers()
      } catch (error) {
        this.logger.error(`Error during health checks: ${error.message}`)
      }
    }, this.interval)
  }

  /**
   * Stops the health check process.
   */
  private stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.logger.log('Health checks stopped.')
    }
  }

  /**
   * Checks the health of all registered servers.
   */
  private async checkAllServers(): Promise<void> {
    this.logger.log('Checking health of all servers.')
    const keys = await this.redisClient.keys('server:*')
    for (const key of keys) {
      const serverData = await this.redisClient.hgetall(key)
      const { url } = serverData

      const serverId = key.split(':')[1]
      this.logger.debug(`ServerId: ${serverId}, URL: ${url}`)

      if (!url) {
        this.logger.warn(`Server ${key.split(':')[1]} has no URL registered.`)
        continue
      }

      try {
        const response = await this.httpRequestService.get(`${url}/rooms/12345`)
        if (response.status === 200) {
          await this.redisClient.hset(key, 'health', 'true')
          this.logger.log(`Server ${serverId} is healthy.`)
        } else {
          throw new Error(`Unexpected response status: ${response.status}`)
        }
      } catch (error) {
        await this.redisClient.hset(key, 'health', 'false')
        this.logger.warn(`Server ${serverId} is unhealthy: ${error.message}`)
      }
    }
  }
}
