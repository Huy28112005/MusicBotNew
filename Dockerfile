# Use a stable Node.js base image
FROM node:20-slim AS base

# Install system dependencies
# - ffmpeg: audio processing
# - openjdk-17-jre-headless: required to run Lavalink
# - build-essential/python3: for native node modules
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

# Copy the rest of the application (including the lavalink folder)
COPY . .

# Environment variables
ENV NODE_ENV=production
# Set Lavalink URL to localhost if running in the same container
ENV LAVALINK_URL=localhost:2333

# Create a startup script to run both Lavalink and the Bot
RUN echo '#!/bin/sh\n\
cd /app/lavalink && java -jar Lavalink.jar &\n\
sleep 15\n\
cd /app && node index.js' > /app/start.sh

RUN chmod +x /app/start.sh

# Start the application using the script
CMD ["/app/start.sh"]
