#!/usr/bin/env node

/**
 * Grid Trading Bot - Backtesting Module
 * 
 * Simulates grid trading strategy against historical data to:
 * - Validate strategy parameters before live deployment
 * - Optimize grid settings (spacing, range, order size)
 * - Estimate expected returns and risk metrics
 * - Compare different configurations
 */

import dotenv from 'dotenv';
import ccxt from 'ccxt';
import fs from 'fs';

dotenv.config({ path: '.env.production' });

// Backtesting configuration
const DEFAULT_CONFIG = {
  symbol: 'BTC/USD',
  startDate: null,  // Will default to 30 days ago
  endDate: null,    // Will default to now
  initialCapital: 1000,
  lowerPrice: null, // Will be calculated from data
  upperPrice: null, // Will be calculated from data
  gridCount: 10,
  orderSize: null,  // Will be calculated from capital
  makerFee: 0.001,  // 0.1%
  takerFee: 0.001,  // 0.1%
  slippage: 0.0005, // 0.05%
};

/**
 * Fetch historical OHLCV data
 */
async function fetchHistoricalData(symbol, startDate, endDate, timeframe = '1h') {
  const exchange = new ccxt.binanceus({
    enableRateLimit: true,
  });

  console.log(`📊 Fetching historical data for ${symbol}...`);
  console.log(`   Period: ${startDate.toISOString()} to ${endDate.toISOString()}`);
  console.log(`   Timeframe: ${timeframe}`);

  const allData = [];
  let since = startDate.getTime();
  const until = endDate.getTime();

  while (since < until) {
    try {
      const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, since, 1000);
      if (ohlcv.length === 0) break;

      for (const candle of ohlcv) {
        if (candle[0] <= until) {
          allData.push({
            timestamp: candle[0],
            open: candle[1],
            high: candle[2],
            low: candle[3],
            close: candle[4],
            volume: candle[5],
          });
        }
      }

      since = ohlcv[ohlcv.length - 1][0] + 1;
      
      // Rate limiting
      await new Promise(r => setTimeout(r, 100));
    } catch (e) {
      console.error(`Error fetching data: ${e.message}`);
      break;
    }
  }

  console.log(`   ✅ Fetched ${allData.length} candles`);
  return allData;
}

/**
 * Calculate grid levels
 */
function calculateGridLevels(lowerPrice, upperPrice, gridCount) {
  const levels = [];
  const spacing = (upperPrice - lowerPrice) / gridCount;

  for (let i = 0; i <= gridCount; i++) {
    levels.push(lowerPrice + (i * spacing));
  }

  return levels;
}

/**
 * Simulate grid trading
 */
