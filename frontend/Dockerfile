# Frontend Dockerfile - React + Vite + TypeScript (Optimized)
FROM node:20-alpine

WORKDIR /app

# Install dependencies with cache mount
# Using package-lock.json for reproducible builds
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline

# Copy source
COPY . .

# Expose Vite dev server port
EXPOSE 5173

# Development command with hot reload
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
