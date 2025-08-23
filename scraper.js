const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs').promises;
const path = require('path');
const Tesseract = require('tesseract.js');
const sharp = require('sharp');

// Aktiviere Stealth-Plugin für Anti-Bot-Umgehung
puppeteer.use(StealthPlugin());

// OCR-Konfiguration
const OCR_CONFIG = {
  lang: 'deu+eng',
  options: {
    tessedit_char_whitelist: '0123456789.,CHFchfabcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZäöüÄÖÜßéèàêâôûîç-% ',
    tessedit_pageseg_mode: 6 // Assume uniform block of text
  }
};

console.log('🤖 Starte OCR-basierten Supermarkt-Scraper...');
console.log('📋 Computer Vision Modus - Angebote werden aus Screenshots erkannt');

(async () => {
  let browser;
  
  try {
    browser = await puppeteer.launch({
      headless: process.env.NODE_ENV === 'production',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--window-size=1920,1080',
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
      method: 'OCR-Computer-Vision',
      ocrEngine: 'Tesseract.js'
    };

    // Scrape alle Stores mit OCR
    console.log('🟠 Starte Migros OCR...');
    results.migros = await scrapeStoreWithOCR(browser, 'migros');
    
    console.log('🔴 Starte Coop OCR...');
    results.coop = await scrapeStoreWithOCR(browser, 'coop');
    
    console.log('🔵 Starte Aldi OCR...');
    results.aldi = await scrapeStoreWithOCR(browser, 'aldi');
    
    console.log('🟢 Starte Lidl OCR...');
    results.lidl = await scrapeStoreWithOCR(browser, 'lidl');

    // Speichere Ergebnisse
    await fs.writeFile(
      path.join(__dirname, 'deals.json'), 
      JSON.stringify(results, null, 2)
    );

    const totalDeals = results.migros.length + results.coop.length + 
                      results.aldi.length + results.lidl.length;

    console.log('\n✅ OCR-Scraping abgeschlossen!');
    console.log(`📊 Gesamt: ${totalDeals} Angebote erkannt`);
    console.log(`🟠 Migros: ${results.migros.length} Angebote`);
    console.log(`🔴 Coop: ${results.coop.length} Angebote`);
    console.log(`🔵 Aldi: ${results.aldi.length} Angebote`);
    console.log(`🟢 Lidl: ${results.lidl.length} Angebote`);
    console.log('💾 Ergebnisse in deals.json gespeichert');

  } catch (error) {
    console.error('❌ Kritischer Fehler:', error.message);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();

// Haupt-OCR-Scraping-Funktion
async function scrapeStoreWithOCR(browser, storeName) {
  const page = await createStealthPage(browser);
  const deals = [];
  
  try {
    const storeConfig = getStoreConfig(storeName);
    
    console.log(`  📱 Navigiere zu ${storeName} Website...`);
    await page.goto(storeConfig.url, {
      waitUntil: 'networkidle0',
      timeout: 60000
    });

    // Warte auf vollständige Seitenladen
    await waitForPageToLoad(page);
    
    // Scrolle um alle Angebote zu laden
    await autoScroll(page);
    
    console.log(`  📸 Erstelle Screenshots für ${storeName}...`);
    const screenshots = await captureOfferScreenshots(page, storeConfig);
    
    console.log(`  🔍 Verarbeite ${screenshots.length} Screenshots mit OCR...`);
    
    // Verarbeite jeden Screenshot
    for (let i = 0; i < screenshots.length; i++) {
      const screenshotDeals = await processScreenshotWithOCR(
        screenshots[i], 
        storeName,
        `${storeName}_${i}`
      );
      deals.push(...screenshotDeals);
    }
    
    // Bereinige und validiere Ergebnisse
    const cleanedDeals = cleanAndValidateDeals(deals, storeName);
    
    console.log(`  ✅ ${storeName}: ${cleanedDeals.length} Angebote durch OCR erkannt`);
    return cleanedDeals;
    
  } catch (error) {
    console.error(`  ❌ OCR-Fehler bei ${storeName}:`, error.message);
    return [];
  } finally {
    await page.close();
  }
}

// Store-spezifische Konfigurationen
function getStoreConfig(store) {
  const configs = {
    migros: {
      url: 'https://www.migros.ch/de/offers/home',
      screenshotAreas: [
        { x: 0, y: 200, width: 1920, height: 800 },
        { x: 0, y: 1000, width: 1920, height: 800 },
        { x: 0, y: 1800, width: 1920, height: 800 }
      ],
      pricePatterns: [
        /(\d+[.,]\d{2})\s*CHF/gi,
        /CHF\s*(\d+[.,]\d{2})/gi,
        /(\d+[.,]\d{2})\s*Fr\./gi,
        /(\d+[.,]\d{2})/g
      ]
    },
    coop: {
      url: 'https://www.coop.ch/de/aktionen/aktuelle-aktionen/c/m_1011',
      screenshotAreas: [
        { x: 0, y: 300, width: 1920, height: 900 },
        { x: 0, y: 1200, width: 1920, height: 900 }
      ],
      pricePatterns: [
        /(\d+[.,]\d{2})\s*CHF/gi,
        /CHF\s*(\d+[.,]\d{2})/gi,
        /(\d+[.,]\d{2})/g
      ]
    },
    aldi: {
      url: 'https://www.aldi-suisse.ch/de/aktionen-und-angebote/',
      screenshotAreas: [
        { x: 0, y: 400, width: 1920, height: 1000 },
        { x: 0, y: 1400, width: 1920, height: 1000 }
      ],
      pricePatterns: [
        /(\d+[.,]\d{2})/g,
        /(\d+[.,]-{1,2})/g,
        /(\d+)\.-/g
      ]
    },
    lidl: {
      url: 'https://www.lidl.ch/c/de-CH/lidl-plus-angebote/a10020520?channel=store&tabCode=Current_Sales_Week',
      screenshotAreas: [
        { x: 0, y: 250, width: 1920, height: 1200 },
        { x: 0, y: 1450, width: 1920, height: 1000 }
      ],
      pricePatterns: [
        /(\d+[.,]\d{2})/g,
        /(\d+)\.-/g
      ]
    }
  };
  
  return configs[store] || configs.migros;
}

// Erstelle stealth Browser-Page
async function createStealthPage(browser) {
  const page = await browser.newPage();
  
  // Setze Schweizer Headers
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'de-CH,de;q=0.9,fr-CH;q=0.8,en;q=0.7',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  // Überschreibe WebDriver-Eigenschaften
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['de-CH', 'de', 'en'] });
    Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
    
    // Überschreibe Permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );
  });

  await page.setViewport({ width: 1920, height: 1080 });
  return page;
}

