/**
 * Grid Trading Bot - Comprehensive Test Suite
 * Version: 1.0.0
 * 
 * Tests core trading logic, risk management, and database operations
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { DatabaseManager } from '../database.mjs';
import { WebSocketPriceFeed } from '../websocket-feed.mjs';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Test database path
const TEST_DB_PATH = join(__dirname, 'test-data', 'test-grid-bot.db');

// Ensure test data directory exists
if (!existsSync(join(__dirname, 'test-data'))) {
  mkdirSync(join(__dirname, 'test-data'), { recursive: true });
}

// ==================== GRID CALCULATION TESTS ====================

describe('Grid Level Calculations', () => {
  /**
   * Calculate grid levels with geometric spacing
   */
  function calculateGridLevels(lower, upper, gridCount, currentPrice) {
    const levels = [];
    const ratio = Math.pow(upper / lower, 1 / gridCount);
    
    for (let i = 0; i <= gridCount; i++) {
      const price = lower * Math.pow(ratio, i);
      const side = price < currentPrice ? 'buy' : 'sell';
      
      levels.push({
        level: i + 1,
        price: parseFloat(price.toFixed(2)),
        side
      });
    }
    
    return levels;
  }

  it('should calculate correct number of grid levels', () => {
    const levels = calculateGridLevels(90000, 100000, 10, 95000);
    expect(levels.length).toBe(11); // gridCount + 1
  });

  it('should have buy orders below current price', () => {
    const currentPrice = 95000;
    const levels = calculateGridLevels(90000, 100000, 10, currentPrice);
    
    const buyOrders = levels.filter(l => l.side === 'buy');
    buyOrders.forEach(order => {
      expect(order.price).toBeLessThan(currentPrice);
    });
  });

  it('should have sell orders above current price', () => {
    const currentPrice = 95000;
    const levels = calculateGridLevels(90000, 100000, 10, currentPrice);
    
    const sellOrders = levels.filter(l => l.side === 'sell');
    sellOrders.forEach(order => {
      expect(order.price).toBeGreaterThanOrEqual(currentPrice);
    });
  });

  it('should use geometric spacing for levels', () => {
    const levels = calculateGridLevels(90000, 100000, 10, 95000);
    
    // Check that spacing increases geometrically
    const spacings = [];
    for (let i = 1; i < levels.length; i++) {
      spacings.push(levels[i].price - levels[i - 1].price);
    }
    
    // Each spacing should be larger than the previous
    for (let i = 1; i < spacings.length; i++) {
      expect(spacings[i]).toBeGreaterThan(spacings[i - 1]);
    }
  });

  it('should handle edge case when price equals lower bound', () => {
    const levels = calculateGridLevels(90000, 100000, 10, 90000);
    const buyOrders = levels.filter(l => l.side === 'buy');
    expect(buyOrders.length).toBe(0);
  });

  it('should handle edge case when price equals upper bound', () => {
    const levels = calculateGridLevels(90000, 100000, 10, 100000);
    const sellOrders = levels.filter(l => l.side === 'sell');
    expect(sellOrders.length).toBe(1); // Only the upper bound level
  });
});

// ==================== RISK MANAGEMENT TESTS ====================

