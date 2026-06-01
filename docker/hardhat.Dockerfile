FROM node:20-slim

WORKDIR /app

# Install system deps for Hardhat / native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy blockchain package files first for layer caching
COPY blockchain/package*.json ./
RUN npm install

# Hardhat local network
EXPOSE 8545

# Default: start local Hardhat node
CMD ["npx", "hardhat", "node", "--hostname", "0.0.0.0"]
