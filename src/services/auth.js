class AuthService {
  constructor(config) {
    this.config = config;
  }

  async getToken() {
    if (this.config.TOKEN) {
      console.log('[AUTH] Usando BIWENGER_TOKEN (saltando login).');
      return this.config.TOKEN;
    }
    const url = 'https://biwenger.as.com/api/v2/auth/login';
    const body = { email: this.config.EMAIL, password: this.config.PASSWORD };
    const headers = {
      'X-Lang': this.config.X_LANG,
      'X-Version': this.config.X_VERSION,
      'Origin': 'https://biwenger.as.com',
      'Referer': 'https://biwenger.as.com/login',
      'User-Agent': 'Mozilla/5.0',
      'Accept-Language': 'es-ES,es;q=0.9'
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.TIMEOUT_MS + 5000),
    });

    const txt = await res.text();
    if (!res.ok) {
      console.error('[LOGIN DEBUG] status=', res.status, 'email=', body.email);
      console.error('[LOGIN DEBUG] body=', txt);
      throw new Error(`Login failed ${res.status}`);
    }
    const json = txt ? JSON.parse(txt) : {};
    const token = json?.token || json?.data?.token || json?.jwt;
    if (!token) throw new Error('No se obtuvo token de login');
    return token;
  }
}

module.exports = { AuthService };