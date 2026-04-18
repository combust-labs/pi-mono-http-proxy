# Monitoring

This document covers monitoring and observability for the Pi RPC HTTP Server.

## Logging

The server uses Winston for structured logging.

### Log Levels

| Level | Usage |
|-------|-------|
| `error` | Errors and exceptions |
| `warn` | Warnings (non-fatal issues) |
| `info` | General operational info |
| `debug` | Detailed debugging information |

### Configuration

Set via `LOG_LEVEL` environment variable:

```bash
export LOG_LEVEL=debug  # debug, info, warn, error
```

### Log Format

Logs include:
- Timestamp (ISO 8601)
- Log level
- Message
- Metadata (JSON)

Example output:
```
2024-01-15T10:30:00.000Z info: Server listening on http://0.0.0.0:3000
2024-01-15T10:30:01.000Z info: Client created { id: 'abc-123', provider: 'openai' }
```

## Metrics

The server collects metrics using prom-client. While the `/metrics` endpoint is not exposed by default, you can add it in your application.

### Exposing Metrics

Add a metrics endpoint in your code:

```typescript
import { register } from 'prom-client';

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

### Available Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `http_requests_total` | Counter | Total HTTP requests |
| `http_request_duration_seconds` | Histogram | Request duration |
| `rpc_clients_active` | Gauge | Active RPC clients |
| `rpc_requests_total` | Counter | Total RPC requests by type |

### Custom Metrics

The server tracks:
- Active client count
- Request counts by endpoint
- Error rates

## Health Checks

### Basic Health Check

```bash
curl http://localhost:3000/clients
```

A healthy server responds with JSON (even if empty array).

### Adding a Health Endpoint

```typescript
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    uptime: process.uptime(),
    clients: activeClients.size 
  });
});
```

## Observability Stack

### Recommended Setup

1. **Prometheus** - Metrics collection
2. **Grafana** - Visualization
3. **ELK/EFK Stack** - Log aggregation

### Prometheus Configuration

```yaml
scrape_configs:
  - job_name: 'pi-rpc-http'
    static_configs:
      - targets: ['localhost:3000']
```

### Grafana Dashboard

Import a dashboard with panels for:
- Request rate (requests/sec)
- Error rate (errors/sec)
- Response time (p50, p95, p99)
- Active clients
- Memory usage

## Alerting

### Key Alerts

| Alert | Condition | Severity |
|-------|-----------|----------|
| HighErrorRate | error_rate > 5% for 5m | critical |
| HighLatency | p95_latency > 10s | warning |
| NoClients | active_clients = 0 | info |
| HighMemory | memory_usage > 80% | warning |

## Debugging Endpoints

### Request Tracing

Enable debug logging to trace requests:

```bash
LOG_LEVEL=debug npm start
```

### Client State

Get client information:

```bash
curl http://localhost:3000/clients/<id>/state
```

## Performance Considerations

- Monitor child process count (each RPC client spawns a process)
- Track memory usage per client
- Set up alerts for unusual patterns
- Log correlation IDs for request tracing