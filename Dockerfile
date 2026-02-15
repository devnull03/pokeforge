FROM node:20-slim

# Install Python3 + pip for Modal CLI (needed by the deploy tool)
RUN apt-get update && \
    apt-get install -y python3 python3-pip python3-venv && \
    python3 -m pip install modal --break-system-packages && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm ci

# Copy source
COPY tsconfig.json ./
COPY src/ src/

EXPOSE 8080

CMD ["npx", "tsx", "src/server.ts", "--http"]
