/**
 * DCA Dip Buyer Module
 * Monitors for significant price dips and buys automatically
 * Sells when price recovers for profit
 */

import 'dotenv/config';
import ccxt from 'ccxt';
import { getDatabase } from './database.mjs';
import { SentimentIntegration } from './sentiment-integration.mjs';

// Configuration
const DIP_CONFIG = {
  // Symbols to monitor for dips
  SYMBOLS: ['BTC/USD', 'ETH/USD', 'SOL/USD'],
  
  // Dip detection
  DIP_THRESHOLD: -3.0,        // Buy when price drops 3% in lookback period
  LOOKBACK_MINUTES: 60,       // Look back 1 hour for dip detection
  
  // Position management
  MAX_POSITION_USD: 300,      // Max position size per symbol
  ORDER_SIZE_USD: 100,        // Size of each buy order
  MAX_TOTAL_DEPLOYED: 1000,   // Max total capital for dip buying
  
  // Take profit / stop loss
  TAKE_PROFIT_PCT: 2.5,       // Sell when up 2.5%
  STOP_LOSS_PCT: -5.0,        // Sell when down 5%
  
  // Timing
  CHECK_INTERVAL_MS: 30000,   // Check every 30 seconds
  MIN_TIME_BETWEEN_BUYS: 300000, // 5 minutes between buys of same symbol
  
  // Reserve protection
  MIN_USD_RESERVE: 1200,      // Always keep this much USD for grid operations
  
  // Sentiment integration
  USE_SENTIMENT: true,        // Enable sentiment-based adjustments
  SENTIMENT_UPDATE_INTERVAL: 15 * 60 * 1000, // 15 minutes
};

export class DipBuyer {
  constructor(options = {}) {
    this.config = { ...DIP_CONFIG, ...options };
    this.exchange = null;
    this.db = null;
    this.priceHistory = {}; // { symbol: [{ time, price }] }
    this.positions = {};    // { symbol: { entryPrice, amount, entryTime } }
    this.lastBuyTime = {};  // { symbol: timestamp }
    this.stats = {
      dipsDetected: 0,
      buyOrders: 0,
      sellOrders: 0,
      totalProfit: 0,
      totalDeployed: 0,
      sentimentAdjustedBuys: 0,
    };
    this.running = false;
    
    // Sentiment integration
    this.sentimentIntegration = null;
    this.lastSentimentUpdate = 0;
  }
  
  async init() {
    this.exchange = new ccxt.binanceus({
      apiKey: process.env.BINANCE_API_KEY,
      secret: process.env.BINANCE_API_SECRET,
      enableRateLimit: true,
    });
    
    this.db = getDatabase();
    
    // Initialize price history for each symbol
    for (const symbol of this.config.SYMBOLS) {
      this.priceHistory[symbol] = [];
      this.lastBuyTime[symbol] = 0;
    }
    
    // Load existing positions from database
    await this.loadPositions();
    
    console.log('💰 Dip Buyer initialized');
    console.log(`   Symbols: ${this.config.SYMBOLS.join(', ')}`);
    console.log(`   Dip threshold: ${this.config.DIP_THRESHOLD}%`);
    console.log(`   Order size: $${this.config.ORDER_SIZE_USD}`);
    console.log(`   Take profit: ${this.config.TAKE_PROFIT_PCT}%`);
    console.log(`   Stop loss: ${this.config.STOP_LOSS_PCT}%`);
    
    // Initialize sentiment integration
    if (this.config.USE_SENTIMENT) {
      await this.initSentiment();
    }
  }
  
  async initSentiment() {
    try {
      console.log('\n🧠 Initializing sentiment analysis for Dip Buyer...');
      
      this.sentimentIntegration = new SentimentIntegration({
        ENABLED: true,
        UPDATE_INTERVAL: this.config.SENTIMENT_UPDATE_INTERVAL,
      });
      
      await this.sentimentIntegration.init();
      this.lastSentimentUpdate = Date.now();
      
      // Log initial sentiment
      const summary = this.sentimentIntegration.getSummary();
      console.log(`   Fear & Greed: ${summary.fearGreed?.value || 'N/A'} (${summary.fearGreed?.classification || 'N/A'})`);
      
      for (const symbol of this.config.SYMBOLS) {
        const baseSymbol = symbol.split('/')[0];
        const rec = this.sentimentIntegration.getRecommendation(baseSymbol);
        console.log(`   ${baseSymbol}: ${rec.score}/100 - Dip Buyer Multiplier: ${(rec.dipBuyerMultiplier * 100).toFixed(0)}%`);
      }
      
    } catch (error) {
      console.error(`❌ Failed to initialize sentiment: ${error.message}`);
      this.sentimentIntegration = null;
    }
  }
  
