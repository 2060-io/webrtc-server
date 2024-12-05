import {
  Injectable,
  Logger,
  InternalServerErrorException,
  HttpException,
  HttpStatus,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common'
import * as mediasoup from 'mediasoup'
import { Room } from '../lib/Room'
import { config } from 'src/config/config.server'
import { v4 as uuidv4 } from 'uuid'
import {
  ConnectBroadcasterTransportDto,
  CreateBroadcasterDataProducerDto,
  CreateBroadcasterDto,
  CreateBroadcasterProducerDto,
  CreateBroadcasterTransportDto,
} from './dto/rooms.dto'

@Injectable()
export class RoomsService {
  private readonly logger = new Logger(RoomsService.name)
  private readonly rooms = new Map<string, Room>()
  private readonly mediasoupWorkers: mediasoup.types.Worker[] = []
  private nextMediasoupWorkerIdx = 0
  private readonly notificationUris = new Map<string, string>()

  constructor() {
    this.initializeMediasoupWorkers()
  }

  /**
   * Initialize Mediasoup workers.
   * Creates the required number of Mediasoup workers as per the configuration.
   * Logs worker initialization and listens for worker failures.
   */
  private async initializeMediasoupWorkers() {
    const numWorkers = config.mediasoup.numWorkers

    this.logger.log(`Initializing ${numWorkers} Mediasoup Workers`)

    for (let i = 0; i < numWorkers; i++) {
      try {
        const worker = await mediasoup.createWorker({
          logLevel: 'debug',
          logTags: ['info', 'ice', 'dtls'],
          rtcMinPort: 40000,
          rtcMaxPort: 49999,
        })

        worker.on('died', () => {
          this.logger.error(`Mediasoup Worker died [pid:${worker.pid}]`)
          process.exit(1) // Terminate the application if a worker fails
        })

        this.mediasoupWorkers.push(worker)
      } catch (error) {
        this.logger.error(`Failed to initialize Mediasoup Worker: ${error.message}`)
        throw new InternalServerErrorException('Failed to initialize Mediasoup workers')
      }
    }
  }

  /**
   * Get the next available Mediasoup worker in a round-robin fashion.
   * Ensures workers are selected evenly for load distribution.
   * @returns {mediasoup.types.Worker} - The selected Mediasoup worker.
   */
  private getNextMediasoupWorker(): mediasoup.types.Worker {
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
    force: boolean
    eventNotificationUri?: string
    maxPeerCount?: number
  }): Promise<Room> {
    const { roomId, force = false, eventNotificationUri, maxPeerCount = 10 } = options

    try {
      // Generate a random roomId if not provided
      const roomIdToUse = roomId ?? this.generateRandomRoomId()

      // Check if the room already exists
      if (this.rooms.has(roomIdToUse)) {
        if (force) {
          this.logger.log(`Recreating room [roomId:${roomIdToUse}]`)
          const existingRoom = this.rooms.get(roomIdToUse)
          existingRoom.close()
          this.rooms.delete(roomIdToUse)
        } else {
          return this.rooms.get(roomIdToUse)
        }
      }

      this.logger.log(`Creating new room [roomId:${roomIdToUse}]`)

      // Retrieve the next available Mediasoup worker
      const worker = this.getNextMediasoupWorker()

      // Create the new room instance
      const room = await Room.create({
        mediasoupWorker: worker,
        roomId: roomIdToUse,
        consumerReplicas: 1, // Adjust as per configuration
        maxPeerCount,
        mediaCodecs: config.mediasoup.routerOptions.mediaCodecs as mediasoup.types.RtpCodecCapability[],
      })

      // Store the room in the rooms map
      this.rooms.set(roomIdToUse, room)

      // Handle room closure
      room.on('close', () => {
        this.rooms.delete(roomIdToUse)
        this.logger.log(`Room closed and removed [roomId:${roomIdToUse}]`)
      })

      // Log the event notification URI if provided
      if (eventNotificationUri) {
        this.logger.log(
          `Room created with eventNotificationUri [roomId:${roomIdToUse}, eventNotificationUri:${eventNotificationUri}]`,
        )
      }

      return room
    } catch (error) {
      this.logger.error(`Failed to create or retrieve room [roomId:${roomId}]: ${error.message}`)
      throw new HttpException(`Failed to create or retrieve room: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR)
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
    try {
      // Generate a random roomId if not provided
      const roomIdToUse = roomId ?? this.generateRandomRoomId()

      // Get WebSocket connection parameters
      const port = config.https.listenPort
      const announcedIp = config.https.ingressHost
      const wsUrl = `wss://${announcedIp}:${port}`

      // Check if the room already exists in notificationUris
      if (this.notificationUris.has(roomIdToUse)) {
        throw new Error(`Room with roomId ${roomIdToUse} already exists.`)
      }

      // Create or retrieve the room
      await this.getOrCreateRoom({ roomId: roomIdToUse, force: false, eventNotificationUri, maxPeerCount })

      // Store the eventNotificationUri associated with the roomId
      if (eventNotificationUri) {
        this.notificationUris.set(roomIdToUse, eventNotificationUri)
      }

      // Build and return the response data
      return {
        protocol: '2060-mediasoup-v1',
        wsUrl,
        roomId: roomIdToUse,
      }
    } catch (error) {
      this.logger.error(`Error creating or retrieving room: ${error.message}`)
      throw new HttpException({ error: error.message }, HttpStatus.INTERNAL_SERVER_ERROR)
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
      this.logger.error(`Failed to create broadcaster in room "${roomId}": ${error.message}`)
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
        `Failed to delete broadcaster with id "${broadcasterId}" from room "${roomId}": ${error.message}`,
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
      throw new Error(`Failed to create broadcaster transport: ${error.message}`)
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
      throw new Error(`Failed to connect broadcaster transport: ${error.message}`)
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
      throw new BadRequestException(`Failed to create broadcaster producer: ${error.message}`)
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
    const room = await this.getOrCreateRoom({ roomId, force: false })
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
   const room = await this.getOrCreateRoom({ roomId, force: false })
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
}
