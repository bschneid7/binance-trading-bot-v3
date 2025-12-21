#!/usr/bin/env node

/**
 * Test Suite for Volatility Grid and Trend Filter Modules
 */

import { VolatilityGridManager, calculateVolatilityAdjustedLevels } from './volatility-grid.mjs';
import { TrendFilter, TREND, TREND_NAMES, quickTrendCheck } from './trend-filter.mjs';

// Test utilities
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${error.message}`);
    failed++;
  }
}

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message} Expected ${expected}, got ${actual}`);
  }
}

function assertInRange(value, min, max, message = '') {
  if (value < min || value > max) {
    throw new Error(`${message} Expected ${value} to be between ${min} and ${max}`);
  }
}

function assertExists(value, message = '') {
  if (value === null || value === undefined) {
    throw new Error(`${message} Expected value to exist`);
  }
}

console.log('═'.repeat(60));
console.log('  MARKET ANALYSIS MODULES TEST SUITE');
console.log('═'.repeat(60));

// ============================================
// Volatility Grid Manager Tests
// ============================================
console.log('\nVolatility Grid Manager');
console.log('-'.repeat(40));

test('VolatilityGridManager class exists', () => {
  assertExists(VolatilityGridManager);
});

test('Create VolatilityGridManager instance', () => {
  const manager = new VolatilityGridManager();
  assertExists(manager);
  assertEqual(manager.options.atrPeriod, 14);
});

test('Create VolatilityGridManager with custom options', () => {
  const manager = new VolatilityGridManager({
    atrPeriod: 20,
    atrTimeframe: '4h',
  });
  assertEqual(manager.options.atrPeriod, 20);
  assertEqual(manager.options.atrTimeframe, '4h');
});

test('Calculate ATR from OHLCV data', () => {
  const manager = new VolatilityGridManager();
  
  // Mock OHLCV data: [timestamp, open, high, low, close, volume]
  const ohlcv = [
    [1, 100, 105, 98, 102, 1000],
    [2, 102, 108, 100, 106, 1200],
    [3, 106, 110, 104, 108, 1100],
    [4, 108, 112, 105, 110, 1300],
    [5, 110, 115, 108, 112, 1400],
  ];
  
  const atr = manager.calculateATR(ohlcv);
  assertExists(atr);
  assertInRange(atr, 5, 10, 'ATR should be reasonable');
});

test('ATR percentage calculation', () => {
  const manager = new VolatilityGridManager();
  const atrPercent = manager.atrPercentage(100, 10000);
  assertEqual(atrPercent, 0.01);
});

test('Get volatility regime - Very Low', () => {
  const manager = new VolatilityGridManager();
  const regime = manager.getVolatilityRegime(0.003);
  assertEqual(regime.name, 'Very Low');
  assertEqual(regime.multiplier, 0.6);
});

test('Get volatility regime - Normal', () => {
  const manager = new VolatilityGridManager();
  const regime = manager.getVolatilityRegime(0.015);
  assertEqual(regime.name, 'Normal');
  assertEqual(regime.multiplier, 1.0);
});

test('Get volatility regime - Very High', () => {
  const manager = new VolatilityGridManager();
  const regime = manager.getVolatilityRegime(0.05);
  assertEqual(regime.name, 'Very High');
  assertEqual(regime.multiplier, 1.6);
});

test('Asset adjustment for BTC', () => {
  const manager = new VolatilityGridManager();
  const adjustment = manager.getAssetAdjustment('BTC/USD');
  assertEqual(adjustment, 1.0);
});

test('Asset adjustment for SOL (more volatile)', () => {
  const manager = new VolatilityGridManager();
  const adjustment = manager.getAssetAdjustment('SOL/USD');
  assertEqual(adjustment, 1.3);
});

test('Standalone volatility adjusted levels function', () => {
  const result = calculateVolatilityAdjustedLevels(
    100000,  // current price
    0.10,    // 10% base grid
    20,      // 20 grid levels
    0.015,   // 1.5% ATR (normal volatility)
    'BTC/USD'
  );
  
  assertExists(result.lower);
  assertExists(result.upper);
  assertExists(result.count);
  assertExists(result.multiplier);
  assertEqual(result.multiplier, 1.0);
});

