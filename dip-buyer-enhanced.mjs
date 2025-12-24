/**
 * Enhanced DCA Dip Buyer Module v2.0
 * Supports multi-tier dip detection and aggressive flash crash accumulation
 * 
 * Features:
 * - Multi-tier dip detection (3%, 5%, 8%, 12%)
 * - Dynamic order sizing based on dip severity
 * - Trailing stop loss
 * - Support level targeting
 * - Flash crash rapid-fire mode
 * - Symbol weighting (prioritize best performers)
 * 
 * Created: December 24, 2025
 */

import 'dotenv/config';
import ccxt from 'ccxt';
import { getDatabase } from './database.mjs';
import { AGGRESSIVE_DIP_CONFIG } from './dip-buyer-aggressive.config.mjs';

export class EnhancedDipBuyer {
  constructor(options = {}) {
    this.config = { ...AGGRESSIVE_DIP_CONFIG, ...options };
    this.exchange = null;
    this.db = null;
    this.priceHistory = {};
    this.positions = {};
    this.lastBuyTime = {};
    this.highestPriceSinceBuy = {}; // For trailing stop
    this.rapidBuyCount = {};        // Track rapid buys per flash crash
    this.flashCrashActive = {};     // Track active flash crash events
    this.stats = {
      dipsDetected: 0,
      buyOrders: 0,
      sellOrders: 0,
      totalProfit: 0,
      totalDeployed: 0,
      flashCrashEvents: 0,
      trailingStopTriggers: 0,
      supportLevelBuys: 0,
    };
    this.running = false;
  }
  
  async init() {
    this.exchange = new ccxt.binanceus({
      apiKey: process.env.BINANCE_API_KEY,
      secret: process.env.BINANCE_API_SECRET,
      enableRateLimit: true,
    });
    
    this.db = getDatabase();
    
    for (const symbol of this.config.SYMBOLS) {
      this.priceHistory[symbol] = [];
      this.lastBuyTime[symbol] = 0;
      this.highestPriceSinceBuy[symbol] = 0;
      this.rapidBuyCount[symbol] = 0;
      this.flashCrashActive[symbol] = false;
    }
    
    await this.loadPositions();
    
    console.log('💰 Enhanced Dip Buyer v2.0 initialized');
    console.log('   Mode: AGGRESSIVE FLASH CRASH');
    console.log(`   Symbols: ${this.config.SYMBOLS.join(', ')}`);
    console.log(`   Dip Tiers: -3%, -5%, -8%, -12%`);
    console.log(`   Max Deployed: $${this.config.MAX_TOTAL_DEPLOYED}`);
    console.log(`   Flash Crash Mode: ${this.config.FLASH_CRASH_MODE.ENABLED ? 'ENABLED' : 'DISABLED'}`);
    console.log(`   Trailing Stop: ${this.config.TRAILING_STOP.ENABLED ? 'ENABLED' : 'DISABLED'}`);
  }
  
  async loadPositions() {
    this.db.db.exec(`
      CREATE TABLE IF NOT EXISTS dip_positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        entry_price REAL NOT NULL,
        amount REAL NOT NULL,
        entry_time TEXT NOT NULL,
        entry_tier INTEGER DEFAULT 1,
        status TEXT DEFAULT 'open',
        exit_price REAL,
        exit_time TEXT,
        profit REAL,
        exit_reason TEXT
      )
    `);
    
    const openPositions = this.db.db.prepare(
      "SELECT * FROM dip_positions WHERE status = 'open'"
    ).all();
    
    for (const pos of openPositions) {
      this.positions[pos.symbol] = {
        id: pos.id,
        entryPrice: pos.entry_price,
        amount: pos.amount,
        entryTime: new Date(pos.entry_time),
        entryTier: pos.entry_tier || 1,
      };
      this.stats.totalDeployed += pos.entry_price * pos.amount;
      this.highestPriceSinceBuy[pos.symbol] = pos.entry_price;
    }
    
    if (openPositions.length > 0) {
      console.log(`   Loaded ${openPositions.length} open dip positions`);
    }
  }
  
