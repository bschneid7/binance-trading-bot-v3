/**
 * Proactive Grid Trailing Module
 * Automatically shifts grid ranges as market trends to maintain optimal positioning
 * Eliminates the need for manual grid adjustments during bull/bear markets
 */

// Configuration
const TRAIL_CONFIG = {
  // Trigger shift when price is within this % of grid boundary
  TRAIL_THRESHOLD_PERCENT: 5,
  
  // How much to shift the grid (as % of current range)
  SHIFT_AMOUNT_PERCENT: 15,
  
  // Trend bias - extend more in trend direction
  // 0.6 means 60% of new range above current price in uptrend
  TREND_BIAS: 0.6,
  
  // Minimum time between grid shifts (in milliseconds)
  SHIFT_COOLDOWN_MS: 60 * 60 * 1000,  // 1 hour
  
  // Minimum price change to consider a trend (%)
  MIN_TREND_CHANGE_PERCENT: 2,
  
  // Number of price samples to determine trend
  TREND_SAMPLE_COUNT: 30,
  
  // Maximum grid range multiplier (prevents runaway expansion)
  MAX_RANGE_MULTIPLIER: 3.0,
  
  // Minimum grid range (as % of current price)
  MIN_RANGE_PERCENT: 5,
  
  // Enable/disable logging
  VERBOSE: true,
};

/**
 * Grid Trailer - manages proactive grid shifting
 */
export class GridTrailer {
  constructor(options = {}) {
    this.config = { ...TRAIL_CONFIG, ...options };
    this.priceHistory = [];
    this.lastShiftTime = 0;
    this.originalRange = null;
    this.shiftCount = 0;
    this.totalShiftAmount = 0;
  }
  
  /**
   * Initialize with current grid settings
   */
  init(lowerPrice, upperPrice) {
    this.originalRange = {
      lower: lowerPrice,
      upper: upperPrice,
      size: upperPrice - lowerPrice,
    };
    
    if (this.config.VERBOSE) {
      console.log(`📈 Grid trailer initialized`);
      console.log(`   Original range: $${lowerPrice.toFixed(2)} - $${upperPrice.toFixed(2)}`);
      console.log(`   Trail threshold: ${this.config.TRAIL_THRESHOLD_PERCENT}%`);
      console.log(`   Shift amount: ${this.config.SHIFT_AMOUNT_PERCENT}%`);
    }
  }
  
  /**
   * Add a price sample for trend detection
   */
  addPriceSample(price) {
    this.priceHistory.push({
      price,
      timestamp: Date.now(),
    });
    
    // Keep only recent samples
    const maxSamples = this.config.TREND_SAMPLE_COUNT * 2;
    if (this.priceHistory.length > maxSamples) {
      this.priceHistory = this.priceHistory.slice(-maxSamples);
    }
  }
  
  /**
   * Detect current market trend
   * Returns: 'up', 'down', or 'neutral'
   */
  detectTrend() {
    if (this.priceHistory.length < this.config.TREND_SAMPLE_COUNT) {
      return 'neutral';
    }
    
    const recentPrices = this.priceHistory.slice(-this.config.TREND_SAMPLE_COUNT);
    const oldPrice = recentPrices[0].price;
    const newPrice = recentPrices[recentPrices.length - 1].price;
    
    const changePercent = ((newPrice - oldPrice) / oldPrice) * 100;
    
    if (changePercent > this.config.MIN_TREND_CHANGE_PERCENT) {
      return 'up';
    } else if (changePercent < -this.config.MIN_TREND_CHANGE_PERCENT) {
      return 'down';
    }
    
    return 'neutral';
  }
  
  /**
   * Calculate trend strength (0-1)
   */
  getTrendStrength() {
    if (this.priceHistory.length < this.config.TREND_SAMPLE_COUNT) {
      return 0;
    }
    
    const recentPrices = this.priceHistory.slice(-this.config.TREND_SAMPLE_COUNT);
    const oldPrice = recentPrices[0].price;
    const newPrice = recentPrices[recentPrices.length - 1].price;
    
    const changePercent = Math.abs(((newPrice - oldPrice) / oldPrice) * 100);
    
    // Normalize to 0-1 range (cap at 10% change = strength 1.0)
    return Math.min(changePercent / 10, 1.0);
  }
  
