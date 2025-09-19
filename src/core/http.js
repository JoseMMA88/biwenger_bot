class HttpClient {
  constructor(defaultHeaders = {}, timeoutMs = 15000) {
    this.defaultHeaders = defaultHeaders;
    this.timeoutMs = timeoutMs;
  }

  async request(url, options = {}) {
    const merged = {
      ...options,
      headers: {
        'Accept': 'application/json, text/plain, */*',
        ...this.defaultHeaders,
        ...(options.headers || {})
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs)
    };
    const res = await fetch(url, merged);
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!res.ok) {
      throw new Error(`${merged.method || 'GET'} ${url} -> ${res.status} ${json ? JSON.stringify(json) : text}`);
    }
    return json;
  }

  get(url, headers = {}) {
    return this.request(url, { headers });
  }

  post(url, body, headers = {}) {
    return this.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body)
    });
  }
}

module.exports = { HttpClient };