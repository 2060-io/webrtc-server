import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common'
import { HttpRequestService } from './lib/HttpRequestService'
import Redis from 'ioredis'
import { InjectRedis } from '@nestjs-modules/ioredis'
import { AvailableServer, RoomData, RoomResponse, ServerData } from './dto/rooms.dto'

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
      const url = roomId ? `${bestServer.url}/rooms/${roomId}` : `${bestServer.url}/rooms`

      // Send a POST request to the selected server to create the room
      const response = await this.httpRequestService.post(url, roomCreationData)

      // Validate the response
      if (response.status !== 200) {
        this.logger.error(`[createRoom] Failed to create room. Response: ${response} `)
        throw new Error(`[createRoom] Failed to create room on server ${bestServer.url}`)
      }

      this.logger.log(
        `[createRoom] Room created successfully on server ${bestServer.url}. Response: ${response.status}`,
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
   * Retrieves the server with the most capacity among all available servers.
   *
   * @returns {Promise<AvailableServer>} - The server with the most capacity.
   * @throws {HttpException} - Throws if no servers are available or Redis fails.
   */
  public async getAvailableServers(): Promise<AvailableServer> {
    try {
      this.logger.log('[getAvailableServers] Fetching available servers from Redis.')
      const keys = await this.redisClient.keys('server:*')
      const servers: AvailableServer[] = []

      for (const key of keys) {
        const serverData = await this.redisClient.hgetall(key)

        // Parse and prepare the server data
        const capacity = Number(serverData.capacity)
        const workers = Number(serverData.workers)

        servers.push({
          serverId: key.split(':')[1],
          workers,
          url: serverData.url,
          capacity,
        })
      }

      if (servers.length === 0) {
        this.logger.warn('[getAvailableServers] No servers available.')
        throw new Error('No servers available.')
      }

      // Find the server with the most capacity
      const serverWithMostCapacity = servers.reduce((max, server) => (server.capacity > max.capacity ? server : max))

      this.logger.log(
        `[getAvailableServers] Server with the most capacity: ${JSON.stringify(serverWithMostCapacity, null, 2)}`,
      )
      return serverWithMostCapacity
    } catch (error) {
      this.logger.error(`[getAvailableServers] Failed to retrieve servers: ${error.message}`)
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
    const { serverId, url, workers } = serverData

    // Validate input
    if (!serverId || !url || !workers || workers <= 0) {
      this.logger.error('Invalid server data provided for registration.')
      throw new HttpException('Invalid server data', HttpStatus.BAD_REQUEST)
    }

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
      'url',
      url,
      'capacity',
      capacity.toString(),
      'rooms',
      '0',
      'workers',
      workers.toString(),
      'health',
      'true',
    )

    this.logger.log(`Server registered: ${JSON.stringify({ serverId, url, workers, capacity, health: true })}`)
  }

  /**
   * Updates the server load and capacity when a room is closed.
   * @param {RoomData} roomData - The data of the room that was closed.
   */
  public async roomClosed(roomData: RoomData): Promise<void> {
    const serverKey = `server:${roomData.serverId}`
    const roomKey = `room:${roomData.serverId}:${roomData.roomId}`

    // Check if the server exists
    const serverExists = await this.redisClient.exists(serverKey)
    if (!serverExists) {
      this.logger.warn(`[roomClosed] Server ${roomData.serverId} not found in Redis.`)
      return
    }

    // Check if the room exists
    const roomExists = await this.redisClient.exists(roomKey)
    if (!roomExists) {
      this.logger.warn(`[roomClosed] Room ${roomData.roomId} not found on server ${roomData.serverId}.`)
      return
    }

    // Retrieve the number of peers in the room
    const peerCount = await this.redisClient.hget(roomKey, 'peers')
    if (!peerCount) {
      this.logger.warn(`[roomClosed] Peer count not found for room ${roomData.roomId}.`)
      return
    }

    // Calculate the total consumers for the room
    const totalConsumers = Number(peerCount) * (Number(peerCount) - 1) * 2

    // Increment the server capacity
    await this.redisClient.hincrby(serverKey, 'capacity', totalConsumers)

    // Decrement the room count
    const currentRooms = await this.redisClient.hget(serverKey, 'rooms')
    if (Number(currentRooms) > 0) {
      await this.redisClient.hincrby(serverKey, 'rooms', -1)
      this.logger.log(
        `[roomClosed] Room ${roomData.roomId} closed on server ${roomData.serverId}. Consumers freed: ${totalConsumers}`,
      )
    } else {
      this.logger.warn(`[roomClosed] Room count for server ${roomData.serverId} is already 0.`)
    }

    // Remove room data from Redis
    await this.redisClient.del(roomKey)
    this.logger.log(`[roomClosed] Room ${roomData.roomId} removed from Redis.`)
  }
}
