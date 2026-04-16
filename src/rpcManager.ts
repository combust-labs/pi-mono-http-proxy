// SPDX-License-Identifier: Apache-2.0
import { v4 as uuidv4 } from 'uuid';

import {
    RpcClient, RpcClientOptions
} from '../node_modules/@mariozechner/pi-coding-agent/dist/modes/rpc/rpc-client';
import { setRpcClients } from './metrics';

interface StoredClient {
  client: RpcClient;
  options: RpcClientOptions;
  name?: string;
  // optional cleanup if needed
}

export class RpcManager {
  private clients = new Map<string, StoredClient>();

  /** Create and start a new RpcClient with the given options. Returns its UUID. */
  async create(options: RpcClientOptions, name?: string): Promise<string> {
    console.log(`[RpcManager] Creating new client with options:`, options);
    // If a name is provided and already exists, return the existing client's id instead of creating a duplicate.
    if (name && this.nameToId.has(name)) {
      const existingId = this.nameToId.get(name)!;
      console.warn(`[RpcManager] Client name "${name}" already exists, returning existing client id ${existingId}`);
      return existingId;
    }
    // Ensure RPC mode flag is present (already handled in args processing)
    // Build a command string for logging – include cliPath, cwd, env and args
    const cli = options?.cliPath ?? 'dist/cli.js';
    const cwd = options?.cwd ?? process.cwd();
    const envPairs = options?.env ? Object.entries(options.env).map(([k,v])=>`${k}=${v}`).join(' ') : '';
    const argsStr = (options?.args ?? []).join(' ');
    const cmdLog = `${envPairs ? envPairs+' ' : ''}${cli} ${argsStr}`.trim();
    console.log(`[RpcManager] Spawn command: ${cmdLog} (cwd=${cwd})`);
    // Generate a unique UUID; in the extremely unlikely event of a collision, generate a new one.
    let id = uuidv4();
    while (this.clients.has(id)) {
      id = uuidv4();
    }
    // Ensure the RPC client is started in RPC mode, overriding any user‑provided mode.
    const baseArgs = options?.args ?? [];
    // Remove any existing '--mode' flag (both '--mode' and '--mode=...')
    const filtered = baseArgs.filter(arg => {
      if (arg === '--mode') return false;
      if (arg.startsWith('--mode=')) return false;
      return true;
    });
    // Append the required RPC mode flag
    const finalArgs = [...filtered, '--mode', 'rpc'];
    const clientOptions = { ...options, args: finalArgs };
    const client = new RpcClient(clientOptions);
    await client.start();
    const stored: StoredClient = { client, options };
    if (name) {
      // At this point we already know the name is not taken.
      stored.name = name;
      this.nameToId.set(name, id);
    }
    this.clients.set(id, stored);
    // Update gauge for active RPC clients
    setRpcClients(this.clients.size);
    return id;
  }

  /**
   * Load a JSON configuration file that contains an array of client specifications.
   * Each entry may provide a `name` and the `options` required by RpcClient.
   * All clients are started automatically; operations are logged.
   */
  async loadFromFile(filePath: string): Promise<void> {
    const fs = await import('fs');
    const path = await import('path');
    const absolute = path.resolve(filePath);
    console.log(`[RpcManager] Loading RPC client configuration from ${absolute}`);
    let raw: string;
    try {
      raw = await fs.promises.readFile(absolute, 'utf-8');
    } catch (e: any) {
      console.error(`[RpcManager] Failed to read config file: ${e.message}`);
      throw e;
    }
    let configs: any[];
    try {
      configs = JSON.parse(raw);
    } catch (e: any) {
      console.error(`[RpcManager] Invalid JSON in config file: ${e.message}`);
      throw e;
    }
    if (!Array.isArray(configs)) {
      const msg = 'Configuration file must export an array of client configs';
      console.error(`[RpcManager] ${msg}`);
      throw new Error(msg);
    }
    for (const cfg of configs) {
      // Each entry may contain an optional `name` and the rest are RpcClientOptions
      const { name, ...options } = cfg as any;
      try {
        const id = await this.create(options as RpcClientOptions, name);
        console.log(`[RpcManager] Started client ${name ?? id}`);
      } catch (e: any) {
        console.error(`[RpcManager] Failed to start client ${name ?? '(unnamed)'}: ${e.message}`);
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
    if (this.clients.has(idOrName)) return idOrName;
    return this.nameToId.get(idOrName);
  }

  /** Retrieve a client by id or name, or undefined if not found. */
  get(idOrName: string): RpcClient | undefined {
    const id = this.resolveId(idOrName);
    return id ? this.clients.get(id)?.client : undefined;
  }

  /** Stop and remove a client by id or name. Returns true if a client existed. */
  async delete(idOrName: string): Promise<boolean> {
    console.log(`[RpcManager] Deleting client with identifier: ${idOrName}`);
    const id = this.resolveId(idOrName);
    if (!id) return false;
    const stored = this.clients.get(id);
    if (!stored) return false;
    await stored.client.stop();
    if (stored.name) this.nameToId.delete(stored.name);
    this.clients.delete(id);
    // Update gauge after removal
    setRpcClients(this.clients.size);
    return true;
  }

  // Map from custom name → uuid for quick lookup
  private nameToId = new Map<string, string>();

  /** Return the stored name for a given UUID, if any */
  getName(id: string): string | undefined {
    const stored = this.clients.get(id);
    return stored?.name;
  }

  /** Gracefully stop all RPC clients – used during server shutdown */
  async shutdown(): Promise<void> {
    console.log('[RpcManager] Shutting down all clients');
    const stopPromises: Promise<void>[] = [];
    for (const [id, stored] of this.clients.entries()) {
      stopPromises.push(stored.client.stop().catch(e => {
        console.error(`[RpcManager] Error stopping client ${id}:`, e);
      }));
      if (stored.name) this.nameToId.delete(stored.name);
    }
    await Promise.all(stopPromises);
    this.clients.clear();
    setRpcClients(0);
    console.log('[RpcManager] Shutdown complete');
  }

}
