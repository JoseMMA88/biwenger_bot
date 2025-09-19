export class MarketService {
  constructor(config, http) {
    this.config = config;
    this.http = http;
  }

  authHeaders(token) {
    return {
      Authorization: `Bearer ${token}`,
      'X-Lang': this.config.X_LANG,
      'X-User': this.config.USER_ID,
      'X-League': this.config.LEAGUE_ID,
      'X-Version': this.config.X_VERSION
    };
  }

  async getAuctions(token) {
    const url = 'https://biwenger.as.com/api/v2/market';
    const res = await this.http.get(url, this.authHeaders(token));
    return res?.auctions || res?.data?.auctions || [];
  }

  async placeBid(token, playerId, amount) {
    const headers = { ...this.authHeaders(token), 'Content-Type': 'application/json' };

    // Endpoint recomendado por tu colección: /offers
    const offersUrl = 'https://biwenger.as.com/api/v2/offers';
    const offersBody = { to: null, type: 'bid', amount, requestedPlayers: [playerId] };
    const r = await this.http.post(offersUrl, offersBody, headers);
    return { ok: true, endpoint: 'offers', res: r };
  }
}