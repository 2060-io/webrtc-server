import { Injectable, OnModuleInit, OnModuleDestroy, Logger, HttpServer } from '@nestjs/common'
import * as protoo from 'protoo-server'
import * as url from 'url'
import { WebsocketService } from './websocket.service'
import { Server } from 'http'

@Injectable()
export class WebsocketGateway implements OnModuleInit, OnModuleDestroy {
  private protooServer: protoo.WebSocketServer
  private readonly logger: Logger
  private httpServer: Server

  constructor(private readonly websocketService: WebsocketService) {
    this.logger = new Logger(WebsocketGateway.name)
    this.httpServer = Reflect.get(global, 'httpServer')
  }

  onModuleDestroy() {
    throw new Error('Method not implemented.')
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('WebSocket server initializing.')

    this.initServer()

    this.protooServer.on('connectionrequest', (info, accept, reject) => {
      this.logger.debug(`*** connectionrequest ***`)
      const u = url.parse(info.request.url, true)
      const roomId = u.query['roomId'] as string
      const peerId = u.query['peerId'] as string

      if (!roomId || !peerId) {
        this.logger.warn(`Missing roomId or peerId. Rejecting connection.`)
        reject(400, 'Missing roomId or peerId')
        return
      }

      this.websocketService
        .handleConnection(roomId, peerId, accept)
        .then(() => {
          this.logger.log(`Peer connected [roomId:${roomId}, peerId:${peerId}]`)
        })
        .catch((error) => {
          this.logger.error(`Failed to handle connection [roomId:${roomId}, peerId:${peerId}]: ${error.message}`)
          reject(500, error.message)
        })
    })

    this.logger.log('WebSocket Protoo server initialized.')
  }

  /**
   * Initializes the WebSocket server with specific configurations.
   * Sets up the server to listen on the specified port and defines a custom error.
   */
  private initServer(): void {
    try {
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
    } catch (error) {
      this.logger.error('Error during Protoo server initialization', error.stack)
      throw error
    }
  }

  /**
   * Sets up event listeners for Protoo server events like connectionrequest.
   */
  private listenersEvent(): void {
    try {
      this.protooServer.on('connectionrequest', (info, accept, reject) => {
        this.logger.debug(`*** connectionrequest ***`)
        const u = url.parse(info.request.url, true)
        const roomId = u.query['roomId'] as string
        const peerId = u.query['peerId'] as string

        if (!roomId || !peerId) {
          this.logger.warn(`Missing roomId or peerId. Rejecting connection.`)
          reject(400, 'Missing roomId or peerId')
          return
        }

        this.websocketService
          .handleConnection(roomId, peerId, accept)
          .then(() => {
            this.logger.log(`Peer connected [roomId:${roomId}, peerId:${peerId}]`)
          })
          .catch((error) => {
            this.logger.error(
              `Failed to handle connectionrequest [roomId:${roomId}, peerId:${peerId}]: ${error.message}`,
            )
            reject(500, error.message)
          })
      })
    } catch (error) {
      this.logger.error('Error setting up event listeners', error.stack)
      throw error
    }
  }
}