test('Volatility adjusted levels - high volatility', () => {
  const result = calculateVolatilityAdjustedLevels(
    100000,
    0.10,
    20,
    0.04,  // 4% ATR (very high volatility)
    'BTC/USD'
  );
  
  assertEqual(result.multiplier, 1.6);
  // With higher multiplier, should have fewer grid levels
  assertInRange(result.count, 10, 15, 'Grid count should be reduced');
});

test('Needs recalculation check', () => {
  const manager = new VolatilityGridManager();
  
  // Should need recalculation initially
  assertEqual(manager.needsRecalculation('BTC/USD'), true);
  
  // Simulate a calculation
  manager.lastCalculation.set('BTC/USD', {
    timestamp: Date.now(),
    multiplier: 1.0,
  });
  
  // Should not need recalculation immediately
  assertEqual(manager.needsRecalculation('BTC/USD', 60000), false);
});

// ============================================
// Trend Filter Tests
// ============================================
console.log('\nTrend Filter');
console.log('-'.repeat(40));

test('TrendFilter class exists', () => {
  assertExists(TrendFilter);
});

test('TREND constants exist', () => {
  assertEqual(TREND.STRONG_BULLISH, 2);
  assertEqual(TREND.BULLISH, 1);
  assertEqual(TREND.NEUTRAL, 0);
  assertEqual(TREND.BEARISH, -1);
  assertEqual(TREND.STRONG_BEARISH, -2);
});

test('TREND_NAMES mapping', () => {
  assertExists(TREND_NAMES[TREND.BULLISH]);
  assertEqual(TREND_NAMES[TREND.NEUTRAL], 'Neutral ⚪');
});

test('Create TrendFilter instance', () => {
  const filter = new TrendFilter();
  assertExists(filter);
  assertEqual(filter.config.timeframes.length, 2);
});

test('Create TrendFilter with custom config', () => {
  const filter = new TrendFilter({
    timeframes: ['1h', '4h', '1d'],
    filterMode: 'hard',
  });
  assertEqual(filter.config.timeframes.length, 3);
  assertEqual(filter.config.filterMode, 'hard');
});

test('Analyze timeframe with insufficient data', () => {
  const filter = new TrendFilter();
  const result = filter.analyzeTimeframe([]);
  assertEqual(result.trend, TREND.NEUTRAL);
  assertEqual(result.confidence, 0);
});

test('Analyze timeframe with bullish data', () => {
  const filter = new TrendFilter();
  
  // Create mock OHLCV data with uptrend
  const ohlcv = [];
  let price = 100;
  for (let i = 0; i < 60; i++) {
    price += 0.5 + Math.random() * 0.5;  // Steady uptrend
    ohlcv.push([
      Date.now() + i * 3600000,
      price - 1,
      price + 2,
      price - 2,
      price,
      1000
    ]);
  }
  
  const result = filter.analyzeTimeframe(ohlcv);
  assertInRange(result.trend, TREND.NEUTRAL, TREND.STRONG_BULLISH, 'Should detect bullish trend');
});

test('Analyze timeframe with bearish data', () => {
  const filter = new TrendFilter();
  
  // Create mock OHLCV data with downtrend
  const ohlcv = [];
  let price = 200;
  for (let i = 0; i < 60; i++) {
    price -= 0.5 + Math.random() * 0.5;  // Steady downtrend
    ohlcv.push([
      Date.now() + i * 3600000,
      price + 1,
      price + 2,
      price - 2,
      price,
      1000
    ]);
  }
  
  const result = filter.analyzeTimeframe(ohlcv);
  assertInRange(result.trend, TREND.STRONG_BEARISH, TREND.NEUTRAL, 'Should detect bearish trend');
});

