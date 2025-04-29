FROM node:22-alpine3.20 AS base

# MPR Setup
WORKDIR /app

# Enable Corepack 
RUN corepack enable

# Copy package.json and pnpm.lock first to leverage Docker layer caching
COPY package.json package.json

# FIXME: pnpm.lock per workspace 
#COPY pnpm-lock.yaml pnpm-lock.yaml

# Run pnpm install after copying only dependency files
RUN pnpm install

# Copy other dependencies and configuration files
COPY ./src ./src
COPY tsconfig.json tsconfig.json
COPY tsconfig.build.json tsconfig.build.json

# Build the project
RUN pnpm build
 
VOLUME /app/dist/config

# Command to run when the container starts
CMD ["pnpm", "start"]