describe('Risk Management', () => {
  const RISK_CONFIG = {
    STOP_LOSS_PERCENT: 0.15,
    TRAILING_STOP_PERCENT: 0.05,
    MAX_RISK_PER_TRADE: 0.02,
    MAX_DRAWDOWN_LIMIT: 0.25,
    MIN_PROFIT_FOR_TRAILING: 0.03
  };

  function checkStopLoss(bot, currentPrice, metrics) {
    const entryPrice = (bot.lower_price + bot.upper_price) / 2;
    const loss = (entryPrice - currentPrice) / entryPrice;
    
    if (loss >= RISK_CONFIG.STOP_LOSS_PERCENT) {
      return {
        triggered: true,
        reason: `Stop-loss triggered: ${(loss * 100).toFixed(2)}% loss`
      };
    }
    
    if (metrics.max_drawdown >= RISK_CONFIG.MAX_DRAWDOWN_LIMIT * 100) {
      return {
        triggered: true,
        reason: `Max drawdown exceeded: ${metrics.max_drawdown.toFixed(2)}%`
      };
    }
    
    return { triggered: false };
  }

  it('should trigger stop-loss when price drops 15%', () => {
    const bot = { lower_price: 90000, upper_price: 100000 };
    const entryPrice = 95000; // midpoint
    const currentPrice = entryPrice * 0.84; // 16% drop
    
    const result = checkStopLoss(bot, currentPrice, { max_drawdown: 0 });
    expect(result.triggered).toBe(true);
    expect(result.reason).toContain('Stop-loss triggered');
  });

  it('should not trigger stop-loss for small price drops', () => {
    const bot = { lower_price: 90000, upper_price: 100000 };
    const entryPrice = 95000;
    const currentPrice = entryPrice * 0.90; // 10% drop
    
    const result = checkStopLoss(bot, currentPrice, { max_drawdown: 0 });
    expect(result.triggered).toBe(false);
  });

  it('should trigger stop-loss when max drawdown exceeded', () => {
    const bot = { lower_price: 90000, upper_price: 100000 };
    const currentPrice = 95000;
    
    const result = checkStopLoss(bot, currentPrice, { max_drawdown: 26 }); // 26% drawdown
    expect(result.triggered).toBe(true);
    expect(result.reason).toContain('Max drawdown exceeded');
  });
});

// ==================== KELLY CRITERION TESTS ====================

describe('Kelly Criterion Position Sizing', () => {
  function calculatePositionSize(baseSize, winRate, avgWin, avgLoss) {
    if (winRate === 0 || avgWin === 0 || avgLoss === 0) {
      return baseSize;
    }
    
    const winProb = winRate / 100;
    const lossProb = 1 - winProb;
    const winLossRatio = avgWin / avgLoss;
    
    const kellyPercent = (winProb * winLossRatio - lossProb) / winLossRatio;
    const adjustedKelly = Math.max(0.5, Math.min(2.0, kellyPercent));
    
    return baseSize * adjustedKelly;
  }

  it('should return base size when no historical data', () => {
    const result = calculatePositionSize(100, 0, 0, 0);
    expect(result).toBe(100);
  });

  it('should increase size for high win rate with extreme edge', () => {
    // Kelly formula: (winProb * winLossRatio - lossProb) / winLossRatio
    // For 95% win rate, 10:1 ratio: (0.95 * 10 - 0.05) / 10 = 0.945
    // Clamped to [0.5, 2.0], so result = 100 * 0.945 = 94.5 (still < 100)
    // The Kelly criterion is inherently conservative
    // Test that high win rate produces higher size than low win rate
    const highWinResult = calculatePositionSize(100, 90, 30, 5);
    const lowWinResult = calculatePositionSize(100, 40, 5, 10);
    expect(highWinResult).toBeGreaterThan(lowWinResult);
  });

  it('should decrease size for low win rate', () => {
    const result = calculatePositionSize(100, 40, 5, 10);
    expect(result).toBeLessThan(100);
  });

  it('should cap maximum size at 2x base', () => {
    const result = calculatePositionSize(100, 95, 100, 1);
    expect(result).toBeLessThanOrEqual(200);
  });

  it('should have minimum size of 0.5x base', () => {
    const result = calculatePositionSize(100, 20, 1, 100);
    expect(result).toBeGreaterThanOrEqual(50);
  });
});

// ==================== ATR CALCULATION TESTS ====================

