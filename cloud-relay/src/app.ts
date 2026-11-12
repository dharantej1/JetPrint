import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, { type Express } from 'express';
import { loadConfig, type RelayConfig } from './config.js';
import { createApiRouter, type RawBodyRequest } from './routes/api.js';
import { RelayStore } from './store.js';
import { KioskWsHub } from './ws.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '../public');

export interface RelayServerInstance {
  app: Express;
  httpServer: http.Server;
  store: RelayStore;
  wsHub: KioskWsHub;
  config: RelayConfig;
  start: () => Promise<number>;
  close: () => Promise<void>;
}

export function createRelayServer(
  configOverrides: Partial<RelayConfig> = {}
): RelayServerInstance {
  const config = loadConfig(configOverrides);
  const store = new RelayStore(config);
  const app = express();
  const httpServer = http.createServer(app);
  const wsHub = new KioskWsHub(httpServer, store, config);

  app.set('trust proxy', 1);
  app.use(cors());
  app.use(
    express.json({
      limit: '2mb',
      verify: (req, _res, buf) => {
        (req as RawBodyRequest).rawBody = buf;
      },
    })
  );

  app.use('/api', createApiRouter(config, store, wsHub));

  app.use(express.static(PUBLIC_DIR));

  app.get('/upload', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  app.get('/', (req, res) => {
    const qs = req.originalUrl.includes('?')
      ? req.originalUrl.slice(req.originalUrl.indexOf('?'))
      : '';
    res.redirect(`/upload${qs}`);
  });

  const start = (): Promise<number> => {
    store.startCleanupLoop();
    return new Promise((resolve) => {
      httpServer.listen(config.port, () => {
        const addr = httpServer.address();
        const boundPort =
          typeof addr === 'object' && addr ? addr.port : config.port;
        resolve(boundPort);
      });
    });
  };

  const close = (): Promise<void> => {
    store.stopCleanupLoop();
    wsHub.close();
    return new Promise((resolve, reject) => {
      httpServer.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  };

  return { app, httpServer, store, wsHub, config, start, close };
}
