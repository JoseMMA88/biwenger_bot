try { require('dotenv').config(); } catch {}

const { Config } = require('./core/config');
const { HttpClient } = require('./core/http');

const { AuthService } = require('./services/auth');
const { MarketService } = require('./services/market');
const { PlayerService } = require('./services/player');

const { BidPolicy } = require('./domain/bidPolicy');
const { BidExecutor } = require('./domain/bidExecutor');

const { App } = require('./app');

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
    console.error('[FATAL]', err);
    process.exit(1);
  });
})();