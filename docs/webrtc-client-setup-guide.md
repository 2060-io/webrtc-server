
# WebRTC Client Setup with Mediasoup

This guide will walk you through setting up a WebRTC client for emitting and receiving video using Mediasoup, 
based on implementations in both JavaScript (using mediasoup-client) and Python (using aiortc).

## Prerequisites

### JavaScript Requirements
- Node.js (v16 or later)
- npm/yarn (for dependency management)
- Web browser with WebRTC support (e.g., Chrome, Firefox)

### Python Requirements
- Python (v3.10 or later)
- pip for installing dependencies
- WebSocket server for signaling

### Server Requirements
- Webrtc-server V 1.0.0
- WebSocket Server for signaling (e.g., protoo server)

---

## 1. WebRTC Setup (JavaScript)

### Installing Dependencies

In your project directory, install the necessary dependencies:

```bash
npm install mediasoup-client protoo-client
```

### Initialization of RoomClient

`RoomClient.js` is the core JavaScript file used to manage WebRTC connections, handle media streaming (both sending and receiving), and WebSocket signaling with the server.

### Steps to Set Up:

1. **Initialize WebSocket connection**:
   Use the `protoo-client` library to establish a WebSocket connection for signaling.
   
2. **Mediasoup device setup**:
   Create a `mediasoup-client.Device` instance that handles the connection setup and capabilities.
   
3. **Transport creation**:
   Set up `SendTransport` and `RecvTransport` for transmitting and receiving media streams.

4. **Get media (video/audio)**:
   Capture the video from the user's webcam and add it to the transport for transmission to the server.

5. **Receive remote media**:
   Listen for the remote stream from the server and display it on the client.


### Example Code (JavaScript):

```javascript
import protooClient from 'protoo-client';
import * as mediasoupClient from 'mediasoup-client';

const wsUrl = 'wss://your-signaling-server-url';
const ws = new protooClient.Peer(new protooClient.WebSocketTransport(wsUrl));

ws.on('open', async () => {
  const device = new mediasoupClient.Device();

  // Get RTP capabilities from server
  const routerRtpCapabilities = await ws.request('getRouterRtpCapabilities');
  await device.load({ routerRtpCapabilities });

  // Create transports for sending and receiving media
  const sendTransport = await createTransport(device, true);
  const recvTransport = await createTransport(device, false);

  // Get user media and produce video
  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  const videoTrack = stream.getVideoTracks()[0];
  await sendTransport.produce({ track: videoTrack });

  // Consume remote video from server
  const { producerId } = await ws.request('produce', { transportId: sendTransport.id });
  const consumer = await recvTransport.consume({ producerId, rtpCapabilities: device.rtpCapabilities });
  
  const remoteStream = new MediaStream();
  remoteStream.addTrack(consumer.track);
  document.querySelector('video#remote').srcObject = remoteStream;
});

async function createTransport(device, isSend) {
  const transportInfo = await ws.request('createWebRtcTransport', { isSend });
  const transport = device.createSendTransport(transportInfo);
  transport.on('connect', ({ dtlsParameters }, callback, errback) => {
    ws.request('connectWebRtcTransport', { dtlsParameters })
      .then(callback)
      .catch(errback);
  });
  return transport;
}
```

### Explanation:
- **WebSocket signaling**: Establishes the signaling connection to the server via WebSocket.
- **Mediasoup device**: Handles WebRTC capabilities and device setup.
- **Media transport**: Sends and receives video streams using Mediasoup transports.

---

## 2. WebRTC Setup (Python)

In Python, we use `pymediasoup` to manage WebRTC connections, signaling, and media transport.

### Installing Dependencies

```bash
pip install pymediasoup websockets
```

### Steps to Set Up:

1. **Establish WebSocket signaling**:
   Connect to the server using the `websockets` library to handle WebSocket communication for signaling.

2. **Create WebRTC peer connection**:
    Use pymediasoup to manage the WebRTC connection on the client.

3. **Capture local media**:
   Capture the local video from the webcam and add it to the peer connection.

4. **Join the room and start producing media**:
   Once the connection is established, produce media (audio/video) to the server.

5. **Receive remote media**:
   Listen for the incoming remote media streams from the server.

### Example Code (Python):

