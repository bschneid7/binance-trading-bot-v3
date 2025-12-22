/**
 * Spread-Aware Order Placement Module
 * Version: 1.0.0
 * 
 * Optimizes order placement based on current spread:
 * - Ensures orders are placed as maker orders (inside spread)
 * - Adjusts prices to avoid crossing the spread
 * - Monitors spread width for optimal entry
 * - Provides spread analytics for strategy adjustment
 * 
 * Benefits:
 * - Guaranteed maker fees (0.1% vs 0.2% taker)
 * - Better average fill prices
 * - Reduced slippage
 */

export class SpreadOptimizer {
  constructor(options = {}) {
    // Spread thresholds
    this.minSpreadPercent = options.minSpreadPercent || 0.01;  // 0.01% minimum spread to trade
    this.wideSpreadPercent = options.wideSpreadPercent || 0.1;  // 0.1% considered wide
    this.narrowSpreadPercent = options.narrowSpreadPercent || 0.03;  // 0.03% considered narrow
    
    // Order placement settings
    this.makerBuffer = options.makerBuffer || 0.0001;  // 0.01% buffer inside spread
    this.maxPriceAdjustment = options.maxPriceAdjustment || 0.005;  // Max 0.5% adjustment
    
    // Spread history for analytics
    this.spreadHistory = [];
    this.maxHistory = options.maxHistory || 500;
    
    // Current order book state
    this.currentOrderBook = null;
    this.lastUpdateTime = 0;
  }

  /**
   * Update current order book data
   * @param {Object} orderBook - Order book from exchange
   */
  updateOrderBook(orderBook) {
    if (!orderBook || !orderBook.bids || !orderBook.asks) {
      return;
    }
    
    const bestBid = orderBook.bids[0]?.[0] || 0;
    const bestAsk = orderBook.asks[0]?.[0] || 0;
    const bidSize = orderBook.bids[0]?.[1] || 0;
    const askSize = orderBook.asks[0]?.[1] || 0;
    
    if (bestBid <= 0 || bestAsk <= 0) {
      return;
    }
    
    const spread = bestAsk - bestBid;
    const spreadPercent = (spread / bestBid) * 100;
    const midPrice = (bestBid + bestAsk) / 2;
    
    this.currentOrderBook = {
      bestBid,
      bestAsk,
      bidSize,
      askSize,
      spread,
      spreadPercent,
      midPrice,
      timestamp: Date.now(),
    };
    
    this.lastUpdateTime = Date.now();
    
    // Record to history
    this.spreadHistory.push({
      spreadPercent,
      spread,
      midPrice,
      timestamp: Date.now(),
    });
    
    // Trim history
    while (this.spreadHistory.length > this.maxHistory) {
      this.spreadHistory.shift();
    }
  }

  /**
   * Get current spread information
   * @returns {Object|null} Current spread data
   */
  getCurrentSpread() {
    if (!this.currentOrderBook) {
      return null;
    }
    
    // Check if data is stale (older than 30 seconds)
    const age = Date.now() - this.lastUpdateTime;
    if (age > 30000) {
      return {
        ...this.currentOrderBook,
        isStale: true,
        ageMs: age,
      };
    }
    
    return {
      ...this.currentOrderBook,
      isStale: false,
      ageMs: age,
    };
  }

  /**
   * Analyze spread conditions
   * @returns {Object} Spread analysis
   */
  analyzeSpread() {
    const current = this.getCurrentSpread();
    
    if (!current) {
      return {
        status: 'unknown',
        canTrade: false,
        message: 'No order book data available',
      };
    }
    
    if (current.isStale) {
      return {
        status: 'stale',
        canTrade: false,
        message: `Order book data is ${(current.ageMs / 1000).toFixed(0)}s old`,
        spread: current,
      };
    }
    
    let status = 'normal';
    let recommendation = '';
    
    if (current.spreadPercent < this.minSpreadPercent) {
      status = 'too_tight';
      recommendation = 'Spread too tight - may have difficulty getting maker orders filled';
    } else if (current.spreadPercent > this.wideSpreadPercent) {
      status = 'wide';
      recommendation = 'Wide spread - good opportunity for maker orders with better prices';
    } else if (current.spreadPercent < this.narrowSpreadPercent) {
      status = 'narrow';
      recommendation = 'Narrow spread - normal conditions, standard maker placement';
    } else {
      status = 'normal';
      recommendation = 'Normal spread - proceed with standard order placement';
    }
    
    // Calculate average spread
    const avgSpread = this.getAverageSpread();
    const isAboveAverage = current.spreadPercent > avgSpread;
    
    return {
      status,
      canTrade: current.spreadPercent >= this.minSpreadPercent,
      recommendation,
      spread: current,
      avgSpreadPercent: avgSpread,
      isAboveAverage,
      spreadRatio: avgSpread > 0 ? current.spreadPercent / avgSpread : 1,
    };
  }

