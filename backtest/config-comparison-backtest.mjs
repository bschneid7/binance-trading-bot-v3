#!/usr/bin/env node
/**
 * Configuration Comparison Backtest
 * 
 * Compares performance between old and new sentiment threshold configurations
 * 
 * OLD CONFIG:
 * - SKIP_BUYS_ABOVE_SCORE: 80
 * - SKIP_SELLS_BELOW_SCORE: 20
 * - GREED_MULTIPLIER: 0.5
 * - FEAR_MULTIPLIER: 1.5
 * 
 * NEW CONFIG (refined based on 14-month backtest):
 * - SKIP_BUYS_ABOVE_SCORE: 75
 * - SKIP_SELLS_BELOW_SCORE: 25
 * - GREED_MULTIPLIER: 0.6
 * - FEAR_MULTIPLIER: 1.4
 */

import https from 'https';
import HistoricalDataFetcher from './historical-data.mjs';
import fs from 'fs';
import path from 'path';

const dataFetcher = new HistoricalDataFetcher();

// OLD CONFIGURATION
const OLD_CONFIG = {
  name: 'OLD (v1.0)',
  SKIP_BUYS_ABOVE_SCORE: 80,
  SKIP_SELLS_BELOW_SCORE: 20,
  POSITION_MULTIPLIERS: {
    EXTREME_FEAR: { min: 0, max: 20, multiplier: 1.5 },
    FEAR: { min: 21, max: 35, multiplier: 1.25 },
    MILD_FEAR: { min: 36, max: 45, multiplier: 1.1 },
    NEUTRAL: { min: 46, max: 55, multiplier: 1.0 },
    MILD_GREED: { min: 56, max: 65, multiplier: 0.9 },
    GREED: { min: 66, max: 80, multiplier: 0.75 },
    EXTREME_GREED: { min: 81, max: 100, multiplier: 0.5 },
  },
};

// NEW CONFIGURATION (refined)
const NEW_CONFIG = {
  name: 'NEW (v1.1 Refined)',
  SKIP_BUYS_ABOVE_SCORE: 75,
  SKIP_SELLS_BELOW_SCORE: 25,
  POSITION_MULTIPLIERS: {
    EXTREME_FEAR: { min: 0, max: 25, multiplier: 1.4 },
    FEAR: { min: 26, max: 40, multiplier: 1.2 },
    MILD_FEAR: { min: 41, max: 50, multiplier: 1.1 },
    NEUTRAL: { min: 51, max: 55, multiplier: 1.0 },
    MILD_GREED: { min: 56, max: 65, multiplier: 0.9 },
    GREED: { min: 66, max: 75, multiplier: 0.6 },
    EXTREME_GREED: { min: 76, max: 100, multiplier: 0.5 },
  },
};

