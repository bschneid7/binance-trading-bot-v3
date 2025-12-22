/**
 * Dynamic Position Sizer
 * Version: 1.0.0
 * 
 * Optimizes order sizes based on multiple factors:
 * 1. Win rate - Higher win rate = larger positions
 * 2. Volatility - Lower volatility = larger positions
 * 3. Available capital - Scale with account equity
 * 4. Risk per trade - Never exceed max risk percentage
 * 
 * Uses a modified Kelly Criterion approach for optimal sizing.
 */

export class PositionSizer {
  constructor(options = {}) {
    // Risk management settings
    this.maxRiskPerTrade = options.maxRiskPerTrade || 0.02;  // 2% max risk per trade
    this.maxPositionPercent = options.maxPositionPercent || 0.10;  // 10% max of equity per position
    this.minPositionPercent = options.minPositionPercent || 0.005;  // 0.5% min position
    
    // Kelly Criterion settings
    this.kellyFraction = options.kellyFraction || 0.25;  // Use 25% of Kelly (conservative)
    
    // Volatility adjustment settings
    this.baseVolatility = options.baseVolatility || 2.0;  // 2% daily volatility as baseline
    this.maxVolatilityMultiplier = options.maxVolatilityMultiplier || 2.0;
    this.minVolatilityMultiplier = options.minVolatilityMultiplier || 0.5;
    
    // Win rate thresholds
    this.minWinRateForBoost = options.minWinRateForBoost || 0.55;  // 55% win rate to start boosting
    this.maxWinRateBoost = options.maxWinRateBoost || 1.5;  // Max 50% boost for high win rate
    
    // Minimum trades for statistical significance
    this.minTradesForStats = options.minTradesForStats || 20;
    
    // Cache for performance metrics
    this.performanceCache = new Map();
    this.cacheExpiry = 5 * 60 * 1000;  // 5 minutes
  }

  /**
   * Calculate optimal position size
   * @param {Object} params - Sizing parameters
   * @returns {Object} Position sizing recommendation
   */
  calculatePositionSize(params) {
    const {
      baseOrderSize,      // Default order size from bot config
      currentPrice,       // Current asset price
      availableEquity,    // Total available equity in USD
      winRate,            // Historical win rate (0-1)
      avgWin,             // Average winning trade amount
      avgLoss,            // Average losing trade amount
      totalTrades,        // Total number of trades
      volatility,         // Current volatility info from VolatilityGridManager
      gridSpacing,        // Current grid spacing percentage
    } = params;

    // Start with base order size
    let adjustedSize = baseOrderSize;
    const adjustments = [];

    // 1. Equity-based scaling
    const equityBasedSize = this.calculateEquityBasedSize(availableEquity, currentPrice);
    if (equityBasedSize < adjustedSize) {
      adjustedSize = equityBasedSize;
      adjustments.push({
        factor: 'equity_limit',
        adjustment: equityBasedSize / baseOrderSize,
        reason: `Capped to ${(this.maxPositionPercent * 100).toFixed(1)}% of equity`
      });
    }

    // 2. Win rate adjustment (only if statistically significant)
    if (totalTrades >= this.minTradesForStats && winRate > 0) {
      // Database stores win_rate as percentage (0-100), convert to decimal (0-1)
      const winRateDecimal = winRate > 1 ? winRate / 100 : winRate;
      const winRateMultiplier = this.calculateWinRateMultiplier(winRateDecimal, avgWin, avgLoss);
      const winRateAdjusted = adjustedSize * winRateMultiplier;
      
      if (winRateMultiplier !== 1.0) {
        adjustedSize = winRateAdjusted;
        adjustments.push({
          factor: 'win_rate',
          adjustment: winRateMultiplier,
          reason: `Win rate ${(winRateDecimal * 100).toFixed(1)}% → ${winRateMultiplier.toFixed(2)}x`
        });
      }
    }

    // 3. Volatility adjustment
    if (volatility && volatility.atrPercent) {
      const volMultiplier = this.calculateVolatilityMultiplier(volatility.atrPercent);
      const volAdjusted = adjustedSize * volMultiplier;
      
      if (volMultiplier !== 1.0) {
        adjustedSize = volAdjusted;
        adjustments.push({
          factor: 'volatility',
          adjustment: volMultiplier,
          reason: `${volatility.regime} volatility (${volatility.atrPercent.toFixed(2)}%) → ${volMultiplier.toFixed(2)}x`
        });
      }
    }

    // 4. Risk-based cap
    const maxRiskSize = this.calculateMaxRiskSize(availableEquity, currentPrice, gridSpacing);
    if (adjustedSize > maxRiskSize) {
      adjustments.push({
        factor: 'risk_cap',
        adjustment: maxRiskSize / adjustedSize,
        reason: `Risk capped to ${(this.maxRiskPerTrade * 100).toFixed(1)}% per trade`
      });
      adjustedSize = maxRiskSize;
    }

    // 5. Apply minimum position size
    const minSize = this.calculateMinSize(availableEquity, currentPrice);
    if (adjustedSize < minSize) {
      adjustedSize = minSize;
      adjustments.push({
        factor: 'min_size',
        adjustment: minSize / baseOrderSize,
        reason: `Minimum position size applied`
      });
    }

    // Round to appropriate precision
    adjustedSize = this.roundToExchangePrecision(adjustedSize, currentPrice);

    return {
      baseSize: baseOrderSize,
      adjustedSize,
      sizeChange: ((adjustedSize - baseOrderSize) / baseOrderSize * 100).toFixed(1),
      adjustments,
      metrics: {
        winRate,
        totalTrades,
        volatility: volatility?.regime || 'unknown',
        equityUsed: (adjustedSize * currentPrice / availableEquity * 100).toFixed(2) + '%'
      }
    };
  }