// Warte auf vollständiges Laden der Seite
async function waitForPageToLoad(page) {
  try {
    await page.waitForSelector('body', { timeout: 30000 });
    await page.waitForTimeout(3000);
    
    // Prüfe auf Cloudflare oder andere Schutzmaßnahmen
    const hasProtection = await page.$('.cf-browser-verification, #cf-wrapper, .challenge-running');
    if (hasProtection) {
      console.log('    ⏳ Anti-Bot-Schutz erkannt, warte...');
      await page.waitForTimeout(15000);
    }
    
  } catch (e) {
    console.log('    ⚠️ Seiten-Warnung ignoriert');
  }
}

// Auto-Scroll durch die Seite
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 200;
      const maxHeight = 5000; // Begrenze Scroll-Tiefe
      
      const timer = setInterval(() => {
        const scrollHeight = Math.min(document.body.scrollHeight, maxHeight);
        window.scrollBy(0, distance);
        totalHeight += distance;

        if(totalHeight >= scrollHeight){
          clearInterval(timer);
          resolve();
        }
      }, 200);
    });
  });
  
  await page.waitForTimeout(3000);
}

// Erstelle Screenshots der Angebots-Bereiche
async function captureOfferScreenshots(page, storeConfig) {
  const screenshots = [];
  
  for (const area of storeConfig.screenshotAreas) {
    try {
      const screenshot = await page.screenshot({
        clip: area,
        type: 'png'
      });
      
      // Optimiere Bild für OCR
      const optimizedImage = await optimizeImageForOCR(screenshot);
      screenshots.push(optimizedImage);
      
    } catch (error) {
      console.log(`    ⚠️ Screenshot fehlgeschlagen:`, error.message);
    }
  }
  
  return screenshots;
}