  /**
   * Detect which dip tier has been triggered
   * Returns: { tier: 1-4, threshold, orderSize, lookbackMinutes } or null
   */
  detectDipTier(symbol) {
    const history = this.priceHistory[symbol];
    if (history.length < 2) return null;
    
    const now = Date.now();
    const currentPrice = history[history.length - 1].price;
    
    // Check each tier from highest to lowest (most aggressive first)
    const tiers = [
      { tier: 4, ...this.config.DIP_TIER_4 },
      { tier: 3, ...this.config.DIP_TIER_3 },
      { tier: 2, ...this.config.DIP_TIER_2 },
      { tier: 1, ...this.config.DIP_TIER_1 },
    ];
    
    for (const tierConfig of tiers) {
      const lookbackTime = now - (tierConfig.LOOKBACK_MINUTES * 60 * 1000);
      const oldPrices = history.filter(p => p.time <= lookbackTime);
      
      if (oldPrices.length === 0) continue;
      
      const oldPrice = oldPrices[oldPrices.length - 1].price;
      const changePercent = ((currentPrice - oldPrice) / oldPrice) * 100;
      
      if (changePercent <= tierConfig.THRESHOLD) {
        return {
          tier: tierConfig.tier,
          threshold: tierConfig.THRESHOLD,
          orderSize: tierConfig.ORDER_SIZE_USD,
          lookbackMinutes: tierConfig.LOOKBACK_MINUTES,
          changePercent,
          oldPrice,
          currentPrice,
        };
      }
    }
    
    return null;
  }
  
  /**
   * Check if price is near a support level and return bonus multiplier
   */
  getSupportLevelBonus(symbol, currentPrice) {
    const supports = this.config.SUPPORT_LEVELS[symbol];
    if (!supports) return 1.0;
    
    const tolerance = 0.02; // 2% tolerance around support
    
    for (let i = 0; i < supports.length; i++) {
      const support = supports[i];
      const lowerBound = support * (1 - tolerance);
      const upperBound = support * (1 + tolerance);
      
      if (currentPrice >= lowerBound && currentPrice <= upperBound) {
        const bonusKey = `LEVEL_${i + 1}`;
        const bonus = this.config.SUPPORT_LEVEL_BONUS[bonusKey] || 1.0;
        console.log(`   📍 Near support level ${i + 1} ($${support}) - ${bonus}x bonus`);
        this.stats.supportLevelBuys++;
        return bonus;
      }
    }
    
    return 1.0;
  }
  
  /**
   * Calculate order size based on tier, symbol weight, and support level
   */
  calculateOrderSize(symbol, tierConfig, currentPrice) {
    let baseSize = tierConfig.orderSize;
    
    // Apply symbol weight
    const weight = this.config.SYMBOL_WEIGHTS[symbol] || 0.33;
    baseSize *= (weight * 3); // Normalize so weights sum to ~1x
    
    // Apply support level bonus
    const supportBonus = this.getSupportLevelBonus(symbol, currentPrice);
    baseSize *= supportBonus;
    
    return Math.round(baseSize);
  }
  
  async checkAvailableCapital() {
    const balance = await this.exchange.fetchBalance();
    const availableUSD = balance.free['USD'] || 0;
    
    // Dynamic reserve based on volatility (simplified - could add real volatility calc)
    let reserve = this.config.MIN_USD_RESERVE;
    if (this.config.DYNAMIC_RESERVE?.ENABLED) {
      // Use higher reserve during active flash crashes
      const anyFlashCrash = Object.values(this.flashCrashActive).some(v => v);
      reserve = anyFlashCrash 
        ? this.config.DYNAMIC_RESERVE.HIGH_VOLATILITY_RESERVE 
        : this.config.DYNAMIC_RESERVE.LOW_VOLATILITY_RESERVE;
    }
    
    const usableCapital = Math.max(0, availableUSD - reserve);
    const remainingBudget = this.config.MAX_TOTAL_DEPLOYED - this.stats.totalDeployed;
    
    return Math.min(usableCapital, remainingBudget);
  }
  
