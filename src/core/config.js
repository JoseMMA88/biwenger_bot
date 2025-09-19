export class Config {
  constructor(env = process.env) {
    this.EMAIL = env.BIWENGER_EMAIL || '';
    this.PASSWORD = env.BIWENGER_PASSWORD || '';
    this.TOKEN = env.BIWENGER_TOKEN || '';

    this.LEAGUE_ID = env.LEAGUE_ID || env.BIWENGER_LEAGUE_ID || '';
    this.USER_ID = env.USER_ID || env.BIWENGER_USER_ID || '';

    this.X_LANG = env.X_LANG || 'es';
    this.X_VERSION = env.X_VERSION || '628';

    this.DRY_RUN = env.DRY_RUN === '1';
    this.MAX_PRICE_MULTIPLIER = Number(env.MAX_PRICE_MULTIPLIER || '1.5');
    this.BID_INCREMENT_FACTOR = Number(env.BID_INCREMENT_FACTOR || '1.01');
    this.INCREMENT_THRESHOLD = Number(env.INCREMENT_THRESHOLD || '40000');

    this.TIMEOUT_MS = Number(env.TIMEOUT_MS || '15000');
  }

  validate() {
    const missing = [];
    if (!this.TOKEN) {
      if (!this.EMAIL) missing.push('BIWENGER_EMAIL');
      if (!this.PASSWORD) missing.push('BIWENGER_PASSWORD');
    }
    if (!this.LEAGUE_ID) missing.push('LEAGUE_ID (o BIWENGER_LEAGUE_ID)');
    if (!this.USER_ID) missing.push('USER_ID (o BIWENGER_USER_ID)');
    if (missing.length) throw new Error(`Faltan variables de entorno: ${missing.join(', ')}`);
  }
}