  /**
   * Calculate equity-based maximum size
   */
  calculateEquityBasedSize(equity, price) {
    const maxValue = equity * this.maxPositionPercent;
    return maxValue / price;
  }

  /**
   * Calculate minimum position size
   */
  calculateMinSize(equity, price) {
    const minValue = equity * this.minPositionPercent;
    return minValue / price;
  }

  /**
   * Calculate win rate multiplier using modified Kelly Criterion
   */
  calculateWinRateMultiplier(winRate, avgWin, avgLoss) {
    // If we don't have avg win/loss, use simplified approach
    if (!avgWin || !avgLoss || avgLoss === 0) {
      // Simple linear scaling based on win rate
      if (winRate < this.minWinRateForBoost) {
        // Below threshold - reduce size
        return 0.8 + (winRate / this.minWinRateForBoost) * 0.2;
      } else {
        // Above threshold - increase size (up to maxWinRateBoost)
        const boost = (winRate - this.minWinRateForBoost) / (1 - this.minWinRateForBoost);
        return 1.0 + boost * (this.maxWinRateBoost - 1.0);
      }
    }

    // Full Kelly Criterion: f* = (p * b - q) / b
    // Where: p = win probability, q = loss probability, b = win/loss ratio
    const p = winRate;
    const q = 1 - winRate;
    const b = avgWin / avgLoss;
    
    const kellyPercent = (p * b - q) / b;
    
    // Apply Kelly fraction (conservative)
    const adjustedKelly = kellyPercent * this.kellyFraction;
    
    // Convert to multiplier (1.0 = no change)
    // Kelly of 0.25 (25%) would mean 1.25x multiplier
    let multiplier = 1.0 + adjustedKelly;
    
    // Clamp to reasonable bounds
    multiplier = Math.max(0.5, Math.min(this.maxWinRateBoost, multiplier));
    
    return multiplier;
  }

  /**
   * Calculate volatility-based multiplier
   * Higher volatility = smaller positions
   */
  calculateVolatilityMultiplier(atrPercent) {
    // Ratio of base volatility to current volatility
    const ratio = this.baseVolatility / atrPercent;
    
    // Clamp to bounds
    let multiplier = Math.max(
      this.minVolatilityMultiplier,
      Math.min(this.maxVolatilityMultiplier, ratio)
    );
    
    return multiplier;
  }

