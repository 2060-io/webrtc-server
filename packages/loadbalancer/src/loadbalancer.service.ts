import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common'
import { HttpRequestService } from './lib/HttpRequestService'
import Redis from 'ioredis'
import { InjectRedis } from '@nestjs-modules/ioredis'
import { AvailableServer, RoomData, RoomResponse, ServerData } from './dto/loadbalancer.dto'

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

      // Construct the URL dynamically based on the presence of roomId
      const url = roomId ? `${bestServer.serviceUrl}/rooms/${roomId}` : `${bestServer.serviceUrl}/rooms`

      // Send a POST request to the selected server to create the room
      const response = await this.httpRequestService.post(url, roomCreationData)

      this.logger.debug(`Response.status: ${response.status}`)

      this.logger.log(
        `[createRoom] Room created successfully on server ${bestServer.serviceUrl}. Response: ${response.status}`,
      )
      // Update the server load
      await this.updateLoadServer(bestServer.serverId, response.data.roomId, maxPeerCount || 2)

      // Return the response containing room details
      return response.data
    } catch (error) {
      this.logger.error(`[createRoom] Error creating or retrieving room: ${error.message}`)
      throw new HttpException({ error: error.message }, HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }

  /**
   * Updates the server load by registering or modifying a room.
   * Reduces the server's available capacity based on the maxPeerCount.
   * @param {string} serverId - The ID of the server.
   * @param {string} roomId - The ID of the room.
   * @param {number} maxPeerCount - The maximum number of peers in the room.
   */
  public async updateLoadServer(serverId: string, roomId: string, maxPeerCount: number): Promise<void> {
    const roomKey = `room:${serverId}:${roomId}`
    const serverKey = `server:${serverId}`

    // Validate maxPeerCount
    if (maxPeerCount <= 0) {
      this.logger.error(`[updateLoadServer] Invalid maxPeerCount (${maxPeerCount}) for room ${roomId}.`)
      throw new HttpException('Invalid maxPeerCount', HttpStatus.BAD_REQUEST)
    }

    // Calculate total consumers for the room
    const totalConsumers = maxPeerCount * (maxPeerCount - 1) * 2

    // Check if server exists
    const exists = await this.redisClient.exists(serverKey)
    if (!exists) {
      this.logger.error(`[updateLoadServer] Server ${serverId} not found.`)
      throw new HttpException('Server not found', HttpStatus.NOT_FOUND)
    }

    // Get current capacity
    const currentCapacity = await this.redisClient.hget(serverKey, 'capacity')
    if (!currentCapacity || Number(currentCapacity) < totalConsumers) {
      this.logger.error(
        `[updateLoadServer] Insufficient capacity on server ${serverId} for room ${roomId}. Required: ${totalConsumers}, Available: ${currentCapacity}`,
      )
      throw new HttpException('Insufficient server capacity', HttpStatus.BAD_REQUEST)
    }

    // Deduct capacity and increment room count
    await this.redisClient.hincrby(serverKey, 'capacity', -totalConsumers)
    await this.redisClient.hincrby(serverKey, 'rooms', 1)

    // Register room details
    await this.redisClient.hset(roomKey, 'peers', maxPeerCount.toString())

    this.logger.log(
      `[updateLoadServer] Room ${roomId} updated on server ${serverId} with ${maxPeerCount} peers. Consumers: ${totalConsumers}`,
    )
  }

  /**
   * Retrieves the server with the most capacity among all available servers that are healthy.
   *
   * @returns {Promise<AvailableServer>} - The healthiest server with the most capacity.
   * @throws {HttpException} - Throws if no healthy servers are available or Redis fails.
   */
  public async getAvailableServers(): Promise<AvailableServer> {
    try {
      this.logger.log('[getAvailableServers] Fetching available healthy servers from Redis.')
      const keys = await this.redisClient.keys('server:*')
      const servers: AvailableServer[] = []

      for (const key of keys) {
        const serverData = await this.redisClient.hgetall(key)

        // Check health status
        if (serverData.health !== 'true') {
          this.logger.warn(`[getAvailableServers] Server ${serverData.serverId} is unhealthy, skipping.`)
          continue
        }

        // Parse and prepare the server data
        const capacity = Number(serverData.capacity)
        const workers = Number(serverData.workers)

        servers.push({
          serverId: key.split(':')[1],
          workers,
          serviceUrl: serverData.serviceUrl,
          capacity,
        })
      }

      if (servers.length === 0) {
        this.logger.warn('[getAvailableServers] No healthy servers available.')
        throw new Error('No healthy servers available.')
      }

      // Find the healthy server with the most capacity
      const serverWithMostCapacity = servers.reduce((max, server) => (server.capacity > max.capacity ? server : max))

      this.logger.log(
        `[getAvailableServers] Selected healthiest server with most capacity: ${JSON.stringify(
          serverWithMostCapacity,
          null,
          2,
        )}`,
      )
      return serverWithMostCapacity
    } catch (error) {
      this.logger.error(`[getAvailableServers] Failed to retrieve healthy servers: ${error.message}`)
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
      if (!servers) {
        this.logger.warn('[getBestServer] No servers available.')
        throw new Error('[getBestServer] No servers available.')
      }

      const bestServer = servers
      this.logger.log(`[getBestServer] Best server selected: ${JSON.stringify(bestServer)}`)
      return bestServer
    } catch (error) {
      this.logger.error(`[getBestServer] Error selecting the best server: ${error.message}`)
      throw new HttpException({ error: error.message }, HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }

  /**
   * Registers a WebRTC server in Redis.
   * If the server is already registered, it removes the old entry before adding the new one.
   * Calculates the server's capacity based on the number of workers and stores it in Redis.
   *
   * @param {ServerData} serverData - The server data to register.
   * @throws {HttpException} - If the server data is invalid.
   */
  public async registerServer(serverData: ServerData): Promise<void> {
    const { serverId, serviceUrl, workers } = serverData

    // Check if the server is already registered
    const key = `server:${serverId}`
    const exists = await this.redisClient.exists(key)

    if (exists) {
      this.logger.warn(`Server ${serverId} is already registered. Removing the old entry.`)
      await this.redisClient.del(key)
    }

    // Calculate maximum capacity based on the number of workers
    const capacity = workers * 500 // 500 consumers per worker

    await this.redisClient.hset(
      key,
      'serviceUrl',
      serviceUrl,
      'capacity',
      capacity.toString(),
      'rooms',
      '0',
      'workers',
      workers.toString(),
      'health',
      'true',
    )

    this.logger.log(`Server registered: ${JSON.stringify({ serverId, serviceUrl, workers, capacity, health: true })}`)
  }

  /**
   * Updates the server load and capacity when a room is closed.
   * @param {RoomData} roomData - The data of the room that was closed.
   */
  public async roomClosed(roomData: RoomData): Promise<void> {
    try {
      const serverKey = `server:${roomData.serverId}`
      const roomKey = `room:${roomData.serverId}:${roomData.roomId}`

      // Check if the server exists
      const serverExists = await this.redisClient.exists(serverKey)
      if (!serverExists) {
        this.logger.error(`[roomClosed] Server ${roomData.serverId} not found in Redis.`)
        throw new HttpException(`Server ${roomData.serverId} not found.`, HttpStatus.NOT_FOUND)
      }

      // Check if the room exists
      const roomExists = await this.redisClient.exists(roomKey)
      if (!roomExists) {
        this.logger.error(`[roomClosed] Room ${roomData.roomId} not found on server ${roomData.serverId}.`)
        throw new HttpException(
          `Room ${roomData.roomId} not found on server ${roomData.serverId}.`,
          HttpStatus.NOT_FOUND,
        )
      }

      // Retrieve the number of peers in the room
      const peerCount = await this.redisClient.hget(roomKey, 'peers')
      if (!peerCount) {
        this.logger.warn(`[roomClosed] Peer count not found for room ${roomData.roomId}. Defaulting to 0.`)
        throw new HttpException(`Peer count not found for room ${roomData.roomId}.`, HttpStatus.BAD_REQUEST)
      }

      // Calculate the total consumers for the room
      const peerCountNum = Number(peerCount)
      if (isNaN(peerCountNum) || peerCountNum <= 0) {
        this.logger.error(`[roomClosed] Invalid peer count: ${peerCount} for room ${roomData.roomId}.`)
        throw new HttpException(`Invalid peer count for room ${roomData.roomId}.`, HttpStatus.BAD_REQUEST)
      }

      const totalConsumers = peerCountNum * (peerCountNum - 1) * 2

      // Restore the server's capacity
      await this.redisClient.hincrby(serverKey, 'capacity', totalConsumers)

      // Update the room count on the server
      const currentRooms = await this.redisClient.hget(serverKey, 'rooms')
      if (!currentRooms) {
        this.logger.warn(`[roomClosed] Room count not found for server ${roomData.serverId}. Defaulting to 0.`)
      } else if (Number(currentRooms) > 0) {
        await this.redisClient.hincrby(serverKey, 'rooms', -1)
        this.logger.log(
          `[roomClosed] Room ${roomData.roomId} closed on server ${roomData.serverId}. Consumers freed: ${totalConsumers}`,
        )
      } else {
        this.logger.warn(`[roomClosed] Room count for server ${roomData.serverId} is already at 0.`)
      }

      // Remove the room data from Redis
      await this.redisClient.del(roomKey)
      this.logger.log(`[roomClosed] Room ${roomData.roomId} removed from Redis.`)
    } catch (error) {
      this.logger.error(
        `[roomClosed] Error closing room ${roomData.roomId} on server ${roomData.serverId}: ${error.message}`,
      )
      throw new HttpException({ error: error.message }, HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }
}
