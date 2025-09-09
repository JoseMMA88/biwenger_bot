// bid-biwenger.js
// MVP — Login directo y scraping SOLO de https://biwenger.as.com/market/auctions
//
// Secrets (GitHub Actions / local):
//   BIWENGER_EMAIL, BIWENGER_PASSWORD
//
// Variables opcionales:
//   DRY_RUN="1"               -> no confirma pujas (solo simula)
//   BID_CAP="5"               -> tope de pujas por ejecución (0 = sin límite)
//   HEADLESS="0"              -> ver navegador en local
//   SLOW_MO="200"             -> ralentiza acciones para debug
//   MAX_OVERPAY_RATIO="1.38"  -> 138%

const { chromium } = require('playwright');

// ---------- Config ----------
const EMAIL = "gbnq98yrbh@privaterelay.appleid.com" //process.env.BIWENGER_EMAIL;
const PASSWORD = "824563Jj" //process.env.BIWENGER_PASSWORD;
const AUCTIONS_URL = 'https://biwenger.as.com/market/auctions';
const LOGIN_URL = 'https://biwenger.as.com/login?lang=es';

if (!EMAIL || !PASSWORD) {
  console.error('Faltan BIWENGER_EMAIL o BIWENGER_PASSWORD en variables de entorno.');
  process.exit(1);
}
const DRY_RUN = process.env.DRY_RUN === '1';
const BID_CAP = Number(process.env.BID_CAP || '0');
const HEADLESS = process.env.HEADLESS !== '0';
const SLOW_MO = Number(process.env.SLOW_MO || '0');

const INCREMENT_THRESHOLD = 1;
const MAX_OVERPAY_RATIO = Number(process.env.MAX_OVERPAY_RATIO || '1.38');

// ---------- Utils ----------
function parseEuroToInt(str) {
  if (!str) return NaN;
  const normalized = str
    .replace(/\u00A0/g, ' ')
    .replace(/[€\s]/g, '')
    .replace(/\./g, '')
    .replace(/,/g, '.');
  const sign = /^[−–-]/.test(normalized) ? -1 : 1;
  const digits = normalized.replace(/[^\d]/g, '');
  const n = Number(digits);
  return sign * (isNaN(n) ? NaN : n);
}

function parseIncrementAriaLabel(str) {
  if (!str) return NaN;
  const withAsciiMinus = str.replace(/[−–]/g, '-').replace(/\+/g, '');
  return parseEuroToInt(withAsciiMinus);
}

async function maybeClickByText(page, labels = [], timeout = 2500) {
  for (const label of labels) {
    const loc = page.locator(`button:has-text("${label}")`);
    try { await loc.first().click({ timeout }); return true; } catch (_) {}
  }
  for (const label of labels) {
    const loc = page.locator(`a:has-text("${label}")`);
    try { await loc.first().click({ timeout }); return true; } catch (_) {}
  }
  return false;
}

/** Intenta abrir el formulario (Email/Contraseña) pulsando "Ya tengo cuenta" con varias estrategias */
async function ensureLoginForm(page) {
  const emailInput = page.locator('input[placeholder="Email"][type="email"]');
  const passInput  = page.locator('input[placeholder="Contraseña"][type="password"]');
  if (await emailInput.count() && await passInput.count()) return;

  await maybeClickByText(page, ['Aceptar', 'Acepto', 'Agree', 'Consent'], 1500).catch(() => {});
  const candidates = [
    'button:has-text("Ya tengo cuenta")',
    'a:has-text("Ya tengo cuenta")',
    '[role="button"]:has-text("Ya tengo cuenta")',
  ];
  for (const sel of candidates) {
    const el = page.locator(sel).first();
    if (await el.count()) {
      try {
        await el.scrollIntoViewIfNeeded().catch(() => {});
        await el.click({ timeout: 3000 });
        await emailInput.first().waitFor({ timeout: 3000 });
        await passInput.first().waitFor({ timeout: 3000 });
        return;
      } catch (_) {}
    }
  }
  // Click forzado via DOM (por si Angular bloquea)
  try {
    await page.evaluate(() => {
      const it = document.createNodeIterator(document.body, NodeFilter.SHOW_TEXT);
      let n; while ((n = it.nextNode())) {
        if (n.textContent.trim() === 'Ya tengo cuenta') {
          let el = n.parentElement;
          for (let i = 0; i < 3 && el; i++, el = el.parentElement) {
            if (el instanceof HTMLElement) { el.click(); return; }
          }
        }
      }
    });
    await emailInput.first().waitFor({ timeout: 4000 });
    await passInput.first().waitFor({ timeout: 4000 });
    return;
  } catch (_) {}
  // Último intento: Tab/Enter
  try {
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await emailInput.first().waitFor({ timeout: 2000 });
    await passInput.first().waitFor({ timeout: 2000 });
    return;
  } catch (_) {}
  throw new Error('No pude abrir el formulario de login (no se pudo pulsar "Ya tengo cuenta").');
}