  /**
   * Calculate maximum size based on risk per trade
   */
  calculateMaxRiskSize(equity, price, gridSpacingPercent) {
    // Risk amount = position value * potential loss percentage
    // Potential loss ≈ grid spacing (worst case: price moves one grid level against us)
    const potentialLossPercent = gridSpacingPercent || 0.01;  // Default 1%
    
    const maxRiskAmount = equity * this.maxRiskPerTrade;
    const maxPositionValue = maxRiskAmount / potentialLossPercent;
    
    return maxPositionValue / price;
  }

  /**
   * Round size to exchange precision
   */
  roundToExchangePrecision(size, price) {
    // Different precision based on asset value
    if (price > 10000) {
      // BTC-like: 5 decimal places
      return Math.round(size * 100000) / 100000;
    } else if (price > 100) {
      // ETH-like: 4 decimal places
      return Math.round(size * 10000) / 10000;
    } else {
      // SOL-like: 2 decimal places
      return Math.round(size * 100) / 100;
    }
  }

  /**
   * Get performance metrics from database
   */
  getPerformanceMetrics(db, botName) {
    // Check cache first
    const cached = this.performanceCache.get(botName);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.metrics;
    }

    try {
      // Get bot metrics from database
      const metrics = db.getBotMetrics(botName);
      
      if (!metrics) {
        return null;
      }

      const result = {
        winRate: metrics.win_rate || 0,
        totalTrades: metrics.total_trades || 0,
        avgWin: metrics.avg_win || 0,
        avgLoss: metrics.avg_loss || 0,
        profitFactor: metrics.profit_factor || 1,
      };

      // Cache the result
      this.performanceCache.set(botName, {
        timestamp: Date.now(),
        metrics: result
      });

      return result;
    } catch (error) {
      console.error(`Error getting performance metrics: ${error.message}`);
      return null;
    }
  }

  /**
   * Get sizing recommendation for a bot
   */
  async getSizingRecommendation(params) {
    const {
      db,
      exchange,
      botName,
      symbol,
      baseOrderSize,
      volatility,
      gridSpacing,
    } = params;

    try {
      // Get current price
      const ticker = await exchange.fetchTicker(symbol);
      const currentPrice = ticker.last;

      // Get account balance
      const balance = await exchange.fetchBalance();
      const usdBalance = balance.total?.USD || balance.total?.USDT || 0;
      
      // Get asset balance
      const baseAsset = symbol.split('/')[0];
      const assetBalance = balance.total?.[baseAsset] || 0;
      
      // Calculate total equity in USD
      const availableEquity = usdBalance + (assetBalance * currentPrice);

      // Get performance metrics
      const perfMetrics = this.getPerformanceMetrics(db, botName);

      // Calculate position size
      const sizing = this.calculatePositionSize({
        baseOrderSize,
        currentPrice,
        availableEquity,
        winRate: perfMetrics?.winRate || 0.5,
        avgWin: perfMetrics?.avgWin || 0,
        avgLoss: perfMetrics?.avgLoss || 0,
        totalTrades: perfMetrics?.totalTrades || 0,
        volatility,
        gridSpacing,
      });

      return {
        ...sizing,
        currentPrice,
        availableEquity,
        symbol,
        botName,
      };

    } catch (error) {
      console.error(`Error calculating position size: ${error.message}`);
      return {
        baseSize: baseOrderSize,
        adjustedSize: baseOrderSize,
        sizeChange: '0.0',
        adjustments: [{
          factor: 'error',
          adjustment: 1.0,
          reason: `Error: ${error.message}`
        }],
        error: error.message
      };
    }
  }

  /**
   * Clear performance cache
   */
  clearCache() {
    this.performanceCache.clear();
  }
}

export default PositionSizer;
