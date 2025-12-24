#!/usr/bin/env node

/**
 * Backtesting Engine
 * Version: 1.0.0
 * 
 * Simulates grid bot trading on historical data to validate strategies.
 * Supports multiple configuration parameters and generates detailed reports.
 */

import { candlesToPriceSeries } from './historical-data.mjs';

/**
 * Default grid bot configuration
 */
const DEFAULT_CONFIG = {
  // Grid parameters
  lowerPrice: null,  // Will be calculated from data if not provided
  upperPrice: null,
  gridLevels: 20,
  orderSize: 100,  // USD per order
  
  // Trading fees
  makerFee: 0.001,  // 0.1%
  takerFee: 0.001,  // 0.1%
  
  // Risk management
  stopLossPercent: null,  // Optional stop loss
  takeProfitPercent: null,  // Optional take profit
  
  // Initial capital
  initialCapital: 10000,  // USD
  
  // Slippage simulation
  slippagePercent: 0.0005,  // 0.05% average slippage
  
  // Features to test
  useVolatilityGrid: false,
  useTrendFilter: false,
  useMomentumFilter: false,
};

/**
 * Order types
 */
const ORDER_TYPE = {
  BUY: 'buy',
  SELL: 'sell'
};

/**
 * Trade result
 */
class Trade {
  constructor(type, price, amount, value, timestamp, fee) {
    this.type = type;
    this.price = price;
    this.amount = amount;
    this.value = value;
    this.timestamp = timestamp;
    this.fee = fee;
    this.date = new Date(timestamp).toISOString();
  }
}

/**
 * Grid Level
 */
class GridLevel {
  constructor(price, type, amount) {
    this.price = price;
    this.type = type;  // 'buy' or 'sell'
    this.amount = amount;
    this.filled = false;
    this.fillPrice = null;
    this.fillTimestamp = null;
  }
}

/**
 * Backtesting Engine Class
 */
