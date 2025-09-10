FROM node:18-alpine

# Install required system dependencies
RUN apk add --no-cache \
    git \
    github-cli \
    unzip \
    ca-certificates \
    && rm -rf /var/cache/apk/*

# Create app directory
WORKDIR /usr/src/app

# Copy package.json first for better Docker layer caching
COPY package.json ./

# Copy the main script
COPY claude-profiles.mjs ./

# Make the script executable
RUN chmod +x claude-profiles.mjs

# Create a global symlink for the tool
RUN ln -s /usr/src/app/claude-profiles.mjs /usr/local/bin/claude-profiles

# Set up environment
ENV NODE_ENV=production

# Create directory for Claude configurations
RUN mkdir -p /root/.claude

# Add health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node --check /usr/src/app/claude-profiles.mjs

# Default command shows help
CMD ["claude-profiles", "--help"]