  /**
   * Get average spread from history
   * @param {number} periods - Number of periods to average
   * @returns {number} Average spread percent
   */
  getAverageSpread(periods = 100) {
    const recentHistory = this.spreadHistory.slice(-periods);
    if (recentHistory.length === 0) {
      return 0;
    }
    
    const sum = recentHistory.reduce((acc, h) => acc + h.spreadPercent, 0);
    return sum / recentHistory.length;
  }

  /**
   * Optimize order price for maker status
   * @param {string} side - 'buy' or 'sell'
   * @param {number} targetPrice - Desired price
   * @param {Object} options - Additional options
   * @returns {Object} Optimized order details
   */
  optimizeOrderPrice(side, targetPrice, options = {}) {
    const { tickSize = 0.01, forcemaker = true } = options;
    const current = this.getCurrentSpread();
    
    if (!current || current.isStale) {
      return {
        success: false,
        originalPrice: targetPrice,
        optimizedPrice: targetPrice,
        reason: 'No valid order book data',
        isMaker: false,
        adjustment: 0,
      };
    }
    
    const { bestBid, bestAsk, midPrice, spreadPercent } = current;
    let optimizedPrice = targetPrice;
    let adjustment = 0;
    let reason = '';
    let isMaker = false;
    
    if (side === 'buy') {
      // For buy orders, we want to be at or below best bid to be maker
      if (targetPrice > bestBid) {
        if (forcemaker) {
          // Adjust to best bid minus buffer
          const buffer = bestBid * this.makerBuffer;
          optimizedPrice = bestBid - buffer;
          adjustment = targetPrice - optimizedPrice;
          reason = 'Adjusted to maker price (below best bid)';
          
          // Check if adjustment is too large
          const adjustmentPercent = (adjustment / targetPrice) * 100;
          if (adjustmentPercent > this.maxPriceAdjustment * 100) {
            return {
              success: false,
              originalPrice: targetPrice,
              optimizedPrice: targetPrice,
              reason: `Price adjustment too large (${adjustmentPercent.toFixed(2)}%)`,
              isMaker: false,
              adjustment: 0,
            };
          }
        } else {
          reason = 'Would be taker order (above best bid)';
        }
      } else {
        reason = 'Already a maker order';
      }
      
      isMaker = optimizedPrice <= bestBid;
      
    } else {  // sell
      // For sell orders, we want to be at or above best ask to be maker
      if (targetPrice < bestAsk) {
        if (forcemaker) {
          // Adjust to best ask plus buffer
          const buffer = bestAsk * this.makerBuffer;
          optimizedPrice = bestAsk + buffer;
          adjustment = optimizedPrice - targetPrice;
          reason = 'Adjusted to maker price (above best ask)';
          
          // Check if adjustment is too large
          const adjustmentPercent = (adjustment / targetPrice) * 100;
          if (adjustmentPercent > this.maxPriceAdjustment * 100) {
            return {
              success: false,
              originalPrice: targetPrice,
              optimizedPrice: targetPrice,
              reason: `Price adjustment too large (${adjustmentPercent.toFixed(2)}%)`,
              isMaker: false,
              adjustment: 0,
            };
          }
        } else {
          reason = 'Would be taker order (below best ask)';
        }
      } else {
        reason = 'Already a maker order';
      }
      
      isMaker = optimizedPrice >= bestAsk;
    }
    
    // Round to tick size
    optimizedPrice = Math.round(optimizedPrice / tickSize) * tickSize;
    
    // Calculate fee savings
    const estimatedValue = optimizedPrice * 1;  // Assuming 1 unit for calculation
    const makerFee = estimatedValue * 0.001;
    const takerFee = estimatedValue * 0.002;
    const feeSavings = isMaker ? (takerFee - makerFee) : 0;
    
    return {
      success: true,
      originalPrice: targetPrice,
      optimizedPrice,
      adjustment,
      adjustmentPercent: (adjustment / targetPrice) * 100,
      reason,
      isMaker,
      feeSavingsPercent: isMaker ? 0.1 : 0,  // 0.1% saved as maker
      spread: {
        bestBid,
        bestAsk,
        spreadPercent,
        midPrice,
      },
    };
  }

