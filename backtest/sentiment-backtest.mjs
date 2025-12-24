#!/usr/bin/env node
/**
 * Sentiment Analysis Backtest
 * Version: 1.1.0
 * 
 * Compares grid bot performance with and without sentiment-based adjustments
 * using historical Fear & Greed Index data and price data.
 */

import https from 'https';
import HistoricalDataFetcher from './historical-data.mjs';
import fs from 'fs';
import path from 'path';

const dataFetcher = new HistoricalDataFetcher();

/**
 * Sentiment adjustment configuration (mirrors production settings)
 */
const SENTIMENT_CONFIG = {
  POSITION_SIZING: {
    EXTREME_FEAR: { min: 0, max: 20, multiplier: 1.5 },
    FEAR: { min: 21, max: 35, multiplier: 1.25 },
    MILD_FEAR: { min: 36, max: 45, multiplier: 1.1 },
    NEUTRAL: { min: 46, max: 55, multiplier: 1.0 },
    MILD_GREED: { min: 56, max: 65, multiplier: 0.9 },
    GREED: { min: 66, max: 80, multiplier: 0.75 },
    EXTREME_GREED: { min: 81, max: 100, multiplier: 0.5 },
  },
  SKIP_BUYS_ABOVE_SCORE: 80,
  SKIP_SELLS_BELOW_SCORE: 20,
  DIP_BUYER: {
    EXTREME_FEAR: { min: 0, max: 20, multiplier: 2.0 },
    FEAR: { min: 21, max: 35, multiplier: 1.5 },
    MILD_FEAR: { min: 36, max: 45, multiplier: 1.25 },
    NEUTRAL: { min: 46, max: 55, multiplier: 1.0 },
    MILD_GREED: { min: 56, max: 65, multiplier: 0.75 },
    GREED: { min: 66, max: 80, multiplier: 0.5 },
    EXTREME_GREED: { min: 81, max: 100, multiplier: 0.25 },
  },
};

