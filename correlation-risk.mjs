/**
 * Correlation-Based Risk Manager
 * Version: 1.0.0
 * 
 * Monitors correlation between assets and adjusts exposure when
 * assets move together (high correlation = higher portfolio risk).
 * 
 * When BTC, ETH, and SOL all move in the same direction:
 * - Reduces position sizes to limit correlated exposure
 * - Prevents over-concentration during market-wide moves
 * 
 * When assets diverge (low correlation):
 * - Allows normal or increased position sizes
 * - Takes advantage of diversification benefits
 */

export class CorrelationRiskManager {
  constructor(options = {}) {
    // Correlation thresholds
    this.highCorrelationThreshold = options.highCorrelationThreshold || 0.8;
    this.lowCorrelationThreshold = options.lowCorrelationThreshold || 0.3;
    
    // Position adjustment factors
    this.highCorrelationReduction = options.highCorrelationReduction || 0.7;  // Reduce to 70%
    this.lowCorrelationBoost = options.lowCorrelationBoost || 1.1;  // Boost to 110%
    
    // Lookback period for correlation calculation (in data points)
    this.lookbackPeriod = options.lookbackPeriod || 24;  // 24 hours of hourly data
    
    // Price history storage
    this.priceHistory = new Map();
    
    // Maximum history to keep
    this.maxHistory = options.maxHistory || 168;  // 1 week of hourly data
    
    // Symbols to track
    this.symbols = options.symbols || ['BTC/USD', 'ETH/USD', 'SOL/USD'];
    
    // Current correlation matrix
    this.correlationMatrix = null;
    this.lastCalculation = 0;
    this.calculationInterval = options.calculationInterval || 60 * 60 * 1000;  // 1 hour
  }

  /**
   * Record a price update
   * @param {string} symbol - Trading symbol
   * @param {number} price - Current price
   */
  recordPrice(symbol, price) {
    if (!this.priceHistory.has(symbol)) {
      this.priceHistory.set(symbol, []);
    }
    
    const history = this.priceHistory.get(symbol);
    history.push({
      price,
      timestamp: Date.now(),
    });
    
    // Trim to max history
    while (history.length > this.maxHistory) {
      history.shift();
    }
  }

  /**
   * Calculate returns from price history
   * @param {string} symbol - Trading symbol
   * @returns {Array} Array of returns
   */
  calculateReturns(symbol) {
    const history = this.priceHistory.get(symbol);
    if (!history || history.length < 2) {
      return [];
    }
    
    const returns = [];
    for (let i = 1; i < history.length; i++) {
      const ret = (history[i].price - history[i-1].price) / history[i-1].price;
      returns.push(ret);
    }
    
    return returns;
  }

  /**
   * Calculate correlation between two return series
   * @param {Array} returns1 - First return series
   * @param {Array} returns2 - Second return series
   * @returns {number} Correlation coefficient (-1 to 1)
   */
  calculateCorrelation(returns1, returns2) {
    const n = Math.min(returns1.length, returns2.length, this.lookbackPeriod);
    
    if (n < 5) {
      return 0;  // Not enough data
    }
    
    // Use most recent data
    const r1 = returns1.slice(-n);
    const r2 = returns2.slice(-n);
    
    // Calculate means
    const mean1 = r1.reduce((a, b) => a + b, 0) / n;
    const mean2 = r2.reduce((a, b) => a + b, 0) / n;
    
    // Calculate correlation
    let numerator = 0;
    let denom1 = 0;
    let denom2 = 0;
    
    for (let i = 0; i < n; i++) {
      const diff1 = r1[i] - mean1;
      const diff2 = r2[i] - mean2;
      numerator += diff1 * diff2;
      denom1 += diff1 * diff1;
      denom2 += diff2 * diff2;
    }
    
    const denominator = Math.sqrt(denom1 * denom2);
    
    if (denominator === 0) {
      return 0;
    }
    
    return numerator / denominator;
  }

  /**
   * Calculate full correlation matrix
   * @returns {Object} Correlation matrix and statistics
   */
  calculateCorrelationMatrix() {
    const matrix = {};
    const correlations = [];
    
    for (let i = 0; i < this.symbols.length; i++) {
      const symbol1 = this.symbols[i];
      matrix[symbol1] = {};
      
      const returns1 = this.calculateReturns(symbol1);
      
      for (let j = 0; j < this.symbols.length; j++) {
        const symbol2 = this.symbols[j];
        
        if (i === j) {
          matrix[symbol1][symbol2] = 1.0;
        } else if (j > i) {
          const returns2 = this.calculateReturns(symbol2);
          const corr = this.calculateCorrelation(returns1, returns2);
          matrix[symbol1][symbol2] = corr;
          correlations.push(corr);
        } else {
          // Mirror the upper triangle
          matrix[symbol1][symbol2] = matrix[symbol2][symbol1];
        }
      }
    }
    
    // Calculate average correlation
    const avgCorrelation = correlations.length > 0
      ? correlations.reduce((a, b) => a + b, 0) / correlations.length
      : 0;
    
    this.correlationMatrix = {
      matrix,
      averageCorrelation: avgCorrelation,
      maxCorrelation: correlations.length > 0 ? Math.max(...correlations) : 0,
      minCorrelation: correlations.length > 0 ? Math.min(...correlations) : 0,
      timestamp: Date.now(),
    };
    
    this.lastCalculation = Date.now();
    
    return this.correlationMatrix;
  }