```python
import sys
import json
import asyncio
import websockets
import secrets
from pymediasoup import Device
from pymediasoup.transport import Transport
from pymediasoup.consumer import Consumer
from pymediasoup.producer import Producer

async def connect():
    uri = "wss://your-signaling-server-url"
    async with websockets.connect(uri) as websocket:
        # Initialize Device
        device = Device()

        # Get Router RTP capabilities
        reqId = generate_random_number()
        await send_request(websocket, reqId, "getRouterRtpCapabilities", {})
        ans = await wait_for_response(websocket, reqId)
        await device.load(ans["data"])

        # Create send transport
        send_transport = await create_send_transport(websocket, device)
        
        # Capture local media and produce video and audio
        video_producer, audio_producer = await produce_media(send_transport)

        # Create receive transport and consume remote media
        recv_transport = await create_recv_transport(websocket, device)
        await consume_media(recv_transport, websocket)

        # Close transport and producers after media consumption
        await close_transports([send_transport, recv_transport])

async def create_send_transport(websocket, device):
    reqId = generate_random_number()
    await send_request(websocket, reqId, "createWebRtcTransport", {
        "forceTcp": False, 
        "producing": True, 
        "consuming": False
    })
    ans = await wait_for_response(websocket, reqId)

    send_transport = device.createSendTransport(
        id=ans["data"]["id"],
        iceParameters=ans["data"]["iceParameters"],
        iceCandidates=ans["data"]["iceCandidates"],
        dtlsParameters=ans["data"]["dtlsParameters"]
    )

    @send_transport.on("connect")
    async def on_connect(dtlsParameters):
        reqId = generate_random_number()
        await send_request(websocket, reqId, "connectWebRtcTransport", {
            "transportId": send_transport.id, 
            "dtlsParameters": dtlsParameters.dict(exclude_none=True)
        })
        await wait_for_response(websocket, reqId)

    return send_transport

async def produce_media(transport):
    # Here we assume you have a method to get local media (video and audio tracks)
    video_track = await get_local_video_track()
    audio_track = await get_local_audio_track()

    video_producer = await transport.produce(track=video_track)
    audio_producer = await transport.produce(track=audio_track)

    return video_producer, audio_producer

async def create_recv_transport(websocket, device):
    reqId = generate_random_number()
    await send_request(websocket, reqId, "createWebRtcTransport", {
        "forceTcp": False,
        "producing": False,
        "consuming": True
    })
    ans = await wait_for_response(websocket, reqId)

    recv_transport = device.createRecvTransport(
        id=ans["data"]["id"],
        iceParameters=ans["data"]["iceParameters"],
        iceCandidates=ans["data"]["iceCandidates"],
        dtlsParameters=ans["data"]["dtlsParameters"]
    )

    @recv_transport.on("connect")
    async def on_connect(dtlsParameters):
        reqId = generate_random_number()
        await send_request(websocket, reqId, "connectWebRtcTransport", {
            "transportId": recv_transport.id, 
            "dtlsParameters": dtlsParameters.dict(exclude_none=True)
        })
        await wait_for_response(websocket, reqId)

    return recv_transport

async def consume_media(transport, websocket):
    reqId = generate_random_number()
    await send_request(websocket, reqId, "consume", {
        "transportId": transport.id,
        # Additional data like producerId, kind, and rtpParameters should come from the server
    })
    ans = await wait_for_response(websocket, reqId)

    consumer = await transport.consume(
        id=ans["data"]["id"], 
        producerId=ans["data"]["producerId"], 
        kind=ans["data"]["kind"], 
        rtpParameters=ans["data"]["rtpParameters"]
    )

    return consumer

async def send_request(websocket, reqId, method, data):
    request = {
        "request": True,
        "id": reqId,
        "method": method,
        "data": data
    }
    await websocket.send(json.dumps(request))

async def wait_for_response(websocket, reqId):
    while True:
        response = json.loads(await websocket.recv())
        if response.get("id") == reqId:
            return response

def generate_random_number():
    return secrets.randbelow(1000000)

async def close_transports(transports):
    for transport in transports:
        await transport.close()

async def get_local_video_track():
    # Simulate getting video from an internet source (e.g., a video file)
    # This could be any local or remote file (e.g., an MP4 file)
    player = MediaPlayer('/path/to/video.mp4')  # Replace with the path to your video file or url
    return player.video

async def get_local_audio_track():
    # Simulate getting audio from an internet source (e.g., an audio file)
    # You can use the same player for both video and audio if the file has both
    player = MediaPlayer('/path/to/video.mp4')  # Replace with the path to your video file
    return player.audio

asyncio.run(connect())
```

### Explanation:

- **Signaling**: Uses WebSockets to communicate with the signaling server.
- **WebRTC connection**:Manages the peer connection using `pymediasoup.Device`.
- **Media transmission**: Capture local media and send it over the WebRTC connection.

---

## 3. Running the Example

### JavaScript

To run the JavaScript example, open your HTML file in a browser and include the following:

```html
<video id="remote" autoplay></video>
<script src="client.js"></script>
```

Make sure the `client.js` script contains the code from the JavaScript example above.

### Python

Run the Python WebRTC client with the following command:

```bash
python3 client.py
```

Make sure to replace `your-signaling-server-url` with your actual WebSocket signaling server URL.

---

## Client Websocket Request Added


#### **Sending the `leaveRoom` Request**

```javascript
await ws.request('leaveRoom');
```

#### **Listening for the `peerLeft` Notification**

```javascript
socket.on('peerLeft', ({ peerId }) => {
  console.log(`Peer ${peerId} has left the room`);
  // Update the UI to reflect the departure
});
```

This ensures that all participants are informed when a peer leaves, and the UI can be updated accordingly.

---

With this method, the Mediasoup server ensures efficient handling of call termination scenarios and provides a seamless experience for all peers.

## Conclusion

By following this guide, you will have a fully functional WebRTC client implemented in both JavaScript and Python, 
using Mediasoup for media transport and WebSocket signaling.