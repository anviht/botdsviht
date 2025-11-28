# Use Node 18 (LTS)
FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Copy package.json and lock first for better caching
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy rest of the sources
COPY . .

# Expose dashboard port if used
EXPOSE 3001

# Use a non-root user for safety
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN chown -R appuser:appgroup /usr/src/app
USER appuser

# Start the bot
CMD ["node", "bot/index.js"]
