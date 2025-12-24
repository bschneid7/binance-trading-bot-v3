#!/usr/bin/env node

/**
 * ML Price Prediction Module
 * Version: 1.0.0
 * 
 * Uses statistical and machine learning techniques to predict short-term price direction:
 * - Linear regression for trend prediction
 * - Mean reversion detection
 * - Pattern recognition (support/resistance bounces)
 * - Volatility-adjusted predictions
 * 
 * Adjusts grid bias (more buys vs sells) based on prediction.
 */

/**
 * Prediction confidence levels
 */
export const PREDICTION = {
  STRONG_UP: 2,
  UP: 1,
  NEUTRAL: 0,
  DOWN: -1,
  STRONG_DOWN: -2
};

export const PREDICTION_NAMES = {
  [PREDICTION.STRONG_UP]: 'Strong Up 📈📈',
  [PREDICTION.UP]: 'Up 📈',
  [PREDICTION.NEUTRAL]: 'Neutral ↔️',
  [PREDICTION.DOWN]: 'Down 📉',
  [PREDICTION.STRONG_DOWN]: 'Strong Down 📉📉'
};

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  // Prediction timeframes
  shortTermPeriod: 12,   // 12 candles for short-term
  mediumTermPeriod: 24,  // 24 candles for medium-term
  longTermPeriod: 48,    // 48 candles for long-term
  
  // Regression settings
  minR2ForSignal: 0.3,   // Minimum R² for trend signal
  strongR2Threshold: 0.6, // R² for strong signal
  
  // Mean reversion settings
  meanReversionThreshold: 2.0,  // Standard deviations from mean
  meanReversionPeriod: 20,
  
  // Pattern recognition
  supportResistanceLookback: 50,
  bounceConfirmationCandles: 3,
  
  // Cache duration
  cacheDuration: 5 * 60 * 1000,  // 5 minutes
  
  // Minimum data points
  minDataPoints: 60
};

/**
 * Calculate linear regression
 */
function linearRegression(data) {
  const n = data.length;
  if (n < 2) return null;
  
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += data[i];
    sumXY += i * data[i];
    sumX2 += i * i;
    sumY2 += data[i] * data[i];
  }
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  
  // Calculate R²
  const meanY = sumY / n;
  let ssTotal = 0, ssResidual = 0;
  
  for (let i = 0; i < n; i++) {
    const predicted = slope * i + intercept;
    ssTotal += Math.pow(data[i] - meanY, 2);
    ssResidual += Math.pow(data[i] - predicted, 2);
  }
  
  const r2 = ssTotal > 0 ? 1 - (ssResidual / ssTotal) : 0;
  
  // Predict next value
  const nextPrediction = slope * n + intercept;
  const currentValue = data[n - 1];
  const predictedChange = (nextPrediction - currentValue) / currentValue;
  
  return {
    slope,
    intercept,
    r2,
    nextPrediction,
    predictedChange,
    trendDirection: slope > 0 ? 'up' : slope < 0 ? 'down' : 'flat'
  };
}

/**
 * Calculate standard deviation
 */
function standardDeviation(data) {
  const n = data.length;
  if (n < 2) return 0;
  
  const mean = data.reduce((sum, val) => sum + val, 0) / n;
  const squaredDiffs = data.map(val => Math.pow(val - mean, 2));
  const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / n;
  
  return {
    mean,
    std: Math.sqrt(variance),
    variance
  };
}

/**
 * Detect mean reversion opportunity
 */
function detectMeanReversion(prices, period, threshold) {
  if (prices.length < period) return null;
  
  const recentPrices = prices.slice(-period);
  const stats = standardDeviation(recentPrices);
  const currentPrice = prices[prices.length - 1];
  
  const zScore = (currentPrice - stats.mean) / stats.std;
  
  return {
    zScore,
    mean: stats.mean,
    std: stats.std,
    currentPrice,
    isOversold: zScore < -threshold,
    isOverbought: zScore > threshold,
    expectedReversion: zScore < -threshold ? 'up' : zScore > threshold ? 'down' : 'none',
    reversionTarget: stats.mean
  };
}

/**
 * Find support and resistance levels
 */
