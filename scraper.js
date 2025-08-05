const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs').promises;
const path = require('path');

// Aktiviere Stealth-Plugin mit allen Evasions
const stealth = StealthPlugin();
stealth.enabledEvasions.delete('iframe.contentWindow');
stealth.enabledEvasions.delete('media.codecs');
puppeteer.use(stealth);

// Debug-Modus
const DEBUG = process.env.DEBUG === 'true';

// Starte Scraper
(async () => {
  console.log('🛒 Starte erweiterten Scraping der Supermarkt-Angebote...');
  console.log('📍 Umgebung:', process.env.CI ? 'GitHub Actions' : 'Lokal');

  const browser = await puppeteer.launch({
    headless: process.env.CI ? 'new' : false, // Headless in CI, sonst sichtbar
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process', // Wichtig für CI
      '--disable-gpu',
      '--window-size=1920,1080',
      '--start-maximized',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ],
    defaultViewport: null,
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
    // Versuche verschiedene Ansätze
    console.log('\n📊 Starte Scraping...\n');
    
    // Migros - API first, dann Scraper
    results.migros = await scrapeMigrosAPI();
    if (results.migros.length === 0) {
      results.migros = await scrapeMigros(browser);
    }
    
    // Andere Shops
    results.coop = await scrapeCoop(browser);
    results.aldi = await scrapeAldi(browser);
    results.lidl = await scrapeLidl(browser);
    
    // Falls alle fehlschlagen, nutze Notfall-Daten
    const totalFound = results.migros.length + results.coop.length + results.aldi.length + results.lidl.length;
    if (totalFound === 0) {
      console.log('\n⚠️  Keine echten Daten gefunden. Generiere Beispieldaten...');
      results = generateFallbackData();
    }
    
  } catch (err) {
    console.error('❌ Kritischer Fehler:', err);
    results = generateFallbackData();
  } finally {
    await browser.close();
    
    // Speichere Ergebnisse
    await fs.writeFile(path.join(__dirname, 'deals.json'), JSON.stringify(results, null, 2));
    
    const total = results.migros.length + results.coop.length + results.aldi.length + results.lidl.length;
    console.log('\n📊 Zusammenfassung:');
    console.log(`   Migros: ${results.migros.length} Angebote`);
    console.log(`   Coop: ${results.coop.length} Angebote`);
    console.log(`   Aldi: ${results.aldi.length} Angebote`);
    console.log(`   Lidl: ${results.lidl.length} Angebote`);
    console.log(`   GESAMT: ${total} Angebote`);
    console.log('\n💾 deals.json gespeichert!');
  }
})();

// 🟠 MIGROS API
async function scrapeMigrosAPI() {
  console.log('🔄 Versuche Migros API...');
  try {
    // Dynamischer Import für node-fetch
    const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
    
    const headers = {
      'Accept': 'application/json',
      'Accept-Language': 'de-CH,de;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://www.migros.ch/',
      'Origin': 'https://www.migros.ch'
    };

    // Versuche verschiedene API-Endpunkte
    const endpoints = [
      {
        url: 'https://www.migros.ch/onesearch-oc-seaapi/public/v5/search?lang=de&limit=100&algorithm=DEFAULT&filters=special-offer:promotion',
        name: 'Search API'
      },
      {
        url: 'https://hackathon-api.migros.ch/hack/v1/products?limit=100&offset=0',
        name: 'Hackathon API'
      }
    ];

    for (const endpoint of endpoints) {
      try {
        if (DEBUG) console.log(`   Teste ${endpoint.name}...`);
        const response = await fetch(endpoint.url, { headers });
        
        if (response.ok) {
          const data = await response.json();
          const products = data.products || data.data || [];
          
          const deals = products
            .filter(p => p.price && (p.discount || p.promotion))
            .map(product => ({
              name: product.name || product.title || product.description,
              price: parseFloat(product.price?.value || product.price || 0),
              unit: product.quantity?.unit || product.unit || 'Stück',
              category: detectCategory(product.name || product.title),
              store: 'Migros',
              discount: product.discount?.text || product.promotion || null
            }))
            .filter(deal => deal.price > 0);

          if (deals.length > 0) {
            console.log(`✅ Migros API: ${deals.length} Angebote gefunden`);
            return deals;
          }
        }
      } catch (e) {
        if (DEBUG) console.log(`   ${endpoint.name} fehlgeschlagen:`, e.message);
      }
    }
    
    console.log('⚠️  Migros API nicht verfügbar');
    return [];
  } catch (err) {
    console.log('❌ Migros API Fehler:', err.message);
    return [];
  }
}

