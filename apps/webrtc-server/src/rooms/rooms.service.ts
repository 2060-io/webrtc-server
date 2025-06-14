import {
  Injectable,
  Logger,
  InternalServerErrorException,
  HttpException,
  HttpStatus,
  NotFoundException,
  BadRequestException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import * as mediasoup from 'mediasoup'
import { Room } from '../lib/Room'
import { config } from '../config/config.server'
import { v4 as uuidv4 } from 'uuid'
import {
  ConnectBroadcasterTransportDto,
  CreateBroadcasterDataProducerDto,
  CreateBroadcasterDto,
  CreateBroadcasterProducerDto,
  CreateBroadcasterTransportDto,
} from './dto/rooms.dto'
import * as protoo from 'protoo-server'
import * as url from 'url'
import { Server } from 'https'
import { NotificationService } from '../lib/notification.service'
import { ConfigService } from '@nestjs/config'

import { getErrorDetails, getErrorMessage } from '../utils/error-utils'

@Injectable()
export class RoomsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RoomsService.name)
  private readonly mediasoupWorkers: mediasoup.types.Worker[] = []
  private nextMediasoupWorkerIdx = 0
  private readonly rooms = new Map<string, Room>()
  private readonly notificationUris = new Map<string, string>()
  private readonly notificationService: NotificationService

  private protooServer: protoo.WebSocketServer
  private httpServer: Server

  constructor(private readonly configService: ConfigService) {
    this.notificationService = new NotificationService()
  }

  async onModuleInit(): Promise<void> {
    await this.initializeMediasoupWorkers()
    this.logger.log('[Protoo-server] WebSocket initializing.')

    this.initServer()

    // Register WebRTC Load Balancer
    if (this.configService.get('appConfig.loadbalancerUrl')) {
      this.registerLoadbalancer()
    }

    //Handle connections from clients
    this.protooServer.on('connectionrequest', (info, accept, reject) => {
      this.logger.log(`[Protoo-server] *** connectionrequest Listener ***`)
      const wsurl = url.parse(info.request.url, true)
      const roomId = wsurl.query['roomId'] as string
      const peerId = wsurl.query['peerId'] as string

      if (!roomId || !peerId) {
        this.logger.warn(`Missing roomId or peerId. Rejecting connection.`)
        reject(400, 'Missing roomId or peerId')
        return
      }

      this.logger.log(
        `protoo connection request [roomId:${roomId}, peerId:${peerId}, address:${info.socket.remoteAddress}, origin:${info.origin}]`,
      )

      this.handleConnection(roomId, peerId, accept)
        .then(() => {
          this.logger.log(`Peer joined [roomId:${roomId}, peerId:${peerId}]`)
        })
        .catch((error) => {
          this.logger.error(
            `Failed to handle connection [roomId:${roomId}, peerId:${peerId}]: ${getErrorMessage(error)}`,
          )
          reject(500, getErrorMessage(error))
        })
    })
  }

  async onModuleDestroy() {
    this.logger.log('Cleaning up resources in RoomsService.')

    // Close Rooms
    await this.closeRooms()

    // Close all Mediasoup Workers
    await this.closeMediasoupWorkers()

    // Stop the Protoo WebSocketServer if it is running
    if (this.protooServer) {
      this.logger.log('Stopping Protoo WebSocketServer.')
      this.protooServer.stop()
    }

    // Remove the global httpServer
    Reflect.deleteProperty(global, 'httpServer')
  }

  /**
   * Initializes the WebSocket server with specific configurations.
   * Sets up the server to listen on the specified port and defines a custom error.
   */
  private async initServer(): Promise<void> {
    try {
      this.httpServer = Reflect.get(global, 'httpServer')

      if (!this.httpServer) {
        this.logger.error(`HTTP server not found. Ensure it is set in main.ts.`)
        throw new Error(`HTTP server not found. Ensure it is set in main.ts.`)
      }

      // Initialize the protoo WebSocket server
      this.protooServer = new protoo.WebSocketServer(this.httpServer, {
        maxReceivedFrameSize: 960000,
        maxReceivedMessageSize: 960000,
        fragmentOutgoingMessages: true,
        fragmentationThreshold: 960000,
      })
      this.logger.log('[Protoo-server] WebSocket initialized.')
    } catch (error) {
      this.logger.error('Error during Protoo server initialization', getErrorDetails(error))
      throw error
    }
  }

  private async registerLoadbalancer(): Promise<void> {
    this.logger.log(`[registerLoadbalancer] WebRTC LoadBalancer mode enabled.`)
    const loadbalancerUrl = `${this.configService.get('appConfig.loadbalancerUrl')}/register`
    const serviceUrl = this.configService.get('appConfig.serviceUrl')

    if (loadbalancerUrl && serviceUrl) {
      const dataRegister = {
        serverId: config.https.ingressHost,
        serviceUrl,
        workers: config.mediasoup.numWorkers,
      }

      try {
        await this.notificationService.post(loadbalancerUrl, dataRegister)
        this.logger.log(`[registerLoadbalancer] Successfully registered WebRTC server with Load Balancer.`)
      } catch (error) {
        this.logger.error(
          `[registerLoadbalancer] Failed to register with WebRTC Load Balancer at ${loadbalancerUrl}: ${getErrorMessage(error)}`,
        )
      }
    } else {
      this.logger.warn(
        `[registerLoadbalancer] LoadBalancer registration skipped: Missing loadbalancerUrl or serviceUrl.`,
      )
    }
  }

  async handleConnection(roomId: string, peerId: string, accept: () => protoo.WebSocketTransport): Promise<void> {
    let room = this.rooms.get(roomId)
    this.logger.debug(`[handleConnection] Initialize room: ${room}`)

    if (!room) {
      this.logger.log(`[handleConnection] Creating new room: ${roomId}`)
      room = await this.getOrCreateRoom({ roomId })
      this.rooms.set(roomId, room)
      this.logger.log(`[handleConnection] has been created room: ${roomId}`)
    }

    //hardcode to initial test
    const eventNotificationUri = this.notificationUris.get(roomId)
    const transport = accept()
    room.handleProtooConnection({ peerId, transport, eventNotificationUri })

    //send notification to eventNotificationUri
    if (eventNotificationUri) {
      const joinNotificationData = {
        roomId,
        peerId,
        event: 'peer-joined',
      }
      await this.notificationService.sendNotification(eventNotificationUri, joinNotificationData)
    }
  }

  /**
   * Initialize Mediasoup workers.
   * Creates the required number of Mediasoup workers as per the configuration.
   * Logs worker initialization and listens for worker failures.
   */
  private async initializeMediasoupWorkers() {
    const numWorkers = config.mediasoup.numWorkers

    this.logger.log(`Initializing ${numWorkers} Mediasoup Workers`)

    const workerSettings = config.mediasoup.workerSettings as mediasoup.types.WorkerSettings

    for (let i = 0; i < numWorkers; i++) {
      try {
        const worker = await mediasoup.createWorker(workerSettings)
        this.logger.log(`Initializing worker ${worker.pid} Mediasoup Workers`)

        worker.on('died', () => {
          this.logger.error(`Mediasoup Worker died [pid:${worker.pid}]`)
          process.exit(1)
        })

        worker.on('subprocessclose', () => {
          this.logger.debug(`Mediasoup Worker subprocessclose [pid:${worker.pid}]`)
        })

        this.mediasoupWorkers.push(worker)
      } catch (error) {
        this.logger.error(`Failed to initialize Mediasoup Worker: ${getErrorMessage(error)}`)
        throw new InternalServerErrorException('Failed to initialize Mediasoup workers')
      }
    }
  }

  /**
   * Closes all active Mediasoup workers.
   *
   * This method iterates over the list of Mediasoup workers, logs the closure process for each worker,
   * and invokes the `close` method to terminate them. After closing, the workers list is cleared.
   *
   * @returns {Promise<void>} Resolves when all workers are closed and the list is cleared.
   */
  private async closeMediasoupWorkers(): Promise<void> {
    this.logger.log(`Close ${this.mediasoupWorkers.length} Mediasoup Workers`)
    this.mediasoupWorkers.forEach((worker) => {
      this.logger.debug(`Closing Mediasoup Worker [pid:${worker.pid}]`)
      worker.close()
    })
    this.mediasoupWorkers.length = 0
  }

  /**
   * Closes all active rooms.
   *
   * This method iterates through all active rooms, logs the closure process for each room,
   * invokes the `close` method on each room to terminate it, and then clears the rooms map.
   *
   * @returns {Promise<void>} Resolves when all rooms are closed and the map is cleared.
   */
  private async closeRooms(): Promise<void> {
    // Close all active rooms
    for (const [roomId, room] of this.rooms.entries()) {
      this.logger.debug(`Closing room [roomId:${roomId}]`)
      room.close()
    }
    this.rooms.clear()
  }

  /**
   * Get the next available Mediasoup worker in a round-robin fashion.
   * Ensures workers are selected evenly for load distribution.
   * @returns {mediasoup.types.Worker} - The selected Mediasoup worker.
   */
  getNextMediasoupWorker(): mediasoup.types.Worker {
    if (this.mediasoupWorkers.length === 0) {
      throw new InternalServerErrorException('No Mediasoup workers are available')
    }

    const worker = this.mediasoupWorkers[this.nextMediasoupWorkerIdx]
    this.nextMediasoupWorkerIdx = (this.nextMediasoupWorkerIdx + 1) % this.mediasoupWorkers.length
    return worker
  }

  /**
   * Retrieves an existing room or creates a new one if it doesn't exist.
   * Handles optional parameters for room customization.
   *
   * @param options - Options for creating or retrieving the room.
   * @param options.roomId - The ID of the room (optional, generates one if not provided).
   * @param options.force - Whether to recreate the room if it already exists (default: false).
   * @param options.eventNotificationUri - The notification URI for events (optional).
   * @param options.maxPeerCount - The maximum number of peers allowed (optional, default: 10).
   * @returns {Promise<Room>} - The room instance.
   */
  async getOrCreateRoom(options: {
    roomId: string
    eventNotificationUri?: string
    maxPeerCount?: number
  }): Promise<Room> {
    const { roomId, eventNotificationUri, maxPeerCount } = options
    this.logger.debug(`[getOrCreateRoom] Start - roomId: ${roomId}, maxPeerCount: ${maxPeerCount ?? 'default'}`)
    try {
      // find roomId exist
      const room = this.rooms.get(roomId)

      // Check if the room already exists
      if (!room) {
        this.logger.log(`[getOrCreateRoom] creating room [roomId:${roomId}]`)

        const mediasoupWorker = this.getNextMediasoupWorker()
        this.logger.debug(`[getOrCreateRoom] Selected Mediasoup Worker for roomId: ${roomId}`)

        // Create the new room instance

        const room = await Room.create({
          mediasoupWorker,
          roomId: roomId,
          consumerReplicas: 0,
          maxPeerCount,
          mediaCodecs: config.mediasoup.routerOptions.mediaCodecs as mediasoup.types.RtpCodecCapability[],
        })

        this.logger.log(`[getOrCreateRoom] Room successfully created - roomId: ${roomId}`)

        this.logger.debug(`*** room has been created ***`)
        // Store the room in the rooms map
        this.rooms.set(roomId, room)
        // Handle room closure
        room.on('close', () => {
          this.rooms.delete(roomId)
          this.logger.log(`Room closed and removed [roomId:${roomId}]`)
        })

        // Log the event notification URI if provided
        if (eventNotificationUri) {
          this.logger.log(
            `Room created with eventNotificationUri [roomId:${roomId}, eventNotificationUri:${eventNotificationUri}]`,
          )
        }
        return room
      }

      return room
    } catch (error) {
      this.logger.error(`Failed to create or retrieve room [roomId:${roomId}]: ${getErrorMessage(error)}`)
      throw new HttpException(
        `Failed to create or retrieve room: ${getErrorMessage(error)}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      )
    }
  }

  /**
   * Delete a room by its ID.
   * @param roomId - The unique identifier of the room to delete.
   */
  deleteRoom(roomId: string): void {
    if (this.rooms.has(roomId)) {
      const room = this.getRoomById(roomId)
      room.close()
      this.rooms.delete(roomId)
      this.logger.log(`Room deleted [roomId:${roomId}]`)
    } else {
      this.logger.warn(`Room not found for deletion [roomId:${roomId}]`)
    }
  }

  /**
   * Create or retrieve a room.
   * Handles the logic for creating or retrieving a room based on the roomId.
   * @param roomId - The ID of the room (optional).
   * @param eventNotificationUri - The notification URI for events (optional).
   * @param maxPeerCount - The maximum number of peers allowed (optional).
   * @returns {Promise<object>} - Room details and WebSocket URL.
   */
  async createRoom(
    roomId?: string,
    eventNotificationUri?: string,
    maxPeerCount?: number,
  ): Promise<{ protocol: string; wsUrl: string; roomId: string }> {
    this.logger.log(
      `[createRoom] Start - roomId: ${roomId ?? 'not provided'}, maxPeerCount: ${maxPeerCount ?? 'default'}`,
    )
    try {
      // Generate a random roomId if not provided
      const roomIdToUse = roomId ?? this.generateRandomRoomId()
      this.logger.debug(`[createRoom] Using roomId: ${roomIdToUse}`)

      // Get WebSocket connection parameters
      const port = config.https.protooPort
      const announcedIp = config.https.ingressHost
      const wsUrl = `wss://${announcedIp}:${port}`
      this.logger.debug(`[createRoom] WebSocket URL: ${wsUrl}`)

      // Check if the room already exists in notificationUris
      if (this.notificationUris.has(roomIdToUse)) {
        this.logger.warn(`[createRoom] Room already exists: ${roomIdToUse}`)
        throw new Error(`Room with roomId ${roomIdToUse} already exists.`)
      }

      // Create or retrieve the room
      this.logger.log(`[createRoom] Calling getOrCreateRoom for roomId: ${roomIdToUse}`)
      await this.getOrCreateRoom({ roomId: roomIdToUse, eventNotificationUri, maxPeerCount })
      this.logger.debug(`[createRoom] Room successfully created or retrieved: ${roomIdToUse}`)

      // Store the eventNotificationUri associated with the roomId
      if (eventNotificationUri) {
        this.notificationUris.set(roomIdToUse, eventNotificationUri)
        this.logger.debug(`[createRoom] Stored eventNotificationUri for roomId: ${roomIdToUse}`)
      }

      // Build and return the response data
      this.logger.debug(`[createRoom] Success - Returning room details for roomId: ${roomIdToUse}`)
      return {
        protocol: '2060-mediasoup-v1',
        wsUrl,
        roomId: roomIdToUse,
      }
    } catch (error) {
      this.logger.error(`[createRoom] Error creating or retrieving room: ${getErrorMessage(error)}`)
      throw new HttpException({ error: getErrorMessage(error) }, HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }

  /**
   * Create a broadcaster in the specified room.
   * @param roomId - ID of the room.
   * @param createBroadcasterDto - DTO with broadcaster details.
   * @returns {Promise<any>} - Details of the created broadcaster.
   */
  async createBroadcaster(roomId: string, createBroadcasterDto: CreateBroadcasterDto): Promise<any> {
    // Check if the room exists
    const room = this.getRoomById(roomId)

    if (!room) {
      this.logger.warn(`Room with id "${roomId}" not found`)
      throw new NotFoundException(`Room with id "${roomId}" not found`)
    }

    // Call the Room's method to create a broadcaster
    try {
      const broadcasterData = await room.createBroadcaster(createBroadcasterDto)
      this.logger.log(`Broadcaster created in room "${roomId}"`)
      return broadcasterData
    } catch (error) {
      this.logger.error(`Failed to create broadcaster in room "${roomId}": ${getErrorMessage(error)}`)
      throw error
    }
  }

  /**
   * Delete a broadcaster from a specific room.
   * @param roomId - ID of the room.
   * @param broadcasterId - ID of the broadcaster to delete.
   */
  async deleteBroadcaster(roomId: string, broadcasterId: string): Promise<void> {
    // Check if the room exists
    const room = this.getRoomById(roomId)
    if (!room) {
      this.logger.warn(`Room with id "${roomId}" not found`)
      throw new NotFoundException(`Room with id "${roomId}" not found`)
    }

    // Attempt to delete the broadcaster
    try {
      room.deleteBroadcaster({ broadcasterId })
      this.logger.log(`Broadcaster with id "${broadcasterId}" deleted from room "${roomId}"`)
    } catch (error) {
      this.logger.error(
        `Failed to delete broadcaster with id "${broadcasterId}" from room "${roomId}": ${getErrorMessage(error)}`,
      )
      throw error
    }
  }

  /**
   * Create a mediasoup Transport associated with a Broadcaster.
   *
   * This function supports creating both `PlainTransport` and `WebRtcTransport`,
   * depending on the type provided in the DTO. It validates that the room and
   * broadcaster exist before proceeding.
   *
   * @param {string} roomId - The ID of the room.
   * @param {string} broadcasterId - The ID of the broadcaster.
   * @param {CreateBroadcasterTransportDto} dto - The data transfer object containing transport details.
   * @returns {Promise<any>} - The created transport details.
   * @throws {NotFoundException} - If the room or broadcaster does not exist.
   * @throws {Error} - If the transport creation fails.
   */
  async createBroadcasterTransport(
    roomId: string,
    broadcasterId: string,
    dto: CreateBroadcasterTransportDto,
  ): Promise<any> {
    // Retrieve the room by its ID
    const room = this.getRoomById(roomId)

    if (!room) {
      throw new NotFoundException(`Room with ID "${roomId}" not found`)
    }

    try {
      // Call the Room class to create the broadcaster transport
      return await room.createBroadcasterTransport({
        broadcasterId,
        type: dto.type,
        rtcpMux: dto.rtcpMux,
        comedia: dto.comedia,
        sctpCapabilities: dto.sctpCapabilities,
      })
    } catch (error) {
      // Throw a generic error if the transport creation fails
      throw new Error(`Failed to create broadcaster transport: ${getErrorMessage(error)}`)
    }
  }

  /**
   * Connects a broadcaster transport.
   *
   * @param roomId - The room ID.
   * @param broadcasterId - The broadcaster ID.
   * @param transportId - The transport ID.
   * @param dto - DTO containing the dtlsParameters.
   */
  async connectBroadcasterTransport(
    roomId: string,
    broadcasterId: string,
    transportId: string,
    dto: ConnectBroadcasterTransportDto,
  ): Promise<void> {
    const room = this.rooms.get(roomId)

    if (!room) {
      throw new NotFoundException(`Room with ID "${roomId}" not found.`)
    }

    try {
      await room.connectBroadcasterTransport({
        broadcasterId,
        transportId,
        dtlsParameters: dto.dtlsParameters,
      })
    } catch (error) {
      throw new Error(`Failed to connect broadcaster transport: ${getErrorMessage(error)}`)
    }
  }

  /**
   * Creates a mediasoup Producer associated to a Broadcaster.
   *
   * @param roomId - The room ID.
   * @param broadcasterId - The broadcaster ID.
   * @param transportId - The transport ID.
   * @param dto - DTO containing the kind and rtpParameters.
   * @returns Producer data.
   */
  async createBroadcasterProducer(
    roomId: string,
    broadcasterId: string,
    transportId: string,
    dto: CreateBroadcasterProducerDto,
  ): Promise<any> {
    const room = this.rooms.get(roomId)

    if (!room) {
      throw new NotFoundException(`Room with ID "${roomId}" not found.`)
    }

    try {
      const producerData = await room.createBroadcasterProducer({
        broadcasterId,
        transportId,
        kind: dto.kind,
        rtpParameters: dto.rtpParameters,
      })

      return producerData
    } catch (error) {
      throw new BadRequestException(`Failed to create broadcaster producer: ${getErrorMessage(error)}`)
    }
  }

  /**
   * Creates a mediasoup Consumer associated with a Broadcaster.
   *
   * @param roomId - The ID of the room.
   * @param broadcasterId - The ID of the Broadcaster.
   * @param transportId - The ID of the Transport where the Consumer will be created.
   * @param producerId - The ID of the Producer to consume.
   * @returns The created Consumer details.
   */
  async createBroadcasterConsumer(
    roomId: string,
    broadcasterId: string,
    transportId: string,
    producerId: string,
  ): Promise<any> {
    const room = this.rooms.get(roomId)

    if (!room) {
      throw new NotFoundException(`Room with id "${roomId}" not found.`)
    }

    return room.createBroadcasterConsumer({
      broadcasterId,
      transportId,
      producerId,
    })
  }

  /**
   * Creates a mediasoup DataConsumer associated with a Broadcaster.
   *
   * @param roomId - The ID of the room.
   * @param broadcasterId - The ID of the Broadcaster.
   * @param transportId - The ID of the Transport where the DataConsumer will be created.
   * @param dataProducerId - The ID of the DataProducer to be consumed.
   * @returns The created DataConsumer details.
   */
  async createBroadcasterDataConsumer(
    roomId: string,
    broadcasterId: string,
    transportId: string,
    dataProducerId: string,
  ): Promise<any> {
    const room = await this.getOrCreateRoom({ roomId })
    return room.createBroadcasterDataConsumer({
      broadcasterId,
      transportId,
      dataProducerId,
    })
  }

  /**
   * Creates a mediasoup DataProducer associated with a Broadcaster.
   *
   * @param roomId - The ID of the room.
   * @param broadcasterId - The ID of the Broadcaster.
   * @param transportId - The ID of the Transport where the DataProducer will be created.
   * @param dto - The DTO containing the DataProducer details.
   * @returns The created DataProducer details.
   */
  async createBroadcasterDataProducer(
    roomId: string,
    broadcasterId: string,
    transportId: string,
    dto: CreateBroadcasterDataProducerDto,
  ): Promise<any> {
    const room = await this.getOrCreateRoom({ roomId })
    return room.createBroadcasterDataProducer({
      broadcasterId,
      transportId,
      label: dto.label,
      protocol: dto.protocol,
      sctpStreamParameters: dto.sctpStreamParameters,
      appData: dto.appData,
    })
  }

  /**
   * Generates a random room ID.
   *
   * @returns {string} - The generated room ID.
   */
  private generateRandomRoomId(): string {
    return uuidv4().slice(0, 8).toLowerCase()
  }

  /**
   * Get an existing room by its ID.
   * @param roomId - ID of the room.
   * @returns {Room | undefined} - The room instance or undefined if not found.
   */
  private getRoomById(roomId: string): Room | undefined {
    return this.rooms.get(roomId)
  }

  /**
   * Returns the health status of the WebRTC server.
   * - If this endpoint is accessible, the server is considered "healthy".
   * - Additional checks (e.g., WebRTC workers, database connections) can be added later.
   *
   * @returns {{ status: string }} - Always returns `{ status: 'ok' }` for now.
   */
  public getHealthStatus(): { status: string } {
    return { status: 'ok' }
  }
}
