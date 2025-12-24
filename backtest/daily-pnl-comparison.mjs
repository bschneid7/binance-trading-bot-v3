#!/usr/bin/env node
/**
 * Daily P&L Comparison for BTC
 * Generates daily equity curves for OLD vs NEW sentiment configurations
 */

import https from 'https';
import HistoricalDataFetcher from './historical-data.mjs';
import fs from 'fs';

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

class DailyPnLBacktest {
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
    this.hourlyEquity = [];
    this.dailyEquity = [];
    this.dailyPnL = [];
    this.peakEquity = this.gridConfig.initialCapital;
    this.maxDrawdown = 0;
    this.currentPrice = 0;
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
      
      if (level.type === 'buy' && low <= level.price) {
        if (shouldSkipBuy(fearGreed, this.sentimentConfig)) continue;
        
        const multiplier = getPositionMultiplier(fearGreed, this.sentimentConfig);
        const amount = level.amount * multiplier;
        const value = amount * level.price;
        const fee = value * this.gridConfig.takerFee;
        
        if (this.usdBalance >= value + fee) {
          this.usdBalance -= (value + fee);
          this.cryptoBalance += amount;
          this.trades.push({ type: 'buy', price: level.price, amount, timestamp, fearGreed });
          level.filled = true;
          level.type = 'sell';
          level.filled = false;
        }
      }
      
      if (level.type === 'sell' && high >= level.price) {
        if (shouldSkipSell(fearGreed, this.sentimentConfig)) continue;
        
        const multiplier = getPositionMultiplier(fearGreed, this.sentimentConfig);
        const amount = level.amount * multiplier;
        const value = amount * level.price;
        const fee = value * this.gridConfig.takerFee;
        
        if (this.cryptoBalance >= amount) {
          this.cryptoBalance -= amount;
          this.usdBalance += (value - fee);
          this.trades.push({ type: 'sell', price: level.price, amount, timestamp, fearGreed });
          level.filled = true;
          level.type = 'buy';
          level.filled = false;
        }
      }
    }
    
    const equity = this.usdBalance + (this.cryptoBalance * price);
    this.hourlyEquity.push({ timestamp, price, equity, fearGreed });
    
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
    
    // Aggregate to daily
    this.aggregateToDaily();
    
    return {
      hourlyEquity: this.hourlyEquity,
      dailyEquity: this.dailyEquity,
      dailyPnL: this.dailyPnL,
      trades: this.trades,
    };
  }
  
  aggregateToDaily() {
    const dailyMap = {};
    
    for (const point of this.hourlyEquity) {
      const date = new Date(point.timestamp).toISOString().split('T')[0];
      if (!dailyMap[date] || point.timestamp > dailyMap[date].timestamp) {
        dailyMap[date] = point;
      }
    }
    
    const dates = Object.keys(dailyMap).sort();
    let prevEquity = this.gridConfig.initialCapital;
    
    for (const date of dates) {
      const point = dailyMap[date];
      const pnl = point.equity - prevEquity;
      const pnlPercent = (pnl / prevEquity) * 100;
      
      this.dailyEquity.push({
        date,
        equity: point.equity,
        price: point.price,
        fearGreed: point.fearGreed,
      });
      
      this.dailyPnL.push({
        date,
        pnl,
        pnlPercent,
        cumulativePnL: point.equity - this.gridConfig.initialCapital,
        cumulativePnLPercent: ((point.equity - this.gridConfig.initialCapital) / this.gridConfig.initialCapital) * 100,
        fearGreed: point.fearGreed,
      });
      
      prevEquity = point.equity;
    }
  }
}

async function runDailyPnLComparison() {
  const symbol = 'BTC';
  const startDate = '2024-11-01';
  const endDate = '2025-12-24';
  
  console.log('Fetching historical price data...');
  const historicalData = await dataFetcher.fetchOHLCV(`${symbol}/USD`, '1h', startDate, endDate);
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
  
  console.log('\nRunning OLD config backtest...');
  const engineOld = new DailyPnLBacktest(gridConfig, OLD_CONFIG);
  engineOld.setFearGreedHistory(fearGreedHistory);
  const resultsOld = engineOld.run(candles);
  
  console.log('Running NEW config backtest...');
  const engineNew = new DailyPnLBacktest(gridConfig, NEW_CONFIG);
  engineNew.setFearGreedHistory(fearGreedHistory);
  const resultsNew = engineNew.run(candles);
  
  // Save results for Python visualization
  const outputData = {
    symbol,
    startDate,
    endDate,
    initialCapital: gridConfig.initialCapital,
    old: {
      config: OLD_CONFIG.name,
      dailyEquity: resultsOld.dailyEquity,
      dailyPnL: resultsOld.dailyPnL,
    },
    new: {
      config: NEW_CONFIG.name,
      dailyEquity: resultsNew.dailyEquity,
      dailyPnL: resultsNew.dailyPnL,
    },
  };
  
  fs.writeFileSync('/home/ubuntu/btc_daily_pnl_data.json', JSON.stringify(outputData, null, 2));
  console.log('\nData saved to /home/ubuntu/btc_daily_pnl_data.json');
  
  return outputData;
}

runDailyPnLComparison().catch(console.error);