  /**
   * Get optimal grid prices that ensure maker status
   * @param {number} lowerPrice - Grid lower bound
   * @param {number} upperPrice - Grid upper bound
   * @param {number} gridCount - Number of grid levels
   * @returns {Object} Optimized grid levels
   */
  optimizeGridPrices(lowerPrice, upperPrice, gridCount) {
    const current = this.getCurrentSpread();
    
    if (!current || current.isStale) {
      // Return standard grid if no order book data
      const spacing = (upperPrice - lowerPrice) / gridCount;
      const levels = [];
      for (let i = 0; i <= gridCount; i++) {
        levels.push(lowerPrice + (spacing * i));
      }
      return {
        success: false,
        levels,
        reason: 'No order book data - using standard grid',
      };
    }
    
    const { bestBid, bestAsk, midPrice } = current;
    const spacing = (upperPrice - lowerPrice) / gridCount;
    const levels = [];
    const adjustments = [];
    
    for (let i = 0; i <= gridCount; i++) {
      const basePrice = lowerPrice + (spacing * i);
      let adjustedPrice = basePrice;
      let wasAdjusted = false;
      
      // Determine if this level is a buy or sell based on position relative to mid
      if (basePrice < midPrice) {
        // This would be a buy level - ensure it's at or below best bid
        if (basePrice > bestBid && basePrice < bestAsk) {
          adjustedPrice = bestBid;
          wasAdjusted = true;
        }
      } else {
        // This would be a sell level - ensure it's at or above best ask
        if (basePrice > bestBid && basePrice < bestAsk) {
          adjustedPrice = bestAsk;
          wasAdjusted = true;
        }
      }
      
      levels.push(adjustedPrice);
      if (wasAdjusted) {
        adjustments.push({
          level: i,
          original: basePrice,
          adjusted: adjustedPrice,
        });
      }
    }
    
    return {
      success: true,
      levels,
      adjustments,
      spread: current,
      reason: adjustments.length > 0 
        ? `${adjustments.length} levels adjusted for maker status`
        : 'All levels already optimal',
    };
  }

  /**
   * Check if current spread is favorable for trading
   * @returns {Object} Trading conditions
   */
  getTradingConditions() {
    const analysis = this.analyzeSpread();
    
    if (!analysis.canTrade) {
      return {
        favorable: false,
        reason: analysis.message || analysis.recommendation,
        waitRecommended: true,
      };
    }
    
    // Favorable if spread is normal or wide
    const favorable = ['normal', 'wide'].includes(analysis.status);
    
    return {
      favorable,
      status: analysis.status,
      spreadPercent: analysis.spread?.spreadPercent || 0,
      avgSpreadPercent: analysis.avgSpreadPercent,
      recommendation: analysis.recommendation,
      waitRecommended: analysis.status === 'too_tight',
    };
  }

  /**
   * Get spread statistics
   * @returns {Object} Spread statistics
   */
  getStats() {
    if (this.spreadHistory.length === 0) {
      return {
        dataPoints: 0,
        message: 'No spread data collected yet',
      };
    }
    
    const spreads = this.spreadHistory.map(h => h.spreadPercent);
    const min = Math.min(...spreads);
    const max = Math.max(...spreads);
    const avg = spreads.reduce((a, b) => a + b, 0) / spreads.length;
    
    // Calculate standard deviation
    const squaredDiffs = spreads.map(s => Math.pow(s - avg, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / spreads.length;
    const stdDev = Math.sqrt(variance);
    
    // Count spread conditions
    const tightCount = spreads.filter(s => s < this.narrowSpreadPercent).length;
    const normalCount = spreads.filter(s => s >= this.narrowSpreadPercent && s <= this.wideSpreadPercent).length;
    const wideCount = spreads.filter(s => s > this.wideSpreadPercent).length;
    
    return {
      dataPoints: this.spreadHistory.length,
      current: this.getCurrentSpread()?.spreadPercent || null,
      min,
      max,
      avg,
      stdDev,
      distribution: {
        tight: (tightCount / spreads.length) * 100,
        normal: (normalCount / spreads.length) * 100,
        wide: (wideCount / spreads.length) * 100,
      },
    };
  }

  /**
   * Clear spread history
   */
  clearHistory() {
    this.spreadHistory = [];
    this.currentOrderBook = null;
    this.lastUpdateTime = 0;
  }
}

export default SpreadOptimizer;
