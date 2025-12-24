#!/usr/bin/env node

/**
 * RSI/MACD Momentum Filter Module
 * Version: 1.0.0
 * 
 * Provides additional confirmation before placing buy orders:
 * - RSI (Relative Strength Index) for overbought/oversold conditions
 * - MACD (Moving Average Convergence Divergence) for momentum direction
 * - Stochastic RSI for additional confirmation
 * 
 * Only allows buys when momentum indicators suggest reversal likely.
 */

/**
 * Momentum signal states
 */
export const MOMENTUM = {
  STRONG_BUY: 2,
  BUY: 1,
  NEUTRAL: 0,
  SELL: -1,
  STRONG_SELL: -2
};

export const MOMENTUM_NAMES = {
  [MOMENTUM.STRONG_BUY]: 'Strong Buy 🟢🟢',
  [MOMENTUM.BUY]: 'Buy 🟢',
  [MOMENTUM.NEUTRAL]: 'Neutral ⚪',
  [MOMENTUM.SELL]: 'Sell 🔴',
  [MOMENTUM.STRONG_SELL]: 'Strong Sell 🔴🔴'
};

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  // RSI settings
  rsiPeriod: 14,
  rsiOversold: 30,
  rsiOverbought: 70,
  rsiExtremeSold: 20,
  rsiExtremeBought: 80,
  
  // MACD settings
  macdFastPeriod: 12,
  macdSlowPeriod: 26,
  macdSignalPeriod: 9,
  
  // Stochastic RSI settings
  stochRsiPeriod: 14,
  stochRsiOversold: 20,
  stochRsiOverbought: 80,
  
  // Caching
  cacheDuration: 2 * 60 * 1000,  // 2 minutes
  
  // Minimum data points
  minDataPoints: 50,
  
  // Filter strictness: 'strict' = require all indicators, 'moderate' = majority, 'loose' = any
  strictness: 'moderate'
};

/**
 * Calculate RSI (Relative Strength Index)
 */
function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;
  
  let gains = 0;
  let losses = 0;
  
  // Calculate initial average gain/loss
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  
  let avgGain = gains / period;
  let avgLoss = losses / period;
  
  // Calculate smoothed RSI for remaining prices
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  
  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * Calculate EMA (Exponential Moving Average)
 */
function calculateEMA(prices, period) {
  if (prices.length < period) return null;
  
  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((sum, p) => sum + p, 0) / period;
  
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }
  
  return ema;
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 */
function calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (prices.length < slowPeriod + signalPeriod) return null;
  
  // Calculate MACD line values for each point
  const macdValues = [];
  
  for (let i = slowPeriod; i <= prices.length; i++) {
    const slice = prices.slice(0, i);
    const fastEMA = calculateEMA(slice, fastPeriod);
    const slowEMA = calculateEMA(slice, slowPeriod);
    
    if (fastEMA && slowEMA) {
      macdValues.push(fastEMA - slowEMA);
    }
  }
  
  if (macdValues.length < signalPeriod) return null;
  
  // Calculate signal line (EMA of MACD)
  const signalLine = calculateEMA(macdValues, signalPeriod);
  const macdLine = macdValues[macdValues.length - 1];
  const histogram = macdLine - signalLine;
  
  // Get previous values for crossover detection
  const prevMacdLine = macdValues.length > 1 ? macdValues[macdValues.length - 2] : macdLine;
  const prevSignalLine = macdValues.length > signalPeriod 
    ? calculateEMA(macdValues.slice(0, -1), signalPeriod)
    : signalLine;
  
  return {
    macdLine,
    signalLine,
    histogram,
    prevMacdLine,
    prevSignalLine,
    bullishCrossover: prevMacdLine < prevSignalLine && macdLine > signalLine,
    bearishCrossover: prevMacdLine > prevSignalLine && macdLine < signalLine
  };
}

/**
 * Calculate Stochastic RSI
 */
function calculateStochRSI(prices, period = 14) {
  if (prices.length < period * 2) return null;
  
  // Calculate RSI values
  const rsiValues = [];
  for (let i = period + 1; i <= prices.length; i++) {
    const rsi = calculateRSI(prices.slice(0, i), period);
    if (rsi !== null) rsiValues.push(rsi);
  }
  
  if (rsiValues.length < period) return null;
  
  // Calculate Stochastic of RSI
  const recentRSI = rsiValues.slice(-period);
  const currentRSI = recentRSI[recentRSI.length - 1];
  const lowestRSI = Math.min(...recentRSI);
  const highestRSI = Math.max(...recentRSI);
  
  if (highestRSI === lowestRSI) return 50;
  
  return ((currentRSI - lowestRSI) / (highestRSI - lowestRSI)) * 100;
}

