# Stage 0, build the Webrtc Server 
FROM node:22-slim as builder

# Install DEB dependencies and others.
RUN \
    set -x \
    && apt-get update \
    && apt-get install -y python3 python3-pip && rm -rf /var/lib/apt/lists/*

# MPR Setup
WORKDIR /app

# Copy package.json and yarn.lock first to leverage Docker layer caching
COPY package.json package.json
COPY yarn.lock yarn.lock

# Run yarn install after copying only dependency files
RUN yarn install

# Copy other dependencies and configuration files
COPY ./src ./src
COPY tsconfig.json tsconfig.json
COPY tsconfig.build.json tsconfig.build.json

# Build the project
RUN yarn build

# Define a volume for external configuration files
VOLUME /app/dist/config

# Command to start the application when the container runs
CMD ["yarn", "start"]

