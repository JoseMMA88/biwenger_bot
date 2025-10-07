// src/domain/auctionAnalyzer.js
export class AuctionAnalyzer {
  constructor({ cfg, players, policy, logger }) {
    this.cfg = cfg;
    this.players = players;
    this.policy = policy;
    this.logger = logger;
  }

  /**
   * @param {object} a - auction item del endpoint /api/v2/market
   * @returns {Promise<null | {
   *   name: string, playerId: number, price: number, inc: number,
   *   lastBidAmount: number|null, bidAmount: number
   * }>}
   */
  async analyze(a) {
    const playerId = a?.playerId ?? a?.id ?? a?.player?.id;
    const auctionName = a?.player?.name || a?.name || '(sin nombre)';

    if (!playerId) {
      this.logger.skip('(sin nombre)', 'auction sin playerId claro');
      return null;
    }

    // 1) SIEMPRE PRIMERO: obtener detalles (bloqueante)
    let details;
    try {
      details = await this.players.getDetails(playerId);
    } catch (e) {
      this.logger.skip(`${auctionName}`, `(${playerId}) sin detalles: ${String(e)}`);
      return null;
    }

    const name = details?.name || auctionName;
    const price = Number(details?.price);
    const inc = Number(details?.priceIncrement);

    // 2) Queda poco para que acabe la puja
    const now = Date.now();
    const msLeft = this.policy.timeRemainingMs(a?.until, now);
    if (!Number.isFinite(msLeft)) {
      this.logger.skip(name, 'sin tiempo restante válido.');
      return null;
    }
    if (msLeft <= 0) {
      this.logger.skip(name, 'auction expirada.');
      return null;
    }

    const readyToBid = this.policy.isReadyToBid(a?.until, now);

    // Resto de validaciones basadas en detalles + auction
    const lastBid = a?.lastBid ?? null;
    const lastBidIsMine = this.policy.isMyLastBid(lastBid, this.cfg.USER_ID);

    // 3) Precio válido
    if (!Number.isFinite(price)) {
      this.logger.skip(name, 'sin price válido.');
      return null;
    }

    // 4) Incremento mínimo
    if (!this.policy.isIncrementCandidate(inc)) {
      this.logger.skip(name, `inc=${this.logger.inc(inc)} < ${this.cfg.INCREMENT_THRESHOLD}`);
      return null;
    }

    // 5) Cap de puja
    const lastBidAmount = Number(a?.lastBid?.amount);
    const bidAmount = this.policy.computeBidAmount(
      price,
      Number.isFinite(lastBidAmount) ? lastBidAmount : undefined
    );
    if (!this.policy.withinCap(bidAmount, price)) {
      const cap = Math.floor(price * this.cfg.MAX_PRICE_MULTIPLIER);
      this.logger.skip(name, `bid=${bidAmount} excede 150% de price=${price} (cap=${cap}).`);
      return null;
    }

    // 6) “Libre”: NO debe tener vendedor (user) ni owner
    const hasSellerUser = !!a?.user?.id;
    const hasOwnerTeam = !!a?.player?.owner;
    if (hasSellerUser || hasOwnerTeam) {
      this.logger.skip(name, `NO libre (user=${a?.user?.id ?? '-'}, owner=${hasOwnerTeam ? 'yes' : 'no'})`);
      return null;
    }

    // OK → Candidate
    return {
      name,
      playerId,
      price,
      inc,
      lastBidAmount: Number.isFinite(lastBidAmount) ? lastBidAmount : null,
      bidAmount,
      lastBidIsMine,
      readyToBid,
      timeRemainingMs: msLeft,
      auctionUntil: a?.until ?? null
    };
  }
}