function simulateGridTrading(data, config) {
  const {
    lowerPrice,
    upperPrice,
    gridCount,
    orderSize,
    initialCapital,
    makerFee,
    takerFee,
    slippage,
  } = config;

  // Initialize state
  const gridLevels = calculateGridLevels(lowerPrice, upperPrice, gridCount);
  let cashBalance = initialCapital;
  let assetBalance = 0;
  let totalFees = 0;
  const trades = [];
  const equityCurve = [];

  // Track orders at each grid level
  const gridOrders = new Map();
  
  // Initialize grid orders based on starting price
  const startPrice = data[0].close;
  for (const level of gridLevels) {
    if (level < startPrice) {
      // Place buy order below current price
      gridOrders.set(level, { side: 'buy', price: level, filled: false });
    } else if (level > startPrice) {
      // Place sell order above current price
      gridOrders.set(level, { side: 'sell', price: level, filled: false });
    }
  }

  // Process each candle
  for (let i = 0; i < data.length; i++) {
    const candle = data[i];
    const { high, low, close, timestamp } = candle;

    // Check each grid level for fills
    for (const [level, order] of gridOrders) {
      if (order.filled) continue;

      // Check if price crossed this level
      if (order.side === 'buy' && low <= level) {
        // Buy order filled
        const fillPrice = level * (1 + slippage);
        const cost = orderSize * fillPrice;
        const fee = cost * takerFee;

        if (cashBalance >= cost + fee) {
          cashBalance -= (cost + fee);
          assetBalance += orderSize;
          totalFees += fee;

          trades.push({
            timestamp,
            side: 'buy',
            price: fillPrice,
            amount: orderSize,
            fee,
            cashBalance,
            assetBalance,
          });

          // Mark as filled and create opposite order
          order.filled = true;
          
          // Find next level up for sell order
          const nextLevelUp = gridLevels.find(l => l > level && !gridOrders.has(l));
          if (nextLevelUp) {
            gridOrders.set(nextLevelUp, { side: 'sell', price: nextLevelUp, filled: false });
          }
        }
      } else if (order.side === 'sell' && high >= level && assetBalance >= orderSize) {
        // Sell order filled
        const fillPrice = level * (1 - slippage);
        const revenue = orderSize * fillPrice;
        const fee = revenue * takerFee;

        cashBalance += (revenue - fee);
        assetBalance -= orderSize;
        totalFees += fee;

        trades.push({
          timestamp,
          side: 'sell',
          price: fillPrice,
          amount: orderSize,
          fee,
          cashBalance,
          assetBalance,
        });

        // Mark as filled and create opposite order
        order.filled = true;
        
        // Find next level down for buy order
        const nextLevelDown = [...gridLevels].reverse().find(l => l < level && !gridOrders.has(l));
        if (nextLevelDown) {
          gridOrders.set(nextLevelDown, { side: 'buy', price: nextLevelDown, filled: false });
        }
      }
    }

    // Record equity at each candle
    const equity = cashBalance + (assetBalance * close);
    equityCurve.push({
      timestamp,
      price: close,
      cashBalance,
      assetBalance,
      equity,
    });
  }

  // Final calculations
  const finalPrice = data[data.length - 1].close;
  const finalEquity = cashBalance + (assetBalance * finalPrice);
  const totalReturn = (finalEquity - initialCapital) / initialCapital;
  
  // Calculate metrics
  const buyTrades = trades.filter(t => t.side === 'buy');
  const sellTrades = trades.filter(t => t.side === 'sell');
  
  // Calculate max drawdown
  let maxEquity = initialCapital;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    if (point.equity > maxEquity) {
      maxEquity = point.equity;
    }
    const drawdown = (maxEquity - point.equity) / maxEquity;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  // Calculate Sharpe ratio (simplified)
  const returns = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const ret = (equityCurve[i].equity - equityCurve[i - 1].equity) / equityCurve[i - 1].equity;
    returns.push(ret);
  }
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const stdReturn = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length);
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(365 * 24) : 0; // Annualized

  // Calculate win rate
  let completedCycles = 0;
  let profitableCycles = 0;
  for (let i = 0; i < sellTrades.length; i++) {
    const sell = sellTrades[i];
    const correspondingBuy = buyTrades.find(b => b.timestamp < sell.timestamp && b.price < sell.price);
    if (correspondingBuy) {
      completedCycles++;
      if (sell.price > correspondingBuy.price) {
        profitableCycles++;
      }
    }
  }
  const winRate = completedCycles > 0 ? profitableCycles / completedCycles : 0;

  return {
    config,
    summary: {
      initialCapital,
      finalEquity: parseFloat(finalEquity.toFixed(2)),
      totalReturn: parseFloat((totalReturn * 100).toFixed(2)),
      totalTrades: trades.length,
      buyTrades: buyTrades.length,
      sellTrades: sellTrades.length,
      completedCycles,
      winRate: parseFloat((winRate * 100).toFixed(2)),
      totalFees: parseFloat(totalFees.toFixed(2)),
      maxDrawdown: parseFloat((maxDrawdown * 100).toFixed(2)),
      sharpeRatio: parseFloat(sharpeRatio.toFixed(2)),
    },
    trades,
    equityCurve,
    gridLevels,
  };
}

