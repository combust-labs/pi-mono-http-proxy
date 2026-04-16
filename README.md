# Pi RPC HTTP Server

A lightweight **HTTP front‑end** for the Pi coding‑agent's RPC client. The server lets you:

- **Create** a new `RpcClient` instance on demand, passing any of the RPC client options in the request body.
- **Send prompts** (and optional images) to a specific client via a simple `POST` request.
- **Stream** the agent's JSON‑L events back to the HTTP client in real time.
- **Stop** and clean up a client with a `DELETE` request.

Multiple clients can run concurrently; each is kept in memory and identified by a UUID.

---

## Table of Contents
- [Installation](#installation)
- [Running the Server](#running-the-server)
- [API Endpoints](#api-endpoints)
  - [Create a client](#create-a-client)
  - [Delete a client](#delete-a-client)
  - [Send a message](#send-a-message)
- [Configuration](#configuration)
- [Example usage (cURL)](#example-usage-curl)
- [Notes & Limitations](#notes--limitations)

---

## Installation
```bash
# From the repository root
npm install
```

The server is written in TypeScript and compiled to JavaScript in `dist/`.

## Running the Server
```bash
# Development (ts-node, no compilation)
npm run dev

# Production (compiled output)
npm run build && npm start
```
The server listens on `PORT` (default **3000**) and logs the listening address.

---

## API Endpoints
All request/response bodies are JSON unless otherwise noted.

### Create a client
**`POST /clients`**
```json
{
  "name": "my‑assistant",   // optional human‑readable identifier
  "provider": "openai",
  "model": "gpt-4o-mini",
  "cwd": "/my/project",
  "env": { "OPENAI_API_KEY": "sk-..." },
  "args": ["--no-session"]
}
```
- **Body** – any subset of `RpcClientOptions` plus an optional `name` string. If `name` is provided it must be unique among active clients; otherwise a UUID is generated.
- **Response** – `201 Created`
```json
{ "id": "<uuid>" }
```
The response always contains the generated UUID (`id`). The supplied `name` (if any) can be used interchangeably with the UUID for subsequent calls.

### Delete a client
**`DELETE /clients/:id`**
- Stops the underlying RPC process and removes it from memory.
- **Responses**
  - `204 No Content` – client successfully stopped.
  - `404 Not Found` – no client with that UUID.

### Send a message (stream events)
**`POST /clients/:id/message`**
```json
{
  "message": "Explain the quicksort algorithm.",
  "images": []   // optional, array of ImageContent objects
}
```
- **Headers** – `Content-Type: application/json`
- **Response** – `Content-Type: application/jsonl`
  - Each line is a JSON‑encoded `AgentEvent` emitted by the Pi agent (e.g., `message_start`, `message_update`, `agent_end`).
  - The stream ends when an `agent_end` event is received or the client disconnects.
- **Error handling** – on malformed request or missing client a JSON error payload with the appropriate HTTP status is returned.

---

## Configuration
The server itself has minimal configuration; most behaviour is driven by the **RpcClientOptions** supplied when creating a client.

| Option | Description |
|--------|-------------|
| `cliPath` | Path to the Pi CLI entry point (defaults to `dist/cli.js`). |
| `cwd` | Working directory for the spawned agent process. |
| `env` | Environment variables for the child process (e.g., API keys). |
| `provider` | Default LLM provider (`openai`, `anthropic`, `google`, …). |
| `model` | Default model identifier. |
| `args` | Additional CLI flags (e.g., `--no-session`). |

All options are **optional**; omitted values fall back to the Pi defaults.

---

## Example usage (cURL)
```bash
# 1️⃣ Create a client
client_id=$(curl -s -X POST http://localhost:3000/clients \
  -H "Content-Type: application/json" \
  -d '{"provider":"openai","model":"gpt-4o-mini"}' | jq -r .id)

echo "Created client $client_id"

# 2️⃣ Send a prompt and stream events (requires jq for pretty‑printing)
curl -N -X POST http://localhost:3000/clients/$client_id/message \
  -H "Content-Type: application/json" \
  -d '{"message":"Write a short Python script that prints \"Hello, world!\""}' |
  while IFS= read -r line; do
    echo "Event:"; echo "$line" | jq .
  done

# 3️⃣ When done, delete the client
curl -X DELETE http://localhost:3000/clients/$client_id
```
The `-N` flag tells `curl` to **not buffer** the output, allowing you to see events as they arrive.

---

## Notes & Limitations
- Clients are stored **in‑process memory** only. Restarting the server will discard all active clients.
- The server does **not** implement authentication or rate‑limiting – add a reverse proxy or middleware if needed.
- Image handling expects the same shape as `ImageContent` from the Pi SDK (base64 data, MIME type, etc.).
- Because the RPC client streams events over stdout, the HTTP endpoint forwards them unchanged; any client capable of parsing JSONL can consume the stream.

---

## License
This example server is provided under the same license as the surrounding repository (see the root `LICENSE` file).
