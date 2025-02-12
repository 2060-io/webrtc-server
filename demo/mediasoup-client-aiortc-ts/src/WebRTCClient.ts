import * as protooClient from 'protoo-client'
import * as mediasoupClient from 'mediasoup-client'
import { createWorker, Worker } from 'mediasoup-client-aiortc'

/**
 * Options for the WebRTCClient
 */
interface WebRTCClientOptions {
  /**
   * The WebSocket URL for your protoo signaling server
   */
  wsUrl: string

  /**
   * An optional URL (HTTP/HTTPS) to play (produce) immediately after connection
   */
  urlToPlay?: string
}

export class WebRTCClient {
  private protooTransport: protooClient.WebSocketTransport | null = null
  private protooPeer: protooClient.Peer | null = null
  private worker: Worker | null = null
  private device: mediasoupClient.Device | null = null

  private sendTransport: mediasoupClient.types.Transport | null = null
  private recvTransport: mediasoupClient.types.Transport | null = null

  private producers: mediasoupClient.types.Producer[] = []

  /**
   * @param options WebRTCClientOptions including wsUrl and optional urlToPlay
   */
  constructor(private options: WebRTCClientOptions) {}

  /**
   * Initiates the protoo WebSocket connection, creates an aiortc worker,
   * and prepares the send transport and (optionally) the recv transport.
   */
  async connect(): Promise<void> {
    console.log(`Connecting to WebSocket: ${this.options.wsUrl}`)

    // Initialize protoo connection
    this.protooTransport = new protooClient.WebSocketTransport(this.options.wsUrl)
    this.protooPeer = new protooClient.Peer(this.protooTransport)

    // On 'open', begin creating the aiortc worker, device, etc.
    this.protooPeer.on('open', async () => {
      console.log('WebSocket connection opened')

      // Create the aiortc worker (spawns Python subprocess)
      this.worker = await createWorker({ logLevel: 'debug' })
      console.log('AIORTC worker created')

      // Create a handlerFactory for aiortc, then create a mediasoup-client Device
      const handlerFactory = await this.worker.createHandlerFactory()
      console.log(`*** handlerFactory: ${handlerFactory} ***`)
      this.device = new mediasoupClient.Device({ handlerFactory })
      console.log('Device created using AIORTC handler')

      // Request the router RTP capabilities from the server
      const rtpCaps = await this.protooPeer!.request('getRouterRtpCapabilities')
      // Adjust this depending on your server's response structure
      await this.device.load({ routerRtpCapabilities: rtpCaps })

      // Create the send transport (and optionally recv transport)
      await this.createSendTransport()
      // await this.createRecvTransport();

      // Join the room
      await this.joinRoom()

      // If a media URL is provided, produce from that URL
      if (this.options.urlToPlay) {
        await this.produceMedia(this.options.urlToPlay)
      }
    })

    // On 'close', perform cleanup
    this.protooPeer.on('close', () => {
      console.log('WebSocket connection closed')
      this.cleanup()
    })
  }