async function fetchFearGreedHistory(days = 365) {
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

function getPositionMultiplier(score) {
  for (const [, range] of Object.entries(SENTIMENT_CONFIG.POSITION_SIZING)) {
    if (score >= range.min && score <= range.max) return range.multiplier;
  }
  return 1.0;
}

function shouldSkipBuy(score) {
  return score > SENTIMENT_CONFIG.SKIP_BUYS_ABOVE_SCORE;
}

function shouldSkipSell(score) {
  return score < SENTIMENT_CONFIG.SKIP_SELLS_BELOW_SCORE;
}

/**
 * Simple Grid Bot Backtest Engine with Sentiment Support
 */
class GridBacktestEngine {
  constructor(config = {}) {
    this.config = {
      lowerPrice: config.lowerPrice || 0,
      upperPrice: config.upperPrice || 0,
      gridLevels: config.gridLevels || 20,
      orderSize: config.orderSize || 100,
      initialCapital: config.initialCapital || 10000,
      makerFee: config.makerFee || 0.001,
      takerFee: config.takerFee || 0.001,
      useSentiment: config.useSentiment || false,
    };
    this.fearGreedHistory = {};
    this.reset();
  }
  
  reset() {
    this.usdBalance = this.config.initialCapital / 2;
    this.cryptoBalance = 0;
    this.trades = [];
    this.gridLevels = [];
    this.equity = [];
    this.peakEquity = this.config.initialCapital;
    this.maxDrawdown = 0;
    this.currentPrice = 0;
    this.sentimentStats = {
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
    const spacing = (this.config.upperPrice - this.config.lowerPrice) / this.config.gridLevels;
    this.gridLevels = [];
    
    for (let i = 0; i <= this.config.gridLevels; i++) {
      const price = this.config.lowerPrice + (i * spacing);
      this.gridLevels.push({
        price,
        type: price < startPrice ? 'buy' : 'sell',
        amount: this.config.orderSize / price,
        filled: false,
      });
    }
    
    // Buy initial crypto for sell orders
    const sellLevels = this.gridLevels.filter(l => l.type === 'sell');
    const cryptoNeeded = sellLevels.reduce((sum, l) => sum + l.amount, 0);
    this.cryptoBalance = cryptoNeeded;
    this.usdBalance = this.config.initialCapital - (cryptoNeeded * startPrice);
  }
  
  processTick(timestamp, price, high, low) {
    this.currentPrice = price;
    const fearGreed = this.getFearGreedForDate(timestamp);
    
    for (const level of this.gridLevels) {
      if (level.filled) continue;
      
      // Check buy orders
      if (level.type === 'buy' && low <= level.price) {
        // Apply sentiment filter
        if (this.config.useSentiment && shouldSkipBuy(fearGreed)) {
          this.sentimentStats.skippedBuys++;
          continue;
        }
        
        // Apply position sizing
        let amount = level.amount;
        if (this.config.useSentiment) {
          const multiplier = getPositionMultiplier(fearGreed);
          amount = level.amount * multiplier;
          if (multiplier !== 1.0) {
            this.sentimentStats.adjustedOrders++;
            this.sentimentStats.positionMultipliers.push(multiplier);
          }
        }
        
        const value = amount * level.price;
        const fee = value * this.config.takerFee;
        
        if (this.usdBalance >= value + fee) {
          this.usdBalance -= (value + fee);
          this.cryptoBalance += amount;
          this.trades.push({ type: 'buy', price: level.price, amount, value, fee, timestamp, fearGreed });
          level.filled = true;
          level.type = 'sell'; // Flip to sell
          level.filled = false;
        }
      }
      
      // Check sell orders
      if (level.type === 'sell' && high >= level.price) {
        // Apply sentiment filter
        if (this.config.useSentiment && shouldSkipSell(fearGreed)) {
          this.sentimentStats.skippedSells++;
          continue;
        }
        
        // Apply position sizing
        let amount = level.amount;
        if (this.config.useSentiment) {
          const multiplier = getPositionMultiplier(fearGreed);
          amount = level.amount * multiplier;
          if (multiplier !== 1.0) {
            this.sentimentStats.adjustedOrders++;
            this.sentimentStats.positionMultipliers.push(multiplier);
          }
        }
        
        const value = amount * level.price;
        const fee = value * this.config.takerFee;
        
        if (this.cryptoBalance >= amount) {
          this.cryptoBalance -= amount;
          this.usdBalance += (value - fee);
          this.trades.push({ type: 'sell', price: level.price, amount, value, fee, timestamp, fearGreed });
          level.filled = true;
          level.type = 'buy'; // Flip to buy
          level.filled = false;
        }
      }
    }
    
    // Track equity and drawdown
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
    const startEquity = this.config.initialCapital;
    const endEquity = this.usdBalance + (this.cryptoBalance * this.currentPrice);
    const totalReturn = ((endEquity - startEquity) / startEquity) * 100;
    
    const buyTrades = this.trades.filter(t => t.type === 'buy');
    const sellTrades = this.trades.filter(t => t.type === 'sell');
    const totalFees = this.trades.reduce((sum, t) => sum + t.fee, 0);
    
    // Calculate realized profit
    let realizedProfit = 0;
    const buyQueue = [...buyTrades];
    for (const sell of sellTrades) {
      if (buyQueue.length > 0) {
        const buy = buyQueue.shift();
        realizedProfit += (sell.price - buy.price) * Math.min(buy.amount, sell.amount);
      }
    }
    
    // Calculate Sharpe ratio
    const returns = [];
    for (let i = 1; i < this.equity.length; i++) {
      const dailyReturn = (this.equity[i].equity - this.equity[i-1].equity) / this.equity[i-1].equity;
      returns.push(dailyReturn);
    }
    
    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const stdDev = returns.length > 0 ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length) : 0;
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(365 * 24) : 0;
    
    // Win rate
    const profitableSells = sellTrades.filter((sell, i) => {
      const buy = buyTrades[i];
      return buy && sell.price > buy.price;
    });
    const winRate = sellTrades.length > 0 ? (profitableSells.length / sellTrades.length) * 100 : 0;
    
    // Duration
    const durationMs = candles[candles.length - 1].timestamp - candles[0].timestamp;
    const durationDays = durationMs / (1000 * 60 * 60 * 24);
    const annualizedReturn = durationDays > 0 ? (Math.pow(endEquity / startEquity, 365 / durationDays) - 1) * 100 : 0;
    
    // Sentiment stats
    const avgMultiplier = this.sentimentStats.positionMultipliers.length > 0
      ? this.sentimentStats.positionMultipliers.reduce((a, b) => a + b, 0) / this.sentimentStats.positionMultipliers.length
      : 1.0;
    
    return {
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
        enabled: this.config.useSentiment,
        skippedBuys: this.sentimentStats.skippedBuys,
        skippedSells: this.sentimentStats.skippedSells,
        adjustedOrders: this.sentimentStats.adjustedOrders,
        avgPositionMultiplier: avgMultiplier,
      },
    };
  }
}

