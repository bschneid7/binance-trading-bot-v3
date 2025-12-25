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

const REPORT_CONFIG = {
  SYMBOLS: ['BTC', 'ETH', 'SOL'],
  BOT_NAMES: {
    BTC: 'live-btc-bot',
    ETH: 'live-eth-bot',
    SOL: 'live-sol-bot',
  },
  REPORT_DIR: '/home/ubuntu/binance-trading-bot-v3/reports/weekly',
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
      };
    }
    
    const buyTrades = trades.filter(t => t.side === 'buy');
    const sellTrades = trades.filter(t => t.side === 'sell');
    
    const totalVolume = trades.reduce((sum, t) => sum + (t.price * t.amount), 0);
    const totalFees = trades.reduce((sum, t) => sum + (t.fee || 0), 0);
    
    // Calculate realized profit (simplified - pairs buys with sells)
    let realizedProfit = 0;
    const buyQueue = [...buyTrades];
    for (const sell of sellTrades) {
      if (buyQueue.length > 0) {
        const buy = buyQueue.shift();
        realizedProfit += (sell.price - buy.price) * Math.min(buy.amount, sell.amount);
      }
    }
    
    // Win rate
    let wins = 0;
    const buyQueueForWinRate = [...buyTrades];
    for (const sell of sellTrades) {
      if (buyQueueForWinRate.length > 0) {
        const buy = buyQueueForWinRate.shift();
        if (sell.price > buy.price) wins++;
      }
    }
    const winRate = sellTrades.length > 0 ? (wins / sellTrades.length) * 100 : 0;
    
    return {
      totalTrades: trades.length,
      buyTrades: buyTrades.length,
      sellTrades: sellTrades.length,
      totalVolume,
      realizedProfit,
      avgTradeSize: totalVolume / trades.length,
      winRate,
      totalFees,
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
      console.log(`  This Week: ${data.tradeMetrics.totalTrades} trades (${data.tradeMetrics.buyTrades} buys, ${data.tradeMetrics.sellTrades} sells)`);
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
}

// Main execution
async function main() {
  const generator = new WeeklyReportGenerator();
  await generator.init();
  const result = await generator.generateReport();
  console.log('\\n✅ Weekly report generation complete!');
  return result;
}

main().catch(console.error);

export { WeeklyReportGenerator };
