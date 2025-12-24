#!/usr/bin/env node

/**
 * Historical Data Fetcher
 * Version: 1.0.0
 * 
 * Fetches and caches historical OHLCV data from Binance.US
 * for backtesting purposes.
 */

import ccxt from 'ccxt';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_DIR = path.join(__dirname, 'data');

/**
 * Ensure cache directory exists
 */
function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/**
 * Get cache filename for a symbol and timeframe
 */
function getCacheFilename(symbol, timeframe, startDate, endDate) {
  const cleanSymbol = symbol.replace('/', '-');
  return path.join(CACHE_DIR, `${cleanSymbol}_${timeframe}_${startDate}_${endDate}.json`);
}

/**
 * Historical Data Fetcher Class
 */
export class HistoricalDataFetcher {
  constructor(options = {}) {
    this.exchange = new ccxt.binanceus({
      enableRateLimit: true,
      ...options
    });
    
    this.maxRetries = 3;
    this.retryDelay = 1000;
    this.marketsLoaded = false;
  }

  /**
   * Load markets if not already loaded
   */
  async loadMarkets() {
    if (!this.marketsLoaded) {
      console.log('📊 Loading exchange markets...');
      await this.exchange.loadMarkets();
      this.marketsLoaded = true;
    }
  }

  /**
   * Find the correct symbol format for the exchange
   */
  findSymbol(inputSymbol) {
    // Try exact match first
    if (this.exchange.markets[inputSymbol]) {
      return inputSymbol;
    }
    
    // Parse the input symbol
    const [base, quote] = inputSymbol.split('/');
    
    // Build list of variations to try
    const variations = [
      inputSymbol,                           // BTC/USD (exact)
      `${base}/USDT`,                        // BTC/USDT
      `${base}/USDC`,                        // BTC/USDC
      `${base}/BUSD`,                        // BTC/BUSD
      inputSymbol.replace('/', ''),          // BTCUSD
    ];
    
    console.log(`   Looking for symbol variations: ${variations.join(', ')}`);
    
    for (const variation of variations) {
      if (this.exchange.markets[variation]) {
        console.log(`   ✓ Found: ${variation}`);
        return variation;
      }
    }
    
    // Search by base currency
    console.log(`   Searching by base currency: ${base}`);
    for (const marketId of Object.keys(this.exchange.markets)) {
      const market = this.exchange.markets[marketId];
      if (market.base === base) {
        console.log(`   ✓ Found by base: ${marketId}`);
        return marketId;
      }
    }
    
    console.log(`   ✗ No match found, using original: ${inputSymbol}`);
    return inputSymbol;  // Return original if nothing found
  }

