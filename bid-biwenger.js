// bid-biwenger.js
// Ejecuta: node bid-biwenger.js
//
// Requisitos: npm i -D playwright
//
// Secrets esperados (GitHub Actions / local .env):
//   BIWENGER_EMAIL, BIWENGER_PASSWORD
// Opcionales (env):
//   DRY_RUN="1"               -> no puja, solo log
//   BID_CAP="5"               -> máximo número de pujas por ejecución (por defecto: ilimitado)
//   HEADLESS="0"              -> ver navegador en local
//   CSV_PATH="logs/biwenger_bids.csv"
//   MAX_OVERPAY_RATIO="1.38"  -> 138%
//
// Lógica de puja (todas deben cumplirse):
//  - Carta "Libre"
//  - Δ mañana (increment[aria-label]) > 40.000 €
//  - bidAmount < VM * MAX_OVERPAY_RATIO
//
// Ranking de prioridad:
//  1) Δ mañana (desc) — mayor incremento esperado primero
//  2) ratio_overpay (asc) — menor sobreprecio primero
//  3) bidAmount (asc)

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const EMAIL = process.env.BIWENGER_EMAIL;
const PASSWORD = process.env.BIWENGER_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error('Faltan BIWENGER_EMAIL o BIWENGER_PASSWORD en variables de entorno.');
  process.exit(1);
}

const DRY_RUN = process.env.DRY_RUN === '1';
const BID_CAP = Number(process.env.BID_CAP || '0'); // 0 = sin límite
const HEADLESS = process.env.HEADLESS !== '0';
const CSV_PATH = process.env.CSV_PATH || path.join('logs', 'biwenger_bids.csv');

// Umbral de incremento positivo para pujar (> 40.000 €)
const INCREMENT_THRESHOLD = 40000;

// Máximo sobreprecio permitido vs Valor de Mercado (1.38 = 138%)
const MAX_OVERPAY_RATIO = Number(process.env.MAX_OVERPAY_RATIO || '1.38');

// ------------------ Utilidades ------------------

/** Normaliza un string de dinero europeo a número entero de euros */
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

/** Extrae número (puede ser negativo) de aria-label tipo "−30.000 €" o "+60.000 €" */
function parseIncrementAriaLabel(str) {
  if (!str) return NaN;
  const withAsciiMinus = str.replace(/[−–]/g, '-').replace(/\+/g, '');
  return parseEuroToInt(withAsciiMinus);
}

/** Espera y hace click si existe un botón con algún texto de la lista (tolerante) */
async function maybeClickByText(page, labels = [], timeout = 2500) {
  for (const label of labels) {
    const loc = page.locator(`button:has-text("${label}")`);
    try {
      await loc.first().click({ timeout });
      return true;
    } catch (_) {}
  }
  for (const label of labels) {
    const loc = page.locator(`a:has-text("${label}")`);
    try {
      await loc.first().click({ timeout });
      return true;
    } catch (_) {}
  }
  return false;
}

/** Scroll infinito básico hasta que no carguen más cards (o tope) */
async function loadAllPlayerCards(page, { maxLoops = 15, sleepMs = 800 }) {
  let prevCount = 0;
  for (let i = 0; i < maxLoops; i++) {
    const count = await page.locator('player-card').count();
    if (count <= prevCount) {
      await page.mouse.wheel(0, 2000);
      await page.waitForTimeout(sleepMs);
      const count2 = await page.locator('player-card').count();
      if (count2 <= prevCount) break;
      prevCount = count2;
    } else {
      prevCount = count;
      await page.mouse.wheel(0, 2000);
      await page.waitForTimeout(sleepMs);
    }
  }
}

/** CSV helpers */
function ensureCsvHeader(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(
      filePath,
      'timestamp_iso,tz,player,bid_amount_eur,increment_tomorrow_eur,priceH4_eur,askPriceFromButton_eur,max_allowed_eur,ratio_overpay\n',
      'utf8'
    );
  }
}

function appendCsvRow(filePath, rowObj) {
  const esc = v => String(v ?? '').replaceAll('"', '""');
  const line = [
    rowObj.timestamp_iso,
    rowObj.tz,
    `"${esc(rowObj.player)}"`,
    rowObj.bid_amount_eur,
    rowObj.increment_tomorrow_eur,
    rowObj.priceH4_eur,
    rowObj.askPriceFromButton_eur,
    rowObj.max_allowed_eur,
    rowObj.ratio_overpay
  ].join(',') + '\n';
  fs.appendFileSync(filePath, line, 'utf8');
}

/** Extrae info de la carta: { name, isLibre, incrementTomorrow, priceH4, askPriceFromButton, card } */
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
      const numStr = aria.split(':').pop(); // " 640.000 €"
      askPriceFromButton = parseEuroToInt(numStr);
    }
  }

  return { name, isLibre, incrementTomorrow, priceH4, askPriceFromButton, card };
}

/** Abre modal y confirma puja al precio indicado */
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

