import { Logger } from '../utils/logger.js';

import { Euro } from '../utils/numbers.js';

class BidExecutor {
  constructor(config, marketService, policy) {
    this.cfg = config;
    this.market = marketService;
    this.policy = policy;
  }

  async execute(token, candidates) {
    for (const c of candidates) {
      if (this.cfg.DRY_RUN) {
        Logger.info(`[DRY_RUN] Simular puja → ${c.name} (${c.playerId}) por ${Euro(c.bidAmount)}`);
        continue;
      }
      try {
        const out = await this.market.placeBid(token, c.playerId, c.bidAmount);
        Logger.success(`Puja OK (${out.endpoint}) → ${c.name} por ${Euro(c.bidAmount)}`);
      } catch (err) {
        Logger.warn(`Error al pujar ${c.name} por ${Euro(c.bidAmount)}: ${String(err)}`);
      }
    }
  }
}

module.exports = { BidExecutor };