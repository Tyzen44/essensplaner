// scraper.js - Läuft in GitHub Actions
const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

// Hauptfunktion
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
    // Scrape alle Supermärkte
    console.log('📍 Scraping Migros...');
    results.migros = await scrapeMigros(browser);
    console.log(`✅ Migros: ${results.migros.length} Angebote gefunden`);

    console.log('📍 Scraping Coop...');
    results.coop = await scrapeCoop(browser);
    console.log(`✅ Coop: ${results.coop.length} Angebote gefunden`);

    console.log('📍 Scraping Aldi...');
    results.aldi = await scrapeAldi(browser);
    console.log(`✅ Aldi: ${results.aldi.length} Angebote gefunden`);

    console.log('📍 Scraping Lidl...');
    results.lidl = await scrapeLidl(browser);
    console.log(`✅ Lidl: ${results.lidl.length} Angebote gefunden`);

  } catch (error) {
    console.error('❌ Fehler beim Scraping:', error);
  } finally {
    await browser.close();
  }

  // Speichere Ergebnisse
  await fs.writeFile(
    path.join(__dirname, 'deals.json'),
    JSON.stringify(results, null, 2)
  );

  console.log('💾 Angebote gespeichert in deals.json');
  console.log(`📊 Gesamt: ${Object.values(results).filter(Array.isArray).reduce((sum, arr) => sum + arr.length, 0)} Angebote`);
}

