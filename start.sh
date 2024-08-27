#!/bin/bash

# Function to check the status of the last executed command
check_error() {
  if [ $? -ne 0 ]; then
    echo "Error: $1 failed."
    exit 1
  fi
}

export MEDIASOUP_ANNOUNCED_IP=$(hostname -i)

echo "running mediasoup-demo server.js with ip $MEDIASOUP_ANNOUNCED_IP"

# Run the server
echo "Starting the server..."
node /server/server.js
check_error "Running the server"