// scripts/bid-biwenger-api.js
// Node >= 20 (fetch y AbortSignal nativos)

const CONFIG = {
  EMAIL: process.env.BIWENGER_EMAIL,
  PASSWORD: process.env.BIWENGER_PASSWORD,
  LEAGUE_ID: process.env.LEAGUE_ID,
  USER_ID: process.env.USER_ID, // tu team id (p.ej. 8788636)
  X_LANG: process.env.X_LANG || 'es',
  X_VERSION: process.env.X_VERSION || '628',
  DRY_RUN: process.env.DRY_RUN === '1',
  MAX_PRICE_MULTIPLIER: Number(process.env.MAX_PRICE_MULTIPLIER || '1.5'),      // 150%
  BID_INCREMENT_FACTOR: Number(process.env.BID_INCREMENT_FACTOR || '1.01'),     // +1%
  INCREMENT_THRESHOLD: 40000
};

function assertEnv() {
  const missing = [];
  for (const [k, v] of Object.entries({
    BIWENGER_EMAIL: CONFIG.EMAIL,
    BIWENGER_PASSWORD: CONFIG.PASSWORD,
    LEAGUE_ID: CONFIG.LEAGUE_ID,
    USER_ID: CONFIG.USER_ID
  })) {
    if (!v) missing.push(k);
  }
  if (missing.length) {
    throw new Error(`Faltan variables de entorno: ${missing.join(', ')}`);
  }
}

async function httpJson(url, opts = {}) {
  const merged = {
    ...opts,
    headers: {
      'Accept': 'application/json',
      ...(opts.headers || {})
    },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15000)
  };
  const res = await fetch(url, merged);
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) {
    const msg = json ? JSON.stringify(json) : text;
    throw new Error(`${opts.method || 'GET'} ${url} -> ${res.status} ${msg}`);
  }
  return json;
}

async function login() {
  const url = 'https://biwenger.as.com/api/v2/auth/login';
  const body = { email: CONFIG.EMAIL, password: CONFIG.PASSWORD };
  const res = await httpJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  // Ajusta si el campo difiere en tu entorno
  const token = res?.token;
  if (!token) throw new Error('No se obtuvo token de login');
  return token;
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'X-Lang': CONFIG.X_LANG,
    'X-User': CONFIG.USER_ID,
    'X-League': CONFIG.LEAGUE_ID,
    'X-Version': CONFIG.X_VERSION
  };
}

async function getMarketAuctions(token) {
  const url = 'https://biwenger.as.com/api/v2/market';
  const res = await httpJson(url, { headers: authHeaders(token) });
  const auctions = res?.auctions || res?.data?.auctions || [];
  return auctions;
}

async function getPlayerDetails(playerId) {
  const url = `https://cf.biwenger.com/api/v2/players/la-liga/${encodeURIComponent(playerId)}`;
  const res = await httpJson(url, { headers: { 'X-Lang': CONFIG.X_LANG } });
  return res;
}

function computeBidAmount({ price, lastBidAmount }) {
  const base = Number.isFinite(lastBidAmount) ? lastBidAmount : price;
  const raw = Math.floor(base * CONFIG.BID_INCREMENT_FACTOR);
  return raw;
}

function withinCap(bidAmount, price) {
  const cap = Math.floor(price * CONFIG.MAX_PRICE_MULTIPLIER);
  return bidAmount < cap;
}

async function placeBid(token, playerId, amount) {
  const commonHeaders = {
    ...authHeaders(token),
    'Content-Type': 'application/json'
  };

  // 1) /offers
  const offersUrl = 'https://biwenger.as.com/api/v2/offers';
  const offersBody = {
    to: null,
    type: 'bid',
    amount,
    requestedPlayers: [playerId]
  };
  try {
    const res = await httpJson(offersUrl, {
      method: 'POST',
      headers: commonHeaders,
      body: JSON.stringify(offersBody),
      timeoutMs: 20000
    });
    return { ok: true, endpoint: 'offers', res };
  } catch (e1) {
    // 2) fallback: /market con variantes
    const marketUrl = 'https://biwenger.as.com/api/v2/market';
    const bodies = [
      { id: playerId, amount },                             // variante 1
      { type: 'bid', amount, requestedPlayers: [playerId] } // variante 2
    ];
    let lastErr = e1;
    for (const b of bodies) {
      try {
        const res = await httpJson(marketUrl, {
          method: 'POST',
          headers: commonHeaders,
          body: JSON.stringify(b),
          timeoutMs: 20000
        });
        return { ok: true, endpoint: 'market', res };
      } catch (e2) {
        lastErr = e2;
      }
    }
    throw lastErr;
  }
}

