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
      const schedule = this.buildSchedule([]);
      this.logSchedule(schedule);
      this.logCompletion();
      return {
        candidates,
        candidateCount: 0,
        hasCandidates: false,
        schedule
      };
    }

    for (const c of candidates) {
      c.timeRemainingMs = this.policy.timeRemainingMs(c.auctionUntil);
      c.readyToBid = this.policy.isReadyToBid(c.auctionUntil);
    }

    candidates.sort((a, b) =>
      (Number(b.readyToBid) - Number(a.readyToBid)) ||
      (b.inc - a.inc) ||
      (a.bidAmount - b.bidAmount)
    );

    this.logger.section('Candidatos');
    for (const c of candidates) {
      const timeLeftLabel = this.humanizeMs(c.timeRemainingMs);
      const statusLabel = c.readyToBid ? 'listo (≤ umbral)' : 'en espera (> umbral)';
      this.logger.success(
        `Player ${c.name} ${c.playerId} | price=${Euro(c.price)} | ${this.logger.inc(c.inc)} | ` +
        `lastBid=${c.lastBidAmount ? Euro(c.lastBidAmount) : '-'} | bid=${Euro(c.bidAmount)} | ` +
        `timeLeft=${timeLeftLabel} | estado=${statusLabel}`
      );
    }

    await this.executor.execute(token, candidates);
    this.logger.success('[END] Proceso completado.');

    const schedule = this.buildSchedule(candidates);
    this.logSchedule(schedule);
    this.logCompletion();

    return {
      candidates,
      candidateCount: candidates.length,
      hasCandidates: true,
      schedule
    };
  }

  buildSchedule(candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return {
        hasCandidates: false,
        readyCandidates: false,
        nextRunSeconds: 6 * 60 * 60,
        nextRunHuman: '6 horas',
        soonestCandidateMinutes: null,
        waitMinutesForReady: null
      };
    }

    const now = Date.now();
    const thresholdMs = this.cfg.BID_READY_THRESHOLD_MS;
    const remaining = candidates
      .map((c) => this.policy.timeRemainingMs(c.auctionUntil, now))
      .filter((ms) => Number.isFinite(ms) && ms > 0);

    if (remaining.length === 0) {
      return {
        hasCandidates: true,
        readyCandidates: true,
        nextRunSeconds: 15 * 60,
        nextRunHuman: '15 minutos',
        soonestCandidateMinutes: null,
        waitMinutesForReady: 0
      };
    }

    const minRemaining = Math.min(...remaining);
    const soonestCandidateMinutes = Math.ceil(minRemaining / 60000);

    if (minRemaining <= thresholdMs) {
      return {
        hasCandidates: true,
        readyCandidates: true,
        nextRunSeconds: 15 * 60,
        nextRunHuman: '15 minutos',
        soonestCandidateMinutes,
        waitMinutesForReady: 0
      };
    }

    const waitMs = minRemaining - thresholdMs;
    const waitSeconds = Math.max(Math.ceil(waitMs / 1000), 60);
    const waitMinutesForReady = Math.ceil(waitMs / 60000);

    return {
      hasCandidates: true,
      readyCandidates: false,
      nextRunSeconds: waitSeconds,
      nextRunHuman: this.humanizeSeconds(waitSeconds),
      soonestCandidateMinutes,
      waitMinutesForReady
    };
  }

  logSchedule(schedule) {
    if (!schedule.hasCandidates) {
      this.logger.info(`[SCHEDULE] Próxima ejecución recomendada: ${schedule.nextRunHuman}.`);
      return;
    }

    const thresholdLabel = this.formatMinutes(this.cfg.BID_READY_THRESHOLD_MS / 60000);

    if (schedule.readyCandidates) {
      this.logger.info(
        `[SCHEDULE] Hay candidatos listos (≤ ${thresholdLabel}); repetir ejecución en ${schedule.nextRunHuman}.`
      );
      return;
    }

    const soonestLabel = this.formatMinutes(schedule.soonestCandidateMinutes);
    this.logger.info(
      `[SCHEDULE] Reprogramar en ${schedule.nextRunHuman} (cuando falten ${thresholdLabel}). ` +
      `El candidato más próximo finaliza en ${soonestLabel}.`
    );
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

  humanizeSeconds(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return 'menos de 1 minuto';
    return this.formatMinutes(seconds / 60);
  }

  humanizeMs(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '0 minutos';
    return this.formatMinutes(ms / 60000);
  }

  formatMinutes(minutes) {
    if (!Number.isFinite(minutes)) return '-';
    const totalMinutes = Math.max(0, Math.ceil(minutes));
    if (totalMinutes < 1) return 'menos de 1 minuto';
    if (totalMinutes < 60) {
      return `${totalMinutes} ${totalMinutes === 1 ? 'minuto' : 'minutos'}`;
    }
    const hours = Math.floor(totalMinutes / 60);
    const remainingMinutes = totalMinutes % 60;
    const hourLabel = `${hours} ${hours === 1 ? 'hora' : 'horas'}`;
    if (remainingMinutes === 0) return hourLabel;
    return `${hourLabel} y ${remainingMinutes} ${remainingMinutes === 1 ? 'minuto' : 'minutos'}`;
  }
}
