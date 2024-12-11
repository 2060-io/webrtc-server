import * as fs from 'fs'
import { RoomsService } from './rooms.service'
import { Room } from '../lib/Room'
import * as mediasoup from 'mediasoup'
import * as protoo from 'protoo-server'
import { Test } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { HttpException, HttpStatus } from '@nestjs/common'
import * as url from 'url'

jest.mock('../lib/Room', () => ({
  Room: {
    create: jest.fn(),
  },
}))

jest.mock('protoo-server')

jest.mock('mediasoup', () => ({
  createWorker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
  })),
}))

jest.mock('protoo-server', () => ({
  WebSocketServer: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
  })),
}))

describe('RoomsService', () => {
  let service: RoomsService
  let loggerErrorSpy: jest.SpyInstance
  let loggerLogSpy: jest.SpyInstance
  let mockHttpsServer: any

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [RoomsService, ConfigService],
    }).compile()

    service = module.get<RoomsService>(RoomsService)

    loggerErrorSpy = jest.spyOn(service['logger'], 'error').mockImplementation()
    loggerLogSpy = jest.spyOn(service['logger'], 'log').mockImplementation()

    jest.spyOn(service, 'getNextMediasoupWorker').mockReturnValue({} as mediasoup.types.Worker)
  })

  afterEach(() => {
    jest.clearAllMocks()
    Reflect.deleteProperty(global, 'httpServer')
  })

  describe('createRoom', () => {
    it('should create a new room and return its details', async () => {
      const mockRoom = { on: jest.fn() }
      const options = {
        roomId: 'newRoomId',
        eventNotificationUri: 'http://example.com/notification',
        maxPeerCount: 10,
      }

      service['getOrCreateRoom'] = jest.fn().mockResolvedValue(mockRoom)

      const result = await service.createRoom(options.roomId, options.eventNotificationUri, options.maxPeerCount)

      expect(service['getOrCreateRoom']).toHaveBeenCalledWith(options)
      expect(result).toEqual({
        protocol: '2060-mediasoup-v1',
        wsUrl: expect.any(String),
        roomId: options.roomId,
      })
    })

    it('should throw an error if the room already exists in notificationUris', async () => {
      const mockRoomId = 'existingRoomId'
      const mockEventNotificationUri = 'http://example.com'
      service['notificationUris'].set(mockRoomId, mockEventNotificationUri)

      await expect(service.createRoom(mockRoomId, mockEventNotificationUri, 5)).rejects.toThrow(HttpException)

      await expect(service.createRoom(mockRoomId, mockEventNotificationUri, 5)).rejects.toMatchObject({
        response: { error: `Room with roomId ${mockRoomId} already exists.` },
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      })

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        `Error creating or retrieving room: Room with roomId ${mockRoomId} already exists.`,
      )
    })
  })

  describe('getOrCreateRoom', () => {
    it('should create a new room if it does not exist', async () => {
      const mockRoom = {
        on: jest.fn(),
      }
      const roomId = 'newRoomId'
      const options = {
        roomId,
        eventNotificationUri: 'http://example.com/notification',
        maxPeerCount: 10,
      }

      ;(Room.create as jest.Mock).mockResolvedValue(mockRoom)

      const result = await service.getOrCreateRoom(options)

      expect(Room.create).toHaveBeenCalledWith({
        mediasoupWorker: expect.any(Object),
        roomId,
        consumerReplicas: 0,
        maxPeerCount: options.maxPeerCount,
        mediaCodecs: expect.any(Array),
      })
      expect(result).toBe(mockRoom)
      expect(loggerLogSpy).toHaveBeenCalledWith(`[getOrCreateRoom] creating room [roomId:${roomId}]`)
    })

    it('should retrieve an existing room', async () => {
      const mockRoom = { id: 'existingRoomId' }
      const roomId = 'existingRoomId'

      service['rooms'].set(roomId, mockRoom as unknown as Room)

      const result = await service.getOrCreateRoom({ roomId })

      expect(Room.create).not.toHaveBeenCalled()
      expect(result).toBe(mockRoom)
    })

    it('should log an error and throw HttpException if room creation fails', async () => {
      const roomId = 'failedRoomId'
      const options = { roomId }

      ;(Room.create as jest.Mock).mockRejectedValue(new Error('Test Error'))

      await expect(service.getOrCreateRoom(options)).rejects.toThrow('Failed to create or retrieve room: Test Error')

      expect(loggerErrorSpy).toHaveBeenCalledWith(`Failed to create or retrieve room [roomId:${roomId}]: Test Error`)
    })
  })
})

