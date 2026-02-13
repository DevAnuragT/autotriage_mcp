# Multi-stage build for GitHub Triage MCP Server
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (skip scripts to avoid running prepare before source is copied)
RUN npm install --ignore-scripts

# Copy source
COPY src ./src

# Build
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only (skip prepare script)
RUN npm install --omit=dev --ignore-scripts

# Copy built files from builder
COPY --from=builder /app/build ./build

# Expose port for SSE transport (Archestra compatibility)
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV MCP_TRANSPORT=sse
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"

# Run the server
CMD ["node", "build/index.js"]
