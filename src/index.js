try { require('dotenv').config(); } catch {}

import { Logger } from './utils/logger.js';

import { Config } from './core/config';
import { HttpClient } from './core/http';

import { AuthService } from './services/auth';
import { MarketService } from './services/market';
import { PlayerService } from './services/player';

import { BidPolicy } from './domain/bidPolicy';
import { BidExecutor } from './domain/bidExecutor';

import { App } from './app';

(async function bootstrap() {
  const cfg = new Config(process.env);

  const defaultHeaders = {
    'X-Lang': cfg.X_LANG,
    'X-Version': cfg.X_VERSION,
    'User-Agent': 'Mozilla/5.0',
  };

  const http = new HttpClient(defaultHeaders, cfg.TIMEOUT_MS);
  const auth = new AuthService(cfg);
  const market = new MarketService(cfg, http);
  const players = new PlayerService(cfg, http);
  const policy = new BidPolicy(cfg);
  const executor = new BidExecutor(cfg, market, policy);

  const app = new App(cfg, auth, market, players, policy, executor);

  app.run().catch(err => {
    Logger.error(err);
    process.exit(1);
  });
})();