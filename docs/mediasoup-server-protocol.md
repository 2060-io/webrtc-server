# Mediasoup Server Protocol

This document provides detailed explanations of the request methods available in the Mediasoup server implementation.

## Key WebRTC Concepts in Mediasoup

Understanding the following concepts is essential when working with Mediasoup for WebRTC-based applications.

### 1. **rtpCapabilities**

RTP capabilities represent the media capabilities that both the client and server can support for sending and receiving RTP (Real-time Transport Protocol) streams. These capabilities are exchanged between the client and server to ensure they can communicate using compatible media formats.

- **Codecs**: A list of supported audio and video codecs (e.g., VP8, H264, OPUS).
- **RTP Header Extensions**: Optional extensions to RTP packets, which may include additional metadata such as timestamps or coordination for synchronization.
- **RTCP Feedback**: Mechanisms for controlling the flow and quality of media, such as sending requests for keyframes or adjusting the bitrate dynamically.

### 2. **getRouterRtpCapabilities**

This method retrieves the RTP capabilities of the Mediasoup router. The router’s RTP capabilities describe the media codecs and features that the server can handle. The client needs to receive this information before creating a WebRTC transport, as it helps ensure that the client's media codecs and formats are compatible with the server.

- **Purpose**: It is used to determine if the client can send or receive media streams compatible with the server’s supported formats.
- **Why it's important**: Exchanging these capabilities ensures smooth communication between the client and the server, avoiding mismatches in codec configurations or media format expectations.

### 3. **Transports**

In Mediasoup, a **transport** is the mechanism through which media data is sent and received. Transports use WebRTC, and they are responsible for setting up the communication channels between peers. The transport ensures that both sending (producing) and receiving (consuming) media streams occur smoothly.

- **WebRtcTransport**: A specific type of transport that handles sending and receiving media over WebRTC.
- **DTLS (Datagram Transport Layer Security)**: Used by WebRtcTransport for secure communication.
- **ICE (Interactive Connectivity Establishment)**: Ensures that peers can establish a connection even in the presence of NATs or firewalls.

### 4. **Producers**

A **producer** in Mediasoup is an entity responsible for producing media, such as a video or audio stream, and sending it over the transport to other peers. Producers represent the media tracks being sent from the client to the server (e.g., a webcam stream).

- **Kinds**: A producer can produce either `audio` or `video`.
- **RTP Parameters**: These describe how the media is encoded, such as which codec is used and the configuration for the RTP stream.

### 5. **Consumers**

A **consumer** in Mediasoup is an entity that receives media from a producer. Consumers allow a client to subscribe to media streams being sent by another peer in the room. Essentially, consumers are the counterpart to producers, handling the reception and decoding of media.

- **Consumption Process**: When a consumer is created, it subscribes to a producer’s media stream and establishes the necessary transport for receiving the data.
- **Layers**: Consumers may have control over the spatial and temporal layers, especially for video, allowing for quality adjustment based on network conditions.

### 6. **DataProducers and DataConsumers**

- **DataProducer**: Similar to a media producer, but instead of sending audio or video, a DataProducer sends arbitrary data (such as messages) over WebRTC’s data channel.
- **DataConsumer**: This is the receiving end of the data channel, where clients can consume the data being sent by another peer’s DataProducer.

### 7. **RTP Streams and Simulcast**

- **RTP Streams**: These are the actual media packets sent over the network between clients (or clients and servers). In Mediasoup, RTP streams are managed using the `producers` and `consumers`.
- **Simulcast**: Simulcast is a technique where a video producer sends multiple video streams at different resolutions/qualities. This allows the receiving peers to switch between qualities depending on their available bandwidth.

### 8. **SCTP (Stream Control Transmission Protocol)**

- SCTP is used in WebRTC data channels. It's an important protocol for managing reliable or unreliable data transport, commonly used for chat or non-media data transmission.

### 9. **Router**

The **Router** in Mediasoup is responsible for handling the media streams. Each router manages multiple transports, ensuring that the correct media streams are routed between peers. Routers have RTP capabilities that define the codecs and RTP extensions that can be used in a session.

- **Concept**: Routers help establish and maintain efficient communication by ensuring that only compatible media codecs and streams are used. A single Router can manage multiple transports, allowing several peers to connect and share media in a single room.

### 10. **Peer**

A **Peer** represents a participant in a room. Each peer has associated transports, producers, consumers, and data channels. Peers are the core representation of clients in Mediasoup, with each peer interacting with the server by creating transports, producing media, and consuming streams.

- **Concept**: Peers abstract the complexity of each individual participant, encapsulating their media and data streams, and providing a unified interface for managing their session in the room.

### 11. **Room**

A **Room** is the logical space where peers are connected to each other. All transports, producers, and consumers are bound to a specific room. Rooms are created on the server, and clients join rooms to exchange media and data.

- **Concept**: The Room provides a framework for grouping and managing peers, their media streams, and signaling.

### 12. **Observers (Audio/Video Level)**

Mediasoup offers built-in **observers**, such as `AudioLevelObserver` and `ActiveSpeakerObserver`, which can monitor audio and video levels across peers in real time.

- **Concept**: These observers help detect the active speaker, manage dynamic bandwidth adaptation, or monitor audio levels to trigger events like muting/unmuting based on silence detection.

## Request Methods allows Overview

### 1. **getRouterRtpCapabilities**

