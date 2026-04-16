import cors from 'cors';
import express from 'express';

import { RpcManager } from './rpcManager';

import type { ImageContent } from '../node_modules/@mariozechner/pi-ai/dist/types'
import type { RpcClientOptions } from '../node_modules/@mariozechner/pi-coding-agent/dist/modes/rpc/rpc-client'

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const manager = new RpcManager();

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
  const { message, images } = req.body as { message: string; images?: ImageContent[] };
  if (typeof message !== "string") {
    console.warn(`[Message] Invalid message payload for client ${id}`);
    res.status(400).json({ error: "Missing or invalid 'message'" });
    return;
  }

  res.setHeader("Content-Type", "application/jsonl");
  const listener = (event: any) => {
    console.log(`[Message][${id}] Event received:`, event.type);
    try {
      res.write(JSON.stringify(event) + "\n");
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
  // Ensure cleanup on close
  req.on("close", () => {
    if (unsubscribe) unsubscribe();
  });

  try {
    await client.prompt(message, images);
    console.log(`[Message][${id}] Prompt sent, awaiting events`);
    // The response will be streamed via events; we don't wait here.
  } catch (e: any) {
    unsubscribe();
    console.error(`[Message][${id}] Prompt error:`, e);
    res.status(500).json({ error: e.message });
  }
});

const port = process.env.PORT ?? 3000;
app.listen(port, () => {
  console.log(`Pi RPC HTTP server listening on port ${port}`);
});
