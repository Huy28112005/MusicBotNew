# Use a stable Node.js base image
FROM node:20-slim AS base

# Install system dependencies for audio processing and native module building
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    ffmpeg \
    libtool \
    autoconf \
    automake \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies including native ones
# We use --build-from-source if needed, though most have pre-built binaries
RUN npm install

# Copy the rest of the application
COPY . .

# Environment variables
ENV NODE_ENV=production

# Start the application
CMD ["node", "index.js"]
