import { Controller, Get, Post, Param, Body, Delete, HttpException, HttpStatus, Logger, Query } from '@nestjs/common'
import { RoomsService } from './rooms.service'
import {
  ConnectBroadcasterTransportDto,
  CreateBroadcasterConsumerDto,
  CreateBroadcasterDataConsumerDto,
  CreateBroadcasterDataProducerDto,
  CreateBroadcasterDto,
  CreateBroadcasterProducerDto,
  CreateBroadcasterTransportDto,
  CreateRoomDto,
  DeleteBroadcasterDto,
} from './dto/rooms.dto'
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'

@ApiTags('rooms')
@Controller('rooms')
export class RoomsController {
  private readonly logger = new Logger(RoomsController.name)
  private readonly notificationUris = new Map<string, string>()

  constructor(private readonly roomsService: RoomsService) {}

  /**
   * Health check endpoint for the WebRTC Server.
   * - Used by the Load Balancer's `ServerHealthChecker` to verify server availability.
   * - Returns `200 OK` if the WebRTC server is running correctly.
   * - Can be expanded to check additional dependencies (e.g., WebRTC workers, database connections).
   *
   * @returns {Promise<{ status: string }>} - Returns `{ status: 'ok' }` if the server is healthy.
   */
  @Get('health')
  @ApiOperation({ summary: 'Health Check', description: 'Checks if the WebRTC server is running.' })
  @ApiResponse({
    status: 200,
    description: 'The server is healthy.',
    schema: { example: { status: 'ok' } },
  })
  @ApiResponse({
    status: 500,
    description: 'Server error or dependency failure.',
  })
  async checkHealth(): Promise<{ status: string }> {
    this.logger.debug('Health check requested')
    return this.roomsService.getHealthStatus()
  }

