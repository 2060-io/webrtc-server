import { Body, Controller, Post, HttpException, HttpStatus, Logger, Param } from '@nestjs/common'
import { LoadbalancerService } from './loadbalancer.service'
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import { CreateRoomDto, ServerData } from './dto/loadbalancer.dto'

@ApiTags('Load Balancer')
@Controller()
export class LoadbalancerController {
  private readonly logger = new Logger(LoadbalancerController.name)

  constructor(private readonly loadbalancerService: LoadbalancerService) {}

  /**
   * Endpoint to create or retrieve a room.
   * Delegates the logic to the LoadbalancerService.
   * @param {string} roomId - The ID of the room (optional).
   * @param {CreateRoomDto} createRoomDto - Parameters for room creation.
   * @returns {object} - Room details and WebSocket URL.
   */
  @Post('rooms/:roomId?')
  @ApiOperation({ summary: 'Create or retrieve a room' })
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
        eventNotificationUri: { type: 'string', example: 'http://example.com/notification' },
        maxPeerCount: { type: 'number', example: 3 },
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
      return await this.loadbalancerService.createRoom(roomId, eventNotificationUri, maxPeerCount)
    } catch (error) {
      this.logger.error(`Error createRoom: ${error.message}`)
      throw new HttpException(`Error createRoom: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }

  /**
   * Endpoint to register a server with the load balancer.
   * Registers the server and calculates its capacity based on the workers provided.
   * @param {ServerData} serverData - Server information.
   * @returns {Promise<object>} - A success message indicating the server was registered.
   */
  @Post('register')
  @ApiOperation({ summary: 'Register a server' })
  @ApiBody({
    description: 'Server registration data',
    schema: {
      type: 'object',
      properties: {
        serverId: { type: 'string', example: 'server-12345' },
        url: { type: 'string', example: 'http://example.com' },
        workers: { type: 'number', example: 4 },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Server registered successfully.',
    schema: {
      example: { message: 'Server registered successfully' },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid server data.',
  })
  async registerServer(@Body() serverData: ServerData): Promise<{ message: string }> {
    try {
      await this.loadbalancerService.registerServer(serverData)
      return { message: 'Server registered successfully' }
    } catch (error) {
      this.logger.error(`Error registerServer: ${error.message}`)
      throw new HttpException(`Error registerServer: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }

  /**
   * Endpoint to notify the closure of a room on a server.
   * Updates the server load and removes the room from Redis.
   * @param {object} roomData - Room information.
   * @param {string} roomData.serverId - The ID of the server where the room was closed.
   * @param {string} roomData.roomId - The ID of the room that was closed.
   * @returns {Promise<object>} - A success message indicating the notification was processed.
   */
  @Post('room-closed')
  @ApiOperation({ summary: 'Notify room closure' })
  @ApiBody({
    description: 'Room closure data',
    schema: {
      type: 'object',
      properties: {
        serverId: { type: 'string', example: 'server-12345' },
        roomId: { type: 'string', example: 'room-67890' },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Room closed notification processed successfully.',
    schema: {
      example: { message: 'Room closed notification processed successfully' },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Server or room not found.',
  })
  async notifyRoomClosed(@Body() roomData: { serverId: string; roomId: string }): Promise<{ message: string }> {
    try {
      await this.loadbalancerService.roomClosed(roomData)
      return { message: 'Room closed notification processed successfully' }
    } catch (error) {
      this.logger.error(`Error notifyRoomClosed: ${error.message}`)
      throw new HttpException(`Error notifyRoomClosed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }
}
