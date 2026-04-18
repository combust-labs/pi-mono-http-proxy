# Deployment Guide

This guide covers deploying the Pi RPC HTTP Server in various environments.

## Prerequisites

- Node.js 18+ 
- npm 9+
- Access to Pi CLI or packaged distribution

## Local Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Or build and run production
npm run build
npm start
```

## Production Deployment

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | HTTP server port |
| `LOG_LEVEL` | No | `info` | Winston log level |
| `RPC_CONFIG_PATH` | No | - | Path to auto-start clients JSON |

### Systemd Service

Create `/etc/systemd/system/pi-rpc-http.service`:

```ini
[Unit]
Description=Pi RPC HTTP Server
After=network.target

[Service]
Type=simple
User=nodejs
WorkingDirectory=/opt/pi-rpc-http-server
ExecStart=/usr/bin/npm start
Restart=always
Environment=PORT=3000
Environment=LOG_LEVEL=info

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable pi-rpc-http
sudo systemctl start pi-rpc-http
```

### Docker Deployment

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/
COPY node_modules/ ./node_modules/

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

Build and run:

```bash
docker build -t pi-rpc-http .
docker run -d -p 3000:3000 -e PORT=3000 pi-rpc-http
```

### Docker Compose

```yaml
version: '3.8'

services:
  pi-rpc-http:
    build: .
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - LOG_LEVEL=info
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

## Reverse Proxy

### Nginx

```nginx
server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        
        # For streaming responses
        proxy_buffering off;
        proxy_cache off;
    }
}
```

## Security Considerations

1. **Authentication** - Add authentication middleware or use behind a reverse proxy with auth
2. **Rate Limiting** - Implement rate limiting for API endpoints
3. **TLS/SSL** - Terminate TLS at reverse proxy or load balancer
4. **Network** - Restrict access to trusted networks only
5. **Secrets** - Never commit API keys; use environment variables

## Scaling

- Clients are stored in-memory; use sticky sessions if load balancing
- Consider running multiple instances with a shared state store for client persistence
- Monitor memory usage as each RPC client spawns a child process