  /**
   * Endpoint to create or retrieve a room.
   * Delegates the logic to the RoomsService.
   * @param roomId - The ID of the room (optional).
   * @param createRoomDto - Parameters for room creation (optional).
   * @returns {object} - Room details and WebSocket URL.
   */
  @Post(':roomId?')
  @ApiOperation({ summary: 'Create room' })
  @ApiParam({
    name: 'roomId',
    description: 'Room identifier (optional)',
    required: false,
    example: 'room123',
  })
  @ApiBody({
    description: 'Parameters for room creation',
    schema: {
      type: 'object',
      properties: {
        eventNotificationUri: {
          type: 'string',
          example: 'http://example.com/notification',
        },
        maxPeerCount: {
          type: 'number',
          example: 3,
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Room created or retrieved successfully.',
    schema: {
      example: {
        protocol: '2060-mediasoup-v1',
        wsUrl: 'wss://example.com:4443',
        roomId: '2cc7c7c7',
      },
    },
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error.',
  })
  async createRoom(@Param('roomId') roomId: string, @Body() createRoomDto: CreateRoomDto) {
    const { eventNotificationUri, maxPeerCount } = createRoomDto
    try {
      return await this.roomsService.createRoom(roomId, eventNotificationUri, maxPeerCount)
    } catch (error) {
      this.logger.error(`${error.message}`)
      throw new HttpException(`${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }

  /**
   * Get the RTP capabilities of a room.
   * @param roomId - The ID of the room.
   * @returns {object} The RTP capabilities of the room.
   */
  @Get(':roomId')
  @ApiOperation({ summary: 'Get RTP capabilities of a room' })
  @ApiParam({
    name: 'roomId',
    description: 'Identifier of the room',
    required: true,
    example: 'room123',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved RTP capabilities.',
    schema: {
      example: {
        routerRtpCapabilities: {
          codecs: [
            {
              mimeType: 'audio/opus',
              clockRate: 48000,
              channels: 2,
              parameters: {
                useinbandfec: 1,
              },
            },
          ],
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Room not found.',
  })
  async getRoom(@Param('roomId') roomId: string) {
    try {
      const room = await this.roomsService.getOrCreateRoom({ roomId })
      return room.getRouterRtpCapabilities()
    } catch (error) {
      throw new HttpException(`Failed to get room information: ${error.message}`, HttpStatus.NOT_FOUND)
    }
  }

  /**
   * Add a broadcaster to the room.
   * @param roomId - The ID of the room.
   * @param body - Information about the broadcaster.
   * @returns {object} The created broadcaster.
   */
  @Post(':roomId/broadcasters')
  @ApiOperation({ summary: 'Add a broadcaster to the room' })
  @ApiParam({
    name: 'roomId',
    description: 'Identifier of the room',
    required: true,
    example: 'room123',
  })
  @ApiBody({
    description: 'Broadcaster details',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'broadcaster123' },
        displayName: { type: 'string', example: 'Broadcaster Name' },
        device: {
          type: 'object',
          properties: {
            name: { type: 'string', example: 'Chrome' },
            version: { type: 'string', example: '96.0' },
          },
        },
        rtpCapabilities: {
          type: 'object',
          example: {
            codecs: [
              {
                mimeType: 'audio/opus',
                clockRate: 48000,
                channels: 2,
                parameters: {
                  useinbandfec: 1,
                },
              },
            ],
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Broadcaster added successfully.',
    schema: {
      example: {
        id: 'broadcaster123',
        data: {
          displayName: 'Broadcaster Name',
          device: { name: 'Chrome', version: '96.0', flag: 'broadcaster' },
          rtpCapabilities: {
            codecs: [
              {
                mimeType: 'audio/opus',
                clockRate: 48000,
                channels: 2,
                parameters: { useinbandfec: 1 },
              },
            ],
          },
          transports: {},
          producers: {},
          consumers: {},
          dataProducers: {},
          dataConsumers: {},
        },
      },
    },
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error.',
  })
  async createBroadcaster(@Param('roomId') roomId: string, @Body() createBroadcasterDto: CreateBroadcasterDto) {
    try {
      return await this.roomsService.createBroadcaster(roomId, createBroadcasterDto)
    } catch (error) {
      throw new HttpException(`Failed to create broadcaster: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }

  /**
   * Delete a broadcaster from the room.
   * @param roomId - The ID of the room.
   * @param broadcasterId - The ID of the broadcaster.
   * @returns {object} A success message.
   */
  @Delete(':roomId/broadcasters/:broadcasterId')
  @ApiOperation({ summary: 'Delete a broadcaster from the room' })
  @ApiParam({
    name: 'roomId',
    description: 'Identifier of the room',
    required: true,
    example: 'room123',
  })
  @ApiParam({
    name: 'broadcasterId',
    description: 'Identifier of the broadcaster',
    required: true,
    example: 'broadcaster123',
  })
  @ApiResponse({
    status: 200,
    description: 'Broadcaster deleted successfully.',
    schema: {
      example: { message: 'Broadcaster deleted successfully' },
    },
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error.',
  })
  async deleteBroadcaster(@Param() params: DeleteBroadcasterDto) {
    const { roomId, broadcasterId } = params
    try {
      await this.roomsService.deleteBroadcaster(roomId, broadcasterId)
      return { message: 'Broadcaster deleted successfully' }
    } catch (error) {
      throw new HttpException(`Failed to delete broadcaster: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }

  /**
   * Create a transport for a broadcaster.
   * @param roomId - ID of the room.
   * @param broadcasterId - ID of the broadcaster.
   * @param createBroadcasterTransportDto - DTO containing transport details.
   * @returns Transport details.
   */
  @Post(':roomId/broadcasters/:broadcasterId/transports')
  @ApiOperation({ summary: 'Create a transport for a broadcaster' })
  @ApiParam({ name: 'roomId', description: 'Room identifier', example: 'room123' })
  @ApiParam({ name: 'broadcasterId', description: 'Broadcaster identifier', example: 'broadcaster456' })
  @ApiBody({
    description: 'Details for the transport to be created',
    schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['plain', 'webrtc'], example: 'webrtc' },
        rtcpMux: { type: 'boolean', example: true },
        comedia: { type: 'boolean', example: false },
        sctpCapabilities: {
          type: 'object',
          example: { numStreams: { os: 1024, mis: 1024 } },
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Transport created successfully.',
    schema: {
      example: {
        id: 'transport123',
        iceParameters: {
          usernameFragment: 'randomString',
          password: 'randomPassword',
          iceLite: true,
        },
        iceCandidates: [
          {
            foundation: '12345',
            priority: 100,
            ip: '127.0.0.1',
            protocol: 'udp',
            port: 1234,
            type: 'host',
          },
        ],
        dtlsParameters: {
          fingerprints: [{ algorithm: 'sha-256', value: 'AB:CD:EF...' }],
          role: 'auto',
        },
        sctpParameters: {
          port: 5000,
          os: 1024,
          mis: 1024,
          maxMessageSize: 1048576,
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input data or parameters.',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error.',
  })
  async createBroadcasterTransport(
    @Param('roomId') roomId: string,
    @Param('broadcasterId') broadcasterId: string,
    @Body() createBroadcasterTransportDto: CreateBroadcasterTransportDto,
  ): Promise<any> {
    try {
      // Call service to handle the creation of broadcaster transport
      return await this.roomsService.createBroadcasterTransport(roomId, broadcasterId, createBroadcasterTransportDto)
    } catch (error) {
      throw new HttpException(
        `Failed to create broadcaster transport: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      )
    }
  }

  /**
   * POST API to connect a Transport belonging to a Broadcaster.
   *
   * @param roomId - The room ID.
   * @param broadcasterId - The broadcaster ID.
   * @param transportId - The transport ID.
   * @param dto - DTO containing dtlsParameters.
   */
  @Post(':roomId/broadcasters/:broadcasterId/transports/:transportId/connect')
  @ApiOperation({ summary: 'Connect a broadcaster transport' })
  @ApiParam({ name: 'roomId', description: 'Room identifier', example: 'room123' })
  @ApiParam({ name: 'broadcasterId', description: 'Broadcaster identifier', example: 'broadcaster456' })
  @ApiParam({ name: 'transportId', description: 'Transport identifier', example: 'transport789' })
  @ApiBody({
    description: 'Details for the transport connection',
    schema: {
      type: 'object',
      properties: {
        dtlsParameters: {
          type: 'object',
          example: {
            fingerprints: [{ algorithm: 'sha-256', value: 'AB:CD:EF:...' }],
            role: 'auto',
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Broadcaster transport connected successfully.',
    schema: {
      example: {
        message: 'Broadcaster transport connected successfully',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input data or parameters.',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error.',
  })
  async connectBroadcasterTransport(
    @Param('roomId') roomId: string,
    @Param('broadcasterId') broadcasterId: string,
    @Param('transportId') transportId: string,
    @Body() dto: ConnectBroadcasterTransportDto,
  ): Promise<{ message: string }> {
    try {
      await this.roomsService.connectBroadcasterTransport(roomId, broadcasterId, transportId, dto)
      return { message: 'Broadcaster transport connected successfully' }
    } catch (error) {
      throw new HttpException(
        `Failed to connect broadcaster transport: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      )
    }
  }

  /**
   * POST API to create a mediasoup Producer associated to a Broadcaster.
   *
   * @param roomId - The room ID.
   * @param broadcasterId - The broadcaster ID.
   * @param transportId - The transport ID.
   * @param dto - DTO containing producer details.
   * @returns Producer data.
   */
  @Post(':roomId/broadcasters/:broadcasterId/transports/:transportId/producers')
  @ApiOperation({ summary: 'Create a Producer for a Broadcaster' })
  @ApiParam({ name: 'roomId', description: 'Room identifier', example: 'room123' })
  @ApiParam({
    name: 'broadcasterId',
    description: 'Broadcaster identifier',
    example: 'broadcaster456',
  })
  @ApiParam({
    name: 'transportId',
    description: 'Transport identifier',
    example: 'transport789',
  })
  @ApiBody({
    description: 'Details for the Producer to be created',
    schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', example: 'video', enum: ['audio', 'video'] },
        rtpParameters: {
          type: 'object',
          example: {
            codecs: [
              {
                mimeType: 'video/VP8',
                payloadType: 96,
                clockRate: 90000,
                parameters: {},
                rtcpFeedback: [],
              },
            ],
            encodings: [{ ssrc: 1111 }],
            rtcp: { cname: 'test' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Producer created successfully.',
    schema: {
      example: {
        id: 'producer123',
        kind: 'video',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input data or parameters.',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error.',
  })
  async createBroadcasterProducer(
    @Param('roomId') roomId: string,
    @Param('broadcasterId') broadcasterId: string,
    @Param('transportId') transportId: string,
    @Body() dto: CreateBroadcasterProducerDto,
  ): Promise<any> {
    try {
      const producerData = await this.roomsService.createBroadcasterProducer(roomId, broadcasterId, transportId, dto)
      return producerData
    } catch (error) {
      throw new HttpException(
        `Failed to create broadcaster produces transport: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      )
    }
  }

  /**
   * Creates a mediasoup Consumer associated with a Broadcaster.
   *
   * @param roomId - The ID of the room.
   * @param broadcasterId - The ID of the Broadcaster.
   * @param transportId - The ID of the Transport where the Consumer will be created.
   * @param dto - The DTO containing the Producer ID.
   * @returns The created Consumer details.
   */
  @Post(':roomId/broadcasters/:broadcasterId/transports/:transportId/consume')
  @ApiOperation({
    summary: 'Create a mediasoup Consumer for a Broadcaster',
  })
  @ApiParam({ name: 'roomId', description: 'Room identifier', example: 'room123' })
  @ApiParam({
    name: 'broadcasterId',
    description: 'Broadcaster identifier',
    example: 'broadcaster456',
  })
  @ApiParam({
    name: 'transportId',
    description: 'Transport identifier',
    example: 'transport789',
  })
  @ApiQuery({
    name: 'producerId',
    description: 'The Producer ID to consume',
    example: 'producer123',
  })
  @ApiResponse({
    status: 201,
    description: 'Consumer created successfully.',
    schema: {
      example: {
        data: {
          id: 'consumer456',
          producerId: 'producer123',
          kind: 'video',
          rtpParameters: {
            codecs: [
              {
                mimeType: 'video/VP8',
                payloadType: 96,
                clockRate: 90000,
                parameters: {},
                rtcpFeedback: [],
              },
            ],
            encodings: [{ ssrc: 1111 }],
            rtcp: { cname: 'test' },
          },
          type: 'simple',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input data or parameters.',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error.',
  })
  async createBroadcasterConsumer(
    @Param('roomId') roomId: string,
    @Param('broadcasterId') broadcasterId: string,
    @Param('transportId') transportId: string,
    @Query() dto: CreateBroadcasterConsumerDto,
  ) {
    try {
      const data = await this.roomsService.createBroadcasterConsumer(roomId, broadcasterId, transportId, dto.producerId)
      return { data }
    } catch (error) {
      throw new HttpException(
        `Failed to create broadcaster consumer transport: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      )
    }
  }

  /**
   * Creates a mediasoup DataConsumer associated with a Broadcaster.
   *
   * @param roomId - The ID of the room.
   * @param broadcasterId - The ID of the Broadcaster.
   * @param transportId - The ID of the Transport where the DataConsumer will be created.
   * @param dto - The DTO containing the DataProducer ID.
   * @returns The created DataConsumer details.
   */
  @Post(':roomId/broadcasters/:broadcasterId/transports/:transportId/consume/data')
  @ApiOperation({
    summary: 'Create a mediasoup DataConsumer for a Broadcaster',
  })
  @ApiParam({ name: 'roomId', description: 'Room identifier', example: 'room123' })
  @ApiParam({
    name: 'broadcasterId',
    description: 'Broadcaster identifier',
    example: 'broadcaster456',
  })
  @ApiParam({
    name: 'transportId',
    description: 'Transport identifier',
    example: 'transport789',
  })
  @ApiBody({
    description: 'DTO containing the DataProducer ID.',
    schema: {
      type: 'object',
      properties: {
        dataProducerId: { type: 'string', example: 'dataProducer123' },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'DataConsumer created successfully.',
    schema: {
      example: {
        data: {
          id: 'dataConsumer123',
          streamId: 1,
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input data or parameters.',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error.',
  })
  async createBroadcasterDataConsumer(
    @Param('roomId') roomId: string,
    @Param('broadcasterId') broadcasterId: string,
    @Param('transportId') transportId: string,
    @Body() dto: CreateBroadcasterDataConsumerDto,
  ) {
    try {
      const data = await this.roomsService.createBroadcasterDataConsumer(
        roomId,
        broadcasterId,
        transportId,
        dto.dataProducerId,
      )
      return data
    } catch (error) {
      this.logger.error(`Failed to create DataConsumer: ${error.message}`)
      throw new HttpException(`Failed to create DataConsumer: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR)
    }
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
  @Post(':roomId/broadcasters/:broadcasterId/transports/:transportId/produce/data')
  @ApiOperation({
    summary: 'Create a mediasoup DataProducer for a Broadcaster',
  })
  @ApiParam({ name: 'roomId', description: 'Room identifier', example: 'room123' })
  @ApiParam({
    name: 'broadcasterId',
    description: 'Broadcaster identifier',
    example: 'broadcaster456',
  })
  @ApiParam({
    name: 'transportId',
    description: 'Transport identifier',
    example: 'transport789',
  })
  @ApiBody({
    description: 'DTO containing DataProducer details.',
    schema: {
      type: 'object',
      properties: {
        label: { type: 'string', example: 'chat' },
        protocol: { type: 'string', example: 'udp' },
        sctpStreamParameters: {
          type: 'object',
          properties: {
            streamId: { type: 'number', example: 1 },
          },
        },
        appData: { type: 'object', example: { customField: 'customValue' } },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'DataProducer created successfully.',
    schema: {
      example: {
        status: 200,
        data: {
          id: 'dataProducer123',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input data or parameters.',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error.',
  })
  async createBroadcasterDataProducer(
    @Param('roomId') roomId: string,
    @Param('broadcasterId') broadcasterId: string,
    @Param('transportId') transportId: string,
    @Body() dto: CreateBroadcasterDataProducerDto,
  ) {
    try {
      const data = await this.roomsService.createBroadcasterDataProducer(roomId, broadcasterId, transportId, dto)
      return { status: 200, data }
    } catch (error) {
      throw new HttpException(`Failed to create DataProducer: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }
}