  /**
   * Creates a sending (producing) transport for the device.
   * Calls the signaling server to create a WebRtcTransport.
   */
  private async createSendTransport(): Promise<void> {
    if (!this.device) return

    const { id, iceParameters, iceCandidates, dtlsParameters, sctpParameters, iceServers } =
      await this.protooPeer!.request('createWebRtcTransport', {
        producing: true,
        consuming: false,
        forceTcp: false,
        sctpCapabilities: this.device.sctpCapabilities,
      })

    //Fix add credentialType attribute required to activate iceServer aiortc
    const modifiedIceServers = (iceServers || []).map((server: any) => ({
      ...server,
      credentialType: 'password',
    }))

    /* console.log(
      'SendTransport data:',
      JSON.stringify(
        {
          id,
          iceParameters,
          iceCandidates,
          dtlsParameters,
          sctpParameters,
          iceServers,
        },
        null,
        2
      )
    )*/

    // Create the send transport in mediasoup-client
    this.sendTransport = this.device.createSendTransport({
      id,
      iceCandidates,
      iceParameters,
      dtlsParameters,
      sctpParameters,
      iceServers: modifiedIceServers,
      // Optional: iceTransportPolicy: 'relay' | 'all'
      iceTransportPolicy: 'relay',
    })

    // 'connect' event => finalize DTLS and ICE
    this.sendTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      try {
        console.log(`*****DTLS: ${JSON.stringify(dtlsParameters)}******`)
        await this.protooPeer!.request('connectWebRtcTransport', {
          transportId: this.sendTransport!.id,
          dtlsParameters,
        })
        callback()
      } catch (error) {
        errback(error instanceof Error ? error : new Error(String(error)))
      }
    })

    // 'produce' event => ask server for Producer id
    this.sendTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
      try {
        const { id } = await this.protooPeer!.request('produce', {
          transportId: this.sendTransport!.id,
          kind,
          rtpParameters,
        })
        callback({ id })
      } catch (error) {
        errback(error instanceof Error ? error : new Error(String(error)))
      }
    })

    console.log('Send transport created')
  }

  /**
   * Creates a receiving (consuming) transport. Not used by default,
   * but you can uncomment the call in connect() if you want to consume remote producers.
   */
  private async createRecvTransport(): Promise<void> {
    if (!this.device) {
      console.warn('Device not loaded yet')
      return
    }

    const { id, iceParameters, iceCandidates, dtlsParameters, sctpParameters, iceServers } =
      await this.protooPeer!.request('createWebRtcTransport', {
        producing: false,
        consuming: true,
        forceTcp: false,
        sctpCapabilities: this.device.sctpCapabilities,
      })

    console.log(
      'RecvTransport data:',
      JSON.stringify(
        {
          id,
          iceParameters,
          iceCandidates,
          dtlsParameters,
          sctpParameters,
          iceServers,
        },
        null,
        2
      )
    )

    this.recvTransport = this.device.createRecvTransport({
      id,
      iceParameters,
      iceCandidates,
      dtlsParameters,
      sctpParameters,
      iceServers,
    })

    // 'connect' event => finalize DTLS and ICE
    this.recvTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      try {
        await this.protooPeer!.request('connectWebRtcTransport', {
          transportId: this.recvTransport!.id,
          dtlsParameters,
        })
        callback()
      } catch (error) {
        errback(error instanceof Error ? error : new Error(String(error)))
      }
    })

    console.log('Receive transport created')
  }

  /**
   * Joins the room by calling the 'join' request on the signaling server.
   * This usually includes providing displayName, device info, and the local rtpCapabilities.
   */
  private async joinRoom(): Promise<void> {
    if (!this.device) return

    await this.protooPeer!.request('join', {
      displayName: 'AIORTC Node Client',
      device: { name: 'Node+Python' },
      rtpCapabilities: this.device.rtpCapabilities,
    })
    console.log('Joined room successfully')
  }

  /**
   * Produce media tracks from a remote URL (HTTP/HTTPS).
   * This method uses aiortc's getUserMedia() with source='url'.
   * @param urlStream The URL of the media you want to play.
   */
  private async produceMedia(urlStream: string): Promise<void> {
    if (!this.worker || !this.sendTransport) {
      console.warn('Worker or sendTransport not ready')
      return
    }
    console.log(`Produce media from URL: ${urlStream}`)

    // AiortcMediaStream: passing "audio" and "video" constraints with source='url'
    const stream = await this.worker.getUserMedia({
      audio: {
        source: 'url',
        url: urlStream,
      },
      video: {
        source: 'url',
        url: urlStream,
      },
    })

    const audioTrack = stream.getAudioTracks()[0]
    const videoTrack = stream.getVideoTracks()[0]

    videoTrack.addEventListener('ended', () => {
      console.log(`****ended: ${JSON.stringify(videoTrack.data)}*****`)
    })

    console.log(`****VIDEO: ${JSON.stringify(videoTrack.data)}*****`)

    // Produce video
    if (videoTrack) {
      const videoProducer = await this.sendTransport.produce({ track: videoTrack })

      this.producers.push(videoProducer)
      videoProducer.addListener('trackended', () => {
        console.log('Video finished')
        this.cleanup()
      })
      console.log('Video producer created')
      videoTrack.addEventListener('ended', () => {
        console.log('Video finished')
        this.cleanup()
      })
    }
    // Produce audio
    if (audioTrack) {
      const audioProducer = await this.sendTransport.produce({ track: audioTrack })
      this.producers.push(audioProducer)
      console.log('Audio producer created')
    }
  }

  /**
   * Cleans up all producers, closes the AIORTC worker, etc.
   */
  private cleanup(): void {
    this.producers.forEach((producer) => producer.close())
    if (this.worker) {
      this.worker.close()
      console.log('AIORTC worker closed')
    }
  }
}

// Example usage
/*const wsUrl = 'wss://webrtc.dev.2060.io:443?roomId=kdqmuy2c&peerId=pythonNode'
const mediaUrl = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'

const client = new WebRTCClient({ wsUrl, urlToPlay: mediaUrl })
client.connect()*/
