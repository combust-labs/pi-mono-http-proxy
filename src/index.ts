// SPDX-License-Identifier: Apache-2.0
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';

import logger from './logger';
import {
    addBytesReceived, addBytesSent, contentType, incHttpRequests, incMessagesReceived,
    incMessagesSent, incToolCalls, register
} from './metrics';
import { RpcManager } from './rpcManager';

import type { ImageContent } from '../node_modules/@mariozechner/pi-ai/dist/types';
import type { RpcClientOptions } from '../node_modules/@mariozechner/pi-coding-agent/dist/modes/rpc/rpc-client';

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

// Expose Prometheus metrics at /metrics
app.get('/metrics', (req, res, next) => {
  (async () => {
    try {
      const metrics = await register.metrics();
      res.set('Content-Type', contentType);
      res.send(metrics);
    } catch (err) {
      res.status(500).send(`Metrics error: ${err}`);
    }
  })().catch(next);
});
app.use(express.json({ limit: "10mb" }));

// Middleware to record HTTP request metrics after response finishes
app.use((req: Request, res: Response, next: NextFunction) => {
  res.on('finish', () => {
    const route = req.path || req.originalUrl || req.url;
    incHttpRequests(req.method, route, res.statusCode);
  });
  next();
});

const manager = new RpcManager();

// If a configuration file path is provided via environment variable, load and start clients automatically.
// Load RPC client configuration from either an env var or a command‑line flag.
// Flag name: --config (or --rpc-config) – env var RPC_CONFIG_PATH takes precedence.
const configPath = process.env.RPC_CONFIG_PATH ?? flags.config ?? flags.rpcConfig;

// Async initialization: load config (if any) and then start the server
void (async () => {
  if (configPath) {
    try {
      await manager.loadFromFile(configPath);
    } catch (e) {
      logger.error('Failed to load RPC client configuration:', e);
    }
  }
})();
// List existing RPC clients (id -> creation options)
app.get("/clients", (req, res) => {
  const list = manager.list();
  res.json(list);
});

