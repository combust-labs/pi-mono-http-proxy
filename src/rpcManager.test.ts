// SPDX-License-Identifier: Apache-2.0
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock uuid to avoid ESM import issues
jest.mock('uuid', () => {
  let counter = 0;
  return { v4: () => `mocked-uuid-${counter++}` };
});

import { RpcManager } from './rpcManager';

// Mock the external RpcClient module to avoid spawning real processes
jest.mock('../node_modules/@mariozechner/pi-coding-agent/dist/modes/rpc/rpc-client', () => {
  class MockRpcClient {
    constructor(public options: unknown) {}
    async start() { /* no‑op */ }
    async stop() { /* no‑op */ }
    onEvent(_listener: (event: unknown) => void) { return () => {}; }
    async prompt(_msg: string, _imgs?: unknown) { /* no‑op */ }
  }
  return {
    RpcClient: MockRpcClient,
    RpcClientOptions: {} as unknown,
  };
});

describe('RpcManager.loadFromFile', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpc-config-'));

  afterAll(() => {
    // clean up temporary directory
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('loads valid configuration and creates clients', async () => {
    const configPath = path.join(tmpDir, 'valid-config.json');
    const config = [
      {
        name: 'named-client',
        provider: 'openai',
        model: 'gpt-4o-mini',
      },
      {
        provider: 'anthropic',
        model: 'claude-3',
      },
    ];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

    const manager = new RpcManager();
    await manager.loadFromFile(configPath);

    const list = manager.list();
    // Should contain the named client under its name and the other under a UUID key
    expect(Object.keys(list)).toContain('named-client');
    // There should be exactly two entries
    expect(Object.keys(list).length).toBe(2);
    // Verify that options were stored correctly for the named client
    expect(list['named-client']).toMatchObject({ provider: 'openai', model: 'gpt-4o-mini' });
  });

  test('rejects when JSON is malformed', async () => {
    const badPath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(badPath, '{ this is not valid json', 'utf-8');
    const manager = new RpcManager();
    await expect(manager.loadFromFile(badPath)).rejects.toThrow();
  });

  test('rejects when JSON does not export an array', async () => {
    const notArrayPath = path.join(tmpDir, 'not-array.json');
    fs.writeFileSync(notArrayPath, JSON.stringify({ foo: 'bar' }), 'utf-8');
    const manager = new RpcManager();
    await expect(manager.loadFromFile(notArrayPath)).rejects.toThrow('Configuration file must export an array');
  });
});