export class BacktestEngine {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.reset();
  }

  /**
   * Reset engine state
   */
  reset() {
    this.usdBalance = this.config.initialCapital;
    this.cryptoBalance = 0;
    this.trades = [];
    this.gridLevels = [];
    this.equity = [];
    this.drawdowns = [];
    this.peakEquity = this.config.initialCapital;
    this.maxDrawdown = 0;
    this.currentPrice = 0;
    this.startTime = null;
    this.endTime = null;
  }

  /**
   * Initialize grid levels
   */
  initializeGrid(lowerPrice, upperPrice) {
    this.gridLevels = [];
    
    const gridSpacing = (upperPrice - lowerPrice) / this.config.gridLevels;
    
    for (let i = 0; i <= this.config.gridLevels; i++) {
      const price = lowerPrice + (i * gridSpacing);
      const amount = this.config.orderSize / price;
      
      // Below current price = buy orders, above = sell orders
      // Initially set all as buy orders, will be adjusted based on starting price
      this.gridLevels.push(new GridLevel(price, ORDER_TYPE.BUY, amount));
    }
    
    return this.gridLevels;
  }

  /**
   * Adjust grid based on current price
   */
  adjustGridForPrice(currentPrice) {
    for (const level of this.gridLevels) {
      if (level.price < currentPrice) {
        level.type = ORDER_TYPE.BUY;
      } else {
        level.type = ORDER_TYPE.SELL;
      }
    }
  }

  /**
   * Calculate initial position
   * Allocate capital across grid levels below current price
   */
  calculateInitialPosition(currentPrice) {
    const buyLevels = this.gridLevels.filter(l => l.price < currentPrice);
    const sellLevels = this.gridLevels.filter(l => l.price >= currentPrice);
    
    // Allocate half capital to crypto (for sell orders)
    const cryptoCapital = this.config.initialCapital * 0.5;
    const usdCapital = this.config.initialCapital * 0.5;
    
    // Buy crypto at current price for sell orders
    const cryptoAmount = cryptoCapital / currentPrice;
    this.cryptoBalance = cryptoAmount;
    this.usdBalance = usdCapital;
    
    // Set sell order amounts
    const amountPerSellLevel = sellLevels.length > 0 ? cryptoAmount / sellLevels.length : 0;
    for (const level of sellLevels) {
      level.amount = amountPerSellLevel;
    }
    
    // Set buy order amounts
    const amountPerBuyLevel = buyLevels.length > 0 ? usdCapital / buyLevels.length : 0;
    for (const level of buyLevels) {
      level.amount = amountPerBuyLevel / level.price;
    }
  }

  /**
   * Process a price tick
   */
  processTick(timestamp, price, high, low) {
    this.currentPrice = price;
    
    // Check each grid level for fills
    for (const level of this.gridLevels) {
      if (level.filled) continue;
      
      // Check if price crossed this level
      if (level.type === ORDER_TYPE.BUY && low <= level.price) {
        this.executeBuy(level, timestamp);
      } else if (level.type === ORDER_TYPE.SELL && high >= level.price) {
        this.executeSell(level, timestamp);
      }
    }
    
    // Record equity
    const currentEquity = this.calculateEquity(price);
    this.equity.push({
      timestamp,
      date: new Date(timestamp).toISOString(),
      price,
      usdBalance: this.usdBalance,
      cryptoBalance: this.cryptoBalance,
      equity: currentEquity
    });
    
    // Track drawdown
    if (currentEquity > this.peakEquity) {
      this.peakEquity = currentEquity;
    }
    const drawdown = (this.peakEquity - currentEquity) / this.peakEquity;
    if (drawdown > this.maxDrawdown) {
      this.maxDrawdown = drawdown;
    }
    this.drawdowns.push({ timestamp, drawdown });
  }

  /**
   * Execute a buy order
   */
  executeBuy(level, timestamp) {
    const fillPrice = level.price * (1 + this.config.slippagePercent);
    const value = level.amount * fillPrice;
    const fee = value * this.config.takerFee;
    
    // Check if we have enough USD
    if (this.usdBalance < value + fee) {
      return false;
    }
    
    // Execute trade
    this.usdBalance -= (value + fee);
    this.cryptoBalance += level.amount;
    
    // Record trade
    const trade = new Trade(ORDER_TYPE.BUY, fillPrice, level.amount, value, timestamp, fee);
    this.trades.push(trade);
    
    // Mark level as filled and flip to sell
    level.filled = true;
    level.fillPrice = fillPrice;
    level.fillTimestamp = timestamp;
    
    // Create corresponding sell order at next grid level up
    this.createSellOrder(level);
    
    return true;
  }

  /**
   * Execute a sell order
   */
  executeSell(level, timestamp) {
    const fillPrice = level.price * (1 - this.config.slippagePercent);
    const value = level.amount * fillPrice;
    const fee = value * this.config.takerFee;
    
    // Check if we have enough crypto
    if (this.cryptoBalance < level.amount) {
      return false;
    }
    
    // Execute trade
    this.cryptoBalance -= level.amount;
    this.usdBalance += (value - fee);
    
    // Record trade
    const trade = new Trade(ORDER_TYPE.SELL, fillPrice, level.amount, value, timestamp, fee);
    this.trades.push(trade);
    
    // Mark level as filled and flip to buy
    level.filled = true;
    level.fillPrice = fillPrice;
    level.fillTimestamp = timestamp;
    
    // Create corresponding buy order at next grid level down
    this.createBuyOrder(level);
    
    return true;
  }

  /**
   * Create a sell order after a buy fill
   */
  createSellOrder(buyLevel) {
    // Find next grid level up
    const sortedLevels = [...this.gridLevels].sort((a, b) => a.price - b.price);
    const currentIndex = sortedLevels.findIndex(l => l.price === buyLevel.price);
    
    if (currentIndex < sortedLevels.length - 1) {
      const nextLevel = sortedLevels[currentIndex + 1];
      if (nextLevel.filled) {
        // Reset the level for a new sell order
        nextLevel.filled = false;
        nextLevel.type = ORDER_TYPE.SELL;
        nextLevel.amount = buyLevel.amount;
      }
    }
  }

  /**
   * Create a buy order after a sell fill
   */
  createBuyOrder(sellLevel) {
    // Find next grid level down
    const sortedLevels = [...this.gridLevels].sort((a, b) => a.price - b.price);
    const currentIndex = sortedLevels.findIndex(l => l.price === sellLevel.price);
    
    if (currentIndex > 0) {
      const prevLevel = sortedLevels[currentIndex - 1];
      if (prevLevel.filled) {
        // Reset the level for a new buy order
        prevLevel.filled = false;
        prevLevel.type = ORDER_TYPE.BUY;
        prevLevel.amount = sellLevel.amount;
      }
    }
  }

  /**
   * Calculate current equity
   */
  calculateEquity(price) {
    return this.usdBalance + (this.cryptoBalance * price);
  }

  /**
   * Run backtest on historical data
   */
  async run(historicalData) {
    this.reset();
    
    const candles = historicalData.candles;
    if (!candles || candles.length === 0) {
      throw new Error('No historical data provided');
    }
    
    // Calculate grid bounds if not provided
    const prices = candles.map(c => c.close);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    
    const lowerPrice = this.config.lowerPrice || minPrice * 0.95;
    const upperPrice = this.config.upperPrice || maxPrice * 1.05;
    
    console.log(`\n📊 Backtest Configuration:`);
    console.log(`   Symbol: ${historicalData.symbol}`);
    console.log(`   Period: ${historicalData.startDate} to ${historicalData.endDate}`);
    console.log(`   Candles: ${candles.length}`);
    console.log(`   Price Range: $${minPrice.toFixed(2)} - $${maxPrice.toFixed(2)}`);
    console.log(`   Grid Range: $${lowerPrice.toFixed(2)} - $${upperPrice.toFixed(2)}`);
    console.log(`   Grid Levels: ${this.config.gridLevels}`);
    console.log(`   Order Size: $${this.config.orderSize}`);
    console.log(`   Initial Capital: $${this.config.initialCapital}`);
    
    // Initialize grid
    this.initializeGrid(lowerPrice, upperPrice);
    
    // Set initial price and adjust grid
    const startPrice = candles[0].close;
    this.adjustGridForPrice(startPrice);
    this.calculateInitialPosition(startPrice);
    
    this.startTime = candles[0].timestamp;
    this.endTime = candles[candles.length - 1].timestamp;
    
    console.log(`\n🚀 Running backtest...`);
    
    // Process each candle
    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];
      this.processTick(candle.timestamp, candle.close, candle.high, candle.low);
      
      // Progress indicator
      if (i % 1000 === 0) {
        const progress = ((i / candles.length) * 100).toFixed(1);
        process.stdout.write(`\r   Progress: ${progress}%`);
      }
    }
    
    console.log(`\r   Progress: 100%    `);
    console.log(`✅ Backtest complete\n`);
    
    return this.generateReport();
  }

  /**
   * Generate backtest report
   */
  generateReport() {
    const startEquity = this.config.initialCapital;
    const endEquity = this.calculateEquity(this.currentPrice);
    const totalReturn = ((endEquity - startEquity) / startEquity) * 100;
    
    // Calculate trade statistics
    const buyTrades = this.trades.filter(t => t.type === ORDER_TYPE.BUY);
    const sellTrades = this.trades.filter(t => t.type === ORDER_TYPE.SELL);
    const totalFees = this.trades.reduce((sum, t) => sum + t.fee, 0);
    
    // Calculate profit from completed round trips
    let realizedProfit = 0;
    let roundTrips = 0;
    
    // Match buys with sells
    const buyQueue = [...buyTrades];
    for (const sell of sellTrades) {
      if (buyQueue.length > 0) {
        const buy = buyQueue.shift();
        const profit = (sell.price - buy.price) * Math.min(buy.amount, sell.amount);
        realizedProfit += profit;
        roundTrips++;
      }
    }
    
    // Calculate Sharpe ratio (simplified)
    const returns = [];
    for (let i = 1; i < this.equity.length; i++) {
      const dailyReturn = (this.equity[i].equity - this.equity[i-1].equity) / this.equity[i-1].equity;
      returns.push(dailyReturn);
    }
    
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdDev = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length);
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(365 * 24) : 0;  // Annualized
    
    // Calculate win rate
    const profitableTrades = sellTrades.filter((sell, i) => {
      const buy = buyTrades[i];
      return buy && sell.price > buy.price;
    });
    const winRate = sellTrades.length > 0 ? (profitableTrades.length / sellTrades.length) * 100 : 0;
    
    // Duration
    const durationMs = this.endTime - this.startTime;
    const durationDays = durationMs / (1000 * 60 * 60 * 24);
    
    // Annualized return
    const annualizedReturn = (Math.pow(endEquity / startEquity, 365 / durationDays) - 1) * 100;
    
    const report = {
      summary: {
        symbol: this.config.symbol || 'Unknown',
        startDate: new Date(this.startTime).toISOString().split('T')[0],
        endDate: new Date(this.endTime).toISOString().split('T')[0],
        durationDays: Math.round(durationDays),
        initialCapital: startEquity,
        finalEquity: endEquity,
        totalReturn: totalReturn,
        annualizedReturn: annualizedReturn,
        maxDrawdown: this.maxDrawdown * 100,
        sharpeRatio: sharpeRatio
      },
      trades: {
        totalTrades: this.trades.length,
        buyTrades: buyTrades.length,
        sellTrades: sellTrades.length,
        roundTrips: roundTrips,
        winRate: winRate,
        realizedProfit: realizedProfit,
        totalFees: totalFees
      },
      positions: {
        finalUsdBalance: this.usdBalance,
        finalCryptoBalance: this.cryptoBalance,
        finalCryptoValue: this.cryptoBalance * this.currentPrice
      },
      config: this.config,
      equityCurve: this.equity,
      drawdownCurve: this.drawdowns,
      allTrades: this.trades
    };
    
    return report;
  }

  /**
   * Print report to console
   */
  printReport(report) {
    console.log('═'.repeat(60));
    console.log('                    BACKTEST REPORT');
    console.log('═'.repeat(60));
    
    console.log('\n📈 PERFORMANCE SUMMARY');
    console.log('─'.repeat(40));
    console.log(`   Period: ${report.summary.startDate} to ${report.summary.endDate} (${report.summary.durationDays} days)`);
    console.log(`   Initial Capital: $${report.summary.initialCapital.toLocaleString()}`);
    console.log(`   Final Equity: $${report.summary.finalEquity.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    console.log(`   Total Return: ${report.summary.totalReturn >= 0 ? '+' : ''}${report.summary.totalReturn.toFixed(2)}%`);
    console.log(`   Annualized Return: ${report.summary.annualizedReturn >= 0 ? '+' : ''}${report.summary.annualizedReturn.toFixed(2)}%`);
    console.log(`   Max Drawdown: -${report.summary.maxDrawdown.toFixed(2)}%`);
    console.log(`   Sharpe Ratio: ${report.summary.sharpeRatio.toFixed(2)}`);
    
    console.log('\n📊 TRADE STATISTICS');
    console.log('─'.repeat(40));
    console.log(`   Total Trades: ${report.trades.totalTrades}`);
    console.log(`   Buy Orders: ${report.trades.buyTrades}`);
    console.log(`   Sell Orders: ${report.trades.sellTrades}`);
    console.log(`   Round Trips: ${report.trades.roundTrips}`);
    console.log(`   Win Rate: ${report.trades.winRate.toFixed(1)}%`);
    console.log(`   Realized Profit: $${report.trades.realizedProfit.toFixed(2)}`);
    console.log(`   Total Fees: $${report.trades.totalFees.toFixed(2)}`);
    
    console.log('\n💰 FINAL POSITIONS');
    console.log('─'.repeat(40));
    console.log(`   USD Balance: $${report.positions.finalUsdBalance.toFixed(2)}`);
    console.log(`   Crypto Balance: ${report.positions.finalCryptoBalance.toFixed(6)}`);
    console.log(`   Crypto Value: $${report.positions.finalCryptoValue.toFixed(2)}`);
    
    console.log('\n' + '═'.repeat(60));
  }
}

/**
 * Compare multiple backtest configurations
 */
export async function compareConfigurations(historicalData, configurations) {
  const results = [];
  
  for (const config of configurations) {
    console.log(`\n🔄 Testing configuration: ${config.name || 'Unnamed'}`);
    const engine = new BacktestEngine(config);
    const report = await engine.run(historicalData);
    results.push({
      name: config.name || 'Unnamed',
      config,
      report
    });
  }
  
  // Print comparison
  console.log('\n' + '═'.repeat(80));
  console.log('                         CONFIGURATION COMPARISON');
  console.log('═'.repeat(80));
  
  console.log('\n' + '─'.repeat(80));
  console.log(
    'Config'.padEnd(20) +
    'Return'.padStart(12) +
    'Ann. Return'.padStart(14) +
    'Max DD'.padStart(10) +
    'Sharpe'.padStart(10) +
    'Trades'.padStart(10)
  );
  console.log('─'.repeat(80));
  
  for (const result of results) {
    const r = result.report.summary;
    const t = result.report.trades;
    console.log(
      result.name.substring(0, 18).padEnd(20) +
      `${r.totalReturn >= 0 ? '+' : ''}${r.totalReturn.toFixed(1)}%`.padStart(12) +
      `${r.annualizedReturn >= 0 ? '+' : ''}${r.annualizedReturn.toFixed(1)}%`.padStart(14) +
      `-${r.maxDrawdown.toFixed(1)}%`.padStart(10) +
      r.sharpeRatio.toFixed(2).padStart(10) +
      t.totalTrades.toString().padStart(10)
    );
  }
  
  console.log('─'.repeat(80));
  
  // Find best configuration
  const best = results.reduce((best, current) => 
    current.report.summary.sharpeRatio > best.report.summary.sharpeRatio ? current : best
  );
  
  console.log(`\n🏆 Best Configuration (by Sharpe): ${best.name}`);
  
  return results;
}

export default BacktestEngine;