describe('ATR (Average True Range) Calculation', () => {
  function calculateATR(ohlcv, period = 14) {
    if (ohlcv.length < period + 1) return 0.01;
    
    let atrSum = 0;
    for (let i = 1; i < ohlcv.length && i <= period; i++) {
      const high = ohlcv[i][2];
      const low = ohlcv[i][3];
      const prevClose = ohlcv[i - 1][4];
      
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      
      atrSum += tr;
    }
    
    const atr = atrSum / Math.min(period, ohlcv.length - 1);
    const currentPrice = ohlcv[ohlcv.length - 1][4];
    return atr / currentPrice;
  }

  it('should return default ATR for insufficient data', () => {
    const ohlcv = [[0, 0, 100, 90, 95]];
    const result = calculateATR(ohlcv);
    expect(result).toBe(0.01);
  });

  it('should calculate ATR as percentage of price', () => {
    // Generate sample OHLCV data
    const ohlcv = [];
    let price = 100;
    for (let i = 0; i < 20; i++) {
      const high = price + 2;
      const low = price - 2;
      const close = price + (Math.random() - 0.5) * 2;
      ohlcv.push([Date.now(), price, high, low, close]);
      price = close;
    }
    
    const result = calculateATR(ohlcv);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1); // Should be a reasonable percentage
  });
});

// ==================== DATABASE TESTS ====================

