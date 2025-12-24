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
  
  // EMERGENCY RECOVERY SETTINGS
  // Enable automatic recovery when price escapes grid
  EMERGENCY_RECOVERY_ENABLED: true,
  
  // Cooldown for emergency recovery (shorter than normal shifts)
  EMERGENCY_COOLDOWN_MS: 5 * 60 * 1000,  // 5 minutes
  
  // Default range size for emergency recovery (as % of current price)
  EMERGENCY_RANGE_PERCENT: 20,
  
  // Minimum escape percentage to trigger emergency (prevents false positives)
  // Set to 10% to avoid triggering on minor boundary touches
  MIN_ESCAPE_PERCENT: 10,
};

/**
 * Grid Trailer - manages proactive grid shifting
 */
export class GridTrailer {
  constructor(options = {}) {
    this.config = { ...TRAIL_CONFIG, ...options };
    this.priceHistory = [];
    this.lastShiftTime = 0;
    this.lastEmergencyRecoveryTime = 0;
    this.originalRange = null;
    this.shiftCount = 0;
    this.emergencyRecoveryCount = 0;
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
   * Check if price has escaped the grid entirely (emergency situation)
   * Returns recovery info if needed, null otherwise
   */
  checkForEmergencyRecovery(currentPrice, currentLower, currentUpper) {
    if (!this.config.EMERGENCY_RECOVERY_ENABLED) {
      return null;
    }
    
    // Validate inputs
    if (!currentPrice || !currentLower || !currentUpper) {
      console.log(`⚠️  Emergency check skipped: Invalid inputs (price=${currentPrice}, lower=${currentLower}, upper=${currentUpper})`);
      return null;
    }
    
    // Ensure lower < upper (swap if needed due to data issue)
    if (currentLower > currentUpper) {
      console.log(`⚠️  Grid bounds swapped! Correcting: lower=${currentLower}, upper=${currentUpper}`);
      [currentLower, currentUpper] = [currentUpper, currentLower];
    }
    
    // Check if price is outside grid
    const isAboveGrid = currentPrice > currentUpper;
    const isBelowGrid = currentPrice < currentLower;
    
    if (!isAboveGrid && !isBelowGrid) {
      return null;  // Price is within grid, no emergency
    }
    
    // Double-check: Log the actual comparison for debugging
    if (this.config.VERBOSE) {
      console.log(`🔍 Emergency check: price=$${currentPrice.toFixed(2)}, grid=$${currentLower.toFixed(2)}-$${currentUpper.toFixed(2)}`);
      console.log(`   isAboveGrid: ${isAboveGrid} (${currentPrice} > ${currentUpper})`);
      console.log(`   isBelowGrid: ${isBelowGrid} (${currentPrice} < ${currentLower})`);
    }
    
    // Check emergency cooldown
    const timeSinceLastRecovery = Date.now() - this.lastEmergencyRecoveryTime;
    if (timeSinceLastRecovery < this.config.EMERGENCY_COOLDOWN_MS) {
      if (this.config.VERBOSE) {
        const remaining = Math.round((this.config.EMERGENCY_COOLDOWN_MS - timeSinceLastRecovery) / 1000);
        console.log(`⏳ Emergency recovery cooldown: ${remaining}s remaining`);
      }
      return null;
    }
    
    // Calculate escape percentage
    const rangeSize = currentUpper - currentLower;
    
    // Validate range size
    if (rangeSize <= 0) {
      console.log(`⚠️  Emergency check skipped: Invalid range size (${rangeSize})`);
      return null;
    }
    
    let escapePercent;
    let direction;
    
    if (isAboveGrid) {
      escapePercent = ((currentPrice - currentUpper) / rangeSize) * 100;
      direction = 'above';
    } else {
      escapePercent = ((currentLower - currentPrice) / rangeSize) * 100;
      direction = 'below';
    }
    
    // Validate escape percent (should always be positive)
    if (escapePercent < 0) {
      console.log(`⚠️  Emergency check anomaly: Negative escape percent (${escapePercent.toFixed(1)}%)`);
      console.log(`   This indicates price is actually within grid. Aborting emergency.`);
      return null;
    }
    
    // Check minimum escape threshold (prevents triggering on minor boundary touches)
    if (escapePercent < this.config.MIN_ESCAPE_PERCENT) {
      if (this.config.VERBOSE) {
        console.log(`⏳ Price escaped by only ${escapePercent.toFixed(1)}% (min: ${this.config.MIN_ESCAPE_PERCENT}%). Waiting for larger move.`);
      }
      return null;
    }
    
    // Detect trend for bias
    const trend = this.detectTrend();
    const trendStrength = this.getTrendStrength();
    
    // Calculate new range centered on current price
    const newRangeSize = currentPrice * (this.config.EMERGENCY_RANGE_PERCENT / 100);
    let newLower, newUpper;
    
    // Apply trend bias if available
    if (direction === 'above' && trend === 'up') {
      // Uptrend - extend more above
      const bias = this.config.TREND_BIAS;
      newUpper = currentPrice + (newRangeSize * bias);
      newLower = currentPrice - (newRangeSize * (1 - bias));
    } else if (direction === 'below' && trend === 'down') {
      // Downtrend - extend more below
      const bias = this.config.TREND_BIAS;
      newLower = currentPrice - (newRangeSize * bias);
      newUpper = currentPrice + (newRangeSize * (1 - bias));
    } else {
      // Neutral - center on current price
      newLower = currentPrice - (newRangeSize / 2);
      newUpper = currentPrice + (newRangeSize / 2);
    }
    
    // Ensure valid range
    newLower = Math.max(newLower, currentPrice * 0.5);  // Don't go below 50% of price
    newUpper = Math.max(newUpper, newLower + (currentPrice * 0.1));  // Min 10% range
    
    const reason = `EMERGENCY: Price $${currentPrice.toFixed(2)} escaped ${direction} grid ` +
                   `($${currentLower.toFixed(2)} - $${currentUpper.toFixed(2)}) by ${escapePercent.toFixed(1)}%`;
    
    if (this.config.VERBOSE) {
      console.log(`\n🚨 ${reason}`);
      console.log(`   Trend: ${trend} (strength: ${(trendStrength * 100).toFixed(0)}%)`);
      console.log(`   Proposed recovery range: $${newLower.toFixed(2)} - $${newUpper.toFixed(2)}`);
    }
    
    return {
      lower: Math.round(newLower * 100) / 100,
      upper: Math.round(newUpper * 100) / 100,
      reason,
      isEmergency: true,
      direction,
      escapePercent,
      trend,
      trendStrength,
    };
  }
  
  /**
   * Record that an emergency recovery was executed
   */
  recordEmergencyRecovery(oldLower, oldUpper, newLower, newUpper) {
    this.lastEmergencyRecoveryTime = Date.now();
    this.emergencyRecoveryCount++;
    
    const shiftAmount = Math.abs((newLower + newUpper) / 2 - (oldLower + oldUpper) / 2);
    this.totalShiftAmount += shiftAmount;
    
    if (this.config.VERBOSE) {
      console.log(`\n🚨 EMERGENCY GRID RECOVERY EXECUTED (#${this.emergencyRecoveryCount})`);
      console.log(`   Old range: $${oldLower.toFixed(2)} - $${oldUpper.toFixed(2)}`);
      console.log(`   New range: $${newLower.toFixed(2)} - $${newUpper.toFixed(2)}`);
      console.log(`   Shift: $${shiftAmount.toFixed(2)}`);
      console.log(`   Total recoveries: ${this.emergencyRecoveryCount}\n`);
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
      emergencyRecoveryCount: this.emergencyRecoveryCount,
      totalShiftAmount: this.totalShiftAmount,
      originalRange: this.originalRange,
    };
  }
}

export default GridTrailer;
