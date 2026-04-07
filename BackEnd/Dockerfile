FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install dependencies first (caching layer)
COPY package.json package-lock.json* ./
RUN npm ci

# Copy the rest of the application
COPY . .

# Set non-root user for security (AWS best practice)
RUN chown -R node:node /app
USER node

# Expose backend port (9000 as per .env, 9001 as fallback)
EXPOSE 9000 9001

# Default entry command
CMD ["npm", "start"]
