# Troubleshooting

Common issues and their solutions for the Pi RPC HTTP Server.

## Server Issues

### Server Won't Start

**Symptom**: `EADDRINUSE` error on port 3000

**Solution**:
```bash
# Find process using port 3000
lsof -i :3000

# Kill the process
kill <PID>

# Or use a different port
PORT=3001 npm start
```

**Symptom**: `Module not found` errors

**Solution**:
```bash
# Rebuild the project
npm run build
```

### Connection Refused

**Symptom**: `ECONNREFUSED` when calling API

**Solution**:
1. Verify server is running: `curl http://localhost:3000/clients`
2. Check firewall rules
3. Verify correct host/port in client

## RPC Client Issues

### Client Creation Fails

**Symptom**: `500 Internal Server Error` on POST /clients

**Possible Causes**:
1. Pi CLI not found - ensure `cliPath` is correct or Pi is installed
2. Invalid configuration - check provider/model values
3. Missing environment variables - verify API keys are set

**Debug**:
```bash
# Enable debug logging
LOG_LEVEL=debug npm start
```

### Message/Prompt Hangs

**Symptom**: POST to /clients/:id/message never returns

**Possible Causes**:
1. LLM provider is unresponsive
2. Network connectivity issues
3. Agent is stuck in a loop

**Solution**:
```bash
# Delete and recreate client
curl -X DELETE http://localhost:3000/clients/<id>
curl -X POST http://localhost:3000/clients -H "Content-Type: application/json" \
  -d '{"provider":"openai","model":"gpt-4o-mini"}'
```

### Stream Events Not Received

**Symptom**: Empty response or no events

**Possible Causes**:
1. Client buffering the response
2. Wrong content-type expected

**Solution**:
```bash
# Use -N flag with curl to disable buffering
curl -N -X POST http://localhost:3000/clients/<id>/message \
  -H "Content-Type: application/json" \
  -d '{"type":"prompt","message":"hello"}'
```

## Memory/Performance Issues

### High Memory Usage

**Symptom**: Server using excessive memory

**Possible Causes**:
1. Too many concurrent clients
2. Large session data
3. Memory leaks in child processes

**Solution**:
- Monitor with `top` or `htop`
- Limit concurrent clients
- Restart server periodically
- Delete unused clients

### Process Won't Exit

**Symptom**: Server doesn't shut down gracefully

**Solution**:
```bash
# Force kill
pkill -f "node dist/index.js"

# Or find and kill
ps aux | grep node
kill -SIGTERM <PID>
```

## Logging

### Where to Find Logs

- Console output (stdout/stderr)
- Systemd journal: `journalctl -u pi-rpc-http -f`
- Docker logs: `docker logs <container>`

### Debug Mode

```bash
# Enable debug logging
export LOG_LEVEL=debug
npm start
```

## Common Error Codes

| Code | Meaning | Solution |
|------|---------|----------|
| 400 | Bad request | Check JSON payload format |
| 404 | Client not found | Verify client ID is correct |
| 500 | Server error | Check logs for details |
| 502 | Bad gateway | Server may be down |
| 504 | Gateway timeout | Request took too long |

## Getting Help

1. Enable debug logging and capture full error
2. Check server logs for stack traces
3. Verify Pi CLI works standalone
4. Test with minimal configuration