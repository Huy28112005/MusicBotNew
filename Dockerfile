FROM node:20-slim

# Cài đặt Java 21, dos2unix và các công cụ build
RUN apt-get update && apt-get install -y \
    openjdk-17-jre-headless \
    dos2unix \
    python3 \
    make \
    g++ \
    ffmpeg \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy files
COPY package*.json ./
RUN npm install

COPY . .

# Sửa lỗi định dạng file script và cấp quyền (giống cấu hình cũ của bạn)
RUN dos2unix Dockerfile && \
    find . -type f -name "*.sh" -exec dos2unix {} + && \
    chmod +x start.sh

# Đồng nhất port bot nhìn vào port 2333 của Lavalink
ENV LAVALINK_URL=localhost:2333

CMD ["./start.sh"]