function euro(n) {
  return new Intl.NumberFormat('es-ES').format(n) + ' €';
}

(function main() {
  assertEnv();
  console.log('[INIT] Biwenger API bidder starting… DRY_RUN=', CONFIG.DRY_RUN);

  (async () => {
    // 1) Login
    const token = await login();
    console.log('[AUTH] Token obtenido.');

    // 2) Market (solo auctions)
    const auctions = await getMarketAuctions(token);
    console.log(`[MARKET] Auctions detectadas: ${auctions.length}`);

    // 3) Explorar auctions
    const candidates = [];
    for (const a of auctions) {
      const playerId = a.playerId ?? a.id ?? a.player?.id;
      if (!playerId) {
        console.log('[SKIP] Auction sin playerId claro:', a?.id ?? '(sin id)');
        continue;
      }

      // Traer detalles del jugador
      const details = await getPlayerDetails(playerId);
      const price = Number(details?.price);
      const inc = Number(details?.priceIncrement ?? details?.priceincrement ?? details?.increment);

      // lastBid: puede venir en details o en la propia auction
      const lastBid = details?.lastBid ?? a?.lastBid ?? null;

      // >>> NUEVA CONDICIÓN: si la última puja es tuya, descartar <<<
      const lastFromId = Number(lastBid?.from?.id);
      const myId = Number(CONFIG.USER_ID);
      if (Number.isFinite(lastFromId) && Number.isFinite(myId) && lastFromId === myId) {
        console.log(`[SKIP] Jugador ${details.name} con ID ${playerId} descartado: última puja es tuya (from.id=${lastFromId}).`);
        continue;
      }

      const lastBidAmount = Number(lastBid?.amount);

      if (!Number.isFinite(price)) {
        console.log(`[SKIP] Jugador ${details.name} con ID ${playerId} sin price válido.`);
        continue;
      }

      if (!Number.isFinite(inc) || inc < CONFIG.INCREMENT_THRESHOLD) {
        console.log(`[SKIP] Jugador ${details.name} con ID ${playerId} inc=${inc} < ${CONFIG.INCREMENT_THRESHOLD}`);
        continue;
      }

      // Cálculo de puja
      const bidAmount = computeBidAmount({
        price,
        lastBidAmount: Number.isFinite(lastBidAmount) ? lastBidAmount : undefined
      });

      if (!withinCap(bidAmount, price)) {
        const cap = Math.floor(price * CONFIG.MAX_PRICE_MULTIPLIER);
        console.log(`[SKIP] Jugador ${details.name} con ID ${playerId} bid=${bidAmount} excede 150% de price=${price} (cap=${cap}).`);
        continue;
      }

      candidates.push({
        playerId,
        price,
        inc,
        lastBidAmount: Number.isFinite(lastBidAmount) ? lastBidAmount : null,
        bidAmount
      });
    }

    if (candidates.length === 0) {
      console.log('[DONE] No hay candidatos que cumplan las reglas.');
      return;
    }

    // 4) Ordenar por incremento mayor, luego menor puja
    candidates.sort((a, b) => (b.inc - a.inc) || (a.bidAmount - b.bidAmount));

    console.log('--- Candidatos ---');
    for (const c of candidates) {
      console.log(
        `Player ${c.playerId} | price=${euro(c.price)} | inc=${euro(c.inc)} | lastBid=${c.lastBidAmount ? euro(c.lastBidAmount) : '-'} | bid=${euro(c.bidAmount)}`
      );
    }

    // 5) Ejecutar pujas
    for (const c of candidates) {
      if (CONFIG.DRY_RUN) {
        console.log(`[DRY_RUN] Simular puja → Player ${c.playerId} por ${euro(c.bidAmount)}`);
        continue;
      }
      try {
        const out = await placeBid(token, c.playerId, c.bidAmount);
        console.log(`✅ Puja OK (${out.endpoint}) → Player ${c.playerId} por ${euro(c.bidAmount)}`);
      } catch (err) {
        console.log(`⚠️ Error al pujar Player ${c.playerId} por ${euro(c.bidAmount)}:`, String(err));
      }
    }

    console.log('[END] Proceso completado.');
  })().catch(err => {
    console.error('[FATAL]', err);
    process.exit(1);
  });
})();