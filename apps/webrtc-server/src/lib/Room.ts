import { EventEmitter } from 'events'
import * as protoo from 'protoo-server'
import * as mediasoup from 'mediasoup'
import { Injectable, Logger } from '@nestjs/common'
import { NotificationService } from './notification.service'
import { TransportAppData, BweTraceInfo } from './room.interfaces'
import { config } from '../config/config.server'
import { Device } from './room.interfaces'
import * as throttle from '@sitespeed.io/throttle'
import { Producer } from 'mediasoup/node/lib/types'
import { getErrorMessage } from '../utils/error-utils'

@Injectable()
export class Room extends EventEmitter {
  private readonly logger = new Logger(Room.name)
  private readonly protooRoom: protoo.Room
  public readonly mediasoupRouter: mediasoup.types.Router
  private readonly audioLevelObserver: mediasoup.types.AudioLevelObserver
  private readonly activeSpeakerObserver: mediasoup.types.ActiveSpeakerObserver
  private readonly peers = new Map<string, protoo.Peer>()
  private readonly notificationService: NotificationService
  private readonly broadcasters = new Map<string, any>()
  private readonly consumerReplicas: number
  private readonly maxPeerCount: number
  private readonly roomId: string
  private readonly webRtcServer: any
  private networkThrottled: boolean
  private closed = false

