#!/usr/bin/env node

process.title = 'mediasoup-demo-server'
process.env.DEBUG = process.env.DEBUG || '*INFO* *WARN* *ERROR*'

const config = require('./config')

/* eslint-disable no-console */
console.log('process.env.DEBUG:', process.env.DEBUG)
console.log('config.js:\n%s', JSON.stringify(config, null, '  '))
/* eslint-enable no-console */

const fs = require('fs')
const https = require('https')
const url = require('url')
const protoo = require('protoo-server')
const mediasoup = require('mediasoup')
const express = require('express')
const bodyParser = require('body-parser')
const { AwaitQueue } = require('awaitqueue')
const Logger = require('./lib/Logger')
const utils = require('./lib/utils')
const Room = require('./lib/Room')
const interactiveServer = require('./lib/interactiveServer')
const interactiveClient = require('./lib/interactiveClient')
const { v4: uuidv4 } = require('uuid')
const axios = require('axios')
const Docker = require('dockerode')
const logger = new Logger()
const randomString = require('random-string')
const { validateCreateRoomParams } = require('./lib/middlewares');
const { sendNotification } = require('./lib/handlerNotification');

// Async queue to manage rooms.
// @type {AwaitQueue}
const queue = new AwaitQueue()

// Map of Room instances indexed by roomId.
// @type {Map<Number, Room>}
const rooms = new Map()

// Maps of eventNotificationUris
const notificationUris = new Map()

// HTTPS server.
// @type {https.Server}
let httpsServer

// Express application.
// @type {Function}
let expressApp

// Protoo WebSocket server.
// @type {protoo.WebSocketServer}
let protooWebSocketServer

// mediasoup Workers.
// @type {Array<mediasoup.Worker>}
const mediasoupWorkers = []

// Index of next mediasoup Worker to use.
// @type {Number}
let nextMediasoupWorkerIdx = 0

run()

async function run() {
  // Open the interactive server.
  await interactiveServer()

  // Open the interactive client.
  if (process.env.INTERACTIVE === 'true' || process.env.INTERACTIVE === '1') await interactiveClient()

  // Run a mediasoup Worker.
  await runMediasoupWorkers()

  // Create Express app.
  await createExpressApp()

  // Run HTTPS server.
  await runHttpsServer()

  // Run a protoo WebSocketServer.
  await runProtooWebSocketServer()

  // Log rooms status every X seconds.
  setInterval(() => {
    for (const room of rooms.values()) {
      room.logStatus()
    }
  }, 120000)
}

/**
 * launch turn server
 */

/**
 * Launch as many mediasoup Workers as given in the configuration file.
 */
async function runMediasoupWorkers() {
  const { numWorkers } = config.mediasoup

  logger.info('running %d mediasoup Workers...', numWorkers)

  for (let i = 0; i < numWorkers; ++i) {
    const worker = await mediasoup.createWorker({
      logLevel: config.mediasoup.workerSettings.logLevel,
      logTags: config.mediasoup.workerSettings.logTags,
      rtcMinPort: Number(config.mediasoup.workerSettings.rtcMinPort),
      rtcMaxPort: Number(config.mediasoup.workerSettings.rtcMaxPort),
    })

    worker.on('died', () => {
      logger.error('mediasoup Worker died, exiting  in 2 seconds... [pid:%d]', worker.pid)

      setTimeout(() => process.exit(1), 2000)
    })

    mediasoupWorkers.push(worker)

    // Create a WebRtcServer in this Worker.
    if (process.env.MEDIASOUP_USE_WEBRTC_SERVER !== 'false') {
      // Each mediasoup Worker will run its own WebRtcServer, so those cannot
      // share the same listening ports. Hence we increase the value in config.js
      // for each Worker.
      const webRtcServerOptions = utils.clone(config.mediasoup.webRtcServerOptions)
      const portIncrement = mediasoupWorkers.length - 1

      for (const listenInfo of webRtcServerOptions.listenInfos) {
        listenInfo.port += portIncrement
      }

      const webRtcServer = await worker.createWebRtcServer(webRtcServerOptions)

      worker.appData.webRtcServer = webRtcServer
    }

    // Log worker resource usage every X seconds.
    setInterval(async () => {
      const usage = await worker.getResourceUsage()

      logger.info('mediasoup Worker resource usage [pid:%d]: %o', worker.pid, usage)
    }, 120000)
  }
}