(async () => {
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  try {
    ensureCsvHeader(CSV_PATH);

    // 1) Login
    await page.goto('https://biwenger.as.com/', { waitUntil: 'domcontentloaded' });
    await maybeClickByText(page, ['Aceptar', 'Acepto', 'Agree', 'Consent'], 2000).catch(() => {});
    await maybeClickByText(page, ['Ya tengo cuenta'], 6000);
    await page.fill('input[placeholder="Email"][type="email"]', EMAIL, { timeout: 10000 });
    await page.fill('input[placeholder="Contraseña"][type="password"]', PASSWORD, { timeout: 10000 });
    await page.keyboard.press('Enter');
    await maybeClickByText(page, ['Entrar', 'Iniciar sesión'], 3000).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // 2) Mercado -> Subastas
    await page.goto('https://biwenger.as.com/market', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('a[href="/market"]', { timeout: 10000 }).catch(() => {});
    const subastasTab = page.locator('a:has-text("Subastas")');
    if (await subastasTab.count()) {
      await subastasTab.first().click();
    } else {
      await page.click('a:has(.icon-bids)', { timeout: 5000 }).catch(() => {});
    }
    await page.waitForSelector('player-card', { timeout: 10000 });

    // 3) Cargar todas las cards
    await loadAllPlayerCards(page, { maxLoops: 18, sleepMs: 700 });

    const cards = page.locator('player-card');
    const total = await cards.count();
    console.log(`Detectadas ${total} cartas en Subastas.`);

    // 4) Filtrado + construcción de candidatos
    const candidates = [];
    for (let i = 0; i < total; i++) {
      const card = cards.nth(i);
      const info = await extractCardInfo(card);

      if (!info.isLibre) continue; // solo "Libre"
      if (isNaN(info.incrementTomorrow) || !(info.incrementTomorrow > INCREMENT_THRESHOLD)) continue;

      // Determinar bidAmount (precio por el que se puja)
      let bidAmount = NaN;
      if (!isNaN(info.askPriceFromButton)) bidAmount = info.askPriceFromButton;
      else if (!isNaN(info.priceH4)) bidAmount = info.priceH4;

      if (isNaN(info.priceH4)) {
        console.log(`[Descartado] ${info.name}: sin Valor de Mercado (h4).`);
        continue;
      }
      if (isNaN(bidAmount)) {
        console.log(`[Descartado] ${info.name}: sin precio de puja detectable.`);
        continue;
      }

      const maxAllowed = Math.floor(info.priceH4 * MAX_OVERPAY_RATIO);
      if (!(bidAmount < maxAllowed)) {
        console.log(
          `[Descartado] ${info.name}: puja ${bidAmount.toLocaleString('es-ES')} € >= ${(MAX_OVERPAY_RATIO * 100).toFixed(0)}% de VM (${maxAllowed.toLocaleString('es-ES')} €).`
        );
        continue;
      }

      const ratioOverpay = bidAmount / info.priceH4; // < MAX_OVERPAY_RATIO
      candidates.push({
        ...info,
        bidAmount,
        maxAllowed,
        ratioOverpay
      });
    }

    if (candidates.length === 0) {
      console.log('No hay candidatos que cumplan todas las reglas.');
      return;
    }

    // 5) Ranking: Δ mañana desc, ratio_overpay asc, bidAmount asc
    candidates.sort((a, b) => {
      if (b.incrementTomorrow !== a.incrementTomorrow) return b.incrementTomorrow - a.incrementTomorrow;
      if (a.ratioOverpay !== b.ratioOverpay) return a.ratioOverpay - b.ratioOverpay;
      return a.bidAmount - b.bidAmount;
    });

    console.log('--- Ranking de candidatos ---');
    candidates.forEach((c, idx) => {
      console.log(
        `#${idx + 1}: ${c.name} | Δmañana: ${c.incrementTomorrow.toLocaleString('es-ES')} € | ` +
        `VM: ${c.priceH4.toLocaleString('es-ES')} € | Puja: ${c.bidAmount.toLocaleString('es-ES')} € | ` +
        `ratio: ${(c.ratioOverpay).toFixed(3)} | Máx ${(MAX_OVERPAY_RATIO*100).toFixed(0)}%: ${c.maxAllowed.toLocaleString('es-ES')} €`
      );
    });

    // 6) Pujar según ranking, respetando BID_CAP
    let bidsDone = 0;
    for (const c of candidates) {
      if (BID_CAP > 0 && bidsDone >= BID_CAP) {
        console.log(`Límite BID_CAP alcanzado (${BID_CAP}).`);
        break;
      }
      try {
        if (DRY_RUN) {
          console.log(`[DRY_RUN] Simular puja por ${c.name} por ${c.bidAmount.toLocaleString('es-ES')} €`);
        } else {
          await placeBidFromCard(page, c.card, c.bidAmount);
          console.log(`✅ Puja realizada por ${c.name} por ${c.bidAmount.toLocaleString('es-ES')} €`);

          appendCsvRow(CSV_PATH, {
            timestamp_iso: new Date().toISOString(),
            tz: 'Europe/Madrid',
            player: c.name,
            bid_amount_eur: c.bidAmount,
            increment_tomorrow_eur: c.incrementTomorrow,
            priceH4_eur: isNaN(c.priceH4) ? '' : c.priceH4,
            askPriceFromButton_eur: isNaN(c.askPriceFromButton) ? '' : c.askPriceFromButton,
            max_allowed_eur: c.maxAllowed,
            ratio_overpay: (c.ratioOverpay).toFixed(4)
          });

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