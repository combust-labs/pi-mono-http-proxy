// SPDX-License-Identifier: Apache-2.0
import { createLogger, format, transports } from 'winston';

// Log format: timestamp, colourised level, message and optional meta as JSON
const logFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  format.colorize(),
  format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} ${level.padEnd(7)} ${message}${metaStr}`;
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
