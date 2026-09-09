# Multi-stage lightweight Dockerfile for Aurora Interruptible Voice Assistant
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application source code
COPY . .

# Expose server port
EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production

# Start command
CMD ["node", "server/server.js"]
