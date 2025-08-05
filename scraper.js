const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

(async () => {
  console.log('🛒 Starte Scraping der Supermarkt-Angebote...');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const results = {
    migros: [],
    coop: [],
    aldi: [],
    lidl: [],
    lastUpdate: new Date().toISOString(),
    nextUpdate: getNextUpdateDate()
  };

  try {
    results.migros = await scrapeMigros(browser);
    results.coop = await scrapeCoop(browser);
    results.aldi = await scrapeAldi(browser);
    results.lidl = await scrapeLidl(browser);
  } catch (err) {
    console.error('❌ Allgemeiner Fehler:', err.message);
  } finally {
    await browser.close();
    await fs.writeFile(path.join(__dirname, 'deals.json'), JSON.stringify(results, null, 2));
    console.log('💾 Fertig: deals.json gespeichert');
  }
})();

// MIGROS
async function scrapeMigros(browser) {
  const page = await browser.newPage();
  const deals = [];
  try {
    await page.goto('https://www.migros.ch/de/offers/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Cookie akzeptieren (falls da)
    await page.evaluate(() => {
      document.querySelector('button[aria-label*="Akzeptieren"]')?.click();
    });

    await page.waitForSelector('[data-testid="product"]', { timeout: 10000 });

    const items = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[data-testid="product"]')).map(el => {
        const name = el.querySelector('[data-testid="title"]')?.textContent?.trim();
        const price = el.querySelector('[data-testid="price"]')?.textContent?.match(/[\d.]+/)?.[0];
        return name && price ? { name, price: parseFloat(price), unit: 'Stück', store: 'Migros' } : null;
      }).filter(Boolean);
    });

    items.forEach(p => p.category = detectCategory(p.name));
    deals.push(...items);
  } catch (err) {
    console.error('❌ Fehler bei Migros:', err.message);
  } finally {
    await page.close();
  }
  console.log(`✅ Migros: ${deals.length} Angebote`);
  return deals;
}

// COOP
async function scrapeCoop(browser) {
  const page = await browser.newPage();
  const deals = [];
  try {
    await page.goto('https://www.coop.ch/de/aktionen/aktuelle-aktionen/c/m_1011', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    await page.evaluate(() => {
      document.querySelector('button[aria-label*="Akzeptieren"]')?.click();
    });

    await page.waitForSelector('.product-tile__title', { timeout: 10000 });

    const items = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.product-tile')).map(el => {
        const name = el.querySelector('.product-tile__title')?.textContent?.trim();
        const price = el.querySelector('.price')?.textContent?.match(/[\d.]+/)?.[0];
        return name && price ? { name, price: parseFloat(price), unit: 'Stück', store: 'Coop' } : null;
      }).filter(Boolean);
    });

    items.forEach(p => p.category = detectCategory(p.name));
    deals.push(...items);
  } catch (err) {
    console.error('❌ Fehler bei Coop:', err.message);
  } finally {
    await page.close();
  }
  console.log(`✅ Coop: ${deals.length} Angebote`);
  return deals;
}

// ALDI
async function scrapeAldi(browser) {
  const page = await browser.newPage();
  const deals = [];

  const date = getNextAldiDate();
  const aldiUrl = `https://www.aldi-suisse.ch/de/aktionen-und-angebote/d.${date}.html`;

  try {
    await page.goto(aldiUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    await page.evaluate(() => {
      document.querySelector('button[aria-label*="Akzeptieren"]')?.click();
    });

    await page.waitForSelector('.mod-article-tile', { timeout: 10000 });

    const items = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.mod-article-tile')).map(el => {
        const name = el.querySelector('.mod-article-tile__title')?.textContent?.trim();
        const price = el.querySelector('.price__main')?.textContent?.match(/[\d.]+/)?.[0];
        return name && price ? { name, price: parseFloat(price), unit: 'Stück', store: 'Aldi' } : null;
      }).filter(Boolean);
    });

    items.forEach(p => p.category = detectCategory(p.name));
    deals.push(...items);
  } catch (err) {
    console.error('❌ Fehler bei Aldi:', err.message);
  } finally {
    await page.close();
  }
  console.log(`✅ Aldi (${date}): ${deals.length} Angebote`);
  return deals;
}

// LIDL
async function scrapeLidl(browser) {
  const page = await browser.newPage();
  const deals = [];
  try {
    await page.goto('https://www.lidl.ch/c/de-CH/lidl-plus-angebote/a10020520?channel=store&tabCode=Current_Sales_Week', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    await page.evaluate(() => {
      document.querySelector('button[aria-label*="Akzeptieren"]')?.click();
    });

    await page.waitForSelector('.ret-o-card__headline', { timeout: 10000 });

    const items = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.ret-o-card')).map(el => {
        const name = el.querySelector('.ret-o-card__headline')?.textContent?.trim();
        const price = el.querySelector('.m-price__price')?.textContent?.match(/[\d.]+/)?.[0];
        return name && price ? { name, price: parseFloat(price), unit: 'Stück', store: 'Lidl' } : null;
      }).filter(Boolean);
    });

    items.forEach(p => p.category = detectCategory(p.name));
    deals.push(...items);
  } catch (err) {
    console.error('❌ Fehler bei Lidl:', err.message);
  } finally {
    await page.close();
  }
  console.log(`✅ Lidl: ${deals.length} Angebote`);
  return deals;
}

// KATEGORIE ERKENNUNG
function detectCategory(name) {
  name = name.toLowerCase();
  const categories = {
    'Fleisch': ['fleisch', 'hack', 'steak', 'schnitzel', 'wurst', 'speck'],
    'Geflügel': ['huhn', 'poulet', 'pute', 'ente'],
    'Fisch': ['lachs', 'fisch', 'forelle', 'thunfisch'],
    'Milchprodukte': ['milch', 'joghurt', 'rahm', 'butter', 'käse'],
    'Gemüse': ['tomate', 'salat', 'gurke', 'karotte', 'zwiebel', 'gemüse'],
    'Obst': ['apfel', 'banane', 'birne', 'traube', 'obst'],
    'Getränke': ['cola', 'wasser', 'saft', 'wein', 'bier'],
    'Brot': ['brot', 'zopf', 'toast'],
    'Grundnahrung': ['nudeln', 'reis', 'mehl', 'zucker'],
    'Tiefkühl': ['tiefkühl', 'tk', 'eis']
  };
  for (const [cat, keywords] of Object.entries(categories)) {
    if (keywords.some(k => name.includes(k))) return cat;
  }
  return 'Sonstiges';
}

// NÄCHSTES UPDATE
function getNextUpdateDate() {
  const now = new Date();
  const day = now.getDay();
  const offset = (day === 4) ? 4 : (day < 4 ? 4 - day : 8 - day);
  const next = new Date(now.getTime() + offset * 86400000);
  next.setHours(6, 0, 0, 0);
  return next.toISOString();
}

// DATUM FÜR ALDI (Mo/Do)
function getNextAldiDate() {
  const now = new Date();
  const day = now.getDay();
  let offset;
  if (day === 1 || day === 4) offset = 0;
  else if (day < 1 || (day > 1 && day < 4)) offset = 4 - day;
  else offset = 8 - day;
  now.setDate(now.getDate() + offset);
  return now.toLocaleDateString('de-CH').replace(/\./g, '-');
}