function findSupportResistance(highs, lows, closes, lookback) {
  const levels = [];
  
  // Find local minima (support) and maxima (resistance)
  for (let i = 2; i < lookback - 2 && i < closes.length - 2; i++) {
    const idx = closes.length - lookback + i;
    
    // Local minimum (support)
    if (lows[idx] < lows[idx - 1] && lows[idx] < lows[idx - 2] &&
        lows[idx] < lows[idx + 1] && lows[idx] < lows[idx + 2]) {
      levels.push({ price: lows[idx], type: 'support', index: idx });
    }
    
    // Local maximum (resistance)
    if (highs[idx] > highs[idx - 1] && highs[idx] > highs[idx - 2] &&
        highs[idx] > highs[idx + 1] && highs[idx] > highs[idx + 2]) {
      levels.push({ price: highs[idx], type: 'resistance', index: idx });
    }
  }
  
  // Cluster similar levels
  const clustered = [];
  const clusterThreshold = 0.005;  // 0.5%
  
  for (const level of levels) {
    const existing = clustered.find(
      c => Math.abs(c.price - level.price) / level.price < clusterThreshold
    );
    
    if (existing) {
      existing.touches++;
      existing.price = (existing.price + level.price) / 2;
    } else {
      clustered.push({ ...level, touches: 1 });
    }
  }
  
  return clustered.sort((a, b) => b.touches - a.touches);
}

/**
 * Detect bounce patterns
 */
function detectBounce(prices, levels, confirmationCandles) {
  const currentPrice = prices[prices.length - 1];
  const recentPrices = prices.slice(-confirmationCandles);
  
  for (const level of levels) {
    const distance = Math.abs(currentPrice - level.price) / level.price;
    
    if (distance < 0.01) {  // Within 1% of level
      // Check if bouncing off support
      if (level.type === 'support') {
        const allAbove = recentPrices.every(p => p >= level.price * 0.995);
        const wasNear = recentPrices.some(p => Math.abs(p - level.price) / level.price < 0.005);
        
        if (allAbove && wasNear) {
          return {
            detected: true,
            type: 'support_bounce',
            level: level.price,
            direction: 'up',
            strength: level.touches
          };
        }
      }
      
      // Check if bouncing off resistance
      if (level.type === 'resistance') {
        const allBelow = recentPrices.every(p => p <= level.price * 1.005);
        const wasNear = recentPrices.some(p => Math.abs(p - level.price) / level.price < 0.005);
        
        if (allBelow && wasNear) {
          return {
            detected: true,
            type: 'resistance_bounce',
            level: level.price,
            direction: 'down',
            strength: level.touches
          };
        }
      }
    }
  }
  
  return { detected: false };
}

/**
 * Price Predictor Class
 */
export class PricePredictor {
  constructor(options = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.cache = new Map();
    this.predictionHistory = [];
  }

  /**
   * Generate price prediction
   */
  async predict(exchange, symbol, timeframe = '1h') {
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
        return this.formatResult(PREDICTION.NEUTRAL, 0, 'Insufficient data', {});
      }
      
      const opens = ohlcv.map(c => c[1]);
      const highs = ohlcv.map(c => c[2]);
      const lows = ohlcv.map(c => c[3]);
      const closes = ohlcv.map(c => c[4]);
      const currentPrice = closes[closes.length - 1];
      
      // Run analyses
      const shortTermReg = linearRegression(closes.slice(-this.config.shortTermPeriod));
      const mediumTermReg = linearRegression(closes.slice(-this.config.mediumTermPeriod));
      const longTermReg = linearRegression(closes.slice(-this.config.longTermPeriod));
      
      const meanReversion = detectMeanReversion(
        closes,
        this.config.meanReversionPeriod,
        this.config.meanReversionThreshold
      );
      
      const levels = findSupportResistance(
        highs, lows, closes,
        this.config.supportResistanceLookback
      );
      
      const bounce = detectBounce(
        closes,
        levels,
        this.config.bounceConfirmationCandles
      );
      
      // Combine signals
      let totalScore = 0;
      let signalCount = 0;
      const signals = [];
      