  /**
   * Get current correlation status
   * @returns {Object} Correlation status and recommendations
   */
  getCorrelationStatus() {
    // Recalculate if stale
    if (Date.now() - this.lastCalculation > this.calculationInterval) {
      this.calculateCorrelationMatrix();
    }
    
    if (!this.correlationMatrix) {
      return {
        status: 'insufficient_data',
        avgCorrelation: 0,
        positionMultiplier: 1.0,
        recommendation: 'Not enough price history - using default parameters',
      };
    }
    
    const avgCorr = this.correlationMatrix.averageCorrelation;
    
    let status, positionMultiplier, recommendation;
    
    if (avgCorr >= this.highCorrelationThreshold) {
      status = 'high_correlation';
      positionMultiplier = this.highCorrelationReduction;
      recommendation = `High correlation (${(avgCorr * 100).toFixed(0)}%) - reducing position sizes to ${(positionMultiplier * 100).toFixed(0)}%`;
    } else if (avgCorr <= this.lowCorrelationThreshold) {
      status = 'low_correlation';
      positionMultiplier = this.lowCorrelationBoost;
      recommendation = `Low correlation (${(avgCorr * 100).toFixed(0)}%) - diversification benefit, normal/boosted sizes`;
    } else {
      status = 'moderate_correlation';
      // Linear interpolation between thresholds
      const range = this.highCorrelationThreshold - this.lowCorrelationThreshold;
      const position = (avgCorr - this.lowCorrelationThreshold) / range;
      positionMultiplier = this.lowCorrelationBoost - (position * (this.lowCorrelationBoost - this.highCorrelationReduction));
      recommendation = `Moderate correlation (${(avgCorr * 100).toFixed(0)}%) - standard parameters`;
    }
    
    return {
      status,
      avgCorrelation: avgCorr,
      maxCorrelation: this.correlationMatrix.maxCorrelation,
      minCorrelation: this.correlationMatrix.minCorrelation,
      positionMultiplier,
      recommendation,
      matrix: this.correlationMatrix.matrix,
      lastUpdate: new Date(this.correlationMatrix.timestamp).toISOString(),
    };
  }

  /**
   * Get position size adjustment for a specific symbol
   * @param {string} symbol - Trading symbol
   * @returns {Object} Position adjustment recommendation
   */
  getPositionAdjustment(symbol) {
    const status = this.getCorrelationStatus();
    
    if (status.status === 'insufficient_data') {
      return {
        multiplier: 1.0,
        reason: 'Insufficient correlation data',
        correlationStatus: status.status,
      };
    }
    
    // Get specific correlations for this symbol
    let symbolCorrelations = [];
    if (this.correlationMatrix && this.correlationMatrix.matrix[symbol]) {
      for (const [otherSymbol, corr] of Object.entries(this.correlationMatrix.matrix[symbol])) {
        if (otherSymbol !== symbol) {
          symbolCorrelations.push({ symbol: otherSymbol, correlation: corr });
        }
      }
    }
    
    return {
      multiplier: status.positionMultiplier,
      reason: status.recommendation,
      correlationStatus: status.status,
      avgCorrelation: status.avgCorrelation,
      symbolCorrelations,
    };
  }

  /**
   * Check if portfolio is at elevated risk due to correlation
   * @returns {boolean}
   */
  isElevatedRisk() {
    const status = this.getCorrelationStatus();
    return status.status === 'high_correlation';
  }

  /**
   * Get recent price movement direction for all symbols
   * @returns {Object} Movement analysis
   */
  getMovementAnalysis() {
    const movements = {};
    let allUp = true;
    let allDown = true;
    
    for (const symbol of this.symbols) {
      const history = this.priceHistory.get(symbol);
      if (!history || history.length < 2) {
        movements[symbol] = { direction: 'unknown', change: 0 };
        allUp = false;
        allDown = false;
        continue;
      }
      
      // Look at last few data points
      const recent = history.slice(-5);
      const firstPrice = recent[0].price;
      const lastPrice = recent[recent.length - 1].price;
      const change = (lastPrice - firstPrice) / firstPrice;
      
      let direction;
      if (change > 0.001) {
        direction = 'up';
        allDown = false;
      } else if (change < -0.001) {
        direction = 'down';
        allUp = false;
      } else {
        direction = 'flat';
        allUp = false;
        allDown = false;
      }
      
      movements[symbol] = { direction, change: change * 100 };
    }
    
    return {
      movements,
      allMovingSameDirection: allUp || allDown,
      direction: allUp ? 'up' : (allDown ? 'down' : 'mixed'),
      riskLevel: (allUp || allDown) ? 'elevated' : 'normal',
    };
  }

  /**
   * Get full risk analysis
   * @returns {Object} Complete correlation risk analysis
   */
  getAnalysis() {
    const correlationStatus = this.getCorrelationStatus();
    const movementAnalysis = this.getMovementAnalysis();
    
    // Combined risk assessment
    let overallRisk = 'normal';
    let overallMultiplier = correlationStatus.positionMultiplier;
    
    if (correlationStatus.status === 'high_correlation' && movementAnalysis.allMovingSameDirection) {
      overallRisk = 'high';
      overallMultiplier *= 0.8;  // Additional reduction
    } else if (correlationStatus.status === 'high_correlation' || movementAnalysis.allMovingSameDirection) {
      overallRisk = 'elevated';
    }
    
    return {
      correlation: correlationStatus,
      movement: movementAnalysis,
      overallRisk,
      overallMultiplier,
      dataPoints: this.symbols.map(s => ({
        symbol: s,
        historyLength: this.priceHistory.get(s)?.length || 0,
      })),
    };
  }

  /**
   * Clear all price history
   */
  clearHistory() {
    this.priceHistory.clear();
    this.correlationMatrix = null;
    this.lastCalculation = 0;
  }
}

export default CorrelationRiskManager;