/**
 * Momentum Filter Class
 */
export class MomentumFilter {
  constructor(options = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.cache = new Map();
  }

  /**
   * Analyze momentum for a symbol
   */
  async analyzeMomentum(exchange, symbol, timeframe = '1h') {
    // Check cache
    const cacheKey = `${symbol}-${timeframe}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.config.cacheDuration) {
      return cached;
    }
    
    try {
      // Fetch OHLCV data
      const ohlcv = await exchange.fetchOHLCV(
        symbol,
        timeframe,
        undefined,
        this.config.minDataPoints + 10
      );
      
      if (ohlcv.length < this.config.minDataPoints) {
        return this.formatResult(MOMENTUM.NEUTRAL, 0, 'Insufficient data', {});
      }
      
      const closes = ohlcv.map(c => c[4]);
      const currentPrice = closes[closes.length - 1];
      
      // Calculate indicators
      const rsi = calculateRSI(closes, this.config.rsiPeriod);
      const macd = calculateMACD(
        closes,
        this.config.macdFastPeriod,
        this.config.macdSlowPeriod,
        this.config.macdSignalPeriod
      );
      const stochRsi = calculateStochRSI(closes, this.config.stochRsiPeriod);
      
      // Analyze each indicator
      const signals = [];
      let totalScore = 0;
      
      // RSI Analysis
      if (rsi !== null) {
        if (rsi <= this.config.rsiExtremeSold) {
          signals.push({ indicator: 'RSI', signal: MOMENTUM.STRONG_BUY, value: rsi, reason: 'Extremely oversold' });
          totalScore += 2;
        } else if (rsi <= this.config.rsiOversold) {
          signals.push({ indicator: 'RSI', signal: MOMENTUM.BUY, value: rsi, reason: 'Oversold' });
          totalScore += 1;
        } else if (rsi >= this.config.rsiExtremeBought) {
          signals.push({ indicator: 'RSI', signal: MOMENTUM.STRONG_SELL, value: rsi, reason: 'Extremely overbought' });
          totalScore -= 2;
        } else if (rsi >= this.config.rsiOverbought) {
          signals.push({ indicator: 'RSI', signal: MOMENTUM.SELL, value: rsi, reason: 'Overbought' });
          totalScore -= 1;
        } else {
          signals.push({ indicator: 'RSI', signal: MOMENTUM.NEUTRAL, value: rsi, reason: 'Neutral zone' });
        }
      }
      
      // MACD Analysis
      if (macd !== null) {
        if (macd.bullishCrossover) {
          signals.push({ indicator: 'MACD', signal: MOMENTUM.STRONG_BUY, value: macd.histogram, reason: 'Bullish crossover' });
          totalScore += 2;
        } else if (macd.bearishCrossover) {
          signals.push({ indicator: 'MACD', signal: MOMENTUM.STRONG_SELL, value: macd.histogram, reason: 'Bearish crossover' });
          totalScore -= 2;
        } else if (macd.histogram > 0 && macd.macdLine > macd.signalLine) {
          signals.push({ indicator: 'MACD', signal: MOMENTUM.BUY, value: macd.histogram, reason: 'Bullish momentum' });
          totalScore += 1;
        } else if (macd.histogram < 0 && macd.macdLine < macd.signalLine) {
          signals.push({ indicator: 'MACD', signal: MOMENTUM.SELL, value: macd.histogram, reason: 'Bearish momentum' });
          totalScore -= 1;
        } else {
          signals.push({ indicator: 'MACD', signal: MOMENTUM.NEUTRAL, value: macd.histogram, reason: 'Mixed signals' });
        }
      }
      
      // Stochastic RSI Analysis
      if (stochRsi !== null) {
        if (stochRsi <= this.config.stochRsiOversold) {
          signals.push({ indicator: 'StochRSI', signal: MOMENTUM.BUY, value: stochRsi, reason: 'Oversold' });
          totalScore += 1;
        } else if (stochRsi >= this.config.stochRsiOverbought) {
          signals.push({ indicator: 'StochRSI', signal: MOMENTUM.SELL, value: stochRsi, reason: 'Overbought' });
          totalScore -= 1;
        } else {
          signals.push({ indicator: 'StochRSI', signal: MOMENTUM.NEUTRAL, value: stochRsi, reason: 'Neutral zone' });
        }
      }
      
      // Calculate combined signal
      const avgScore = signals.length > 0 ? totalScore / signals.length : 0;
      let combinedSignal = MOMENTUM.NEUTRAL;
      
      if (avgScore >= 1.5) combinedSignal = MOMENTUM.STRONG_BUY;
      else if (avgScore >= 0.5) combinedSignal = MOMENTUM.BUY;
      else if (avgScore <= -1.5) combinedSignal = MOMENTUM.STRONG_SELL;
      else if (avgScore <= -0.5) combinedSignal = MOMENTUM.SELL;
      
      // Calculate confidence
      const buySignals = signals.filter(s => s.signal > 0).length;
      const sellSignals = signals.filter(s => s.signal < 0).length;
      const alignment = Math.abs(buySignals - sellSignals) / signals.length;
      const confidence = alignment * (signals.length / 3);  // Max 3 indicators
      
      const result = this.formatResult(combinedSignal, confidence, null, {
        rsi: rsi ? parseFloat(rsi.toFixed(2)) : null,
        macd: macd ? {
          line: parseFloat(macd.macdLine.toFixed(4)),
          signal: parseFloat(macd.signalLine.toFixed(4)),
          histogram: parseFloat(macd.histogram.toFixed(4)),
          bullishCrossover: macd.bullishCrossover,
          bearishCrossover: macd.bearishCrossover
        } : null,
        stochRsi: stochRsi ? parseFloat(stochRsi.toFixed(2)) : null,
        signals,
        totalScore,
        currentPrice
      });
      
      // Cache result
      this.cache.set(cacheKey, result);
      
      return result;
      
    } catch (error) {
      console.error(`❌ Momentum analysis error for ${symbol}:`, error.message);
      return this.formatResult(MOMENTUM.NEUTRAL, 0, error.message, {});
    }
  }

  /**
   * Format result object
   */
  formatResult(signal, confidence, error, indicators) {
    return {
      signal,
      signalName: MOMENTUM_NAMES[signal],
      confidence: parseFloat(confidence.toFixed(2)),
      error,
      indicators,
      timestamp: Date.now(),
      recommendation: this.getRecommendation(signal, confidence)
    };
  }

  /**
   * Get trading recommendation
   */
  getRecommendation(signal, confidence) {
    const rec = {
      allowBuy: true,
      allowSell: true,
      sizeMultiplier: 1.0,
      message: ''
    };
    
    if (confidence < 0.3) {
      rec.message = 'Low confidence - use standard sizing';
      return rec;
    }
    
    switch (signal) {
      case MOMENTUM.STRONG_BUY:
        rec.sizeMultiplier = 1.3;  // Increase size on strong buy
        rec.message = 'Strong buy signal - consider larger position';
        break;
        
      case MOMENTUM.BUY:
        rec.sizeMultiplier = 1.1;
        rec.message = 'Buy signal - favorable entry';
        break;
        
      case MOMENTUM.SELL:
        rec.allowBuy = this.config.strictness === 'loose';
        rec.sizeMultiplier = 0.7;
        rec.message = 'Sell signal - reduce buy size or wait';
        break;
        
      case MOMENTUM.STRONG_SELL:
        rec.allowBuy = false;
        rec.sizeMultiplier = 0.5;
        rec.message = 'Strong sell signal - avoid new buys';
        break;
        
      default:
        rec.message = 'Neutral momentum - standard behavior';
    }
    
    return rec;
  }

  /**
   * Check if a buy should be allowed
   */
  async shouldAllowBuy(exchange, symbol) {
    const analysis = await this.analyzeMomentum(exchange, symbol);
    
    // In strict mode, require positive signal
    if (this.config.strictness === 'strict') {
      return {
        allowed: analysis.signal >= MOMENTUM.BUY,
        reason: analysis.recommendation.message,
        signal: analysis.signalName,
        sizeMultiplier: analysis.recommendation.sizeMultiplier
      };
    }
    
    // In moderate mode, block only on strong sell
    if (this.config.strictness === 'moderate') {
      return {
        allowed: analysis.signal > MOMENTUM.STRONG_SELL,
        reason: analysis.recommendation.message,
        signal: analysis.signalName,
        sizeMultiplier: analysis.recommendation.sizeMultiplier
      };
    }
    
    // In loose mode, always allow but adjust size
    return {
      allowed: true,
      reason: analysis.recommendation.message,
      signal: analysis.signalName,
      sizeMultiplier: analysis.recommendation.sizeMultiplier
    };
  }

  /**
   * Get summary of current state
   */
  getSummary() {
    const summary = {};
    for (const [key, data] of this.cache.entries()) {
      summary[key] = {
        signal: data.signalName,
        confidence: data.confidence,
        rsi: data.indicators.rsi,
        macdHistogram: data.indicators.macd?.histogram,
        stochRsi: data.indicators.stochRsi,
        age: Math.round((Date.now() - data.timestamp) / 1000) + 's ago'
      };
    }
    return summary;
  }
}

export default MomentumFilter;
