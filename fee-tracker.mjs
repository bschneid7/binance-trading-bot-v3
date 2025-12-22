/**
 * Fee Tier Tracking Module
 * Version: 1.0.0
 * 
 * Tracks trading fees and optimizes for maker vs taker:
 * - Monitors actual fees paid per trade
 * - Calculates fee savings from maker orders
 * - Tracks 30-day volume for fee tier estimation
 * - Provides recommendations for fee optimization
 * 
 * Binance.US Fee Structure (as of 2024):
 * - Maker: 0.1% (0.001)
 * - Taker: 0.2% (0.002)
 * - With BNB: Additional 25% discount
 */

export class FeeTracker {
  constructor(options = {}) {
    // Fee rates
    this.makerFeeRate = options.makerFeeRate || 0.001;  // 0.1%
    this.takerFeeRate = options.takerFeeRate || 0.002;  // 0.2%
    this.bnbDiscount = options.bnbDiscount || 0.25;    // 25% discount with BNB
    
    // Track if using BNB for fees
    this.useBnbForFees = options.useBnbForFees || false;
    
    // Fee tracking
    this.feeHistory = [];
    this.maxHistory = options.maxHistory || 1000;
    
    // Statistics
    this.stats = {
      totalMakerFees: 0,
      totalTakerFees: 0,
      makerTrades: 0,
      takerTrades: 0,
      totalVolume: 0,
      feesSaved: 0,  // vs all taker
      potentialSavings: 0,  // if all were maker
    };
    
    // 30-day rolling volume for tier tracking
    this.volumeHistory = [];
  }

  /**
   * Get effective fee rate based on order type and BNB usage
   * @param {string} orderType - 'maker' or 'taker'
   * @returns {number} Effective fee rate
   */
  getEffectiveFeeRate(orderType) {
    let rate = orderType === 'maker' ? this.makerFeeRate : this.takerFeeRate;
    
    if (this.useBnbForFees) {
      rate *= (1 - this.bnbDiscount);
    }
    
    return rate;
  }

  /**
   * Record a trade and its fee
   * @param {Object} trade - Trade details
   */
  recordTrade(trade) {
    const {
      symbol,
      side,
      price,
      amount,
      fee = null,
      feeAsset = null,
      isMaker = null,
      orderId,
      timestamp = Date.now(),
    } = trade;
    
    const value = price * amount;
    
    // Determine if maker or taker
    let orderType = 'unknown';
    if (isMaker !== null) {
      orderType = isMaker ? 'maker' : 'taker';
    } else if (fee !== null && value > 0) {
      // Estimate based on fee percentage
      const feePercent = fee / value;
      const makerThreshold = this.makerFeeRate * 1.5;  // Allow some margin
      orderType = feePercent <= makerThreshold ? 'maker' : 'taker';
    }
    
    // Calculate expected fees
    const expectedMakerFee = value * this.getEffectiveFeeRate('maker');
    const expectedTakerFee = value * this.getEffectiveFeeRate('taker');
    const actualFee = fee !== null ? fee : (orderType === 'maker' ? expectedMakerFee : expectedTakerFee);
    
    // Record to history
    const record = {
      symbol,
      side,
      price,
      amount,
      value,
      fee: actualFee,
      feeAsset,
      orderType,
      orderId,
      timestamp,
      expectedMakerFee,
      expectedTakerFee,
    };
    
    this.feeHistory.push(record);
    
    // Trim history
    while (this.feeHistory.length > this.maxHistory) {
      this.feeHistory.shift();
    }
    
    // Update statistics
    this.stats.totalVolume += value;
    
    if (orderType === 'maker') {
      this.stats.totalMakerFees += actualFee;
      this.stats.makerTrades++;
      this.stats.feesSaved += (expectedTakerFee - actualFee);
    } else if (orderType === 'taker') {
      this.stats.totalTakerFees += actualFee;
      this.stats.takerTrades++;
      this.stats.potentialSavings += (actualFee - expectedMakerFee);
    }
    
    // Update 30-day volume
    this.volumeHistory.push({ value, timestamp });
    this.pruneVolumeHistory();
    
    return record;
  }

  /**
   * Remove volume entries older than 30 days
   */
  pruneVolumeHistory() {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    this.volumeHistory = this.volumeHistory.filter(v => v.timestamp >= thirtyDaysAgo);
  }

  /**
   * Get 30-day trading volume
   * @returns {number} Total volume in USD
   */
  get30DayVolume() {
    this.pruneVolumeHistory();
    return this.volumeHistory.reduce((sum, v) => sum + v.value, 0);
  }

  /**
   * Estimate current fee tier based on 30-day volume
   * @returns {Object} Tier information
   */
  getFeeTier() {
    const volume = this.get30DayVolume();
    
    // Binance.US fee tiers (approximate)
    const tiers = [
      { level: 'VIP 0', minVolume: 0, makerFee: 0.001, takerFee: 0.002 },
      { level: 'VIP 1', minVolume: 50000, makerFee: 0.0009, takerFee: 0.0018 },
      { level: 'VIP 2', minVolume: 100000, makerFee: 0.0008, takerFee: 0.0016 },
      { level: 'VIP 3', minVolume: 500000, makerFee: 0.0006, takerFee: 0.0012 },
      { level: 'VIP 4', minVolume: 1000000, makerFee: 0.0004, takerFee: 0.0008 },
      { level: 'VIP 5', minVolume: 5000000, makerFee: 0.0002, takerFee: 0.0004 },
    ];
    
    let currentTier = tiers[0];
    let nextTier = tiers[1];
    
    for (let i = tiers.length - 1; i >= 0; i--) {
      if (volume >= tiers[i].minVolume) {
        currentTier = tiers[i];
        nextTier = tiers[i + 1] || null;
        break;
      }
    }
    
    return {
      currentTier,
      nextTier,
      volume30d: volume,
      volumeToNextTier: nextTier ? nextTier.minVolume - volume : 0,
    };
  }

