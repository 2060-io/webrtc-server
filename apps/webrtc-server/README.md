# WebRTC Server with Mediasoup, Docker, Kubernetes, and Turn Server

This application is based on [Mediasoup-demo v3](https://github.com/versatica/mediasoup-demo/tree/v3) and has been modified and customized for 2060.io project.

You can deploy it using Docker or Kubernetes, with integration of the [Coturn](https://github.com/coturn/coturn) server for TURN functionality.

## Table of Contents

- [Pre-requisites](#pre-requisites)
- [Environment Variables](#environment-variables)
- [Solution Architecture Diagram](#solution-architecture-diagram)
- [Configuring TCP Port (Web App and WSS)](#configuring-tcp-port-web-app-and-wss)
- [Docker Build and Deployment](#docker-build-and-deployment)
- [Kubernetes Deployment](#kubernetes-deployment)
- [WebRTC Server API](#webrtc-server-api)
- [ICE Server Configuration](#ice-server-configuration)
- [Protocol Documentation](#protocol-documentation)
- [WebRTC Client Setup](#webrtc-client-setup)

## Pre-requisites

- A Linux server with a public IP address (or an EIP on AWS)
- Docker and Docker Compose for local deployment
- A TURN server with port `3478` forwarded from the public IP (configured within Docker)
- A Mediasoup server running in a container with port `443` forwarded from the public IP

## Environment Variables

Enviroment variables for configuring the `webrtc-server`:

| Variable                 | Description                                                                                              | Default Value                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `PROTOO_LISTEN_PORT`     | Port for the protoo WebSocket server and HTTP API server.                                                | `4443`                              |
| `HTTPS_CERT_FULLCHAIN`   | Path to the fullchain certificate file for HTTPS.                                                        | `<project_dir>/certs/fullchain.pem` |
| `HTTPS_CERT_PRIVKEY`     | Path to the private key file for HTTPS.                                                                  | `<project_dir>/certs/privkey.pem`   |
| `MEDIASOUP_INGRESS_HOST` | Ingress host for the mediasoup client.                                                                   |                                     |
| `MEDIASOUP_MIN_PORT`     | Minimum port for RTC connections in mediasoup.                                                           | `40000`                             |
| `MEDIASOUP_MAX_PORT`     | Maximum port for RTC connections in mediasoup.                                                           | `49999`                             |
| `MEDIASOUP_LISTEN_IP`    | The listening IP for audio/video in mediasoup.                                                           | `0.0.0.0` or `127.0.0.1`            |
| `MEDIASOUP_ANNOUNCED_IP` | Public IP address for audio/video in mediasoup..                                                         |                                     |
| `MEDIASOUP_INGRESS_HOST` | Set Ingress host for /rooms response                                                                     |                                     |
| `LOADBALANCER_URL`       | Specifies the URL of the load balancer responsible for distributing WebRTC rooms among available servers |                                     |
| `SERVICE_URL`            | Defines the base URL of the WebRTC server that registers itself with the load balancer                   |                                     |

To configure and build the `ICE Server`, you can use the following environment variables:

| Variable                           | Description                           | Default Value |
| ---------------------------------- | ------------------------------------- | ------------- |
| `MEDIASOUP_CLIENT_PROTOOPORT`      | Port used for the connection.         | `443`         |
| `MEDIASOUP_CLIENT_ICESERVER_PROTO` | Protocol configuration used (`udp`).  | `udp`         |
| `MEDIASOUP_CLIENT_ICESERVER_PORT`  | Port set in the TURN server.          | `3478`        |
| `MEDIASOUP_CLIENT_ICESERVER_USER`  | Username for the TURN server.         |               |
| `MEDIASOUP_CLIENT_ICESERVER_PASS`  | Password for the TURN server.         |               |
| `MEDIASOUP_CLIENT_ICESERVER_HOST`  | Public IP address of the TURN server. |               |

## Solution Architecture Diagram

![Solution Architecture](docs/image.png)

## Configuring TCP Port (Web App and WSS)

The `PROTOO_LISTEN_PORT` environment variable in `docker-compose.yml` defines the listening port:

```yaml
services:
  mediasoup:
    environment:
      PROTOO_LISTEN_PORT: 443
    ports:
      - '443:4443'
```

:exclamation: If you change this value, you must rebuild the Docker image.

## Docker Build and Deployment

Clone the repository and build the Docker image:

```sh
git clone https://github.com/2060-io/webrtc-server.git
cd package/webrtc-server
docker build . -t 2060-webrtc-server:test
```

Run the application with Docker Compose:

```sh
docker-compose up
```

## Kubernetes Deployment

Ensure that the Kubernetes load balancer allows UDP traffic to the Coturn service nodes. Set the public IP in the `.env` file as `MEDIASOUP_CLIENT_ICESERVER_HOST`.

## WebRTC Server API

### Create Rooms

Creates a new room or retrieves an existing one.

**Request:**

- **Method:** `POST`
- **Endpoint:** `/rooms/:roomId?`
- **Port:** `443`
- **Body:**

```json
{
  "eventNotificationUri": "http://example.com/notification",
  "maxPeerCount": 50
}
```

**Response:**

```json
{
  "protocol": "2060-mediasoup-v1",
  "wsUrl": "wss://localhost:443",
  "roomId": "12345abcde"
}
```

**Also you can use swagger documentation of WebRTC server API visit url:** `https://yourserver-ip/API`.

## ICE Server Configuration

ICE Server settings for WebRTC transport creation:

```json
{
  "iceServers": [
    {
      "urls": "turn:localhost:3478",
      "username": "test",
      "credential": "test123",
      "credentialType": "password"
    }
  ]
}
```

## Protocol Documentation

Refer to the [Mediasoup Server Protocol Guide](./docs/mediasoup-server-protocol.md) for details on Mediasoup's request handling.

## WebRTC Client Setup

Check the [WebRTC Client Setup Guide](./docs/webrtc-client-setup-guide.md) for instructions on setting up a Mediasoup WebRTC client.