  async updatePriceHistory(symbol) {
    try {
      const ticker = await this.exchange.fetchTicker(symbol);
      const now = Date.now();
      const currentPrice = ticker.last;
      
      this.priceHistory[symbol].push({ time: now, price: currentPrice });
      
      // Keep 12 hours of data for tier 4 detection
      const cutoff = now - (12 * 60 * 60 * 1000);
      this.priceHistory[symbol] = this.priceHistory[symbol].filter(p => p.time > cutoff);
      
      // Update highest price for trailing stop
      if (this.positions[symbol] && currentPrice > this.highestPriceSinceBuy[symbol]) {
        this.highestPriceSinceBuy[symbol] = currentPrice;
      }
      
      return currentPrice;
    } catch (e) {
      console.error(`   ⚠️ Error fetching ${symbol} price: ${e.message}`);
      return null;
    }
  }
  
  /**
   * Check if we should enter flash crash rapid-fire mode
   */
  checkFlashCrashMode(symbol, tierConfig) {
    if (!this.config.FLASH_CRASH_MODE.ENABLED) return false;
    
    if (tierConfig.changePercent <= this.config.FLASH_CRASH_MODE.TRIGGER_PCT) {
      if (!this.flashCrashActive[symbol]) {
        this.flashCrashActive[symbol] = true;
        this.rapidBuyCount[symbol] = 0;
        this.stats.flashCrashEvents++;
        console.log(`   ⚡ FLASH CRASH MODE ACTIVATED for ${symbol}`);
      }
      return true;
    }
    
    return false;
  }
  
  /**
   * Get minimum time between buys based on mode
   */
  getMinTimeBetweenBuys(symbol) {
    if (this.flashCrashActive[symbol]) {
      return this.config.FLASH_CRASH_MODE.MIN_TIME_BETWEEN_BUYS;
    }
    return this.config.MIN_TIME_BETWEEN_BUYS;
  }
  
  async buyDip(symbol, currentPrice, tierConfig) {
    const availableCapital = await this.checkAvailableCapital();
    const orderSize = this.calculateOrderSize(symbol, tierConfig, currentPrice);
    
    if (availableCapital < orderSize) {
      console.log(`   ⚠️ Insufficient capital ($${availableCapital.toFixed(2)} < $${orderSize})`);
      return false;
    }
    
    // Check max position
    if (this.positions[symbol]) {
      const existingValue = this.positions[symbol].entryPrice * this.positions[symbol].amount;
      if (existingValue >= this.config.MAX_POSITION_USD) {
        console.log(`   ⚠️ Max position reached for ${symbol}`);
        return false;
      }
    }
    
    // Check time since last buy
    const minTime = this.getMinTimeBetweenBuys(symbol);
    const timeSinceLastBuy = Date.now() - (this.lastBuyTime[symbol] || 0);
    if (timeSinceLastBuy < minTime) {
      console.log(`   ⚠️ Too soon since last ${symbol} buy (${Math.round(timeSinceLastBuy/1000)}s < ${minTime/1000}s)`);
      return false;
    }
    
    // Check rapid buy limit in flash crash mode
    if (this.flashCrashActive[symbol]) {
      if (this.rapidBuyCount[symbol] >= this.config.FLASH_CRASH_MODE.MAX_RAPID_BUYS) {
        console.log(`   ⚠️ Max rapid buys reached for ${symbol} flash crash`);
        return false;
      }
    }
    
    try {
      const amount = orderSize / currentPrice;
      
      console.log(`   🛒 TIER ${tierConfig.tier} BUY: ${amount.toFixed(6)} ${symbol.split('/')[0]} at $${currentPrice.toFixed(2)} ($${orderSize})`);
      
      const order = await this.exchange.createMarketBuyOrder(symbol, amount);
      
      const filledPrice = order.average || currentPrice;
      const filledAmount = order.filled || amount;
      
      if (this.positions[symbol]) {
        const existing = this.positions[symbol];
        const totalAmount = existing.amount + filledAmount;
        const avgPrice = ((existing.entryPrice * existing.amount) + (filledPrice * filledAmount)) / totalAmount;
        
        this.positions[symbol].amount = totalAmount;
        this.positions[symbol].entryPrice = avgPrice;
        this.positions[symbol].entryTier = Math.max(existing.entryTier, tierConfig.tier);
        
        this.db.db.prepare(
          'UPDATE dip_positions SET entry_price = ?, amount = ?, entry_tier = ? WHERE id = ?'
        ).run(avgPrice, totalAmount, this.positions[symbol].entryTier, existing.id);
      } else {
        const result = this.db.db.prepare(
          'INSERT INTO dip_positions (symbol, entry_price, amount, entry_time, entry_tier) VALUES (?, ?, ?, ?, ?)'
        ).run(symbol, filledPrice, filledAmount, new Date().toISOString(), tierConfig.tier);
        
        this.positions[symbol] = {
          id: result.lastInsertRowid,
          entryPrice: filledPrice,
          amount: filledAmount,
          entryTime: new Date(),
          entryTier: tierConfig.tier,
        };
        
        this.highestPriceSinceBuy[symbol] = filledPrice;
      }
      
      this.lastBuyTime[symbol] = Date.now();
      this.stats.buyOrders++;
      this.stats.totalDeployed += filledPrice * filledAmount;
      
      if (this.flashCrashActive[symbol]) {
        this.rapidBuyCount[symbol]++;
      }
      
      console.log(`   ✅ Bought ${filledAmount.toFixed(6)} ${symbol.split('/')[0]} at $${filledPrice.toFixed(2)}`);
      
      return true;
    } catch (e) {
      console.error(`   ❌ Buy failed: ${e.message}`);
      return false;
    }
  }
  
