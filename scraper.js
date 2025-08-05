const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs').promises;
const path = require('path');

// Aktiviere Stealth-Plugin
puppeteer.use(StealthPlugin());

// Starte Scraper
(async () => {
  console.log('🛒 Starte erweiterten Scraping der Supermarkt-Angebote...');

  const browser = await puppeteer.launch({
    headless: 'new', // Für GitHub Actions
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--lang=de-CH,de,en'
    ],
    ignoreDefaultArgs: ['--enable-automation']
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
    // Verwende separate Browser-Kontexte für jeden Shop
    results.migros = await scrapeMigrosAPI() || await scrapeMigros(browser);
    results.coop = await scrapeCoop(browser);
    results.aldi = await scrapeAldi(browser);
    results.lidl = await scrapeLidl(browser);
  } catch (err) {
    console.error('❌ Allgemeiner Fehler:', err.message);
  } finally {
    await browser.close();
    await fs.writeFile(path.join(__dirname, 'deals.json'), JSON.stringify(results, null, 2));
    console.log('💾 Fertig: deals.json gespeichert');
    console.log(`📊 Gesamt: ${results.migros.length + results.coop.length + results.aldi.length + results.lidl.length} Angebote gefunden`);
  }
})();

// 🟠 MIGROS - Primär über API
async function scrapeMigrosAPI() {
  console.log('🔄 Versuche Migros API...');
  try {
    const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
    
    // Suche nach Aktionen
    const searchUrl = 'https://www.migros.ch/onesearch-oc-seaapi/public/v5/search';
    const searchParams = new URLSearchParams({
      lang: 'de',
      algorithm: 'DEFAULT',
      filters: 'outlet:no,special-offer:promotion',
      limit: '100',
      offset: '0'
    });

    const response = await fetch(`${searchUrl}?${searchParams}`, {
      headers: {
        'Accept': 'application/json',
        'Accept-Language': 'de-CH,de;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) throw new Error('API nicht verfügbar');

    const data = await response.json();
    const products = data.products || [];
    
    const deals = products.map(product => ({
      name: product.name || product.title,
      price: parseFloat(product.price?.value || product.price || 0),
      unit: product.quantity?.unit || product.packagingUnit || 'Stück',
      category: detectCategory(product.name || product.title),
      store: 'Migros',
      discount: product.discount?.text || null,
      originalPrice: product.price?.original || null
    })).filter(deal => deal.price > 0);

    console.log(`✅ Migros API: ${deals.length} Angebote`);
    return deals;
  } catch (err) {
    console.log('⚠️ Migros API fehlgeschlagen, verwende Scraper...', err.message);
    return null;
  }
}

// 🟠 MIGROS - Fallback Scraper
async function scrapeMigros(browser) {
  const page = await createStealthPage(browser);
  const deals = [];
  
  try {
    console.log('🔄 Scrape Migros Website...');
    await page.goto('https://www.migros.ch/de/offers/home', {
      waitUntil: 'networkidle0',
      timeout: 60000
    });

    // Warte auf Cloudflare
    await waitForCloudflare(page);
    
    // Scrolle um mehr Produkte zu laden
    await autoScroll(page);
    
    // Warte auf Produkte mit mehreren möglichen Selektoren
    const productSelectors = [
      '[data-cy="product-card"]',
      '[data-testid="product-card"]',
      '.product-item',
      '.offer-tile',
      'article[class*="product"]'
    ];

    let selector = null;
    for (const sel of productSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 5000 });
        selector = sel;
        break;
      } catch (e) {
        continue;
      }
    }

    if (!selector) {
      console.log('❌ Keine Produktselektoren gefunden');
      return deals;
    }

    const items = await page.evaluate((sel) => {
      const products = [];
      document.querySelectorAll(sel).forEach(el => {
        // Verschiedene Selektoren für Namen
        const nameSelectors = [
          '[data-cy="product-name"]',
          '[data-testid="product-name"]',
          '.product-name',
          'h3',
          '[class*="title"]'
        ];
        
        let name = null;
        for (const nameSel of nameSelectors) {
          const nameEl = el.querySelector(nameSel);
          if (nameEl?.textContent) {
            name = nameEl.textContent.trim();
            break;
          }
        }

        // Verschiedene Selektoren für Preise
        const priceSelectors = [
          '[data-cy="product-price"]',
          '[data-testid="product-price"]',
          '.price',
          '[class*="price"]',
          'span[class*="price"]'
        ];

        let priceText = null;
        for (const priceSel of priceSelectors) {
          const priceEl = el.querySelector(priceSel);
          if (priceEl?.textContent) {
            priceText = priceEl.textContent.trim();
            break;
          }
        }

        if (name && priceText) {
          const price = parseFloat(priceText.match(/[\d.]+/)?.[0] || 0);
          if (price > 0) {
            // Suche nach Rabatt
            const discountEl = el.querySelector('[class*="discount"], [class*="reduction"], [class*="save"]');
            const discount = discountEl?.textContent?.trim();

            products.push({
              name,
              price,
              discount,
              unit: priceText.includes('kg') ? 'kg' : 'Stück'
            });
          }
        }
      });
      return products;
    }, selector);

    items.forEach(item => {
      deals.push({
        ...item,
        category: detectCategory(item.name),
        store: 'Migros'
      });
    });

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
  const page = await createStealthPage(browser);
  const deals = [];
  
  try {
    console.log('🔄 Scrape Coop...');
    await page.goto('https://www.coop.ch/de/aktionen/aktuelle-aktionen/c/m_1011', {
      waitUntil: 'networkidle0',
      timeout: 60000
    });

    await waitForCloudflare(page);
    await autoScroll(page);

    // Warte auf Produkte
    await page.waitForSelector('.productTile, .product-item, [class*="product"]', { timeout: 30000 });

    const items = await page.evaluate(() => {
      const products = [];
      const tiles = document.querySelectorAll('.productTile, .product-item, [class*="product-tile"]');
      
      tiles.forEach(el => {
        const name = el.querySelector('.productTile__title-name, [class*="title"], h3')?.textContent?.trim();
        const priceEl = el.querySelector('.productTile__price-value, [class*="price"], .price');
        const priceText = priceEl?.textContent?.trim();
        
        if (name && priceText) {
          const price = parseFloat(priceText.match(/[\d.]+/)?.[0] || 0);
          if (price > 0) {
            const unit = el.querySelector('.productTile__price-unit, [class*="unit"]')?.textContent?.trim() || 'Stück';
            const discount = el.querySelector('[class*="discount"], [class*="badge"]')?.textContent?.trim();
            
            products.push({
              name,
              price,
              unit: unit.replace('/', ''),
              discount
            });
          }
        }
      });
      return products;
    });

    items.forEach(item => {
      deals.push({
        ...item,
        category: detectCategory(item.name),
        store: 'Coop'
      });
    });

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
  const page = await createStealthPage(browser);
  const deals = [];
  
  try {
    console.log('🔄 Scrape Aldi...');
    
    // Berechne nächsten Angebotstermin (Mo oder Do)
    const today = new Date();
    const day = today.getDay();
    const offset = (day === 1 || day === 4) ? 0 : (day < 4 ? 1 - day : 8 - day);
    today.setDate(today.getDate() + offset);
    const dateStr = today.toLocaleDateString('de-CH').replace(/\./g, '-');
    
    const aldiUrl = `https://www.aldi-suisse.ch/de/aktionen-und-angebote/d.${dateStr}.html`;
    console.log(`📅 Aldi URL: ${aldiUrl}`);
    
    await page.goto(aldiUrl, {
      waitUntil: 'networkidle0',
      timeout: 60000
    });

    await waitForCloudflare(page);

    // Warte auf Artikel
    await page.waitForSelector('.mod-article-tile, .product-tile, article', { timeout: 30000 });

    const items = await page.evaluate(() => {
      const products = [];
      const articles = document.querySelectorAll('.mod-article-tile, article[class*="product"]');
      
      articles.forEach(el => {
        const name = el.querySelector('.mod-article-tile__title, h3, [class*="title"]')?.textContent?.trim();
        const priceEl = el.querySelector('.price__main, .price, [class*="price"]');
        const priceText = priceEl?.textContent?.trim();
        
        if (name && priceText) {
          const price = parseFloat(priceText.match(/[\d.]+/)?.[0] || 0);
          if (price > 0) {
            // Aldi zeigt oft "Statt"-Preise
            const originalPriceEl = el.querySelector('.price__previous, [class*="statt"]');
            const originalPrice = originalPriceEl ? parseFloat(originalPriceEl.textContent.match(/[\d.]+/)?.[0] || 0) : null;
            
            products.push({
              name,
              price,
              originalPrice,
              unit: 'Stück'
            });
          }
        }
      });
      return products;
    });

    items.forEach(item => {
      const deal = {
        ...item,
        category: detectCategory(item.name),
        store: 'Aldi'
      };
      
      if (item.originalPrice) {
        deal.discount = `-${Math.round((1 - item.price / item.originalPrice) * 100)}%`;
      }
      
      deals.push(deal);
    });

  } catch (err) {
    console.error('❌ Fehler bei Aldi:', err.message);
  } finally {
    await page.close();
  }
  
  console.log(`✅ Aldi: ${deals.length} Angebote`);
  return deals;
}

// 🟢 LIDL
async function scrapeLidl(browser) {
  const page = await createStealthPage(browser);
  const deals = [];
  
  try {
    console.log('🔄 Scrape Lidl...');
    await page.goto('https://www.lidl.ch/c/de-CH/lidl-plus-angebote/a10020520?channel=store&tabCode=Current_Sales_Week', {
      waitUntil: 'networkidle0',
      timeout: 60000
    });

    await waitForCloudflare(page);
    await autoScroll(page);

    // Warte auf Produkte
    await page.waitForSelector('.ret-o-card, .product-grid-box, [class*="product"]', { timeout: 30000 });

    const items = await page.evaluate(() => {
      const products = [];
      const cards = document.querySelectorAll('.ret-o-card, .product-grid-box, article[class*="product"]');
      
      cards.forEach(el => {
        const name = el.querySelector('.ret-o-card__headline, h3, [class*="title"]')?.textContent?.trim();
        const priceEl = el.querySelector('.m-price__price, .price, [class*="price"]:not([class*="old"])');
        const priceText = priceEl?.textContent?.trim();
        
        if (name && priceText) {
          const price = parseFloat(priceText.match(/[\d.]+/)?.[0] || 0);
          if (price > 0) {
            // Lidl zeigt oft Prozente
            const discountEl = el.querySelector('.m-price__percentage, [class*="discount"], [class*="badge"]');
            const discount = discountEl?.textContent?.trim();
            
            products.push({
              name,
              price,
              discount,
              unit: 'Stück'
            });
          }
        }
      });
      return products;
    });

    items.forEach(item => {
      deals.push({
        ...item,
        category: detectCategory(item.name),
        store: 'Lidl'
      });
    });

  } catch (err) {
    console.error('❌ Fehler bei Lidl:', err.message);
  } finally {
    await page.close();
  }
  
  console.log(`✅ Lidl: ${deals.length} Angebote`);
  return deals;
}

// Hilfsfunktionen

async function createStealthPage(browser) {
  const page = await browser.newPage();
  
  // Setze Schweizer Headers
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'de-CH,de;q=0.9,fr-CH;q=0.8,en;q=0.7',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
  });

  // Überschreibe WebDriver-Eigenschaften
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['de-CH', 'de', 'en'] });
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    
    // Überschreibe Permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );
  });

  // Setze Viewport
  await page.setViewport({ width: 1366, height: 768 });
  
  return page;
}