  /**
   * Check if grid shift is needed and calculate new range
   * Returns null if no shift needed, or { lower, upper, reason } if shift recommended
   */
  checkForShift(currentPrice, currentLower, currentUpper) {
    // Add price sample
    this.addPriceSample(currentPrice);
    
    const rangeSize = currentUpper - currentLower;
    const distanceToUpper = currentUpper - currentPrice;
    const distanceToLower = currentPrice - currentLower;
    
    const upperThreshold = rangeSize * (this.config.TRAIL_THRESHOLD_PERCENT / 100);
    const lowerThreshold = rangeSize * (this.config.TRAIL_THRESHOLD_PERCENT / 100);
    
    // Check cooldown
    const timeSinceLastShift = Date.now() - this.lastShiftTime;
    if (timeSinceLastShift < this.config.SHIFT_COOLDOWN_MS) {
      return null;
    }
    
    // Detect if we're near a boundary
    const nearUpperBound = distanceToUpper < upperThreshold;
    const nearLowerBound = distanceToLower < lowerThreshold;
    
    if (!nearUpperBound && !nearLowerBound) {
      return null;
    }
    
    // Detect trend
    const trend = this.detectTrend();
    const trendStrength = this.getTrendStrength();
    
    // Calculate shift amount
    const shiftAmount = rangeSize * (this.config.SHIFT_AMOUNT_PERCENT / 100);
    
    let newLower, newUpper, reason;
    
    if (nearUpperBound) {
      // Price approaching upper bound - shift grid up
      reason = `Price $${currentPrice.toFixed(2)} near upper bound $${currentUpper.toFixed(2)}`;
      
      if (trend === 'up') {
        // Strong uptrend - use trend bias (extend more upward)
        const bias = this.config.TREND_BIAS + (trendStrength * 0.1);  // Up to 0.7 bias
        newUpper = currentPrice + (rangeSize * bias);
        newLower = currentPrice - (rangeSize * (1 - bias));
        reason += ` (uptrend detected, bias: ${(bias * 100).toFixed(0)}% above)`;
      } else {
        // No clear trend - shift symmetrically
        newLower = currentLower + shiftAmount;
        newUpper = currentUpper + shiftAmount;
        reason += ` (neutral shift)`;
      }
    } else if (nearLowerBound) {
      // Price approaching lower bound - shift grid down
      reason = `Price $${currentPrice.toFixed(2)} near lower bound $${currentLower.toFixed(2)}`;
      
      if (trend === 'down') {
        // Strong downtrend - use trend bias (extend more downward)
        const bias = this.config.TREND_BIAS + (trendStrength * 0.1);
        newLower = currentPrice - (rangeSize * bias);
        newUpper = currentPrice + (rangeSize * (1 - bias));
        reason += ` (downtrend detected, bias: ${(bias * 100).toFixed(0)}% below)`;
      } else {
        // No clear trend - shift symmetrically
        newLower = currentLower - shiftAmount;
        newUpper = currentUpper - shiftAmount;
        reason += ` (neutral shift)`;
      }
    }
    
    // Validate new range
    const validation = this.validateRange(newLower, newUpper, currentPrice);
    if (!validation.valid) {
      if (this.config.VERBOSE) {
        console.log(`⚠️  Grid shift rejected: ${validation.reason}`);
      }
      return null;
    }
    
    return {
      lower: Math.round(newLower * 100) / 100,
      upper: Math.round(newUpper * 100) / 100,
      reason,
      trend,
      trendStrength,
    };
  }
  
  /**
   * Validate proposed new range
   */
  validateRange(newLower, newUpper, currentPrice) {
    // Check basic validity
    if (newLower >= newUpper) {
      return { valid: false, reason: 'Lower >= Upper' };
    }
    
    if (newLower <= 0) {
      return { valid: false, reason: 'Lower price <= 0' };
    }
    
    // Check price is within range
    if (currentPrice < newLower || currentPrice > newUpper) {
      return { valid: false, reason: 'Current price outside new range' };
    }
    
    // Check range size limits
    const newRangeSize = newUpper - newLower;
    const minRange = currentPrice * (this.config.MIN_RANGE_PERCENT / 100);
    
    if (newRangeSize < minRange) {
      return { valid: false, reason: `Range too small (min: ${this.config.MIN_RANGE_PERCENT}%)` };
    }
    
    // Check maximum expansion from original
    if (this.originalRange) {
      const maxRangeSize = this.originalRange.size * this.config.MAX_RANGE_MULTIPLIER;
      if (newRangeSize > maxRangeSize) {
        return { valid: false, reason: `Range too large (max: ${this.config.MAX_RANGE_MULTIPLIER}x original)` };
      }
    }
    
    return { valid: true };
  }
  
  /**
   * Record that a shift was executed
   */
  recordShift(oldLower, oldUpper, newLower, newUpper) {
    this.lastShiftTime = Date.now();
    this.shiftCount++;
    
    const shiftAmount = Math.abs((newLower + newUpper) / 2 - (oldLower + oldUpper) / 2);
    this.totalShiftAmount += shiftAmount;
    
    if (this.config.VERBOSE) {
      console.log(`\n🔄 GRID SHIFT EXECUTED (#${this.shiftCount})`);
      console.log(`   Old range: $${oldLower.toFixed(2)} - $${oldUpper.toFixed(2)}`);
      console.log(`   New range: $${newLower.toFixed(2)} - $${newUpper.toFixed(2)}`);
      console.log(`   Shift: $${shiftAmount.toFixed(2)}`);
      console.log(`   Total shifts: ${this.shiftCount}, Total movement: $${this.totalShiftAmount.toFixed(2)}\n`);
    }
  }
  
  /**
   * Get current status
   */
  getStatus() {
    const trend = this.detectTrend();
    const trendStrength = this.getTrendStrength();
    const cooldownRemaining = Math.max(0, this.config.SHIFT_COOLDOWN_MS - (Date.now() - this.lastShiftTime));
    
    return {
      trend,
      trendStrength: (trendStrength * 100).toFixed(1) + '%',
      shiftCount: this.shiftCount,
      totalShiftAmount: this.totalShiftAmount,
      cooldownRemaining: Math.round(cooldownRemaining / 1000) + 's',
      priceHistoryLength: this.priceHistory.length,
      config: {
        trailThreshold: this.config.TRAIL_THRESHOLD_PERCENT + '%',
        shiftAmount: this.config.SHIFT_AMOUNT_PERCENT + '%',
        trendBias: (this.config.TREND_BIAS * 100) + '%',
        cooldown: Math.round(this.config.SHIFT_COOLDOWN_MS / 60000) + 'min',
      },
    };
  }
  
  /**
   * Get stats for final report
   */
  getStats() {
    return {
      shiftCount: this.shiftCount,
      totalShiftAmount: this.totalShiftAmount,
      originalRange: this.originalRange,
    };
  }
}

export default GridTrailer;