/** Busca un contenedor raíz del panel de Subastas por texto (robusto ante cambios de clases) */
async function getAuctionsRoot(page) {
  // Buscamos nodos grandes (section/div/main) cuyo innerText contenga "Subasta"
  const handle = await page.evaluateHandle(() => {
    const blocks = Array.from(document.querySelectorAll('section, main, div'));
    const scored = [];
    for (const el of blocks) {
      if (!(el instanceof HTMLElement)) continue;
      const txt = el.innerText || '';
      if (txt.toLowerCase().includes('subasta')) {
        // score: tamaño y cuántos player-card contiene
        const cards = el.querySelectorAll('player-card').length;
        const area = el.clientWidth * el.clientHeight;
        scored.push({ el, cards, area });
      }
    }
    // ordena por mayor #cards y área
    scored.sort((a, b) => (b.cards - a.cards) || (b.area - a.area));
    return scored.length ? scored[0].el : null;
  });
  const element = handle.asElement?.();
  if (element) return element;
  return null;
}

/** Scroll universal: window + contenedores scrollables que contienen player-card */
async function universalScroll(page, loops = 14, pauseMs = 650) {
  for (let i = 0; i < loops; i++) {
    await page.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 1.25)));
    await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('player-card'));
      const roots = new Set();
      for (const c of cards) {
        let el = c.parentElement;
        for (let hop = 0; hop < 6 && el; hop++, el = el.parentElement) {
          const style = el instanceof HTMLElement ? getComputedStyle(el) : null;
          const scrollable = style && (/(auto|scroll)/.test(style.overflowY) || el.scrollHeight > el.clientHeight + 10);
          if (scrollable) { roots.add(el); break; }
        }
      }
      roots.forEach(el => { el.scrollTop += Math.round(el.clientHeight * 1.25); });
    });
    await page.waitForTimeout(pauseMs);
  }
}

// ---------- Extractors ----------
async function extractCardInfo(card) {
  const name = (await card.locator('h3 a').first().innerText().catch(() => '')).trim();
  const statusText = (await card.locator('.header em').first().innerText().catch(() => '')).trim();
  const isLibre = /Libre/i.test(statusText);
  const incAria = await card.locator('increment[aria-label]').first().getAttribute('aria-label').catch(() => null);
  const incrementTomorrow = parseIncrementAriaLabel(incAria);
  const priceH4Text = await card.locator('.price h4').first().innerText().catch(() => '');
  const priceH4 = parseEuroToInt(priceH4Text);

  let askPriceFromButton = NaN;
  const button = card.locator('market-tools button[aria-label*="Precio de venta"]');
  if (await button.count().catch(() => 0)) {
    const aria = await button.first().getAttribute('aria-label').catch(() => null);
    if (aria) {
      const numStr = aria.split(':').pop();
      askPriceFromButton = parseEuroToInt(numStr);
    }
  }

  let lastBidByMe = false;
  const lastBidDiv = card.locator('div[title="Última puja"]');
  if (await lastBidDiv.count().catch(() => 0)) {
    const text = await lastBidDiv.innerText().catch(() => '');
    if (text.includes('Real Xabioneta')) lastBidByMe = true;
  }

  return { name, isLibre, incrementTomorrow, priceH4, askPriceFromButton, lastBidByMe, card };
}