// Bildoptimierung für bessere OCR-Ergebnisse
async function optimizeImageForOCR(imageBuffer) {
  try {
    const optimized = await sharp(imageBuffer)
      .resize(null, 1600, { withoutEnlargement: false })
      .sharpen(1.5)
      .normalize()
      .threshold(120)
      .png()
      .toBuffer();
      
    return optimized;
  } catch (error) {
    console.log('    ⚠️ Bildoptimierung fehlgeschlagen, verwende Original');
    return imageBuffer;
  }
}

// OCR-Verarbeitung eines Screenshots
async function processScreenshotWithOCR(imageBuffer, store, identifier) {
  const deals = [];
  
  try {
    console.log(`    🔤 OCR-Analyse für ${identifier}...`);
    
    const { data: { text, confidence } } = await Tesseract.recognize(
      imageBuffer,
      OCR_CONFIG.lang,
      OCR_CONFIG.options
    );
    
    console.log(`    📊 OCR-Vertrauen: ${confidence.toFixed(1)}%`);
    
    if (confidence < 20) {
      console.log('    ⚠️ Niedrige OCR-Qualität');
      return [];
    }
    
    // Extrahiere Angebote aus erkanntem Text
    const extractedDeals = extractDealsFromOCRText(text, store);
    deals.push(...extractedDeals);
    
    // Debug: Speichere OCR-Text wenn Debug-Modus aktiv
    if (process.env.DEBUG_OCR === 'true') {
      await fs.writeFile(`debug_${identifier}.txt`, text).catch(() => {});
    }
    
  } catch (error) {
    console.error(`    ❌ OCR fehlgeschlagen für ${identifier}:`, error.message);
  }
  
  return deals;
}

// Extrahiere Deals aus OCR-Text
function extractDealsFromOCRText(text, store) {
  const deals = [];
  const lines = text.split('\n').filter(line => line.trim().length > 2);
  
  const storeConfig = getStoreConfig(store);
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';
    const prevLine = i > 0 ? lines[i - 1].trim() : '';
    
    // Suche nach Preisen mit allen Patterns
    for (const pricePattern of storeConfig.pricePatterns) {
      const priceMatches = line.match(pricePattern);
      
      if (priceMatches) {
        for (const priceMatch of priceMatches) {
          const price = parsePrice(priceMatch);
          
          if (price > 0.50 && price < 300) {
            const searchText = `${prevLine} ${line} ${nextLine}`;
            const productName = extractProductName(searchText, priceMatch);
            
            if (productName && productName.length > 3 && productName.length < 60) {
              const deal = {
                name: cleanProductName(productName),
                price: price,
                unit: extractUnit(searchText) || 'Stück',
                category: detectCategory(productName),
                store: store.charAt(0).toUpperCase() + store.slice(1),
                ocrSource: true
              };
              
              if (!isDuplicate(deals, deal)) {
                deals.push(deal);
              }
            }
          }
        }
      }
    }
  }
  
  return deals;
}

// Parse Preis aus Text
function parsePrice(priceText) {
  const cleanPrice = priceText
    .replace(/[^\d.,-]/g, '')
    .replace(',', '.')
    .replace(/-+$/, ''); // Entferne trailing dashes
  
  const price = parseFloat(cleanPrice);
  return isNaN(price) ? 0 : price;
}

