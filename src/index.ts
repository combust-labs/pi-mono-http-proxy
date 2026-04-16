import cors from 'cors';
import express from 'express';

import { RpcManager } from './rpcManager';

import type { ImageContent } from '../node_modules/@mariozechner/pi-ai/dist/types'
import type { RpcClientOptions } from '../node_modules/@mariozechner/pi-coding-agent/dist/modes/rpc/rpc-client'

import { incHttpRequests, register, contentType, incMessagesSent, incMessagesReceived, addBytesSent, addBytesReceived } from './metrics';

// Simple command‑line flag parsing (e.g., "--port=4000" or "--host=127.0.0.1")
function parseFlags(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--')) {
      const [key, val] = arg.replace(/^--/, '').split('=', 2);
      if (key && val !== undefined) {
        result[key] = val;
      }
    }
  }
  return result;
}

const flags = parseFlags();
// Environment variables take precedence over flags.
const port = process.env.PORT ? Number(process.env.PORT) : (flags.port ? Number(flags.port) : 3000);
const host = process.env.HOST ?? flags.host ?? '0.0.0.0';
const app = express();
// Record server start time for uptime calculation
const serverStartTime = Date.now();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Middleware to record HTTP request metrics after response finishes
app.use((req, res, next) => {
  res.on('finish', () => {
    // Use the matched route if available, otherwise fallback to originalUrl
    const route = (req as any).route?.path || req.originalUrl || req.url;
    incHttpRequests(req.method, route, res.statusCode);
  });
  next();
});

const manager = new RpcManager();

// If a configuration file path is provided via environment variable, load and start clients automatically.
// Load RPC client configuration from either an env var or a command‑line flag.
// Flag name: --config (or --rpc-config) – env var RPC_CONFIG_PATH takes precedence.
const configPath = process.env.RPC_CONFIG_PATH ?? flags.config ?? flags.rpcConfig;
if (configPath) {
  manager.loadFromFile(configPath).catch(e => {
    console.error('Failed to load RPC client configuration:', e);
  });
}

// List existing RPC clients (id -> creation options)
app.get("/clients", (req, res) => {
  const list = manager.list();
  res.json(list);
});