/**
 * Create an Express based API server to manage Broadcaster requests.
 */
async function createExpressApp() {
  logger.info('creating Express app...')

  expressApp = express()

  expressApp.set('case sensitive routing', true);

  expressApp.use(express.static('public'))

  expressApp.use(bodyParser.json())

  /**
   * For every API request, verify that the roomId in the path matches and
   * existing room.
   */
  expressApp.param('roomId', (req, res, next, roomId) => {
    queue
      .push(async () => {
        req.room = await getOrCreateRoom({ roomId, consumerReplicas: 0 })

        next()
      })
      .catch((error) => {
        logger.error('room creation or room joining via broadcaster failed:%o', error)

        next(error)
      })
  })


expressApp.post('/rooms/:roomId?',validateCreateRoomParams, async (req, res) => {
  const { eventNotificationUri, maxPeerCount } = req.body;
  const roomId = req.params.roomId;

  // If roomId is not provided, generate a random one
  const roomIdToUse = roomId ?? randomString({ length: 8, numeric: true, letters: true }).toLowerCase();
  // Port of connection websocket
  const port = process.env.MEDIASOUP_CLIENT_PROTOOPORT
  // Host or Ip where try connect ws
  const announcedIp = config.https.ingressHost
  // Ws url to response
  const wsUrl = `wss://${announcedIp}:${port}`

  try {
    // Check if roomId already exists in notificationUris
    if (notificationUris.has(roomIdToUse)) {
      throw new Error(`Room with roomId ${roomIdToUse} already exists.`);
    }

    // Create or retrieve an existing room
    await getOrCreateRoom({ roomId: roomIdToUse, consumerReplicas: 0, maxPeerCount });
    
    // Store the eventNotificationUri associated with the roomId
    notificationUris.set(roomIdToUse, eventNotificationUri);
    

    const data = {
      protocol: '2060-mediasoup-v1',
      wsUrl,
      roomId:roomIdToUse 
    };

    // Return success response
    res.status(200).json(data);
  } catch (error) {
    logger.error('Error creating room:', error.message);
    // Return error response
    res.status(500).json({ error: error.message });
  }
});

  /*
   * Route allows a generate meeting hall API
   */

  expressApp.get('/getRoomId', async (req, res) => {
    try {
      const announcedIp = config.https.ingressHost
      console.log('[getRoomId] Host request IP:', announcedIp)
      const port = process.env.MEDIASOUP_CLIENT_PROTOOPORT
      const roomId = randomString({ length: 8, numeric: true, letters: true }).toLowerCase()
      const createRoom = await getOrCreateRoom({ roomId, consumerReplicas: 0 })
      const wsUrl = `wss://${announcedIp}:${port}?roomId=${roomId}&peerId=`
      console.log(`[getRoomId] create roomId ${createRoom._roomId}`)
      const data = {
        roomId,
        wsUrl,
        status: 1,
      }
      res.status(200).json(data)
    } catch (error) {
      console.error('Error generating roomId:', error)
      res.status(500).json({ error: 'Error generating roomId' })
    }
  })

  expressApp.get('/config', async (req, res) => {
    try {
      const data = {
        config,
      }
      res.status(200).json(data)
    } catch (error) {
      console.error('Error generating roomId:', error)
      res.status(500).json({ error: 'Error generating roomId' })
    }
  })

  /**
   * API GET resource that returns the mediasoup Router RTP capabilities of
   * the room.
   */
  expressApp.get('/rooms/:roomId', (req, res) => {
    const data = req.room.getRouterRtpCapabilities()

    res.status(200).json(data)
  })

  /**
   * POST API to create a Broadcaster.
   */
  expressApp.post('/rooms/:roomId/broadcasters', async (req, res, next) => {
    const { id, displayName, device, rtpCapabilities } = req.body

    try {
      const data = await req.room.createBroadcaster({
        id,
        displayName,
        device,
        rtpCapabilities,
      })

      res.status(200).json(data)
    } catch (error) {
      next(error)
    }
  })

  /**
   * DELETE API to delete a Broadcaster.
   */
  expressApp.delete('/rooms/:roomId/broadcasters/:broadcasterId', (req, res) => {
    const { broadcasterId } = req.params

    req.room.deleteBroadcaster({ broadcasterId })

    res.status(200).send('broadcaster deleted')
  })

  /**
   * POST API to create a mediasoup Transport associated to a Broadcaster.
   * It can be a PlainTransport or a WebRtcTransport depending on the
   * type parameters in the body. There are also additional parameters for
   * PlainTransport.
   */
  expressApp.post('/rooms/:roomId/broadcasters/:broadcasterId/transports', async (req, res, next) => {
    const { broadcasterId } = req.params
    const { type, rtcpMux, comedia, sctpCapabilities } = req.body

    try {
      const data = await req.room.createBroadcasterTransport({
        broadcasterId,
        type,
        rtcpMux,
        comedia,
        sctpCapabilities,
      })

      res.status(200).json(data)
    } catch (error) {
      next(error)
    }
  })

  /**
   * POST API to connect a Transport belonging to a Broadcaster. Not needed
   * for PlainTransport if it was created with comedia option set to true.
   */
  expressApp.post(
    '/rooms/:roomId/broadcasters/:broadcasterId/transports/:transportId/connect',
    async (req, res, next) => {
      const { broadcasterId, transportId } = req.params
      const { dtlsParameters } = req.body

      try {
        const data = await req.room.connectBroadcasterTransport({
          broadcasterId,
          transportId,
          dtlsParameters,
        })

        res.status(200).json(data)
      } catch (error) {
        next(error)
      }
    }
  )

  /**
   * POST API to create a mediasoup Producer associated to a Broadcaster.
   * The exact Transport in which the Producer must be created is signaled in
   * the URL path. Body parameters include kind and rtpParameters of the
   * Producer.
   */
  expressApp.post(
    '/rooms/:roomId/broadcasters/:broadcasterId/transports/:transportId/producers',
    async (req, res, next) => {
      const { broadcasterId, transportId } = req.params
      const { kind, rtpParameters } = req.body

      try {
        const data = await req.room.createBroadcasterProducer({
          broadcasterId,
          transportId,
          kind,
          rtpParameters,
        })

        res.status(200).json(data)
      } catch (error) {
        next(error)
      }
    }
  )

  /**
   * POST API to create a mediasoup Consumer associated to a Broadcaster.
   * The exact Transport in which the Consumer must be created is signaled in
   * the URL path. Query parameters must include the desired producerId to
   * consume.
   */
  expressApp.post(
    '/rooms/:roomId/broadcasters/:broadcasterId/transports/:transportId/consume',
    async (req, res, next) => {
      const { broadcasterId, transportId } = req.params
      const { producerId } = req.query

      try {
        const data = await req.room.createBroadcasterConsumer({
          broadcasterId,
          transportId,
          producerId,
        })

        res.status(200).json(data)
      } catch (error) {
        next(error)
      }
    }
  )

  /**
   * POST API to create a mediasoup DataConsumer associated to a Broadcaster.
   * The exact Transport in which the DataConsumer must be created is signaled in
   * the URL path. Query body must include the desired producerId to
   * consume.
   */
  expressApp.post(
    '/rooms/:roomId/broadcasters/:broadcasterId/transports/:transportId/consume/data',
    async (req, res, next) => {
      const { broadcasterId, transportId } = req.params
      const { dataProducerId } = req.body

      try {
        const data = await req.room.createBroadcasterDataConsumer({
          broadcasterId,
          transportId,
          dataProducerId,
        })

        res.status(200).json(data)
      } catch (error) {
        next(error)
      }
    }
  )

  /**
   * POST API to create a mediasoup DataProducer associated to a Broadcaster.
   * The exact Transport in which the DataProducer must be created is signaled in
   */
  expressApp.post(
    '/rooms/:roomId/broadcasters/:broadcasterId/transports/:transportId/produce/data',
    async (req, res, next) => {
      const { broadcasterId, transportId } = req.params
      const { label, protocol, sctpStreamParameters, appData } = req.body

      try {
        const data = await req.room.createBroadcasterDataProducer({
          broadcasterId,
          transportId,
          label,
          protocol,
          sctpStreamParameters,
          appData,
        })

        res.status(200).json(data)
      } catch (error) {
        next(error)
      }
    }
  )

  /**
   * Error handler.
   */
  expressApp.use((error, req, res, next) => {
    if (error) {
      logger.warn('Express app %s', String(error))

      error.status = error.status || (error.name === 'TypeError' ? 400 : 500)

      res.statusMessage = error.message
      res.status(error.status).send(String(error))
    } else {
      next()
    }
  })

  return expressApp
}

