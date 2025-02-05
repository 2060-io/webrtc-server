import * as os from 'os'

export const config = {
  // Signaling settings (protoo WebSocket server and HTTP API server).
  https: {
    listenIp: '0.0.0.0',
    listenPort: process.env.PROTOO_LISTEN_PORT || 4443,
    tls: {
      cert: process.env.HTTPS_CERT_FULLCHAIN || `${__dirname}/certs/fullchain.pem`,
      key: process.env.HTTPS_CERT_PRIVKEY || `${__dirname}/certs/privkey.pem`,
    },
    ingressHost: process.env.MEDIASOUP_INGRESS_HOST,
    protooPort: process.env.MEDIASOUP_CLIENT_PROTOOPORT,
  },
  iceServers: [
    {
      urls: `turn:${process.env.MEDIASOUP_CLIENT_ICESERVER_HOST}:${process.env.MEDIASOUP_CLIENT_ICESERVER_PORT}?transport=${process.env.MEDIASOUP_CLIENT_ICESERVER_PROTO}`,
      username: process.env.MEDIASOUP_CLIENT_ICESERVER_USER,
      credential: process.env.MEDIASOUP_CLIENT_ICESERVER_PASS,
      credentialType: 'password',
    },
  ],
  // mediasoup settings.
  mediasoup: {
    numWorkers: Object.keys(os.cpus()).length,
    workerSettings: {
      logLevel: 'debug',
      logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp', 'rtx', 'bwe', 'score', 'simulcast', 'svc', 'sctp'],
      rtcMinPort: parseInt(process.env.MEDIASOUP_MIN_PORT || '40000', 10),
      rtcMaxPort: parseInt(process.env.MEDIASOUP_MAX_PORT || '49999', 10),
    },
    routerOptions: {
      mediaCodecs: [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2,
        },
        {
          kind: 'video',
          mimeType: 'video/VP8',
          clockRate: 90000,
          parameters: {
            'x-google-start-bitrate': 1000,
          },
        },
        {
          kind: 'video',
          mimeType: 'video/VP9',
          clockRate: 90000,
          parameters: {
            'profile-id': 2,
            'x-google-start-bitrate': 1000,
          },
        },
        {
          kind: 'video',
          mimeType: 'video/h264',
          clockRate: 90000,
          parameters: {
            'packetization-mode': 1,
            'profile-level-id': '4d0032',
            'level-asymmetry-allowed': 1,
            'x-google-start-bitrate': 1000,
          },
        },
        {
          kind: 'video',
          mimeType: 'video/h264',
          clockRate: 90000,
          parameters: {
            'packetization-mode': 1,
            'profile-level-id': '42e01f',
            'level-asymmetry-allowed': 1,
            'x-google-start-bitrate': 1000,
          },
        },
      ],
    },
    webRtcServerOptions: {
      listenInfos: [
        {
          protocol: 'udp',
          ip: process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0',
          announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP,
          port: 44444,
        },
        {
          protocol: 'tcp',
          ip: process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0',
          announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP,
          port: 44444,
        },
      ],
    },
    webRtcTransportOptions: {
      listenIps: [
        {
          ip: process.env.MEDIASOUP_LISTEN_IP || '127.0.0.1',
          announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP,
        },
      ],
      initialAvailableOutgoingBitrate: 1000000,
      minimumAvailableOutgoingBitrate: 600000,
      maxSctpMessageSize: 262144,
      maxIncomingBitrate: 5000000,
    },
    plainTransportOptions: {
      listenIp: {
        ip: process.env.MEDIASOUP_LISTEN_IP || '127.0.0.1',
        announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP,
      },
      maxSctpMessageSize: 262144,
    },
    pipeTransportOptions: {
      listenIp: { ip: '0.0.0.0', announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1' },
      enableSrtp: true,
      enableRtx: true,
    },
  },
}
