const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

// Starte Scraper
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

// 🟠 MIGROS
async function scrapeMigros(browser) {
  const page = await browser.newPage();
  const deals = [];
  try {
    await page.goto('https://www.migros.ch/de/offers/home', {
      waitUntil: 'domcontentloaded', timeout: 30000
    });
    await page.waitForSelector('[data-testid="product"]', { timeout: 15000 });

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

// 🔴 COOP
async function scrapeCoop(browser) {
  const page = await browser.newPage();
  const deals = [];
  try {
    await page.goto('https://www.coop.ch/de/aktionen/aktuelle-aktionen/c/m_1011', {
      waitUntil: 'domcontentloaded', timeout: 30000
    });
    await page.waitForSelector('.product-tile', { timeout: 15000 });

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

// 🔵 ALDI
async function scrapeAldi(browser) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
  const deals = [];

  const today = new Date();
  const day = today.getDay();
  const offset = (day === 1 || day === 4) ? 0 : (day < 4 ? 1 - day : 8 - day); // nächster Montag oder Donnerstag
  today.setDate(today.getDate() + offset);
  const dateStr = today.toLocaleDateString('de-CH').replace(/\./g, '-'); // z.B. 12-08-2025

  const aldiUrl = `https://www.aldi-suisse.ch/de/aktionen-und-angebote/d.${dateStr}.html`;

  try {
    await page.goto(aldiUrl, {
      waitUntil: 'domcontentloaded', timeout: 30000
    });
    await page.waitForSelector('.mod-article-tile', { timeout: 15000 });

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
  console.log(`✅ Aldi (${dateStr}): ${deals.length} Angebote`);
  return deals;
}

// 🟢 LIDL
async function scrapeLidl(browser) {
  const page = await browser.newPage();
  const deals = [];
  try {
    await page.goto('https://www.lidl.ch/c/de-CH/lidl-plus-angebote/a10020520?channel=store&tabCode=Current_Sales_Week', {
      waitUntil: 'domcontentloaded', timeout: 30000
    });
    await page.waitForSelector('.ret-o-card__headline', { timeout: 15000 });

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

// 🔎 Kategorien
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

// 🗓️ Nächstes Update-Datum (Mo/Do)
function getNextUpdateDate() {
  const now = new Date();
  const day = now.getDay();
  const offset = (day === 4) ? 4 : (day < 4 ? 4 - day : 8 - day);
  const next = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
  next.setHours(6, 0, 0, 0);
  return next.toISOString();
}