/**
 * Create a Node.js HTTPS server. It listens in the IP and port given in the
 * configuration file and reuses the Express application as request listener.
 */
async function runHttpsServer() {
  logger.info(`running an HTTPS server... port: ${config.https.listenPort} ip: ${config.https.listenIp} `)

  // HTTPS server for the protoo WebSocket server.
  const tls = {
    cert: fs.readFileSync(config.https.tls.cert),
    key: fs.readFileSync(config.https.tls.key),
  }

  httpsServer = https.createServer(tls, expressApp)

  await new Promise((resolve) => {
    httpsServer.listen(Number(config.https.listenPort), config.https.listenIp, resolve)
  })
  return httpsServer
}

/**
 * Create a protoo WebSocketServer to allow WebSocket connections from browsers.
 */
async function runProtooWebSocketServer() {
  logger.info('running protoo WebSocketServer...')

  // Create the protoo WebSocket server.
  protooWebSocketServer = new protoo.WebSocketServer(httpsServer, {
    maxReceivedFrameSize: 960000, // 960 KBytes.
    maxReceivedMessageSize: 960000,
    fragmentOutgoingMessages: true,
    fragmentationThreshold: 960000,
    enableCors: true,
    corsAllowOrigin: '*',
  })

  // Handle connections from clients.
  protooWebSocketServer.on('connectionrequest', (info, accept, reject) => {
    // The client indicates the roomId and peerId in the URL query.
    const u = url.parse(info.request.url, true)
    const roomId = u.query['roomId']
    const peerId = u.query['peerId']

    if (!roomId || !peerId) {
      reject(400, 'Connection request without roomId and/or peerId')

      return
    }

    let consumerReplicas = Number(u.query['consumerReplicas'])

    if (isNaN(consumerReplicas)) {
      consumerReplicas = 0
    }

    logger.info(
      'protoo connection request [roomId:%s, peerId:%s, address:%s, origin:%s]',
      roomId,
      peerId,
      info.socket.remoteAddress,
      info.origin
    )

    
    // Serialize this code into the queue to avoid that two peers connecting at
    // the same time with the same roomId create two separate rooms with same
    // roomId.
    queue
      .push(async () => {
        const room = await getOrCreateRoom({ roomId, consumerReplicas })
       
        // Accept the protoo WebSocket connection.
        const protooWebSocketTransport = accept()
        const eventNotificationUri = notificationUris.get(roomId);
        room.handleProtooConnection({ peerId, protooWebSocketTransport, eventNotificationUri })

        //send notification to eventNotificationUri
        
        const joinNotificationData = {
          roomId,
          peerId,
          event: 'peer-joined',
        };
        await sendNotification(eventNotificationUri, joinNotificationData);

    })
    .catch((error) => {
      logger.error('room creation or room joining failed:%o', error)
      reject(error)
    })
  })
}

/**
 * Get next mediasoup Worker.
 */
function getMediasoupWorker() {
  const worker = mediasoupWorkers[nextMediasoupWorkerIdx]

  if (++nextMediasoupWorkerIdx === mediasoupWorkers.length) nextMediasoupWorkerIdx = 0

  return worker
}

/**
 * Get a Room instance (or create one if it does not exist).
 */
async function getOrCreateRoom({ roomId, consumerReplicas, maxPeerCount }) {
  let room = rooms.get(roomId)

  // If the Room does not exist create a new one.
  if (!room) {
    logger.info('creating a new Room [roomId:%s]', roomId)

    const mediasoupWorker = getMediasoupWorker()

    room = await Room.create({ mediasoupWorker, roomId, consumerReplicas, maxPeerCount })

    rooms.set(roomId, room)
    room.on('close', () => rooms.delete(roomId))
  }

  return room
}

module.exports = { createExpressApp, interactiveServer, runHttpsServer }
