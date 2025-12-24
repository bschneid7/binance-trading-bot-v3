#!/usr/bin/env node

/**
 * Historical Data Fetcher
 * Version: 1.1.0
 * 
 * Fetches and caches historical OHLCV data from CryptoCompare
 * for backtesting purposes.
 * 
 * Note: Uses CryptoCompare instead of Binance.US because Binance.US
 * has limited historical data availability.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_DIR = path.join(__dirname, 'data');
const CRYPTOCOMPARE_API = 'https://min-api.cryptocompare.com/data/v2';

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
 * Convert timeframe to CryptoCompare endpoint
 */
function getTimeframeEndpoint(timeframe) {
  const map = {
    '1m': { endpoint: 'histominute', seconds: 60 },
    '5m': { endpoint: 'histominute', seconds: 300 },
    '15m': { endpoint: 'histominute', seconds: 900 },
    '30m': { endpoint: 'histominute', seconds: 1800 },
    '1h': { endpoint: 'histohour', seconds: 3600 },
    '2h': { endpoint: 'histohour', seconds: 7200 },
    '4h': { endpoint: 'histohour', seconds: 14400 },
    '1d': { endpoint: 'histoday', seconds: 86400 },
    '1w': { endpoint: 'histoday', seconds: 604800 }
  };
  return map[timeframe] || { endpoint: 'histohour', seconds: 3600 };
}

/**
 * Historical Data Fetcher Class
 */
export class HistoricalDataFetcher {
  constructor(options = {}) {
    this.apiKey = options.apiKey || null;
    this.maxRetries = 3;
    this.retryDelay = 1000;
  }

  /**
   * Parse symbol into base and quote currencies
   */
  parseSymbol(symbol) {
    // Handle formats: BTC/USD, BTCUSD, BTC-USD
    const cleaned = symbol.replace('-', '/');
    if (cleaned.includes('/')) {
      const [base, quote] = cleaned.split('/');
      return { base: base.toUpperCase(), quote: quote.toUpperCase() };
    }
    // Assume last 3-4 chars are quote currency
    if (cleaned.endsWith('USDT')) {
      return { base: cleaned.slice(0, -4), quote: 'USDT' };
    }
    if (cleaned.endsWith('USD')) {
      return { base: cleaned.slice(0, -3), quote: 'USD' };
    }
    return { base: cleaned, quote: 'USD' };
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
    
    const { base, quote } = this.parseSymbol(symbol);
    const tfConfig = getTimeframeEndpoint(timeframe);
    
    console.log(`📡 Fetching ${base}/${quote} ${timeframe} data from ${startDate} to ${endDate}...`);
    console.log(`   Using CryptoCompare API (${tfConfig.endpoint})`);
    
    const startTimestamp = Math.floor(new Date(startDate).getTime() / 1000);
    const endTimestamp = Math.floor(new Date(endDate).getTime() / 1000);
    
    let allCandles = [];
    let toTs = endTimestamp;
    let fetchCount = 0;
    const maxCandles = 2000;  // CryptoCompare limit per request
    
    while (toTs > startTimestamp) {
      try {
        const url = `${CRYPTOCOMPARE_API}/${tfConfig.endpoint}?fsym=${base}&tsym=${quote}&limit=${maxCandles}&toTs=${toTs}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.Response === 'Error') {
          console.error(`\n❌ API Error: ${data.Message}`);
          break;
        }
        
        if (!data.Data || !data.Data.Data || data.Data.Data.length === 0) {
          break;
        }
        
        const candles = data.Data.Data;
        
        // Filter candles within date range
        const filteredCandles = candles.filter(c => 
          c.time >= startTimestamp && c.time <= endTimestamp
        );
        
        // Convert to standard format and prepend (since we're going backwards)
        const formattedCandles = filteredCandles.map(c => ({
          timestamp: c.time * 1000,
          date: new Date(c.time * 1000).toISOString(),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volumefrom
        }));
        
        allCandles = [...formattedCandles, ...allCandles];
        
        // Move to earlier time period
        toTs = candles[0].time - 1;
        fetchCount++;
        
        // Progress indicator
        const progress = Math.min(100, ((endTimestamp - toTs) / (endTimestamp - startTimestamp) * 100)).toFixed(1);
        process.stdout.write(`\r   Progress: ${progress}% (${allCandles.length} candles)`);
        
        // Rate limiting
        await this.sleep(250);
        
        // Safety check - if we got less than expected, we've reached the end
        if (candles.length < maxCandles) {
          break;
        }
        
      } catch (error) {
        console.error(`\n❌ Error fetching data: ${error.message}`);
        await this.sleep(this.retryDelay);
      }
    }
    
    // Sort by timestamp ascending
    allCandles.sort((a, b) => a.timestamp - b.timestamp);
    
    // Remove duplicates
    const seen = new Set();
    allCandles = allCandles.filter(c => {
      if (seen.has(c.timestamp)) return false;
      seen.add(c.timestamp);
      return true;
    });
    
    console.log(`\n✅ Fetched ${allCandles.length} candles`);
    
    // Format data
    const formattedData = {
      symbol: `${base}/${quote}`,
      timeframe,
      startDate,
      endDate,
      fetchedAt: new Date().toISOString(),
      source: 'CryptoCompare',
      candles: allCandles
    };
    
    // Cache data
    if (allCandles.length > 0) {
      fs.writeFileSync(cacheFile, JSON.stringify(formattedData, null, 2));
      console.log(`💾 Cached data to ${path.basename(cacheFile)}`);
    }
    
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
