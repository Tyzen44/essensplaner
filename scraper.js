const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

async function scrapeAllStores() {
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
    console.error('❌ Fehler beim Scraping:', err);
  } finally {
    await browser.close();
  }

  await fs.writeFile(path.join(__dirname, 'deals.json'), JSON.stringify(results, null, 2));
  console.log('💾 Angebote gespeichert in deals.json');
}

async function scrapeMigros(browser) {
  const page = await browser.newPage();
  const deals = [];

  try {
    await page.goto('https://produkte.migros.ch/de/aktionen', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="product"]', { timeout: 15000 });

    const products = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[data-testid="product"]')).map(el => {
        const name = el.querySelector('[data-testid="product-title"]')?.innerText.trim();
        const price = el.querySelector('[data-testid="price"]')?.innerText.match(/[\d,.]+/)?.[0].replace(',', '.');
        return name && price ? { name, price: parseFloat(price), store: 'Migros' } : null;
      }).filter(Boolean);
    });

    products.forEach(p => { p.category = detectCategory(p.name); deals.push(p); });

  } catch (err) {
    console.error('❌ Fehler bei Migros:', err.message);
  } finally {
    await page.close();
  }

  return deals;
}

async function scrapeCoop(browser) {
  const page = await browser.newPage();
  const deals = [];

  try {
    await page.goto('https://www.coop.ch/de/aktionen.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.product-tile__wrapper', { timeout: 15000 });

    const products = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.product-tile__wrapper')).map(el => {
        const name = el.querySelector('.product-tile__title')?.innerText.trim();
        const price = el.querySelector('.price__value')?.innerText.match(/[\d,.]+/)?.[0].replace(',', '.');
        return name && price ? { name, price: parseFloat(price), store: 'Coop' } : null;
      }).filter(Boolean);
    });

    products.forEach(p => { p.category = detectCategory(p.name); deals.push(p); });

  } catch (err) {
    console.error('❌ Fehler bei Coop:', err.message);
  } finally {
    await page.close();
  }

  return deals;
}

async function scrapeAldi(browser) {
  const page = await browser.newPage();
  const deals = [];

  try {
    await page.goto('https://www.aldi-suisse.ch/de/angebote.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.mod-article-tile__title', { timeout: 15000 });

    const products = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.mod-article-tile')).map(el => {
        const name = el.querySelector('.mod-article-tile__title')?.innerText.trim();
        const price = el.querySelector('.price__main')?.innerText.match(/[\d,.]+/)?.[0].replace(',', '.');
        return name && price ? { name, price: parseFloat(price), store: 'Aldi' } : null;
      }).filter(Boolean);
    });

    products.forEach(p => { p.category = detectCategory(p.name); deals.push(p); });

  } catch (err) {
    console.error('❌ Fehler bei Aldi:', err.message);
  } finally {
    await page.close();
  }

  return deals;
}

async function scrapeLidl(browser) {
  const page = await browser.newPage();
  const deals = [];

  try {
    await page.goto('https://www.lidl.ch/de/angebote', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ret-o-card__headline', { timeout: 15000 });

    const products = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.ret-o-card')).map(el => {
        const name = el.querySelector('.ret-o-card__headline')?.innerText.trim();
        const price = el.querySelector('.m-price__price')?.innerText.match(/[\d,.]+/)?.[0].replace(',', '.');
        return name && price ? { name, price: parseFloat(price), store: 'Lidl' } : null;
      }).filter(Boolean);
    });

    products.forEach(p => { p.category = detectCategory(p.name); deals.push(p); });

  } catch (err) {
    console.error('❌ Fehler bei Lidl:', err.message);
  } finally {
    await page.close();
  }

  return deals;
}

// Hilfsfunktionen
function detectCategory(name) {
  const n = name.toLowerCase();
  const categories = {
    Fleisch: ['hack', 'steak', 'schnitzel', 'wurst', 'schinken'],
    Geflügel: ['poulet', 'huhn', 'pute'],
    Fisch: ['lachs', 'forelle', 'thunfisch'],
    Milchprodukte: ['milch', 'käse', 'joghurt'],
    Gemüse: ['salat', 'tomate', 'karotte', 'broccoli'],
    Obst: ['apfel', 'banane', 'orange', 'beere'],
    Brot: ['brot', 'zopf'],
    Getränke: ['wasser', 'cola', 'bier', 'wein']
  };
  for (const [cat, keys] of Object.entries(categories)) {
    if (keys.some(k => n.includes(k))) return cat;
  }
  return 'Sonstiges';
}

function getNextUpdateDate() {
  const now = new Date();
  now.setDate(now.getDate() + 2);
  now.setHours(6, 0, 0, 0);
  return now.toISOString();
}

scrapeAllStores().catch(console.error);
