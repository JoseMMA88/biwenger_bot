const { pickNumber } = require('../utils/numbers');

class PlayerService {
  constructor(config, http) {
    this.config = config;
    this.http = http;
  }

  normalizeDetails(raw) {
    const node =
      raw?.data?.player ??
      (Array.isArray(raw?.data) ? raw.data[0] : raw?.data) ??
      raw?.player ??
      (Array.isArray(raw) ? raw[0] : raw) ??
      raw;

    if (!node || typeof node !== 'object') return null;

    const name = String(node.name ?? '');
    const price = pickNumber(node.price, node.marketValue, node.value);
    const priceIncrement = pickNumber(node.priceIncrement, node.increment, node.deltaPrice, node.priceDiff);

    return { name, price, priceIncrement, raw: node };
  }

  async getDetails(playerId) {
    const headers = {
      'X-Lang': this.config.X_LANG,
      'X-Version': this.config.X_VERSION,
      'User-Agent': 'Mozilla/5.0'
    };

    const url = `https://cf.biwenger.com/api/v2/players/la-liga/${encodeURIComponent(playerId)}`;
    const res = await this.http.get(url, headers);
    const norm = this.normalizeDetails(res);
    if (norm) return norm;

    throw new Error(`No se pudieron obtener detalles del jugador ${playerId}`);
  }
}

module.exports = { PlayerService };