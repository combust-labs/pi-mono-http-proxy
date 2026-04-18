// SPDX-License-Identifier: Apache-2.0
import { v4 as uuidv4 } from 'uuid';

import {
  RpcClient,
  RpcClientOptions,
} from '../node_modules/@mariozechner/pi-coding-agent/dist/modes/rpc/rpc-client';
import { setRpcClients } from './metrics';
import logger from './logger';

/** Internal representation of a stored client */
interface StoredClient {
  client: RpcClient;
  options: RpcClientOptions;
  name?: string;
}

/** Configuration entry for loading from JSON */
type ConfigEntry = RpcClientOptions & { name?: string };

export class RpcManager {
  private clients = new Map<string, StoredClient>();
  private nameToId = new Map<string, string>();

  /** Create and start a new RpcClient with the given options. Returns its UUID. */
  async create(options: RpcClientOptions, name?: string): Promise<string> {
    logger.info('[RpcManager] Creating new client with options:', options);

    // If a name is provided and already exists, reuse the existing client.
    if (name && this.nameToId.has(name)) {
      const existingId = this.nameToId.get(name);
      if (existingId) {
        logger.warn(`[RpcManager] Client name "${name}" already exists, returning existing client id ${existingId}`);
        return existingId;
      }
    }

    // Build a log‑friendly command string.
    const cli = options?.cliPath ?? 'dist/cli.js';
    const cwd = options?.cwd ?? process.cwd();
    const envPairs = options?.env ? Object.entries(options.env).map(([k, v]) => `${k}=${v}`).join(' ') : '';
    const argsStr = (options?.args ?? []).join(' ');
    const cmdLog = `${envPairs ? `${envPairs} ` : ''}${cli} ${argsStr}`.trim();
    logger.info(`[RpcManager] Spawn command: ${cmdLog} (cwd=${cwd})`);

    // Generate a unique UUID for the client.
    let id = uuidv4();
    while (this.clients.has(id)) {
      id = uuidv4();
    }

    // Force RPC mode flag.
    const baseArgs = options?.args ?? [];
    const filtered = baseArgs.filter((arg) => arg !== '--mode' && !arg.startsWith('--mode='));
    const finalArgs = [...filtered, '--mode', 'rpc'];
    const clientOptions = { ...options, args: finalArgs };
    const client = new RpcClient(clientOptions);
    await client.start();

    const stored: StoredClient = { client, options };
    if (name) {
      stored.name = name;
      this.nameToId.set(name, id);
    }
    this.clients.set(id, stored);
    setRpcClients(this.clients.size);
    return id;
  }

  /** Load a JSON configuration file containing an array of client specifications. */
  async loadFromFile(filePath: string): Promise<void> {
    const fs = await import('fs');
    const path = await import('path');
    const absolute = path.resolve(filePath);
    logger.info(`[RpcManager] Loading RPC client configuration from ${absolute}`);

    let raw: string;
    try {
      raw = await fs.promises.readFile(absolute, 'utf-8');
    } catch (err) {
      const e = err as unknown;
      if (e instanceof Error) {
        logger.error(`[RpcManager] Failed to read config file: ${e.message}`);
        throw e;
      }
      logger.error('[RpcManager] Failed to read config file');
      throw e;
    }

    let configs: unknown[];
    try {
      configs = JSON.parse(raw) as unknown[];
    } catch (err) {
      const e = err as unknown;
      if (e instanceof Error) {
        logger.error(`[RpcManager] Invalid JSON in config file: ${e.message}`);
        throw e;
      }
      logger.error('[RpcManager] Invalid JSON in config file');
      throw e;
    }

    if (!Array.isArray(configs)) {
      const msg = 'Configuration file must export an array of client configs';
      logger.error(`[RpcManager] ${msg}`);
      throw new Error(msg);
    }

    for (const cfg of configs) {
      if (typeof cfg !== 'object' || cfg === null) continue;
      const entry = cfg as ConfigEntry;
      const { name, ...options } = entry;
      try {
        const id = await this.create(options, name);
        logger.info(`[RpcManager] Started client ${name ?? id}`);
      } catch (err) {
        const e = err as unknown;
        if (e instanceof Error) {
          logger.error(`[RpcManager] Failed to start client ${name ?? '(unnamed)'}: ${e.message}`);
        } else {
          logger.error(`[RpcManager] Failed to start client ${name ?? '(unnamed)'}: ${String(e)}`);
        }
      }
    }
  }

  /** Return a plain object mapping client identifier (id or name) → options used at creation */
  list(): Record<string, RpcClientOptions> {
    const result: Record<string, RpcClientOptions> = {};
    for (const [id, stored] of this.clients.entries()) {
      const key = stored.name ?? id;
      result[key] = stored.options;
    }
    return result;
  }

  /** Resolve a supplied identifier (uuid or name) to the internal UUID */
  private resolveId(idOrName: string): string | undefined {
    return this.clients.has(idOrName) ? idOrName : this.nameToId.get(idOrName);
  }

  /** Retrieve a client by id or name, or undefined if not found. */
  get(idOrName: string): RpcClient | undefined {
    const id = this.resolveId(idOrName);
    return id ? this.clients.get(id)?.client : undefined;
  }

  /** Stop and remove a client by id or name. Returns true if a client existed. */
  async delete(idOrName: string): Promise<boolean> {
    logger.info(`[RpcManager] Deleting client with identifier: ${idOrName}`);
    const id = this.resolveId(idOrName);
    if (!id) return false;
    const stored = this.clients.get(id);
    if (!stored) return false;
    await stored.client.stop();
    if (stored.name) this.nameToId.delete(stored.name);
    this.clients.delete(id);
    setRpcClients(this.clients.size);
    return true;
  }

  /** Return the stored name for a given UUID, if any */
  getName(id: string): string | undefined {
    return this.clients.get(id)?.name;
  }

  /** Gracefully stop all RPC clients – used during server shutdown */
  async shutdown(): Promise<void> {
    logger.info('[RpcManager] Shutting down all clients');
    const stopPromises: Promise<void>[] = [];
    for (const [id, stored] of this.clients.entries()) {
      stopPromises.push(
        stored.client.stop().catch((err) => {
          logger.error(`[RpcManager] Error stopping client ${id}:`, err);
        })
      );
      if (stored.name) this.nameToId.delete(stored.name);
    }
    await Promise.all(stopPromises);
    this.clients.clear();
    setRpcClients(0);
    logger.info('[RpcManager] Shutdown complete');
  }
}
