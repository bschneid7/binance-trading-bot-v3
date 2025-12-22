/**
 * Adaptive Grid Spacing Manager
 * Version: 1.0.0
 * 
 * Dynamically adjusts grid spacing based on market conditions:
 * - Ranging markets: Tighter grids for more frequent trades
 * - Trending markets: Wider grids to avoid getting run over
 * 
 * Uses multiple indicators to detect market regime:
 * - ADX (Average Directional Index) for trend strength
 * - Bollinger Band width for volatility/ranging
 * - Price position relative to moving averages
 */

export class AdaptiveGridManager {
  constructor(options = {}) {
    // Grid adjustment limits
    this.minGridMultiplier = options.minGridMultiplier || 0.5;   // Tightest grid (50% of base)
    this.maxGridMultiplier = options.maxGridMultiplier || 2.0;   // Widest grid (200% of base)
    
    // Regime detection thresholds
    this.strongTrendADX = options.strongTrendADX || 30;
    this.weakTrendADX = options.weakTrendADX || 20;
    this.rangingBBWidth = options.rangingBBWidth || 0.02;  // 2% BB width = ranging
    this.trendingBBWidth = options.trendingBBWidth || 0.05;  // 5% BB width = trending
    
    // Price history for calculations
    this.priceHistory = [];
    this.maxHistory = options.maxHistory || 100;
    
    // Calculation periods
    this.adxPeriod = options.adxPeriod || 14;
    this.bbPeriod = options.bbPeriod || 20;
    this.maPeriod = options.maPeriod || 20;
    
    // Current regime
    this.currentRegime = 'unknown';
    this.lastAnalysis = null;
  }

  /**
   * Record a new price
   * @param {number} price - Current price
   * @param {number} high - High price (optional)
   * @param {number} low - Low price (optional)
   */
  recordPrice(price, high = null, low = null) {
    this.priceHistory.push({
      price,
      high: high || price,
      low: low || price,
      timestamp: Date.now(),
    });
    
    // Trim to max history
    while (this.priceHistory.length > this.maxHistory) {
      this.priceHistory.shift();
    }
  }

  /**
   * Calculate Simple Moving Average
   * @param {number} period - MA period
   * @returns {number|null}
   */
  calculateSMA(period) {
    if (this.priceHistory.length < period) {
      return null;
    }
    
    const prices = this.priceHistory.slice(-period).map(p => p.price);
    return prices.reduce((a, b) => a + b, 0) / period;
  }