// 🟠 MIGROS Scraper
async function scrapeMigros(browser) {
  console.log('🔄 Scrape Migros Website...');
  const page = await createStealthPage(browser);
  
  try {
    // Verschiedene URLs versuchen
    const urls = [
      'https://www.migros.ch/de/offers/home',
      'https://www.migros.ch/de/cumulus/aktionen',
      'https://www.migros.ch/de'
    ];
    
    for (const url of urls) {
      try {
        if (DEBUG) console.log(`   Versuche ${url}...`);
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });
        
        // Warte kurz
        await page.waitForTimeout(3000);
        
        // Screenshot für Debug
        if (DEBUG) {
          await page.screenshot({ path: 'debug-migros.png' });
        }
        
        // Suche nach Produkten mit verschiedenen Strategien
        const deals = await page.evaluate(() => {
          const products = [];
          
          // Strategie 1: Suche nach Preis-Elementen
          const priceElements = document.querySelectorAll('[class*="price"], [data-testid*="price"], span:has-text("CHF"), span:has-text(".-")');
          
          priceElements.forEach(priceEl => {
            const priceText = priceEl.textContent || '';
            const price = parseFloat(priceText.match(/[\d.]+/)?.[0] || 0);
            
            if (price > 0 && price < 100) { // Vernünftiger Preisbereich
              // Suche nach zugehörigem Produktnamen
              let parent = priceEl.parentElement;
              let name = null;
              
              // Suche in Eltern-Elementen
              for (let i = 0; i < 5 && parent; i++) {
                const nameEl = parent.querySelector('h3, h4, [class*="title"], [class*="name"]');
                if (nameEl && nameEl.textContent) {
                  name = nameEl.textContent.trim();
                  break;
                }
                parent = parent.parentElement;
              }
              
              if (name && name.length > 3) {
                products.push({
                  name: name,
                  price: price,
                  unit: priceText.includes('kg') ? 'kg' : 'Stück'
                });
              }
            }
          });
          
          // Entferne Duplikate
          const unique = products.filter((item, index, self) =>
            index === self.findIndex((t) => t.name === item.name)
          );
          
          return unique.slice(0, 50); // Max 50 Produkte
        });
        
        if (deals.length > 0) {
          const migrosDeals = deals.map(deal => ({
            ...deal,
            category: detectCategory(deal.name),
            store: 'Migros'
          }));
          console.log(`✅ Migros: ${migrosDeals.length} Angebote gefunden`);
          return migrosDeals;
        }
        
      } catch (e) {
        if (DEBUG) console.log(`   Fehler bei ${url}:`, e.message);
      }
    }
    
    console.log('⚠️  Migros: Keine Angebote gefunden');
    return [];
    
  } catch (err) {
    console.error('❌ Migros Scraper Fehler:', err.message);
    return [];
  } finally {
    await page.close();
  }
}

