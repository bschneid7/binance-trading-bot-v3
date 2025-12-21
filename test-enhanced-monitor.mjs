#!/usr/bin/env node

/**
 * Test Suite for Enhanced Monitor
 * Tests the three new enhancements without requiring live API access
 */

import { DatabaseManager } from './database.mjs';
import { BinanceWebSocket } from './binance-websocket.mjs';

// Test colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`${colors.green}✓${colors.reset} ${name}`);
    passed++;
  } catch (error) {
    console.log(`${colors.red}✗${colors.reset} ${name}`);
    console.log(`  ${colors.red}Error: ${error.message}${colors.reset}`);
    failed++;
  }
}

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message} Expected ${expected}, got ${actual}`);
  }
}

function assertTrue(condition, message = '') {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`  ENHANCED MONITOR TEST SUITE`);
console.log(`${'═'.repeat(60)}\n`);

// ==================== DATABASE TESTS ====================
console.log(`${colors.cyan}Database Operations${colors.reset}`);

const testDbPath = '/tmp/test-enhanced-monitor.db';
const db = new DatabaseManager(testDbPath).init();

test('Create bot', () => {
  const bot = db.createBot({
    name: 'test-enhanced-bot',
    symbol: 'BTC/USD',
    lower_price: 80000,
    upper_price: 100000,
    grid_count: 10,
    adjusted_grid_count: 10,
    order_size: 0.001,
    status: 'running',
  });
  assertTrue(bot.id > 0, 'Bot should have an ID');
});

test('Get bot', () => {
  const bot = db.getBot('test-enhanced-bot');
  assertEqual(bot.symbol, 'BTC/USD');
  assertEqual(bot.lower_price, 80000);
  assertEqual(bot.upper_price, 100000);
});

test('Create orders', () => {
  const orders = [
    { id: 'test-order-1', bot_name: 'test-enhanced-bot', symbol: 'BTC/USD', side: 'buy', price: 85000, amount: 0.001 },
    { id: 'test-order-2', bot_name: 'test-enhanced-bot', symbol: 'BTC/USD', side: 'buy', price: 87000, amount: 0.001 },
    { id: 'test-order-3', bot_name: 'test-enhanced-bot', symbol: 'BTC/USD', side: 'sell', price: 93000, amount: 0.001 },
    { id: 'test-order-4', bot_name: 'test-enhanced-bot', symbol: 'BTC/USD', side: 'sell', price: 95000, amount: 0.001 },
  ];
  db.createOrders(orders);
  
  const activeOrders = db.getActiveOrders('test-enhanced-bot');
  assertEqual(activeOrders.length, 4, 'Should have 4 active orders');
});

test('Fill order', () => {
  db.fillOrder('test-order-1', 85000);
  const order = db.getOrder('test-order-1');
  assertEqual(order.status, 'filled');
});

test('Cancel order', () => {
  db.cancelOrder('test-order-2', 'test_cancel');
  const order = db.getOrder('test-order-2');
  assertEqual(order.status, 'cancelled');
});

test('Get active orders after fill/cancel', () => {
  const activeOrders = db.getActiveOrders('test-enhanced-bot');
  assertEqual(activeOrders.length, 2, 'Should have 2 active orders remaining');
});

test('Record trade', () => {
  db.recordTrade({
    bot_name: 'test-enhanced-bot',
    symbol: 'BTC/USD',
    side: 'buy',
    price: 85000,
    amount: 0.001,
    value: 85,
    fee: 0.085,
    order_id: 'test-order-1',
    type: 'fill',
  });
  
  const trades = db.getBotTrades('test-enhanced-bot');
  assertTrue(trades.length > 0, 'Should have at least one trade');
});

test('Update bot configuration', () => {
  db.updateBot('test-enhanced-bot', {
    lower_price: 75000,
    upper_price: 95000,
    rebalance_count: 1,
  });
  
  const bot = db.getBot('test-enhanced-bot');
  assertEqual(bot.lower_price, 75000);
  assertEqual(bot.upper_price, 95000);
  assertEqual(bot.rebalance_count, 1);
});

// ==================== GRID REBALANCE LOGIC TESTS ====================
console.log(`\n${colors.cyan}Grid Rebalance Logic${colors.reset}`);

test('Detect price above grid', () => {
  const bot = { lower_price: 80000, upper_price: 100000 };
  const currentPrice = 105000;
  const gridRange = bot.upper_price - bot.lower_price;
  
  const outsideGrid = currentPrice > bot.upper_price;
  const deviation = (currentPrice - bot.upper_price) / gridRange;
  
  assertTrue(outsideGrid, 'Should detect price above grid');
  assertTrue(deviation > 0.1, 'Deviation should exceed threshold');
});

test('Detect price below grid', () => {
  const bot = { lower_price: 80000, upper_price: 100000 };
  const currentPrice = 75000;
  const gridRange = bot.upper_price - bot.lower_price;
  
  const outsideGrid = currentPrice < bot.lower_price;
  const deviation = (bot.lower_price - currentPrice) / gridRange;
  
  assertTrue(outsideGrid, 'Should detect price below grid');
  assertTrue(deviation > 0.1, 'Deviation should exceed threshold');
});

test('Calculate new grid range (price above)', () => {
  const currentPrice = 105000;
  const gridRange = 20000;
  
  const newLower = currentPrice - (gridRange * 0.4);
  const newUpper = currentPrice + (gridRange * 0.6);
  
  assertTrue(newLower < currentPrice, 'New lower should be below current price');
  assertTrue(newUpper > currentPrice, 'New upper should be above current price');
  assertEqual(newUpper - newLower, gridRange, 'Grid range should be preserved');
});

test('Calculate new grid range (price below)', () => {
  const currentPrice = 75000;
  const gridRange = 20000;
  
  const newLower = currentPrice - (gridRange * 0.6);
  const newUpper = currentPrice + (gridRange * 0.4);
  
  assertTrue(newLower < currentPrice, 'New lower should be below current price');
  assertTrue(newUpper > currentPrice, 'New upper should be above current price');
  assertEqual(newUpper - newLower, gridRange, 'Grid range should be preserved');
});

// ==================== ORDER SYNC LOGIC TESTS ====================
console.log(`\n${colors.cyan}Order Sync Logic${colors.reset}`);

test('Detect orphaned orders', () => {
  const dbOrders = [
    { id: 'order-1', status: 'open' },
    { id: 'order-2', status: 'open' },
    { id: 'order-3', status: 'open' },
  ];
  const exchangeOrders = [
    { id: 'order-1' },
    { id: 'order-3' },
  ];
  
  const exchangeIds = new Set(exchangeOrders.map(o => o.id));
  const orphaned = dbOrders.filter(o => !exchangeIds.has(o.id));
  
  assertEqual(orphaned.length, 1, 'Should detect 1 orphaned order');
  assertEqual(orphaned[0].id, 'order-2', 'Orphaned order should be order-2');
});

test('Detect missing orders', () => {
  const dbOrders = [
    { id: 'order-1', status: 'open' },
  ];
  const exchangeOrders = [
    { id: 'order-1' },
    { id: 'order-4' },
    { id: 'order-5' },
  ];
  
  const dbIds = new Set(dbOrders.map(o => o.id));
  const missing = exchangeOrders.filter(o => !dbIds.has(o.id));
  
  assertEqual(missing.length, 2, 'Should detect 2 missing orders');
});

// ==================== WEBSOCKET MODULE TESTS ====================
console.log(`\n${colors.cyan}WebSocket Module${colors.reset}`);

test('BinanceWebSocket class exists', () => {
  assertTrue(typeof BinanceWebSocket === 'function', 'BinanceWebSocket should be a class');
});

test('BinanceWebSocket instance creation', () => {
  const ws = new BinanceWebSocket('test-key', 'test-secret');
  assertTrue(ws !== null, 'Should create instance');
  assertEqual(ws.apiKey, 'test-key');
  assertEqual(ws.apiSecret, 'test-secret');
});

test('BinanceWebSocket sign method', () => {
  const ws = new BinanceWebSocket('test-key', 'test-secret');
  const signature = ws.sign('timestamp=1234567890');
  assertTrue(signature.length === 64, 'Signature should be 64 hex characters');
});

test('BinanceWebSocket format symbol', () => {
  const ws = new BinanceWebSocket('test-key', 'test-secret');
  assertEqual(ws.formatSymbol('BTCUSD'), 'BTC/USD');
  assertEqual(ws.formatSymbol('ETHUSD'), 'ETH/USD');
  assertEqual(ws.formatSymbol('SOLUSD'), 'SOL/USD');
});

test('BinanceWebSocket order status mapping', () => {
  const ws = new BinanceWebSocket('test-key', 'test-secret');
  assertEqual(ws.mapOrderStatus('NEW'), 'open');
  assertEqual(ws.mapOrderStatus('FILLED'), 'closed');
  assertEqual(ws.mapOrderStatus('CANCELED'), 'canceled');
  assertEqual(ws.mapOrderStatus('PARTIALLY_FILLED'), 'open');
});

// ==================== GRID CALCULATION TESTS ====================
console.log(`\n${colors.cyan}Grid Calculations${colors.reset}`);

test('Calculate grid levels', () => {
  const lower = 80000;
  const upper = 100000;
  const gridCount = 10;
  const currentPrice = 90000;
  
  const levels = [];
  const step = (upper - lower) / gridCount;
  
  for (let i = 0; i <= gridCount; i++) {
    const price = lower + (step * i);
    const side = price < currentPrice ? 'buy' : 'sell';
    
    if (Math.abs(price - currentPrice) < step * 0.3) continue;
    
    levels.push({ price, side });
  }
  
  assertTrue(levels.length > 0, 'Should generate grid levels');
  assertTrue(levels.filter(l => l.side === 'buy').length > 0, 'Should have buy orders');
  assertTrue(levels.filter(l => l.side === 'sell').length > 0, 'Should have sell orders');
});

test('Grid spacing calculation', () => {
  const lower = 80000;
  const upper = 100000;
  const gridCount = 10;
  
  const spacing = (upper - lower) / gridCount;
  assertEqual(spacing, 2000, 'Grid spacing should be $2000');
});

test('Replacement order price calculation', () => {
  const filledPrice = 85000;
  const gridSpacing = 2000;
  
  const sellReplacementPrice = filledPrice + gridSpacing;
  const buyReplacementPrice = filledPrice - gridSpacing;
  
  assertEqual(sellReplacementPrice, 87000, 'Sell replacement should be at $87,000');
  assertEqual(buyReplacementPrice, 83000, 'Buy replacement should be at $83,000');
});

// ==================== CLEANUP ====================
console.log(`\n${colors.cyan}Cleanup${colors.reset}`);

test('Delete test bot', () => {
  db.deleteBot('test-enhanced-bot');
  const bot = db.getBot('test-enhanced-bot');
  assertTrue(bot === undefined, 'Bot should be deleted');
});

test('Close database', () => {
  db.close();
  assertTrue(true, 'Database closed');
});

// ==================== RESULTS ====================
console.log(`\n${'═'.repeat(60)}`);
console.log(`  TEST RESULTS`);
console.log(`${'═'.repeat(60)}`);
console.log(`  ${colors.green}Passed: ${passed}${colors.reset}`);
console.log(`  ${colors.red}Failed: ${failed}${colors.reset}`);
console.log(`  Total: ${passed + failed}`);
console.log(`${'═'.repeat(60)}\n`);

if (failed > 0) {
  process.exit(1);
}
