# WebRTC Web Client

This is a dockerized version of the Mediasoup web client demo (v3) with ICE server handling, specifically modified for the 2060 project. The primary goal is to decouple the web client from the server, as demonstrated in the original Mediasoup demo.

For this version, the `RoomClient` module has been refactored to fetch the Mediasoup server configuration through the `createWebRtcTransport` request. This configuration includes activating ICE mode and specifying the ICE servers for stream transmission and reception.

## Prerequisites

To run this client with iceServer, you need an online `Mediasoup Server` with ICE parameters configured. Make sure the server's `config.js` file includes the following settings:

```javascript
  "iceServers": [
    {
      "urls": "turn:localhost:3478?transport=udp",
      "username": "test",
      "credential": "test123"
    }
  ],
```

If the `iceServers` attribute is not configured, the transports will be created directly on the Mediasoup server. Otherwise, the transports will be created through the specified TURN server.

## Building with Docker

1. Clone the repository:

   ```bash
   git clone https://github.com/2060-io/webrtc-server
   ```

2. Navigate to the `demo/webtc-client` folder:

   ```bash
   cd demo/webtc-client
   ```

3. Build the Docker image:
   ```bash
   docker build --no-cache -t webrtc-webclient:dev .
   ```

## Running with Docker

1. Before running the application, update the paths in the `docker-compose.yml` file to point to your SSL certificates. As this is a WebRTC application, it must be hosted using HTTPS.

2. Run the application:
   ```bash
   docker-compose up
   ```

### SSL Certificate Configuration

To enable HTTPS for Nginx within the Docker container, provide your SSL certificates in the following locations inside your project:

- **`certs/fullchain.pem`**: Public certificate file.
- **`certs/privkey.pem`**: Private key file for SSL.

Nginx will reference these certificates in the container as follows:

- `/etc/ssl/certs/fullchain.pem`: Public SSL certificate.
- `/etc/ssl/private/privkey.pem`: Private key.

If you don’t have SSL certificates, create folder `certs` and you can generate self-signed ones using the following commands:

```bash
openssl genpkey -algorithm RSA -out privkey.pem
openssl req -new -key privkey.pem -out request.csr
openssl x509 -req -in request.csr -signkey privkey.pem -out fullchain.pem
```

## Testing the WebRTC Web Client

1. Open your browser and navigate to the following URL:

   ```
   https://your_public_ip/?domain=webrtc-server.test&protooPort=443
   ```

2. Replace `webrtc-server.test` with the actual domain of your WebRTC server.
3. Replace `443` with the correct `protooPort` for your WebRTC server.

These two parameters provide the necessary information for the WebRTC client to establish a WebSocket connection with your WebRTC server.
