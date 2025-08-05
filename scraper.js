// scraper.js
const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

(async () => {
  console.log('🛍️ Starte Scraping der Supermarkt-Angebote...');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  const results = {
    migros: [],
    coop: [],
    aldi: [],
    lidl: [],
    lastUpdate: new Date().toISOString()
  };

  // Scraping-Methoden hier einfügen
  async function scrapeMigros() {
    try {
      await page.goto('https://www.migros.ch/de/offers/home', { waitUntil: 'networkidle2' });
      await page.waitForSelector('[data-testid="product"]', { timeout: 10000 });
      results.migros = await page.evaluate(() => {
        const data = [];
        document.querySelectorAll('[data-testid="product"]').forEach(el => {
          const name = el.querySelector('[data-testid="product-name"]')?.textContent?.trim();
          const price = el.querySelector('[data-testid="product-price"]')?.textContent?.trim();
          if (name && price) data.push({ name, price });
        });
        return data;
      });
      console.log(`✅ Migros: ${results.migros.length} Angebote`);
    } catch (err) {
      console.error('❌ Fehler bei Migros:', err.message);
    }
  }

  async function scrapeCoop() {
    try {
      await page.goto('https://www.coop.ch/de/aktionen/aktuelle-aktionen/c/m_1011', { waitUntil: 'networkidle2' });
      await page.waitForSelector('.product-tile__title', { timeout: 10000 });
      results.coop = await page.evaluate(() => {
        const data = [];
        document.querySelectorAll('.product-tile').forEach(el => {
          const name = el.querySelector('.product-tile__title')?.textContent?.trim();
          const price = el.querySelector('.product-tile__price')?.textContent?.trim();
          if (name && price) data.push({ name, price });
        });
        return data;
      });
      console.log(`✅ Coop: ${results.coop.length} Angebote`);
    } catch (err) {
      console.error('❌ Fehler bei Coop:', err.message);
    }
  }

  async function scrapeAldi() {
    const date = new Date();
    const day = date.getDay();
    const daysToAdd = day <= 1 ? 1 - day : (day <= 4 ? 4 - day : 8 - day);
    date.setDate(date.getDate() + daysToAdd);
    const dateStr = `${date.getDate()}-${date.getMonth() + 1}-${date.getFullYear()}`;
    const url = `https://www.aldi-suisse.ch/de/aktionen-und-angebote/d.${dateStr}.html`;

    try {
      await page.goto(url, { waitUntil: 'networkidle2' });
      await page.waitForSelector('.mod-article-tile__title', { timeout: 10000 });
      results.aldi = await page.evaluate(() => {
        const data = [];
        document.querySelectorAll('.mod-article-tile').forEach(el => {
          const name = el.querySelector('.mod-article-tile__title')?.textContent?.trim();
          const price = el.querySelector('.mod-article-tile__price')?.textContent?.trim();
          if (name && price) data.push({ name, price });
        });
        return data;
      });
      console.log(`✅ Aldi (${dateStr}): ${results.aldi.length} Angebote`);
    } catch (err) {
      console.error('❌ Fehler bei Aldi:', err.message);
    }
  }

  async function scrapeLidl() {
    try {
      await page.goto('https://www.lidl.ch/c/de-CH/lidl-plus-angebote/a10020520?channel=store&tabCode=Current_Sales_Week', { waitUntil: 'networkidle2' });
      await page.waitForSelector('.ret-o-card__headline', { timeout: 10000 });
      results.lidl = await page.evaluate(() => {
        const data = [];
        document.querySelectorAll('.ret-o-card').forEach(el => {
          const name = el.querySelector('.ret-o-card__headline')?.textContent?.trim();
          const price = el.querySelector('.m-price__price')?.textContent?.trim();
          if (name && price) data.push({ name, price });
        });
        return data;
      });
      console.log(`✅ Lidl: ${results.lidl.length} Angebote`);
    } catch (err) {
      console.error('❌ Fehler bei Lidl:', err.message);
    }
  }

  // Führe Scraper aus
  await scrapeMigros();
  await scrapeCoop();
  await scrapeAldi();
  await scrapeLidl();

  await fs.writeFile(
    path.join(__dirname, 'deals.json'),
    JSON.stringify(results, null, 2)
  );

  console.log('📂 Fertig: deals.json gespeichert');
  await browser.close();
})();
