import { Injectable, Logger } from '@nestjs/common'
import * as mediasoup from 'mediasoup'
import * as protoo from 'protoo-server'
import { ConfigService } from '@nestjs/config'
import { Room } from '../lib/Room'
import { config } from 'src/config/config.server'
import { WorkerLogLevel, WorkerLogTag } from 'mediasoup/node/lib/types'

@Injectable()
export class WebsocketService {
  private readonly logger = new Logger(WebsocketService.name)
  private readonly rooms = new Map<string, Room>()
  private readonly config = config

  constructor(private readonly configService: ConfigService) {}

  async handleConnection(roomId: string, peerId: string, accept: () => protoo.WebSocketTransport): Promise<void> {
    let room = this.rooms.get(roomId)

    if (!room) {
      this.logger.log(`Creating new room: ${roomId}`)
      const mediasoupWorker = await this.getWorker()
      this.logger.debug(`*** Worker ${mediasoupWorker.pid} ***`)
      room = await Room.create({ mediasoupWorker, roomId })
      this.rooms.set(roomId, room)
    }

    //hardcode to initial test
    const eventNotificationUri = 'http://localhost:3001/'
    const consume = false
    const transport = accept()
    room.handleProtooConnection({ peerId, consume, transport, eventNotificationUri })
  }

  private async getWorker(): Promise<mediasoup.types.Worker> {
    const worker = await mediasoup.createWorker({
      logLevel: this.config.mediasoup.workerSettings.logLevel as WorkerLogLevel,
      logTags: this.config.mediasoup.workerSettings.logTags as WorkerLogTag[],
      rtcMinPort: this.config.mediasoup.workerSettings.rtcMinPort,
      rtcMaxPort: this.config.mediasoup.workerSettings.rtcMaxPort,
    })

    worker.on('died', () => {
      this.logger.error('MediaSoup worker died.')
    })

    return worker
  }
}
