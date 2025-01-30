FROM node:22-alpine3.20 AS base

# MPR Setup
WORKDIR /app

# Copy package.json and yarn.lock first to leverage Docker layer caching
COPY package.json package.json

# FIXME: yarn.lock per workspace 
#COPY yarn.lock yarn.lock

# Run yarn install after copying only dependency files
RUN yarn install

# Copy other dependencies and configuration files
COPY ./src ./src
COPY tsconfig.json tsconfig.json
COPY tsconfig.build.json tsconfig.build.json

# Build the project
RUN yarn build
 
VOLUME /app/dist/config

# Command to run when the container starts
CMD ["yarn", "start"]
