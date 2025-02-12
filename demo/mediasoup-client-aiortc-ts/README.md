# Mediasoup-client-aiortc-ts

This project is a simple demo showcasing how to integrate **mediasoup-client-aiortc** in a Node.js application using TypeScript. It connects to a Mediasoup WebRTC server via a protoo signaling server, creates an aiortc worker (a Python subprocess) to handle WebRTC, and produces media (audio/video) from a remote URL. Additionally, the application exposes a REST API endpoint (`/join-call`) to initiate the call.

---

## Features

- **Protoo Signaling:** Connects to a Mediasoup server using a WebSocket signaling connection (protoo).
- **aiortc Worker:** Spawns a Python subprocess (aiortc) to handle WebRTC functionality.
- **Send Transport:** Creates a send transport (and optionally a receive transport) with TURN support.
- **Media Production:** Produces media tracks from a remote URL (HTTP/HTTPS) using the configured TURN servers.
- **REST API Endpoint:** Exposes a `POST /join-call` endpoint to start the connection process.

---

## Requirements

- **Node.js** (v20 or later recommended)
- **Python 3** (required for aiortc; not supported on Windows)
- A working Mediasoup server with a protoo signaling server.
- A TURN server (e.g., Coturn) properly configured and accessible.  
  _Note: If running behind Kubernetes or a load balancer, ensure that the external IP and port forwarding are correctly configured._

---

## Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/2060-io/webrtc-server.git
   cd webrtc-server/demo/mediasoup-aiortc-demo
   ```

2. **Install dependencies:**

   ```bash
   yarn install
   ```

3. **(Optional) Set environment variables**:

   - `PYTHON`: Path to your Python 3 executable (e.g., /usr/bin/python3).
   - `PYTHON_LOG_TO_STDOUT`: Set to true to output Python logs to the console.
   - `APP_PORT`: Set port of app default 3100

4. **Build the project**:

   ```bash
   yarn install
   ```

5. **Start the REST server:**

   ```bash
       yarn start
   ```

The REST default server will listen on http://localhost:3100

## Usage

## REST API Endpoint: POST `/join-call`

The /join-call endpoint connects to the Mediasoup WebRTC server and plays a video from a default URL. It accepts the following JSON parameters in the request body:

- ws_url (string, required): The WebSocket URL for the protoo signaling server.

```json
{
  "ws_url": "wss://your-protoo-server:443?roomId=yourRoom&peerId=yourPeer"
}
```

## Troubleshooting

- **TURN/ICE Issues**:
  Verify that your TURN server is correctly configured with the correct external IP and that the necessary UDP/TCP ports are open, especially if running behind Kubernetes or a load balancer.

- **Logging**:
  Set PYTHON_LOG_TO_STDOUT=true and use logLevel: "debug" in your worker configuration to obtain detailed logs for troubleshooting ICE negotiation, DTLS handshakes, and candidate gathering.

You can also check out [mediasoup-client-aiortc v3](https://github.com/versatica/mediasoup-client-aiortc/tree/v3).
