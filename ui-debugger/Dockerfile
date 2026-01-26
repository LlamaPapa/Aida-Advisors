# Dockerfile for Railway deployment
# Includes Playwright browsers for UI testing

FROM mcr.microsoft.com/playwright:v1.40.0-jammy

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Railway sets PORT env variable
ENV PORT=3002

# Expose the port
EXPOSE 3002

# Start the server
CMD ["npm", "start"]
