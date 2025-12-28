#!/usr/bin/env node
/**
 * Weekly Performance Report Generator
 * 
 * Generates a comprehensive report on bot performance with focus on sentiment integration impact
 * 
 * Created: December 24, 2025
 */

import 'dotenv/config';
import ccxt from 'ccxt';
import { DatabaseManager } from './database.mjs';
import https from 'https';
import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';

const REPORT_CONFIG = {
  SYMBOLS: ['BTC', 'ETH', 'SOL'],
  BOT_NAMES: {
    BTC: 'live-btc-bot',
    ETH: 'live-eth-bot',
    SOL: 'live-sol-bot',
  },
  REPORT_DIR: '/home/ubuntu/binance-trading-bot-v3/reports/weekly',
  SENTIMENT_HISTORY_FILE: '/home/ubuntu/binance-trading-bot-v3/data/sentiment-correlation-history.json',
  EMAIL_TO: 'bschneid7@gmail.com',
};

class WeeklyReportGenerator {
  constructor() {
    this.db = null;
    this.exchange = null;
    this.reportData = {};
  }
  
  async init() {
    const dbManager = new DatabaseManager();
    dbManager.init();
    this.db = dbManager.db;
    // Only initialize exchange if API keys are available
    if (process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET) {
      this.exchange = new ccxt.binanceus({
        apiKey: process.env.BINANCE_API_KEY,
        secret: process.env.BINANCE_API_SECRET,
        enableRateLimit: true,
      });
    } else {
      console.log('⚠️  No API keys found, running in report-only mode');
      this.exchange = null;
    }
    
    // Ensure report directory exists
    if (!fs.existsSync(REPORT_CONFIG.REPORT_DIR)) {
      fs.mkdirSync(REPORT_CONFIG.REPORT_DIR, { recursive: true });
    }
  }
  
