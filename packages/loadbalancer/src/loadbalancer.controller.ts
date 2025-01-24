import { Body, Controller, Get, HttpException, HttpStatus, Logger, Param, Post } from '@nestjs/common'
import { LoadbalancerService } from './loadbalancer.service'
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import { CreateRoomDto } from './dto/rooms.dto'

@Controller()
export class LoadbalancerController {
  private readonly logger = new Logger(LoadbalancerController.name)
  constructor(private readonly loadbalancerService: LoadbalancerService) {}

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
      return await this.loadbalancerService.createRoom(roomId, eventNotificationUri, maxPeerCount)
    } catch (error) {
      this.logger.error(`${error.message}`)
      throw new HttpException(`${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }

  /**
   * Endpoint para registrar un servidor en el balanceador de carga.
   * @param {object} serverData - Información del servidor.
   * @param {string} serverData.serverId - ID único del servidor.
   * @param {string} serverData.url - URL base del servidor.
   * @param {number} serverData.capacity - Capacidad máxima del servidor.
   */
  @Post('register')
  async registerServer(
    @Body() serverData: { serverId: string; url: string; capacity: number },
  ): Promise<{ message: string }> {
    if (!serverData.serverId || !serverData.url || !serverData.capacity) {
      throw new HttpException('Invalid server data', HttpStatus.BAD_REQUEST)
    }

    await this.loadbalancerService.registerServer(serverData)
    return { message: 'Server registered successfully' }
  }

  /**
   * Endpoint para notificar el cierre de una sala en un servidor.
   * @param {object} roomData - Información de la sala.
   * @param {string} roomData.serverId - ID del servidor donde se cerró la sala.
   * @param {string} roomData.roomId - ID de la sala que se cerró.
   */
  @Post('room-closed')
  async notifyRoomClosed(@Body() roomData: { serverId: string; roomId: string }): Promise<{ message: string }> {
    await this.loadbalancerService.roomClosed(roomData)
    return { message: 'Room closed notification processed successfully' }
  }
}