// Extrahiere Produktnamen
function extractProductName(text, excludePrice) {
  let cleanText = text.replace(excludePrice, '').trim();
  
  // Entferne häufige OCR-Artefakte
  cleanText = cleanText
    .replace(/[|\\\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  // Suche nach sinnvollen Produktnamen
  const namePatterns = [
    /([A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-Za-zÄÖÜäöüß]+)*)/g,
    /([A-Za-zÄÖÜäöüß]{4,}(?:\s+[A-Za-zÄÖÜäöüß]+){0,3})/g
  ];
  
  for (const pattern of namePatterns) {
    const matches = cleanText.match(pattern);
    if (matches) {
      const validNames = matches
        .filter(m => m.length > 3 && m.length < 50)
        .filter(m => !/^\d/.test(m))
        .filter(m => !isCommonOCRNoise(m));
      
      if (validNames.length > 0) {
        return validNames[0];
      }
    }
  }
  
  return null;
}

// Prüfe auf häufige OCR-Fehler
function isCommonOCRNoise(text) {
  const noisePatterns = [
    /^(CHF|Fr\.|EUR|USD|www|http|\.com)$/i,
    /^[^a-zA-ZÄÖÜäöüß]*$/,
    /^(und|oder|mit|von|für|pro|per|ab|bis|ca)$/i
  ];
  
  return noisePatterns.some(pattern => pattern.test(text));
}

// Bereinige Produktnamen
function cleanProductName(name) {
  return name
    .replace(/[^\w\säöüÄÖÜß-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Extrahiere Einheiten
function extractUnit(text) {
  const unitPatterns = [
    /(\d+\s*g)\b/i,
    /(\d+\s*kg)\b/i,
    /(\d+\s*ml)\b/i,
    /(\d+\s*l)\b/i,
    /(\d+\s*stück|\d+\s*stk)\b/i,
    /(pro\s*kg|per\s*kg)/i,
    /(pro\s*100g|per\s*100g)/i
  ];
  
  for (const pattern of unitPatterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].replace(/\s+/g, '');
    }
  }
  
  return 'Stück';
}

// Erkenne Kategorien
function detectCategory(name) {
  if (!name) return 'Sonstiges';
  
  name = name.toLowerCase();
  const categories = {
    'Fleisch': ['fleisch', 'hack', 'steak', 'schnitzel', 'wurst', 'speck', 'schinken', 'salami', 'cervelat'],
    'Geflügel': ['huhn', 'poulet', 'hähnchen', 'pute', 'ente', 'geflügel', 'wings', 'nuggets'],
    'Fisch': ['lachs', 'fisch', 'forelle', 'thunfisch', 'dorsch', 'seelachs', 'garnelen', 'crevetten'],
    'Milchprodukte': ['milch', 'joghurt', 'jogurt', 'rahm', 'butter', 'käse', 'quark', 'mozzarella'],
    'Gemüse': ['tomate', 'salat', 'gurke', 'karotte', 'rüebli', 'zwiebel', 'broccoli', 'spinat', 'peperoni'],
    'Obst': ['apfel', 'banane', 'birne', 'traube', 'orange', 'mandarine', 'kiwi', 'beeren'],
    'Getränke': ['cola', 'wasser', 'saft', 'wein', 'bier', 'limonade', 'energy', 'drink', 'tee', 'kaffee'],
    'Brot': ['brot', 'zopf', 'toast', 'brötchen', 'weggli', 'gipfeli', 'croissant', 'baguette'],
    'Grundnahrung': ['nudeln', 'pasta', 'reis', 'mehl', 'zucker', 'teigwaren', 'spaghetti'],
    'Tiefkühl': ['tiefkühl', 'tk', 'eis', 'glace', 'pizza', 'pommes', 'frozen'],
    'Süsswaren': ['schokolade', 'schoggi', 'bonbon', 'gummibärchen', 'keks', 'guetzli'],
    'Snacks': ['chips', 'nüsse', 'popcorn', 'cracker', 'snack']
  };
  
  for (const [cat, keywords] of Object.entries(categories)) {
    if (keywords.some(k => name.includes(k))) return cat;
  }
  
  return 'Sonstiges';
}

// Prüfe auf Duplikate
function isDuplicate(existingDeals, newDeal) {
  return existingDeals.some(deal => 
    deal.name.toLowerCase() === newDeal.name.toLowerCase() &&
    Math.abs(deal.price - newDeal.price) < 0.10
  );
}

// Bereinige und validiere Endergebnisse
function cleanAndValidateDeals(deals, store) {
  return deals
    .filter(deal => 
      deal.name && 
      deal.name.length > 3 &&
      deal.name.length < 60 &&
      deal.price > 0.50 && 
      deal.price < 300 &&
      !deal.name.includes('undefined') &&
      !/^\d+$/.test(deal.name) // Keine reinen Zahlen
    )
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 40) // Max 40 Angebote pro Store
    .map(deal => ({
      ...deal,
      price: Math.round(deal.price * 100) / 100 // Runde auf 2 Dezimalstellen
    }));
}