/**
 * Run backtest with given configuration
 */
async function runBacktest(userConfig = {}) {
  const config = { ...DEFAULT_CONFIG, ...userConfig };

  // Set default dates if not provided
  if (!config.startDate) {
    config.startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
  }
  if (!config.endDate) {
    config.endDate = new Date();
  }

  // Fetch historical data
  const data = await fetchHistoricalData(config.symbol, config.startDate, config.endDate);

  if (data.length === 0) {
    console.error('❌ No historical data available');
    return null;
  }

  // Calculate price range if not provided
  const prices = data.map(d => d.close);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;

  if (!config.lowerPrice) {
    config.lowerPrice = minPrice * 0.95; // 5% below min
  }
  if (!config.upperPrice) {
    config.upperPrice = maxPrice * 1.05; // 5% above max
  }

  // Calculate order size if not provided
  if (!config.orderSize) {
    config.orderSize = (config.initialCapital / config.gridCount) / avgPrice;
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  BACKTEST CONFIGURATION`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Symbol: ${config.symbol}`);
  console.log(`  Period: ${config.startDate.toLocaleDateString()} - ${config.endDate.toLocaleDateString()}`);
  console.log(`  Initial Capital: $${config.initialCapital}`);
  console.log(`  Grid Range: $${config.lowerPrice.toFixed(2)} - $${config.upperPrice.toFixed(2)}`);
  console.log(`  Grid Count: ${config.gridCount}`);
  console.log(`  Order Size: ${config.orderSize.toFixed(6)}`);
  console.log(`  Fees: ${(config.makerFee * 100).toFixed(2)}% maker, ${(config.takerFee * 100).toFixed(2)}% taker`);
  console.log(`${'═'.repeat(60)}\n`);

  // Run simulation
  console.log('🔄 Running simulation...\n');
  const result = simulateGridTrading(data, config);

  // Display results
  console.log(`${'═'.repeat(60)}`);
  console.log(`  BACKTEST RESULTS`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Initial Capital:    $${result.summary.initialCapital.toFixed(2)}`);
  console.log(`  Final Equity:       $${result.summary.finalEquity.toFixed(2)}`);
  console.log(`  Total Return:       ${result.summary.totalReturn >= 0 ? '+' : ''}${result.summary.totalReturn}%`);
  console.log(`  `);
  console.log(`  Total Trades:       ${result.summary.totalTrades}`);
  console.log(`  Buy Trades:         ${result.summary.buyTrades}`);
  console.log(`  Sell Trades:        ${result.summary.sellTrades}`);
  console.log(`  Completed Cycles:   ${result.summary.completedCycles}`);
  console.log(`  Win Rate:           ${result.summary.winRate}%`);
  console.log(`  `);
  console.log(`  Total Fees:         $${result.summary.totalFees.toFixed(2)}`);
  console.log(`  Max Drawdown:       ${result.summary.maxDrawdown}%`);
  console.log(`  Sharpe Ratio:       ${result.summary.sharpeRatio}`);
  console.log(`${'═'.repeat(60)}\n`);

  return result;
}

/**
 * Run parameter optimization
 */
async function optimizeParameters(baseConfig = {}) {
  const config = { ...DEFAULT_CONFIG, ...baseConfig };

  // Fetch data once
  if (!config.startDate) {
    config.startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  }
  if (!config.endDate) {
    config.endDate = new Date();
  }

  const data = await fetchHistoricalData(config.symbol, config.startDate, config.endDate);

  if (data.length === 0) {
    console.error('❌ No historical data available');
    return null;
  }

  // Calculate price range
  const prices = data.map(d => d.close);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  PARAMETER OPTIMIZATION`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Symbol: ${config.symbol}`);
  console.log(`  Price Range: $${minPrice.toFixed(2)} - $${maxPrice.toFixed(2)}`);
  console.log(`  Testing grid counts: 5, 10, 15, 20, 25, 30`);
  console.log(`${'═'.repeat(60)}\n`);

  const results = [];
  const gridCounts = [5, 10, 15, 20, 25, 30];

  for (const gridCount of gridCounts) {
    const testConfig = {
      ...config,
      gridCount,
      lowerPrice: minPrice * 0.95,
      upperPrice: maxPrice * 1.05,
      orderSize: (config.initialCapital / gridCount) / avgPrice,
    };

    const result = simulateGridTrading(data, testConfig);
    results.push({
      gridCount,
      ...result.summary,
    });

    console.log(`  Grid ${gridCount}: Return ${result.summary.totalReturn}%, Trades ${result.summary.totalTrades}, Drawdown ${result.summary.maxDrawdown}%`);
  }

  // Find best configuration
  const bestByReturn = results.reduce((a, b) => a.totalReturn > b.totalReturn ? a : b);
  const bestBySharpe = results.reduce((a, b) => a.sharpeRatio > b.sharpeRatio ? a : b);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  OPTIMIZATION RESULTS`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Best by Return: ${bestByReturn.gridCount} grids (${bestByReturn.totalReturn}%)`);
  console.log(`  Best by Sharpe: ${bestBySharpe.gridCount} grids (Sharpe: ${bestBySharpe.sharpeRatio})`);
  console.log(`${'═'.repeat(60)}\n`);

  return results;
}

/**
 * Export results to JSON
 */
function exportResults(result, filename) {
  const exportData = {
    timestamp: new Date().toISOString(),
    config: result.config,
    summary: result.summary,
    trades: result.trades.slice(0, 100), // First 100 trades
    equityCurve: result.equityCurve.filter((_, i) => i % 10 === 0), // Every 10th point
  };

  fs.writeFileSync(filename, JSON.stringify(exportData, null, 2));
  console.log(`✅ Results exported to ${filename}`);
}

// CLI
const args = process.argv.slice(2);
const command = args[0];

function parseArgs(args) {
  const config = {};
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      if (key === 'symbol') config.symbol = value;
      else if (key === 'capital') config.initialCapital = parseFloat(value);
      else if (key === 'grids') config.gridCount = parseInt(value);
      else if (key === 'days') {
        config.startDate = new Date(Date.now() - parseInt(value) * 24 * 60 * 60 * 1000);
        config.endDate = new Date();
      }
      else if (key === 'lower') config.lowerPrice = parseFloat(value);
      else if (key === 'upper') config.upperPrice = parseFloat(value);
    }
  }
  return config;
}

if (command === 'run') {
  const config = parseArgs(args.slice(1));
  runBacktest(config).then(result => {
    if (result && args.includes('--export')) {
      exportResults(result, 'backtest-results.json');
    }
  });
} else if (command === 'optimize') {
  const config = parseArgs(args.slice(1));
  optimizeParameters(config);
} else {
  console.log(`
Grid Trading Bot - Backtesting Module

Usage:
  node backtest.mjs run [options]        Run a backtest
  node backtest.mjs optimize [options]   Optimize grid parameters

Options:
  --symbol=BTC/USD    Trading pair (default: BTC/USD)
  --capital=1000      Initial capital in USD (default: 1000)
  --grids=10          Number of grid levels (default: 10)
  --days=30           Days of historical data (default: 30)
  --lower=80000       Lower price bound (auto-calculated if not set)
  --upper=100000      Upper price bound (auto-calculated if not set)
  --export            Export results to JSON file

Examples:
  node backtest.mjs run --symbol=BTC/USD --capital=5000 --grids=20 --days=60
  node backtest.mjs optimize --symbol=ETH/USD --capital=1000 --days=30
  node backtest.mjs run --symbol=SOL/USD --grids=15 --export
`);
}

export { runBacktest, optimizeParameters, fetchHistoricalData, simulateGridTrading };
