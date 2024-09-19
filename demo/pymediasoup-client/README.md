# PyMediasoup Service Client

This is a service designed to connect to a Mediasoup WebRTC server. It allows testing video streaming using a client based on the `pymediasoup` library. The service connects to a specified WebSocket server and plays a video from a provided URL, sending notifications on success or failure of the operation.

## Features

- Connects to a Mediasoup WebRTC server using the specified WebSocket URL.
- Plays a video from a user-defined source URL.
- Sends HTTP `PUT` requests to notify success or failure.
- Runs within a Docker container for easy deployment.
- Configurable using environment variables.

## Requirements

- Python 3.10 or higher
- Docker and Docker Compose
- FFmpeg (included in the Docker container)

## Environment Variables

- `FLASK_APP`: Specifies the entry point for the Flask application (`app.py`).
- `FLASK_ENV`: Sets the environment for Flask (`development`, `production`, `test`).
- `DEFAULT_VIDEO_SRC_URL`: The URL of the video file to be played during the WebRTC session.

## Build and Run with Docker Compose

Use Docker Compose to build and run the service:

    ```bash
    docker-compose up --build

    ```
## Verify the Service

After starting the service, you can access the application app at:


    ```
     http://localhost:5000

    ```
## Usage

`/join-call` Endpoint

- URL: /join-call
- Method: POST
- Description: Connects to a Mediasoup WebRTC server and plays the video specified by DEFAULT_VIDEO_SRC_URL.
- Parameters:
    - ws_url: The WebSocket URL to connect to the Mediasoup server. (Required)
    - success_url: URL to notify when the video finishes successfully. (Required)
    - failure_url: URL to notify if an error occurs. (Required)
- Notifications:The service sends PUT requests to the specified success_url or failure_url after the video finishes playing or if an error occurs.


```bash
   curl -X POST http://localhost:5000/join-call \
  -H "Content-Type: application/json" \
  -d '{
        "ws_url": "wss://example.com/websocket",
        "success_url": "http://localhost:5001/success",
        "failure_url": "http://localhost:5001/failure"
      }'
```  

## Sample Testing Script

- Run Service uses Docker Compose file

```bash
docker compose up
```

- Run script server that receive notifications test

```bash
python3 /test/recev-server.py 
```

- Run script to test folder the /join-call endpoint be called every 20 seconds.

```bash
python3 /test/test-request.py 
```

## How It Works

- The /join-call endpoint is called with a WebSocket URL and optional success and failure URLs.
- The service connects to the Mediasoup WebRTC server and plays the video from the specified URL.
- It sends a PUT request to the success_url if the video plays successfully, or to the failure_url if an error occurs.
- The application logs the progress and status of the WebRTC session and video playback.
