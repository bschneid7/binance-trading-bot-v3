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
import { PartialFillHandler } from './partial-fill-handler.mjs';
import { PositionSizer } from './position-sizer.mjs';
import { TimeOfDayOptimizer } from './time-optimizer.mjs';
import { CorrelationRiskManager } from './correlation-risk.mjs';
import { AdaptiveGridManager } from './adaptive-grid.mjs';
import { FeeTracker } from './fee-tracker.mjs';
import { SpreadOptimizer } from './spread-optimizer.mjs';
import { OrderBatcher } from './order-batcher.mjs';
import { GridTrailer } from './grid-trailer.mjs';
import { SentimentIntegration } from './sentiment-integration.mjs';
import { VERSION } from './config.mjs';

dotenv.config({ path: '.env.production' });

// Use centralized version from config.mjs
const MONITOR_VERSION = `${VERSION.enhancedMonitor}-ENHANCED`;

// Risk configuration
const RISK_CONFIG = {
  STOP_LOSS_PERCENT: 0.15,
  TRAILING_STOP_PERCENT: 0.05,
  MAX_RISK_PER_TRADE: 0.02,
  REBALANCE_THRESHOLD: 0.07,  // Rebalance when price is 7% outside grid
  MIN_PROFIT_FOR_TRAILING: 0.03,
};