// Migros Scraper
async function scrapeMigros(browser) {
  const page = await browser.newPage();
  const deals = [];

  try {
    await page.goto('https://www.migros.ch/de/cumulus/angebote', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Warte auf Produkte
    await page.waitForSelector('.product-item, .offer-item, [data-testid="product"]', { 
      timeout: 10000 
    }).catch(() => console.log('⚠️ Migros: Keine Produkte gefunden'));

    // Extrahiere Angebote
    const products = await page.evaluate(() => {
      const items = [];
      
      // Versuche verschiedene Selektoren
      const selectors = [
        '.product-item',
        '.offer-item',
        '[data-testid="product"]',
        '.article-item'
      ];
      
      for (const selector of selectors) {
        document.querySelectorAll(selector).forEach(el => {
          const name = el.querySelector('.product-name, .article-name, h3, h4')?.textContent?.trim();
          const priceEl = el.querySelector('.price, .product-price, [data-testid="price"]');
          const price = priceEl?.textContent?.match(/[\d.]+/)?.[0];
          
          if (name && price) {
            items.push({
              name: name,
              price: parseFloat(price),
              unit: el.querySelector('.unit, .price-unit')?.textContent?.trim() || 'Stück',
              store: 'Migros'
            });
          }
        });
      }
      
      return items;
    });

    // Kategorisiere Produkte
    products.forEach(product => {
      product.category = detectCategory(product.name);
      deals.push(product);
    });

  } catch (error) {
    console.error('❌ Fehler bei Migros:', error.message);
  } finally {
    await page.close();
  }

  return deals;
}

// Coop Scraper
async function scrapeCoop(browser) {
  const page = await browser.newPage();
  const deals = [];

  try {
    await page.goto('https://www.coop.ch/de/aktionen/wochenaktionen.html', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    await page.waitForSelector('.productTile, .product-tile', { 
      timeout: 10000 
    }).catch(() => console.log('⚠️ Coop: Keine Produkte gefunden'));

    const products = await page.evaluate(() => {
      const items = [];
      
      document.querySelectorAll('.productTile, .product-tile').forEach(el => {
        const name = el.querySelector('.productTile__name, .product-name')?.textContent?.trim();
        const priceEl = el.querySelector('.productTile__price-value, .price');
        const price = priceEl?.textContent?.match(/[\d.]+/)?.[0];
        
        if (name && price) {
          items.push({
            name: name,
            price: parseFloat(price),
            unit: el.querySelector('.productTile__price-unit')?.textContent?.trim() || 'Stück',
            discount: el.querySelector('.badge--discount')?.textContent?.trim(),
            store: 'Coop'
          });
        }
      });
      
      return items;
    });

    products.forEach(product => {
      product.category = detectCategory(product.name);
      deals.push(product);
    });

  } catch (error) {
    console.error('❌ Fehler bei Coop:', error.message);
  } finally {
    await page.close();
  }

  return deals;
}

// Aldi Scraper
async function scrapeAldi(browser) {
  const page = await browser.newPage();
  const deals = [];

  try {
    await page.goto('https://www.aldi-suisse.ch/de/angebote.html', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    await page.waitForSelector('.mod-article-tile', { 
      timeout: 10000 
    }).catch(() => console.log('⚠️ Aldi: Keine Produkte gefunden'));

    const products = await page.evaluate(() => {
      const items = [];
      
      document.querySelectorAll('.mod-article-tile').forEach(el => {
        const name = el.querySelector('.mod-article-tile__title')?.textContent?.trim();
        const priceEl = el.querySelector('.price__main');
        const price = priceEl?.textContent?.match(/[\d.]+/)?.[0];
        
        if (name && price) {
          items.push({
            name: name,
            price: parseFloat(price),
            unit: el.querySelector('.price__unit')?.textContent?.trim() || 'Stück',
            store: 'Aldi'
          });
        }
      });
      
      return items;
    });

    products.forEach(product => {
      product.category = detectCategory(product.name);
      deals.push(product);
    });

  } catch (error) {
    console.error('❌ Fehler bei Aldi:', error.message);
  } finally {
    await page.close();
  }

  return deals;
}

// Lidl Scraper
async function scrapeLidl(browser) {
  const page = await browser.newPage();
  const deals = [];

  try {
    await page.goto('https://www.lidl.ch/de/angebote', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    await page.waitForSelector('.product, .ret-o-card', { 
      timeout: 10000 
    }).catch(() => console.log('⚠️ Lidl: Keine Produkte gefunden'));

    const products = await page.evaluate(() => {
      const items = [];
      
      document.querySelectorAll('.product, .ret-o-card').forEach(el => {
        const name = el.querySelector('.product__title, .ret-o-card__headline')?.textContent?.trim();
        const priceEl = el.querySelector('.m-price__price, .lidl-m-pricebox__price');
        const price = priceEl?.textContent?.match(/[\d.]+/)?.[0];
        
        if (name && price) {
          items.push({
            name: name,
            price: parseFloat(price),
            unit: el.querySelector('.m-price__unit')?.textContent?.trim() || 'Stück',
            store: 'Lidl'
          });
        }
      });
      
      return items;
    });

    products.forEach(product => {
      product.category = detectCategory(product.name);
      deals.push(product);
    });

  } catch (error) {
    console.error('❌ Fehler bei Lidl:', error.message);
  } finally {
    await page.close();
  }

  return deals;
}

// Kategorie-Erkennung
function detectCategory(productName) {
  const name = productName.toLowerCase();
  
  const categories = {
    'Fleisch': ['fleisch', 'hack', 'steak', 'schnitzel', 'wurst', 'schinken', 'speck'],
    'Geflügel': ['poulet', 'huhn', 'hähnchen', 'geflügel', 'pute', 'ente'],
    'Fisch': ['fisch', 'lachs', 'forelle', 'dorsch', 'thunfisch', 'garnelen'],
    'Milchprodukte': ['milch', 'käse', 'joghurt', 'butter', 'rahm', 'quark', 'mozzarella'],
    'Gemüse': ['gemüse', 'salat', 'tomate', 'gurke', 'karotte', 'zwiebel', 'kartoffel', 'broccoli', 'spinat'],
    'Obst': ['obst', 'apfel', 'banane', 'orange', 'beere', 'traube', 'birne', 'kiwi'],
    'Brot': ['brot', 'brötchen', 'toast', 'baguette', 'zopf'],
    'Grundnahrung': ['nudel', 'pasta', 'reis', 'mehl', 'zucker', 'öl'],
    'Tiefkühl': ['tiefkühl', 'tk', 'gefroren', 'eis'],
    'Getränke': ['wasser', 'saft', 'cola', 'bier', 'wein', 'kaffee', 'tee']
  };

  for (const [category, keywords] of Object.entries(categories)) {
    if (keywords.some(keyword => name.includes(keyword))) {
      return category;
    }
  }

  return 'Sonstiges';
}

// Nächstes Update-Datum berechnen
function getNextUpdateDate() {
  const now = new Date();
  const day = now.getDay();
  
  // Nächster Montag oder Donnerstag
  let daysUntilNext;
  if (day === 0) daysUntilNext = 1; // Sonntag -> Montag
  else if (day < 4) daysUntilNext = 4 - day; // Vor Donnerstag
  else if (day === 4) daysUntilNext = 4; // Donnerstag -> nächster Montag
  else daysUntilNext = 8 - day; // Nach Donnerstag -> Montag
  
  const nextUpdate = new Date(now);
  nextUpdate.setDate(now.getDate() + daysUntilNext);
  nextUpdate.setHours(6, 0, 0, 0);
  
  return nextUpdate.toISOString();
}

// Starte Scraping
scrapeAllStores().catch(console.error);
