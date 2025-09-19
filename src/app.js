import { Logger } from './utils/logger.js';

const { euro } = require('./utils/numbers.js');

class App {
  constructor(config, auth, market, players, policy, executor) {
    this.cfg = config;
    this.auth = auth;
    this.market = market;
    this.players = players;
    this.policy = policy;
    this.executor = executor;
  }

  async run() {
    this.cfg.validate();
    Logger.info('[INIT] Biwenger API bidder starting… DRY_RUN=', this.cfg.DRY_RUN);

    const token = await this.auth.getToken();
    Logger.success('[AUTH] Token obtenido.');

    const auctions = await this.market.getAuctions(token);
    Logger.success(`[MARKET] Auctions detectadas: ${auctions.length}`);

    const candidates = [];

    for (const a of auctions) {
      const playerId = a.playerId ?? a.id ?? a.player?.id;
      const playerName = a.player?.name || a.name || '(sin nombre)';
      if (!playerId) {
        Logger.skip('(sin nombre)', 'no está claro');
        continue;
      }

      const lastBid = a?.lastBid ?? null;

      if (this.policy.isMyLastBid(lastBid, this.cfg.USER_ID)) {
        Logger.skip(`${playerName}, 'última puja es tuya (from.id=${lastBid?.from?.id}).`);
        continue;
      }

      let details;
      try {
        details = await this.players.getDetails(playerId);
      } catch (e) {
        Logger.skip(`${playerName}', '(${playerId}) sin detalles: ${String(e)}`);
        continue;
      }

      const name = details.name || playerName;
      const price = Number(details.price);
      const inc = Number(details.priceIncrement);

      if (!Number.isFinite(price)) {
        Logger.skip(`${name}', 'sin price válido.`);
        continue;
      }

      if (!this.policy.isIncrementCandidate(inc)) {
        Logger.skip(`${name}', 'inc=${inc} < ${this.cfg.INCREMENT_THRESHOLD}`);
        continue;
      }

      const lastBidAmount = Number(a?.lastBid?.amount);
      const bidAmount = this.policy.computeBidAmount(price, Number.isFinite(lastBidAmount) ? lastBidAmount : undefined);

      if (!this.policy.withinCap(bidAmount, price)) {
        const cap = Math.floor(price * this.cfg.MAX_PRICE_MULTIPLIER);
        Logger.skip(`${name}', bid=${bidAmount} excede 150% de price=${price} (cap=${cap}).`);
        continue;
      }

      candidates.push({
        name,
        playerId,
        price,
        inc,
        lastBidAmount: Number.isFinite(lastBidAmount) ? lastBidAmount : null,
        bidAmount
      });
    }

    if (candidates.length === 0) {
      Logger.success('[DONE] No hay candidatos que cumplan las reglas.');
      return;
    }

    candidates.sort((a, b) => (b.inc - a.inc) || (a.bidAmount - b.bidAmount));

    Logger.section('Candidatos');
    for (const c of candidates) {
      Logger.success(`Player ${c.name} ${c.playerId} | price=${euro(c.price)} | inc=${euro(c.inc)} | lastBid=${c.lastBidAmount ? euro(c.lastBidAmount) : '-'} | bid=${euro(c.bidAmount)}`);
    }

    await this.executor.execute(token, candidates);
    Logger.success('[END] Proceso completado.');
  }
}

module.exports = { App };