  /**
   * Fetch OHLCV data for a symbol
   * @param {string} symbol - Trading pair (e.g., 'BTC/USD')
   * @param {string} timeframe - Candle timeframe (e.g., '1h', '15m', '1d')
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @param {boolean} useCache - Whether to use cached data
   */
  async fetchOHLCV(symbol, timeframe, startDate, endDate, useCache = true) {
    ensureCacheDir();
    
    const cacheFile = getCacheFilename(symbol, timeframe, startDate, endDate);
    
    // Check cache first
    if (useCache && fs.existsSync(cacheFile)) {
      console.log(`📂 Loading cached data for ${symbol} ${timeframe}`);
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      return cached;
    }
    
    // Load markets to find correct symbol format
    await this.loadMarkets();
    const exchangeSymbol = this.findSymbol(symbol);
    
    if (exchangeSymbol !== symbol) {
      console.log(`🔄 Using exchange symbol: ${exchangeSymbol} (requested: ${symbol})`);
    }
    
    console.log(`📡 Fetching ${exchangeSymbol} ${timeframe} data from ${startDate} to ${endDate}...`);
    
    const startTimestamp = new Date(startDate).getTime();
    const endTimestamp = new Date(endDate).getTime();
    
    let allCandles = [];
    let since = startTimestamp;
    let fetchCount = 0;
    
    while (since < endTimestamp) {
      try {
        const candles = await this.exchange.fetchOHLCV(exchangeSymbol, timeframe, since, 1000);
        
        if (candles.length === 0) break;
        
        // Filter candles within date range
        const filteredCandles = candles.filter(c => c[0] >= startTimestamp && c[0] <= endTimestamp);
        allCandles = allCandles.concat(filteredCandles);
        
        // Move to next batch
        since = candles[candles.length - 1][0] + 1;
        fetchCount++;
        
        // Progress indicator
        const progress = Math.min(100, ((since - startTimestamp) / (endTimestamp - startTimestamp) * 100)).toFixed(1);
        process.stdout.write(`\r   Progress: ${progress}% (${allCandles.length} candles)`);
        
        // Rate limiting
        await this.sleep(100);
        
      } catch (error) {
        console.error(`\n❌ Error fetching data: ${error.message}`);
        await this.sleep(this.retryDelay);
      }
    }
    
    console.log(`\n✅ Fetched ${allCandles.length} candles`);
    
    // Format data
    const formattedData = {
      symbol,
      timeframe,
      startDate,
      endDate,
      fetchedAt: new Date().toISOString(),
      candles: allCandles.map(c => ({
        timestamp: c[0],
        date: new Date(c[0]).toISOString(),
        open: c[1],
        high: c[2],
        low: c[3],
        close: c[4],
        volume: c[5]
      }))
    };
    
    // Cache data
    fs.writeFileSync(cacheFile, JSON.stringify(formattedData, null, 2));
    console.log(`💾 Cached data to ${path.basename(cacheFile)}`);
    
    return formattedData;
  }

  /**
   * Fetch multiple timeframes for a symbol
   */
  async fetchMultipleTimeframes(symbol, timeframes, startDate, endDate) {
    const results = {};
    
    for (const tf of timeframes) {
      results[tf] = await this.fetchOHLCV(symbol, tf, startDate, endDate);
    }
    
    return results;
  }

  /**
   * Get available cached datasets
   */
  getAvailableDatasets() {
    ensureCacheDir();
    
    const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
    
    return files.map(f => {
      const parts = f.replace('.json', '').split('_');
      return {
        filename: f,
        symbol: parts[0].replace('-', '/'),
        timeframe: parts[1],
        startDate: parts[2],
        endDate: parts[3]
      };
    });
  }

  /**
   * Clear cache
   */
  clearCache() {
    ensureCacheDir();
    
    const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
    files.forEach(f => fs.unlinkSync(path.join(CACHE_DIR, f)));
    
    console.log(`🗑️  Cleared ${files.length} cached files`);
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Convert candle data to price series for backtesting
 */
export function candlesToPriceSeries(candles, priceType = 'close') {
  return candles.map(c => ({
    timestamp: c.timestamp,
    date: c.date,
    price: c[priceType],
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume
  }));
}

/**
 * Resample candles to different timeframe
 */
export function resampleCandles(candles, targetTimeframeMs) {
  const resampled = [];
  let currentBucket = null;
  
  for (const candle of candles) {
    const bucketStart = Math.floor(candle.timestamp / targetTimeframeMs) * targetTimeframeMs;
    
    if (!currentBucket || currentBucket.timestamp !== bucketStart) {
      if (currentBucket) {
        resampled.push(currentBucket);
      }
      currentBucket = {
        timestamp: bucketStart,
        date: new Date(bucketStart).toISOString(),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume
      };
    } else {
      currentBucket.high = Math.max(currentBucket.high, candle.high);
      currentBucket.low = Math.min(currentBucket.low, candle.low);
      currentBucket.close = candle.close;
      currentBucket.volume += candle.volume;
    }
  }
  
  if (currentBucket) {
    resampled.push(currentBucket);
  }
  
  return resampled;
}

export default HistoricalDataFetcher;