  /**
   * Get take profit target based on entry tier
   */
  getTakeProfitTarget(position) {
    const tierKey = `TIER_${position.entryTier}`;
    return this.config.TAKE_PROFIT_BY_TIER[tierKey] || this.config.TAKE_PROFIT_PCT;
  }
  
  async checkPositionForExit(symbol, currentPrice) {
    const position = this.positions[symbol];
    if (!position) return;
    
    const pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
    const takeProfitTarget = this.getTakeProfitTarget(position);
    
    // Check trailing stop
    if (this.config.TRAILING_STOP.ENABLED && pnlPercent >= this.config.TRAILING_STOP.ACTIVATION_PCT) {
      const highestPrice = this.highestPriceSinceBuy[symbol];
      const trailPrice = highestPrice * (1 - this.config.TRAILING_STOP.TRAIL_PCT / 100);
      
      if (currentPrice <= trailPrice) {
        const trailPnl = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
        console.log(`   📊 Trailing stop triggered for ${symbol} (+${trailPnl.toFixed(2)}%)`);
        this.stats.trailingStopTriggers++;
        await this.closePosition(symbol, currentPrice, 'trailing_stop');
        return;
      }
    }
    
    // Check take profit
    if (pnlPercent >= takeProfitTarget) {
      console.log(`   📈 Take profit (Tier ${position.entryTier}) triggered for ${symbol} (+${pnlPercent.toFixed(2)}%)`);
      await this.closePosition(symbol, currentPrice, 'take_profit');
      return;
    }
    
    // Check hard stop loss
    if (pnlPercent <= this.config.STOP_LOSS_PCT) {
      console.log(`   📉 Stop loss triggered for ${symbol} (${pnlPercent.toFixed(2)}%)`);
      await this.closePosition(symbol, currentPrice, 'stop_loss');
      return;
    }
    
    // Check time-based exit
    if (this.config.MAX_HOLD_HOURS) {
      const holdTime = (Date.now() - position.entryTime.getTime()) / (1000 * 60 * 60);
      if (holdTime >= this.config.MAX_HOLD_HOURS && pnlPercent >= this.config.TIME_BASED_EXIT_PCT) {
        console.log(`   ⏰ Time-based exit for ${symbol} after ${holdTime.toFixed(1)}h (+${pnlPercent.toFixed(2)}%)`);
        await this.closePosition(symbol, currentPrice, 'time_based');
        return;
      }
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
      
      this.db.db.prepare(
        'UPDATE dip_positions SET status = ?, exit_price = ?, exit_time = ?, profit = ?, exit_reason = ? WHERE id = ?'
      ).run('closed', filledPrice, new Date().toISOString(), profit, reason, position.id);
      
      this.stats.sellOrders++;
      this.stats.totalProfit += profit;
      this.stats.totalDeployed -= position.entryPrice * position.amount;
      
      // Reset flash crash state for this symbol
      this.flashCrashActive[symbol] = false;
      this.rapidBuyCount[symbol] = 0;
      this.highestPriceSinceBuy[symbol] = 0;
      
      delete this.positions[symbol];
      
      console.log(`   ✅ Sold ${position.amount.toFixed(6)} ${symbol.split('/')[0]} at $${filledPrice.toFixed(2)}`);
      console.log(`   💵 Profit: $${profit.toFixed(2)} (${reason})`);
      
      return true;
    } catch (e) {
      console.error(`   ❌ Sell failed: ${e.message}`);
      return false;
    }
  }
  
