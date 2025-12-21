#!/usr/bin/env node

/**
 * Multi-Timeframe Trend Filter Module
 * Version: 1.0.0
 * 
 * Analyzes multiple timeframes to determine market trend direction.
 * Used to filter grid orders:
 * - Bullish trend: Allow buy orders, be cautious with sells
 * - Bearish trend: Allow sell orders, be cautious with buys
 * - Neutral: Allow all orders (standard grid behavior)
 * 
 * Uses multiple indicators:
 * - EMA crossovers (fast/slow)
 * - Price position relative to EMA
 * - Higher timeframe trend confirmation
 */

/**
 * Trend states
 */
export const TREND = {
  STRONG_BULLISH: 2,
  BULLISH: 1,
  NEUTRAL: 0,
  BEARISH: -1,
  STRONG_BEARISH: -2
};

/**
 * Trend names for display
 */
export const TREND_NAMES = {
  [TREND.STRONG_BULLISH]: 'Strong Bullish 🟢🟢',
  [TREND.BULLISH]: 'Bullish 🟢',
  [TREND.NEUTRAL]: 'Neutral ⚪',
  [TREND.BEARISH]: 'Bearish 🔴',
  [TREND.STRONG_BEARISH]: 'Strong Bearish 🔴🔴'
};

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  // Timeframes to analyze (in order of importance)
  timeframes: ['4h', '1d'],
  
  // EMA periods
  fastEMA: 9,
  slowEMA: 21,
  trendEMA: 50,
  
  // Thresholds
  emaDistanceThreshold: 0.005,  // 0.5% distance for trend confirmation
  strongTrendThreshold: 0.015,  // 1.5% for strong trend
  
  // Caching
  cacheDuration: 5 * 60 * 1000,  // 5 minutes
  
  // Order filtering behavior
  filterMode: 'soft',  // 'soft' = warn only, 'hard' = block orders
  
  // Minimum data points required
  minDataPoints: 55  // Need at least 55 candles for 50 EMA
};

/**
 * Calculate Exponential Moving Average
 * @param {Array} prices - Array of closing prices
 * @param {number} period - EMA period
 * @returns {number} EMA value
 */
function calculateEMA(prices, period) {
  if (prices.length < period) return null;
  
  const multiplier = 2 / (period + 1);
  
  // Start with SMA for first EMA value
  let ema = prices.slice(0, period).reduce((sum, p) => sum + p, 0) / period;
  
  // Calculate EMA for remaining prices
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }
  
  return ema;
}

/**
 * Calculate Simple Moving Average
 * @param {Array} prices - Array of closing prices
 * @param {number} period - SMA period
 * @returns {number} SMA value
 */
function calculateSMA(prices, period) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((sum, p) => sum + p, 0) / period;
}

/**
 * Multi-Timeframe Trend Filter
 */
export class TrendFilter {
  constructor(options = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.cache = new Map(); // symbol -> { trend, timestamp, details }
  }

