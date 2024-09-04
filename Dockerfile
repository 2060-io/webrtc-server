	# Stage 0, build the Webrtc Server 
	FROM node:18-slim

	# Install DEB dependencies and others.
	RUN \
		set -x \
		&& apt-get update \
		&& apt-get install -y python3 python3-pip && rm -rf /var/lib/apt/lists/*

	WORKDIR /server

	COPY package.json .
	COPY package-lock.json .
	RUN  npm install
	COPY server.js .
	COPY config.js .
	COPY lib lib
	ADD start.sh .

	CMD ["sh", "/server/start.sh"]

