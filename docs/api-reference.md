# API Reference

Complete API reference for the Pi RPC HTTP Server.

## Base URL

```
http://localhost:3000
```

## Content Types

- **Request**: `application/json`
- **Streaming Response**: `application/jsonl` (newline-delimited JSON)

## Endpoints

---

### Create Client

Create a new RPC client instance.

**Endpoint**: `POST /clients`

**Request Body**:

```json
{
  "name": "my-assistant",
  "provider": "openai",
  "model": "gpt-4o-mini",
  "cwd": "/path/to/dir",
  "env": {
    "OPENAI_API_KEY": "sk-..."
  },
  "args": ["--no-session"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No | Human-readable identifier (must be unique) |
| `provider` | string | No | LLM provider (openai, anthropic, google, etc.) |
| `model` | string | No | Model identifier |
| `cwd` | string | No | Working directory for agent process |
| `env` | object | No | Environment variables |
| `args` | string[] | No | Additional CLI arguments |
| `cliPath` | string | No | Path to Pi CLI |

**Response** (`201 Created`):

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Example**:

```bash
curl -X POST http://localhost:3000/clients \
  -H "Content-Type: application/json" \
  -d '{"provider":"openai","model":"gpt-4o-mini"}'
```

---

### List Clients

Get all active clients.

**Endpoint**: `GET /clients`

**Response** (`200 OK`):

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "my-assistant",
    "provider": "openai",
    "model": "gpt-4o-mini"
  }
]
```

---

### Get Client

Get details of a specific client.

**Endpoint**: `GET /clients/:id`

**Response** (`200 OK`):

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "my-assistant",
  "provider": "openai",
  "model": "gpt-4o-mini"
}
```

---

### Delete Client

Stop and remove a client.

**Endpoint**: `DELETE /clients/:id`

**Response**:
- `204 No Content` - Success
- `404 Not Found` - Client not found

**Example**:

```bash
curl -X DELETE http://localhost:3000/clients/550e8400-e29b-41d4-a716-446655440000
```

---

### Send Message

Send a message or prompt to a client.

**Endpoint**: `POST /clients/:id/message`

#### Streaming Commands

For `prompt`, `steer`, and `follow_up` commands, response is streamed JSON-L.

**Request Body**:

```json
{
  "type": "prompt",
  "message": "Write a hello world program",
  "images": [
    {
      "type": "image",
      "data": "<base64>",
      "mimeType": "image/png"
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | No | Command type (default: "prompt") |
| `message` | string | Yes* | Message content (*required for prompt/steer/follow_up) |
| `images` | array | No | Image content |

**Response**: `Content-Type: application/jsonl`

Each line is a JSON event:

```json
{"type":"agent_start","timestamp":"..."}
{"type":"message_update","content":"..."}
{"type":"agent_end","timestamp":"..."}
```

**Example**:

```bash
curl -N -X POST http://localhost:3000/clients/550e8400-e29b-41d4-a716-446655440000/message \
  -H "Content-Type: application/json" \
  -d '{"type":"prompt","message":"Hello"}'
```

#### Non-Streaming Commands

For other commands, response is a single JSON object.

**Request Body**:

```json
{
  "type": "bash",
  "command": "ls -la"
}
```

**Response** (`200 OK`):

```json
{
  "type": "bash",
  "result": "total 0\ndrwxr-xr-x  5 user  user  4096 Jan 15 10:00 .\n"
}
```

---

## Supported Commands

### Streaming Commands

| Command | Required Fields | Description |
|---------|----------------|-------------|
| `prompt` | `message` | Send user prompt |
| `steer` | `message` | Steering message while agent runs |
| `follow_up` | `message` | Queued message after agent finishes |

### Non-Streaming Commands

| Command | Required Fields | Description |
|---------|----------------|-------------|
| `abort` | - | Abort current operation |
| `bash` | `command` | Execute bash command |
| `abort_bash` | - | Abort running bash |
| `new_session` | - | Start new session |
| `set_model` | `provider`, `modelId` | Change model |
| `cycle_model` | - | Switch to next model |
| `get_state` | - | Get agent state |
| `set_steering_mode` | `mode` | Set steering mode |
| `set_follow_up_mode` | `mode` | Set follow-up mode |
| `compact` | - | Compact session |
| `set_auto_compaction` | `enabled` | Toggle auto-compaction |
| `set_auto_retry` | `enabled` | Toggle auto-retry |
| `get_session_stats` | - | Get session statistics |
| `export_html` | - | Export session as HTML |
| `switch_session` | `sessionPath` | Switch to session |
| `fork` | `entryId` | Fork at entry |
| `get_fork_messages` | - | Get fork messages |
| `get_last_assistant_text` | - | Get last assistant response |
| `set_session_name` | `name` | Name the session |
| `get_messages` | - | Get all messages |
| `get_commands` | - | Get available commands |

---

## Error Responses

### 400 Bad Request

```json
{
  "error": "Invalid request",
  "message": "Missing required field: message"
}
```

### 404 Not Found

```json
{
  "error": "Not Found",
  "message": "Client not found"
}
```

### 500 Internal Server Error

```json
{
  "error": "Internal Server Error",
  "message": "RPC client error"
}
```

---

## Rate Limiting

Not implemented by default. Add rate limiting middleware if needed:

```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use('/clients', limiter);
```

---

## Authentication

Not implemented by default. Add authentication middleware as needed:

```typescript
app.use('/clients', authMiddleware);
```