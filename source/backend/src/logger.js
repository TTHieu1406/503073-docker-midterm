import pino from 'pino';
import { config } from './config.js';

// Logs go to stdout as JSON: the container runtime collects them, so the app
// never manages log files (twelve-factor app, factor XI).
export const logger = pino({
  level: config.logLevel,
  base: { instance: config.instanceId, version: config.version },
});
