import { pino } from 'pino';
import { config } from './config.js';

const logger = pino({ level: config.LOG_LEVEL });
logger.info({ port: config.MCP_PORT }, 'mcp-server stub (phase 3)');
setInterval(() => undefined, 60_000);
