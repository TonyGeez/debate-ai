# Use official Node.js LTS image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files first to leverage Docker cache
COPY package*.json ./

# Install dependencies (production only for smaller image)
RUN npm ci --only=production

# Copy the rest of the application code
# .dockerignore will prevent .env from being copied
COPY . .

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]