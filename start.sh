#!/bin/bash

echo "Starting Lavalink with 400MB RAM limit..."
cd /app/lavalink && java -Xmx400M -jar Lavalink.jar &

echo "Waiting 30 seconds for Lavalink to be ready..."
sleep 30

echo "Starting Node.js Bot..."
cd /app && npm start
