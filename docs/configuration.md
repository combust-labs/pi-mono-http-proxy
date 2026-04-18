# Configuration

Configuration options for the Pi RPC HTTP Server.

## Server Configuration

### Environment Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `PORT` | number | `3000` | HTTP server port |
| `LOG_LEVEL` | string | `info` | Log level (debug, info, warn, error) |
| `RPC_CONFIG_PATH` | string | - | Path to auto-start clients JSON file |

### Setting Environment Variables

**Linux/macOS**:

```bash
export PORT=3000
export LOG_LEVEL=debug
npm start
```

**Windows (PowerShell)**:

```powershell
$env:PORT = 3000
$env:LOG_LEVEL = "debug"
npm start
```

**In package.json scripts**:

```json
{
  "scripts": {
    "start": "PORT=3001 LOG_LEVEL=debug node dist/index.js"
  }
}
```

---

## Client Configuration

When creating a client, pass options in the request body.

### RpcClientOptions

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `cliPath` | string | No | `dist/cli.js` | Path to Pi CLI |
| `cwd` | string | No | process.cwd() | Working directory |
| `env` | object | No | {} | Environment variables |
| `provider` | string | No | - | LLM provider |
| `model` | string | No | - | Model identifier |
| `args` | string[] | No | [] | CLI arguments |

### Providers

Supported providers include:
- `openai` - OpenAI models (GPT-4, GPT-4o, etc.)
- `anthropic` - Anthropic models (Claude)
- `google` - Google models (Gemini)
- `ollama` - Local Ollama models

### Environment Variables for Providers

**OpenAI**:
```json
{
  "provider": "openai",
  "env": { "OPENAI_API_KEY": "sk-..." }
}
```

**Anthropic**:
```json
{
  "provider": "anthropic",
  "model": "claude-3-5-sonnet-20241022",
  "env": { "ANTHROPIC_API_KEY": "sk-ant-..." }
}
```

**Google**:
```json
{
  "provider": "google",
  "model": "gemini-2.0-flash-exp",
  "env": { "GOOGLE_API_KEY": "..." }
}
```

---

## Auto-Start Configuration

Automatically start RPC clients on server launch.

### Setup

1. Create a JSON file with client configurations
2. Set `RPC_CONFIG_PATH` environment variable to the file path

### Configuration File Format

```json
[
  {
    "name": "assistant-openai",
    "provider": "openai",
    "model": "gpt-4o-mini",
    "env": { "OPENAI_API_KEY": "sk-..." }
  },
  {
    "name": "assistant-anthropic",
    "provider": "anthropic",
    "model": "claude-3-5-sonnet-20241022",
    "env": { "ANTHROPIC_API_KEY": "sk-ant-..." },
    "args": ["--no-session"]
  },
  {
    "provider": "google",
    "model": "gemini-2.0-flash-exp",
    "env": { "GOOGLE_API_KEY": "..." }
  }
]
```

### Usage

```bash
RPC_CONFIG_PATH=/etc/pi-rpc/clients.json npm start
```

The server will:
1. Read the configuration file on startup
2. Create each client specified
3. Log success/failure for each client
4. Clients are accessible by `name` or generated UUID

---

## CLI Arguments

Additional arguments passed to the Pi CLI.

| Argument | Description |
|----------|-------------|
| `--no-session` | Run without session persistence |
| `--verbose` | Enable verbose output |
| `--debug` | Enable debug mode |

Example:
```json
{
  "args": ["--no-session", "--verbose"]
}
```

---

## Logging Configuration

### Log Levels

| Level | Usage |
|-------|-------|
| `error` | Only errors |
| `warn` | Warnings and errors |
| `info` | General information (default) |
| `debug` | Detailed debugging output |

### Programmatic Configuration

```typescript
import { logger } from './logger';

// Change log level at runtime
logger.level = 'debug';
```

---

## Advanced Options

### Custom Middleware

Add custom Express middleware:

```typescript
// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Error handling
app.use((err, req, res, next) => {
  logger.error(err.message);
  res.status(500).json({ error: err.message });
});
```

### Custom Metrics Endpoint

```typescript
import { register } from 'prom-client';

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

### Health Check Endpoint

```typescript
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});
```

---

## Security

### Recommended Settings

1. **Never commit secrets** - Use environment variables
2. **Restrict port access** - Use firewall rules
3. **Add authentication** - Implement or use reverse proxy auth
4. **Use TLS** - Terminate SSL at load balancer

### Example: Production Environment

```bash
export PORT=3000
export LOG_LEVEL=warn
export RPC_CONFIG_PATH=/etc/pi-rpc/production-clients.json
```