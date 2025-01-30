import { Injectable, Logger } from '@nestjs/common'
import * as mediasoup from 'mediasoup'
import { Room } from './Room'
import Redis from 'ioredis'
import { InjectRedis } from '@nestjs-modules/ioredis'
import * as protoo from 'protoo-server'

@Injectable()
export class RoomFactory {
  private readonly redisPublisher: Redis
  private readonly redisSubscriber: Redis

  private readonly logger = new Logger(RoomFactory.name)
  constructor(@InjectRedis() private readonly redis: Redis) {
    this.redisPublisher = this.redis.duplicate()
    this.redisSubscriber = this.redis.duplicate()
  }

  async createRoom({
    mediasoupWorker,
    roomId,
    consumerReplicas,
    maxPeerCount,
    mediaCodecs,
  }: {
    mediasoupWorker: mediasoup.types.Worker
    roomId: string
    consumerReplicas?: number
    maxPeerCount?: number
    mediaCodecs?: mediasoup.types.RtpCodecCapability[]
  }): Promise<Room> {
    const protooRoom = new protoo.Room()

    const mediasoupRouter = await mediasoupWorker.createRouter({ mediaCodecs })

    const audioLevelObserver = await mediasoupRouter.createAudioLevelObserver({
      maxEntries: 1,
      threshold: -80,
      interval: 800,
    })

    const activeSpeakerObserver = await mediasoupRouter.createActiveSpeakerObserver()

    this.logger.debug(`*** RoomId: ${roomId}`)

    return new Room({
      roomId,
      protooRoom,
      webRtcServer: mediasoupWorker.appData.webRtcServer,
      mediasoupRouter,
      audioLevelObserver,
      activeSpeakerObserver,
      consumerReplicas,
      maxPeerCount,
    })
  }
}
