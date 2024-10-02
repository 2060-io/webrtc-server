# Stage 0: Build the frontend using Node.js
FROM node:18 AS build-stage

# Set the working directory
WORKDIR /app

# Copy package files and install dependencies
COPY ./package*.json /app/
RUN npm install -g gulp-cli
RUN npm install --legacy-peer-deps

# Copy the remaining application files and build the frontend
COPY . /app/
RUN gulp dist

# Stage 1: Serve the frontend using Nginx
FROM nginx:alpine

# Copy the built frontend files from the previous stage to Nginx
COPY --from=build-stage /app/server/public /usr/share/nginx/html

# Expose port 443 for HTTPS
EXPOSE 443

# Start Nginx in the foreground
CMD ["nginx", "-g", "daemon off;"]