async function runComparativeBacktest(symbol, days = 180, startDateOverride = null, endDateOverride = null) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  SENTIMENT ANALYSIS BACKTEST - ${symbol}`);
  console.log(`${'='.repeat(70)}\n`);
  
  const endDate = endDateOverride || new Date().toISOString().split('T')[0];
  const startDate = startDateOverride || new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  console.log('Fetching historical price data...');
  const historicalData = await dataFetcher.fetchOHLCV(`${symbol}/USD`, '1h', startDate, endDate);
  if (!historicalData?.candles?.length) {
    console.error('Failed to fetch price data');
    return null;
  }
  const candles = historicalData.candles;
  console.log(`   Loaded ${candles.length} hourly candles`);
  
  console.log('Fetching Fear & Greed Index history...');
  const fearGreedHistory = await fetchFearGreedHistory(days + 30);
  console.log(`   Loaded ${Object.keys(fearGreedHistory).length} days of sentiment data`);
  
  const prices = candles.map(c => c.close);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const lowerPrice = avgPrice * 0.8;
  const upperPrice = avgPrice * 1.2;
  
  console.log(`\nPrice: Min $${minPrice.toFixed(2)}, Max $${maxPrice.toFixed(2)}, Avg $${avgPrice.toFixed(2)}`);
  console.log(`Grid: $${lowerPrice.toFixed(2)} - $${upperPrice.toFixed(2)}`);
  
  // Sentiment distribution
  const fgValues = Object.values(fearGreedHistory).map(v => v.value);
  const avgFG = fgValues.reduce((a, b) => a + b, 0) / fgValues.length;
  const extremeFear = fgValues.filter(v => v <= 20).length;
  const fear = fgValues.filter(v => v > 20 && v <= 40).length;
  const neutral = fgValues.filter(v => v > 40 && v <= 60).length;
  const greed = fgValues.filter(v => v > 60 && v <= 80).length;
  const extremeGreed = fgValues.filter(v => v > 80).length;
  
  console.log(`\nSentiment: Extreme Fear ${extremeFear}d, Fear ${fear}d, Neutral ${neutral}d, Greed ${greed}d, Extreme Greed ${extremeGreed}d`);
  console.log(`Average Fear & Greed: ${avgFG.toFixed(1)}`);
  
  const baseConfig = { lowerPrice, upperPrice, gridLevels: 20, orderSize: 100, initialCapital: 10000 };
  
  // Run WITHOUT sentiment
  console.log('\nRunning backtest WITHOUT sentiment...');
  const engineNo = new GridBacktestEngine({ ...baseConfig, useSentiment: false });
  engineNo.setFearGreedHistory(fearGreedHistory);
  const resultsNo = engineNo.run(candles);
  
  // Run WITH sentiment
  console.log('Running backtest WITH sentiment...');
  const engineWith = new GridBacktestEngine({ ...baseConfig, useSentiment: true });
  engineWith.setFearGreedHistory(fearGreedHistory);
  const resultsWith = engineWith.run(candles);
  
  // Compare results
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  RESULTS COMPARISON - ${symbol}`);
  console.log(`${'='.repeat(70)}\n`);
  
  const metrics = [
    ['Total Return', 'summary.totalReturn', '%'],
    ['Annualized Return', 'summary.annualizedReturn', '%'],
    ['Total Trades', 'trades.totalTrades', ''],
    ['Win Rate', 'trades.winRate', '%'],
    ['Realized Profit', 'trades.realizedProfit', '$'],
    ['Max Drawdown', 'summary.maxDrawdown', '%'],
    ['Sharpe Ratio', 'summary.sharpeRatio', ''],
    ['Final Equity', 'summary.finalEquity', '$'],
  ];
  
  const getVal = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj) || 0;
  
  console.log('Metric                  | No Sentiment  | With Sentiment| Difference');
  console.log('-'.repeat(70));
  
  const comparison = {};
  for (const [name, path, unit] of metrics) {
    const noSent = getVal(resultsNo, path);
    const withSent = getVal(resultsWith, path);
    const diff = withSent - noSent;
    comparison[path] = { noSentiment: noSent, withSentiment: withSent, diff };
    
    const fmt = (v) => {
      if (unit === '$') return `$${v.toFixed(2)}`;
      if (unit === '%') return `${v.toFixed(2)}%`;
      return v.toFixed(2);
    };
    
    const diffStr = diff >= 0 ? `+${fmt(diff)}` : fmt(diff);
    const icon = diff >= 0 ? '+' : '-';
    console.log(`${name.padEnd(23)} | ${fmt(noSent).padStart(13)} | ${fmt(withSent).padStart(13)} | ${icon} ${diffStr}`);
  }
  
  console.log(`\nSentiment Impact:`);
  console.log(`   Skipped Buys (Extreme Greed): ${resultsWith.sentiment.skippedBuys}`);
  console.log(`   Skipped Sells (Extreme Fear): ${resultsWith.sentiment.skippedSells}`);
  console.log(`   Adjusted Orders: ${resultsWith.sentiment.adjustedOrders}`);
  console.log(`   Avg Position Multiplier: ${resultsWith.sentiment.avgPositionMultiplier.toFixed(2)}x`);
  
  return {
    symbol,
    days,
    noSentiment: resultsNo,
    withSentiment: resultsWith,
    comparison,
    fearGreedStats: { avgFG, extremeFear, fear, neutral, greed, extremeGreed },
  };
}