      // Short-term regression signal
      if (shortTermReg && shortTermReg.r2 >= this.config.minR2ForSignal) {
        const weight = shortTermReg.r2 >= this.config.strongR2Threshold ? 2 : 1;
        const direction = shortTermReg.slope > 0 ? 1 : -1;
        totalScore += direction * weight;
        signalCount += weight;
        signals.push({
          type: 'short_term_trend',
          direction: shortTermReg.trendDirection,
          strength: shortTermReg.r2,
          predictedChange: (shortTermReg.predictedChange * 100).toFixed(2) + '%'
        });
      }
      
      // Medium-term regression signal
      if (mediumTermReg && mediumTermReg.r2 >= this.config.minR2ForSignal) {
        const weight = mediumTermReg.r2 >= this.config.strongR2Threshold ? 2 : 1;
        const direction = mediumTermReg.slope > 0 ? 1 : -1;
        totalScore += direction * weight * 1.5;  // Medium-term gets more weight
        signalCount += weight * 1.5;
        signals.push({
          type: 'medium_term_trend',
          direction: mediumTermReg.trendDirection,
          strength: mediumTermReg.r2,
          predictedChange: (mediumTermReg.predictedChange * 100).toFixed(2) + '%'
        });
      }
      
      // Mean reversion signal
      if (meanReversion) {
        if (meanReversion.isOversold) {
          totalScore += 1.5;
          signalCount += 1;
          signals.push({
            type: 'mean_reversion',
            direction: 'up',
            zScore: meanReversion.zScore.toFixed(2),
            target: meanReversion.reversionTarget.toFixed(2)
          });
        } else if (meanReversion.isOverbought) {
          totalScore -= 1.5;
          signalCount += 1;
          signals.push({
            type: 'mean_reversion',
            direction: 'down',
            zScore: meanReversion.zScore.toFixed(2),
            target: meanReversion.reversionTarget.toFixed(2)
          });
        }
      }
      
      // Bounce signal
      if (bounce.detected) {
        const bounceScore = bounce.direction === 'up' ? 1 : -1;
        totalScore += bounceScore * (1 + bounce.strength * 0.2);
        signalCount += 1;
        signals.push({
          type: 'bounce',
          direction: bounce.direction,
          level: bounce.level.toFixed(2),
          strength: bounce.strength
        });
      }
      
      // Calculate final prediction
      const avgScore = signalCount > 0 ? totalScore / signalCount : 0;
      let prediction = PREDICTION.NEUTRAL;
      
      if (avgScore >= 1.5) prediction = PREDICTION.STRONG_UP;
      else if (avgScore >= 0.5) prediction = PREDICTION.UP;
      else if (avgScore <= -1.5) prediction = PREDICTION.STRONG_DOWN;
      else if (avgScore <= -0.5) prediction = PREDICTION.DOWN;
      
      // Calculate confidence
      const confidence = Math.min(1, Math.abs(avgScore) / 2);
      
      // Calculate price targets
      const upTarget = currentPrice * 1.02;  // 2% up
      const downTarget = currentPrice * 0.98;  // 2% down
      
      const result = this.formatResult(prediction, confidence, null, {
        currentPrice,
        signals,
        shortTermTrend: shortTermReg ? {
          direction: shortTermReg.trendDirection,
          r2: shortTermReg.r2.toFixed(3),
          predictedChange: (shortTermReg.predictedChange * 100).toFixed(2) + '%'
        } : null,
        mediumTermTrend: mediumTermReg ? {
          direction: mediumTermReg.trendDirection,
          r2: mediumTermReg.r2.toFixed(3),
          predictedChange: (mediumTermReg.predictedChange * 100).toFixed(2) + '%'
        } : null,
        meanReversion: meanReversion ? {
          zScore: meanReversion.zScore.toFixed(2),
          status: meanReversion.isOversold ? 'oversold' : 
                  meanReversion.isOverbought ? 'overbought' : 'normal'
        } : null,
        supportLevels: levels.filter(l => l.type === 'support').slice(0, 3),
        resistanceLevels: levels.filter(l => l.type === 'resistance').slice(0, 3),
        priceTargets: {
          bullish: upTarget.toFixed(2),
          bearish: downTarget.toFixed(2)
        },
        totalScore: avgScore.toFixed(2)
      });
      