- **Purpose**: Retrieves the RTP capabilities of the Mediasoup router.
- **Usage**: Helps verify codec compatibility between client and server.

**Example**:

```javascript
const capabilities = await socket.request('getRouterRtpCapabilities');
```

### 2. **join**

- **Purpose**: Allows a peer to join the room.
- **Usage**: Stores client details and notifies existing peers.

**Example**:

```javascript
await socket.request('join', {
  displayName: 'User',
  device: { name: 'Browser', version: 'v1' },
  rtpCapabilities: device.rtpCapabilities,
});
```

### 3. **createWebRtcTransport**

- **Purpose**: Creates a WebRTC transport for sending or receiving media.
- **Usage**: Establishes transport necessary for WebRTC media streams.

**Example**:

```javascript
const transportInfo = await socket.request('createWebRtcTransport', {
  producing: true,
  consuming: false,
});
const transport = device.createSendTransport(transportInfo);
```

### 4. **connectWebRtcTransport**

- **Purpose**: Connects a WebRTC transport using DTLS parameters.
- **Usage**: Necessary after transport creation to establish a secure connection.

**Example**:

```javascript
await socket.request('connectWebRtcTransport', {
  transportId: transport.id,
  dtlsParameters: transport.dtlsParameters,
});
```

### 5. **restartIce**

- **Purpose**: Restarts the ICE process for an existing WebRTC transport.
- **Usage**: Useful when network conditions change.

**Example**:

```javascript
const newIceParams = await socket.request('restartIce', { transportId: transport.id });
transport.restartIce(newIceParams);
```

### 6. **produce**

- **Purpose**: Enables the peer to send (produce) media via the transport.
- **Usage**: Allows the client to send media streams (audio/video).

**Example**:

```javascript
const producer = await transport.produce({ track: videoTrack });
```

### 7. **closeProducer**

- **Purpose**: Closes a media producer.
- **Usage**: Stops sending a media stream from the client.

**Example**:

```javascript
await socket.request('closeProducer', { producerId: producer.id });
```

### 8. **pauseProducer / resumeProducer**

- **Purpose**: Pauses or resumes a media producer.
- **Usage**: Temporarily stops or resumes sending media.

**Example (Pause)**:

```javascript
await socket.request('pauseProducer', { producerId: producer.id });
```

**Example (Resume)**:

```javascript
await socket.request('resumeProducer', { producerId: producer.id });
```

### 9. **pauseConsumer / resumeConsumer**

- **Purpose**: Pauses or resumes a media consumer.
- **Usage**: Controls the reception of media streams from peers.

**Example (Pause)**:

```javascript
await socket.request('pauseConsumer', { consumerId: consumer.id });
```

**Example (Resume)**:

```javascript
await socket.request('resumeConsumer', { consumerId: consumer.id });
```

### 10. **setConsumerPreferredLayers**

- **Purpose**: Sets the preferred layers (video quality) for a consumer.
- **Usage**: Optimizes video quality based on network conditions.

**Example**:

```javascript
await socket.request('setConsumerPreferredLayers', {
  consumerId: consumer.id,
  spatialLayer: 2, // Higher quality
  temporalLayer: 1,
});
```

### 11. **setConsumerPriority**

- **Purpose**: Sets the priority of a media consumer.
- **Usage**: Useful in bandwidth-limited scenarios to prioritize certain streams.

**Example**:

```javascript
await socket.request('setConsumerPriority', { consumerId: consumer.id, priority: 1 });
```

### 12. **requestConsumerKeyFrame**

- **Purpose**: Requests a keyframe from the producer.
- **Usage**: Refreshes the video stream for better quality.

**Example**:

```javascript
await socket.request('requestConsumerKeyFrame', { consumerId: consumer.id });
```

### 13. **produceData**

- **Purpose**: Produces data (non-media) via the WebRTC data channel.
- **Usage**: Used for sending arbitrary data, like chat messages.

**Example**:

```javascript
const dataProducer = await transport.produceData({ label: 'chat' });
```

### 14. **getTransportStats / getProducerStats / getConsumerStats**

- **Purpose**: Retrieves statistics for transports, producers, and consumers.
- **Usage**: Useful for monitoring WebRTC session performance.

**Example** (Transport Stats):

```javascript
const stats = await socket.request('getTransportStats', { transportId: transport.id });
```

**Example** (Producer Stats):

```javascript
const producerStats = await socket.request('getProducerStats', { producerId: producer.id });
```

**Example** (Consumer Stats):

```javascript
const consumerStats = await socket.request('getConsumerStats', { consumerId: consumer.id });
```

### 15. **leaveCall**

- **Purpose**: Allows a peer to notify the server when leaving a call, ensuring resource cleanup and notifying other peers in the room.
- **Usage**: Sends a signal to the server to terminate the peer's session and triggers notifications to other participants.

**Example**:

```javascript
await socket.request('leaveRoom');
```

**Details**:

- **Notification to Peers**: Other peers in the room are notified via the `peerLeft` event.
- **Resource Cleanup**: Cleans up all server-side resources (e.g., transports, producers, consumers) associated with the peer.
- **Room Closure**: If the last peer leaves the room, the server automatically closes it.

---

Each request in this document is vital for managing WebRTC sessions in Mediasoup. From creating transports to controlling media streams, these examples help you understand how to interact with the Mediasoup server using JavaScript.
