import 'dotenv/config';

import http from 'node:http';

import { createApp } from './bootstrap.js';
import { Logger } from './utils/logger.js';

const PORT = Number(process.env.PORT || process.env.HTTP_PORT || 3000);

let isRunning = false;
let lastResult = null;

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const { method, url } = req;

  if (method === 'GET' && url === '/health') {
    return sendJson(res, 200, {
      status: 'ok',
      lastResult
    });
  }

  if (method === 'POST' && url === '/run') {
    if (isRunning) {
      return sendJson(res, 409, {
        status: 'busy',
        message: 'Run already in progress'
      });
    }

    isRunning = true;

    try {
      const app = createApp();
      const result = await app.run();
      lastResult = {
        ...result,
        executedAt: new Date().toISOString()
      };

      return sendJson(res, 200, {
        status: 'ok',
        ...lastResult
      });
    } catch (error) {
      Logger.error(error);
      return sendJson(res, 500, {
        status: 'error',
        message: error.message
      });
    } finally {
      isRunning = false;
    }
  }

  return sendJson(res, 404, {
    status: 'not_found'
  });
});

server.listen(PORT, () => {
  Logger.info(`[HTTP] Servidor escuchando en puerto ${PORT}`);
});
