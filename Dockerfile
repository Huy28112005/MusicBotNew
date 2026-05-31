# Use a stable Node.js base image
FROM node:20-slim AS base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    ffmpeg \
    openjdk-17-jre-headless \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application
COPY . .

# Environment variables
ENV NODE_ENV=production

# Ép Bot nhìn vào port 8080 (Port mặc định của Railway)
ENV LAVALINK_URL=localhost:8080
ENV LAVALINK_PORT=8080

# Script khởi động
RUN echo '#!/bin/sh\n\
echo "Starting Lavalink..."\n\
cd /app/lavalink && java -jar Lavalink.jar &\n\
echo "Waiting for Lavalink to be ready..."\n\
sleep 20\n\
echo "Starting Bot..."\n\
cd /app && node index.js' > /app/start.sh

RUN chmod +x /app/start.sh

CMD ["/app/start.sh"]
