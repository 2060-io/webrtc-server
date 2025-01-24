import { Test, TestingModule } from '@nestjs/testing'
import { RoomsController } from './rooms.controller'
import { RoomsService } from './rooms.service'
import { HttpException, HttpStatus } from '@nestjs/common'
import { CreateBroadcasterDto, CreateRoomDto } from 'src/rooms/dto/rooms.dto'

describe('RoomsController', () => {
  let controller: RoomsController
  let service: jest.Mocked<RoomsService>

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RoomsController],
      providers: [
        {
          provide: RoomsService,
          useValue: {
            createRoom: jest.fn(),
            getOrCreateRoom: jest.fn(),
            createBroadcaster: jest.fn(),
            deleteBroadcaster: jest.fn(),
            createBroadcasterTransport: jest.fn(),
            connectBroadcasterTransport: jest.fn(),
          },
        },
      ],
    }).compile()

    controller = module.get<RoomsController>(RoomsController)
    service = module.get(RoomsService)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })

  describe('createRoom', () => {
    it('should call service.createRoom and return the result', async () => {
      const roomId = 'room123'
      const createRoomDto: CreateRoomDto = {
        eventNotificationUri: 'http://example.com/notification',
        maxPeerCount: 3,
      }

      const result = {
        protocol: '2060-mediasoup-v1',
        wsUrl: 'wss://example.com:4443',
        roomId: 'room123',
      }

      service.createRoom.mockResolvedValue(result)

      const response = await controller.createRoom(roomId, createRoomDto)

      expect(service.createRoom).toHaveBeenCalledWith(
        roomId,
        createRoomDto.eventNotificationUri,
        createRoomDto.maxPeerCount,
      )
      expect(response).toEqual(result)
    })

    it('should throw an HttpException if service.createRoom fails', async () => {
      const roomId = 'room123'
      const createRoomDto: CreateRoomDto = {
        eventNotificationUri: 'http://example.com/notification',
        maxPeerCount: 3,
      }

      service.createRoom.mockRejectedValue(
        new HttpException('Failed to create room: Test Error', HttpStatus.INTERNAL_SERVER_ERROR),
      )

      await expect(controller.createRoom(roomId, createRoomDto)).rejects.toThrow(HttpException)

      try {
        await controller.createRoom(roomId, createRoomDto)
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException)
        expect(error.message).toBe('Failed to create room: Test Error')
        expect(error.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR)
      }
    })
  })

  describe('getRoom', () => {
    it('should return router RTP capabilities', async () => {
      const roomId = 'room123'
      const capabilities = { codecs: [] }
      const mockRoom = { getRouterRtpCapabilities: jest.fn().mockReturnValue(capabilities) }

      service.getOrCreateRoom.mockResolvedValue(mockRoom as any)

      const response = await controller.getRoom(roomId)

      expect(service.getOrCreateRoom).toHaveBeenCalledWith({ roomId })
      expect(response).toEqual(capabilities)
    })

    it('should throw an HttpException if room retrieval fails', async () => {
      const roomId = 'room123'

      service.getOrCreateRoom.mockRejectedValue(new Error('Test Error'))

      await expect(controller.getRoom(roomId)).rejects.toThrow(HttpException)
    })
  })

  describe('createBroadcaster', () => {
    it('should call service.createBroadcaster and return the result', async () => {
      const roomId = 'room123'
      const createBroadcasterDto: CreateBroadcasterDto = {
        id: 'broadcaster1',
        displayName: 'Broadcaster',
        device: { name: 'Chrome', version: '90' },
        rtpCapabilities: { codecs: [] },
      }

      const result = { id: 'broadcaster1', data: {} }

      service.createBroadcaster.mockResolvedValue(result)

      const response = await controller.createBroadcaster(roomId, createBroadcasterDto)

      expect(service.createBroadcaster).toHaveBeenCalledWith(roomId, createBroadcasterDto)
      expect(response).toEqual(result)
    })
  })

  describe('deleteBroadcaster', () => {
    it('should call service.deleteBroadcaster', async () => {
      const params = { roomId: 'room123', broadcasterId: 'broadcaster1' }

      service.deleteBroadcaster.mockResolvedValue(undefined)

      const response = await controller.deleteBroadcaster(params)

      expect(service.deleteBroadcaster).toHaveBeenCalledWith(params.roomId, params.broadcasterId)
      expect(response).toEqual({ message: 'Broadcaster deleted successfully' })
    })
  })
})