  async fetchFearGreedHistory(days = 7) {
    return new Promise((resolve, reject) => {
      const url = `https://api.alternative.me/fng/?limit=${days}&format=json`;
      https.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json.data.map(d => ({
              date: new Date(parseInt(d.timestamp) * 1000).toISOString().split('T')[0],
              value: parseInt(d.value),
              classification: d.value_classification,
            })));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });
  }
  
  getWeekRange() {
    const now = new Date();
    const endDate = now.toISOString().split('T')[0];
    const startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const startTimestamp = new Date(startDate).getTime();
    const endTimestamp = now.getTime();
    return { startDate, endDate, startTimestamp, endTimestamp };
  }
  
  async getTradesForPeriod(botName, startDate, endDate) {
    try {
      const trades = this.db.prepare(`
        SELECT * FROM trades 
        WHERE bot_name = ? 
        AND timestamp >= ? 
        AND timestamp <= ?
        ORDER BY timestamp ASC
      `).all(botName, startDate, endDate + ' 23:59:59');
      return trades;
    } catch (error) {
      console.error(`Error fetching trades for ${botName}:`, error.message);
      return [];
    }
  }
  
  async getOrdersForPeriod(botName, startTimestamp, endTimestamp) {
    try {
      const orders = this.db.prepare(`
        SELECT * FROM orders 
        WHERE bot_name = ? 
        AND created_at >= ? 
        AND created_at <= ?
      `).all(botName, startTimestamp, endTimestamp);
      return orders;
    } catch (error) {
      console.error(`Error fetching orders for ${botName}:`, error.message);
      return [];
    }
  }
  
  async getBotStats(botName) {
    try {
      const stats = this.db.prepare(`
        SELECT * FROM metrics WHERE bot_name = ?
      `).get(botName);
      return stats || {};
    } catch (error) {
      return {};
    }
  }
  
  async getCurrentPrices() {
    const prices = {};
    for (const symbol of REPORT_CONFIG.SYMBOLS) {
      try {
        if (this.exchange) {
          const ticker = await this.exchange.fetchTicker(`${symbol}/USD`);
          prices[symbol] = ticker.last;
        } else {
          // Fallback: fetch from public API
          const response = await fetch(`https://api.binance.us/api/v3/ticker/price?symbol=${symbol}USD`);
          const data = await response.json();
          prices[symbol] = parseFloat(data.price) || 0;
        }
      } catch (error) {
        console.error(`Error fetching price for ${symbol}:`, error.message);
        prices[symbol] = 0;
      }
    }
    return prices;
  }
  
  async getAccountBalance() {
    if (!this.exchange) {
      console.log('⚠️  Exchange not configured, balance unavailable');
      return { USD: 0, BTC: 0, ETH: 0, SOL: 0 };
    }
    try {
      const balance = await this.exchange.fetchBalance();
      return {
        USD: balance.USD?.free || 0,
        BTC: balance.BTC?.free || 0,
        ETH: balance.ETH?.free || 0,
        SOL: balance.SOL?.free || 0,
      };
    } catch (error) {
      console.error('Error fetching balance:', error.message);
      return { USD: 0, BTC: 0, ETH: 0, SOL: 0 };
    }
  }
  
  calculateTradeMetrics(trades) {
    if (!trades || trades.length === 0) {
      return {
        totalTrades: 0,
        buyTrades: 0,
        sellTrades: 0,
        totalVolume: 0,
        realizedProfit: 0,
        avgTradeSize: 0,
        winRate: 0,
        totalFees: 0,
        completedCycles: 0,
      };
    }
    
    // Separate buys and sells
    const buys = [];
    const sells = [];
    let totalVolume = 0;
    let totalFees = 0;
    
    for (const trade of trades) {
      const fee = trade.fee || 0;
      totalFees += fee;
      totalVolume += trade.value || (trade.price * trade.amount);
      
      if (trade.side === 'buy') {
        buys.push({ price: trade.price, value: trade.value, amount: trade.amount });
      } else if (trade.side === 'sell') {
        sells.push({ price: trade.price, value: trade.value, amount: trade.amount });
      }
    }
    
    // For grid bots, realized P&L comes from completed cycles
    // A cycle = buy at lower price, sell at higher price
    // Match lowest buys with lowest sells (grid trading pattern)
    
    let realizedProfit = 0;
    let wins = 0;
    const completedCycles = Math.min(buys.length, sells.length);
    
    if (completedCycles > 0) {
      // Sort buys by price ascending (lowest first)
      // Sort sells by price ascending (lowest first)
      buys.sort((a, b) => a.price - b.price);
      sells.sort((a, b) => a.price - b.price);
      
      // Match lowest buys with lowest sells
      // In grid trading, sells should be at higher prices than buys
      for (let i = 0; i < completedCycles; i++) {
        const buy = buys[i];
        const sell = sells[i];
        // Use the smaller amount if they differ
        const matchedAmount = Math.min(buy.amount, sell.amount);
        const profit = (sell.price - buy.price) * matchedAmount;
        realizedProfit += profit;
        if (profit > 0) wins++;
      }
    }
    
    // Subtract fees from realized P&L
    realizedProfit -= totalFees;
    
    const winRate = completedCycles > 0 ? (wins / completedCycles) * 100 : 0;
    
    return {
      totalTrades: trades.length,
      buyTrades: buys.length,
      sellTrades: sells.length,
      totalVolume,
      realizedProfit: parseFloat(realizedProfit.toFixed(2)),
      avgTradeSize: totalVolume / trades.length,
      winRate: parseFloat(winRate.toFixed(1)),
      totalFees: parseFloat(totalFees.toFixed(4)),
      completedCycles,
    };
  }
  
  async generateSymbolReport(symbol, weekRange, fearGreedHistory) {
    const botName = REPORT_CONFIG.BOT_NAMES[symbol];
    
    // Get trades and orders
    const trades = await this.getTradesForPeriod(botName, weekRange.startDate, weekRange.endDate);
    const orders = await this.getOrdersForPeriod(botName, weekRange.startTimestamp, weekRange.endTimestamp);
    const botStats = await this.getBotStats(botName);
    
    // Calculate metrics
    const tradeMetrics = this.calculateTradeMetrics(trades);
    
    // Sentiment impact analysis
    const sentimentImpact = {
      tradesInExtremeFear: 0,
      tradesInFear: 0,
      tradesInNeutral: 0,
      tradesInGreed: 0,
      tradesInExtremeGreed: 0,
      skippedBuysEstimate: 0,
      skippedSellsEstimate: 0,
    };
    
    // Map trades to sentiment periods
    for (const trade of trades) {
      const tradeDate = new Date(trade.timestamp).toISOString().split('T')[0];
      const fg = fearGreedHistory.find(f => f.date === tradeDate);
      const fgValue = fg?.value || 50;
      
      if (fgValue <= 25) sentimentImpact.tradesInExtremeFear++;
      else if (fgValue <= 40) sentimentImpact.tradesInFear++;
      else if (fgValue <= 60) sentimentImpact.tradesInNeutral++;
      else if (fgValue <= 75) sentimentImpact.tradesInGreed++;
      else sentimentImpact.tradesInExtremeGreed++;
    }
    
    // Estimate skipped orders based on sentiment thresholds
    const extremeFearDays = fearGreedHistory.filter(f => f.value <= 25).length;
    const extremeGreedDays = fearGreedHistory.filter(f => f.value >= 75).length;
    sentimentImpact.skippedSellsEstimate = extremeFearDays * 2; // Rough estimate
    sentimentImpact.skippedBuysEstimate = extremeGreedDays * 2;
    
    return {
      symbol,
      botName,
      period: weekRange,
      tradeMetrics,
      sentimentImpact,
      botStats,
      openOrders: orders.filter(o => o.status === 'open').length,
      filledOrders: orders.filter(o => o.status === 'filled').length,
    };
  }
  
  async generateReport() {
    console.log('\\n' + '='.repeat(70));
    console.log('  WEEKLY PERFORMANCE REPORT');
    console.log('  Generated: ' + new Date().toISOString());
    console.log('='.repeat(70));
    
    const weekRange = this.getWeekRange();
    console.log(`\\nReport Period: ${weekRange.startDate} to ${weekRange.endDate}`);
    
    // Fetch sentiment data
    console.log('\\nFetching sentiment data...');
    const fearGreedHistory = await this.fetchFearGreedHistory(7);
    
    // Fetch current prices and balance
    console.log('Fetching current prices and balance...');
    const currentPrices = await this.getCurrentPrices();
    const balance = await this.getAccountBalance();
    
    // Generate reports for each symbol
    const symbolReports = {};
    for (const symbol of REPORT_CONFIG.SYMBOLS) {
      console.log(`\\nAnalyzing ${symbol}...`);
      symbolReports[symbol] = await this.generateSymbolReport(symbol, weekRange, fearGreedHistory);
    }
    
    // Calculate portfolio totals
    const portfolioValue = balance.USD + 
      (balance.BTC * currentPrices.BTC) + 
      (balance.ETH * currentPrices.ETH) + 
      (balance.SOL * currentPrices.SOL);
    
    const totalRealizedProfit = Object.values(symbolReports).reduce(
      (sum, r) => sum + r.tradeMetrics.realizedProfit, 0
    );
    
    const totalTrades = Object.values(symbolReports).reduce(
      (sum, r) => sum + r.tradeMetrics.totalTrades, 0
    );
    
    const totalVolume = Object.values(symbolReports).reduce(
      (sum, r) => sum + r.tradeMetrics.totalVolume, 0
    );
    
    // Compile full report
    const fullReport = {
      generatedAt: new Date().toISOString(),
      period: weekRange,
      sentiment: {
        history: fearGreedHistory,
        avgFearGreed: fearGreedHistory.reduce((sum, f) => sum + f.value, 0) / fearGreedHistory.length,
        extremeFearDays: fearGreedHistory.filter(f => f.value <= 25).length,
        extremeGreedDays: fearGreedHistory.filter(f => f.value >= 75).length,
      },
      portfolio: {
        currentValue: portfolioValue,
        balance,
        currentPrices,
      },
      summary: {
        totalRealizedProfit,
        totalTrades,
        totalVolume,
        avgWinRate: Object.values(symbolReports).reduce((sum, r) => sum + r.tradeMetrics.winRate, 0) / 3,
      },
      symbols: symbolReports,
    };
    
    // Print summary
    this.printReportSummary(fullReport);
    
    // Update and print sentiment correlation analysis
    const correlationData = this.updateSentimentCorrelation(fullReport);
    this.printCorrelationAnalysis(correlationData);
    
    // Save report
    const reportFilename = `weekly-report-${weekRange.endDate}.json`;
    const reportPath = path.join(REPORT_CONFIG.REPORT_DIR, reportFilename);
    fs.writeFileSync(reportPath, JSON.stringify(fullReport, null, 2));
    console.log(`\\n📄 Report saved to: ${reportPath}`);
    
    // Generate markdown report
    const markdownReport = this.generateMarkdownReport(fullReport);
    const mdFilename = `weekly-report-${weekRange.endDate}.md`;
    const mdPath = path.join(REPORT_CONFIG.REPORT_DIR, mdFilename);
    fs.writeFileSync(mdPath, markdownReport);
    console.log(`📄 Markdown report saved to: ${mdPath}`);
    
    return { fullReport, reportPath, mdPath };
  }
  
  printReportSummary(report) {
    console.log('\\n' + '='.repeat(70));
    console.log('  SUMMARY');
    console.log('='.repeat(70));
    
    console.log(`\\n📊 Portfolio Value: $${report.portfolio.currentValue.toFixed(2)}`);
    console.log(`💰 Total Realized Profit: $${report.summary.totalRealizedProfit.toFixed(2)}`);
    console.log(`📈 Total Trades: ${report.summary.totalTrades}`);
    console.log(`💵 Total Volume: $${report.summary.totalVolume.toFixed(2)}`);
    console.log(`🎯 Avg Win Rate: ${report.summary.avgWinRate.toFixed(1)}%`);
    
    console.log('\\n' + '-'.repeat(70));
    console.log('  SENTIMENT ANALYSIS');
    console.log('-'.repeat(70));
    console.log(`\\n📉 Avg Fear & Greed: ${report.sentiment.avgFearGreed.toFixed(1)}`);
    console.log(`😱 Extreme Fear Days: ${report.sentiment.extremeFearDays}`);
    console.log(`🤑 Extreme Greed Days: ${report.sentiment.extremeGreedDays}`);
    
    console.log('\\n' + '-'.repeat(70));
    console.log('  BY SYMBOL');
    console.log('-'.repeat(70));
    
    for (const [symbol, data] of Object.entries(report.symbols)) {
      console.log(`\\n${symbol}:`);
      console.log(`  This Week: ${data.tradeMetrics.totalTrades} trades (${data.tradeMetrics.buyTrades} buys, ${data.tradeMetrics.sellTrades} sells, ${data.tradeMetrics.completedCycles || 0} cycles)`);
      console.log(`  Weekly Volume: $${data.tradeMetrics.totalVolume.toFixed(2)}`);
      console.log(`  Weekly Realized P&L: $${data.tradeMetrics.realizedProfit.toFixed(2)}`);
      if (data.botStats && data.botStats.total_pnl !== undefined) {
        console.log(`  All-Time Stats (from metrics):`);
        console.log(`    - Total Trades: ${data.botStats.total_trades || 0}`);
        console.log(`    - Total P&L: $${(data.botStats.total_pnl || 0).toFixed(2)}`);
        console.log(`    - Win Rate: ${(data.botStats.win_rate || 0).toFixed(1)}%`);
      }
      console.log(`  Sentiment Impact:`);
      console.log(`    - Trades in Extreme Fear: ${data.sentimentImpact.tradesInExtremeFear}`);
      console.log(`    - Trades in Extreme Greed: ${data.sentimentImpact.tradesInExtremeGreed}`);
    }
  }
  
  generateMarkdownReport(report) {
    const { period, sentiment, portfolio, summary, symbols } = report;
    
    let md = `# Weekly Performance Report\\n\\n`;
    md += `**Generated:** ${report.generatedAt}\\n`;
    md += `**Period:** ${period.startDate} to ${period.endDate}\\n\\n`;
    
    md += `---\\n\\n`;
    md += `## Portfolio Summary\\n\\n`;
    md += `| Metric | Value |\\n`;
    md += `|--------|-------|\\n`;
    md += `| **Portfolio Value** | $${portfolio.currentValue.toFixed(2)} |\\n`;
    md += `| **Total Realized Profit** | $${summary.totalRealizedProfit.toFixed(2)} |\\n`;
    md += `| **Total Trades** | ${summary.totalTrades} |\\n`;
    md += `| **Total Volume** | $${summary.totalVolume.toFixed(2)} |\\n`;
    md += `| **Avg Win Rate** | ${summary.avgWinRate.toFixed(1)}% |\\n\\n`;
    
    md += `## Current Holdings\\n\\n`;
    md += `| Asset | Balance | Price | Value |\\n`;
    md += `|-------|---------|-------|-------|\\n`;
    md += `| USD | $${portfolio.balance.USD.toFixed(2)} | - | $${portfolio.balance.USD.toFixed(2)} |\\n`;
    md += `| BTC | ${portfolio.balance.BTC.toFixed(6)} | $${portfolio.currentPrices.BTC.toFixed(2)} | $${(portfolio.balance.BTC * portfolio.currentPrices.BTC).toFixed(2)} |\\n`;
    md += `| ETH | ${portfolio.balance.ETH.toFixed(6)} | $${portfolio.currentPrices.ETH.toFixed(2)} | $${(portfolio.balance.ETH * portfolio.currentPrices.ETH).toFixed(2)} |\\n`;
    md += `| SOL | ${portfolio.balance.SOL.toFixed(6)} | $${portfolio.currentPrices.SOL.toFixed(2)} | $${(portfolio.balance.SOL * portfolio.currentPrices.SOL).toFixed(2)} |\\n\\n`;
    
    md += `## Sentiment Analysis\\n\\n`;
    md += `| Metric | Value |\\n`;
    md += `|--------|-------|\\n`;
    md += `| **Avg Fear & Greed** | ${sentiment.avgFearGreed.toFixed(1)} |\\n`;
    md += `| **Extreme Fear Days** | ${sentiment.extremeFearDays} |\\n`;
    md += `| **Extreme Greed Days** | ${sentiment.extremeGreedDays} |\\n\\n`;
    
    md += `### Daily Fear & Greed Index\\n\\n`;
    md += `| Date | Value | Classification |\\n`;
    md += `|------|-------|----------------|\\n`;
    for (const fg of sentiment.history) {
      md += `| ${fg.date} | ${fg.value} | ${fg.classification} |\\n`;
    }
    md += `\\n`;
    
    md += `## Performance by Symbol\\n\\n`;
    
    for (const [symbol, data] of Object.entries(symbols)) {
      md += `### ${symbol}\\n\\n`;
      md += `| Metric | Value |\\n`;
      md += `|--------|-------|\\n`;
      md += `| Total Trades | ${data.tradeMetrics.totalTrades} |\\n`;
      md += `| Buy Trades | ${data.tradeMetrics.buyTrades} |\\n`;
      md += `| Sell Trades | ${data.tradeMetrics.sellTrades} |\\n`;
      md += `| Total Volume | $${data.tradeMetrics.totalVolume.toFixed(2)} |\\n`;
      md += `| Realized P&L | $${data.tradeMetrics.realizedProfit.toFixed(2)} |\\n`;
      md += `| Win Rate | ${data.tradeMetrics.winRate.toFixed(1)}% |\\n`;
      md += `| Avg Trade Size | $${data.tradeMetrics.avgTradeSize.toFixed(2)} |\\n`;
      md += `| Total Fees | $${data.tradeMetrics.totalFees.toFixed(2)} |\\n\\n`;
      
      md += `**Sentiment Impact:**\\n\\n`;
      md += `| Sentiment Period | Trades |\\n`;
      md += `|------------------|--------|\\n`;
      md += `| Extreme Fear (≤25) | ${data.sentimentImpact.tradesInExtremeFear} |\\n`;
      md += `| Fear (26-40) | ${data.sentimentImpact.tradesInFear} |\\n`;
      md += `| Neutral (41-60) | ${data.sentimentImpact.tradesInNeutral} |\\n`;
      md += `| Greed (61-75) | ${data.sentimentImpact.tradesInGreed} |\\n`;
      md += `| Extreme Greed (≥76) | ${data.sentimentImpact.tradesInExtremeGreed} |\\n\\n`;
    }
    
    md += `---\\n\\n`;
    md += `*Report generated by Weekly Performance Report Generator v1.0*\\n`;
    
    return md;
  }
  
  /**
   * Load historical sentiment correlation data
   */
  loadSentimentHistory() {
    try {
      if (fs.existsSync(REPORT_CONFIG.SENTIMENT_HISTORY_FILE)) {
        const data = fs.readFileSync(REPORT_CONFIG.SENTIMENT_HISTORY_FILE, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.log('⚠️  Could not load sentiment history, starting fresh');
    }
    return { weeks: [], lastUpdated: null };
  }
  
  /**
   * Save sentiment correlation data
   */
  saveSentimentHistory(history) {
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(REPORT_CONFIG.SENTIMENT_HISTORY_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      fs.writeFileSync(REPORT_CONFIG.SENTIMENT_HISTORY_FILE, JSON.stringify(history, null, 2));
    } catch (error) {
      console.error('Error saving sentiment history:', error.message);
    }
  }
  
  /**
   * Calculate correlation coefficient between two arrays
   */
  calculateCorrelation(x, y) {
    if (x.length !== y.length || x.length < 2) return null;
    
    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((total, xi, i) => total + xi * y[i], 0);
    const sumX2 = x.reduce((total, xi) => total + xi * xi, 0);
    const sumY2 = y.reduce((total, yi) => total + yi * yi, 0);
    
    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    
    if (denominator === 0) return null;
    return numerator / denominator;
  }
  
  /**
   * Update sentiment history with current week's data and calculate correlations
   */
  updateSentimentCorrelation(report) {
    const history = this.loadSentimentHistory();
    
    // Create this week's entry
    const weekEntry = {
      weekEnding: report.period.endDate,
      avgFearGreed: report.sentiment.avgFearGreed,
      extremeFearDays: report.sentiment.extremeFearDays,
      extremeGreedDays: report.sentiment.extremeGreedDays,
      symbols: {},
      totals: {
        trades: report.summary.totalTrades,
        pnl: report.summary.totalRealizedProfit,
        volume: report.summary.totalVolume,
        fearTrades: 0,
        greedTrades: 0,
      }
    };
    
    // Add per-symbol data
    for (const [symbol, data] of Object.entries(report.symbols)) {
      weekEntry.symbols[symbol] = {
        trades: data.tradeMetrics.totalTrades,
        pnl: data.tradeMetrics.realizedProfit,
        fearTrades: data.sentimentImpact.tradesInExtremeFear,
        greedTrades: data.sentimentImpact.tradesInExtremeGreed,
        pnlPerTrade: data.tradeMetrics.totalTrades > 0 
          ? data.tradeMetrics.realizedProfit / data.tradeMetrics.totalTrades 
          : 0,
      };
      weekEntry.totals.fearTrades += data.sentimentImpact.tradesInExtremeFear;
      weekEntry.totals.greedTrades += data.sentimentImpact.tradesInExtremeGreed;
    }
    
    // Check if this week already exists (update) or is new (append)
    const existingIndex = history.weeks.findIndex(w => w.weekEnding === weekEntry.weekEnding);
    if (existingIndex >= 0) {
      history.weeks[existingIndex] = weekEntry;
    } else {
      history.weeks.push(weekEntry);
      // Keep last 52 weeks (1 year)
      if (history.weeks.length > 52) {
        history.weeks = history.weeks.slice(-52);
      }
    }
    
    history.lastUpdated = new Date().toISOString();
    
    // Calculate correlations if we have enough data
    const correlations = this.calculateHistoricalCorrelations(history.weeks);
    history.correlations = correlations;
    
    this.saveSentimentHistory(history);
    
    return { history, correlations };
  }
  
  /**
   * Calculate correlations across all historical weeks
   */
  calculateHistoricalCorrelations(weeks) {
    if (weeks.length < 2) {
      return { 
        dataPoints: weeks.length,
        message: 'Need at least 2 weeks of data for correlation analysis',
        fearTradesVsPnl: null,
        avgFearGreedVsPnl: null,
        extremeFearDaysVsPnl: null,
      };
    }
    
    // Extract arrays for correlation
    const fearTrades = weeks.map(w => w.totals.fearTrades);
    const pnl = weeks.map(w => w.totals.pnl);
    const avgFearGreed = weeks.map(w => w.avgFearGreed);
    const extremeFearDays = weeks.map(w => w.extremeFearDays);
    const totalTrades = weeks.map(w => w.totals.trades);
    
    // Calculate correlations
    const fearTradesVsPnl = this.calculateCorrelation(fearTrades, pnl);
    const avgFearGreedVsPnl = this.calculateCorrelation(avgFearGreed, pnl);
    const extremeFearDaysVsPnl = this.calculateCorrelation(extremeFearDays, pnl);
    const tradesVsPnl = this.calculateCorrelation(totalTrades, pnl);
    
    // Per-symbol correlations
    const symbolCorrelations = {};
    for (const symbol of REPORT_CONFIG.SYMBOLS) {
      const symbolFearTrades = weeks.map(w => w.symbols[symbol]?.fearTrades || 0);
      const symbolPnl = weeks.map(w => w.symbols[symbol]?.pnl || 0);
      symbolCorrelations[symbol] = {
        fearTradesVsPnl: this.calculateCorrelation(symbolFearTrades, symbolPnl),
      };
    }
    
    return {
      dataPoints: weeks.length,
      overall: {
        fearTradesVsPnl: fearTradesVsPnl !== null ? parseFloat(fearTradesVsPnl.toFixed(4)) : null,
        avgFearGreedVsPnl: avgFearGreedVsPnl !== null ? parseFloat(avgFearGreedVsPnl.toFixed(4)) : null,
        extremeFearDaysVsPnl: extremeFearDaysVsPnl !== null ? parseFloat(extremeFearDaysVsPnl.toFixed(4)) : null,
        tradesVsPnl: tradesVsPnl !== null ? parseFloat(tradesVsPnl.toFixed(4)) : null,
      },
      bySymbol: symbolCorrelations,
      interpretation: this.interpretCorrelations(fearTradesVsPnl, avgFearGreedVsPnl),
    };
  }
  
  /**
   * Generate human-readable interpretation of correlations
   */
  interpretCorrelations(fearTradesVsPnl, avgFearGreedVsPnl) {
    const interpretations = [];
    
    if (fearTradesVsPnl !== null) {
      if (fearTradesVsPnl > 0.7) {
        interpretations.push('✅ STRONG POSITIVE: More trades during Extreme Fear strongly correlates with higher profits');
      } else if (fearTradesVsPnl > 0.3) {
        interpretations.push('📊 MODERATE POSITIVE: Some relationship between fear trading and profits');
      } else if (fearTradesVsPnl > -0.3) {
        interpretations.push('⚪ WEAK/NO CORRELATION: Fear trading does not strongly predict profits');
      } else {
        interpretations.push('❌ NEGATIVE: More fear trades may correlate with lower profits');
      }
    }
    
    if (avgFearGreedVsPnl !== null) {
      if (avgFearGreedVsPnl < -0.5) {
        interpretations.push('📉 Lower Fear & Greed index (more fear) correlates with higher profits');
      } else if (avgFearGreedVsPnl > 0.5) {
        interpretations.push('📈 Higher Fear & Greed index (more greed) correlates with higher profits');
      }
    }
    
    return interpretations;
  }
  
  /**
   * Print sentiment correlation analysis
   */
  printCorrelationAnalysis(correlationData) {
    console.log('\n' + '-'.repeat(70));
    console.log('  HISTORICAL SENTIMENT CORRELATION ANALYSIS');
    console.log('-'.repeat(70));
    
    const { history, correlations } = correlationData;
    
    console.log(`\n📊 Data Points: ${correlations.dataPoints} weeks`);
    
    if (correlations.dataPoints < 2) {
      console.log(`⚠️  ${correlations.message}`);
      console.log('   Run weekly reports over time to build correlation data.');
      return;
    }
    
    console.log('\n📈 Overall Correlations:');
    console.log(`   Fear Trades vs P&L:        ${correlations.overall.fearTradesVsPnl !== null ? correlations.overall.fearTradesVsPnl.toFixed(4) : 'N/A'}`);
    console.log(`   Avg Fear&Greed vs P&L:     ${correlations.overall.avgFearGreedVsPnl !== null ? correlations.overall.avgFearGreedVsPnl.toFixed(4) : 'N/A'}`);
    console.log(`   Extreme Fear Days vs P&L:  ${correlations.overall.extremeFearDaysVsPnl !== null ? correlations.overall.extremeFearDaysVsPnl.toFixed(4) : 'N/A'}`);
    console.log(`   Total Trades vs P&L:       ${correlations.overall.tradesVsPnl !== null ? correlations.overall.tradesVsPnl.toFixed(4) : 'N/A'}`);
    
    console.log('\n📊 By Symbol (Fear Trades vs P&L):');
    for (const [symbol, data] of Object.entries(correlations.bySymbol)) {
      const corr = data.fearTradesVsPnl;
      console.log(`   ${symbol}: ${corr !== null ? corr.toFixed(4) : 'N/A'}`);
    }
    
    if (correlations.interpretation && correlations.interpretation.length > 0) {
      console.log('\n💡 Interpretation:');
      for (const interp of correlations.interpretation) {
        console.log(`   ${interp}`);
      }
    }
    
    // Show trend over last few weeks
    if (history.weeks.length >= 2) {
      console.log('\n📅 Recent Weeks Summary:');
      const recentWeeks = history.weeks.slice(-4);
      console.log('   Week Ending     | Fear Trades | P&L      | Avg F&G');
      console.log('   ' + '-'.repeat(55));
      for (const week of recentWeeks) {
        console.log(`   ${week.weekEnding}  | ${String(week.totals.fearTrades).padStart(11)} | $${week.totals.pnl.toFixed(2).padStart(7)} | ${week.avgFearGreed.toFixed(1)}`);
      }
    }
  }
  
  /**
   * Send weekly report via email
   */
  async sendEmail(markdownReport, summary) {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
    
    const weekEnding = new Date().toLocaleDateString('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    
    // Create a plain text summary for email
    const emailBody = `
======================================================================
  WEEKLY PERFORMANCE REPORT
  Week Ending: ${weekEnding}
======================================================================

📊 SUMMARY
-----------
Portfolio Value: $${summary.portfolioValue.toFixed(2)}
Weekly Realized P&L: $${summary.totalRealizedProfit.toFixed(2)}
Total Trades: ${summary.totalTrades}
Total Volume: $${summary.totalVolume.toFixed(2)}
Avg Win Rate: ${summary.avgWinRate.toFixed(1)}%

📉 SENTIMENT
------------
Avg Fear & Greed: ${summary.avgFearGreed.toFixed(1)}
Extreme Fear Days: ${summary.extremeFearDays}
Extreme Greed Days: ${summary.extremeGreedDays}

📈 BY SYMBOL
------------
${Object.entries(summary.symbols).map(([symbol, data]) => `
${symbol}:
  Trades: ${data.trades} (${data.buys} buys, ${data.sells} sells)
  Weekly P&L: $${data.pnl.toFixed(2)}
  Fear Trades: ${data.fearTrades}
`).join('')}

----------------------------------------------------------------------
Full report saved to: ${summary.reportPath}
----------------------------------------------------------------------
`;
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: REPORT_CONFIG.EMAIL_TO,
      subject: `📊 Weekly Bot Report - Week Ending ${weekEnding}`,
      text: emailBody,
    };
    
    try {
      await transporter.sendMail(mailOptions);
      console.log('\n✅ Email sent successfully to', REPORT_CONFIG.EMAIL_TO);
      return true;
    } catch (error) {
      console.error('\n❌ Failed to send email:', error.message);
      return false;
    }
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const skipEmail = args.includes('--no-email');
  
  const generator = new WeeklyReportGenerator();
  await generator.init();
  const result = await generator.generateReport();
  
  // Send email if not skipped
  if (!skipEmail) {
    const summary = {
      portfolioValue: result.fullReport.portfolio.currentValue,
      totalRealizedProfit: result.fullReport.summary.totalRealizedProfit,
      totalTrades: result.fullReport.summary.totalTrades,
      totalVolume: result.fullReport.summary.totalVolume,
      avgWinRate: result.fullReport.summary.avgWinRate,
      avgFearGreed: result.fullReport.sentiment.avgFearGreed,
      extremeFearDays: result.fullReport.sentiment.extremeFearDays,
      extremeGreedDays: result.fullReport.sentiment.extremeGreedDays,
      symbols: {},
      reportPath: result.reportPath,
    };
    
    for (const [symbol, data] of Object.entries(result.fullReport.symbols)) {
      summary.symbols[symbol] = {
        trades: data.tradeMetrics.totalTrades,
        buys: data.tradeMetrics.buyTrades,
        sells: data.tradeMetrics.sellTrades,
        pnl: data.tradeMetrics.realizedProfit,
        fearTrades: data.sentimentImpact.tradesInExtremeFear,
      };
    }
    
    await generator.sendEmail(result.mdPath, summary);
  }
  
  console.log('\n✅ Weekly report generation complete!');
  return result;
}

main().catch(console.error);

export { WeeklyReportGenerator };
