// SPDX-License-Identifier: Apache-2.0
import { createLogger, format, transports } from 'winston';
import type { TransformableInfo } from 'logform';

// Log format: timestamp, colourised level, message and optional meta as JSON
const logFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  format.colorize(),
  format.printf((info: TransformableInfo) => {
    const { timestamp, level, message, ...meta } = info;
    const ts = typeof timestamp === 'string' ? timestamp : String(timestamp);
    const msg = typeof message === 'string' ? message : String(message);
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${ts} ${level.padEnd(7)} ${msg}${metaStr}`;
  })
);

// Log level can be overridden with the LOG_LEVEL environment variable (default: info)
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();

export const logger = createLogger({
  level: LOG_LEVEL,
  format: logFormat,
  transports: [new transports.Console()],
});

export default logger;