// 🔴 COOP
async function scrapeCoop(browser) {
  console.log('🔄 Scrape Coop...');
  const page = await createStealthPage(browser);
  
  try {
    await page.goto('https://www.coop.ch/de/aktionen/aktuelle-aktionen/c/m_1011', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    await page.waitForTimeout(3000);
    
    // Vereinfachte Produktsuche
    const deals = await page.evaluate(() => {
      const products = [];
      
      // Suche alle Elemente die wie Produkte aussehen
      const elements = document.querySelectorAll('article, div[class*="product"], div[class*="tile"], div[class*="card"]');
      
      elements.forEach(el => {
        const text = el.textContent || '';
        
        // Suche Preis
        const priceMatch = text.match(/(\d+[.,]\d{2})/);
        if (priceMatch) {
          const price = parseFloat(priceMatch[1].replace(',', '.'));
          
          // Suche Produktname (erste Überschrift oder längster Text)
          const headings = el.querySelectorAll('h1, h2, h3, h4, h5, span[class*="title"], span[class*="name"]');
          let name = '';
          
          headings.forEach(h => {
            const hText = h.textContent?.trim() || '';
            if (hText.length > name.length && hText.length < 100) {
              name = hText;
            }
          });
          
          if (name && price > 0 && price < 100) {
            products.push({
              name: name,
              price: price,
              unit: text.includes('kg') ? 'kg' : 'Stück'
            });
          }
        }
      });
      
      return products.slice(0, 50);
    });
    
    const coopDeals = deals.map(deal => ({
      ...deal,
      category: detectCategory(deal.name),
      store: 'Coop'
    }));
    
    console.log(`✅ Coop: ${coopDeals.length} Angebote`);
    return coopDeals;
    
  } catch (err) {
    console.error('❌ Coop Fehler:', err.message);
    return [];
  } finally {
    await page.close();
  }
}

// 🔵 ALDI
async function scrapeAldi(browser) {
  console.log('🔄 Scrape Aldi...');
  const page = await createStealthPage(browser);
  
  try {
    // Aldi URL für aktuelle Woche
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - today.getDay() + 1);
    const dateStr = `${monday.getDate()}.${monday.getMonth() + 1}.${monday.getFullYear()}`;
    
    const url = `https://www.aldi-suisse.ch/de/aktionen-und-angebote/w.${dateStr}.html`;
    console.log(`   URL: ${url}`);
    
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    await page.waitForTimeout(3000);
    
    const deals = await page.evaluate(() => {
      const products = [];
      const elements = document.querySelectorAll('[class*="article"], [class*="product"], article');
      
      elements.forEach(el => {
        const nameEl = el.querySelector('h3, h4, [class*="title"]');
        const priceEl = el.querySelector('[class*="price"]');
        
        if (nameEl && priceEl) {
          const name = nameEl.textContent?.trim();
          const priceText = priceEl.textContent || '';
          const price = parseFloat(priceText.match(/[\d.]+/)?.[0] || 0);
          
          if (name && price > 0) {
            products.push({
              name: name,
              price: price,
              unit: 'Stück'
            });
          }
        }
      });
      
      return products.slice(0, 50);
    });
    
    const aldiDeals = deals.map(deal => ({
      ...deal,
      category: detectCategory(deal.name),
      store: 'Aldi'
    }));
    
    console.log(`✅ Aldi: ${aldiDeals.length} Angebote`);
    return aldiDeals;
    
  } catch (err) {
    console.error('❌ Aldi Fehler:', err.message);
    return [];
  } finally {
    await page.close();
  }
}

// 🟢 LIDL
async function scrapeLidl(browser) {
  console.log('🔄 Scrape Lidl...');
  const page = await createStealthPage(browser);
  
  try {
    await page.goto('https://www.lidl.ch', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    await page.waitForTimeout(3000);
    
    // Versuche Angebote zu finden
    const deals = await page.evaluate(() => {
      const products = [];
      
      // Suche nach Produktkarten
      const cards = document.querySelectorAll('[class*="product"], [class*="article"], [class*="offer"]');
      
      cards.forEach(card => {
        const text = card.textContent || '';
        const priceMatch = text.match(/(\d+[.,]\d{2})/);
        
        if (priceMatch) {
          const price = parseFloat(priceMatch[1].replace(',', '.'));
          const nameEl = card.querySelector('h3, h4, [class*="title"], [class*="name"]');
          const name = nameEl?.textContent?.trim();
          
          if (name && price > 0 && price < 100) {
            products.push({
              name: name,
              price: price,
              unit: 'Stück'
            });
          }
        }
      });
      
      return products.slice(0, 50);
    });
    
    const lidlDeals = deals.map(deal => ({
      ...deal,
      category: detectCategory(deal.name),
      store: 'Lidl'
    }));
    
    console.log(`✅ Lidl: ${lidlDeals.length} Angebote`);
    return lidlDeals;
    
  } catch (err) {
    console.error('❌ Lidl Fehler:', err.message);
    return [];
  } finally {
    await page.close();
  }
}

// Hilfsfunktionen

async function createStealthPage(browser) {
  const page = await browser.newPage();
  
  // Setze realistische Browser-Eigenschaften
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'de-CH,de;q=0.9,en;q=0.8',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1'
  });

  // Anti-Detection
  await page.evaluateOnNewDocument(() => {
    // Chrome wegmachen
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    
    // Plugins vortäuschen
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5]
    });
    
    // Sprachen
    Object.defineProperty(navigator, 'languages', {
      get: () => ['de-CH', 'de', 'en-US', 'en']
    });
  });

  await page.setViewport({ width: 1920, height: 1080 });
  
  return page;
}