async function fetchFearGreedHistory(days = 450) {
  return new Promise((resolve, reject) => {
    const url = `https://api.alternative.me/fng/?limit=${days}&format=json`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const history = {};
          for (const item of json.data) {
            const date = new Date(parseInt(item.timestamp) * 1000).toISOString().split('T')[0];
            history[date] = {
              value: parseInt(item.value),
              classification: item.value_classification,
            };
          }
          resolve(history);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function getPositionMultiplier(score, config) {
  for (const [, range] of Object.entries(config.POSITION_MULTIPLIERS)) {
    if (score >= range.min && score <= range.max) return range.multiplier;
  }
  return 1.0;
}

function shouldSkipBuy(score, config) {
  return score > config.SKIP_BUYS_ABOVE_SCORE;
}

function shouldSkipSell(score, config) {
  return score < config.SKIP_SELLS_BELOW_SCORE;
}

/**
 * Grid Backtest Engine with configurable sentiment settings
 */
class ConfigurableGridBacktest {
  constructor(gridConfig, sentimentConfig) {
    this.gridConfig = {
      lowerPrice: gridConfig.lowerPrice || 0,
      upperPrice: gridConfig.upperPrice || 0,
      gridLevels: gridConfig.gridLevels || 20,
      orderSize: gridConfig.orderSize || 100,
      initialCapital: gridConfig.initialCapital || 10000,
      makerFee: gridConfig.makerFee || 0.001,
      takerFee: gridConfig.takerFee || 0.001,
    };
    this.sentimentConfig = sentimentConfig;
    this.fearGreedHistory = {};
    this.reset();
  }
  
  reset() {
    this.usdBalance = this.gridConfig.initialCapital / 2;
    this.cryptoBalance = 0;
    this.trades = [];
    this.gridLevels = [];
    this.equity = [];
    this.peakEquity = this.gridConfig.initialCapital;
    this.maxDrawdown = 0;
    this.currentPrice = 0;
    this.stats = {
      skippedBuys: 0,
      skippedSells: 0,
      adjustedOrders: 0,
      positionMultipliers: [],
    };
  }
  
  setFearGreedHistory(history) {
    this.fearGreedHistory = history;
  }
  
  getFearGreedForDate(timestamp) {
    const date = new Date(timestamp).toISOString().split('T')[0];
    return this.fearGreedHistory[date]?.value || 50;
  }
  
  initializeGrid(startPrice) {
    const spacing = (this.gridConfig.upperPrice - this.gridConfig.lowerPrice) / this.gridConfig.gridLevels;
    this.gridLevels = [];
    
    for (let i = 0; i <= this.gridConfig.gridLevels; i++) {
      const price = this.gridConfig.lowerPrice + (i * spacing);
      this.gridLevels.push({
        price,
        type: price < startPrice ? 'buy' : 'sell',
        amount: this.gridConfig.orderSize / price,
        filled: false,
      });
    }
    
    const sellLevels = this.gridLevels.filter(l => l.type === 'sell');
    const cryptoNeeded = sellLevels.reduce((sum, l) => sum + l.amount, 0);
    this.cryptoBalance = cryptoNeeded;
    this.usdBalance = this.gridConfig.initialCapital - (cryptoNeeded * startPrice);
  }
  
  processTick(timestamp, price, high, low) {
    this.currentPrice = price;
    const fearGreed = this.getFearGreedForDate(timestamp);
    
    for (const level of this.gridLevels) {
      if (level.filled) continue;
      
      // Check buy orders
      if (level.type === 'buy' && low <= level.price) {
        if (shouldSkipBuy(fearGreed, this.sentimentConfig)) {
          this.stats.skippedBuys++;
          continue;
        }
        
        const multiplier = getPositionMultiplier(fearGreed, this.sentimentConfig);
        const amount = level.amount * multiplier;
        if (multiplier !== 1.0) {
          this.stats.adjustedOrders++;
          this.stats.positionMultipliers.push(multiplier);
        }
        
        const value = amount * level.price;
        const fee = value * this.gridConfig.takerFee;
        
        if (this.usdBalance >= value + fee) {
          this.usdBalance -= (value + fee);
          this.cryptoBalance += amount;
          this.trades.push({ type: 'buy', price: level.price, amount, value, fee, timestamp, fearGreed });
          level.filled = true;
          level.type = 'sell';
          level.filled = false;
        }
      }
      
      // Check sell orders
      if (level.type === 'sell' && high >= level.price) {
        if (shouldSkipSell(fearGreed, this.sentimentConfig)) {
          this.stats.skippedSells++;
          continue;
        }
        
        const multiplier = getPositionMultiplier(fearGreed, this.sentimentConfig);
        const amount = level.amount * multiplier;
        if (multiplier !== 1.0) {
          this.stats.adjustedOrders++;
          this.stats.positionMultipliers.push(multiplier);
        }
        
        const value = amount * level.price;
        const fee = value * this.gridConfig.takerFee;
        
        if (this.cryptoBalance >= amount) {
          this.cryptoBalance -= amount;
          this.usdBalance += (value - fee);
          this.trades.push({ type: 'sell', price: level.price, amount, value, fee, timestamp, fearGreed });
          level.filled = true;
          level.type = 'buy';
          level.filled = false;
        }
      }
    }
    
    const equity = this.usdBalance + (this.cryptoBalance * price);
    this.equity.push({ timestamp, price, equity });
    
    if (equity > this.peakEquity) this.peakEquity = equity;
    const drawdown = (this.peakEquity - equity) / this.peakEquity;
    if (drawdown > this.maxDrawdown) this.maxDrawdown = drawdown;
  }
  
  run(candles) {
    this.reset();
    
    if (!candles || candles.length === 0) {
      throw new Error('No candle data provided');
    }
    
    const startPrice = candles[0].close;
    this.initializeGrid(startPrice);
    
    for (const candle of candles) {
      this.processTick(candle.timestamp, candle.close, candle.high, candle.low);
    }
    
    return this.generateReport(candles);
  }
  
  generateReport(candles) {
    const startEquity = this.gridConfig.initialCapital;
    const endEquity = this.usdBalance + (this.cryptoBalance * this.currentPrice);
    const totalReturn = ((endEquity - startEquity) / startEquity) * 100;
    
    const buyTrades = this.trades.filter(t => t.type === 'buy');
    const sellTrades = this.trades.filter(t => t.type === 'sell');
    const totalFees = this.trades.reduce((sum, t) => sum + t.fee, 0);
    
    let realizedProfit = 0;
    const buyQueue = [...buyTrades];
    for (const sell of sellTrades) {
      if (buyQueue.length > 0) {
        const buy = buyQueue.shift();
        realizedProfit += (sell.price - buy.price) * Math.min(buy.amount, sell.amount);
      }
    }
    
    const returns = [];
    for (let i = 1; i < this.equity.length; i++) {
      const dailyReturn = (this.equity[i].equity - this.equity[i-1].equity) / this.equity[i-1].equity;
      returns.push(dailyReturn);
    }
    
    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const stdDev = returns.length > 0 ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length) : 0;
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(365 * 24) : 0;
    
    const profitableSells = sellTrades.filter((sell, i) => {
      const buy = buyTrades[i];
      return buy && sell.price > buy.price;
    });
    const winRate = sellTrades.length > 0 ? (profitableSells.length / sellTrades.length) * 100 : 0;
    
    const durationMs = candles[candles.length - 1].timestamp - candles[0].timestamp;
    const durationDays = durationMs / (1000 * 60 * 60 * 24);
    const annualizedReturn = durationDays > 0 ? (Math.pow(endEquity / startEquity, 365 / durationDays) - 1) * 100 : 0;
    
    const avgMultiplier = this.stats.positionMultipliers.length > 0
      ? this.stats.positionMultipliers.reduce((a, b) => a + b, 0) / this.stats.positionMultipliers.length
      : 1.0;
    
    return {
      config: this.sentimentConfig.name,
      summary: {
        initialCapital: startEquity,
        finalEquity: endEquity,
        totalReturn,
        annualizedReturn,
        maxDrawdown: this.maxDrawdown * 100,
        sharpeRatio,
      },
      trades: {
        totalTrades: this.trades.length,
        buyTrades: buyTrades.length,
        sellTrades: sellTrades.length,
        winRate,
        realizedProfit,
        totalFees,
      },
      sentiment: {
        skippedBuys: this.stats.skippedBuys,
        skippedSells: this.stats.skippedSells,
        adjustedOrders: this.stats.adjustedOrders,
        avgPositionMultiplier: avgMultiplier,
      },
    };
  }
}

async function runConfigComparison(symbol, startDate, endDate) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  CONFIG COMPARISON BACKTEST - ${symbol}`);
  console.log(`  Period: ${startDate} to ${endDate}`);
  console.log(`${'='.repeat(70)}\n`);
  
  console.log('Fetching historical price data...');
  const historicalData = await dataFetcher.fetchOHLCV(`${symbol}/USD`, '1h', startDate, endDate);
  if (!historicalData?.candles?.length) {
    console.error('Failed to fetch price data');
    return null;
  }
  const candles = historicalData.candles;
  console.log(`   Loaded ${candles.length} hourly candles`);
  
  console.log('Fetching Fear & Greed Index history...');
  const fearGreedHistory = await fetchFearGreedHistory(450);
  console.log(`   Loaded ${Object.keys(fearGreedHistory).length} days of sentiment data`);
  
  const prices = candles.map(c => c.close);
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const lowerPrice = avgPrice * 0.8;
  const upperPrice = avgPrice * 1.2;
  
  const gridConfig = { lowerPrice, upperPrice, gridLevels: 20, orderSize: 100, initialCapital: 10000 };
  
  // Run with OLD config
  console.log(`\nRunning backtest with ${OLD_CONFIG.name}...`);
  const engineOld = new ConfigurableGridBacktest(gridConfig, OLD_CONFIG);
  engineOld.setFearGreedHistory(fearGreedHistory);
  const resultsOld = engineOld.run(candles);
  
  // Run with NEW config
  console.log(`Running backtest with ${NEW_CONFIG.name}...`);
  const engineNew = new ConfigurableGridBacktest(gridConfig, NEW_CONFIG);
  engineNew.setFearGreedHistory(fearGreedHistory);
  const resultsNew = engineNew.run(candles);
  
  return { symbol, startDate, endDate, old: resultsOld, new: resultsNew };
}

async function runFullComparison() {
  const symbols = ['BTC', 'ETH', 'SOL'];
  const startDate = '2024-11-01';
  const endDate = '2025-12-24';
  const results = {};
  
  console.log('\n' + '='.repeat(70));
  console.log('  SENTIMENT CONFIGURATION COMPARISON');
  console.log('  OLD (v1.0) vs NEW (v1.1 Refined)');
  console.log('='.repeat(70));
  
  console.log('\nOLD CONFIG:');
  console.log(`  Skip Buys Above: ${OLD_CONFIG.SKIP_BUYS_ABOVE_SCORE}`);
  console.log(`  Skip Sells Below: ${OLD_CONFIG.SKIP_SELLS_BELOW_SCORE}`);
  console.log(`  Greed Multiplier: ${OLD_CONFIG.POSITION_MULTIPLIERS.GREED.multiplier}`);
  console.log(`  Fear Multiplier: ${OLD_CONFIG.POSITION_MULTIPLIERS.EXTREME_FEAR.multiplier}`);
  
  console.log('\nNEW CONFIG:');
  console.log(`  Skip Buys Above: ${NEW_CONFIG.SKIP_BUYS_ABOVE_SCORE}`);
  console.log(`  Skip Sells Below: ${NEW_CONFIG.SKIP_SELLS_BELOW_SCORE}`);
  console.log(`  Greed Multiplier: ${NEW_CONFIG.POSITION_MULTIPLIERS.GREED.multiplier}`);
  console.log(`  Fear Multiplier: ${NEW_CONFIG.POSITION_MULTIPLIERS.EXTREME_FEAR.multiplier}`);
  
  for (const symbol of symbols) {
    try {
      results[symbol] = await runConfigComparison(symbol, startDate, endDate);
    } catch (error) {
      console.error(`Error backtesting ${symbol}: ${error.message}`);
      results[symbol] = { error: error.message };
    }
  }
  
  // Print comparison table
  console.log('\n' + '='.repeat(70));
  console.log('  RESULTS COMPARISON');
  console.log('='.repeat(70) + '\n');
  
  console.log('METRIC                  | OLD CONFIG    | NEW CONFIG    | IMPROVEMENT');
  console.log('-'.repeat(70));
  
  let totalReturnOld = 0, totalReturnNew = 0;
  let totalSharpeOld = 0, totalSharpeNew = 0;
  let totalProfitOld = 0, totalProfitNew = 0;
  let totalDrawdownOld = 0, totalDrawdownNew = 0;
  let count = 0;
  
  for (const [symbol, result] of Object.entries(results)) {
    if (result.error || !result.old || !result.new) continue;
    
    console.log(`\n${symbol}:`);
    
    const metrics = [
      ['Total Return', 'summary.totalReturn', '%'],
      ['Sharpe Ratio', 'summary.sharpeRatio', ''],
      ['Realized Profit', 'trades.realizedProfit', '$'],
      ['Max Drawdown', 'summary.maxDrawdown', '%'],
      ['Skipped Buys', 'sentiment.skippedBuys', ''],
      ['Skipped Sells', 'sentiment.skippedSells', ''],
    ];
    
    const getVal = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj) || 0;
    
    for (const [name, path, unit] of metrics) {
      const oldVal = getVal(result.old, path);
      const newVal = getVal(result.new, path);
      const diff = newVal - oldVal;
      
      const fmt = (v) => {
        if (unit === '$') return `$${v.toFixed(2)}`;
        if (unit === '%') return `${v.toFixed(2)}%`;
        return v.toFixed(2);
      };
      
      const diffStr = diff >= 0 ? `+${fmt(diff)}` : fmt(diff);
      const icon = (path.includes('Drawdown') ? diff <= 0 : diff >= 0) ? '✓' : '✗';
      
      console.log(`  ${name.padEnd(20)} | ${fmt(oldVal).padStart(13)} | ${fmt(newVal).padStart(13)} | ${icon} ${diffStr}`);
    }
    
    totalReturnOld += getVal(result.old, 'summary.totalReturn');
    totalReturnNew += getVal(result.new, 'summary.totalReturn');
    totalSharpeOld += getVal(result.old, 'summary.sharpeRatio');
    totalSharpeNew += getVal(result.new, 'summary.sharpeRatio');
    totalProfitOld += getVal(result.old, 'trades.realizedProfit');
    totalProfitNew += getVal(result.new, 'trades.realizedProfit');
    totalDrawdownOld += getVal(result.old, 'summary.maxDrawdown');
    totalDrawdownNew += getVal(result.new, 'summary.maxDrawdown');
    count++;
  }
  
  if (count > 0) {
    console.log('\n' + '='.repeat(70));
    console.log('  AVERAGE ACROSS ALL ASSETS');
    console.log('='.repeat(70));
    
    const avgReturnDiff = (totalReturnNew - totalReturnOld) / count;
    const avgSharpeDiff = (totalSharpeNew - totalSharpeOld) / count;
    const avgProfitDiff = totalProfitNew - totalProfitOld;
    const avgDrawdownDiff = (totalDrawdownNew - totalDrawdownOld) / count;
    
    console.log(`\n  Return:     OLD ${(totalReturnOld/count).toFixed(2)}% → NEW ${(totalReturnNew/count).toFixed(2)}% (${avgReturnDiff >= 0 ? '+' : ''}${avgReturnDiff.toFixed(2)}%)`);
    console.log(`  Sharpe:     OLD ${(totalSharpeOld/count).toFixed(2)} → NEW ${(totalSharpeNew/count).toFixed(2)} (${avgSharpeDiff >= 0 ? '+' : ''}${avgSharpeDiff.toFixed(2)})`);
    console.log(`  Profit:     OLD $${totalProfitOld.toFixed(2)} → NEW $${totalProfitNew.toFixed(2)} (${avgProfitDiff >= 0 ? '+' : ''}$${avgProfitDiff.toFixed(2)})`);
    console.log(`  Drawdown:   OLD ${(totalDrawdownOld/count).toFixed(2)}% → NEW ${(totalDrawdownNew/count).toFixed(2)}% (${avgDrawdownDiff >= 0 ? '+' : ''}${avgDrawdownDiff.toFixed(2)}%)`);
    
    console.log('\n' + '-'.repeat(70));
    
    const improvements = [];
    if (avgReturnDiff > 0) improvements.push('Return');
    if (avgSharpeDiff > 0) improvements.push('Sharpe');
    if (avgProfitDiff > 0) improvements.push('Profit');
    if (avgDrawdownDiff < 0) improvements.push('Drawdown');
    
    if (improvements.length >= 3) {
      console.log('\n✅ NEW CONFIG RECOMMENDED');
      console.log(`   Improvements in: ${improvements.join(', ')}`);
    } else if (improvements.length >= 2) {
      console.log('\n⚠️  NEW CONFIG SHOWS MIXED RESULTS');
      console.log(`   Improvements in: ${improvements.join(', ')}`);
    } else {
      console.log('\n❌ OLD CONFIG MAY BE BETTER');
      console.log(`   Only improved: ${improvements.join(', ') || 'None'}`);
    }
  }
  
  // Save report
  const reportDir = path.join(process.cwd(), 'reports');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, 'config-comparison-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    period: { startDate, endDate },
    oldConfig: OLD_CONFIG,
    newConfig: NEW_CONFIG,
    results,
    summary: {
      avgReturnOld: totalReturnOld / count,
      avgReturnNew: totalReturnNew / count,
      avgSharpeOld: totalSharpeOld / count,
      avgSharpeNew: totalSharpeNew / count,
      totalProfitOld,
      totalProfitNew,
      avgDrawdownOld: totalDrawdownOld / count,
      avgDrawdownNew: totalDrawdownNew / count,
    }
  }, null, 2));
  console.log(`\n📄 Report saved to: ${reportPath}\n`);
  
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runFullComparison().catch(console.error);
}

export { runConfigComparison, runFullComparison };
