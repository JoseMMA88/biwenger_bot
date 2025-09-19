import { logger } from './utils/logger.js';

const { euro } = require('../utils/numbers');

class BidExecutor {
  constructor(config, marketService, policy) {
    this.cfg = config;
    this.market = marketService;
    this.policy = policy;
  }

  async execute(token, candidates) {
    for (const c of candidates) {
      if (this.cfg.DRY_RUN) {
        logger.info(`[DRY_RUN] Simular puja → ${c.name} (${c.playerId}) por ${euro(c.bidAmount)}`);
        continue;
      }
      try {
        const out = await this.market.placeBid(token, c.playerId, c.bidAmount);
        logger.success(`Puja OK (${out.endpoint}) → ${c.name} por ${euro(c.bidAmount)}`);
      } catch (err) {
        logger.warn(`Error al pujar ${c.name} por ${euro(c.bidAmount)}: ${String(err)}`);
      }
    }
  }
}

module.exports = { BidExecutor };