  async runCycle() {
    for (const symbol of this.config.SYMBOLS) {
      const currentPrice = await this.updatePriceHistory(symbol);
      if (!currentPrice) continue;
      
      // Check existing position for exit
      await this.checkPositionForExit(symbol, currentPrice);
      
      // Detect dip tier
      const tierConfig = this.detectDipTier(symbol);
      if (tierConfig) {
        this.stats.dipsDetected++;
        
        // Check for flash crash mode
        this.checkFlashCrashMode(symbol, tierConfig);
        
        console.log(`\n🔻 TIER ${tierConfig.tier} DIP DETECTED: ${symbol}`);
        console.log(`   Price dropped ${tierConfig.changePercent.toFixed(2)}% in ${tierConfig.lookbackMinutes} min`);
        console.log(`   From $${tierConfig.oldPrice.toFixed(2)} to $${tierConfig.currentPrice.toFixed(2)}`);
        
        await this.buyDip(symbol, currentPrice, tierConfig);
      } else {
        // Reset flash crash mode if no dip detected
        if (this.flashCrashActive[symbol]) {
          const history = this.priceHistory[symbol];
          if (history.length > 1) {
            const recentChange = ((history[history.length - 1].price - history[0].price) / history[0].price) * 100;
            if (recentChange > -2) { // Price recovered above -2%
              console.log(`   ✅ Flash crash ended for ${symbol}`);
              this.flashCrashActive[symbol] = false;
              this.rapidBuyCount[symbol] = 0;
            }
          }
        }
      }
      
      await new Promise(r => setTimeout(r, 300));
    }
  }
  
  async start() {
    if (this.running) return;
    this.running = true;
    
    console.log('\n🚀 Starting Enhanced Dip Buyer v2.0...');
    
    for (const symbol of this.config.SYMBOLS) {
      await this.updatePriceHistory(symbol);
    }
    
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
    console.log('\n🛑 Enhanced Dip Buyer stopped');
    this.printStats();
  }
  
  printStats() {
    console.log('\n' + '═'.repeat(60));
    console.log('  ENHANCED DIP BUYER v2.0 STATISTICS');
    console.log('═'.repeat(60));
    console.log(`  Dips Detected: ${this.stats.dipsDetected}`);
    console.log(`  Flash Crash Events: ${this.stats.flashCrashEvents}`);
    console.log(`  Buy Orders: ${this.stats.buyOrders}`);
    console.log(`  Sell Orders: ${this.stats.sellOrders}`);
    console.log(`  Support Level Buys: ${this.stats.supportLevelBuys}`);
    console.log(`  Trailing Stop Triggers: ${this.stats.trailingStopTriggers}`);
    console.log(`  Total Profit: $${this.stats.totalProfit.toFixed(2)}`);
    console.log(`  Currently Deployed: $${this.stats.totalDeployed.toFixed(2)}`);
    
    const openPositions = Object.entries(this.positions);
    if (openPositions.length > 0) {
      console.log('\n  Open Positions:');
      for (const [symbol, pos] of openPositions) {
        const value = pos.entryPrice * pos.amount;
        console.log(`    ${symbol}: Tier ${pos.entryTier} | ${pos.amount.toFixed(6)} @ $${pos.entryPrice.toFixed(2)} ($${value.toFixed(2)})`);
      }
    }
    
    console.log('═'.repeat(60));
  }
  
  getStats() { return { ...this.stats }; }
  getPositions() { return { ...this.positions }; }
  getConfig() { return { ...this.config }; }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const dipBuyer = new EnhancedDipBuyer();
  
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
  
  await dipBuyer.init();
  await dipBuyer.start();
}

export default EnhancedDipBuyer;
