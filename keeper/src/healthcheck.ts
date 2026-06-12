/**
 * HTTP healthcheck server.
 * GET /health → { status: 'ok' | 'degraded', components: {...} }
 * GET /ready  → 200 when keeper loop is running, 503 otherwise.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { log } from './logger.js';

export interface ComponentStatus {
  watcher: 'running' | 'stopped' | 'error';
  roller: 'idle' | 'rolling' | 'error';
  ltvWatchdog: 'running' | 'stopped' | 'error';
  redis: 'connected' | 'disconnected';
}

let _status: ComponentStatus = {
  watcher: 'stopped',
  roller: 'idle',
  ltvWatchdog: 'stopped',
  redis: 'disconnected',
};

export function updateStatus(partial: Partial<ComponentStatus>) {
  _status = { ..._status, ...partial };
}

export function getStatus(): ComponentStatus {
  return { ..._status };
}

function isHealthy(s: ComponentStatus): boolean {
  return s.watcher === 'running' && s.ltvWatchdog === 'running';
}

function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const status = getStatus();
  const healthy = isHealthy(status);

  if (req.url === '/health') {
    const code = healthy ? 200 : 503;
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: healthy ? 'ok' : 'degraded', components: status }));
    return;
  }

  if (req.url === '/ready') {
    res.writeHead(healthy ? 200 : 503);
    res.end(healthy ? 'ready' : 'not ready');
    return;
  }

  res.writeHead(404);
  res.end('not found');
}

export function startHealthcheck(port = 8080): () => void {
  const server = createServer(handleRequest);
  server.listen(port, () => {
    log.info('Healthcheck listening', { port });
  });
  server.on('error', (err) => log.error('Healthcheck server error', { error: err.message }));

  return () => {
    server.close();
    log.info('Healthcheck stopped');
  };
}