// Create new RPC client
app.post("/clients", async (req, res) => {
  try {
    const { name, ...rest } = req.body ?? {};
    const options: RpcClientOptions = rest;
    const id = await manager.create(options, name);
    res.status(201).json({ id });
    console.log(`[RpcManager] Created client ${name ? `named "${name}"` : `with id ${id}`} `);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Delete RPC client
app.delete("/clients/:id", async (req, res) => {
  const { id } = req.params;
  const ok = await manager.delete(id);
  const name = manager.getName(id);
  if (ok) {
    console.log(`[RpcManager] Deleted client ${name ? `named "${name}"` : `with id ${id}`} `);
    res.status(204).send();
  } else {
    console.warn(`[RpcManager] Attempted to delete non‑existent client ${name ? `named "${name}"` : `with id ${id}`} `);
    res.status(404).json({ error: "Client not found" });
  }
});

// Send a message to a client and stream JSONL events
app.post("/clients/:id/message", async (req, res) => {
  const { id } = req.params;
  console.log(`[Message] Received request for client ${id}`);
  const client = manager.get(id);
  if (!client) {
    console.warn(`[Message] Client not found: ${id}`);
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const payload = req.body as any;
  const type: string = payload.type ?? "prompt";

  // Prepare response streaming for commands that emit events (prompt, steer, follow_up)
  const streamCommands = new Set(["prompt", "steer", "follow_up"]);

  if (streamCommands.has(type)) {
    const { message, images, streamingBehavior } = payload as { message: string; images?: ImageContent[]; streamingBehavior?: string };
    // Increment sent metrics (one message per request)
    incMessagesSent(id);
    // Approximate bytes sent (JSON payload size)
    addBytesSent(id, Buffer.byteLength(JSON.stringify(payload)));

    if (typeof message !== "string") {
      console.warn(`[Message] Invalid message payload for client ${id}`);
      res.status(400).json({ error: "Missing or invalid 'message'" });
      return;
    }

    res.setHeader("Content-Type", "application/jsonl");
    // Ensure headers are sent immediately so the client can start receiving chunks
    res.flushHeaders();
    const listener = (event: any) => {
      // Log the full event for debugging/monitoring purposes
      console.log(`[Message][${id}] Event received:`, JSON.stringify(event));
      try {
        const eventStr = JSON.stringify(event) + "\n";
        res.write(eventStr);
        // Metrics for messages received from client
        incMessagesReceived(id);
        addBytesReceived(id, Buffer.byteLength(eventStr));
        if (event.type === "agent_end") {
          console.log(`[Message][${id}] Agent ended, cleaning up`);
          cleanup();
          res.end();
        }
      } catch (e) {
        // ignore write errors (client disconnect)
      }
    };
    let unsubscribe: (() => void) | undefined;
    const cleanup = () => {
      if (unsubscribe) unsubscribe();
    };
    // Register listener
    unsubscribe = client.onEvent(listener);
    // Cleanup if the request is aborted
    req.on("aborted", () => {
      console.warn(`[Message][${id}] Request aborted by client`);
      if (unsubscribe) unsubscribe();
    });
    // Also clean up when the response is closed (e.g., client disconnects after streaming)
    res.on("close", () => {
      console.warn(`[Message][${id}] Response closed`);
      if (unsubscribe) unsubscribe();
    });

    try {
      if (type === "prompt") {
        await client.prompt(message, images);
      } else if (type === "steer") {
        await client.steer(message, images);
      } else if (type === "follow_up") {
        await client.followUp(message, images);
      }
      console.log(`[Message][${id}] ${type} sent, awaiting events`);
    } catch (e: any) {
      unsubscribe();
      console.error(`[Message][${id}] ${type} error:`, e);
      res.status(500).json({ error: e.message });
    }
    return;
  }

  // Non‑streaming commands – handle and respond with JSON
  try {
    let result: any;
    switch (type) {
      case "abort":
        await client.abort();
        result = { success: true };
        break;
      case "bash":
        result = await client.bash(payload.command);
        break;
      case "abort_bash":
        await client.abortBash();
        result = { success: true };
        break;
      case "new_session":
        result = await client.newSession(payload.parentSession);
        break;
      case "set_model":
        result = await client.setModel(payload.provider, payload.modelId);
        break;
      case "cycle_model":
        result = await client.cycleModel();
        break;
      case "get_state":
        result = await client.getState();
        break;
      case "set_steering_mode":
        await client.setSteeringMode(payload.mode);
        result = { success: true };
        break;
      case "set_follow_up_mode":
        await client.setFollowUpMode(payload.mode);
        result = { success: true };
        break;
      case "compact":
        result = await client.compact(payload.customInstructions);
        break;
      case "set_auto_compaction":
        await client.setAutoCompaction(payload.enabled);
        result = { success: true };
        break;
      case "set_auto_retry":
        await client.setAutoRetry(payload.enabled);
        result = { success: true };
        break;
      case "abort_retry":
        await client.abortRetry();
        result = { success: true };
        break;
      case "get_session_stats":
        result = await client.getSessionStats();
        break;
      case "export_html":
        result = await client.exportHtml(payload.outputPath);
        break;
      case "switch_session":
        result = await client.switchSession(payload.sessionPath);
        break;
      case "fork":
        result = await client.fork(payload.entryId);
        break;
      case "get_fork_messages":
        result = await client.getForkMessages();
        break;
      case "get_last_assistant_text":
        result = await client.getLastAssistantText();
        break;
      case "set_session_name":
        await client.setSessionName(payload.name);
        result = { success: true };
        break;
      case "get_messages":
        result = await client.getMessages();
        break;
      case "get_commands":
        result = await client.getCommands();
        break;
      default:
        res.status(400).json({ error: `Unsupported command type '${type}'` });
        return;
    }
    res.json({ type, result });
  } catch (e: any) {
    console.error(`[Message][${id}] Command '${type}' error:`, e);
    res.status(500).json({ error: e.message });
  }
});

// Healthcheck endpoint – returns status and uptime
app.get('/healthz', (req, res) => {
  const uptimeSeconds = Math.floor((Date.now() - serverStartTime) / 1000);
  res.json({ status: 'ok', uptime: `${uptimeSeconds}` });
});

// (host & port are now defined above after flag parsing)
app.get('/metrics', async (req, res) => {
  try {
    const metrics = await register.metrics();
    res.setHeader('Content-Type', contentType);
    res.end(metrics);
  } catch (e) {
    console.error('Error collecting metrics', e);
    res.status(500).end('Error collecting metrics');
  }
});

const server = app.listen(port, host, () => {
  console.log(`Pi RPC HTTP server listening on ${host}:${port}`);
});

// Graceful shutdown handling
const shutdown = async () => {
  console.log('Received shutdown signal, closing HTTP server...');
  // If the server is not listening, skip close to avoid ERR_SERVER_NOT_RUNNING
  if (server && (server as any).listening) {
    server.close(async (err) => {
      if (err && (err as any).code !== 'ERR_SERVER_NOT_RUNNING') {
        console.error('Error closing HTTP server:', err);
      }
      try {
        await manager.shutdown();
      } catch (e) {
        console.error('Error during RPC manager shutdown:', e);
      }
      process.exit(err ? 1 : 0);
    });
  } else {
    // Server not running; just shut down RPC clients
    try {
      await manager.shutdown();
    } catch (e) {
      console.error('Error during RPC manager shutdown:', e);
    }
    process.exit(0);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Ensure RPC clients are shut down on process exit (e.g., uncaught exceptions)
process.on('beforeExit', async (code) => {
  console.log(`Process beforeExit with code ${code}, shutting down RPC clients...`);
  try {
    await manager.shutdown();
  } catch (e) {
    console.error('Error during RPC manager shutdown on beforeExit:', e);
  }
});

