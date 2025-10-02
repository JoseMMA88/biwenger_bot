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
      const schedule = this.buildSchedule(false);
      this.logSchedule(schedule);
      this.logCompletion();
      return {
        candidates,
        candidateCount: 0,
        hasCandidates: false,
        schedule
      };
    }

    candidates.sort((a, b) => (b.inc - a.inc) || (a.bidAmount - b.bidAmount));

    this.logger.section('Candidatos');
    for (const c of candidates) {
      this.logger.success(
        `Player ${c.name} ${c.playerId} | price=${Euro(c.price)} | ${this.logger.inc(c.inc)} | ` +
        `lastBid=${c.lastBidAmount ? Euro(c.lastBidAmount) : '-'} | bid=${Euro(c.bidAmount)}`
      );
    }

    await this.executor.execute(token, candidates);
    this.logger.success('[END] Proceso completado.');

    const schedule = this.buildSchedule(true);
    this.logSchedule(schedule);
    this.logCompletion();

    return {
      candidates,
      candidateCount: candidates.length,
      hasCandidates: true,
      schedule
    };
  }

  buildSchedule(hasCandidates) {
    return {
      hasCandidates,
      nextRunSeconds: hasCandidates ? 15 * 60 : 6 * 60 * 60,
      nextRunHuman: hasCandidates ? '15 minutos' : '6 horas'
    };
  }

  logSchedule(schedule) {
    this.logger.info(`[SCHEDULE] Próxima ejecución recomendada: ${schedule.nextRunHuman}.`);
  }

  logCompletion() {
    const formatter = new Intl.DateTimeFormat('es-ES', {
      timeZone: 'Europe/Madrid',
      dateStyle: 'short',
      timeStyle: 'medium'
    });
    const formatted = formatter.format(new Date());
    this.logger.info(`[TIMESTAMP] Finalizado a las ${formatted}`);
  }
}