  /**
   * Calculate Bollinger Bands
   * @returns {Object|null} Bollinger Band values
   */
  calculateBollingerBands() {
    if (this.priceHistory.length < this.bbPeriod) {
      return null;
    }
    
    const prices = this.priceHistory.slice(-this.bbPeriod).map(p => p.price);
    const sma = prices.reduce((a, b) => a + b, 0) / this.bbPeriod;
    
    // Calculate standard deviation
    const squaredDiffs = prices.map(p => Math.pow(p - sma, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / this.bbPeriod;
    const stdDev = Math.sqrt(variance);
    
    const upper = sma + (2 * stdDev);
    const lower = sma - (2 * stdDev);
    const width = (upper - lower) / sma;  // Percentage width
    
    return {
      upper,
      middle: sma,
      lower,
      width,
      stdDev,
    };
  }

  /**
   * Calculate True Range
   * @param {Object} current - Current bar
   * @param {Object} previous - Previous bar
   * @returns {number}
   */
  calculateTrueRange(current, previous) {
    const highLow = current.high - current.low;
    const highClose = Math.abs(current.high - previous.price);
    const lowClose = Math.abs(current.low - previous.price);
    return Math.max(highLow, highClose, lowClose);
  }

  /**
   * Calculate Average True Range (ATR)
   * @param {number} period - ATR period
   * @returns {number|null}
   */
  calculateATR(period) {
    if (this.priceHistory.length < period + 1) {
      return null;
    }
    
    const trueRanges = [];
    for (let i = this.priceHistory.length - period; i < this.priceHistory.length; i++) {
      const tr = this.calculateTrueRange(this.priceHistory[i], this.priceHistory[i - 1]);
      trueRanges.push(tr);
    }
    
    return trueRanges.reduce((a, b) => a + b, 0) / period;
  }

  /**
   * Calculate ADX (Average Directional Index)
   * Simplified calculation for trend strength
   * @returns {Object|null}
   */
  calculateADX() {
    const period = this.adxPeriod;
    if (this.priceHistory.length < period * 2) {
      return null;
    }
    
    const plusDMs = [];
    const minusDMs = [];
    const trueRanges = [];
    
    for (let i = 1; i < this.priceHistory.length; i++) {
      const current = this.priceHistory[i];
      const previous = this.priceHistory[i - 1];
      
      const upMove = current.high - previous.high;
      const downMove = previous.low - current.low;
      
      plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
      trueRanges.push(this.calculateTrueRange(current, previous));
    }
    
    // Calculate smoothed values for last 'period' bars
    const recentPlusDM = plusDMs.slice(-period);
    const recentMinusDM = minusDMs.slice(-period);
    const recentTR = trueRanges.slice(-period);
    
    const smoothedPlusDM = recentPlusDM.reduce((a, b) => a + b, 0);
    const smoothedMinusDM = recentMinusDM.reduce((a, b) => a + b, 0);
    const smoothedTR = recentTR.reduce((a, b) => a + b, 0);
    
    if (smoothedTR === 0) {
      return { adx: 0, plusDI: 0, minusDI: 0 };
    }
    
    const plusDI = (smoothedPlusDM / smoothedTR) * 100;
    const minusDI = (smoothedMinusDM / smoothedTR) * 100;
    
    const diSum = plusDI + minusDI;
    const diDiff = Math.abs(plusDI - minusDI);
    
    const dx = diSum > 0 ? (diDiff / diSum) * 100 : 0;
    
    // ADX is smoothed DX (simplified: just use DX)
    return {
      adx: dx,
      plusDI,
      minusDI,
      trendDirection: plusDI > minusDI ? 'up' : 'down',
    };
  }

  /**
   * Detect current market regime
   * @returns {Object} Regime analysis
   */
  detectRegime() {
    const bb = this.calculateBollingerBands();
    const adx = this.calculateADX();
    const currentPrice = this.priceHistory.length > 0 
      ? this.priceHistory[this.priceHistory.length - 1].price 
      : null;
    const sma = this.calculateSMA(this.maPeriod);
    
    if (!bb || !adx || !currentPrice || !sma) {
      return {
        regime: 'unknown',
        confidence: 0,
        gridMultiplier: 1.0,
        reason: 'Insufficient data for regime detection',
      };
    }
    
    // Determine regime based on multiple factors
    let regime = 'normal';
    let confidence = 0;
    let gridMultiplier = 1.0;
    let factors = [];
    
    // Factor 1: ADX trend strength
    if (adx.adx >= this.strongTrendADX) {
      factors.push({ name: 'ADX', value: 'strong_trend', weight: 0.4 });
      regime = 'trending';
      confidence += 0.4;
    } else if (adx.adx <= this.weakTrendADX) {
      factors.push({ name: 'ADX', value: 'weak_trend', weight: 0.4 });
      regime = 'ranging';
      confidence += 0.4;
    } else {
      factors.push({ name: 'ADX', value: 'moderate', weight: 0.2 });
      confidence += 0.2;
    }
    
    // Factor 2: Bollinger Band width
    if (bb.width <= this.rangingBBWidth) {
      factors.push({ name: 'BB_Width', value: 'narrow', weight: 0.3 });
      if (regime !== 'trending') regime = 'ranging';
      confidence += 0.3;
    } else if (bb.width >= this.trendingBBWidth) {
      factors.push({ name: 'BB_Width', value: 'wide', weight: 0.3 });
      if (regime !== 'ranging') regime = 'trending';
      confidence += 0.3;
    } else {
      factors.push({ name: 'BB_Width', value: 'normal', weight: 0.15 });
      confidence += 0.15;
    }
    
    // Factor 3: Price position relative to BB
    const bbPosition = (currentPrice - bb.lower) / (bb.upper - bb.lower);
    if (bbPosition > 0.8 || bbPosition < 0.2) {
      factors.push({ name: 'BB_Position', value: 'extreme', weight: 0.2 });
      // At extremes, expect mean reversion (ranging behavior)
      if (regime !== 'trending') regime = 'ranging';
      confidence += 0.2;
    } else if (bbPosition > 0.6 || bbPosition < 0.4) {
      factors.push({ name: 'BB_Position', value: 'directional', weight: 0.15 });
      confidence += 0.15;
    } else {
      factors.push({ name: 'BB_Position', value: 'middle', weight: 0.1 });
      confidence += 0.1;
    }
    
    // Calculate grid multiplier based on regime
    if (regime === 'ranging') {
      // Tighter grids in ranging markets
      gridMultiplier = this.minGridMultiplier + (0.3 * (1 - confidence));
    } else if (regime === 'trending') {
      // Wider grids in trending markets
      gridMultiplier = this.maxGridMultiplier - (0.5 * (1 - confidence));
    } else {
      gridMultiplier = 1.0;
    }
    
    // Clamp multiplier
    gridMultiplier = Math.max(this.minGridMultiplier, Math.min(this.maxGridMultiplier, gridMultiplier));
    
    this.currentRegime = regime;
    this.lastAnalysis = {
      regime,
      confidence: Math.min(1, confidence),
      gridMultiplier,
      factors,
      indicators: {
        adx: adx.adx,
        adxDirection: adx.trendDirection,
        bbWidth: bb.width,
        bbPosition,
        currentPrice,
        sma,
        priceVsSMA: ((currentPrice - sma) / sma) * 100,
      },
      timestamp: Date.now(),
    };
    
    return this.lastAnalysis;
  }

  /**
   * Get grid spacing recommendation
   * @param {number} baseGridSpacing - Base grid spacing in price units
   * @returns {Object} Adjusted grid spacing
   */
  getGridSpacing(baseGridSpacing) {
    const analysis = this.detectRegime();
    
    const adjustedSpacing = baseGridSpacing * analysis.gridMultiplier;
    
    return {
      baseSpacing: baseGridSpacing,
      adjustedSpacing,
      multiplier: analysis.gridMultiplier,
      regime: analysis.regime,
      confidence: analysis.confidence,
      reason: this.getRecommendationText(analysis),
    };
  }

  /**
   * Get human-readable recommendation
   */
  getRecommendationText(analysis) {
    if (analysis.regime === 'unknown') {
      return 'Insufficient data - using default grid spacing';
    }
    
    if (analysis.regime === 'ranging') {
      return `Ranging market detected (${(analysis.confidence * 100).toFixed(0)}% confidence) - tighter grids for more trades`;
    }
    
    if (analysis.regime === 'trending') {
      const direction = analysis.indicators?.adxDirection || 'unknown';
      return `Trending ${direction} (${(analysis.confidence * 100).toFixed(0)}% confidence) - wider grids to avoid getting run over`;
    }
    
    return 'Normal market conditions - standard grid spacing';
  }

  /**
   * Check if market is suitable for grid trading
   * @returns {Object} Suitability assessment
   */
  checkGridSuitability() {
    const analysis = this.detectRegime();
    
    let suitability = 'good';
    let reason = '';
    
    if (analysis.regime === 'trending' && analysis.confidence > 0.7) {
      suitability = 'poor';
      reason = 'Strong trend detected - grid trading may result in losses';
    } else if (analysis.regime === 'trending') {
      suitability = 'moderate';
      reason = 'Moderate trend - use wider grids and smaller positions';
    } else if (analysis.regime === 'ranging' && analysis.confidence > 0.7) {
      suitability = 'excellent';
      reason = 'Strong ranging market - ideal for grid trading';
    } else if (analysis.regime === 'ranging') {
      suitability = 'good';
      reason = 'Ranging market - favorable for grid trading';
    }
    
    return {
      suitability,
      reason,
      regime: analysis.regime,
      confidence: analysis.confidence,
      gridMultiplier: analysis.gridMultiplier,
    };
  }

  /**
   * Get full analysis
   * @returns {Object} Complete adaptive grid analysis
   */
  getAnalysis() {
    const regime = this.detectRegime();
    const suitability = this.checkGridSuitability();
    
    return {
      regime: regime.regime,
      confidence: regime.confidence,
      gridMultiplier: regime.gridMultiplier,
      suitability: suitability.suitability,
      suitabilityReason: suitability.reason,
      indicators: regime.indicators,
      factors: regime.factors,
      recommendation: this.getRecommendationText(regime),
      dataPoints: this.priceHistory.length,
      lastUpdate: regime.timestamp ? new Date(regime.timestamp).toISOString() : null,
    };
  }

  /**
   * Clear price history
   */
  clearHistory() {
    this.priceHistory = [];
    this.currentRegime = 'unknown';
    this.lastAnalysis = null;
  }
}

export default AdaptiveGridManager;