  /**
   * Analyze trend for a single timeframe
   * @param {Array} ohlcv - OHLCV data
   * @returns {Object} Trend analysis for this timeframe
   */
  analyzeTimeframe(ohlcv) {
    if (ohlcv.length < this.config.minDataPoints) {
      return { trend: TREND.NEUTRAL, confidence: 0, reason: 'Insufficient data' };
    }
    
    // Extract closing prices
    const closes = ohlcv.map(candle => candle[4]);
    const currentPrice = closes[closes.length - 1];
    
    // Calculate EMAs
    const fastEMA = calculateEMA(closes, this.config.fastEMA);
    const slowEMA = calculateEMA(closes, this.config.slowEMA);
    const trendEMA = calculateEMA(closes, this.config.trendEMA);
    
    if (!fastEMA || !slowEMA || !trendEMA) {
      return { trend: TREND.NEUTRAL, confidence: 0, reason: 'EMA calculation failed' };
    }
    
    // Calculate distances as percentages
    const fastSlowDistance = (fastEMA - slowEMA) / slowEMA;
    const priceToTrendDistance = (currentPrice - trendEMA) / trendEMA;
    
    // Determine trend
    let trend = TREND.NEUTRAL;
    let confidence = 0;
    let reasons = [];
    
    // Check EMA crossover
    if (fastEMA > slowEMA) {
      trend += 1;
      reasons.push('Fast EMA > Slow EMA');
      confidence += 0.3;
    } else if (fastEMA < slowEMA) {
      trend -= 1;
      reasons.push('Fast EMA < Slow EMA');
      confidence += 0.3;
    }
    
    // Check price position relative to trend EMA
    if (currentPrice > trendEMA * (1 + this.config.emaDistanceThreshold)) {
      trend += 1;
      reasons.push('Price above trend EMA');
      confidence += 0.4;
    } else if (currentPrice < trendEMA * (1 - this.config.emaDistanceThreshold)) {
      trend -= 1;
      reasons.push('Price below trend EMA');
      confidence += 0.4;
    }
    
    // Check for strong trend (significant EMA separation)
    if (Math.abs(fastSlowDistance) > this.config.strongTrendThreshold) {
      if (fastSlowDistance > 0) {
        trend = Math.min(trend + 1, TREND.STRONG_BULLISH);
        reasons.push('Strong EMA separation (bullish)');
      } else {
        trend = Math.max(trend - 1, TREND.STRONG_BEARISH);
        reasons.push('Strong EMA separation (bearish)');
      }
      confidence += 0.3;
    }
    
    // Clamp trend value
    trend = Math.max(TREND.STRONG_BEARISH, Math.min(TREND.STRONG_BULLISH, trend));
    confidence = Math.min(1, confidence);
    
    return {
      trend,
      confidence,
      reasons,
      indicators: {
        fastEMA: parseFloat(fastEMA.toFixed(2)),
        slowEMA: parseFloat(slowEMA.toFixed(2)),
        trendEMA: parseFloat(trendEMA.toFixed(2)),
        currentPrice: parseFloat(currentPrice.toFixed(2)),
        fastSlowDistance: parseFloat((fastSlowDistance * 100).toFixed(2)) + '%',
        priceToTrendDistance: parseFloat((priceToTrendDistance * 100).toFixed(2)) + '%'
      }
    };
  }

  /**
   * Analyze trend across multiple timeframes
   * @param {Object} exchange - CCXT exchange instance
   * @param {string} symbol - Trading pair symbol
   * @returns {Object} Combined trend analysis
   */
  async analyzeTrend(exchange, symbol) {
    // Check cache first
    const cached = this.cache.get(symbol);
    if (cached && Date.now() - cached.timestamp < this.config.cacheDuration) {
      return cached;
    }
    
    const timeframeResults = [];
    let weightedTrend = 0;
    let totalWeight = 0;
    
    // Analyze each timeframe (higher timeframes get more weight)
    for (let i = 0; i < this.config.timeframes.length; i++) {
      const tf = this.config.timeframes[i];
      const weight = i + 1; // Higher timeframes get more weight
      
      try {
        const ohlcv = await exchange.fetchOHLCV(
          symbol, 
          tf, 
          undefined, 
          this.config.minDataPoints + 5
        );
        
        const analysis = this.analyzeTimeframe(ohlcv);
        analysis.timeframe = tf;
        analysis.weight = weight;
        
        timeframeResults.push(analysis);
        
        weightedTrend += analysis.trend * weight * analysis.confidence;
        totalWeight += weight * analysis.confidence;
        
      } catch (error) {
        console.error(`❌ Trend analysis error for ${symbol} ${tf}:`, error.message);
        timeframeResults.push({
          timeframe: tf,
          trend: TREND.NEUTRAL,
          confidence: 0,
          error: error.message
        });
      }
    }
    
    // Calculate combined trend
    const combinedTrend = totalWeight > 0 
      ? Math.round(weightedTrend / totalWeight)
      : TREND.NEUTRAL;
    
    // Calculate overall confidence
    const avgConfidence = timeframeResults.length > 0
      ? timeframeResults.reduce((sum, r) => sum + r.confidence, 0) / timeframeResults.length
      : 0;
    
    // Check for trend alignment (all timeframes agree)
    const allBullish = timeframeResults.every(r => r.trend > 0);
    const allBearish = timeframeResults.every(r => r.trend < 0);
    const aligned = allBullish || allBearish;
    
    const result = {
      symbol,
      trend: combinedTrend,
      trendName: TREND_NAMES[combinedTrend],
      confidence: parseFloat(avgConfidence.toFixed(2)),
      aligned,
      timeframes: timeframeResults,
      timestamp: Date.now(),
      recommendation: this.getRecommendation(combinedTrend, avgConfidence)
    };
    
    // Cache result
    this.cache.set(symbol, result);
    
    return result;
  }

