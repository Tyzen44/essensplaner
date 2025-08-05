
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
