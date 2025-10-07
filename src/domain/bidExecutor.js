import { Logger } from '../utils/logger.js';

import { Euro } from '../utils/numbers.js';

export class BidExecutor {
  constructor(config, marketService, policy) {
    this.cfg = config;
    this.market = marketService;
    this.policy = policy;
  }

  async execute(token, candidates) {
    for (const c of candidates) {
      if (c.lastBidIsMine) {
        Logger.skip(c.name, 'última puja ya es tuya.');
        continue;
      }

      const readyToBid = this.policy.isReadyToBid(c.auctionUntil);
      if (!readyToBid) {
        const msRemaining = this.policy.timeRemainingMs(c.auctionUntil);
        const minutesLeft = Number.isFinite(msRemaining)
          ? Math.max(0, Math.ceil(msRemaining / 60000))
          : '-';
        const thresholdMinutes = Math.floor(this.cfg.BID_READY_THRESHOLD_MS / 60000);
        Logger.info(
          `[WAIT] ${c.name}: faltan ${minutesLeft} min para alcanzar el umbral de ${thresholdMinutes} min.`
        );
        continue;
      }

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