  async updateSentiment() {
    if (!this.sentimentIntegration) return;
    
    const timeSinceUpdate = Date.now() - this.lastSentimentUpdate;
    if (timeSinceUpdate < this.config.SENTIMENT_UPDATE_INTERVAL) return;
    
    try {
      await this.sentimentIntegration.update();
      this.lastSentimentUpdate = Date.now();
      console.log('\n🧠 Sentiment updated');
    } catch (error) {
      console.error(`❌ Sentiment update failed: ${error.message}`);
    }
  }
  
  getSentimentAdjustedOrderSize(symbol) {
    if (!this.sentimentIntegration) {
      return this.config.ORDER_SIZE_USD;
    }
    
    const baseSymbol = symbol.split('/')[0];
    const multiplier = this.sentimentIntegration.getDipBuyerMultiplier(baseSymbol);
    const adjustedSize = this.config.ORDER_SIZE_USD * multiplier;
    
    if (multiplier !== 1.0) {
      console.log(`   🧠 Sentiment adjustment: ${(multiplier * 100).toFixed(0)}% ($${this.config.ORDER_SIZE_USD} → $${adjustedSize.toFixed(2)})`);
      this.stats.sentimentAdjustedBuys++;
    }
    
    return adjustedSize;
  }
  
  async loadPositions() {
    // Create dip_positions table if not exists
    this.db.db.exec(`
      CREATE TABLE IF NOT EXISTS dip_positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        entry_price REAL NOT NULL,
        amount REAL NOT NULL,
        entry_time TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        exit_price REAL,
        exit_time TEXT,
        profit REAL
      )
    `);
    
    // Load open positions
    const openPositions = this.db.db.prepare(
      "SELECT * FROM dip_positions WHERE status = 'open'"
    ).all();
    
    for (const pos of openPositions) {
      this.positions[pos.symbol] = {
        id: pos.id,
        entryPrice: pos.entry_price,
        amount: pos.amount,
        entryTime: new Date(pos.entry_time),
      };
      this.stats.totalDeployed += pos.entry_price * pos.amount;
    }
    
    if (openPositions.length > 0) {
      console.log(`   Loaded ${openPositions.length} open dip positions`);
    }
  }
  
  async checkAvailableCapital() {
    const balance = await this.exchange.fetchBalance();
    const availableUSD = balance.free['USD'] || 0;
    
    // Calculate how much we can use (keeping reserve for grids)
    const usableCapital = Math.max(0, availableUSD - this.config.MIN_USD_RESERVE);
    
    // Also respect max total deployed limit
    const remainingBudget = this.config.MAX_TOTAL_DEPLOYED - this.stats.totalDeployed;
    
    return Math.min(usableCapital, remainingBudget);
  }
  
  async updatePriceHistory(symbol) {
    try {
      const ticker = await this.exchange.fetchTicker(symbol);
      const now = Date.now();
      
      this.priceHistory[symbol].push({
        time: now,
        price: ticker.last,
      });
      
      // Keep only last 2 hours of data
      const cutoff = now - (120 * 60 * 1000);
      this.priceHistory[symbol] = this.priceHistory[symbol].filter(p => p.time > cutoff);
      
      return ticker.last;
    } catch (e) {
      console.error(`   ⚠️ Error fetching ${symbol} price: ${e.message}`);
      return null;
    }
  }
  
  detectDip(symbol) {
    const history = this.priceHistory[symbol];
    if (history.length < 2) return null;
    
    const now = Date.now();
    const lookbackTime = now - (this.config.LOOKBACK_MINUTES * 60 * 1000);
    
    // Find price from lookback period
    const oldPrices = history.filter(p => p.time <= lookbackTime);
    if (oldPrices.length === 0) return null;
    
    const oldPrice = oldPrices[oldPrices.length - 1].price;
    const currentPrice = history[history.length - 1].price;
    
    const changePercent = ((currentPrice - oldPrice) / oldPrice) * 100;
    
    if (changePercent <= this.config.DIP_THRESHOLD) {
      return {
        symbol,
        oldPrice,
        currentPrice,
        changePercent,
      };
    }
    
    return null;
  }
  
