import { Euro } from './utils/numbers.js';
import { AuctionAnalyzer } from './domain/auctionAnalizer.js';

export class App {
  constructor(config, auth, market, players, policy, executor, logger) {
    this.cfg = config;
    this.auth = auth;
    this.market = market;
    this.players = players;
    this.policy = policy;
    this.executor = executor;
    this.logger = logger;

    this.analyzer = new AuctionAnalyzer({
      cfg: this.cfg,
      players: this.players,
      policy: this.policy,
      logger: this.logger
    });
  }

  async run() {
    this.cfg.validate();
    this.logger.info('[INIT] Biwenger API bidder starting… DRY_RUN=', this.cfg.DRY_RUN);

    const token = await this.auth.getToken();
    this.logger.success('[AUTH] Token obtenido.');

    const auctions = await this.market.getAuctions(token);
    this.logger.success(`[MARKET] Auctions detectadas: ${auctions.length}`);

    const candidates = [];

    for (const a of auctions) {
      const candidate = await this.analyzer.analyze(a);
      if (candidate) candidates.push(candidate);
    }

    if (candidates.length === 0) {
      this.logger.info('[DONE] No hay candidatos que cumplan las reglas.');
      return;
    }

    candidates.sort((a, b) => (b.inc - a.inc) || (a.bidAmount - b.bidAmount));

    this.logger.section('Candidatos');
    for (const c of candidates) {
      this.logger.success(
        `Player ${c.name} ${c.playerId} | price=${euro(c.price)} | ${this.logger.inc(c.inc)} | ` +
        `lastBid=${c.lastBidAmount ? euro(c.lastBidAmount) : '-'} | bid=${euro(c.bidAmount)}`
      );
    }

    await this.executor.execute(token, candidates);
    this.logger.success('[END] Proceso completado.');
  }
}