      // Cache and track
      this.cache.set(cacheKey, result);
      this.trackPrediction(symbol, prediction, currentPrice);
      
      return result;
      
    } catch (error) {
      console.error(`❌ Price prediction error for ${symbol}:`, error.message);
      return this.formatResult(PREDICTION.NEUTRAL, 0, error.message, {});
    }
  }

  /**
   * Track prediction for accuracy measurement
   */
  trackPrediction(symbol, prediction, price) {
    this.predictionHistory.push({
      symbol,
      prediction,
      price,
      timestamp: Date.now()
    });
    
    // Keep limited history
    if (this.predictionHistory.length > 1000) {
      this.predictionHistory = this.predictionHistory.slice(-1000);
    }
  }

  /**
   * Format result object
   */
  formatResult(prediction, confidence, error, data) {
    return {
      prediction,
      predictionName: PREDICTION_NAMES[prediction],
      confidence: parseFloat(confidence.toFixed(2)),
      error,
      data,
      timestamp: Date.now(),
      recommendation: this.getRecommendation(prediction, confidence)
    };
  }

  /**
   * Get trading recommendation
   */
  getRecommendation(prediction, confidence) {
    const rec = {
      gridBias: 0,  // -1 to 1, positive = favor buys
      sizeMultiplier: 1.0,
      message: ''
    };
    
    if (confidence < 0.3) {
      rec.message = 'Low confidence prediction - standard behavior';
      return rec;
    }
    
    switch (prediction) {
      case PREDICTION.STRONG_UP:
        rec.gridBias = 0.3;
        rec.sizeMultiplier = 1.2;
        rec.message = 'Strong upward prediction - favor buy orders';
        break;
        
      case PREDICTION.UP:
        rec.gridBias = 0.15;
        rec.sizeMultiplier = 1.1;
        rec.message = 'Upward prediction - slight buy preference';
        break;
        
      case PREDICTION.DOWN:
        rec.gridBias = -0.15;
        rec.sizeMultiplier = 0.9;
        rec.message = 'Downward prediction - slight sell preference';
        break;
        
      case PREDICTION.STRONG_DOWN:
        rec.gridBias = -0.3;
        rec.sizeMultiplier = 0.7;
        rec.message = 'Strong downward prediction - reduce buys';
        break;
        
      default:
        rec.message = 'Neutral prediction - standard behavior';
    }
    
    return rec;
  }

  /**
   * Get prediction accuracy stats
   */
  getAccuracyStats(symbol, lookbackHours = 24) {
    const cutoff = Date.now() - (lookbackHours * 60 * 60 * 1000);
    const relevant = this.predictionHistory.filter(
      p => p.symbol === symbol && p.timestamp >= cutoff
    );
    
    if (relevant.length < 2) {
      return { accuracy: null, sampleSize: relevant.length };
    }
    
    let correct = 0;
    
    for (let i = 0; i < relevant.length - 1; i++) {
      const pred = relevant[i];
      const next = relevant[i + 1];
      
      const actualDirection = next.price > pred.price ? 1 : 
                              next.price < pred.price ? -1 : 0;
      const predictedDirection = pred.prediction > 0 ? 1 : 
                                  pred.prediction < 0 ? -1 : 0;
      
      if (actualDirection === predictedDirection || predictedDirection === 0) {
        correct++;
      }
    }
    
    return {
      accuracy: (correct / (relevant.length - 1) * 100).toFixed(1) + '%',
      sampleSize: relevant.length - 1
    };
  }

  /**
   * Get summary of current predictions
   */
  getSummary() {
    const summary = {};
    for (const [key, data] of this.cache.entries()) {
      summary[key] = {
        prediction: data.predictionName,
        confidence: data.confidence,
        shortTerm: data.data.shortTermTrend?.direction,
        mediumTerm: data.data.mediumTermTrend?.direction,
        meanReversion: data.data.meanReversion?.status,
        age: Math.round((Date.now() - data.timestamp) / 1000) + 's ago'
      };
    }
    return summary;
  }
}

export default PricePredictor;