  async buyDip(symbol, currentPrice) {
    // Check if we can buy
    const availableCapital = await this.checkAvailableCapital();
    if (availableCapital < this.config.ORDER_SIZE_USD) {
      console.log(`   ⚠️ Insufficient capital for dip buy ($${availableCapital.toFixed(2)} available)`);
      return false;
    }
    
    // Check if we already have max position in this symbol
    if (this.positions[symbol]) {
      const existingValue = this.positions[symbol].entryPrice * this.positions[symbol].amount;
      if (existingValue >= this.config.MAX_POSITION_USD) {
        console.log(`   ⚠️ Max position reached for ${symbol}`);
        return false;
      }
    }
    
    // Check time since last buy
    const timeSinceLastBuy = Date.now() - (this.lastBuyTime[symbol] || 0);
    if (timeSinceLastBuy < this.config.MIN_TIME_BETWEEN_BUYS) {
      console.log(`   ⚠️ Too soon since last ${symbol} buy`);
      return false;
    }
    
    try {
      // Get sentiment-adjusted order size
      const orderSizeUSD = this.getSentimentAdjustedOrderSize(symbol);
      const amount = orderSizeUSD / currentPrice;
      
      console.log(`   🛒 Buying dip: ${amount.toFixed(6)} ${symbol.split('/')[0]} at $${currentPrice.toFixed(2)}`);
      
      const order = await this.exchange.createMarketBuyOrder(symbol, amount);
      
      const filledPrice = order.average || currentPrice;
      const filledAmount = order.filled || amount;
      
      // Update or create position
      if (this.positions[symbol]) {
        // Average into existing position
        const existing = this.positions[symbol];
        const totalAmount = existing.amount + filledAmount;
        const avgPrice = ((existing.entryPrice * existing.amount) + (filledPrice * filledAmount)) / totalAmount;
        
        this.positions[symbol].amount = totalAmount;
        this.positions[symbol].entryPrice = avgPrice;
        
        // Update database
        this.db.db.prepare(
          'UPDATE dip_positions SET entry_price = ?, amount = ? WHERE id = ?'
        ).run(avgPrice, totalAmount, existing.id);
      } else {
        // Create new position
        const result = this.db.db.prepare(
          'INSERT INTO dip_positions (symbol, entry_price, amount, entry_time) VALUES (?, ?, ?, ?)'
        ).run(symbol, filledPrice, filledAmount, new Date().toISOString());
        
        this.positions[symbol] = {
          id: result.lastInsertRowid,
          entryPrice: filledPrice,
          amount: filledAmount,
          entryTime: new Date(),
        };
      }
      
      this.lastBuyTime[symbol] = Date.now();
      this.stats.buyOrders++;
      this.stats.totalDeployed += filledPrice * filledAmount;
      
      console.log(`   ✅ Bought ${filledAmount.toFixed(6)} ${symbol.split('/')[0]} at $${filledPrice.toFixed(2)}`);
      
      return true;
    } catch (e) {
      console.error(`   ❌ Buy failed: ${e.message}`);
      return false;
    }
  }
  
  async checkPositionForExit(symbol, currentPrice) {
    const position = this.positions[symbol];
    if (!position) return;
    
    const pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
    
    // Check take profit
    if (pnlPercent >= this.config.TAKE_PROFIT_PCT) {
      console.log(`   📈 Take profit triggered for ${symbol} (+${pnlPercent.toFixed(2)}%)`);
      await this.closePosition(symbol, currentPrice, 'take_profit');
      return;
    }
    
    // Check stop loss
    if (pnlPercent <= this.config.STOP_LOSS_PCT) {
      console.log(`   📉 Stop loss triggered for ${symbol} (${pnlPercent.toFixed(2)}%)`);
      await this.closePosition(symbol, currentPrice, 'stop_loss');
      return;
    }
  }
  
  async closePosition(symbol, currentPrice, reason) {
    const position = this.positions[symbol];
    if (!position) return;
    
    try {
      console.log(`   💰 Closing ${symbol} position (${reason})`);
      
      const order = await this.exchange.createMarketSellOrder(symbol, position.amount);
      
      const filledPrice = order.average || currentPrice;
      const profit = (filledPrice - position.entryPrice) * position.amount;
      
      // Update database
      this.db.db.prepare(
        'UPDATE dip_positions SET status = ?, exit_price = ?, exit_time = ?, profit = ? WHERE id = ?'
      ).run('closed', filledPrice, new Date().toISOString(), profit, position.id);
      
      this.stats.sellOrders++;
      this.stats.totalProfit += profit;
      this.stats.totalDeployed -= position.entryPrice * position.amount;
      
      delete this.positions[symbol];
      
      console.log(`   ✅ Sold ${position.amount.toFixed(6)} ${symbol.split('/')[0]} at $${filledPrice.toFixed(2)}`);
      console.log(`   💵 Profit: $${profit.toFixed(2)}`);
      
      return true;
    } catch (e) {
      console.error(`   ❌ Sell failed: ${e.message}`);
      return false;
    }
  }
  