test('Get recommendation for bullish trend', () => {
  const filter = new TrendFilter();
  const rec = filter.getRecommendation(TREND.BULLISH, 0.7);
  
  assertEqual(rec.allowBuys, true);
  assertEqual(rec.allowSells, true);
  assertInRange(rec.buyBias, 0, 0.5, 'Should have positive buy bias');
});

test('Get recommendation for strong bearish trend', () => {
  const filter = new TrendFilter();
  const rec = filter.getRecommendation(TREND.STRONG_BEARISH, 0.8);
  
  assertEqual(rec.allowBuys, true);  // Soft mode allows buys
  assertInRange(rec.buyBias, -0.5, 0, 'Should have negative buy bias');
  assertInRange(rec.sellBias, 0, 0.5, 'Should have positive sell bias');
});

test('Get recommendation for strong bearish in hard mode', () => {
  const filter = new TrendFilter({ filterMode: 'hard' });
  const rec = filter.getRecommendation(TREND.STRONG_BEARISH, 0.8);
  
  assertEqual(rec.allowBuys, false);  // Hard mode blocks buys
});

test('Cache functionality', () => {
  const filter = new TrendFilter();
  
  // Initially no cache
  assertEqual(filter.getCachedTrend('BTC/USD'), null);
  
  // Simulate caching
  filter.cache.set('BTC/USD', {
    trend: TREND.BULLISH,
    timestamp: Date.now(),
  });
  
  // Should return cached value
  assertExists(filter.getCachedTrend('BTC/USD'));
});

test('Clear cache', () => {
  const filter = new TrendFilter();
  
  filter.cache.set('BTC/USD', { trend: TREND.BULLISH, timestamp: Date.now() });
  filter.cache.set('ETH/USD', { trend: TREND.BEARISH, timestamp: Date.now() });
  
  // Clear specific symbol
  filter.clearCache('BTC/USD');
  assertEqual(filter.cache.has('BTC/USD'), false);
  assertEqual(filter.cache.has('ETH/USD'), true);
  
  // Clear all
  filter.clearCache();
  assertEqual(filter.cache.size, 0);
});

test('Get summary', () => {
  const filter = new TrendFilter();
  
  filter.cache.set('BTC/USD', {
    trendName: 'Bullish 🟢',
    confidence: 0.75,
    aligned: true,
    recommendation: { message: 'Uptrend detected' },
    timestamp: Date.now(),
  });
  
  const summary = filter.getSummary();
  assertExists(summary['BTC/USD']);
  assertEqual(summary['BTC/USD'].trend, 'Bullish 🟢');
});

test('Adjust quantity based on trend', () => {
  const filter = new TrendFilter();
  
  const analysis = {
    recommendation: {
      buyBias: 0.3,
      sellBias: -0.2,
    }
  };
  
  const buyQty = filter.adjustQuantity(100, 'buy', analysis);
  const sellQty = filter.adjustQuantity(100, 'sell', analysis);
  
  assertInRange(buyQty, 105, 115, 'Buy quantity should be increased');
  assertInRange(sellQty, 90, 98, 'Sell quantity should be decreased');
});

// ============================================
// Integration Tests
// ============================================
console.log('\nIntegration Tests');
console.log('-'.repeat(40));

test('Volatility and Trend work together', () => {
  const volatilityManager = new VolatilityGridManager();
  const trendFilter = new TrendFilter();
  
  // Both should be instantiable together
  assertExists(volatilityManager);
  assertExists(trendFilter);
  
  // Get volatility regime
  const regime = volatilityManager.getVolatilityRegime(0.02);
  
  // Get trend recommendation
  const rec = trendFilter.getRecommendation(TREND.BULLISH, 0.7);
  
  // Both should provide valid outputs
  assertExists(regime.multiplier);
  assertExists(rec.buyBias);
});

// ============================================
// Summary
// ============================================
console.log('\n' + '═'.repeat(60));
console.log('  TEST RESULTS');
console.log('═'.repeat(60));
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total: ${passed + failed}`);
console.log('═'.repeat(60));

if (failed > 0) {
  process.exit(1);
}