async function waitForCloudflare(page) {
  try {
    // Warte auf Cloudflare-Prüfung
    await page.waitForFunction(
      () => !document.querySelector('.cf-browser-verification, #cf-wrapper, .cf-im-under-attack'),
      { timeout: 30000 }
    );
    
    // Zusätzliche Wartezeit für dynamische Inhalte
    await page.waitForTimeout(2000);
  } catch (e) {
    console.log('⚠️ Cloudflare-Warnung ignoriert');
  }
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if(totalHeight >= scrollHeight){
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
}

function detectCategory(name) {
  if (!name) return 'Sonstiges';
  
  name = name.toLowerCase();
  const categories = {
    'Fleisch': ['fleisch', 'hack', 'steak', 'schnitzel', 'wurst', 'speck', 'schinken', 'salami', 'cervelat', 'bratwurst'],
    'Geflügel': ['huhn', 'poulet', 'hähnchen', 'pute', 'ente', 'geflügel', 'wings', 'nuggets'],
    'Fisch': ['lachs', 'fisch', 'forelle', 'thunfisch', 'dorsch', 'seelachs', 'garnelen', 'crevetten'],
    'Milchprodukte': ['milch', 'joghurt', 'jogurt', 'rahm', 'butter', 'käse', 'quark', 'mozzarella', 'mascarpone'],
    'Gemüse': ['tomate', 'salat', 'gurke', 'karotte', 'rüebli', 'zwiebel', 'gemüse', 'broccoli', 'spinat', 'peperoni'],
    'Obst': ['apfel', 'banane', 'birne', 'traube', 'orange', 'mandarine', 'kiwi', 'beeren', 'obst', 'frucht'],
    'Getränke': ['cola', 'wasser', 'saft', 'wein', 'bier', 'limonade', 'energy', 'drink', 'tee', 'kaffee'],
    'Brot': ['brot', 'zopf', 'toast', 'brötchen', 'weggli', 'gipfeli', 'croissant', 'baguette'],
    'Grundnahrung': ['nudeln', 'pasta', 'reis', 'mehl', 'zucker', 'teigwaren', 'spaghetti', 'penne'],
    'Tiefkühl': ['tiefkühl', 'tk', 'eis', 'glace', 'pizza', 'pommes', 'frozen'],
    'Fertiggerichte': ['pizza', 'lasagne', 'fertig', 'convenience', 'ready'],
    'Süsswaren': ['schokolade', 'schoggi', 'bonbon', 'gummibärchen', 'keks', 'guetzli', 'süss'],
    'Snacks': ['chips', 'nüsse', 'popcorn', 'cracker', 'snack']
  };
  
  for (const [cat, keywords] of Object.entries(categories)) {
    if (keywords.some(k => name.includes(k))) return cat;
  }
  
  return 'Sonstiges';
}

function getNextUpdateDate() {
  const now = new Date();
  const day = now.getDay();
  // Nächster Montag oder Donnerstag
  const offset = (day === 4) ? 4 : (day < 4 ? 4 - day : 8 - day);
  const next = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
  next.setHours(6, 0, 0, 0);
  return next.toISOString();
}