  async runCycle() {
    // Update sentiment if needed
    if (this.config.USE_SENTIMENT) {
      await this.updateSentiment();
    }
    
    for (const symbol of this.config.SYMBOLS) {
      // Update price history
      const currentPrice = await this.updatePriceHistory(symbol);
      if (!currentPrice) continue;
      
      // Check existing position for exit
      await this.checkPositionForExit(symbol, currentPrice);
      
      // Check for dip
      const dip = this.detectDip(symbol);
      if (dip) {
        this.stats.dipsDetected++;
        console.log(`\n🔻 DIP DETECTED: ${symbol}`);
        console.log(`   Price dropped ${dip.changePercent.toFixed(2)}% in ${this.config.LOOKBACK_MINUTES} min`);
        console.log(`   From $${dip.oldPrice.toFixed(2)} to $${dip.currentPrice.toFixed(2)}`);
        
        await this.buyDip(symbol, currentPrice);
      }
      
      // Small delay between symbols
      await new Promise(r => setTimeout(r, 500));
    }
  }
  
  async start() {
    if (this.running) return;
    this.running = true;
    
    console.log('\n🚀 Starting Dip Buyer...');
    
    // Initial price fetch
    for (const symbol of this.config.SYMBOLS) {
      await this.updatePriceHistory(symbol);
    }
    
    // Main loop
    while (this.running) {
      try {
        await this.runCycle();
      } catch (e) {
        console.error(`❌ Cycle error: ${e.message}`);
      }
      
      await new Promise(r => setTimeout(r, this.config.CHECK_INTERVAL_MS));
    }
  }
  
  stop() {
    this.running = false;
    
    // Stop sentiment integration
    if (this.sentimentIntegration) {
      this.sentimentIntegration.stop();
    }
    
    console.log('\n🛑 Dip Buyer stopped');
    this.printStats();
  }
  
  printStats() {
    console.log('\n' + '═'.repeat(50));
    console.log('  DIP BUYER STATISTICS');
    console.log('═'.repeat(50));
    console.log(`  Dips Detected: ${this.stats.dipsDetected}`);
    console.log(`  Buy Orders: ${this.stats.buyOrders}`);
    console.log(`  Sell Orders: ${this.stats.sellOrders}`);
    console.log(`  Total Profit: $${this.stats.totalProfit.toFixed(2)}`);
    console.log(`  Currently Deployed: $${this.stats.totalDeployed.toFixed(2)}`);
    console.log(`  Sentiment-Adjusted Buys: ${this.stats.sentimentAdjustedBuys}`);
    
    // Show current sentiment if available
    if (this.sentimentIntegration) {
      const summary = this.sentimentIntegration.getSummary();
      console.log(`\n  Current Sentiment:`);
      console.log(`    Fear & Greed: ${summary.fearGreed?.value || 'N/A'} (${summary.fearGreed?.classification || 'N/A'})`);
    }
    
    // Show open positions
    const openPositions = Object.entries(this.positions);
    if (openPositions.length > 0) {
      console.log('\n  Open Positions:');
      for (const [symbol, pos] of openPositions) {
        const value = pos.entryPrice * pos.amount;
        console.log(`    ${symbol}: ${pos.amount.toFixed(6)} @ $${pos.entryPrice.toFixed(2)} ($${value.toFixed(2)})`);
      }
    }
    
    console.log('═'.repeat(50));
  }
  
  getStats() {
    return { ...this.stats };
  }
  
  getPositions() {
    return { ...this.positions };
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const dipBuyer = new DipBuyer();
  
  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('\n\nReceived SIGINT, shutting down...');
    dipBuyer.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    console.log('\n\nReceived SIGTERM, shutting down...');
    dipBuyer.stop();
    process.exit(0);
  });
  
  // Start
  await dipBuyer.init();
  await dipBuyer.start();
}

export default DipBuyer;
