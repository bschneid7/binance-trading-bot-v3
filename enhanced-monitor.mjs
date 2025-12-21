#!/usr/bin/env node

/**
 * Enhanced Grid Bot Monitor - Version 1.0.0
 * 
 * Three major enhancements over the base monitor:
 * 1. Native Binance WebSocket for real-time order/trade updates
 * 2. Continuous order database synchronization
 * 3. Smart grid rebalancing when price moves outside range
 * 
 * This module can be used standalone or integrated into the main bot.
 */

import ccxt from 'ccxt';
import dotenv from 'dotenv';
import { getDatabase, closeDatabase } from './database.mjs';
import { WebSocketPriceFeed } from './websocket-feed.mjs';
import { BinanceWebSocket } from './binance-websocket.mjs';
import { retryWithBackoff, CircuitBreaker, ErrorLogger } from './error-handler.mjs';
import { TrailingStopManager } from './trailing-stop.mjs';
import { VolatilityGridManager } from './volatility-grid.mjs';
import { TrendFilter, TREND, TREND_NAMES } from './trend-filter.mjs';

dotenv.config({ path: '.env.production' });

const VERSION = '1.1.0-ENHANCED';

// Risk configuration
const RISK_CONFIG = {
  STOP_LOSS_PERCENT: 0.15,
  TRAILING_STOP_PERCENT: 0.05,
  MAX_RISK_PER_TRADE: 0.02,
  REBALANCE_THRESHOLD: 0.10,  // Rebalance when price is 10% outside grid
  MIN_PROFIT_FOR_TRAILING: 0.03,
};

// Grid rebalancing configuration
const REBALANCE_CONFIG = {
  // How far outside the grid (as % of grid range) before triggering rebalance
  TRIGGER_THRESHOLD: 0.10,
  // Minimum time between rebalances (ms)
  MIN_REBALANCE_INTERVAL: 5 * 60 * 1000,  // 5 minutes
  // How much to shift the grid (as % of grid range)
  SHIFT_PERCENT: 0.50,
  // Maximum rebalances per day
  MAX_DAILY_REBALANCES: 10,
  // Auto-rebalance enabled
  AUTO_REBALANCE: true,
};

// Order sync configuration
const SYNC_CONFIG = {
  // How often to sync orders with exchange (ms)
  SYNC_INTERVAL: 60000,  // 1 minute
  // How long to wait after a fill before syncing
  POST_FILL_SYNC_DELAY: 5000,  // 5 seconds
};

// Volatility-based grid configuration
const VOLATILITY_CONFIG = {
  ENABLED: true,
  ATR_PERIOD: 14,
  ATR_TIMEFRAME: '1h',
  MIN_MULTIPLIER: 0.5,
  MAX_MULTIPLIER: 2.0,
  UPDATE_INTERVAL: 5 * 60 * 1000,  // 5 minutes
};

// Trend filter configuration
const TREND_CONFIG = {
  ENABLED: true,
  TIMEFRAMES: ['4h', '1d'],
  FILTER_MODE: 'soft',  // 'soft' = warn only, 'hard' = block orders
  UPDATE_INTERVAL: 5 * 60 * 1000,  // 5 minutes
};

/**
 * Enhanced Monitor Class
 * Combines all three improvements into a single cohesive monitor
 */
