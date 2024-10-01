let protooPortDefault = process.env.MEDIASOUP_CLIENT_PROTOOPORT || 4443;
console.log('**protooPortDefault %s**', protooPortDefault);

if (window.location.hostname === 'test.mediasoup.org') protooPort = 4444;

export function getProtooUrl({ roomId, peerId, consumerReplicas, domain, protooPort }) {
  
  const hostname = domain || process.env.DOMAIN || window.location.hostname;
  const port = protooPort || protooPortDefault;

  console.log('**protooPort: %s**', port);

  return `wss://${hostname}:${port}/?roomId=${roomId}&peerId=${peerId}&consumerReplicas=${consumerReplicas}`;
}