// Grid rebalancing configuration
const REBALANCE_CONFIG = {
  // How far outside the grid (as % of grid range) before triggering rebalance
  TRIGGER_THRESHOLD: 0.07,
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

// Partial fill handling configuration
const PARTIAL_FILL_CONFIG = {
  ENABLED: true,
  // How long to wait before handling a partial fill (minutes)
  STALE_THRESHOLD_MINUTES: 30,
  // Minimum fill percentage to consider handling
  MIN_FILL_PERCENT: 5,
  // Maximum fill percentage - if almost filled, let it complete
  MAX_FILL_PERCENT: 95,
  // How often to check for partial fills (ms)
  CHECK_INTERVAL: 5 * 60 * 1000,  // 5 minutes
};

// Dynamic position sizing configuration
const POSITION_SIZING_CONFIG = {
  ENABLED: true,
  MAX_RISK_PER_TRADE: 0.02,      // 2% max risk per trade
  MAX_POSITION_PERCENT: 0.10,    // 10% max of equity per position
  MIN_POSITION_PERCENT: 0.005,   // 0.5% min position
  KELLY_FRACTION: 0.25,          // Use 25% of Kelly (conservative)
  UPDATE_INTERVAL: 10 * 60 * 1000,  // 10 minutes
};

// Trend filter configuration
const TREND_CONFIG = {
  ENABLED: true,
  TIMEFRAMES: ['4h', '1d'],
  FILTER_MODE: 'soft',  // 'soft' = warn only, 'hard' = block orders
  UPDATE_INTERVAL: 5 * 60 * 1000,  // 5 minutes
};

// Time-of-day optimization configuration
const TIME_OPTIMIZER_CONFIG = {
  ENABLED: true,
  UPDATE_INTERVAL: 15 * 60 * 1000,  // 15 minutes
};

// Correlation risk management configuration
const CORRELATION_CONFIG = {
  ENABLED: true,
  HIGH_CORRELATION_THRESHOLD: 0.8,
  LOW_CORRELATION_THRESHOLD: 0.3,
  HIGH_CORRELATION_REDUCTION: 0.7,  // Reduce to 70% when high correlation
  UPDATE_INTERVAL: 60 * 60 * 1000,  // 1 hour
};

// Adaptive grid spacing configuration
const ADAPTIVE_GRID_CONFIG = {
  ENABLED: true,
  MIN_GRID_MULTIPLIER: 0.5,
  MAX_GRID_MULTIPLIER: 2.0,
  UPDATE_INTERVAL: 10 * 60 * 1000,  // 10 minutes
};

// Fee tracking configuration
const FEE_TRACKER_CONFIG = {
  ENABLED: true,
  MAKER_FEE_RATE: 0.001,  // 0.1%
  TAKER_FEE_RATE: 0.002,  // 0.2%
  USE_BNB_FOR_FEES: false,
  REPORT_INTERVAL: 60 * 60 * 1000,  // 1 hour
};

// Spread optimizer configuration
const SPREAD_OPTIMIZER_CONFIG = {
  ENABLED: true,
  FORCE_MAKER: true,  // Always try to be maker
  MAX_PRICE_ADJUSTMENT: 0.005,  // Max 0.5% price adjustment
  UPDATE_INTERVAL: 10 * 1000,  // 10 seconds
};

// Order batching configuration
const ORDER_BATCHER_CONFIG = {
  ENABLED: true,
  MAX_BATCH_SIZE: 10,  // Max orders per batch
  BATCH_DELAY_MS: 100,  // Delay between batches
  MIN_ORDER_INTERVAL_MS: 50,  // Min time between orders
};

// Proactive grid trailing configuration
const GRID_TRAILER_CONFIG = {
  ENABLED: true,
  TRAIL_THRESHOLD_PERCENT: 5,  // Trigger shift when within 5% of boundary
  SHIFT_AMOUNT_PERCENT: 15,    // Shift grid by 15% of range
  TREND_BIAS: 0.6,             // 60% of range in trend direction
  SHIFT_COOLDOWN_MS: 60 * 60 * 1000,  // 1 hour between shifts
};

// Sentiment analysis configuration (refined based on 14-month backtest Dec 2025)
const SENTIMENT_CONFIG = {
  ENABLED: true,
  UPDATE_INTERVAL: 15 * 60 * 1000,  // 15 minutes
  // Position sizing adjustments based on sentiment
  POSITION_SIZING: {
    ENABLED: true,
    MIN_MULTIPLIER: 0.5,
    MAX_MULTIPLIER: 1.5,
  },
  // Grid spacing adjustments
  GRID_SPACING: {
    ENABLED: true,
    MIN_MULTIPLIER: 0.8,
    MAX_MULTIPLIER: 1.2,
  },
  // Order placement controls (refined thresholds for earlier detection)
  ORDER_PLACEMENT: {
    ENABLED: true,
    SKIP_BUYS_ABOVE_SCORE: 75,   // Skip buys in extreme greed (lowered from 80)
    SKIP_SELLS_BELOW_SCORE: 25,  // Skip sells in extreme fear (raised from 20)
  },
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
      usePartialFillHandler: PARTIAL_FILL_CONFIG.ENABLED,
      useDynamicSizing: POSITION_SIZING_CONFIG.ENABLED,
      useTimeOptimizer: TIME_OPTIMIZER_CONFIG.ENABLED,
      useCorrelationRisk: CORRELATION_CONFIG.ENABLED,
      useAdaptiveGrid: ADAPTIVE_GRID_CONFIG.ENABLED,
      useFeeTracker: FEE_TRACKER_CONFIG.ENABLED,
      useSpreadOptimizer: SPREAD_OPTIMIZER_CONFIG.ENABLED,
      useOrderBatcher: ORDER_BATCHER_CONFIG.ENABLED,
      useGridTrailer: GRID_TRAILER_CONFIG.ENABLED,
      useSentiment: SENTIMENT_CONFIG.ENABLED,
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
      partialFillsHandled: 0,
      capitalRecovered: 0,
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
    
    // Partial fill handler
    this.partialFillHandler = new PartialFillHandler({
      staleThresholdMinutes: PARTIAL_FILL_CONFIG.STALE_THRESHOLD_MINUTES,
      minFillPercentage: PARTIAL_FILL_CONFIG.MIN_FILL_PERCENT,
      maxFillPercentage: PARTIAL_FILL_CONFIG.MAX_FILL_PERCENT,
    });
    this.partialFillTimer = null;
    this.lastPartialFillCheck = 0;
    
    // Position sizer
    this.positionSizer = new PositionSizer({
      maxRiskPerTrade: POSITION_SIZING_CONFIG.MAX_RISK_PER_TRADE,
      maxPositionPercent: POSITION_SIZING_CONFIG.MAX_POSITION_PERCENT,
      minPositionPercent: POSITION_SIZING_CONFIG.MIN_POSITION_PERCENT,
      kellyFraction: POSITION_SIZING_CONFIG.KELLY_FRACTION,
    });
    this.currentPositionSize = null;
    this.lastPositionSizeUpdate = 0;
    
    // Time-of-day optimizer
    this.timeOptimizer = new TimeOfDayOptimizer();
    this.currentTimeAnalysis = null;
    this.lastTimeAnalysisUpdate = 0;
    
    // Correlation risk manager (shared across bots via static instance)
    this.correlationManager = new CorrelationRiskManager({
      highCorrelationThreshold: CORRELATION_CONFIG.HIGH_CORRELATION_THRESHOLD,
      lowCorrelationThreshold: CORRELATION_CONFIG.LOW_CORRELATION_THRESHOLD,
      highCorrelationReduction: CORRELATION_CONFIG.HIGH_CORRELATION_REDUCTION,
    });
    this.currentCorrelationAnalysis = null;
    this.lastCorrelationUpdate = 0;
    
    // Adaptive grid manager
    this.adaptiveGridManager = new AdaptiveGridManager({
      minGridMultiplier: ADAPTIVE_GRID_CONFIG.MIN_GRID_MULTIPLIER,
      maxGridMultiplier: ADAPTIVE_GRID_CONFIG.MAX_GRID_MULTIPLIER,
    });
    this.currentAdaptiveAnalysis = null;
    this.lastAdaptiveUpdate = 0;
    
    // Fee tracker
    this.feeTracker = new FeeTracker({
      makerFeeRate: FEE_TRACKER_CONFIG.MAKER_FEE_RATE,
      takerFeeRate: FEE_TRACKER_CONFIG.TAKER_FEE_RATE,
      useBnbForFees: FEE_TRACKER_CONFIG.USE_BNB_FOR_FEES,
    });
    this.lastFeeReport = 0;
    
    // Spread optimizer
    this.spreadOptimizer = new SpreadOptimizer({
      maxPriceAdjustment: SPREAD_OPTIMIZER_CONFIG.MAX_PRICE_ADJUSTMENT,
    });
    this.lastSpreadUpdate = 0;
    
    // Order batcher
    this.orderBatcher = new OrderBatcher({
      maxBatchSize: ORDER_BATCHER_CONFIG.MAX_BATCH_SIZE,
      batchDelayMs: ORDER_BATCHER_CONFIG.BATCH_DELAY_MS,
      minOrderIntervalMs: ORDER_BATCHER_CONFIG.MIN_ORDER_INTERVAL_MS,
    });
    
    // Grid trailer for proactive range shifting
    this.gridTrailer = new GridTrailer({
      TRAIL_THRESHOLD_PERCENT: GRID_TRAILER_CONFIG.TRAIL_THRESHOLD_PERCENT,
      SHIFT_AMOUNT_PERCENT: GRID_TRAILER_CONFIG.SHIFT_AMOUNT_PERCENT,
      TREND_BIAS: GRID_TRAILER_CONFIG.TREND_BIAS,
      SHIFT_COOLDOWN_MS: GRID_TRAILER_CONFIG.SHIFT_COOLDOWN_MS,
    });
    this.lastGridShiftCheck = 0;
    
    // Sentiment integration
    this.sentimentIntegration = null;
    this.currentSentiment = null;
    this.lastSentimentUpdate = 0;
    
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
    console.log(`  ENHANCED GRID BOT MONITOR v${MONITOR_VERSION}`);
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
    
    // 0. Update database status to 'running'
    try {
      const updateStmt = this.db.prepare(`UPDATE grid_bots SET status = 'running', updated_at = datetime('now') WHERE name = ?`);
      updateStmt.run(this.botName);
      console.log(`✅ Database status updated to 'running' for ${this.botName}`);
    } catch (err) {
      console.error(`⚠️ Failed to update database status: ${err.message}`);
    }
    
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
    
    // 6. Start partial fill handler
    if (this.options.usePartialFillHandler) {
      this.startPartialFillHandler();
    }
    
    // 7. Initialize dynamic position sizing
    if (this.options.useDynamicSizing) {
      await this.updatePositionSize();
    }
    
    // 8. Initialize time-of-day optimizer
    if (this.options.useTimeOptimizer) {
      this.updateTimeAnalysis();
    }
    
    // 9. Initialize adaptive grid
    if (this.options.useAdaptiveGrid) {
      // Will populate as price data comes in
      console.log('📊 Adaptive grid manager initialized (collecting data...)');
    }
    
    // 10. Initialize fee tracker
    if (this.options.useFeeTracker) {
      console.log('💰 Fee tracker initialized (monitoring maker/taker fees)');
    }
    
    // 11. Initialize spread optimizer
    if (this.options.useSpreadOptimizer) {
      console.log('📈 Spread optimizer initialized (ensuring maker orders)');
      // Start periodic order book updates
      this.startSpreadMonitoring();
    }
    
    // 12. Initialize order batcher
    if (this.options.useOrderBatcher) {
      console.log('📦 Order batcher initialized (optimized batch execution)');
    }
    
    // 13. Initialize grid trailer
    if (this.options.useGridTrailer) {
      this.gridTrailer.init(this.bot.lower_price, this.bot.upper_price);
      console.log('🎯 Grid trailer initialized (proactive range shifting)');
    }
    
    // 14. Initialize sentiment analysis
    if (this.options.useSentiment) {
      await this.initSentiment();
    }
    
    // 15. Setup graceful shutdown
    this.setupShutdown();
    
    console.log('\n✅ Enhanced monitor fully operational\n');
    console.log('Features active:');
    console.log(`  ✓ Real-time price feed (${this.options.useNativeWebSocket ? 'WebSocket' : 'REST polling'})`);
    console.log(`  ✓ Order database sync (every ${this.options.syncInterval / 1000}s)`);
    console.log(`  ✓ Smart grid rebalancing (${this.options.autoRebalance ? 'AUTO' : 'MANUAL'})`);
    console.log(`  ✓ Volatility-based grid spacing (${this.options.useVolatilityGrid ? 'ENABLED' : 'DISABLED'})`);
    console.log(`  ✓ Multi-timeframe trend filter (${this.options.useTrendFilter ? 'ENABLED' : 'DISABLED'})`);
    console.log(`  ✓ Partial fill recovery (${this.options.usePartialFillHandler ? 'ENABLED' : 'DISABLED'})`);
    console.log(`  ✓ Dynamic position sizing (${this.options.useDynamicSizing ? 'ENABLED' : 'DISABLED'})`);
    console.log(`  ✓ Time-of-day optimization (${this.options.useTimeOptimizer ? 'ENABLED' : 'DISABLED'})`);
    console.log(`  ✓ Correlation risk management (${this.options.useCorrelationRisk ? 'ENABLED' : 'DISABLED'})`);
    console.log(`  ✓ Adaptive grid spacing (${this.options.useAdaptiveGrid ? 'ENABLED' : 'DISABLED'})`);
    console.log(`  ✓ Fee tier tracking (${this.options.useFeeTracker ? 'ENABLED' : 'DISABLED'})`);
    console.log(`  ✓ Spread-aware orders (${this.options.useSpreadOptimizer ? 'ENABLED' : 'DISABLED'})`);
    console.log(`  ✓ Smart order batching (${this.options.useOrderBatcher ? 'ENABLED' : 'DISABLED'})`);
    console.log(`  ✓ Proactive grid trailing (${this.options.useGridTrailer ? 'ENABLED' : 'DISABLED'})`);
    console.log(`  ✓ Sentiment analysis (${this.options.useSentiment ? 'ENABLED' : 'DISABLED'})`);
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
    
    // Record trade for fee tracking
    this.recordTradeForFees({
      symbol: symbol,
      side: trade.side,
      price: trade.price,
      amount: trade.amount,
      fee: trade.fee,
      feeAsset: trade.feeAsset,
      isMaker: trade.isMaker,
      orderId: trade.orderId,
      timestamp: Date.now(),
    });
    
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
    
    // Update position sizing periodically
    await this.maybeUpdatePositionSize();
    
    // Update time-of-day analysis periodically
    this.maybeUpdateTimeAnalysis();
    
    // Update correlation risk periodically
    this.maybeUpdateCorrelationRisk();
    
    // Update adaptive grid analysis
    this.maybeUpdateAdaptiveGrid();
    
    // Check for proactive grid shift
    await this.maybeShiftGrid();
    
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
    
    // Add time session info if available
    if (this.currentTimeAnalysis && this.options.useTimeOptimizer) {
      statusLine += ` | Session: ${this.currentTimeAnalysis.session}`;
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
      
      if (!this.testMode && activeOrders.length > 0) {
        // Use batched cancellation if enabled
        if (this.options.useOrderBatcher && activeOrders.length > 1) {
          const orderIds = activeOrders.map(o => o.id);
          const cancelResult = await this.orderBatcher.cancelBatchOrders(
            this.exchange,
            orderIds,
            this.bot.symbol
          );
          console.log(`   📦 Cancelled ${cancelResult.cancelled}/${activeOrders.length} orders in ${(cancelResult.executionTime / 1000).toFixed(1)}s`);
        } else {
          // Sequential cancellation
          for (const order of activeOrders) {
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
        }
      }
      
      // Update database
      for (const order of activeOrders) {
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
    
    // Use dynamic order size if available
    const orderSize = this.getCurrentOrderSize();
    
    for (let i = 0; i <= gridCount; i++) {
      const price = lower + (step * i);
      const side = price < currentPrice ? 'buy' : 'sell';
      
      // Skip level too close to current price
      if (Math.abs(price - currentPrice) < step * 0.3) continue;
      
      levels.push({
        price: Math.round(price * 100) / 100,
        side,
        amount: orderSize,
      });
    }
    
    return levels;
  }

  /**
   * Place grid orders (with optional batching)
   */
  async placeGridOrders(levels) {
    if (this.testMode) {
      // Test mode: create orders directly in DB
      let placed = 0;
      for (const level of levels) {
        const orderId = `${this.botName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.db.createOrder({
          id: orderId,
          bot_name: this.botName,
          symbol: this.bot.symbol,
          side: level.side,
          price: level.price,
          amount: level.amount,
        });
        placed++;
      }
      console.log(`   Placed ${placed}/${levels.length} orders (test mode)`);
      return placed;
    }
    
    // Live mode: use order batcher if enabled
    if (this.options.useOrderBatcher && levels.length > 1) {
      return await this.placeGridOrdersBatched(levels);
    }
    
    // Fallback: sequential placement
    let placed = 0;
    for (const level of levels) {
      try {
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
   * Place grid orders using batch optimization
   */
  async placeGridOrdersBatched(levels) {
    const estimate = this.orderBatcher.estimateExecutionTime(levels.length);
    console.log(`   📦 Batching ${levels.length} orders (est. ${estimate.estimatedSeconds.toFixed(1)}s, ${estimate.timeSavedPercent.toFixed(0)}% faster)`);
    
    // Optimize order list for efficient execution
    const optimizedLevels = this.orderBatcher.optimizeOrderList(levels);
    
    // Prepare orders for batching
    const orders = optimizedLevels.map(level => ({
      side: level.side,
      amount: level.amount,
      price: level.price,
    }));
    
    // Execute batch
    const result = await this.orderBatcher.placeBatchOrders(
      this.exchange,
      orders,
      {
        symbol: this.bot.symbol,
        onProgress: (progress) => {
          if (progress.batch % 3 === 0 || progress.batch === progress.totalBatches) {
            console.log(`   📦 Batch ${progress.batch}/${progress.totalBatches} (${progress.ordersPlaced}/${progress.totalOrders} orders)`);
          }
        },
      }
    );
    
    // Record successful orders in database
    for (const r of result.results) {
      if (r.success && r.response) {
        this.db.createOrder({
          id: r.response.id,
          bot_name: this.botName,
          symbol: this.bot.symbol,
          side: r.order.side,
          price: r.order.price,
          amount: r.response.amount || r.order.amount,
        });
      }
    }
    
    // Log results
    const stats = this.orderBatcher.getStats();
    console.log(`   ✅ Placed ${result.placed}/${levels.length} orders in ${(result.executionTime / 1000).toFixed(1)}s`);
    if (result.failed > 0) {
      console.log(`   ⚠️  ${result.failed} orders failed`);
    }
    console.log(`   📊 API calls saved: ${stats.apiCallsSaved} (${stats.successRate.toFixed(1)}% success rate)`);
    
    return result.placed;
  }

  /**
   * Place replacement order after a fill
   */
  async placeReplacementOrder(filledTrade) {
    const oppositeSide = filledTrade.side === 'buy' ? 'sell' : 'buy';
    
    // Get dynamic order size with combined multipliers
    let orderSize = this.getCurrentOrderSize() || filledTrade.amount;
    const positionMultiplier = this.getCombinedPositionMultiplier();
    orderSize *= positionMultiplier;
    
    // Get grid spacing with combined multipliers
    let gridSpacing = (this.bot.upper_price - this.bot.lower_price) / this.bot.adjusted_grid_count;
    const gridMultiplier = this.getCombinedGridMultiplier();
    gridSpacing *= gridMultiplier;
    
    let newPrice = filledTrade.side === 'buy'
      ? filledTrade.price + gridSpacing
      : filledTrade.price - gridSpacing;
    
    // Optimize price for maker status
    if (this.options.useSpreadOptimizer) {
      const optimized = this.optimizeOrderPrice(oppositeSide, newPrice);
      if (optimized.wasAdjusted) {
        console.log(`   📊 Price adjusted for maker: $${newPrice.toFixed(2)} → $${optimized.optimizedPrice.toFixed(2)}`);
        newPrice = optimized.optimizedPrice;
      }
    }
    
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
    
    // Check sentiment filter before placing order
    if (this.options.useSentiment && !this.shouldPlaceOrderBySentiment(oppositeSide)) {
      const symbol = this.bot.symbol.replace('USDT', '').replace('USD', '');
      const rec = this.sentimentIntegration?.getRecommendation(symbol);
      console.log(`   🚫 Sentiment filter blocked ${oppositeSide.toUpperCase()}: Score ${rec?.score}/100`);
      return;
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
          amount: orderSize,
        });
      } else {
        const order = await retryWithBackoff(
          () => this.circuitBreaker.execute(() =>
            this.exchange.createLimitOrder(this.bot.symbol, oppositeSide, orderSize, newPrice)
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
          try {
            // Check if order exists (might be in a different state)
            const existingOrder = this.db.getOrder(order.id);
            if (!existingOrder) {
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
          } catch (e) {
            // Order already exists, skip
            if (!e.message?.includes('UNIQUE constraint')) {
              console.error(`   Sync order error: ${e.message}`);
            }
          }
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
   * Start periodic partial fill checking
   */
  startPartialFillHandler() {
    console.log(`🔧 Starting partial fill handler (check every ${PARTIAL_FILL_CONFIG.CHECK_INTERVAL / 1000}s)...`);
    
    // Run initial check after a delay
    setTimeout(() => this.checkPartialFills(), 30000);  // 30 second delay
    
    // Start periodic checks
    this.partialFillTimer = setInterval(async () => {
      await this.checkPartialFills();
    }, PARTIAL_FILL_CONFIG.CHECK_INTERVAL);
  }

  /**
   * Check for and handle partial fills
   */
  async checkPartialFills() {
    if (!this.options.usePartialFillHandler || this.testMode) {
      return;
    }
    
    try {
      const result = await this.partialFillHandler.processPartialFills(
        this.exchange,
        this.db,
        this.botName,
        this.bot.symbol
      );
      
      if (result.handled > 0) {
        console.log(`\n🔧 PARTIAL FILL RECOVERY`);
        console.log(`   Handled: ${result.handled} partial fill(s)`);
        console.log(`   Capital recovered: $${result.capitalRecovered.toFixed(2)}`);
        
        this.stats.partialFillsHandled += result.handled;
        this.stats.capitalRecovered += result.capitalRecovered;
        
        // Place replacement orders for recovered capital
        for (const r of result.results) {
          if (r.success && r.trade) {
            await this.placeReplacementOrder(r.trade);
          }
        }
        
        // Sync orders after handling partial fills
        await this.syncOrders();
      }
      
      this.lastPartialFillCheck = Date.now();
      
      // Cleanup old entries from handler cache
      this.partialFillHandler.cleanupCache();
      
    } catch (error) {
      console.error(`❌ Partial fill check error: ${error.message}`);
    }
  }

  /**
   * Update dynamic position size
   */
  async updatePositionSize() {
    if (!this.options.useDynamicSizing) {
      return;
    }
    
    try {
      const gridSpacing = (this.bot.upper_price - this.bot.lower_price) / this.bot.adjusted_grid_count / this.currentPrice;
      
      const sizing = await this.positionSizer.getSizingRecommendation({
        db: this.db,
        exchange: this.exchange,
        botName: this.botName,
        symbol: this.bot.symbol,
        baseOrderSize: this.bot.order_size,
        volatility: this.currentVolatility?.volatility,
        gridSpacing,
      });
      
      this.currentPositionSize = sizing;
      this.lastPositionSizeUpdate = Date.now();
      
      // Log sizing info
      console.log(`\n📊 POSITION SIZING`);
      console.log(`   Base size: ${sizing.baseSize}`);
      console.log(`   Adjusted size: ${sizing.adjustedSize} (${sizing.sizeChange > 0 ? '+' : ''}${sizing.sizeChange}%)`);
      console.log(`   Equity used: ${sizing.metrics?.equityUsed || 'N/A'}`);
      
      if (sizing.adjustments && sizing.adjustments.length > 0) {
        for (const adj of sizing.adjustments) {
          console.log(`   → ${adj.factor}: ${adj.reason}`);
        }
      }
      
    } catch (error) {
      console.error(`❌ Position sizing error: ${error.message}`);
    }
  }

  /**
   * Get current position size (dynamic or base)
   */
  getCurrentOrderSize() {
    if (this.options.useDynamicSizing && this.currentPositionSize) {
      return this.currentPositionSize.adjustedSize;
    }
    return this.bot.order_size;
  }

  /**
   * Check if position size needs updating
   */
  async maybeUpdatePositionSize() {
    if (!this.options.useDynamicSizing) {
      return;
    }
    
    const timeSinceLastUpdate = Date.now() - this.lastPositionSizeUpdate;
    if (timeSinceLastUpdate >= POSITION_SIZING_CONFIG.UPDATE_INTERVAL) {
      await this.updatePositionSize();
    }
  }

  /**
   * Update time-of-day analysis
   */
  updateTimeAnalysis() {
    if (!this.options.useTimeOptimizer) {
      return;
    }
    
    try {
      this.currentTimeAnalysis = this.timeOptimizer.getGridAdjustment();
      this.lastTimeAnalysisUpdate = Date.now();
      
      // Only log detailed info periodically
      if (this.currentTimeAnalysis.isHighVolume || this.currentTimeAnalysis.isLowVolume) {
        console.log(`\n⏰ TIME ANALYSIS`);
        console.log(`   Session: ${this.currentTimeAnalysis.session}`);
        console.log(`   Volume: ${(this.currentTimeAnalysis.volumeMultiplier * 100).toFixed(0)}%`);
        console.log(`   ${this.currentTimeAnalysis.recommendation}`);
      }
      
    } catch (error) {
      console.error(`❌ Time analysis error: ${error.message}`);
    }
  }

  /**
   * Check if time analysis needs updating
   */
  maybeUpdateTimeAnalysis() {
    if (!this.options.useTimeOptimizer) {
      return;
    }
    
    const timeSinceLastUpdate = Date.now() - this.lastTimeAnalysisUpdate;
    if (timeSinceLastUpdate >= TIME_OPTIMIZER_CONFIG.UPDATE_INTERVAL) {
      this.updateTimeAnalysis();
    }
  }

  /**
   * Update correlation risk analysis
   */
  updateCorrelationRisk() {
    if (!this.options.useCorrelationRisk) {
      return;
    }
    
    try {
      // Record current price for this symbol
      this.correlationManager.recordPrice(this.bot.symbol, this.currentPrice);
      
      // Get correlation analysis
      this.currentCorrelationAnalysis = this.correlationManager.getAnalysis();
      this.lastCorrelationUpdate = Date.now();
      
      // Log if elevated risk
      if (this.currentCorrelationAnalysis.overallRisk !== 'normal') {
        console.log(`\n⚠️ CORRELATION RISK: ${this.currentCorrelationAnalysis.overallRisk.toUpperCase()}`);
        console.log(`   Avg Correlation: ${(this.currentCorrelationAnalysis.correlation.avgCorrelation * 100).toFixed(0)}%`);
        console.log(`   Position Multiplier: ${(this.currentCorrelationAnalysis.overallMultiplier * 100).toFixed(0)}%`);
        console.log(`   ${this.currentCorrelationAnalysis.correlation.recommendation}`);
      }
      
    } catch (error) {
      console.error(`❌ Correlation analysis error: ${error.message}`);
    }
  }

  /**
   * Check if correlation analysis needs updating
   */
  maybeUpdateCorrelationRisk() {
    if (!this.options.useCorrelationRisk) {
      return;
    }
    
    // Always record price
    this.correlationManager.recordPrice(this.bot.symbol, this.currentPrice);
    
    const timeSinceLastUpdate = Date.now() - this.lastCorrelationUpdate;
    if (timeSinceLastUpdate >= CORRELATION_CONFIG.UPDATE_INTERVAL) {
      this.updateCorrelationRisk();
    }
  }

  /**
   * Update adaptive grid analysis
   */
  updateAdaptiveGrid() {
    if (!this.options.useAdaptiveGrid) {
      return;
    }
    
    try {
      // Record current price
      this.adaptiveGridManager.recordPrice(this.currentPrice);
      
      // Get adaptive grid analysis
      this.currentAdaptiveAnalysis = this.adaptiveGridManager.getAnalysis();
      this.lastAdaptiveUpdate = Date.now();
      
      // Log regime changes
      if (this.currentAdaptiveAnalysis.regime !== 'unknown' && this.currentAdaptiveAnalysis.confidence > 0.5) {
        console.log(`\n📊 ADAPTIVE GRID`);
        console.log(`   Regime: ${this.currentAdaptiveAnalysis.regime.toUpperCase()} (${(this.currentAdaptiveAnalysis.confidence * 100).toFixed(0)}% confidence)`);
        console.log(`   Grid Multiplier: ${this.currentAdaptiveAnalysis.gridMultiplier.toFixed(2)}x`);
        console.log(`   Suitability: ${this.currentAdaptiveAnalysis.suitability}`);
        console.log(`   ${this.currentAdaptiveAnalysis.recommendation}`);
      }
      
    } catch (error) {
      console.error(`❌ Adaptive grid error: ${error.message}`);
    }
  }

  /**
   * Check if adaptive grid analysis needs updating
   */
  maybeUpdateAdaptiveGrid() {
    if (!this.options.useAdaptiveGrid) {
      return;
    }
    
    // Always record price
    this.adaptiveGridManager.recordPrice(this.currentPrice);
    
    const timeSinceLastUpdate = Date.now() - this.lastAdaptiveUpdate;
    if (timeSinceLastUpdate >= ADAPTIVE_GRID_CONFIG.UPDATE_INTERVAL) {
      this.updateAdaptiveGrid();
    }
  }

  /**
   * Get combined grid spacing multiplier from all modules
   */
  getCombinedGridMultiplier() {
    let multiplier = 1.0;
    
    // Volatility adjustment
    if (this.options.useVolatilityGrid && this.currentVolatility) {
      multiplier *= this.currentVolatility.volatility.multiplier;
    }
    
    // Time-of-day adjustment
    if (this.options.useTimeOptimizer && this.currentTimeAnalysis) {
      multiplier *= this.currentTimeAnalysis.gridDensityMultiplier;
    }
    
    // Adaptive grid adjustment
    if (this.options.useAdaptiveGrid && this.currentAdaptiveAnalysis && this.currentAdaptiveAnalysis.regime !== 'unknown') {
      multiplier *= this.currentAdaptiveAnalysis.gridMultiplier;
    }
    
    // Sentiment-based adjustment (tighter grids in extreme sentiment)
    if (this.options.useSentiment && this.sentimentIntegration) {
      const symbol = this.bot.symbol.replace('USDT', '').replace('USD', '');
      const sentimentMultiplier = this.sentimentIntegration.getGridSpacingMultiplier(symbol);
      multiplier *= sentimentMultiplier;
    }
    
    // Clamp to reasonable range
    return Math.max(0.3, Math.min(3.0, multiplier));
  }

  /**
   * Get combined position size multiplier from all modules
   */
  getCombinedPositionMultiplier() {
    let multiplier = 1.0;
    
    // Time-of-day adjustment
    if (this.options.useTimeOptimizer && this.currentTimeAnalysis) {
      multiplier *= this.currentTimeAnalysis.orderSizeMultiplier;
    }
    
    // Correlation risk adjustment
    if (this.options.useCorrelationRisk && this.currentCorrelationAnalysis) {
      multiplier *= this.currentCorrelationAnalysis.overallMultiplier;
    }
    
    // Sentiment-based adjustment
    if (this.options.useSentiment && this.sentimentIntegration) {
      const symbol = this.bot.symbol.replace('USDT', '').replace('USD', '');
      const sentimentMultiplier = this.sentimentIntegration.getPositionSizeMultiplier(symbol);
      multiplier *= sentimentMultiplier;
    }
    
    // Clamp to reasonable range
    return Math.max(0.5, Math.min(1.5, multiplier));
  }

  /**
   * Check if grid should be proactively shifted
   */
  async maybeShiftGrid() {
    if (!this.options.useGridTrailer || this.testMode) {
      return;
    }
    
    try {
      // FIRST: Check for emergency recovery (price escaped grid entirely)
      const emergencyResult = this.gridTrailer.checkForEmergencyRecovery(
        this.currentPrice,
        this.bot.lower_price,
        this.bot.upper_price
      );
      
      if (emergencyResult) {
        console.log(`\n🚨 EMERGENCY GRID RECOVERY TRIGGERED`);
        console.log(`   Reason: ${emergencyResult.reason}`);
        console.log(`   Trend: ${emergencyResult.trend} (strength: ${(emergencyResult.trendStrength * 100).toFixed(0)}%)`);
        console.log(`   Current range: $${this.bot.lower_price.toFixed(2)} - $${this.bot.upper_price.toFixed(2)}`);
        console.log(`   Recovery range: $${emergencyResult.lower.toFixed(2)} - $${emergencyResult.upper.toFixed(2)}`);
        
        // Execute the emergency recovery
        await this.executeGridShift(emergencyResult.lower, emergencyResult.upper);
        
        // Record the emergency recovery
        this.gridTrailer.recordEmergencyRecovery(
          this.bot.lower_price,
          this.bot.upper_price,
          emergencyResult.lower,
          emergencyResult.upper
        );
        
        return;
      }
      
      // SECOND: Check for proactive shift (price near boundary)
      const shiftResult = this.gridTrailer.checkForShift(
        this.currentPrice,
        this.bot.lower_price,
        this.bot.upper_price
      );
      
      if (!shiftResult) {
        return;
      }
      
      console.log(`\n🎯 PROACTIVE GRID SHIFT DETECTED`);
      console.log(`   Reason: ${shiftResult.reason}`);
      console.log(`   Trend: ${shiftResult.trend} (strength: ${(shiftResult.trendStrength * 100).toFixed(0)}%)`);
      console.log(`   Current range: $${this.bot.lower_price.toFixed(2)} - $${this.bot.upper_price.toFixed(2)}`);
      console.log(`   Proposed range: $${shiftResult.lower.toFixed(2)} - $${shiftResult.upper.toFixed(2)}`);
      
      // Execute the shift
      await this.executeGridShift(shiftResult.lower, shiftResult.upper);
      
      // Record the shift
      this.gridTrailer.recordShift(
        this.bot.lower_price,
        this.bot.upper_price,
        shiftResult.lower,
        shiftResult.upper
      );
      
    } catch (error) {
      console.error(`❌ Grid shift error: ${error.message}`);
    }
  }

  /**
   * Execute a grid shift by updating range and rebalancing
   */
  async executeGridShift(newLower, newUpper) {
    const oldLower = this.bot.lower_price;
    const oldUpper = this.bot.upper_price;
    
    console.log(`\n🔄 EXECUTING GRID SHIFT`);
    console.log(`   Old: $${oldLower.toFixed(2)} - $${oldUpper.toFixed(2)}`);
    console.log(`   New: $${newLower.toFixed(2)} - $${newUpper.toFixed(2)}`);
    
    // Update database with new range
    try {
      this.db.db.prepare(`
        UPDATE bots SET lower_price = ?, upper_price = ? WHERE name = ?
      `).run(newLower, newUpper, this.botName);
      
      // Update local bot object
      this.bot.lower_price = newLower;
      this.bot.upper_price = newUpper;
      
      console.log(`   ✅ Database updated`);
    } catch (error) {
      console.error(`   ❌ Failed to update database: ${error.message}`);
      return;
    }
    
    // Trigger a rebalance with the new range
    const gridStatus = {
      outsideGrid: false,
      direction: 'SHIFT',
      deviation: 0,
      shouldRebalance: true,
    };
    
    await this.rebalanceGrid(gridStatus);
    
    console.log(`   ✅ Grid shift complete`);
  }

  /**
   * Start spread monitoring for maker order optimization
   */
  startSpreadMonitoring() {
    // Update order book periodically
    this.spreadMonitorTimer = setInterval(async () => {
      await this.updateSpreadData();
    }, SPREAD_OPTIMIZER_CONFIG.UPDATE_INTERVAL);
    
    // Initial update
    this.updateSpreadData();
  }

  /**
   * Update spread data from order book
   */
  async updateSpreadData() {
    if (!this.options.useSpreadOptimizer) {
      return;
    }
    
    try {
      const orderBook = await this.exchange.fetchOrderBook(this.bot.symbol, 5);
      this.spreadOptimizer.updateOrderBook(orderBook);
      this.lastSpreadUpdate = Date.now();
    } catch (error) {
      // Silently fail - spread data is optional
    }
  }

  /**
   * Optimize order price for maker status
   */
  optimizeOrderPrice(side, price) {
    if (!this.options.useSpreadOptimizer) {
      return { optimizedPrice: price, isMaker: false, wasAdjusted: false };
    }
    
    const result = this.spreadOptimizer.optimizeOrderPrice(side, price, {
      tickSize: this.getTickSize(),
      forceMaker: SPREAD_OPTIMIZER_CONFIG.FORCE_MAKER,
    });
    
    return {
      optimizedPrice: result.optimizedPrice,
      isMaker: result.isMaker,
      wasAdjusted: result.adjustment > 0,
      adjustment: result.adjustment,
      reason: result.reason,
    };
  }

  /**
   * Get tick size for the symbol
   */
  getTickSize() {
    // Default tick sizes based on price
    if (this.currentPrice > 10000) return 0.01;  // BTC
    if (this.currentPrice > 100) return 0.01;    // ETH
    return 0.001;  // SOL and others
  }

  /**
   * Record a trade for fee tracking
   */
  recordTradeForFees(trade) {
    if (!this.options.useFeeTracker) {
      return;
    }
    
    this.feeTracker.recordTrade({
      symbol: trade.symbol,
      side: trade.side,
      price: trade.price,
      amount: trade.amount,
      fee: trade.fee,
      feeAsset: trade.feeAsset,
      isMaker: trade.isMaker,
      orderId: trade.orderId,
      timestamp: trade.timestamp || Date.now(),
    });
    
    // Periodic fee report
    this.maybeLogFeeReport();
  }

  /**
   * Log fee report periodically
   */
  maybeLogFeeReport() {
    if (!this.options.useFeeTracker) {
      return;
    }
    
    const timeSinceLastReport = Date.now() - this.lastFeeReport;
    if (timeSinceLastReport < FEE_TRACKER_CONFIG.REPORT_INTERVAL) {
      return;
    }
    
    const stats = this.feeTracker.getStats();
    if (stats.totalTrades > 0) {
      console.log(`\n💰 FEE REPORT`);
      console.log(`   Total trades: ${stats.totalTrades} (${stats.makerPercent.toFixed(1)}% maker)`);
      console.log(`   Total fees: $${stats.totalFees.toFixed(2)} (avg ${(stats.avgFeePercent).toFixed(3)}%)`);
      console.log(`   Fees saved: $${stats.feesSaved.toFixed(2)} (vs all taker)`);
      if (stats.potentialSavings > 0) {
        console.log(`   Potential savings: $${stats.potentialSavings.toFixed(2)} (if all maker)`);
      }
      
      // Show recommendations
      const recs = this.feeTracker.getRecommendations();
      if (recs.recommendations.length > 0) {
        console.log(`   Recommendations:`);
        for (const rec of recs.recommendations) {
          console.log(`      • ${rec.message}`);
        }
      }
    }
    
    this.lastFeeReport = Date.now();
  }

  /**
   * Initialize sentiment analysis integration
   */
  async initSentiment() {
    try {
      console.log('🧠 Initializing sentiment analysis...');
      
      this.sentimentIntegration = new SentimentIntegration({
        ENABLED: SENTIMENT_CONFIG.ENABLED,
        UPDATE_INTERVAL: SENTIMENT_CONFIG.UPDATE_INTERVAL,
        POSITION_SIZING: SENTIMENT_CONFIG.POSITION_SIZING,
        GRID_SPACING: SENTIMENT_CONFIG.GRID_SPACING,
        ORDER_PLACEMENT: SENTIMENT_CONFIG.ORDER_PLACEMENT,
      });
      
      // Register callbacks for sentiment alerts
      this.sentimentIntegration.on('onExtremeAlert', (alert) => {
        console.log(`\n${alert.message}`);
      });
      
      this.sentimentIntegration.on('onSignificantChange', (change) => {
        console.log(`\n${change.message}`);
      });
      
      await this.sentimentIntegration.init();
      
      // Store initial sentiment
      this.currentSentiment = this.sentimentIntegration.getSummary();
      this.lastSentimentUpdate = Date.now();
      
      // Log initial sentiment for the bot's symbol
      const symbol = this.bot.symbol.replace('USDT', '').replace('USD', '');
      const rec = this.sentimentIntegration.getRecommendation(symbol);
      
      console.log(`   ${symbol} Sentiment: ${rec.score}/100`);
      console.log(`   Signal: ${rec.action} (${rec.confidence} confidence)`);
      console.log(`   Position Multiplier: ${(rec.positionMultiplier * 100).toFixed(0)}%`);
      console.log(`   Grid Multiplier: ${(rec.gridMultiplier * 100).toFixed(0)}%`);
      
    } catch (error) {
      console.error(`❌ Failed to initialize sentiment: ${error.message}`);
      this.sentimentIntegration = null;
    }
  }
  
  /**
   * Update sentiment data
   */
  async updateSentiment() {
    if (!this.sentimentIntegration) return;
    
    const timeSinceUpdate = Date.now() - this.lastSentimentUpdate;
    if (timeSinceUpdate < SENTIMENT_CONFIG.UPDATE_INTERVAL) return;
    
    try {
      await this.sentimentIntegration.update();
      this.currentSentiment = this.sentimentIntegration.getSummary();
      this.lastSentimentUpdate = Date.now();
      
      // Log update
      const symbol = this.bot.symbol.replace('USDT', '').replace('USD', '');
      const rec = this.sentimentIntegration.getRecommendation(symbol);
      console.log(`\n🧠 Sentiment Update: ${symbol} ${rec.score}/100 (${rec.action})`);
      
    } catch (error) {
      console.error(`❌ Sentiment update failed: ${error.message}`);
    }
  }
  
  /**
   * Check if order should be placed based on sentiment
   */
  shouldPlaceOrderBySentiment(side) {
    if (!this.options.useSentiment || !this.sentimentIntegration) {
      return true;
    }
    
    const symbol = this.bot.symbol.replace('USDT', '').replace('USD', '');
    
    if (side === 'buy') {
      return this.sentimentIntegration.shouldPlaceBuyOrders(symbol);
    } else {
      return this.sentimentIntegration.shouldPlaceSellOrders(symbol);
    }
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
    // Update database status to 'stopped'
    try {
      const updateStmt = this.db.prepare(`UPDATE grid_bots SET status = 'stopped', updated_at = datetime('now') WHERE name = ?`);
      updateStmt.run(this.botName);
      console.log(`✅ Database status updated to 'stopped' for ${this.botName}`);
    } catch (err) {
      console.error(`⚠️ Failed to update database status: ${err.message}`);
    }
    
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    
    if (this.pendingSyncTimeout) {
      clearTimeout(this.pendingSyncTimeout);
      this.pendingSyncTimeout = null;
    }
    
    if (this.partialFillTimer) {
      clearInterval(this.partialFillTimer);
      this.partialFillTimer = null;
    }
    
    if (this.spreadMonitorTimer) {
      clearInterval(this.spreadMonitorTimer);
      this.spreadMonitorTimer = null;
    }
    
    if (this.priceFeed) {
      await this.priceFeed.stop();
      this.priceFeed = null;
    }
    
    if (this.userDataWs) {
      this.userDataWs.close();
      this.userDataWs = null;
    }
    
    // Stop sentiment integration
    if (this.sentimentIntegration) {
      this.sentimentIntegration.stop();
      this.sentimentIntegration = null;
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
    console.log(`  Partial Fills Handled: ${this.stats.partialFillsHandled}`);
    console.log(`  Capital Recovered: $${this.stats.capitalRecovered.toFixed(2)}`);
    
    // Fee statistics
    if (this.options.useFeeTracker) {
      const feeStats = this.feeTracker.getStats();
      if (feeStats.totalTrades > 0) {
        console.log(`  Fee Stats:`);
        console.log(`    Total Fees: $${feeStats.totalFees.toFixed(2)}`);
        console.log(`    Maker Ratio: ${feeStats.makerPercent.toFixed(1)}%`);
        console.log(`    Fees Saved: $${feeStats.feesSaved.toFixed(2)}`);
      }
    }
    
    // Order batching statistics
    if (this.options.useOrderBatcher) {
      const batchStats = this.orderBatcher.getStats();
      if (batchStats.totalOrders > 0) {
        console.log(`  Batch Stats:`);
        console.log(`    Total Orders: ${batchStats.totalOrders}`);
        console.log(`    API Calls Saved: ${batchStats.apiCallsSaved}`);
        console.log(`    Success Rate: ${batchStats.successRate.toFixed(1)}%`);
      }
    }
    
    // Grid trailing statistics
    if (this.options.useGridTrailer) {
      const trailStats = this.gridTrailer.getStats();
      if (trailStats.shiftCount > 0) {
        console.log(`  Grid Trailing Stats:`);
        console.log(`    Total Shifts: ${trailStats.shiftCount}`);
        console.log(`    Total Movement: $${trailStats.totalShiftAmount.toFixed(2)}`);
      }
    }
    
    // Sentiment statistics
    if (this.options.useSentiment && this.currentSentiment) {
      console.log(`  Sentiment Stats:`);
      console.log(`    Fear & Greed: ${this.currentSentiment.fearGreed?.value || 'N/A'}`);
      for (const [symbol, data] of Object.entries(this.currentSentiment.scores || {})) {
        console.log(`    ${symbol} Composite: ${data.composite}/100 (${data.signal?.action || 'N/A'})`);
      }
    }
    
    console.log(`${'='.repeat(60)}\n`);
  }
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);
  const botName = args.find(a => !a.startsWith('--')) || args[args.indexOf('--name') + 1];
  
  if (!botName || args.includes('--help') || args.includes('-h')) {
    console.log(`
Enhanced Grid Bot Monitor v${MONITOR_VERSION}
`);
    console.log('Usage: node enhanced-monitor.mjs <bot-name> [options]\n');
    console.log('Options:');
    console.log('  --no-rebalance       Disable automatic grid rebalancing');
    console.log('  --no-ws              Disable native WebSocket (use REST only)');
    console.log('  --no-volatility      Disable volatility-based grid spacing');
    console.log('  --no-trend           Disable multi-timeframe trend filter');
    console.log('  --no-partial-fill    Disable partial fill recovery');
    console.log('  --no-dynamic-sizing  Disable dynamic position sizing');
    console.log('  --no-time-opt        Disable time-of-day optimization');
    console.log('  --no-correlation     Disable correlation risk management');
    console.log('  --no-adaptive-grid   Disable adaptive grid spacing');
    console.log('  --no-fee-tracker     Disable fee tier tracking');
    console.log('  --no-spread-opt      Disable spread-aware order placement');
    console.log('  --no-batching        Disable smart order batching');
    console.log('  --no-grid-trail      Disable proactive grid trailing');
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
    usePartialFillHandler: !args.includes('--no-partial-fill'),
    useDynamicSizing: !args.includes('--no-dynamic-sizing'),
    useTimeOptimizer: !args.includes('--no-time-opt'),
    useCorrelationRisk: !args.includes('--no-correlation'),
    useAdaptiveGrid: !args.includes('--no-adaptive-grid'),
    useFeeTracker: !args.includes('--no-fee-tracker'),
    useSpreadOptimizer: !args.includes('--no-spread-opt'),
    useOrderBatcher: !args.includes('--no-batching'),
    useGridTrailer: !args.includes('--no-grid-trail'),
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