  /**
   * Get trading recommendation based on trend
   * @param {number} trend - Trend value
   * @param {number} confidence - Confidence level
   * @returns {Object} Recommendation
   */
  getRecommendation(trend, confidence) {
    const rec = {
      allowBuys: true,
      allowSells: true,
      buyBias: 0,    // -1 to 1, negative = reduce buys
      sellBias: 0,   // -1 to 1, negative = reduce sells
      message: ''
    };
    
    if (confidence < 0.3) {
      rec.message = 'Low confidence - proceed with standard grid';
      return rec;
    }
    
    switch (trend) {
      case TREND.STRONG_BULLISH:
        rec.buyBias = 0.3;      // Slightly favor buys
        rec.sellBias = -0.2;    // Reduce sells slightly
        rec.message = 'Strong uptrend - favor buy orders';
        break;
        
      case TREND.BULLISH:
        rec.buyBias = 0.1;
        rec.message = 'Uptrend detected - normal grid with buy preference';
        break;
        
      case TREND.BEARISH:
        rec.sellBias = 0.1;
        rec.message = 'Downtrend detected - normal grid with sell preference';
        break;
        
      case TREND.STRONG_BEARISH:
        rec.buyBias = -0.2;     // Reduce buys
        rec.sellBias = 0.3;     // Slightly favor sells
        rec.message = 'Strong downtrend - favor sell orders';
        if (this.config.filterMode === 'hard') {
          rec.allowBuys = false;
          rec.message = 'Strong downtrend - blocking new buy orders';
        }
        break;
        
      default:
        rec.message = 'Neutral trend - standard grid behavior';
    }
    
    return rec;
  }

  /**
   * Check if a specific order should be placed based on trend
   * @param {string} symbol - Trading pair symbol
   * @param {string} side - 'buy' or 'sell'
   * @returns {Object} { allowed: boolean, reason: string }
   */
  async shouldPlaceOrder(exchange, symbol, side) {
    const analysis = await this.analyzeTrend(exchange, symbol);
    const rec = analysis.recommendation;
    
    if (side === 'buy' && !rec.allowBuys) {
      return { 
        allowed: false, 
        reason: `Buy blocked: ${rec.message}`,
        trend: analysis.trendName
      };
    }
    
    if (side === 'sell' && !rec.allowSells) {
      return { 
        allowed: false, 
        reason: `Sell blocked: ${rec.message}`,
        trend: analysis.trendName
      };
    }
    
    return { 
      allowed: true, 
      reason: rec.message,
      trend: analysis.trendName,
      bias: side === 'buy' ? rec.buyBias : rec.sellBias
    };
  }

  /**
   * Adjust order quantity based on trend bias
   * @param {number} baseQuantity - Original order quantity
   * @param {string} side - 'buy' or 'sell'
   * @param {Object} analysis - Trend analysis result
   * @returns {number} Adjusted quantity
   */
  adjustQuantity(baseQuantity, side, analysis) {
    const bias = side === 'buy' 
      ? analysis.recommendation.buyBias 
      : analysis.recommendation.sellBias;
    
    // Adjust quantity by bias (max ±30%)
    const adjustment = 1 + (bias * 0.3);
    return baseQuantity * adjustment;
  }

  /**
   * Get cached trend for a symbol (if available)
   * @param {string} symbol - Trading pair symbol
   * @returns {Object|null} Cached trend or null
   */
  getCachedTrend(symbol) {
    const cached = this.cache.get(symbol);
    if (cached && Date.now() - cached.timestamp < this.config.cacheDuration) {
      return cached;
    }
    return null;
  }

  /**
   * Clear cache for a symbol or all symbols
   * @param {string} symbol - Optional symbol to clear
   */
  clearCache(symbol = null) {
    if (symbol) {
      this.cache.delete(symbol);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Get summary of all cached trends
   * @returns {Object} Summary object
   */
  getSummary() {
    const summary = {};
    for (const [symbol, data] of this.cache.entries()) {
      summary[symbol] = {
        trend: data.trendName,
        confidence: (data.confidence * 100).toFixed(0) + '%',
        aligned: data.aligned ? 'Yes' : 'No',
        recommendation: data.recommendation.message,
        age: Math.round((Date.now() - data.timestamp) / 1000) + 's ago'
      };
    }
    return summary;
  }
}

/**
 * Quick trend check - standalone function
 * @param {Object} exchange - CCXT exchange instance
 * @param {string} symbol - Trading pair symbol
 * @returns {Object} Simple trend result
 */
export async function quickTrendCheck(exchange, symbol) {
  const filter = new TrendFilter({ timeframes: ['4h'] });
  const analysis = await filter.analyzeTrend(exchange, symbol);
  
  return {
    trend: analysis.trend,
    trendName: analysis.trendName,
    recommendation: analysis.recommendation.message
  };
}

// Export for use in enhanced monitor
export default TrendFilter;