  static async create({
    mediasoupWorker,
    roomId,
    consumerReplicas,
    maxPeerCount,
    mediaCodecs,
  }: {
    mediasoupWorker: mediasoup.types.Worker
    roomId: string
    webRtcServer?: any
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

  constructor({
    roomId,
    protooRoom,
    webRtcServer,
    mediasoupRouter,
    audioLevelObserver,
    activeSpeakerObserver,
    consumerReplicas,
    maxPeerCount,
  }: {
    roomId: string
    protooRoom: protoo.Room
    webRtcServer: any
    mediasoupRouter: mediasoup.types.Router
    audioLevelObserver: mediasoup.types.AudioLevelObserver
    activeSpeakerObserver: mediasoup.types.ActiveSpeakerObserver
    consumerReplicas: number
    maxPeerCount?: number
  }) {
    super()

    this.setMaxListeners(Infinity)

    this.roomId = roomId
    this.protooRoom = protooRoom
    this.mediasoupRouter = mediasoupRouter
    this.audioLevelObserver = audioLevelObserver
    this.activeSpeakerObserver = activeSpeakerObserver
    this.consumerReplicas = consumerReplicas || 0
    this.maxPeerCount = maxPeerCount || 2
    this.webRtcServer = webRtcServer
    this.networkThrottled = false
    this.notificationService = new NotificationService()
  }

  close(): void {
    this.logger.debug(`[Close] Initialize Close Room.`)
    this.closed = true

    this.protooRoom.close()
    this.mediasoupRouter.close()
    this.audioLevelObserver.close()
    this.activeSpeakerObserver.close()

    this.emit('close')

    // Stop network throttling.
    if (this.networkThrottled) {
      this.logger.debug('close() | stopping network throttle')

      throttle.stop().catch((error: any) => {
        this.logger.error(`close() | failed to stop network throttle:${error}`)
      })
    }
    this.logger.log(`[Close] Room ${this.roomId} closed.`)
  }

  handleProtooConnection({
    peerId,
    consume,
    transport,
    eventNotificationUri,
  }: {
    peerId: string
    consume?: boolean
    transport: protoo.WebSocketTransport
    eventNotificationUri?: string
  }): void {
    this.logger.debug(`*** [handleProtooConnection] Initialize ***`)

    if (this.closed) {
      transport.close()
      return
    }

    if (this.protooRoom.peers.length >= this.maxPeerCount) {
      this.logger.warn(`Room is full, rejecting peer [roomId:${this.roomId}, peerId:${peerId}]`)
      transport.close()
      return
    }

    const existingPeer = this.protooRoom.getPeer(peerId)
    if (existingPeer) {
      existingPeer.close()
    }

    const peer = this.protooRoom.createPeer(peerId, transport)
    this.peers.set(peerId, peer)

    // Use the peer.data object to store mediasoup related objects.

    // Not joined after a custom protoo 'join' request is later received.
    peer.data.consume = consume
    peer.data.joined = false
    peer.data.displayName = undefined
    peer.data.device = undefined
    peer.data.rtpCapabilities = undefined
    peer.data.sctpCapabilities = undefined

    // Have mediasoup related maps ready even before the Peer joins since we
    // allow creating Transports before joining.
    peer.data.transports = new Map()
    peer.data.producers = new Map()
    peer.data.consumers = new Map()
    peer.data.dataProducers = new Map()
    peer.data.dataConsumers = new Map()

    peer.on('request', async (request, accept, reject) => {
      this.logger.log(`protoo Peer "request" event [${request.method}, peerId:${peerId}]`)
      try {
        await this.handlePeerRequest(peer, request, accept, reject)
      } catch (error) {
        this.logger.error(
          `Failed to handle request [peerId:${peerId}, method:${request.method}]: ${getErrorMessage(error)}`,
        )
        reject(error instanceof Error ? error : new Error(getErrorMessage(error)))
      }
    })

    peer.on('close', async () => {
      if (this.closed) return

      this.logger.log(`protoo Peer "close" event [peerId: ${peer.id}]`)

      // send notification webhook if eventNotificationUri is defined
      if (eventNotificationUri) {
        const joinNotificationData = {
          roomId: this.roomId,
          peerId: peer.id,
          event: 'peer-left',
        }

        await this.notificationService.sendNotification(eventNotificationUri, joinNotificationData)
      }

      // If the Peer was joined, notify all Peers.
      if (peer.data.joined) {
        for (const otherPeer of this.getJoinedPeers({ excludePeer: peer })) {
          otherPeer.notify('peerClosed', { peerId: peer.id }).catch(() => {})
        }
      }

      // Iterate and close all mediasoup Transport associated to this Peer, so all
      // its Producers and Consumers will also be closed.
      for (const transport of peer.data.transports.values()) {
        transport.close()
      }

      // If this is the latest Peer in the room, close the room.
      if (this.protooRoom.peers.length === 0) {
        this.logger.log(`last Peer in the room left, closing the room [roomId:${this.roomId}]`)

        // if LOADBALANCER_URL when the latest Peer leave room send notification POST room-closed
        if (process.env.LOADBALANCER_URL) {
          this.logger.debug(`**Send notification room-closed loadBalancer***`)
          const loadbalancerUrl = `${process.env.LOADBALANCER_URL}/room-closed`
          await this.notificationService.post(loadbalancerUrl, {
            serverId: config.https.ingressHost,
            roomId: this.roomId,
          })
          this.logger.debug(`**Send notification room-closed has been succesful***`)
        }

        this.close()
      }
    })
  }

  private async handlePeerRequest(
    peer: protoo.Peer,
    request: protoo.ProtooRequest,
    accept: (response?: any) => void,
    reject: (response?: any) => void,
  ): Promise<void> {
    this.logger.debug(`Request ${request.method} from peer ${JSON.stringify(peer.id, null, 1)}`)
    switch (request.method) {
      case 'getRouterRtpCapabilities': {
        accept(this.mediasoupRouter.rtpCapabilities)
        break
      }
      case 'join': {
        // Ensure the Peer is not already joined.
        if (peer.data.joined) throw new Error('Peer already joined')

        const { displayName, device, rtpCapabilities, sctpCapabilities } = request.data

        // Store client data into the protoo Peer data object.
        peer.data.joined = true
        peer.data.displayName = displayName
        peer.data.device = device
        peer.data.rtpCapabilities = rtpCapabilities
        peer.data.sctpCapabilities = sctpCapabilities

        // Tell the new Peer about already joined Peers.
        // And also create Consumers for existing Producers.

        const joinedPeers = [...this.getJoinedPeers(), ...this.broadcasters.values()]

        // Reply now the request with the list of joined peers (all but the new one).
        const peerInfos = joinedPeers
          .filter((joinedPeer) => joinedPeer.id !== peer.id)
          .map((joinedPeer) => ({
            id: joinedPeer.id,
            displayName: joinedPeer.data.displayName,
            device: joinedPeer.data.device,
          }))

        accept({ peers: peerInfos })

        // Mark the new Peer as joined.
        peer.data.joined = true

        for (const joinedPeer of joinedPeers) {
          // Create Consumers for existing Producers.
          for (const producer of joinedPeer.data.producers.values()) {
            this.createConsumer({
              consumerPeer: peer,
              producerPeer: joinedPeer,
              producer,
            })
          }

          // Create DataConsumers for existing DataProducers.
          for (const dataProducer of joinedPeer.data.dataProducers.values()) {
            if (dataProducer.label === 'bot') continue

            this.createDataConsumer({
              dataConsumerPeer: peer,
              dataProducerPeer: joinedPeer,
              dataProducer,
            })
          }
        }

        // Create DataConsumers for bot DataProducer.
        //this._createDataConsumer({
        //  dataConsumerPeer: peer,
        //  dataProducerPeer: null,
        //  dataProducer: this.bot.dataProducer,
        //})

        // Notify the new Peer to all other Peers.
        for (const otherPeer of this.getJoinedPeers({ excludePeer: peer })) {
          otherPeer
            .notify('newPeer', {
              id: peer.id,
              displayName: peer.data.displayName,
              device: peer.data.device,
            })
            .catch(() => {})
        }

        break
      }
      case 'createWebRtcTransport': {
        // NOTE: Don't require that the Peer is joined here, so the client can
        // initiate mediasoup Transports and be ready when he later joins.

        const { forceTcp, producing, consuming, sctpCapabilities } = request.data

        // Define options of WebrtcTransport
        const webRtcTransportOptions: mediasoup.types.WebRtcTransportOptions = {
          listenIps: config.mediasoup.webRtcTransportOptions.listenIps.map((listenIp) => ({
            ip: listenIp.ip,
            announcedIp: listenIp.announcedIp || undefined,
          })),
          enableUdp: true,
          enableTcp: true,
          preferUdp: !forceTcp,
          preferTcp: forceTcp,
          initialAvailableOutgoingBitrate: config.mediasoup.webRtcTransportOptions.initialAvailableOutgoingBitrate,
          enableSctp: Boolean(sctpCapabilities),
          numSctpStreams: sctpCapabilities ? sctpCapabilities.numStreams : undefined,
          appData: { producing, consuming },
        }

        let transport: mediasoup.types.WebRtcTransport
        try {
          transport = await this.mediasoupRouter.createWebRtcTransport({
            ...webRtcTransportOptions,
            //webRtcServer: this.webRtcServer as mediasoup.types.WebRtcServer,
          })
        } catch (error) {
          this.logger.error(`Failed to create WebRtcTransport: ${error}`)
          reject('Failed to create WebRtcTransport')
          return
        }

        transport.on('sctpstatechange', (sctpState) => {
          this.logger.debug(`WebRtcTransport "sctpstatechange" event [sctpState:${sctpState}]`)
        })

        transport.on('dtlsstatechange', (dtlsState) => {
          if (dtlsState === 'failed' || dtlsState === 'closed') {
            this.logger.warn(`WebRtcTransport "dtlsstatechange" event [dtlsState:${dtlsState}]`)
          }
        })

        // NOTE: For testing.
        await transport.enableTraceEvent(['bwe'])

        transport.on('trace', (trace: mediasoup.types.TransportTraceEventData) => {
          this.logger.debug(
            `transport "trace" event [transportId:${transport.id}, trace.type:${trace.type}, trace:${trace}]`,
          )

          // Asegurarse de que la propiedad `info` tenga el tipo correcto.
          if (trace.type === 'bwe' && trace.direction === 'out' && trace.info) {
            const { desiredBitrate, effectiveDesiredBitrate, availableBitrate } = trace.info as BweTraceInfo

            peer
              .notify('downlinkBwe', {
                desiredBitrate,
                effectiveDesiredBitrate,
                availableBitrate,
              })
              .catch(() => {})
          }
        })

        // Store the WebRtcTransport into the protoo Peer data Object.
        if (!peer.data.transports) {
          peer.data.transports = new Map()
        }

        peer.data.transports.set(transport.id, transport)

        accept({
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
          sctpParameters: transport.sctpParameters,
          iceServers: config.iceServers,
        })

        const { maxIncomingBitrate } = config.mediasoup.webRtcTransportOptions

        // If set, apply max incoming bitrate limit.
        if (maxIncomingBitrate) {
          try {
            await transport.setMaxIncomingBitrate(maxIncomingBitrate)
          } catch (error) {
            this.logger.warn(`Failed to set max incoming bitrate: ${error}`)
          }
        }

        break
      }
      case 'connectWebRtcTransport': {
        // Define the types of the data in the request
        const { transportId, dtlsParameters } = request.data as {
          transportId: string
          dtlsParameters: mediasoup.types.DtlsParameters
        }

        this.logger.debug(`[handlePeerRequest] connectWebRtcTransport request`)

        // Access the transport from the peer's transports map
        const transport = peer.data.transports.get(transportId) as mediasoup.types.WebRtcTransport | undefined

        // Check if the transport exists
        if (!transport) {
          this.logger.debug(`[handlePeerRequest] Transport with id "${transportId}" not found`)
          reject(`Transport with id "${transportId}" not found`)
          return
        }

        try {
          // Connect the transport with the provided DTLS parameters
          await transport.connect({ dtlsParameters })
          this.logger.debug(`[handlePeerRequest] Connect the transport with the provided DTLS parameters`)
          accept()
        } catch (error) {
          this.logger.error(`[handlePeerRequest] Failed to connect transport with id "${transportId}"`)
          reject(`Failed to connect transport with id "${transportId}"`)
        }

        break
      }
      case 'restartIce': {
        // Define the type of the data in the request
        const { transportId } = request.data as {
          transportId: string
        }

        // Access the transport from the peer's transports map
        const transport = peer.data.transports.get(transportId) as mediasoup.types.WebRtcTransport | undefined

        // Check if the transport exists
        if (!transport) {
          reject(`Transport with id "${transportId}" not found`)
          return
        }

        try {
          // Restart ICE on the transport and get new ICE parameters
          const iceParameters = await transport.restartIce()

          // Accept the request with the new ICE parameters
          accept(iceParameters)
        } catch (error) {
          this.logger.error(`Failed to restart ICE for transport with id "${transportId}": ${error}`)
          reject(`Failed to restart ICE for transport with id ${transportId}`)
        }

        break
      }
      case 'produce': {
        // Ensure the Peer is joined.
        if (!peer.data.joined) {
          reject('Peer not yet joined')
          return
        }

        // Define the types of the data in the request
        const { transportId, kind, rtpParameters } = request.data as {
          transportId: string
          kind: mediasoup.types.MediaKind
          rtpParameters: mediasoup.types.RtpParameters
        }
        let { appData } = request.data as {
          appData: Record<string, any>
        }

        // Access the transport from the peer's transports map
        const transport = peer.data.transports.get(transportId) as mediasoup.types.WebRtcTransport | undefined

        // Check if the transport exists
        if (!transport) {
          reject(`Transport with id "${transportId}" not found`)
          return
        }

        // Add peerId into appData to later get the associated Peer during the 'loudest' event of the audioLevelObserver.
        appData = { ...appData, peerId: peer.id }

        let producer: mediasoup.types.Producer
        try {
          // Create a producer on the specified transport
          producer = await transport.produce({
            kind,
            rtpParameters,
            appData,
          })
        } catch (error) {
          this.logger.error(`Failed to produce on transport with id "${transportId}": ${error}`)
          reject(`Failed to produce on transport with id ${transportId}`)
          return
        }

        // Store the Producer into the protoo Peer data Object.
        peer.data.producers.set(producer.id, producer)

        // Set Producer events.
        producer.on('score', (score) => {
          // Notify the peer of the producer score.
          peer.notify('producerScore', { producerId: producer.id, score }).catch(() => {})
        })

        producer.on('videoorientationchange', (videoOrientation) => {
          this.logger.debug(
            `producer "videoorientationchange" event [producerId:${producer.id}, videoOrientation:${videoOrientation}]`,
          )
        })

        producer.on('trace', (trace) => {
          this.logger.debug(
            `producer "trace" event [producerId:${producer.id}, trace.type:${trace.type}, trace:${trace}]`,
          )
        })

        // Accept the request with the producer id
        accept({ id: producer.id })

        // Optimization: Create a server-side Consumer for each Peer.
        for (const otherPeer of this.getJoinedPeers({ excludePeer: peer })) {
          this.createConsumer({
            consumerPeer: otherPeer,
            producerPeer: peer,
            producer,
          })
        }

        // Add into the AudioLevelObserver and ActiveSpeakerObserver.
        if (producer.kind === 'audio') {
          this.audioLevelObserver.addProducer({ producerId: producer.id }).catch(() => {})
          this.activeSpeakerObserver.addProducer({ producerId: producer.id }).catch(() => {})
        }

        break
      }
      case 'closeProducer': {
        // Ensure the Peer is joined.
        if (!peer.data.joined) {
          reject('Peer not yet joined')
          return
        }

        // Define the type of the data in the request
        const { producerId } = request.data as {
          producerId: string
        }

        // Access the producer from the peer's producers map
        const producer = peer.data.producers.get(producerId) as mediasoup.types.Producer | undefined

        // Check if the producer exists
        if (!producer) {
          reject(`Producer with id "${producerId}" not found`)
          return
        }

        // Close the producer
        producer.close()

        // Remove the producer from the peer's producers map
        peer.data.producers.delete(producer.id)

        // Accept the request
        accept()

        break
      }
      case 'pauseProducer': {
        // Ensure the Peer is joined.
        if (!peer.data.joined) {
          reject('Peer not yet joined')
          return
        }

        // Define the type of the data in the request
        const { producerId } = request.data as {
          producerId: string
        }

        // Access the producer from the peer's producers map
        const producer = peer.data.producers.get(producerId) as mediasoup.types.Producer | undefined

        // Check if the producer exists
        if (!producer) {
          reject(`Producer with id "${producerId}" not found`)
          return
        }

        try {
          // Pause the producer
          await producer.pause()
          // Accept the request
          accept()
        } catch (error) {
          this.logger.error(`Failed to pause producer with id "${producerId}": ${error}`)
          reject(`Failed to pause producer with id "${producerId}"`)
        }

        break
      }
      case 'resumeProducer': {
        // Ensure the Peer is joined.
        if (!peer.data.joined) {
          reject('Peer not yet joined')
          return
        }

        // Define the type of the data in the request
        const { producerId } = request.data as {
          producerId: string
        }

        // Access the producer from the peer's producers map
        const producer = peer.data.producers.get(producerId) as mediasoup.types.Producer | undefined

        // Check if the producer exists
        if (!producer) {
          reject(`Producer with id "${producerId}" not found`)
          return
        }

        try {
          // Resume the producer
          await producer.resume()
          // Accept the request
          accept()
        } catch (error) {
          this.logger.error(`Failed to resume producer with id "${producerId}": ${error}`)
          reject(`Failed to resume producer with id "${producerId}"`)
        }

        break
      }
      case 'pauseConsumer': {
        // Ensure the Peer is joined.
        if (!peer.data.joined) {
          reject('Peer not yet joined')
          return
        }

        // Define the type of the data in the request
        const { consumerId } = request.data as {
          consumerId: string
        }

        // Access the consumer from the peer's consumers map
        const consumer = peer.data.consumers.get(consumerId) as mediasoup.types.Consumer | undefined

        // Check if the consumer exists
        if (!consumer) {
          reject(`Consumer with id "${consumerId}" not found`)
          return
        }

        try {
          // Pause the consumer
          await consumer.pause()
          // Accept the request
          accept()
        } catch (error) {
          this.logger.error(`Failed to pause consumer with id "${consumerId}":${error}`)
          reject(`Failed to pause consumer with id "${consumerId}"`)
        }

        break
      }
      case 'resumeConsumer': {
        // Ensure the Peer is joined.
        if (!peer.data.joined) {
          reject('Peer not yet joined')
          return
        }

        // Define the type of the data in the request
        const { consumerId } = request.data as {
          consumerId: string
        }

        // Access the consumer from the peer's consumers map
        const consumer = peer.data.consumers.get(consumerId) as mediasoup.types.Consumer | undefined

        // Check if the consumer exists
        if (!consumer) {
          reject(`Consumer with id "${consumerId}" not found`)
          return
        }

        try {
          // Resume the consumer
          await consumer.resume()
          // Accept the request
          accept()
        } catch (error) {
          this.logger.error(`Failed to resume consumer with id "${consumerId}": ${error}`)
          reject(`Failed to resume consumer with id "${consumerId}"`)
        }

        break
      }
      case 'setConsumerPreferredLayers': {
        // Ensure the Peer is joined.
        if (!peer.data.joined) {
          reject('Peer not yet joined')
          return
        }

        // Define the type of the data in the request
        const { consumerId, spatialLayer, temporalLayer } = request.data as {
          consumerId: string
          spatialLayer?: number
          temporalLayer?: number
        }

        // Access the consumer from the peer's consumers map
        const consumer = peer.data.consumers.get(consumerId) as mediasoup.types.Consumer | undefined

        // Check if the consumer exists
        if (!consumer) {
          reject(`Consumer with id "${consumerId}" not found`)
          return
        }

        try {
          // Set the preferred layers of the consumer
          await consumer.setPreferredLayers({ spatialLayer, temporalLayer })
          // Accept the request
          accept()
        } catch (error) {
          this.logger.error(`Failed to set preferred layers for consumer with id "${consumerId}": ${error}`)
          reject(`Failed to set preferred layers for consumer with id "${consumerId}"`)
        }

        break
      }
      case 'setConsumerPriority': {
        // Ensure the Peer is joined.
        if (!peer.data.joined) {
          reject('Peer not yet joined')
          return
        }

        // Define the type of the data in the request
        const { consumerId, priority } = request.data as {
          consumerId: string
          priority: number
        }

        // Access the consumer from the peer's consumers map
        const consumer = peer.data.consumers.get(consumerId) as mediasoup.types.Consumer | undefined

        // Check if the consumer exists
        if (!consumer) {
          reject(`Consumer with id "${consumerId}" not found`)
          return
        }

        try {
          // Set the priority of the consumer
          await consumer.setPriority(priority)
          // Accept the request
          accept()
        } catch (error) {
          this.logger.error(`Failed to set priority for consumer with id "${consumerId}": ${error}`)
          reject(`Failed to set priority for consumer with id "${consumerId}"`)
        }

        break
      }
      case 'requestConsumerKeyFrame': {
        // Ensure the Peer is joined.
        if (!peer.data.joined) {
          reject('Peer not yet joined')
          return
        }

        // Define the type of the data in the request
        const { consumerId } = request.data as {
          consumerId: string
        }

        // Access the consumer from the peer's consumers map
        const consumer = peer.data.consumers.get(consumerId) as mediasoup.types.Consumer | undefined

        // Check if the consumer exists
        if (!consumer) {
          reject(`Consumer with id "${consumerId}" not found`)
          return
        }

        try {
          // Request a key frame from the consumer
          await consumer.requestKeyFrame()
          // Accept the request
          accept()
        } catch (error) {
          this.logger.error(`Failed to request key frame for consumer with id "${consumerId}": ${error}`)
          reject(`Failed to request key frame for consumer with id "${consumerId}"`)
        }

        break
      }
      case 'produceData': {
        // Ensure the Peer is joined.
        if (!peer.data.joined) {
          reject('Peer not yet joined')
          return
        }

        // Define the type of the data in the request
        const { transportId, sctpStreamParameters, label, protocol, appData } = request.data as {
          transportId: string
          sctpStreamParameters?: mediasoup.types.SctpStreamParameters
          label?: string
          protocol?: string
          appData?: Record<string, any>
        }

        // Access the transport from the peer's transports map
        const transport = peer.data.transports.get(transportId) as mediasoup.types.WebRtcTransport | undefined

        // Check if the transport exists
        if (!transport) {
          reject(`Transport with id "${transportId}" not found`)
          return
        }

        let dataProducer: mediasoup.types.DataProducer
        try {
          // Create a DataProducer on the specified transport
          dataProducer = await transport.produceData({
            sctpStreamParameters,
            label,
            protocol,
            appData,
          })
        } catch (error) {
          this.logger.error(`Failed to produce data on transport with id "${transportId}": ${error}`)
          reject(`Failed to produce data on transport with id "${transportId}"`)
          return
        }

        // Store the DataProducer into the protoo Peer data Object.
        if (!peer.data.dataProducers) {
          peer.data.dataProducers = new Map()
        }
        peer.data.dataProducers.set(dataProducer.id, dataProducer)

        // Accept the request with the DataProducer ID
        accept({ id: dataProducer.id })

        // Handle different labels for the DataProducer
        switch (dataProducer.label) {
          case 'chat': {
            // Create a server-side DataConsumer for each Peer.
            for (const otherPeer of this.getJoinedPeers({ excludePeer: peer })) {
              this.createDataConsumer({
                dataConsumerPeer: otherPeer,
                dataProducerPeer: peer,
                dataProducer,
              })
            }
            break
          }
        }

        break
      }
      case 'changeDisplayName': {
        // Ensure the Peer is joined.
        if (!peer.data.joined) {
          reject({ status: 400, error: 'Peer not joined' })
          return
        }

        // Define the type of the data in the request
        const { displayName } = request.data as {
          displayName: string
        }

        // Store the old display name
        const oldDisplayName = peer.data.displayName as string

        // Store the new display name into the custom data object of the protoo Peer
        peer.data.displayName = displayName

        // Notify other joined Peers.
        for (const otherPeer of this.getJoinedPeers({ excludePeer: peer })) {
          otherPeer
            .notify('peerDisplayNameChanged', {
              peerId: peer.id,
              displayName,
              oldDisplayName,
            })
            .catch(() => {})
        }

        // Accept the request
        accept()

        break
      }
      case 'getTransportStats': {
        // Define the type of the data in the request
        const { transportId } = request.data as {
          transportId: string
        }

        // Access the transport from the peer's transports map
        const transport = peer.data.transports.get(transportId) as mediasoup.types.Transport | undefined

        // Check if the transport exists
        if (!transport) {
          reject(`Transport with id "${transportId}" not found`)
          return
        }

        try {
          // Get the transport statistics
          const stats = await transport.getStats()
          // Accept the request with the transport statistics
          accept(stats)
        } catch (error) {
          this.logger.error(`Failed to get stats for transport with id "${transportId}": ${error}`)
          reject(`Failed to get stats for transport with id "${transportId}"`)
        }

        break
      }
      case 'getProducerStats': {
        // Define the type of the data in the request
        const { producerId } = request.data as {
          producerId: string
        }

        // Access the producer from the peer's producers map
        const producer = peer.data.producers.get(producerId) as mediasoup.types.Producer | undefined

        // Check if the producer exists
        if (!producer) {
          reject(`Producer with id "${producerId}" not found`)
          return
        }

        try {
          // Get the producer statistics
          const stats = await producer.getStats()
          // Accept the request with the producer statistics
          accept(stats)
        } catch (error) {
          this.logger.error(`Failed to get stats for producer with id "${producerId}": ${error}`)
          reject(`Failed to get stats for producer with id "${producerId}"`)
        }

        break
      }
      case 'getConsumerStats': {
        // Define the type of the data in the request
        const { consumerId } = request.data as {
          consumerId: string
        }

        // Access the consumer from the peer's consumers map
        const consumer = peer.data.consumers.get(consumerId) as mediasoup.types.Consumer | undefined

        // Check if the consumer exists
        if (!consumer) {
          reject(`Consumer with id "${consumerId}" not found`)
          return
        }

        try {
          // Get the consumer statistics
          const stats = await consumer.getStats()
          // Accept the request with the consumer statistics
          accept(stats)
        } catch (error) {
          this.logger.error(`Failed to get stats for consumer with id "${consumerId}": ${error}`)
          reject(`Failed to get stats for consumer with id "${consumerId}"`)
        }

        break
      }
      case 'getDataProducerStats': {
        // Define the type of the data in the request
        const { dataProducerId } = request.data as {
          dataProducerId: string
        }

        // Access the data producer from the peer's dataProducers map
        const dataProducer = peer.data.dataProducers.get(dataProducerId) as mediasoup.types.DataProducer | undefined

        // Check if the data producer exists
        if (!dataProducer) {
          reject({
            status: 404,
            error: `DataProducer with id "${dataProducerId}" not found`,
          })
          return
        }

        try {
          // Get the data producer statistics
          const stats = await dataProducer.getStats()
          // Accept the request with the data producer statistics
          accept(stats)
        } catch (error) {
          this.logger.error(`Failed to get stats for data producer with id "${dataProducerId}": ${error}`)
          reject({
            status: 500,
            error: `Failed to get stats for data producer with id "${dataProducerId}"`,
          })
        }

        break
      }
      case 'getDataConsumerStats': {
        // Define the type of the data in the request
        const { dataConsumerId } = request.data as {
          dataConsumerId: string
        }

        // Access the data consumer from the peer's dataConsumers map
        const dataConsumer = peer.data.dataConsumers.get(dataConsumerId) as mediasoup.types.DataConsumer | undefined

        // Check if the data consumer exists
        if (!dataConsumer) {
          reject({
            status: 404,
            error: `DataConsumer with id "${dataConsumerId}" not found`,
          })
          return
        }

        try {
          // Get the data consumer statistics
          const stats = await dataConsumer.getStats()
          // Accept the request with the data consumer statistics
          accept(stats)
        } catch (error) {
          this.logger.error(`Failed to get stats for data consumer with id "${dataConsumerId}": ${error}`)
          reject({
            status: 500,
            error: `Failed to get stats for data consumer with id "${dataConsumerId}"`,
          })
        }

        break
      }
      case 'applyNetworkThrottle': {
        const DefaultUplink = 1000000
        const DefaultDownlink = 1000000
        const DefaultRtt = 0
        const DefaultPacketLoss = 0

        // Extract parameters from the request
        const { secret, uplink, downlink, rtt, packetLoss } = request.data

        // Validate the provided secret
        if (!secret || secret !== process.env.NETWORK_THROTTLE_SECRET) {
          reject({ status: 403, error: 'Operation NOT allowed. Invalid secret.' })
          return
        }

        try {
          // Enable network throttling
          this.networkThrottled = true

          await throttle.start({
            up: uplink || DefaultUplink,
            down: downlink || DefaultDownlink,
            rtt: rtt || DefaultRtt,
            packetLoss: packetLoss || DefaultPacketLoss,
          })

          this.logger.warn(
            'Network throttle applied [uplink: %s, downlink: %s, rtt: %s, packetLoss: %s]',
            uplink || DefaultUplink,
            downlink || DefaultDownlink,
            rtt || DefaultRtt,
            packetLoss || DefaultPacketLoss,
          )

          accept()
        } catch (error) {
          // Log and reject in case of an error
          this.logger.error(`Failed to apply network throttle: ${error}`)
          reject({ status: 500, error })
        }

        break
      }
      case 'resetNetworkThrottle': {
        const { secret } = request.data

        if (!secret || secret !== process.env.NETWORK_THROTTLE_SECRET) {
          reject({ status: 403, error: 'Operation NOT allowed. Invalid secret.' })
          return
        }

        try {
          // Stop the network throttling
          await throttle.stop()

          this.logger.warn('Network throttle stopped successfully.')

          accept()
        } catch (error) {
          this.logger.error('Failed to stop network throttle: %o', error)

          reject({ status: 500, error: `Failed to stop network throttle: ${getErrorMessage(error)}` })
        }

        break
      }
      case 'leaveRoom': {
        // Ensure the peer has joined the room
        if (!peer.data.joined) {
          reject({ status: 400, error: 'Peer not joined' })
          return
        }

        // Notify all other peers in the room that this peer has left the call
        for (const otherPeer of this.getJoinedPeers({ excludePeer: peer })) {
          otherPeer.notify('peerLeft', { peerId: peer.id }).catch(() => {})
        }

        // Close the peer
        peer.close()

        // If no more peers are in the room
        if (this.protooRoom.peers.length === 0) {
          this.logger.log(`No more peers in room, closing [roomId:${this.roomId}]`, this.roomId)
          this.close()
        }

        // Acknowledge the request
        accept()

        break
      }
      default: {
        this.logger.error(`unknown request.method ${request.method} `)
        reject({
          status: 500,
          error: `unknown request.method "${request.method}"`,
        })
      }
    }
  }

  /**
   * Helper to get the list of joined protoo peers.
   */
  getJoinedPeers({ excludePeer = undefined } = {}) {
    return this.protooRoom.peers.filter((peer) => peer.data.joined && peer !== excludePeer)
  }

  /**
   * Creates a mediasoup Consumer for the given mediasoup Producer.
   *
   * @async
   */
  async createConsumer({
    consumerPeer,
    producerPeer,
    producer,
  }: {
    consumerPeer: protoo.Peer
    producerPeer: protoo.Peer
    producer: mediasoup.types.Producer
  }): Promise<void> {
    // Optimization:
    // - Create the server-side Consumer in paused mode.
    // - Tell its Peer about it and wait for its response.
    // - Upon receipt of the response, resume the server-side Consumer.

    // NOTE: Don't create the Consumer if the remote Peer cannot consume it.
    if (
      !consumerPeer.data.rtpCapabilities ||
      !this.mediasoupRouter.canConsume({
        producerId: producer.id,
        rtpCapabilities: consumerPeer.data.rtpCapabilities,
      })
    ) {
      return
    }

    // Must take the Transport the remote Peer is using for consuming.
    const transport = Array.from(consumerPeer.data.transports.values()).find(
      (t) => (t as mediasoup.types.Transport).appData.consuming,
    ) as mediasoup.types.Transport

    // This should not happen.
    if (!transport) {
      this.logger.warn('createConsumer() | Transport for consuming not found')
      return
    }

    const promises: Promise<void>[] = []
    const consumerCount = 1 + this.consumerReplicas

    for (let i = 0; i < consumerCount; i++) {
      promises.push(
        (async () => {
          let consumer: mediasoup.types.Consumer

          try {
            // Create the Consumer in paused mode.
            consumer = await transport.consume({
              producerId: producer.id,
              rtpCapabilities: consumerPeer.data.rtpCapabilities,
              enableRtx: true,
              paused: true,
            })
          } catch (error) {
            this.logger.warn(`createConsumer() | transport.consume(): ${error}`)
            return
          }

          // Store the Consumer into the protoo consumerPeer data Object.
          consumerPeer.data.consumers.set(consumer.id, consumer)

          // Set Consumer events.
          consumer.on('transportclose', () => {
            consumerPeer.data.consumers.delete(consumer.id)
          })

          consumer.on('producerclose', () => {
            consumerPeer.data.consumers.delete(consumer.id)
            consumerPeer.notify('consumerClosed', { consumerId: consumer.id }).catch(() => {})
          })

          consumer.on('producerpause', () => {
            consumerPeer.notify('consumerPaused', { consumerId: consumer.id }).catch(() => {})
          })

          consumer.on('producerresume', () => {
            consumerPeer.notify('consumerResumed', { consumerId: consumer.id }).catch(() => {})
          })

          consumer.on('score', (score) => {
            consumerPeer.notify('consumerScore', { consumerId: consumer.id, score }).catch(() => {})
          })

          consumer.on('layerschange', (layers) => {
            consumerPeer
              .notify('consumerLayersChanged', {
                consumerId: consumer.id,
                spatialLayer: layers ? layers.spatialLayer : null,
                temporalLayer: layers ? layers.temporalLayer : null,
              })
              .catch(() => {})
          })

          consumer.on('trace', (trace) => {
            this.logger.debug(
              `consumer "trace" event [producerId:${consumer.id}, trace.type:${trace.type}, trace:${trace}]`,
            )
          })

          // Send a protoo request to the remote Peer with Consumer parameters.
          try {
            await consumerPeer.request('newConsumer', {
              peerId: producerPeer.id,
              producerId: producer.id,
              id: consumer.id,
              kind: consumer.kind,
              rtpParameters: consumer.rtpParameters,
              type: consumer.type,
              appData: producer.appData,
              producerPaused: consumer.producerPaused,
            })

            // Resume the Consumer now that we have a positive response from the remote endpoint.
            await consumer.resume()

            consumerPeer.notify('consumerScore', { consumerId: consumer.id, score: consumer.score }).catch(() => {})
          } catch (error) {
            this.logger.warn(`createConsumer() | failed: ${error}`)
          }
        })(),
      )
    }

    try {
      await Promise.all(promises)
    } catch (error) {
      this.logger.warn(`createConsumer() | failed: ${error}`)
    }
  }

  /**
   * Creates a mediasoup DataConsumer for the given mediasoup DataProducer.
   *
   * @async
   */
  async createDataConsumer({
    dataConsumerPeer,
    dataProducerPeer = null, // This is null for the bot DataProducer.
    dataProducer,
  }) {
    // NOTE: Don't create the DataConsumer if the remote Peer cannot consume it.
    if (!dataConsumerPeer.data.sctpCapabilities) return

    // Must take the Transport the remote Peer is using for consuming.
    const transport = Array.from(dataConsumerPeer.data.transports.values()).find(
      (t) => (t as mediasoup.types.Transport).appData && (t as mediasoup.types.Transport).appData.consuming,
    ) as mediasoup.types.Transport & { appData: TransportAppData }

    // This should not happen.
    if (!transport) {
      this.logger.warn('createDataConsumer() | Transport for consuming not found')

      return
    }

    // Create the DataConsumer.
    let dataConsumer: mediasoup.types.DataConsumer<mediasoup.types.AppData>

    try {
      dataConsumer = await transport.consumeData({
        dataProducerId: dataProducer.id,
      })
    } catch (error) {
      this.logger.warn(`createDataConsumer() | transport.consumeData(): ${error}`)

      return
    }

    // Store the DataConsumer into the protoo dataConsumerPeer data Object.
    dataConsumerPeer.data.dataConsumers.set(dataConsumer.id, dataConsumer)

    // Set DataConsumer events.
    dataConsumer.on('transportclose', () => {
      // Remove from its map.
      dataConsumerPeer.data.dataConsumers.delete(dataConsumer.id)
    })

    dataConsumer.on('dataproducerclose', () => {
      // Remove from its map.
      dataConsumerPeer.data.dataConsumers.delete(dataConsumer.id)

      dataConsumerPeer.notify('dataConsumerClosed', { dataConsumerId: dataConsumer.id }).catch(() => {})
    })

    // Send a protoo request to the remote Peer with Consumer parameters.
    try {
      await dataConsumerPeer.request('newDataConsumer', {
        // This is null for bot DataProducer.
        peerId: dataProducerPeer ? dataProducerPeer.id : null,
        dataProducerId: dataProducer.id,
        id: dataConsumer.id,
        sctpStreamParameters: dataConsumer.sctpStreamParameters,
        label: dataConsumer.label,
        protocol: dataConsumer.protocol,
        appData: dataProducer.appData,
      })
    } catch (error) {
      this.logger.warn(`createDataConsumer() | failed:${error}`)
    }
  }

  async getRouterRtpCapabilities() {
    return this.mediasoupRouter.rtpCapabilities
  }

  /**
   * Handles the creation of a Broadcaster. This is used for HTTP API requests.
   *
   * @param {Object} params - Parameters required for creating a Broadcaster.
   * @param {string} params.id - Unique identifier for the Broadcaster.
   * @param {string} params.displayName - Display name of the Broadcaster.
   * @param {Device} [params.device] - Device information including name and version.
   * @param {mediasoup.types.RtpCapabilities} [params.rtpCapabilities] - RTP capabilities of the Broadcaster's device.
   * @returns {Promise<{ peers: Array<any> }>} - List of peers and their producers.
   * @throws {TypeError | Error} - Throws if the input validation fails or if the Broadcaster already exists.
   */
  async createBroadcaster(params: {
    id: string
    displayName: string
    device?: Device
    rtpCapabilities?: mediasoup.types.RtpCapabilities
  }): Promise<{ peers: Array<any> }> {
    const { id, displayName, device = { name: 'Unknown device' }, rtpCapabilities } = params

    // Validate input parameters
    if (typeof id !== 'string' || !id) {
      throw new TypeError('Missing body.id')
    }
    if (typeof displayName !== 'string' || !displayName) {
      throw new TypeError('Missing body.displayName')
    }
    if (typeof device.name !== 'string' || !device.name) {
      throw new TypeError('Missing or invalid body.device.name')
    }
    if (rtpCapabilities && typeof rtpCapabilities !== 'object') {
      throw new TypeError('Invalid body.rtpCapabilities')
    }

    // Check if the Broadcaster already exists
    if (this.broadcasters.has(id)) {
      throw new Error(`Broadcaster with id "${id}" already exists`)
    }

    // Create the Broadcaster object
    const broadcaster = {
      id,
      data: {
        displayName,
        device: {
          flag: 'broadcaster',
          name: device.name || 'Unknown device',
          version: device.version,
        },
        rtpCapabilities: rtpCapabilities || null,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
        dataProducers: new Map(),
        dataConsumers: new Map(),
      },
    }

    // Store the Broadcaster in the map
    this.broadcasters.set(broadcaster.id, broadcaster)

    // Notify existing peers about the new Broadcaster
    for (const otherPeer of this.getJoinedPeers()) {
      otherPeer
        .notify('newPeer', {
          id: broadcaster.id,
          displayName: broadcaster.data.displayName,
          device: broadcaster.data.device,
        })
        .catch(() => {}) // Ignore errors in notifying peers
    }

    // Generate the list of peers and their producers
    const peerInfos = []
    const joinedPeers = this.getJoinedPeers()

    if (rtpCapabilities) {
      for (const joinedPeer of joinedPeers) {
        const peerInfo = {
          id: joinedPeer.id,
          displayName: joinedPeer.data.displayName,
          device: joinedPeer.data.device,
          producers: [],
        }

        for (const producer of joinedPeer.data.producers.values()) {
          // Ignore Producers that the Broadcaster cannot consume
          if (
            !this.mediasoupRouter.canConsume({
              producerId: producer.id,
              rtpCapabilities,
            })
          ) {
            continue
          }

          peerInfo.producers.push({
            id: producer.id,
            kind: producer.kind,
          })
        }

        peerInfos.push(peerInfo)
      }
    }

    return { peers: peerInfos }
  }

  /**
   * Deletes a Broadcaster and notifies all peers about the removal.
   *
   * @param {Object} params - Parameters for deleting a Broadcaster.
   * @param {string} params.broadcasterId - The ID of the Broadcaster to delete.
   * @throws {Error} - Throws if the Broadcaster does not exist.
   */
  deleteBroadcaster(params: { broadcasterId: string }): void {
    const { broadcasterId } = params

    // Retrieve the Broadcaster by its ID
    const broadcaster = this.broadcasters.get(broadcasterId)

    // Validate if the Broadcaster exists
    if (!broadcaster) {
      throw new Error(`Broadcaster with id "${broadcasterId}" does not exist`)
    }

    // Close all transports associated with the Broadcaster
    for (const transport of broadcaster.data.transports.values()) {
      transport.close()
    }

    // Remove the Broadcaster from the map
    this.broadcasters.delete(broadcasterId)

    // Notify all peers about the Broadcaster removal
    for (const peer of this.getJoinedPeers()) {
      peer.notify('peerClosed', { peerId: broadcasterId }).catch(() => {
        // Handle notification errors silently
      })
    }
  }

  /**
   * Creates a mediasoup Transport associated with a Broadcaster.
   * It can either be a WebRtcTransport or a PlainTransport.
   *
   * @param {Object} params - Parameters for creating the Transport.
   * @param {string} params.broadcasterId - The ID of the Broadcaster.
   * @param {string} params.type - The type of transport ('plain' or 'webrtc').
   * @param {boolean} [params.rtcpMux=false] - For PlainTransport only, specifies whether RTCP mux is enabled.
   * @param {boolean} [params.comedia=true] - For PlainTransport only, enables remote IP:port autodetection.
   * @param {mediasoup.types.SctpCapabilities} [params.sctpCapabilities] - SCTP capabilities for WebRtcTransport.
   * @returns {Promise<Object>} - Transport details including its ID and other configuration parameters.
   * @throws {Error | TypeError} - Throws if the Broadcaster does not exist or if the transport type is invalid.
   */
  async createBroadcasterTransport(params: {
    broadcasterId: string
    type: 'plain' | 'webrtc'
    rtcpMux?: boolean
    comedia?: boolean
    sctpCapabilities?: mediasoup.types.SctpCapabilities
  }): Promise<any> {
    const { broadcasterId, type, rtcpMux = false, comedia = true, sctpCapabilities } = params

    // Retrieve the Broadcaster by its ID
    const broadcaster = this.broadcasters.get(broadcasterId)

    if (!broadcaster) {
      throw new Error(`Broadcaster with id "${broadcasterId}" does not exist`)
    }

    switch (type) {
      case 'webrtc': {
        // Configure WebRtcTransport options
        const webRtcTransportOptions = {
          ...config.mediasoup.webRtcTransportOptions,
          enableSctp: Boolean(sctpCapabilities),
          numSctpStreams: sctpCapabilities?.numStreams || undefined,
        }

        // Create the WebRtcTransport
        const transport = await this.mediasoupRouter.createWebRtcTransport({
          ...webRtcTransportOptions,
          //webRtcServer: this.webRtcServer,
        })

        // Store the transport in the Broadcaster's data
        broadcaster.data.transports.set(transport.id, transport)

        // Return transport details
        return {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
          sctpParameters: transport.sctpParameters,
        }
      }

      case 'plain': {
        // Configure PlainTransport options
        const plainTransportOptions = {
          ...config.mediasoup.plainTransportOptions,
          rtcpMux,
          comedia,
        }

        // Create the PlainTransport
        const transport = await this.mediasoupRouter.createPlainTransport(plainTransportOptions)

        // Store the transport in the Broadcaster's data
        broadcaster.data.transports.set(transport.id, transport)

        // Return transport details
        return {
          id: transport.id,
          ip: transport.tuple.localIp,
          port: transport.tuple.localPort,
          rtcpPort: transport.rtcpTuple?.localPort,
        }
      }

      default: {
        throw new TypeError('Invalid transport type')
      }
    }
  }

  /**
   * Connects a Broadcaster's mediasoup WebRtcTransport.
   *
   * @param {Object} params - Parameters for connecting the transport.
   * @param {string} params.broadcasterId - The ID of the Broadcaster.
   * @param {string} params.transportId - The ID of the transport to connect.
   * @param {mediasoup.types.DtlsParameters} params.dtlsParameters - Remote DTLS parameters.
   * @returns {Promise<void>} - Resolves when the transport is successfully connected.
   * @throws {Error} - Throws if the Broadcaster or transport does not exist, or if the transport is not a WebRtcTransport.
   */
  async connectBroadcasterTransport(params: {
    broadcasterId: string
    transportId: string
    dtlsParameters: mediasoup.types.DtlsParameters
  }): Promise<void> {
    const { broadcasterId, transportId, dtlsParameters } = params

    // Retrieve the Broadcaster by its ID
    const broadcaster = this.broadcasters.get(broadcasterId)

    if (!broadcaster) {
      throw new Error(`Broadcaster with id "${broadcasterId}" does not exist`)
    }

    // Retrieve the transport from the Broadcaster's data
    const transport = broadcaster.data.transports.get(transportId)

    if (!transport) {
      throw new Error(`Transport with id "${transportId}" does not exist`)
    }

    // Ensure the transport is a WebRtcTransport
    if (transport.constructor.name !== 'WebRtcTransport') {
      throw new Error(`Transport with id "${transportId}" is not a WebRtcTransport`)
    }

    // Connect the transport using the provided DTLS parameters
    await transport.connect({ dtlsParameters })
  }

  /**
   * Creates a mediasoup Consumer associated with a Broadcaster.
   *
   * @param {Object} params - Parameters for creating the Consumer.
   * @param {string} params.broadcasterId - The ID of the Broadcaster.
   * @param {string} params.transportId - The ID of the transport to associate the Consumer with.
   * @param {string} params.producerId - The ID of the producer to consume.
   * @returns {Promise<Object>} - Details of the created Consumer.
   * @throws {Error} - Throws if the Broadcaster, transport, or rtpCapabilities are missing.
   */
  async createBroadcasterConsumer(params: { broadcasterId: string; transportId: string; producerId: string }): Promise<{
    id: string
    producerId: string
    kind: mediasoup.types.MediaKind
    rtpParameters: mediasoup.types.RtpParameters
    type: mediasoup.types.ConsumerType
  }> {
    const { broadcasterId, transportId, producerId } = params

    // Retrieve the Broadcaster by its ID
    const broadcaster = this.broadcasters.get(broadcasterId)

    if (!broadcaster) {
      throw new Error(`Broadcaster with id "${broadcasterId}" does not exist`)
    }

    // Ensure the Broadcaster has RTP capabilities
    if (!broadcaster.data.rtpCapabilities) {
      throw new Error('Broadcaster does not have RTP capabilities')
    }

    // Retrieve the transport by its ID
    const transport = broadcaster.data.transports.get(transportId)

    if (!transport) {
      throw new Error(`Transport with id "${transportId}" does not exist`)
    }

    // Create the Consumer
    const consumer = await transport.consume({
      producerId,
      rtpCapabilities: broadcaster.data.rtpCapabilities,
    })

    // Store the Consumer in the Broadcaster's data
    broadcaster.data.consumers.set(consumer.id, consumer)

    // Handle transport close event
    consumer.on('transportclose', () => {
      broadcaster.data.consumers.delete(consumer.id)
    })

    // Handle producer close event
    consumer.on('producerclose', () => {
      broadcaster.data.consumers.delete(consumer.id)
    })

    // Return Consumer details
    return {
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      type: consumer.type,
    }
  }

  /**
   * Creates a mediasoup DataConsumer associated with a Broadcaster.
   *
   * @async
   * @param {Object} params - Parameters for creating the DataConsumer.
   * @param {string} params.broadcasterId - The ID of the Broadcaster.
   * @param {string} params.transportId - The ID of the transport to associate the DataConsumer with.
   * @param {string} params.dataProducerId - The ID of the DataProducer to consume.
   * @returns {Promise<Object>} - Details of the created DataConsumer.
   * @throws {Error} - Throws if the Broadcaster, transport, or DataProducer is not found.
   */
  async createBroadcasterDataConsumer(params: {
    broadcasterId: string
    transportId: string
    dataProducerId: string
  }): Promise<{
    id: string
    streamId: number
  }> {
    const { broadcasterId, transportId, dataProducerId } = params

    // Retrieve the Broadcaster by its ID
    const broadcaster = this.broadcasters.get(broadcasterId)

    if (!broadcaster) {
      throw new Error(`Broadcaster with id "${broadcasterId}" does not exist`)
    }

    // Ensure the Broadcaster has RTP capabilities
    if (!broadcaster.data.rtpCapabilities) {
      throw new Error('Broadcaster does not have RTP capabilities')
    }

    // Retrieve the transport by its ID
    const transport = broadcaster.data.transports.get(transportId)

    if (!transport) {
      throw new Error(`Transport with id "${transportId}" does not exist`)
    }

    try {
      // Create the DataConsumer
      const dataConsumer = await transport.consumeData({
        dataProducerId,
      })

      // Store the DataConsumer in the Broadcaster's data
      broadcaster.data.dataConsumers.set(dataConsumer.id, dataConsumer)

      // Handle transport close event
      dataConsumer.on('transportclose', () => {
        broadcaster.data.dataConsumers.delete(dataConsumer.id)
      })

      // Handle DataProducer close event
      dataConsumer.on('dataproducerclose', () => {
        broadcaster.data.dataConsumers.delete(dataConsumer.id)
      })

      // Return DataConsumer details
      return {
        id: dataConsumer.id,
        streamId: dataConsumer.sctpStreamParameters.streamId,
      }
    } catch (error) {
      this.logger.error(`Failed to create DataConsumer: ${getErrorMessage(error)}`)
      throw new Error(`Failed to create DataConsumer: ${getErrorMessage(error)}`)
    }
  }

  /**
   * Creates a mediasoup DataProducer associated with a Broadcaster.
   *
   * @async
   * @param {Object} params - Parameters for creating the DataProducer.
   * @param {string} params.broadcasterId - The ID of the Broadcaster.
   * @param {string} params.transportId - The ID of the transport to associate the DataProducer with.
   * @param {string} [params.label] - The label for the DataProducer.
   * @param {string} [params.protocol] - The protocol for the DataProducer.
   * @param {object} [params.sctpStreamParameters] - SCTP stream parameters.
   * @param {any} [params.appData] - Additional application-specific data.
   * @returns {Promise<Object>} - Details of the created DataProducer.
   * @throws {Error} - Throws if the Broadcaster or transport is not found.
   */
  async createBroadcasterDataProducer(params: {
    broadcasterId: string
    transportId: string
    label?: string
    protocol?: string
    sctpStreamParameters?: mediasoup.types.SctpStreamParameters
    appData?: any
  }): Promise<{
    id: string
  }> {
    const { broadcasterId, transportId, label, protocol, sctpStreamParameters, appData } = params

    // Retrieve the Broadcaster by its ID
    const broadcaster = this.broadcasters.get(broadcasterId)

    if (!broadcaster) {
      throw new Error(`Broadcaster with id "${broadcasterId}" does not exist`)
    }

    // Retrieve the transport by its ID
    const transport = broadcaster.data.transports.get(transportId)

    if (!transport) {
      throw new Error(`Transport with id "${transportId}" does not exist`)
    }

    try {
      // Create the DataProducer
      const dataProducer = await transport.produceData({
        sctpStreamParameters,
        label,
        protocol,
        appData,
      })

      // Store the DataProducer in the Broadcaster's data
      broadcaster.data.dataProducers.set(dataProducer.id, dataProducer)

      // Handle transport close event
      dataProducer.on('transportclose', () => {
        broadcaster.data.dataProducers.delete(dataProducer.id)
      })

      // Return DataProducer details
      return {
        id: dataProducer.id,
      }
    } catch (error) {
      this.logger.error(`Failed to create DataProducer: ${getErrorMessage(error)}`)
      throw new Error(`Failed to create DataProducer: ${getErrorMessage(error)}`)
    }
  }

  /**
   * Create a mediasoup Producer associated with a Broadcaster.
   *
   * @async
   * @param broadcasterId - The ID of the Broadcaster.
   * @param transportId - The ID of the Transport to which the Producer is associated.
   * @param kind - The kind of media ('audio' or 'video') for the Producer.
   * @param rtpParameters - RTP parameters for the Producer.
   * @returns A promise that resolves with the created Producer ID.
   * @throws If the Broadcaster or Transport is not found.
   */
  async createBroadcasterProducer({
    broadcasterId,
    transportId,
    kind,
    rtpParameters,
  }: {
    broadcasterId: string
    transportId: string
    kind: mediasoup.types.MediaKind
    rtpParameters: mediasoup.types.RtpParameters
  }): Promise<{ id: string }> {
    const broadcaster = this.broadcasters.get(broadcasterId)

    if (!broadcaster) {
      throw new Error(`Broadcaster with id "${broadcasterId}" does not exist`)
    }

    const transport = broadcaster.data.transports.get(transportId)

    if (!transport) {
      throw new Error(`Transport with id "${transportId}" does not exist`)
    }

    const producer: Producer = await transport.produce({ kind, rtpParameters })

    // Store the Producer in the Broadcaster's data.
    broadcaster.data.producers.set(producer.id, producer)

    // Set Producer events.
    producer.on('videoorientationchange', (videoOrientation) => {
      this.logger.debug(
        `Broadcaster producer "videoorientationchange" event [producerId:${producer.id}, videoOrientation:%o]`,
        videoOrientation,
      )
    })

    // Create server-side Consumers for all connected Peers.
    for (const peer of this.getJoinedPeers()) {
      this.createConsumer({
        consumerPeer: peer,
        producerPeer: broadcaster,
        producer,
      })
    }

    // Add the Producer to the AudioLevelObserver and ActiveSpeakerObserver if it's audio.
    if (producer.kind === 'audio') {
      this.audioLevelObserver.addProducer({ producerId: producer.id }).catch(() => {
        this.logger.warn(`Failed to add producer to AudioLevelObserver [producerId:${producer.id}]`)
      })

      this.activeSpeakerObserver.addProducer({ producerId: producer.id }).catch(() => {
        this.logger.warn(`Failed to add producer to ActiveSpeakerObserver [producerId:${producer.id}]`)
      })
    }

    return { id: producer.id }
  }

  /**
   * Handles the audio level observer events for monitoring active speakers.
   */
  private handleAudioLevelObserver(): void {
    // Listen for 'volumes' event to notify peers about the active speaker.
    this.audioLevelObserver.on('volumes', (volumes: { producer: mediasoup.types.Producer; volume: number }[]) => {
      const { producer, volume } = volumes[0]

      this.logger.debug('audioLevelObserver "volumes" event [producerId:%s, volume:%s]', producer.id, volume)

      // Notify all connected peers about the active speaker.
      for (const peer of this.getJoinedPeers()) {
        peer
          .notify('activeSpeaker', {
            peerId: producer.appData.peerId,
            volume: volume,
          })
          .catch((error: Error) => {
            this.logger.error('Failed to notify active speaker:', getErrorMessage(error))
          })
      }
    })

    // Listen for 'silence' event to notify peers about no active speaker.
    this.audioLevelObserver.on('silence', () => {
      this.logger.debug('audioLevelObserver "silence" event')

      // Notify all connected peers about no active speaker.
      for (const peer of this.getJoinedPeers()) {
        peer.notify('activeSpeaker', { peerId: null }).catch((error: Error) => {
          this.logger.error('Failed to notify silence event:', getErrorMessage(error))
        })
      }
    })
  }

  /**
   * Handles the active speaker observer events for monitoring the dominant speaker.
   */
  private handleActiveSpeakerObserver(): void {
    // Listen for 'dominantspeaker' event to notify about the current dominant speaker.
    this.activeSpeakerObserver.on('dominantspeaker', (dominantSpeaker: { producer: mediasoup.types.Producer }) => {
      this.logger.debug('activeSpeakerObserver "dominantspeaker" event [producerId:%s]', dominantSpeaker.producer.id)

      try {
        // Additional logic can be added here to notify peers or perform actions
        // based on the dominant speaker event.
      } catch (error) {
        this.logger.error('Error handling "dominantspeaker" event:', getErrorMessage(error))
      }
    })
  }

  /**
   * Retrieves a producer by its ID.
   * @param producerId - The ID of the producer.
   * @returns The mediasoup Producer object.
   */
  private async getProducerById(producerId: string): Promise<mediasoup.types.Producer> {
    // Replace this logic with how producers are stored in your application
    const producer = Array.from(this.protooRoom.peers)
      .flatMap((peer) => Array.from(peer.data.producers.values() as mediasoup.types.Producer[]))
      .find((p) => p.id === producerId)

    if (!producer) {
      throw new Error(`Producer with ID ${producerId} not found`)
    }

    return producer
  }

  /**
   * Retrieves a consumer by its ID.
   * @param consumerId - The ID of the consumer.
   * @returns The mediasoup Consumer object.
   */
  private async getConsumerById(consumerId: string): Promise<mediasoup.types.Consumer> {
    // Replace this logic with how consumers are stored in your application
    const consumer = Array.from(this.protooRoom.peers)
      .flatMap((peer) => Array.from(peer.data.consumers.values() as mediasoup.types.Consumer[]))
      .find((c) => c.id === consumerId)

    if (!consumer) {
      throw new Error(`Consumer with ID ${consumerId} not found`)
    }

    return consumer
  }
}