  /**
   * Get fee optimization recommendations
   * @returns {Object} Recommendations
   */
  getRecommendations() {
    const totalTrades = this.stats.makerTrades + this.stats.takerTrades;
    const makerPercent = totalTrades > 0 ? (this.stats.makerTrades / totalTrades) * 100 : 0;
    
    const recommendations = [];
    
    // Check maker ratio
    if (makerPercent < 90) {
      recommendations.push({
        type: 'increase_maker_ratio',
        priority: 'high',
        message: `Only ${makerPercent.toFixed(1)}% of trades are maker orders. Target 95%+ for optimal fees.`,
        potentialSavings: this.stats.potentialSavings,
      });
    }
    
    // Check BNB usage
    if (!this.useBnbForFees) {
      const totalFees = this.stats.totalMakerFees + this.stats.totalTakerFees;
      const bnbSavings = totalFees * this.bnbDiscount;
      if (bnbSavings > 1) {  // Only recommend if savings > $1
        recommendations.push({
          type: 'use_bnb_for_fees',
          priority: 'medium',
          message: `Enable BNB for fee payment to save 25% on all fees.`,
          potentialSavings: bnbSavings,
        });
      }
    }
    
    // Check tier progress
    const tierInfo = this.getFeeTier();
    if (tierInfo.nextTier && tierInfo.volumeToNextTier < tierInfo.volume30d * 0.5) {
      recommendations.push({
        type: 'tier_upgrade_close',
        priority: 'low',
        message: `Only $${tierInfo.volumeToNextTier.toFixed(0)} more volume needed to reach ${tierInfo.nextTier.level}.`,
        potentialSavings: 0,
      });
    }
    
    return {
      makerPercent,
      totalFeesPaid: this.stats.totalMakerFees + this.stats.totalTakerFees,
      feesSaved: this.stats.feesSaved,
      potentialSavings: this.stats.potentialSavings,
      recommendations,
    };
  }

  /**
   * Check if an order price would be a maker order
   * @param {string} side - 'buy' or 'sell'
   * @param {number} orderPrice - Proposed order price
   * @param {number} bestBid - Current best bid
   * @param {number} bestAsk - Current best ask
   * @returns {boolean} True if order would be maker
   */
  wouldBeMaker(side, orderPrice, bestBid, bestAsk) {
    if (side === 'buy') {
      // Buy order is maker if price <= best bid (won't cross spread)
      return orderPrice <= bestBid;
    } else {
      // Sell order is maker if price >= best ask (won't cross spread)
      return orderPrice >= bestAsk;
    }
  }

  /**
   * Adjust order price to ensure maker status
   * @param {string} side - 'buy' or 'sell'
   * @param {number} desiredPrice - Desired order price
   * @param {number} bestBid - Current best bid
   * @param {number} bestAsk - Current best ask
   * @param {number} tickSize - Minimum price increment
   * @returns {Object} Adjusted price info
   */
  adjustForMaker(side, desiredPrice, bestBid, bestAsk, tickSize = 0.01) {
    let adjustedPrice = desiredPrice;
    let wasAdjusted = false;
    let adjustment = 0;
    
    if (side === 'buy') {
      // If buy price would cross the spread, adjust down to best bid
      if (desiredPrice > bestBid) {
        adjustedPrice = bestBid;
        wasAdjusted = true;
        adjustment = desiredPrice - adjustedPrice;
      }
    } else {
      // If sell price would cross the spread, adjust up to best ask
      if (desiredPrice < bestAsk) {
        adjustedPrice = bestAsk;
        wasAdjusted = true;
        adjustment = adjustedPrice - desiredPrice;
      }
    }
    
    // Round to tick size
    adjustedPrice = Math.round(adjustedPrice / tickSize) * tickSize;
    
    return {
      originalPrice: desiredPrice,
      adjustedPrice,
      wasAdjusted,
      adjustment,
      isMaker: this.wouldBeMaker(side, adjustedPrice, bestBid, bestAsk),
      feeSaved: wasAdjusted ? (desiredPrice * (this.takerFeeRate - this.makerFeeRate)) : 0,
    };
  }

  /**
   * Get fee statistics summary
   * @returns {Object} Statistics
   */
  getStats() {
    const totalTrades = this.stats.makerTrades + this.stats.takerTrades;
    const totalFees = this.stats.totalMakerFees + this.stats.totalTakerFees;
    const avgFeeRate = this.stats.totalVolume > 0 ? totalFees / this.stats.totalVolume : 0;
    
    return {
      totalTrades,
      makerTrades: this.stats.makerTrades,
      takerTrades: this.stats.takerTrades,
      makerPercent: totalTrades > 0 ? (this.stats.makerTrades / totalTrades) * 100 : 0,
      totalVolume: this.stats.totalVolume,
      totalFees,
      avgFeeRate,
      avgFeePercent: avgFeeRate * 100,
      feesSaved: this.stats.feesSaved,
      potentialSavings: this.stats.potentialSavings,
      volume30d: this.get30DayVolume(),
      feeTier: this.getFeeTier(),
    };
  }

  /**
   * Get recent fee history
   * @param {number} count - Number of records to return
   * @returns {Array} Recent fee records
   */
  getRecentHistory(count = 10) {
    return this.feeHistory.slice(-count);
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalMakerFees: 0,
      totalTakerFees: 0,
      makerTrades: 0,
      takerTrades: 0,
      totalVolume: 0,
      feesSaved: 0,
      potentialSavings: 0,
    };
    this.feeHistory = [];
  }
}

export default FeeTracker;