describe('RoomsService - initServer Protoo', () => {
  let service: RoomsService
  let loggerErrorSpy: jest.SpyInstance
  let loggerLogSpy: jest.SpyInstance
  let mockHttpsServer: any

  beforeEach(async () => {
    const mockHttpsOptions = {
      key: 'mockKey',
      cert: 'mockCert',
    }

    // Mock the HTTPS server creation
    mockHttpsServer = {
      listen: jest.fn(),
    }

    jest.spyOn(fs, 'readFileSync').mockImplementation((path) => {
      const pathString = path as string
      if (pathString.includes('privkey')) return mockHttpsOptions.key
      if (pathString.includes('fullchain')) return mockHttpsOptions.cert
      throw new Error('Unexpected file path')
    })

    Reflect.set(global, 'httpServer', mockHttpsServer)

    const module = await Test.createTestingModule({
      providers: [RoomsService],
    }).compile()

    service = module.get<RoomsService>(RoomsService)

    // Spies for logger
    loggerErrorSpy = jest.spyOn(service['logger'], 'error').mockImplementation()
    loggerLogSpy = jest.spyOn(service['logger'], 'log').mockImplementation()
  })

  afterEach(() => {
    jest.clearAllMocks()
    Reflect.deleteProperty(global, 'httpServer')
  })

  it('should initialize the WebSocket server successfully and log the success message', () => {
    service['initServer']()

    // Validate that the WebSocket server was initialized with the correct parameters
    expect(protoo.WebSocketServer).toHaveBeenCalledWith(mockHttpsServer, {
      maxReceivedFrameSize: 960000,
      maxReceivedMessageSize: 960000,
      fragmentOutgoingMessages: true,
      fragmentationThreshold: 960000,
    })

    // Validate that the success log was called
    expect(loggerLogSpy).toHaveBeenCalledTimes(1)
    expect(loggerLogSpy).toHaveBeenCalledWith('[Protoo-server] WebSocket initialized.')
  })
  describe('onModuleInit', () => {
    it('should initialize the WebSocket server and handle connection requests', async () => {
      const mockOn = jest.fn()
      const mockProtooServer = {
        on: mockOn,
      }

      jest.spyOn(protoo, 'WebSocketServer').mockReturnValue(mockProtooServer as any)
      jest.spyOn(url, 'parse').mockReturnValue({
        query: {
          roomId: 'testRoom',
          peerId: 'testPeer',
        },
      } as any)

      const mockAccept = jest.fn()
      const mockReject = jest.fn()

      await service.onModuleInit()

      expect(loggerLogSpy).toHaveBeenCalledWith('[Protoo-server] WebSocket initializing.')
      expect(mockOn).toHaveBeenCalledWith('connectionrequest', expect.any(Function))

      const connectionRequestHandler = mockOn.mock.calls[0][1]

      await connectionRequestHandler(
        {
          request: { url: '/?roomId=testRoom&peerId=testPeer' },
          socket: { remoteAddress: '127.0.0.1' },
          origin: 'testOrigin',
        },
        mockAccept,
        mockReject,
      )

      expect(loggerLogSpy).toHaveBeenCalledWith(
        `protoo connection request [roomId:testRoom, peerId:testPeer, address:127.0.0.1, origin:testOrigin]`,
      )
    })

    it('should log an error if handleConnection fails', async () => {
      const mockOn = jest.fn()
      const mockProtooServer = {
        on: mockOn,
      }

      jest.spyOn(protoo, 'WebSocketServer').mockReturnValue(mockProtooServer as any)
      jest.spyOn(url, 'parse').mockReturnValue({
        query: {
          roomId: 'testRoom',
          peerId: 'testPeer',
        },
      } as any)

      const mockAccept = jest.fn()
      const mockReject = jest.fn()

      jest.spyOn(service, 'handleConnection').mockRejectedValue(new Error('Test Error'))

      await service.onModuleInit()

      const connectionRequestHandler = mockOn.mock.calls[0][1]

      await connectionRequestHandler(
        {
          request: { url: '/?roomId=testRoom&peerId=testPeer' },
          socket: { remoteAddress: '127.0.0.1' },
          origin: 'testOrigin',
        },
        mockAccept,
        mockReject,
      )

      await new Promise((resolve) => setImmediate(resolve))

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Failed to handle connection [roomId:testRoom, peerId:testPeer]: Test Error',
      )
      expect(mockReject).toHaveBeenCalledWith(500, 'Test Error')
    })
  })
})