async function runAllBacktests() {
  const symbols = ['BTC', 'ETH', 'SOL'];
  const days = 180;
  const results = {};
  
  console.log('\n' + '='.repeat(70));
  console.log('  SENTIMENT ANALYSIS BACKTEST SUITE');
  console.log('='.repeat(70));
  
  for (const symbol of symbols) {
    try {
      results[symbol] = await runComparativeBacktest(symbol, days);
    } catch (error) {
      console.error(`Error backtesting ${symbol}: ${error.message}`);
      results[symbol] = { error: error.message };
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('  OVERALL SUMMARY');
  console.log('='.repeat(70) + '\n');
  
  let totalReturnDiff = 0;
  let totalSharpeDiff = 0;
  let validCount = 0;
  
  for (const [symbol, result] of Object.entries(results)) {
    if (result.error || !result.noSentiment || !result.withSentiment) continue;
    
    const returnDiff = result.withSentiment.summary.totalReturn - result.noSentiment.summary.totalReturn;
    const sharpeDiff = result.withSentiment.summary.sharpeRatio - result.noSentiment.summary.sharpeRatio;
    const drawdownDiff = result.withSentiment.summary.maxDrawdown - result.noSentiment.summary.maxDrawdown;
    
    totalReturnDiff += returnDiff;
    totalSharpeDiff += sharpeDiff;
    validCount++;
    
    const returnIcon = returnDiff >= 0 ? '🟢' : '🔴';
    const sharpeIcon = sharpeDiff >= 0 ? '🟢' : '🔴';
    const drawdownIcon = drawdownDiff <= 0 ? '🟢' : '🔴';
    
    console.log(`${symbol}: Return ${returnIcon} ${returnDiff >= 0 ? '+' : ''}${returnDiff.toFixed(2)}%, Sharpe ${sharpeIcon} ${sharpeDiff >= 0 ? '+' : ''}${sharpeDiff.toFixed(2)}, Drawdown ${drawdownIcon} ${drawdownDiff >= 0 ? '+' : ''}${drawdownDiff.toFixed(2)}%`);
  }
  
  if (validCount > 0) {
    const avgReturnDiff = totalReturnDiff / validCount;
    const avgSharpeDiff = totalSharpeDiff / validCount;
    
    console.log(`\nAVERAGE: Return ${avgReturnDiff >= 0 ? '+' : ''}${avgReturnDiff.toFixed(2)}%, Sharpe ${avgSharpeDiff >= 0 ? '+' : ''}${avgSharpeDiff.toFixed(2)}`);
    
    console.log('\n' + '-'.repeat(70));
    if (avgReturnDiff > 0 && avgSharpeDiff > 0) {
      console.log('\n✅ RECOMMENDATION: ENABLE SENTIMENT INTEGRATION');
      console.log('   Backtest shows improved returns AND risk-adjusted performance.');
    } else if (avgReturnDiff > 0) {
      console.log('\n⚠️  RECOMMENDATION: ENABLE WITH MONITORING');
      console.log('   Returns improved but risk metrics are mixed.');
    } else if (avgSharpeDiff > 0) {
      console.log('\n⚠️  RECOMMENDATION: ENABLE FOR RISK REDUCTION');
      console.log('   Lower returns but better risk-adjusted performance.');
    } else {
      console.log('\n❌ RECOMMENDATION: REVIEW SENTIMENT THRESHOLDS');
      console.log('   Current settings may need adjustment.');
    }
  }
  
  // Save report
  const reportDir = path.join(process.cwd(), 'reports');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, 'sentiment-backtest-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`\n📄 Report saved to: ${reportPath}\n`);
  
  return results;
}

async function runExtendedBacktest() {
  // Extended backtest covering Nov 2024 - Dec 2025 (includes extreme greed period)
  const symbols = ['BTC', 'ETH', 'SOL'];
  const results = {};
  
  // Period 1: Bull run with extreme greed (Nov 2024 - Jan 2025)
  console.log('\n' + '='.repeat(70));
  console.log('  EXTENDED BACKTEST: COMPLETE MARKET CYCLE');
  console.log('  Period: November 2024 - December 2025 (14 months)');
  console.log('='.repeat(70));
  
  for (const symbol of symbols) {
    try {
      // Full cycle: Nov 2024 to Dec 2025
      results[symbol] = await runComparativeBacktest(symbol, 420, '2024-11-01', '2025-12-24');
    } catch (error) {
      console.error(`Error backtesting ${symbol}: ${error.message}`);
      results[symbol] = { error: error.message };
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('  EXTENDED BACKTEST SUMMARY');
  console.log('='.repeat(70) + '\n');
  
  let totalReturnDiff = 0;
  let totalSharpeDiff = 0;
  let validCount = 0;
  
  for (const [symbol, result] of Object.entries(results)) {
    if (result.error || !result.noSentiment || !result.withSentiment) continue;
    
    const returnDiff = result.withSentiment.summary.totalReturn - result.noSentiment.summary.totalReturn;
    const sharpeDiff = result.withSentiment.summary.sharpeRatio - result.noSentiment.summary.sharpeRatio;
    const drawdownDiff = result.withSentiment.summary.maxDrawdown - result.noSentiment.summary.maxDrawdown;
    
    totalReturnDiff += returnDiff;
    totalSharpeDiff += sharpeDiff;
    validCount++;
    
    console.log(`${symbol}: Return ${returnDiff >= 0 ? '+' : ''}${returnDiff.toFixed(2)}%, Sharpe ${sharpeDiff >= 0 ? '+' : ''}${sharpeDiff.toFixed(2)}, Drawdown ${drawdownDiff >= 0 ? '+' : ''}${drawdownDiff.toFixed(2)}%`);
  }
  
  if (validCount > 0) {
    console.log(`\nAVERAGE: Return ${(totalReturnDiff/validCount).toFixed(2)}%, Sharpe ${(totalSharpeDiff/validCount).toFixed(2)}`);
  }
  
  // Save report
  const reportDir = path.join(process.cwd(), 'reports');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, 'extended-sentiment-backtest-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`\nReport saved to: ${reportPath}\n`);
  
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args.includes('--extended')) {
    runExtendedBacktest().catch(console.error);
  } else {
    runAllBacktests().catch(console.error);
  }
}

export { runComparativeBacktest, runAllBacktests, GridBacktestEngine };
