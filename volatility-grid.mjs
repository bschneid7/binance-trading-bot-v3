#!/usr/bin/env node

/**
 * Volatility-Based Grid Spacing Module
 * Version: 1.0.0
 * 
 * Dynamically adjusts grid spacing based on market volatility:
 * - Low volatility: Tighter grids for more frequent trades
 * - High volatility: Wider grids to avoid being stopped out
 * 
 * Uses ATR (Average True Range) as the volatility measure.
 */

/**
 * Volatility regime thresholds (as percentage of price)
 */
const VOLATILITY_REGIMES = {
  VERY_LOW: { max: 0.005, multiplier: 0.6, name: 'Very Low' },    // < 0.5% - tighten grids significantly
  LOW: { max: 0.010, multiplier: 0.8, name: 'Low' },              // 0.5-1% - tighten grids
  NORMAL: { max: 0.020, multiplier: 1.0, name: 'Normal' },        // 1-2% - standard spacing
  HIGH: { max: 0.035, multiplier: 1.3, name: 'High' },            // 2-3.5% - widen grids
  VERY_HIGH: { max: Infinity, multiplier: 1.6, name: 'Very High' } // > 3.5% - widen grids significantly
};

/**
 * Asset-specific volatility adjustments
 * Some assets are naturally more volatile than others
 */
const ASSET_ADJUSTMENTS = {
  'BTC/USD': 1.0,   // Baseline
  'ETH/USD': 1.1,   // 10% more volatile than BTC
  'SOL/USD': 1.3,   // 30% more volatile than BTC
  'default': 1.0
};

/**
 * Volatility Grid Manager
 * Calculates and manages volatility-adjusted grid parameters
 */
export class VolatilityGridManager {
  constructor(options = {}) {
    this.options = {
      atrPeriod: 14,           // ATR calculation period
      atrTimeframe: '1h',      // Timeframe for ATR calculation
      minGridMultiplier: 0.5,  // Minimum grid spacing multiplier
      maxGridMultiplier: 2.0,  // Maximum grid spacing multiplier
      smoothingFactor: 0.3,    // How quickly to adapt (0-1, lower = smoother)
      ...options
    };
    
    // Store historical ATR values for smoothing
    this.atrHistory = new Map(); // symbol -> [atr values]
    this.lastCalculation = new Map(); // symbol -> { atr, regime, multiplier, timestamp }
  }

  /**
   * Calculate ATR (Average True Range) from OHLCV data
   * @param {Array} ohlcv - Array of [timestamp, open, high, low, close, volume]
   * @returns {number} ATR value
   */
  calculateATR(ohlcv) {
    if (ohlcv.length < 2) return 0;
    
    const trueRanges = [];
    
    for (let i = 1; i < ohlcv.length; i++) {
      const high = ohlcv[i][2];
      const low = ohlcv[i][3];
      const prevClose = ohlcv[i - 1][4];
      
      // True Range = max(high - low, |high - prevClose|, |low - prevClose|)
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      
      trueRanges.push(tr);
    }
    
    // Calculate average of true ranges
    const atr = trueRanges.reduce((sum, tr) => sum + tr, 0) / trueRanges.length;
    return atr;
  }

  /**
   * Calculate ATR as a percentage of current price
   * @param {number} atr - ATR value
   * @param {number} currentPrice - Current price
   * @returns {number} ATR percentage
   */
  atrPercentage(atr, currentPrice) {
    return atr / currentPrice;
  }

  /**
   * Determine volatility regime based on ATR percentage
   * @param {number} atrPercent - ATR as percentage of price
   * @returns {Object} Regime object with name and multiplier
   */
  getVolatilityRegime(atrPercent) {
    for (const [key, regime] of Object.entries(VOLATILITY_REGIMES)) {
      if (atrPercent <= regime.max) {
        return { key, ...regime };
      }
    }
    return { key: 'VERY_HIGH', ...VOLATILITY_REGIMES.VERY_HIGH };
  }

  /**
   * Get asset-specific adjustment factor
   * @param {string} symbol - Trading pair symbol
   * @returns {number} Adjustment factor
   */
  getAssetAdjustment(symbol) {
    return ASSET_ADJUSTMENTS[symbol] || ASSET_ADJUSTMENTS.default;
  }

  /**
   * Calculate smoothed multiplier using exponential moving average
   * @param {string} symbol - Trading pair symbol
   * @param {number} newMultiplier - New calculated multiplier
   * @returns {number} Smoothed multiplier
   */
  smoothMultiplier(symbol, newMultiplier) {
    const last = this.lastCalculation.get(symbol);
    
    if (!last) {
      return newMultiplier;
    }
    
    // Exponential smoothing
    const smoothed = last.multiplier * (1 - this.options.smoothingFactor) + 
                     newMultiplier * this.options.smoothingFactor;
    
    return smoothed;
  }

