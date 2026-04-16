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

### Convenience script
A helper script is provided at `bin/run.sh` which will install dependencies, build the project, and start the server in one command. Make it executable and run:
```bash
chmod +x bin/run.sh   # one‑time
./bin/run.sh           # install → build → start (default workflow)
# Or pass a custom npm script, e.g.:
./bin/run.sh dev        # runs `npm run dev`
```
The script automatically changes to the repository root before invoking npm, so it works from any location.


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

### Send a message (or other RPC commands)
**`POST /clients/:id/message`**
The body must contain a `type` field that matches one of the RPC commands defined in `rpc.md`. If `type` is omitted it defaults to `"prompt"`.

#### Streaming commands (events are streamed as JSON‑L)
| `type` | Required fields | Description |
|--------|----------------|-------------|
| `prompt` | `message` (string) – optional `images` | Sends a user prompt to the agent. |
| `steer` | `message` (string) – optional `images` | Queues a steering message while the agent is running. |
| `follow_up` | `message` (string) – optional `images` | Queues a follow‑up message to be processed after the agent finishes. |

For these three commands the server streams **events** (`AgentEvent`) back to the client using **JSON‑L** (`Content‑Type: application/jsonl`). Each line is a JSON‑encoded event such as `agent_start`, `message_update`, `agent_end`, etc. The stream ends when an `agent_end` event is received.

#### Non‑streaming commands (JSON response)
For all other RPC commands the request body must include `type` and the command‑specific parameters. The server executes the command and returns a single JSON object:
```json
{ "type": "<command>", "result": <command‑specific‑payload> }
```
Supported non‑streaming commands include (but are not limited to):
- `abort`
- `bash` (requires `command` string)
- `abort_bash`
- `new_session` (optional `parentSession`)
- `set_model` (`provider` & `modelId`)
- `cycle_model`
- `get_state`
- `set_steering_mode` (`mode`)
- `set_follow_up_mode` (`mode`)
- `compact` (optional `customInstructions`)
- `set_auto_compaction` (`enabled`)
- `set_auto_retry` (`enabled`)
- `abort_retry`
- `get_session_stats`
- `export_html` (optional `outputPath`)
- `switch_session` (`sessionPath`)
- `fork` (`entryId`)
- `get_fork_messages`
- `get_last_assistant_text`
- `set_session_name` (`name`)
- `get_messages`
- `get_commands`

**Headers** – `Content-Type: application/json` for the request.

**Error handling** – If the request payload is malformed, a required field is missing, or the client identifier does not exist, the server returns a JSON error with the appropriate HTTP status (400/404/500).
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

### Auto‑start configuration file
The server can automatically start a set of RPC clients on launch when the environment variable `RPC_CONFIG_PATH` points to a JSON file. The file must export an **array** of client specifications. Each entry may contain:

- `name` *(optional)* – a human‑readable identifier. Must be unique among the list.
- `options` – an object matching the `RpcClientOptions` type (same fields described above).

**Example `rpc-clients.json`**
```json
[
  {
    "name": "assistant‑openai",
    "provider": "openai",
    "model": "gpt-4o-mini",
    "env": { "OPENAI_API_KEY": "sk-..." }
  },
  {
    "provider": "anthropic",
    "model": "claude-3-5-sonnet",
    "args": ["--no-session"]
  }
]
```
When the server starts, it will read this file, create each client, and log success or failure. Clients can later be accessed via their `name` (if provided) or the generated UUID.

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
  -d '{"type":"prompt","message":"Write a short Python script that prints \"Hello, world!\""}' |
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
<!-- SPDX-License-Identifier: Apache-2.0 -->
This project is licensed under the Apache License, Version 2.0. See the LICENSE file for details.