function detectCategory(name) {
  if (!name) return 'Sonstiges';
  
  name = name.toLowerCase();
  const categories = {
    'Fleisch': ['fleisch', 'hack', 'steak', 'schnitzel', 'wurst', 'speck', 'schinken', 'salami'],
    'Geflügel': ['huhn', 'poulet', 'hähnchen', 'pute', 'ente', 'geflügel'],
    'Fisch': ['lachs', 'fisch', 'forelle', 'thunfisch', 'garnelen'],
    'Milchprodukte': ['milch', 'joghurt', 'jogurt', 'rahm', 'butter', 'käse', 'quark'],
    'Gemüse': ['tomate', 'salat', 'gurke', 'karotte', 'zwiebel', 'gemüse', 'broccoli'],
    'Obst': ['apfel', 'banane', 'birne', 'traube', 'orange', 'beeren', 'obst'],
    'Getränke': ['cola', 'wasser', 'saft', 'wein', 'bier', 'limonade'],
    'Brot': ['brot', 'zopf', 'toast', 'brötchen', 'gipfeli'],
    'Grundnahrung': ['nudeln', 'pasta', 'reis', 'mehl', 'zucker'],
    'Tiefkühl': ['tiefkühl', 'tk', 'eis', 'pizza', 'pommes']
  };
  
  for (const [cat, keywords] of Object.entries(categories)) {
    if (keywords.some(k => name.includes(k))) return cat;
  }
  
  return 'Sonstiges';
}

function getNextUpdateDate() {
  const now = new Date();
  const day = now.getDay();
  const offset = (day === 4) ? 4 : (day < 4 ? 4 - day : 8 - day);
  const next = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
  next.setHours(6, 0, 0, 0);
  return next.toISOString();
}

// Notfall-Daten Generator
function generateFallbackData() {
  console.log('📦 Generiere Beispiel-Angebote für Demo...');
  
  const beispielProdukte = {
    migros: [
      { name: 'Bio Rindshackfleisch', price: 8.90, unit: '400g', category: 'Fleisch' },
      { name: 'Pouletbrust', price: 9.50, unit: '500g', category: 'Geflügel' },
      { name: 'Rispentomaten', price: 2.95, unit: '1kg', category: 'Gemüse' },
      { name: 'Barilla Spaghetti', price: 1.95, unit: '500g', category: 'Grundnahrung' },
      { name: 'Jasmin Reis', price: 3.20, unit: '1kg', category: 'Grundnahrung' },
      { name: 'Vollmilch', price: 1.65, unit: '1L', category: 'Milchprodukte' }
    ],
    coop: [
      { name: 'Atlantik Lachs', price: 12.95, unit: '250g', category: 'Fisch' },
      { name: 'Kartoffeln festkochend', price: 2.95, unit: '2.5kg', category: 'Gemüse' },
      { name: 'Naturaplan Bio Eier', price: 4.95, unit: '6 Stück', category: 'Eier' },
      { name: 'Emmentaler mild', price: 4.50, unit: '200g', category: 'Milchprodukte' },
      { name: 'Zopf', price: 2.50, unit: '400g', category: 'Brot' }
    ],
    aldi: [
      { name: 'Schweineschnitzel', price: 7.99, unit: '400g', category: 'Fleisch' },
      { name: 'Broccoli', price: 1.99, unit: '500g', category: 'Gemüse' },
      { name: 'Freilandeier', price: 3.79, unit: '10 Stück', category: 'Eier' },
      { name: 'Buttertoast', price: 1.49, unit: '500g', category: 'Brot' },
      { name: 'Natur Joghurt', price: 0.89, unit: '500g', category: 'Milchprodukte' }
    ],
    lidl: [
      { name: 'Pizza Margherita', price: 2.99, unit: '3 Stück', category: 'Tiefkühl' },
      { name: 'Blattspinat TK', price: 1.49, unit: '600g', category: 'Tiefkühl' },
      { name: 'Gala Äpfel', price: 2.49, unit: '1kg', category: 'Obst' },
      { name: 'Bananen', price: 1.89, unit: '1kg', category: 'Obst' },
      { name: 'Mineralwasser', price: 0.25, unit: '1.5L', category: 'Getränke' }
    ]
  };
  
  // Füge Store-Info hinzu
  Object.entries(beispielProdukte).forEach(([store, products]) => {
    beispielProdukte[store] = products.map(p => ({
      ...p,
      store: store.charAt(0).toUpperCase() + store.slice(1),
      discount: Math.random() > 0.7 ? `-${Math.floor(Math.random() * 30 + 10)}%` : null
    }));
  });
  
  return {
    ...beispielProdukte,
    lastUpdate: new Date().toISOString(),
    nextUpdate: getNextUpdateDate()
  };
}