// ---------- Actions ----------
async function placeBidFromCard(page, card, amountInt) {
  let opened = false;
  const buttonWithAria = card.locator('market-tools button[aria-label*="Precio de venta"]');
  if (await buttonWithAria.count().catch(() => 0)) {
    await buttonWithAria.first().click();
    opened = true;
  } else {
    const pujarBtn = card.locator('market-tools button:has-text("Pujar")');
    await pujarBtn.first().click();
    opened = true;
  }
  if (!opened) throw new Error('No se pudo abrir el modal de puja.');

  await page.waitForSelector('modal-dialog[aria-label*="Pujar"]', { timeout: 8000 }).catch(() => {});
  const amountInput = page.locator('input-int input[type="tel"]');
  await amountInput.click({ timeout: 5000 });
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await amountInput.type(String(amountInt), { delay: 20 });
  const confirmBtn = page.locator('button:has-text("Pujar (Subasta)")');
  await confirmBtn.first().click();
  await page.waitForTimeout(1500);
}

// ---------- Main ----------
(async () => {
  const browser = await chromium.launch({ headless: HEADLESS, slowMo: SLOW_MO });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  try {
    // 1) Login
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
    await ensureLoginForm(page);
    await page.fill('input[placeholder="Email"][type="email"]', EMAIL, { timeout: 10000 });
    await page.fill('input[placeholder="Contraseña"][type="password"]', PASSWORD, { timeout: 10000 });
    await page.keyboard.press('Enter');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // 2) Ir DIRECTO a Subastas
    await page.goto(AUCTIONS_URL, { waitUntil: 'domcontentloaded' });

    // Si redirige a login, reintenta una vez
    if (page.url().includes('/login')) {
      await ensureLoginForm(page);
      await page.fill('input[placeholder="Email"][type="email"]', EMAIL);
      await page.fill('input[placeholder="Contraseña"][type="password"]', PASSWORD);
      await page.keyboard.press('Enter');
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.goto(AUCTIONS_URL, { waitUntil: 'domcontentloaded' });
    }

    if (!page.url().includes('/market/auctions')) {
      throw new Error(`No estoy en /market/auctions. URL actual: ${page.url()}`);
    }

    // 3) Encuentra el contenedor real de Subastas
    const auctionsRootHandle = await getAuctionsRoot(page);
    let cards;
    if (auctionsRootHandle) {
      const auctionsRoot = auctionsRootHandle.asElement();
      console.log('[INFO] Auctions root detectado por texto "Subasta".');
      // scroll dentro del root y global para cargar
      for (let i = 0; i < 12; i++) {
        await auctionsRoot.evaluate(el => { el.scrollTop += el.clientHeight * 1.25; });
        await page.waitForTimeout(500);
      }
      await universalScroll(page, 6, 500); // pequeño refuerzo global
      cards = auctionsRoot.locator('player-card');
    } else {
      console.warn('[WARN] No pude aislar un root de "Subasta" por texto; aplico fallback.');
      await universalScroll(page, 16, 650);
      // Preferimos cards que tengan "Última puja" si existen
      const hasAnyLastBid = await page.locator('player-card:has(div[title="Última puja"])').count();
      if (hasAnyLastBid) {
        cards = page.locator('player-card:has(div[title="Última puja"])');
      } else {
        // Fallback suave: cards visibles actualmente en viewport (evita otras secciones fuera de vista)
        cards = page.locator('player-card').filter({ has: page.locator(':visible') });
      }
    }

    const total = await cards.count();
    console.log(`Detectadas ${total} cards candidatas en Subastas.`);

    if (total === 0) {
      console.warn('No se detectaron cards en Subastas.');
      return;
    }

    // Hardcode: eliminar las 8 últimas
    if (total > 8) {
        total = total - 8;
        console.log(`⚠️ Hardcode aplicado: descartadas las últimas 8. Quedan ${total} cards a analizar.`);
    }

    // 4) Filtrado + candidatos
    const candidates = [];
    for (let i = 0; i < total; i++) {
      const card = cards.nth(i);
      const info = await extractCardInfo(card);
      console.log(`Analizando jugador #${i + 1}/${total}: ${info.name}`);

      // Failsafe duro: si el card está fuera del root (cuando existe) y hay texto "Mercado" cerca, saltar
      const maybeMarket = await card.locator('xpath=ancestor::section[contains(., "Mercado")]').count().catch(() => 0);
      if (maybeMarket) { console.log('  ❌ Descartado: dentro de sección "Mercado".'); continue; }

      if (info.lastBidByMe) { console.log('  ❌ Descartado: ya tiene tu última puja.'); continue; }
      if (!info.isLibre) { console.log('  ❌ Descartado: no está Libre.'); continue; }
      if (isNaN(info.incrementTomorrow) || !(info.incrementTomorrow > INCREMENT_THRESHOLD)) {
        console.log(`  ❌ Descartado: incremento ≤ ${INCREMENT_THRESHOLD}.`); continue;
      }

      let bidAmount = NaN;
      if (!isNaN(info.askPriceFromButton)) bidAmount = info.askPriceFromButton;
      else if (!isNaN(info.priceH4)) bidAmount = info.priceH4;

      if (isNaN(info.priceH4)) { console.log('  ❌ Descartado: sin VM.'); continue; }
      if (isNaN(bidAmount)) { console.log('  ❌ Descartado: sin precio de puja.'); continue; }

      const maxAllowed = Math.floor(info.priceH4 * MAX_OVERPAY_RATIO);
      if (!(bidAmount < maxAllowed)) {
        console.log(`  ❌ Descartado: puja ${bidAmount} ≥ ${(MAX_OVERPAY_RATIO*100).toFixed(0)}% de VM (${maxAllowed}).`);
        continue;
      }

      const ratioOverpay = bidAmount / info.priceH4;
      console.log(`  ✅ Candidato: Δ ${info.incrementTomorrow}, VM ${info.priceH4}, Puja ${bidAmount}, ratio ${ratioOverpay.toFixed(3)}`);
      candidates.push({ ...info, bidAmount, ratioOverpay });
    }

    if (candidates.length === 0) {
      console.log('No hay candidatos que cumplan las reglas.');
      return;
    }

    // 5) Ranking
    candidates.sort((a, b) => {
      if (b.incrementTomorrow !== a.incrementTomorrow) return b.incrementTomorrow - a.incrementTomorrow;
      if (a.ratioOverpay !== b.ratioOverpay) return a.ratioOverpay - b.ratioOverpay;
      return a.bidAmount - b.bidAmount;
    });

    console.log('--- Ranking ---');
    candidates.forEach((c, idx) => {
      console.log(`#${idx + 1}: ${c.name} | Δ ${c.incrementTomorrow} | VM ${c.priceH4} | Puja ${c.bidAmount} | ratio ${c.ratioOverpay.toFixed(3)}`);
    });

    // 6) Ejecutar pujas
    let bidsDone = 0;
    for (const c of candidates) {
      if (BID_CAP > 0 && bidsDone >= BID_CAP) { console.log(`Límite BID_CAP alcanzado (${BID_CAP}).`); break; }
      try {
        if (DRY_RUN) {
          console.log(`[DRY_RUN] Simular puja por ${c.name} por ${c.bidAmount}`);
        } else {
          await placeBidFromCard(page, c.card, c.bidAmount);
          console.log(`✅ Puja realizada por ${c.name} por ${c.bidAmount}`);
          bidsDone++;
          await page.waitForTimeout(1200);
        }
      } catch (err) {
        console.warn(`⚠️ Error pujando por ${c.name}:`, err.message);
        await maybeClickByText(page, ['Cerrar', '×', 'Close'], 1000).catch(() => {});
      }
    }

  } catch (e) {
    console.error('Fallo inesperado:', e);
    process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
  }
})();