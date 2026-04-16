import { Counter, Gauge, Registry, collectDefaultMetrics } from 'prom-client';

// Create a dedicated registry to avoid default global metrics clutter
export const register = new Registry();
// Collect default Node.js and process metrics
collectDefaultMetrics({ register });

// Counter for total HTTP requests, labeled by method, route and status code
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests processed by the RPC HTTP server',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

// Counter for messages sent to a client (per client label)
export const messagesSentTotal = new Counter({
  name: 'rpc_client_messages_sent_total',
  help: 'Total number of messages sent to RPC clients',
  labelNames: ['client'],
  registers: [register],
});

// Counter for messages received from a client (per client label)
export const messagesReceivedTotal = new Counter({
  name: 'rpc_client_messages_received_total',
  help: 'Total number of messages received from RPC clients',
  labelNames: ['client'],
  registers: [register],
});

// Counter for bytes sent to a client (per client label)
export const bytesSentTotal = new Counter({
  name: 'rpc_client_bytes_sent_total',
  help: 'Total number of bytes sent to RPC clients',
  labelNames: ['client'],
  registers: [register],
});

// Counter for bytes received from a client (per client label)
export const bytesReceivedTotal = new Counter({
  name: 'rpc_client_bytes_received_total',
  help: 'Total number of bytes received from RPC clients',
  labelNames: ['client'],
  registers: [register],
});

// Gauge for the current number of active RPC clients
export const rpcClientsGauge = new Gauge({
  name: 'rpc_clients_total',
  help: 'Current number of active RPC client instances',
  registers: [register],
});

export function incHttpRequests(method: string, route: string, status: number) {
  httpRequestsTotal.inc({ method, route, status: String(status) });
}

export function incMessagesSent(client: string) {
  messagesSentTotal.inc({ client });
}

export function incMessagesReceived(client: string) {
  messagesReceivedTotal.inc({ client });
}

export function addBytesSent(client: string, bytes: number) {
  bytesSentTotal.inc({ client }, bytes);
}

export function addBytesReceived(client: string, bytes: number) {
  bytesReceivedTotal.inc({ client }, bytes);
}

export function setRpcClients(count: number) {
  rpcClientsGauge.set(count);
}

// Export the content type for convenience
export const contentType = register.contentType;
