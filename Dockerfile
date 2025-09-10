FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install git (required for GitHub operations)
RUN apk add --no-cache git

# Copy the claude-profiles script
COPY claude-profiles.mjs .

# Make the script executable
RUN chmod +x claude-profiles.mjs

# Create a non-root user for better security
RUN addgroup -g 1001 -S claude && \
    adduser -S claude -u 1001 -G claude

# Create volume mount points
RUN mkdir -p /home/claude/.claude && \
    chown -R claude:claude /home/claude

# Switch to non-root user
USER claude

# Set environment variables
ENV NODE_ENV=production
ENV HOME=/home/claude

# Create symbolic link for global access
USER root
RUN ln -sf /app/claude-profiles.mjs /usr/local/bin/claude-profiles
USER claude

# Set the default command to show help
CMD ["node", "claude-profiles.mjs", "--help"]