// Create new RPC client
app.post("/clients", (req, res, next) => {
  (async () => {
    try {
      const { name, ...rest } = req.body ?? {};
      const options: RpcClientOptions = rest;
      const id = await manager.create(options, name);
      res.status(201).json({ id });
      logger.info(`[RpcManager] Created client ${name ? `named "${name}"` : `with id ${id}`} `);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  })().catch(next);
});

// Delete RPC client
app.delete("/clients/:id", async (req, res) => {
  const { id } = req.params;
  const ok = await manager.delete(id);
  const name = manager.getName(id);
  if (ok) {
    logger.info(`[RpcManager] Deleted client ${name ? `named "${name}"` : `with id ${id}`} `);
    res.status(204).send();
  } else {
    logger.warn(`[RpcManager] Attempted to delete non‑existent client ${name ? `named "${name}"` : `with id ${id}`} `);
    res.status(404).json({ error: "Client not found" });
  }
});


// Send a message to a client and stream JSONL events
app.post("/clients/:id/message", (req, res, next) => {
  (async () => {
    const { id } = req.params;
    logger.info(`[Message] Received request for client ${id}`);
    const client = manager.get(id);
    if (!client) {
      logger.warn(`[Message] Client not found: ${id}`);
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const payload: unknown = req.body;
    const type = (payload as { type?: string }).type ?? "prompt";

    // Helper to get metric labels for this client
    const getLabels = () => {
      const name = manager.getName(id) ?? id;
      const opts = manager.list()[id] ?? {} as any;
      const provider = opts.provider;
      const model = opts.model ?? '';
      const labels: any = { client: id, name, model };
      if (provider) labels.provider = provider;
      return labels;
    };

    // Prepare response streaming for commands that emit events (prompt, steer, follow_up)
    const streamCommands = new Set(["prompt", "steer", "follow_up"]);

    if (streamCommands.has(type)) {
      const { message, images } = payload as { message: string; images?: ImageContent[] };
      incMessagesSent({ ...getLabels(), type });
      addBytesSent(getLabels(), Buffer.byteLength(JSON.stringify(payload)));

      if (typeof message !== "string") {
        logger.warn(`[Message] Invalid message payload for client ${id}`);
        res.status(400).json({ error: "Missing or invalid 'message'" });
        return;
      }

      res.setHeader("Content-Type", "application/jsonl");
      // Ensure headers are sent immediately so the client can start receiving chunks
      res.flushHeaders();
      const listener = (event: unknown) => {
        logger.debug(`[Message][${id}] Event received:`, JSON.stringify(event));
        try {
          const ev = event as { type: string; toolCall?: { name: string } };
          const eventStr = JSON.stringify(event) + "\n";
          res.write(eventStr);
          incMessagesReceived({ ...getLabels(), type: ev.type });
          addBytesReceived(getLabels(), Buffer.byteLength(eventStr));
          if (ev.type === "toolcall_end" && ev.toolCall?.name) {
            incToolCalls({ ...getLabels(), tool: ev.toolCall.name });
          }
          if (ev.type === "agent_end") {
            logger.info(`[Message][${id}] Agent ended, cleaning up`);
            cleanup();
            res.end();
          }
        } catch (e) {
          // ignore write errors (client disconnect)
        }
      };
      const unsubscribe = client.onEvent(listener);
      const cleanup = () => {
        unsubscribe();
      };
      // Cleanup if the request is aborted
      req.on("aborted", () => {
        logger.warn(`[Message][${id}] Request aborted by client`);
        unsubscribe();
      });
      // Also clean up when the response is closed (e.g., client disconnects after streaming)
      res.on("close", () => {
        logger.warn(`[Message][${id}] Response closed`);
        unsubscribe();
      });

      try {
        if (type === "prompt") {
          await client.prompt(message, images);
        } else if (type === "steer") {
          await client.steer(message, images);
        } else if (type === "follow_up") {
          await client.followUp(message, images);
        }
        logger.info(`[Message][${id}] ${type} sent, awaiting events`);
      } catch (e) {
        unsubscribe();
        if (e instanceof Error) {
          logger.error(`[Message][${id}] ${type} error:`, e);
          res.status(500).json({ error: e.message });
        } else {
          logger.error(`[Message][${id}] ${type} unknown error`, e);
          res.status(500).json({ error: 'Internal server error' });
        }
      }
      return;
    }

    // Non‑streaming commands – handle and respond with JSON
    try {
      let result: unknown;
      switch (type) {
        case "abort":
          await client.abort();
          result = { success: true };
          break;
        case "bash":
          result = await client.bash((payload as any).command);
          break;
        case "abort_bash":
          await client.abortBash();
          result = { success: true };
          break;
        case "new_session":
          result = await client.newSession((payload as any).parentSession);
          break;
        case "set_model":
          result = await client.setModel((payload as any).provider, (payload as any).modelId);
          break;
        case "cycle_model":
          result = await client.cycleModel();
          break;
        case "get_state":
          result = await client.getState();
          break;
        case "set_steering_mode":
          await client.setSteeringMode((payload as any).mode);
          result = { success: true };
          break;
        case "set_follow_up_mode":
          await client.setFollowUpMode((payload as any).mode);
          result = { success: true };
          break;
        case "compact":
          result = await client.compact((payload as any).customInstructions);
          break;
        case "set_auto_compaction":
          await client.setAutoCompaction((payload as any).enabled);
          result = { success: true };
          break;
        case "set_auto_retry":
          await client.setAutoRetry((payload as any).enabled);
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
          result = await client.exportHtml((payload as any).outputPath);
          break;
        case "switch_session":
          result = await client.switchSession((payload as any).sessionPath);
          break;
        case "fork":
          result = await client.fork((payload as any).entryId);
          break;
        case "get_fork_messages":
          result = await client.getForkMessages();
          break;
        case "get_last_assistant_text":
          result = await client.getLastAssistantText();
          break;
        case "set_session_name":
          await client.setSessionName((payload as any).name);
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
      logger.error(`[Message][${id}] Command '${type}' error:`, e);
      res.status(500).json({ error: e.message });
    }
  })().catch(next);
});

// Healthcheck endpoint – returns status and uptime
app.get('/healthz', (req, res) => {
  const uptimeSeconds = Math.floor((Date.now() - serverStartTime) / 1000);
  res.json({ status: 'ok', uptime: `${uptimeSeconds}` });
});

// Start HTTP server after all routes are defined
const server = app.listen(port, host, () => {
  logger.info(`Pi RPC HTTP server listening on ${host}:${port}`);
});

// Graceful shutdown handling
const shutdown = async () => {
  logger.info('Received shutdown signal, closing HTTP server...');
  if (server && (server as any).listening) {
    server.close(async (err) => {
      if (err && (err as any).code !== 'ERR_SERVER_NOT_RUNNING') {
        logger.error('Error closing HTTP server:', err);
      }
      await manager.shutdown();
      process.exit(err ? 1 : 0);
    });
  } else {
    await manager.shutdown();
    process.exit(0);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

process.on('beforeExit', async (code) => {
  logger.info(`Process beforeExit with code ${code}, shutting down RPC clients...`);
  await manager.shutdown();
});
