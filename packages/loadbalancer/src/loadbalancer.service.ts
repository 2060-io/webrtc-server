import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common'
import { HttpRequestService } from './lib/HttpRequestService'
import { ApiResponse } from '@nestjs/swagger'
import Redis from 'ioredis'
import { InjectRedis } from '@nestjs-modules/ioredis'
import { AvailableServer, RoomData, RoomResponse } from './dto/rooms.dto'

@Injectable()
export class LoadbalancerService {
  private readonly logger = new Logger(LoadbalancerService.name)
  private readonly redisClient: Redis

  constructor(
    private readonly httpRequestService: HttpRequestService,
    @InjectRedis() private readonly redis: Redis,
  ) {
    this.redisClient = this.redis.duplicate()
  }
  /**
   * Create or retrieve a room.
   * Handles the logic for creating or retrieving a room based on the `roomId`.
   *
   * @param {string} [roomId] - The ID of the room (optional).
   * @param {string} [eventNotificationUri] - The URI for event notifications (optional).
   * @param {number} [maxPeerCount] - The maximum number of peers allowed (optional).
   * @returns {Promise<RoomResponse>} - Room details and WebSocket URL.
   * @throws {HttpException} - Throws if no servers are available or if the room creation fails.
   */
  public async createRoom(
    roomId?: string,
    eventNotificationUri?: string,
    maxPeerCount?: number,
  ): Promise<RoomResponse> {
    try {
      this.logger.log('[createRoom] Attempting to create or retrieve a room.')

      // Retrieve the best server based on load
      const bestServer = await this.getBestServer()
      if (!bestServer) {
        this.logger.error('[createRoom] No servers available to handle the request.')
        throw new Error('[createRoom] No servers available')
      }

      this.logger.log(`[createRoom] Selected best server: ${JSON.stringify(bestServer)}`)

      // Build the room creation payload
      const roomCreationData = {
        eventNotificationUri,
        maxPeerCount,
      }

      // Send a POST request to the selected server to create the room
      const response = await this.httpRequestService.post(`${bestServer.url}/rooms/${roomId}`, roomCreationData)

      this.logger.log(
        `[createRoom] Room created successfully on server ${bestServer.url}. Response: ${JSON.stringify(response)}`,
      )
      // increment incrementRoomCount
      this.incrementRoomCount(bestServer.serverId)
      // Return the response containing room details
      return response
    } catch (error) {
      this.logger.error(`[createRoom] Error creating or retrieving room: ${error.message}`)
      throw new HttpException({ error: error.message }, HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }

  /**
   * Registers a server in Redis.
   * This method stores server information in Redis for load balancing.
   *
   * @param {object} serverData - The server data to register.
   * @param {string} serverData.serverId - Unique identifier for the server.
   * @param {string} serverData.url - Base URL of the server.
   * @param {number} serverData.capacity - Maximum capacity of the server.
   * @returns {Promise<void>} - Resolves when the server is successfully registered.
   */
  public async registerServer(serverData: { serverId: string; url: string; capacity: number }): Promise<void> {
    try {
      const key = `server:${serverData.serverId}`
      await this.redisClient.hset(key, 'url', serverData.url, 'capacity', serverData.capacity.toString(), 'load', '0')
      this.logger.log(`[registerServer] Server registered successfully: ${JSON.stringify(serverData)}`)
    } catch (error) {
      this.logger.error(`[registerServer] Failed to register server: ${error.message}`)
      throw new HttpException({ error: error.message }, HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }

  /**
   * Increments the number of active rooms for a server.
   * @param {string} serverId - The ID of the server.
   */
  public async incrementRoomCount(serverId: string): Promise<void> {
    const key = `server:${serverId}`
    const exists = await this.redisClient.exists(key)
    if (!exists) {
      this.logger.warn(`[incrementRoomCount] Server ${serverId} not found in Redis.`)
      return
    }
    await this.redisClient.hincrby(key, 'rooms', 1)
    this.logger.log(`[incrementRoomCount] Incremented room count for server ${serverId}.`)
  }

  /**
   * Decrements the number of active rooms for a server.
   * @param {RoomData} roomData - The data of the room that was closed.
   */
  public async roomClosed(roomData: RoomData): Promise<void> {
    const key = `server:${roomData.serverId}`
    const exists = await this.redisClient.exists(key)
    if (!exists) {
      this.logger.warn(`[roomClosed] Server ${roomData.serverId} not found in Redis.`)
      return
    }

    const currentRooms = await this.redisClient.hget(key, 'rooms')
    if (Number(currentRooms) > 0) {
      await this.redisClient.hincrby(key, 'rooms', -1)
      this.logger.log(
        `[roomClosed] Decremented room count for server ${roomData.serverId}. Room ID: ${roomData.roomId}`,
      )
    } else {
      this.logger.warn(`[roomClosed] Room count for server ${roomData.serverId} is already 0.`)
    }
  }

  /**
   * Retrieves the list of available servers sorted by load.
   *
   * @returns {Promise<AvailableServer[]>} - List of servers with their load and capacity.
   * @throws {HttpException} - Throws if Redis fails to retrieve server information.
   */
  public async getAvailableServers(): Promise<AvailableServer[]> {
    try {
      this.logger.log('[getAvailableServers] Fetching available servers from Redis.')
      const keys = await this.redisClient.keys('server:*')
      const servers = []

      for (const key of keys) {
        const serverData = await this.redisClient.hgetall(key)
        servers.push({
          serverId: key.split(':')[1],
          ...serverData,
          capacity: Number(serverData.capacity),
          load: Number(serverData.load),
        })
      }

      // Sort servers by load (load/capacity ratio)
      return servers.sort((a, b) => a.load / a.capacity - b.load / b.capacity)
    } catch (error) {
      this.logger.error(`[getAvailableServers] Failed to retrieve available servers: ${error.message}`)
      throw new HttpException({ error: error.message }, HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }

  /**
   * Retrieves the server with the least load.
   *
   * @returns {Promise<AvailableServer>} - The server with the least load.
   * @throws {HttpException} - Throws if no servers are available.
   */
  public async getBestServer(): Promise<AvailableServer> {
    try {
      const servers = await this.getAvailableServers()
      if (servers.length === 0) {
        this.logger.warn('[getBestServer] No servers available.')
        throw new Error('[getBestServer] No servers available')
      }

      const bestServer = servers[0]
      this.logger.log(`[getBestServer] Best server selected: ${JSON.stringify(bestServer)}`)
      return bestServer
    } catch (error) {
      this.logger.error(`[getBestServer] Error selecting the best server: ${error.message}`)
      throw new HttpException({ error: error.message }, HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }
}