export class EnhancedMonitor {
  constructor(botName, options = {}) {
    this.botName = botName;
    this.options = {
      autoRebalance: REBALANCE_CONFIG.AUTO_REBALANCE,
      syncInterval: SYNC_CONFIG.SYNC_INTERVAL,
      useNativeWebSocket: true,
      useVolatilityGrid: VOLATILITY_CONFIG.ENABLED,
      useTrendFilter: TREND_CONFIG.ENABLED,
      ...options,
    };
    
    this.db = getDatabase();
    this.exchange = null;
    this.testMode = false;
    this.bot = null;
    
    // WebSocket connections
    this.priceFeed = null;
    this.userDataWs = null;
    
    // Sync state
    this.syncTimer = null;
    this.lastSyncTime = 0;
    this.pendingSyncTimeout = null;
    
    // Rebalance state
    this.lastRebalanceTime = 0;
    this.dailyRebalanceCount = 0;
    this.rebalanceResetDate = new Date().toDateString();
    
    // Statistics
    this.stats = {
      totalFills: 0,
      totalReplacements: 0,
      totalRebalances: 0,
      wsOrderUpdates: 0,
      syncRepairs: 0,
      startTime: new Date(),
    };
    
    // Error handling
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeout: 60000,
      name: 'enhanced-monitor',
    });
    this.errorLogger = new ErrorLogger();
    
    // Trailing stop
    this.trailingStopManager = new TrailingStopManager();
    
    // Volatility grid manager
    this.volatilityManager = new VolatilityGridManager({
      atrPeriod: VOLATILITY_CONFIG.ATR_PERIOD,
      atrTimeframe: VOLATILITY_CONFIG.ATR_TIMEFRAME,
      minGridMultiplier: VOLATILITY_CONFIG.MIN_MULTIPLIER,
      maxGridMultiplier: VOLATILITY_CONFIG.MAX_MULTIPLIER,
    });
    
    // Trend filter
    this.trendFilter = new TrendFilter({
      timeframes: TREND_CONFIG.TIMEFRAMES,
      filterMode: TREND_CONFIG.FILTER_MODE,
    });
    
    // Current market analysis
    this.currentVolatility = null;
    this.currentTrend = null;
    this.lastAnalysisTime = 0;
    
    // Current price
    this.currentPrice = 0;
  }

  /**
   * Initialize the monitor
   */
  async init() {
    // Load bot configuration
    this.bot = this.db.getBot(this.botName);
    if (!this.bot) {
      throw new Error(`Bot "${this.botName}" not found`);
    }
    
    // Initialize exchange
    const apiKey = process.env.BINANCE_API_KEY;
    const secret = process.env.BINANCE_API_SECRET;
    this.testMode = process.env.PAPER_TRADING_MODE === 'true';
    
    if (!apiKey || !secret) {
      throw new Error('BINANCE_API_KEY and BINANCE_API_SECRET must be set');
    }
    
    this.exchange = new ccxt.binanceus({
      apiKey,
      secret,
      enableRateLimit: true,
      options: {
        defaultType: 'spot',
        adjustForTimeDifference: true,
      },
    });
    
    if (this.testMode) {
      this.exchange.setSandboxMode(true);
    }
    
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  ENHANCED GRID BOT MONITOR v${VERSION}`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`  Bot: ${this.botName}`);
    console.log(`  Symbol: ${this.bot.symbol}`);
    console.log(`  Mode: ${this.testMode ? 'PAPER TRADING' : '🔴 LIVE TRADING'}`);
    console.log(`  Grid: $${this.bot.lower_price} - $${this.bot.upper_price}`);
    console.log(`${'═'.repeat(60)}\n`);
    
    // Initialize trailing stop
    try {
      const ticker = await this.exchange.fetchTicker(this.bot.symbol);
      this.currentPrice = ticker.last;
      
      const currentState = this.trailingStopManager.getState(this.botName);
      if (!currentState.entryPrice) {
        this.trailingStopManager.setEntryPrice(this.botName, this.currentPrice);
        this.trailingStopManager.configure(this.botName, {
          strategy: 'percentage',
          trailingPercent: RISK_CONFIG.TRAILING_STOP_PERCENT,
          activationPercent: RISK_CONFIG.MIN_PROFIT_FOR_TRAILING,
        });
        console.log(`📈 Trailing stop initialized at entry $${this.currentPrice.toFixed(2)}`);
      }
    } catch (e) {
      console.log(`⚠️  Could not initialize trailing stop: ${e.message}`);
    }
    
    return this;
  }

  /**
   * Start all monitoring systems
   */
  async start() {
    console.log('🚀 Starting enhanced monitor...\n');
    
    // 1. Initial order sync
    console.log('📋 Performing initial order sync...');
    await this.syncOrders();
    
    // 2. Initial market analysis (volatility + trend)
    console.log('📊 Performing initial market analysis...');
    await this.updateMarketAnalysis();
    
    // 3. Start native WebSocket for user data (if enabled and not in test mode)
    if (this.options.useNativeWebSocket && !this.testMode) {
      await this.startUserDataWebSocket();
    }
    
    // 4. Start price feed
    await this.startPriceFeed();
    
    // 5. Start periodic sync
    this.startPeriodicSync();
    
    // 6. Setup graceful shutdown
    this.setupShutdown();
    
    console.log('\n✅ Enhanced monitor fully operational\n');
    console.log('Features active:');
    console.log(`  ✓ Real-time price feed (${this.options.useNativeWebSocket ? 'WebSocket' : 'REST polling'})`);
    console.log(`  ✓ Order database sync (every ${this.options.syncInterval / 1000}s)`);
    console.log(`  ✓ Smart grid rebalancing (${this.options.autoRebalance ? 'AUTO' : 'MANUAL'})`);
    console.log(`  ✓ Volatility-based grid spacing (${this.options.useVolatilityGrid ? 'ENABLED' : 'DISABLED'})`);
    console.log(`  ✓ Multi-timeframe trend filter (${this.options.useTrendFilter ? 'ENABLED' : 'DISABLED'})`);
    if (!this.testMode && this.options.useNativeWebSocket) {
      console.log(`  ✓ Native WebSocket order updates`);
    }
    console.log();
  }

  /**
   * Start native Binance WebSocket for real-time order updates
   */
  async startUserDataWebSocket() {
    console.log('🔌 Connecting native WebSocket for order updates...');
    
    try {
      this.userDataWs = new BinanceWebSocket(
        process.env.BINANCE_API_KEY,
        process.env.BINANCE_API_SECRET
      );
      
      // Handle order updates
      this.userDataWs.onOrderUpdate = (order) => {
        this.handleWebSocketOrderUpdate(order);
      };
      
      // Handle trade updates (fills)
      this.userDataWs.onTradeUpdate = (trade) => {
        this.handleWebSocketTradeUpdate(trade);
      };
      
      // Handle connection events
      this.userDataWs.onConnect = (type) => {
        console.log(`✅ Native WebSocket connected (${type})`);
      };
      
      this.userDataWs.onDisconnect = (type) => {
        console.log(`⚠️  Native WebSocket disconnected (${type})`);
      };
      
      this.userDataWs.onError = (error, type) => {
        console.error(`❌ Native WebSocket error (${type}):`, error.message);
      };
      
      await this.userDataWs.connectUserDataStream();
      console.log('✅ Native WebSocket connected for real-time order updates');
      
    } catch (error) {
      console.log(`⚠️  Could not connect native WebSocket: ${error.message}`);
      console.log('   Falling back to periodic sync only');
    }
  }

  /**
   * Handle WebSocket order update
   */
  handleWebSocketOrderUpdate(order) {
    this.stats.wsOrderUpdates++;
    
    // Only process orders for our symbol
    const symbol = this.formatSymbol(order.symbol);
    if (symbol !== this.bot.symbol) return;
    
    console.log(`\n📡 [WS] Order update: ${order.executionType} ${order.side} @ $${order.price.toFixed(2)}`);
    
    // Update database based on order status
    const dbOrder = this.db.getOrder(order.id);
    
    if (order.status === 'closed' || order.status === 'filled') {
      // Order was filled
      if (dbOrder && dbOrder.status === 'open') {
        this.db.fillOrder(order.id, order.price);
        console.log(`   ✓ Order ${order.id} marked as filled in database`);
      }
    } else if (order.status === 'canceled' || order.status === 'cancelled') {
      // Order was cancelled
      if (dbOrder && dbOrder.status === 'open') {
        this.db.cancelOrder(order.id, 'ws_cancelled');
        console.log(`   ✓ Order ${order.id} marked as cancelled in database`);
      }
    } else if (order.status === 'open' && !dbOrder) {
      // New order not in database
      this.db.createOrder({
        id: order.id,
        bot_name: this.botName,
        symbol: symbol,
        side: order.side,
        price: order.price,
        amount: order.amount,
      });
      console.log(`   ✓ Order ${order.id} added to database`);
    }
  }

  /**
   * Handle WebSocket trade update (fill)
   */
  async handleWebSocketTradeUpdate(trade) {
    // Only process trades for our symbol
    const symbol = this.formatSymbol(trade.symbol);
    if (symbol !== this.bot.symbol) return;
    
    console.log(`\n🎯 [WS] Trade executed: ${trade.side} ${trade.amount} @ $${trade.price.toFixed(2)}`);
    
    // Record the trade
    this.db.recordTrade({
      bot_name: this.botName,
      symbol: symbol,
      side: trade.side,
      price: trade.price,
      amount: trade.amount,
      value: trade.cost,
      fee: trade.fee,
      order_id: trade.orderId,
      type: 'ws_fill',
    });
    
    this.stats.totalFills++;
    
    // Place replacement order
    if (trade.isFilled) {
      await this.placeReplacementOrder(trade);
    }
    
    // Schedule a sync to catch any missed updates
    this.scheduleSyncAfterFill();
    
    // Update metrics
    this.db.updateMetrics(this.botName);
  }

  /**
   * Start price feed (WebSocket with REST fallback)
   */
  async startPriceFeed() {
    console.log('📊 Starting price feed...');
    
    this.priceFeed = new WebSocketPriceFeed(this.exchange, {
      symbol: this.bot.symbol,
      healthCheckInterval: 30000,
      staleDataThreshold: 60000,
      fallbackInterval: 10000,
      
      onPrice: async (priceData) => {
        await this.handlePriceUpdate(priceData);
      },
      
      onConnect: () => {
        console.log('✅ Price feed connected');
      },
      
      onDisconnect: (error) => {
        console.log('⚠️  Price feed disconnected:', error?.message || 'Unknown');
      },
      
      onError: (error) => {
        console.error('❌ Price feed error:', error.message);
      },
    });
    
    await this.priceFeed.start();
  }

  /**
   * Handle price update
   */
  async handlePriceUpdate(priceData) {
    this.currentPrice = priceData.price;
    const source = priceData.source;
    
    const timestamp = new Date().toISOString().slice(11, 19);
    console.log(`\n[${timestamp}] ${source === 'websocket' ? '🔌' : '📡'} Price: $${this.currentPrice.toFixed(2)}`);
    
    // Check if price is outside grid range
    const gridStatus = this.checkGridStatus();
    if (gridStatus.outsideGrid) {
      console.log(`⚠️  Price ${gridStatus.direction} grid by ${(gridStatus.deviation * 100).toFixed(1)}%`);
      
      if (this.options.autoRebalance && gridStatus.shouldRebalance) {
        await this.rebalanceGrid(gridStatus);
      }
    }
    
    // Check for fills (database-based detection as backup)
    const filledOrders = this.db.checkAndFillOrders(this.botName, this.currentPrice);
    
    if (filledOrders.length > 0) {
      console.log(`🎯 ${filledOrders.length} order(s) filled at $${this.currentPrice.toFixed(2)}`);
      this.stats.totalFills += filledOrders.length;
      
      for (const filledOrder of filledOrders) {
        // Record trade
        this.db.recordTrade({
          bot_name: this.botName,
          symbol: this.bot.symbol,
          side: filledOrder.side,
          price: this.currentPrice,
          amount: filledOrder.amount,
          value: this.currentPrice * filledOrder.amount,
          order_id: filledOrder.id,
          type: 'price_fill',
        });
        
        // Place replacement
        await this.placeReplacementOrder({
          side: filledOrder.side,
          price: filledOrder.price,
          amount: filledOrder.amount,
        });
      }
      
      this.db.updateMetrics(this.botName);
    }
    
    // Check trailing stop
    const trailingResult = this.trailingStopManager.update(this.botName, this.currentPrice);
    
    if (trailingResult.isActive && trailingResult.stopPrice) {
      console.log(`📈 Trailing: HWM $${trailingResult.highWaterMark?.toFixed(2)} | Stop $${trailingResult.stopPrice.toFixed(2)} | +${(trailingResult.profitPercent * 100).toFixed(2)}%`);
    }
    
    if (trailingResult.triggered) {
      await this.handleTrailingStopTriggered(trailingResult);
      return;
    }
    
    // Update market analysis periodically
    await this.maybeUpdateMarketAnalysis();
    
    // Display stats with market analysis
    const activeOrders = this.db.getActiveOrders(this.botName);
    let statusLine = `📊 Orders: ${activeOrders.length} | Fills: ${this.stats.totalFills} | Rebalances: ${this.stats.totalRebalances}`;
    
    // Add volatility info if available
    if (this.currentVolatility && this.options.useVolatilityGrid) {
      statusLine += ` | Vol: ${this.currentVolatility.volatility.regime} (${this.currentVolatility.volatility.multiplier}x)`;
    }
    
    // Add trend info if available
    if (this.currentTrend && this.options.useTrendFilter) {
      statusLine += ` | Trend: ${this.currentTrend.trendName}`;
    }
    
    console.log(statusLine);
  }

  /**
   * Check if price is outside grid range
   */
  checkGridStatus() {
    const gridRange = this.bot.upper_price - this.bot.lower_price;
    const midPrice = (this.bot.upper_price + this.bot.lower_price) / 2;
    
    let outsideGrid = false;
    let direction = '';
    let deviation = 0;
    let shouldRebalance = false;
    
    if (this.currentPrice > this.bot.upper_price) {
      outsideGrid = true;
      direction = 'ABOVE';
      deviation = (this.currentPrice - this.bot.upper_price) / gridRange;
    } else if (this.currentPrice < this.bot.lower_price) {
      outsideGrid = true;
      direction = 'BELOW';
      deviation = (this.bot.lower_price - this.currentPrice) / gridRange;
    }
    
    // Check if we should rebalance
    if (outsideGrid && deviation >= REBALANCE_CONFIG.TRIGGER_THRESHOLD) {
      const timeSinceLastRebalance = Date.now() - this.lastRebalanceTime;
      const today = new Date().toDateString();
      
      // Reset daily counter if new day
      if (today !== this.rebalanceResetDate) {
        this.dailyRebalanceCount = 0;
        this.rebalanceResetDate = today;
      }
      
      if (timeSinceLastRebalance >= REBALANCE_CONFIG.MIN_REBALANCE_INTERVAL &&
          this.dailyRebalanceCount < REBALANCE_CONFIG.MAX_DAILY_REBALANCES) {
        shouldRebalance = true;
      }
    }
    
    return { outsideGrid, direction, deviation, shouldRebalance };
  }

  /**
   * Rebalance the grid when price moves outside range
   */
  async rebalanceGrid(gridStatus) {
    console.log(`\n🔄 SMART GRID REBALANCING`);
    console.log(`   Reason: Price ${gridStatus.direction} grid by ${(gridStatus.deviation * 100).toFixed(1)}%`);
    
    const gridRange = this.bot.upper_price - this.bot.lower_price;
    const shiftAmount = gridRange * REBALANCE_CONFIG.SHIFT_PERCENT;
    
    let newLower, newUpper;
    
    if (gridStatus.direction === 'ABOVE') {
      // Shift grid up
      newLower = this.currentPrice - (gridRange * 0.4);  // 40% below current price
      newUpper = this.currentPrice + (gridRange * 0.6);  // 60% above current price
    } else {
      // Shift grid down
      newLower = this.currentPrice - (gridRange * 0.6);  // 60% below current price
      newUpper = this.currentPrice + (gridRange * 0.4);  // 40% above current price
    }
    
    // Round to reasonable precision
    newLower = Math.round(newLower * 100) / 100;
    newUpper = Math.round(newUpper * 100) / 100;
    
    console.log(`   Old grid: $${this.bot.lower_price} - $${this.bot.upper_price}`);
    console.log(`   New grid: $${newLower} - $${newUpper}`);
    
    try {
      // 1. Cancel all existing orders
      console.log('   Cancelling existing orders...');
      const activeOrders = this.db.getActiveOrders(this.botName);
      
      for (const order of activeOrders) {
        if (!this.testMode) {
          try {
            await retryWithBackoff(
              () => this.exchange.cancelOrder(order.id, this.bot.symbol),
              { maxAttempts: 3, initialDelay: 500, context: `Cancel order ${order.id}` }
            );
          } catch (e) {
            if (!e.message.includes('Unknown order')) {
              console.log(`   ⚠️  Could not cancel ${order.id}: ${e.message}`);
            }
          }
        }
        this.db.cancelOrder(order.id, 'rebalance');
      }
      
      // 2. Update bot configuration
      this.db.updateBot(this.botName, {
        lower_price: newLower,
        upper_price: newUpper,
        rebalance_count: (this.bot.rebalance_count || 0) + 1,
      });
      
      // Refresh bot data
      this.bot = this.db.getBot(this.botName);
      
      // 3. Place new grid orders
      console.log('   Placing new grid orders...');
      const gridLevels = this.calculateGridLevels(newLower, newUpper, this.bot.adjusted_grid_count, this.currentPrice);
      await this.placeGridOrders(gridLevels);
      
      // Update stats
      this.lastRebalanceTime = Date.now();
      this.dailyRebalanceCount++;
      this.stats.totalRebalances++;
      
      console.log(`   ✅ Grid rebalanced successfully (${this.dailyRebalanceCount}/${REBALANCE_CONFIG.MAX_DAILY_REBALANCES} today)\n`);
      
    } catch (error) {
      console.error(`   ❌ Rebalance failed: ${error.message}`);
      this.errorLogger.log(error, { botName: this.botName, operation: 'rebalanceGrid' });
    }
  }

  /**
   * Calculate grid levels
   */
  calculateGridLevels(lower, upper, gridCount, currentPrice) {
    const levels = [];
    const step = (upper - lower) / gridCount;
    
    for (let i = 0; i <= gridCount; i++) {
      const price = lower + (step * i);
      const side = price < currentPrice ? 'buy' : 'sell';
      
      // Skip level too close to current price
      if (Math.abs(price - currentPrice) < step * 0.3) continue;
      
      levels.push({
        price: Math.round(price * 100) / 100,
        side,
        amount: this.bot.order_size,
      });
    }
    
    return levels;
  }

  /**
   * Place grid orders
   */
  async placeGridOrders(levels) {
    let placed = 0;
    
    for (const level of levels) {
      try {
        if (this.testMode) {
          const orderId = `${this.botName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          this.db.createOrder({
            id: orderId,
            bot_name: this.botName,
            symbol: this.bot.symbol,
            side: level.side,
            price: level.price,
            amount: level.amount,
          });
        } else {
          const order = await retryWithBackoff(
            () => this.circuitBreaker.execute(() =>
              this.exchange.createLimitOrder(this.bot.symbol, level.side, level.amount, level.price)
            ),
            { maxAttempts: 3, initialDelay: 500, context: `Place ${level.side} at $${level.price}` }
          );
          
          this.db.createOrder({
            id: order.id,
            bot_name: this.botName,
            symbol: this.bot.symbol,
            side: level.side,
            price: level.price,
            amount: order.amount,
          });
        }
        placed++;
        
        // Rate limit
        await new Promise(r => setTimeout(r, 100));
        
      } catch (error) {
        if (!error.message?.includes('insufficient')) {
          console.log(`   ⚠️  Could not place ${level.side} at $${level.price}: ${error.message}`);
        }
      }
    }
    
    console.log(`   Placed ${placed}/${levels.length} orders`);
    return placed;
  }

  /**
   * Place replacement order after a fill
   */
  async placeReplacementOrder(filledTrade) {
    const oppositeSide = filledTrade.side === 'buy' ? 'sell' : 'buy';
    
    // Get volatility-adjusted grid spacing
    let gridSpacing = (this.bot.upper_price - this.bot.lower_price) / this.bot.adjusted_grid_count;
    
    // Apply volatility adjustment if enabled
    if (this.options.useVolatilityGrid && this.currentVolatility) {
      gridSpacing *= this.currentVolatility.volatility.multiplier;
    }
    
    const newPrice = filledTrade.side === 'buy'
      ? filledTrade.price + gridSpacing
      : filledTrade.price - gridSpacing;
    
    // Check if new price is within grid
    if (newPrice < this.bot.lower_price || newPrice > this.bot.upper_price) {
      console.log(`   ⚠️  Replacement price $${newPrice.toFixed(2)} outside grid, skipping`);
      return;
    }
    
    // Check trend filter before placing order
    if (this.options.useTrendFilter && this.currentTrend) {
      const rec = this.currentTrend.recommendation;
      
      // In hard mode, block orders against strong trends
      if (TREND_CONFIG.FILTER_MODE === 'hard') {
        if (oppositeSide === 'buy' && !rec.allowBuys) {
          console.log(`   🚫 Trend filter blocked BUY: ${rec.message}`);
          return;
        }
        if (oppositeSide === 'sell' && !rec.allowSells) {
          console.log(`   🚫 Trend filter blocked SELL: ${rec.message}`);
          return;
        }
      }
      
      // In soft mode, just log a warning for counter-trend orders
      if (TREND_CONFIG.FILTER_MODE === 'soft') {
        const bias = oppositeSide === 'buy' ? rec.buyBias : rec.sellBias;
        if (bias < -0.1) {
          console.log(`   ⚠️  Counter-trend ${oppositeSide.toUpperCase()}: ${rec.message}`);
        }
      }
    }
    
    try {
      if (this.testMode) {
        const orderId = `${this.botName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.db.createOrder({
          id: orderId,
          bot_name: this.botName,
          symbol: this.bot.symbol,
          side: oppositeSide,
          price: parseFloat(newPrice.toFixed(2)),
          amount: filledTrade.amount,
        });
      } else {
        const order = await retryWithBackoff(
          () => this.circuitBreaker.execute(() =>
            this.exchange.createLimitOrder(this.bot.symbol, oppositeSide, filledTrade.amount, newPrice)
          ),
          { maxAttempts: 3, initialDelay: 500, context: `Place ${oppositeSide} replacement` }
        );
        
        this.db.createOrder({
          id: order.id,
          bot_name: this.botName,
          symbol: this.bot.symbol,
          side: oppositeSide,
          price: newPrice,
          amount: order.amount,
        });
      }
      
      this.stats.totalReplacements++;
      console.log(`🔄 Placed ${oppositeSide.toUpperCase()} replacement at $${newPrice.toFixed(2)}`);
      
    } catch (error) {
      if (!error.message?.includes('insufficient')) {
        console.error(`❌ Replacement order failed: ${error.message}`);
        this.errorLogger.log(error, { botName: this.botName, operation: 'placeReplacementOrder' });
      }
    }
  }

  /**
   * Sync orders with exchange
   */
  async syncOrders() {
    try {
      const exchangeOrders = await retryWithBackoff(
        () => this.exchange.fetchOpenOrders(this.bot.symbol),
        { maxAttempts: 3, context: 'Fetch open orders' }
      );
      
      const dbOrders = this.db.getActiveOrders(this.botName);
      
      const exchangeIds = new Set(exchangeOrders.map(o => o.id));
      const dbIds = new Set(dbOrders.map(o => o.id));
      
      let repairs = 0;
      
      // Find orphaned orders (in DB but not on exchange)
      for (const order of dbOrders) {
        if (!exchangeIds.has(order.id)) {
          // Order was filled or cancelled on exchange
          this.db.fillOrder(order.id, 'sync_orphaned');
          repairs++;
        }
      }
      
      // Find missing orders (on exchange but not in DB)
      for (const order of exchangeOrders) {
        if (!dbIds.has(order.id)) {
          this.db.createOrder({
            id: order.id,
            bot_name: this.botName,
            symbol: this.bot.symbol,
            side: order.side,
            price: order.price,
            amount: order.amount,
          });
          repairs++;
        }
      }
      
      if (repairs > 0) {
        this.stats.syncRepairs += repairs;
        console.log(`🔧 Sync: ${repairs} repairs (Exchange: ${exchangeOrders.length}, DB: ${dbOrders.length})`);
      }
      
      this.lastSyncTime = Date.now();
      
    } catch (error) {
      console.error('❌ Sync error:', error.message);
    }
  }

  /**
   * Start periodic order sync
   */
  startPeriodicSync() {
    this.syncTimer = setInterval(async () => {
      await this.syncOrders();
    }, this.options.syncInterval);
  }

  /**
   * Schedule a sync shortly after a fill
   */
  scheduleSyncAfterFill() {
    if (this.pendingSyncTimeout) {
      clearTimeout(this.pendingSyncTimeout);
    }
    
    this.pendingSyncTimeout = setTimeout(async () => {
      await this.syncOrders();
      this.pendingSyncTimeout = null;
    }, SYNC_CONFIG.POST_FILL_SYNC_DELAY);
  }

  /**
   * Handle trailing stop triggered
   */
  async handleTrailingStopTriggered(result) {
    console.log(`\n🎯 TRAILING STOP TRIGGERED!`);
    console.log(`   ${result.reason}`);
    console.log(`   Closing positions and stopping bot...`);
    
    // Cancel all orders
    const activeOrders = this.db.getActiveOrders(this.botName);
    for (const order of activeOrders) {
      if (!this.testMode) {
        try {
          await this.exchange.cancelOrder(order.id, this.bot.symbol);
        } catch (e) {
          // Ignore
        }
      }
      this.db.cancelOrder(order.id, 'trailing_stop');
    }
    
    this.db.updateBotStatus(this.botName, 'stopped');
    this.db.recordTrade({
      bot_name: this.botName,
      symbol: this.bot.symbol,
      side: 'close',
      price: this.currentPrice,
      amount: 0,
      value: result.profit || 0,
      type: 'trailing_stop_exit',
    });
    
    await this.stop();
    console.log(`   ✅ Bot stopped with trailing stop profit locked`);
    process.exit(0);
  }

  /**
   * Update market analysis (volatility and trend)
   */
  async updateMarketAnalysis() {
    try {
      // Update volatility analysis
      if (this.options.useVolatilityGrid) {
        const baseGrid = {
          lower: this.bot.lower_price,
          upper: this.bot.upper_price,
          count: this.bot.adjusted_grid_count,
        };
        
        this.currentVolatility = await this.volatilityManager.calculateAdjustedGrid(
          this.exchange,
          this.bot.symbol,
          baseGrid
        );
        
        if (this.currentVolatility && !this.currentVolatility.error) {
          console.log(`📈 Volatility: ${this.currentVolatility.volatility.regime} (ATR: ${this.currentVolatility.volatility.atrPercent}%, Multiplier: ${this.currentVolatility.volatility.multiplier}x)`);
        }
      }
      
      // Update trend analysis
      if (this.options.useTrendFilter) {
        this.currentTrend = await this.trendFilter.analyzeTrend(
          this.exchange,
          this.bot.symbol
        );
        
        if (this.currentTrend) {
          console.log(`📉 Trend: ${this.currentTrend.trendName} (Confidence: ${(this.currentTrend.confidence * 100).toFixed(0)}%, Aligned: ${this.currentTrend.aligned ? 'Yes' : 'No'})`);
          console.log(`   Recommendation: ${this.currentTrend.recommendation.message}`);
        }
      }
      
      this.lastAnalysisTime = Date.now();
      
    } catch (error) {
      console.error(`⚠️  Market analysis error: ${error.message}`);
    }
  }

  /**
   * Check if market analysis needs updating and update if so
   */
  async maybeUpdateMarketAnalysis() {
    const timeSinceLastAnalysis = Date.now() - this.lastAnalysisTime;
    const updateInterval = Math.min(VOLATILITY_CONFIG.UPDATE_INTERVAL, TREND_CONFIG.UPDATE_INTERVAL);
    
    if (timeSinceLastAnalysis >= updateInterval) {
      await this.updateMarketAnalysis();
    }
  }

  /**
   * Format symbol from BTCUSD to BTC/USD
   */
  formatSymbol(symbol) {
    const quotes = ['USD', 'USDT', 'USDC', 'BTC', 'ETH'];
    for (const quote of quotes) {
      if (symbol.endsWith(quote)) {
        const base = symbol.slice(0, -quote.length);
        return `${base}/${quote}`;
      }
    }
    return symbol;
  }

  /**
   * Setup graceful shutdown
   */
  setupShutdown() {
    process.on('SIGINT', async () => {
      console.log('\n\n🛑 Stopping enhanced monitor...');
      await this.stop();
      this.printFinalStats();
      closeDatabase();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('\n\n🛑 Received SIGTERM, stopping...');
      await this.stop();
      closeDatabase();
      process.exit(0);
    });
  }

  /**
   * Stop all monitoring systems
   */
  async stop() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    
    if (this.pendingSyncTimeout) {
      clearTimeout(this.pendingSyncTimeout);
      this.pendingSyncTimeout = null;
    }
    
    if (this.priceFeed) {
      await this.priceFeed.stop();
      this.priceFeed = null;
    }
    
    if (this.userDataWs) {
      this.userDataWs.close();
      this.userDataWs = null;
    }
  }

  /**
   * Print final statistics
   */
  printFinalStats() {
    const runtime = (Date.now() - this.stats.startTime.getTime()) / 1000;
    const hours = Math.floor(runtime / 3600);
    const minutes = Math.floor((runtime % 3600) / 60);
    
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  FINAL STATISTICS`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`  Runtime: ${hours}h ${minutes}m`);
    console.log(`  Total Fills: ${this.stats.totalFills}`);
    console.log(`  Total Replacements: ${this.stats.totalReplacements}`);
    console.log(`  Total Rebalances: ${this.stats.totalRebalances}`);
    console.log(`  WS Order Updates: ${this.stats.wsOrderUpdates}`);
    console.log(`  Sync Repairs: ${this.stats.syncRepairs}`);
    console.log(`${'═'.repeat(60)}\n`);
  }
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);
  const botName = args.find(a => !a.startsWith('--')) || args[args.indexOf('--name') + 1];
  
  if (!botName || args.includes('--help') || args.includes('-h')) {
    console.log(`
Enhanced Grid Bot Monitor v${VERSION}
`);
    console.log('Usage: node enhanced-monitor.mjs <bot-name> [options]\n');
    console.log('Options:');
    console.log('  --no-rebalance       Disable automatic grid rebalancing');
    console.log('  --no-ws              Disable native WebSocket (use REST only)');
    console.log('  --no-volatility      Disable volatility-based grid spacing');
    console.log('  --no-trend           Disable multi-timeframe trend filter');
    console.log('  --sync-interval <ms> Set sync interval in milliseconds (default: 60000)');
    console.log('  --trend-mode <mode>  Set trend filter mode: soft or hard (default: soft)');
    console.log('  --help, -h           Show this help message\n');
    console.log('Examples:');
    console.log('  node enhanced-monitor.mjs live-btc-bot');
    console.log('  node enhanced-monitor.mjs live-btc-bot --no-volatility');
    console.log('  node enhanced-monitor.mjs live-btc-bot --trend-mode hard\n');
    process.exit(botName ? 1 : 0);
  }
  
  // Parse options
  const options = {
    autoRebalance: !args.includes('--no-rebalance'),
    useNativeWebSocket: !args.includes('--no-ws'),
    useVolatilityGrid: !args.includes('--no-volatility'),
    useTrendFilter: !args.includes('--no-trend'),
    syncInterval: parseInt(args[args.indexOf('--sync-interval') + 1]) || SYNC_CONFIG.SYNC_INTERVAL,
  };
  
  // Parse trend mode
  const trendModeIdx = args.indexOf('--trend-mode');
  if (trendModeIdx !== -1 && args[trendModeIdx + 1]) {
    const mode = args[trendModeIdx + 1].toLowerCase();
    if (mode === 'hard' || mode === 'soft') {
      TREND_CONFIG.FILTER_MODE = mode;
    }
  }
  
  try {
    const monitor = new EnhancedMonitor(botName, options);
    await monitor.init();
    await monitor.start();
  } catch (error) {
    console.error('❌ Failed to start enhanced monitor:', error.message);
    process.exit(1);
  }
}

main();