  /**
   * Calculate volatility-adjusted grid parameters
   * @param {Object} exchange - CCXT exchange instance
   * @param {string} symbol - Trading pair symbol
   * @param {Object} baseGrid - Base grid parameters { lower, upper, count }
   * @returns {Object} Adjusted grid parameters
   */
  async calculateAdjustedGrid(exchange, symbol, baseGrid) {
    try {
      // Fetch OHLCV data for ATR calculation
      const ohlcv = await exchange.fetchOHLCV(
        symbol, 
        this.options.atrTimeframe, 
        undefined, 
        this.options.atrPeriod + 1
      );
      
      if (ohlcv.length < 2) {
        console.log(`⚠️  Insufficient OHLCV data for ${symbol}, using base grid`);
        return this.formatResult(baseGrid, 1.0, 0, 'UNKNOWN', 'Insufficient data');
      }
      
      // Calculate ATR
      const atr = this.calculateATR(ohlcv);
      const currentPrice = ohlcv[ohlcv.length - 1][4];
      const atrPercent = this.atrPercentage(atr, currentPrice);
      
      // Get volatility regime
      const regime = this.getVolatilityRegime(atrPercent);
      
      // Apply asset-specific adjustment
      const assetAdjustment = this.getAssetAdjustment(symbol);
      let rawMultiplier = regime.multiplier * assetAdjustment;
      
      // Clamp multiplier to configured bounds
      rawMultiplier = Math.max(this.options.minGridMultiplier, 
                               Math.min(this.options.maxGridMultiplier, rawMultiplier));
      
      // Apply smoothing
      const smoothedMultiplier = this.smoothMultiplier(symbol, rawMultiplier);
      
      // Calculate adjusted grid
      const baseRange = baseGrid.upper - baseGrid.lower;
      const baseSpacing = baseRange / baseGrid.count;
      const adjustedSpacing = baseSpacing * smoothedMultiplier;
      
      // Adjust grid count to maintain similar range coverage
      // If spacing increases, we need fewer grid levels
      const adjustedCount = Math.max(
        3, // Minimum 3 grid levels
        Math.round(baseGrid.count / smoothedMultiplier)
      );
      
      // Store calculation for history and smoothing
      this.lastCalculation.set(symbol, {
        atr,
        atrPercent,
        regime: regime.name,
        multiplier: smoothedMultiplier,
        timestamp: Date.now()
      });
      
      return this.formatResult(
        {
          lower: baseGrid.lower,
          upper: baseGrid.upper,
          count: adjustedCount,
          spacing: adjustedSpacing
        },
        smoothedMultiplier,
        atrPercent,
        regime.name,
        null
      );
      
    } catch (error) {
      console.error(`❌ Volatility calculation error for ${symbol}:`, error.message);
      return this.formatResult(baseGrid, 1.0, 0, 'ERROR', error.message);
    }
  }

  /**
   * Format the result object
   */
  formatResult(grid, multiplier, atrPercent, regime, error) {
    return {
      grid: {
        lower: grid.lower,
        upper: grid.upper,
        count: grid.count,
        spacing: grid.spacing || (grid.upper - grid.lower) / grid.count
      },
      volatility: {
        multiplier: parseFloat(multiplier.toFixed(3)),
        atrPercent: parseFloat((atrPercent * 100).toFixed(3)),
        regime
      },
      error
    };
  }

  /**
   * Get the last calculation for a symbol
   * @param {string} symbol - Trading pair symbol
   * @returns {Object|null} Last calculation or null
   */
  getLastCalculation(symbol) {
    return this.lastCalculation.get(symbol) || null;
  }

  /**
   * Check if recalculation is needed (based on time elapsed)
   * @param {string} symbol - Trading pair symbol
   * @param {number} maxAge - Maximum age in milliseconds (default: 5 minutes)
   * @returns {boolean} True if recalculation is needed
   */
  needsRecalculation(symbol, maxAge = 5 * 60 * 1000) {
    const last = this.lastCalculation.get(symbol);
    if (!last) return true;
    return Date.now() - last.timestamp > maxAge;
  }

  /**
   * Get a summary of current volatility state for all tracked symbols
   * @returns {Object} Summary object
   */
  getSummary() {
    const summary = {};
    for (const [symbol, data] of this.lastCalculation.entries()) {
      summary[symbol] = {
        regime: data.regime,
        multiplier: data.multiplier.toFixed(2),
        atrPercent: (data.atrPercent * 100).toFixed(2) + '%',
        age: Math.round((Date.now() - data.timestamp) / 1000) + 's ago'
      };
    }
    return summary;
  }
}

/**
 * Calculate recommended grid levels based on volatility
 * Standalone function for simple use cases
 */
export function calculateVolatilityAdjustedLevels(
  currentPrice,
  baseGridPercent,  // e.g., 0.10 for 10% range
  baseGridCount,
  atrPercent,
  symbol = 'default'
) {
  // Get regime
  let multiplier = 1.0;
  for (const regime of Object.values(VOLATILITY_REGIMES)) {
    if (atrPercent <= regime.max) {
      multiplier = regime.multiplier;
      break;
    }
  }
  
  // Apply asset adjustment
  multiplier *= ASSET_ADJUSTMENTS[symbol] || 1.0;
  
  // Calculate adjusted parameters
  const adjustedGridPercent = baseGridPercent * multiplier;
  const adjustedCount = Math.max(3, Math.round(baseGridCount / multiplier));
  
  const lower = currentPrice * (1 - adjustedGridPercent / 2);
  const upper = currentPrice * (1 + adjustedGridPercent / 2);
  const spacing = (upper - lower) / adjustedCount;
  
  return {
    lower: Math.round(lower * 100) / 100,
    upper: Math.round(upper * 100) / 100,
    count: adjustedCount,
    spacing: Math.round(spacing * 100) / 100,
    multiplier
  };
}

// Export for use in enhanced monitor
export default VolatilityGridManager;