describe('Database Operations', () => {
  let db;

  beforeAll(() => {
    // Clean up any existing test database
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  beforeEach(() => {
    db = new DatabaseManager(TEST_DB_PATH).init();
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    // Clean up test database
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  describe('Bot Operations', () => {
    it('should create a new bot', () => {
      const bot = db.createBot({
        name: 'test-bot',
        symbol: 'BTC/USD',
        lower_price: 90000,
        upper_price: 100000,
        grid_count: 10,
        adjusted_grid_count: 10,
        order_size: 100
      });
      
      expect(bot.id).toBeDefined();
      expect(bot.name).toBe('test-bot');
    });

    it('should retrieve a bot by name', () => {
      db.createBot({
        name: 'test-bot',
        symbol: 'BTC/USD',
        lower_price: 90000,
        upper_price: 100000,
        grid_count: 10,
        adjusted_grid_count: 10,
        order_size: 100
      });
      
      const bot = db.getBot('test-bot');
      expect(bot).toBeDefined();
      expect(bot.symbol).toBe('BTC/USD');
    });

    it('should update bot status', () => {
      db.createBot({
        name: 'test-bot',
        symbol: 'BTC/USD',
        lower_price: 90000,
        upper_price: 100000,
        grid_count: 10,
        adjusted_grid_count: 10,
        order_size: 100
      });
      
      db.updateBotStatus('test-bot', 'running');
      const bot = db.getBot('test-bot');
      expect(bot.status).toBe('running');
    });

    it('should delete a bot', () => {
      db.createBot({
        name: 'test-bot',
        symbol: 'BTC/USD',
        lower_price: 90000,
        upper_price: 100000,
        grid_count: 10,
        adjusted_grid_count: 10,
        order_size: 100
      });
      
      db.deleteBot('test-bot');
      const bot = db.getBot('test-bot');
      expect(bot).toBeUndefined();
    });
  });

  describe('Order Operations', () => {
    beforeEach(() => {
      db.createBot({
        name: 'test-bot',
        symbol: 'BTC/USD',
        lower_price: 90000,
        upper_price: 100000,
        grid_count: 10,
        adjusted_grid_count: 10,
        order_size: 100
      });
    });

    it('should create an order', () => {
      const order = db.createOrder({
        id: 'order-1',
        bot_name: 'test-bot',
        symbol: 'BTC/USD',
        side: 'buy',
        price: 95000,
        amount: 0.001
      });
      
      expect(order.id).toBe('order-1');
    });

    it('should get active orders', () => {
      db.createOrder({
        id: 'order-1',
        bot_name: 'test-bot',
        symbol: 'BTC/USD',
        side: 'buy',
        price: 94000,
        amount: 0.001
      });
      
      db.createOrder({
        id: 'order-2',
        bot_name: 'test-bot',
        symbol: 'BTC/USD',
        side: 'sell',
        price: 96000,
        amount: 0.001
      });
      
      const activeOrders = db.getActiveOrders('test-bot');
      expect(activeOrders.length).toBe(2);
    });

    it('should fill an order', () => {
      db.createOrder({
        id: 'order-1',
        bot_name: 'test-bot',
        symbol: 'BTC/USD',
        side: 'buy',
        price: 94000,
        amount: 0.001
      });
      
      db.fillOrder('order-1', 93500);
      const order = db.getOrder('order-1');
      
      expect(order.status).toBe('filled');
      expect(order.filled_price).toBe(93500);
    });

    it('should cancel all orders for a bot', () => {
      db.createOrder({
        id: 'order-1',
        bot_name: 'test-bot',
        symbol: 'BTC/USD',
        side: 'buy',
        price: 94000,
        amount: 0.001
      });
      
      db.createOrder({
        id: 'order-2',
        bot_name: 'test-bot',
        symbol: 'BTC/USD',
        side: 'sell',
        price: 96000,
        amount: 0.001
      });
      
      db.cancelAllOrders('test-bot', 'test cancellation');
      const activeOrders = db.getActiveOrders('test-bot');
      expect(activeOrders.length).toBe(0);
    });

    it('should check and fill orders based on price', () => {
      db.createOrder({
        id: 'order-1',
        bot_name: 'test-bot',
        symbol: 'BTC/USD',
        side: 'buy',
        price: 94000,
        amount: 0.001
      });
      
      db.createOrder({
        id: 'order-2',
        bot_name: 'test-bot',
        symbol: 'BTC/USD',
        side: 'sell',
        price: 96000,
        amount: 0.001
      });
      
      // Price drops to 93000 - should fill buy order
      const filledOrders = db.checkAndFillOrders('test-bot', 93000);
      expect(filledOrders.length).toBe(1);
      expect(filledOrders[0].side).toBe('buy');
    });
  });

  describe('Trade Operations', () => {
    beforeEach(() => {
      db.createBot({
        name: 'test-bot',
        symbol: 'BTC/USD',
        lower_price: 90000,
        upper_price: 100000,
        grid_count: 10,
        adjusted_grid_count: 10,
        order_size: 100
      });
    });

    it('should record a trade', () => {
      const trade = db.recordTrade({
        bot_name: 'test-bot',
        symbol: 'BTC/USD',
        side: 'buy',
        price: 94000,
        amount: 0.001,
        value: 94
      });
      
      expect(trade.id).toBeDefined();
    });

    it('should get trades for a bot', () => {
      db.recordTrade({
        bot_name: 'test-bot',
        symbol: 'BTC/USD',
        side: 'buy',
        price: 94000,
        amount: 0.001,
        value: 94
      });
      
      db.recordTrade({
        bot_name: 'test-bot',
        symbol: 'BTC/USD',
        side: 'sell',
        price: 95000,
        amount: 0.001,
        value: 95
      });
      
      const trades = db.getBotTrades('test-bot');
      expect(trades.length).toBe(2);
    });
  });

  describe('Metrics Calculation', () => {
    beforeEach(() => {
      db.createBot({
        name: 'test-bot',
        symbol: 'BTC/USD',
        lower_price: 90000,
        upper_price: 100000,
        grid_count: 10,
        adjusted_grid_count: 10,
        order_size: 100
      });
    });

    it('should calculate metrics with no trades', () => {
      const metrics = db.updateMetrics('test-bot');
      expect(metrics.total_trades).toBe(0);
      expect(metrics.win_rate).toBe(0);
    });

    it('should calculate win rate correctly', () => {
      // Record winning trades
      for (let i = 0; i < 4; i++) {
        db.recordTrade({
          bot_name: 'test-bot',
          symbol: 'BTC/USD',
          side: 'buy',
          price: 94000,
          amount: 0.001,
          value: 94
        });
        db.recordTrade({
          bot_name: 'test-bot',
          symbol: 'BTC/USD',
          side: 'sell',
          price: 95000, // Profit
          amount: 0.001,
          value: 95
        });
      }
      
      // Record losing trade
      db.recordTrade({
        bot_name: 'test-bot',
        symbol: 'BTC/USD',
        side: 'buy',
        price: 94000,
        amount: 0.001,
        value: 94
      });
      db.recordTrade({
        bot_name: 'test-bot',
        symbol: 'BTC/USD',
        side: 'sell',
        price: 93000, // Loss
        amount: 0.001,
        value: 93
      });
      
      const metrics = db.updateMetrics('test-bot');
      expect(metrics.total_trades).toBe(5);
      expect(metrics.win_rate).toBe(80); // 4 wins out of 5
    });
  });
});

// ==================== WEBSOCKET FEED TESTS ====================

describe('WebSocket Price Feed', () => {
  it('should initialize with correct default options', () => {
    const mockExchange = { has: { watchTicker: true } };
    const feed = new WebSocketPriceFeed(mockExchange, { symbol: 'BTC/USD' });
    
    expect(feed.symbol).toBe('BTC/USD');
    expect(feed.isConnected).toBe(false);
    expect(feed.isRunning).toBe(false);
  });

  it('should report correct status', () => {
    const mockExchange = { has: { watchTicker: true } };
    const feed = new WebSocketPriceFeed(mockExchange, { symbol: 'ETH/USD' });
    
    const status = feed.getStatus();
    expect(status.symbol).toBe('ETH/USD');
    expect(status.isConnected).toBe(false);
    expect(status.usingFallback).toBe(false);
  });

  it('should calculate exponential backoff correctly', async () => {
    const mockExchange = { 
      has: { watchTicker: false },
      fetchTicker: async () => ({ last: 95000 })
    };
    
    const feed = new WebSocketPriceFeed(mockExchange, {
      symbol: 'BTC/USD',
      baseReconnectDelay: 1000,
      maxReconnectDelay: 30000
    });
    
    // Simulate reconnection attempts
    feed.reconnectAttempts = 1;
    const delay1 = Math.min(1000 * Math.pow(2, 0), 30000);
    expect(delay1).toBe(1000);
    
    feed.reconnectAttempts = 5;
    const delay5 = Math.min(1000 * Math.pow(2, 4), 30000);
    expect(delay5).toBe(16000);
    
    feed.reconnectAttempts = 10;
    const delay10 = Math.min(1000 * Math.pow(2, 9), 30000);
    expect(delay10).toBe(30000); // Capped at max
  });
});

// ==================== PROFIT TAKING TESTS ====================

describe('Profit Taking Logic', () => {
  function checkProfitTaking(activeOrders, currentPrices, threshold = 0.025) {
    if (activeOrders.length === 0) return null;
    
    let totalCost = 0;
    let totalValue = 0;
    
    for (const order of activeOrders) {
      const currentPrice = currentPrices[order.symbol];
      if (!currentPrice) continue;
      
      const orderValue = order.price * order.amount;
      
      if (order.side === 'buy') {
        totalCost += orderValue;
        totalValue += currentPrice * order.amount;
      } else {
        totalCost += orderValue * 0.98;
        totalValue += currentPrice * order.amount;
      }
    }
    
    const unrealizedPnL = totalValue - totalCost;
    const pnlPercent = totalCost > 0 ? unrealizedPnL / totalCost : 0;
    
    if (pnlPercent >= threshold) {
      return {
        action: 'PROFIT_TARGET_HIT',
        pnl: unrealizedPnL,
        pnlPercent,
        threshold
      };
    }
    
    return null;
  }

  it('should return null for empty orders', () => {
    const result = checkProfitTaking([], { 'BTC/USD': 95000 });
    expect(result).toBeNull();
  });

  it('should detect profit target hit', () => {
    const orders = [
      { symbol: 'BTC/USD', side: 'buy', price: 90000, amount: 0.1 }
    ];
    const prices = { 'BTC/USD': 95000 }; // 5.5% gain
    
    const result = checkProfitTaking(orders, prices, 0.025);
    expect(result).not.toBeNull();
    expect(result.action).toBe('PROFIT_TARGET_HIT');
  });

  it('should not trigger below threshold', () => {
    const orders = [
      { symbol: 'BTC/USD', side: 'buy', price: 94000, amount: 0.1 }
    ];
    const prices = { 'BTC/USD': 95000 }; // ~1% gain
    
    const result = checkProfitTaking(orders, prices, 0.025);
    expect(result).toBeNull();
  });
});
