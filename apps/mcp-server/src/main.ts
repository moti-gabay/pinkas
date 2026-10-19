import { createServer } from 'node:http';
import { pino } from 'pino';
import { config } from './config.js';

const logger = pino({ level: config.LOG_LEVEL });

// Phase 3 stub: only the liveness route the compose healthcheck probes. The MCP endpoint replaces the 404.
const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true,"service":"mcp"}');
    return;
  }
  res.writeHead(404).end();
});
server.listen(config.MCP_PORT, config.MCP_HOST, () => {
  logger.info({ host: config.MCP_HOST, port: config.MCP_PORT }, 'mcp-server stub (phase 3)');
});
