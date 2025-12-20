#!/usr/bin/env node

/**
 * Dynamic Grid Rebalancer
 * 
 * Automatically adjusts grid parameters based on market conditions:
 * - Expands/contracts grid range based on volatility
 * - Adjusts grid density based on trading volume
 * - Recenters grid when price moves outside optimal zone
 * - Implements smart order placement to minimize fees
 */

import dotenv from 'dotenv';
import ccxt from 'ccxt';
import { getDatabase } from './database.mjs';

dotenv.config({ path: '.env.production' });

const db = getDatabase();

// Rebalancing configuration
const REBALANCE_CONFIG = {
  // Price zone thresholds (percentage from center)
  OPTIMAL_ZONE: 0.30,           // Price within 30% of center is optimal
  WARNING_ZONE: 0.50,           // Price within 50% triggers warning
  CRITICAL_ZONE: 0.70,          // Price within 70% triggers rebalance
  
  // Volatility adjustments
  LOW_VOLATILITY_EXPANSION: 0.8,    // Contract grid by 20% in low volatility
  HIGH_VOLATILITY_EXPANSION: 1.5,   // Expand grid by 50% in high volatility
  
  // Grid density adjustments
  MIN_GRID_COUNT: 5,
  MAX_GRID_COUNT: 100,
  OPTIMAL_GRID_SPACING_PERCENT: 0.02,  // 2% spacing between orders
  
  // Timing
  MIN_REBALANCE_INTERVAL: 3600000,  // Minimum 1 hour between rebalances
  ATR_PERIOD: 14,
  
  // Cost thresholds
  MAX_REBALANCE_COST_PERCENT: 0.005,  // Max 0.5% of capital for rebalance fees
};

/**
 * Calculate Average True Range for volatility measurement
 */
async function calculateATR(exchange, symbol, period = 14) {
  try {
    const ohlcv = await exchange.fetchOHLCV(symbol, '1h', undefined, period + 1);
    
    if (ohlcv.length < period + 1) {
      return null;
    }
    
    let trSum = 0;
    for (let i = 1; i < ohlcv.length; i++) {
      const high = ohlcv[i][2];
      const low = ohlcv[i][3];
      const prevClose = ohlcv[i - 1][4];
      
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trSum += tr;
    }
    
    return trSum / period;
  } catch (error) {
    console.error('Error calculating ATR:', error.message);
    return null;
  }
}

/**
 * Analyze current grid position relative to price
 */
function analyzeGridPosition(bot, currentPrice) {
  const gridCenter = (bot.upper_price + bot.lower_price) / 2;
  const gridRange = bot.upper_price - bot.lower_price;
  const priceOffset = Math.abs(currentPrice - gridCenter);
  const offsetPercent = priceOffset / (gridRange / 2);
  
  let zone = 'OPTIMAL';
  if (offsetPercent > REBALANCE_CONFIG.CRITICAL_ZONE) {
    zone = 'CRITICAL';
  } else if (offsetPercent > REBALANCE_CONFIG.WARNING_ZONE) {
    zone = 'WARNING';
  } else if (offsetPercent > REBALANCE_CONFIG.OPTIMAL_ZONE) {
    zone = 'SUBOPTIMAL';
  }
  
  const direction = currentPrice > gridCenter ? 'ABOVE' : 'BELOW';
  
  return {
    gridCenter,
    gridRange,
    currentPrice,
    priceOffset,
    offsetPercent,
    zone,
    direction,
    distanceToUpper: bot.upper_price - currentPrice,
    distanceToLower: currentPrice - bot.lower_price,
    upperPercent: ((bot.upper_price - currentPrice) / currentPrice * 100).toFixed(2),
    lowerPercent: ((currentPrice - bot.lower_price) / currentPrice * 100).toFixed(2),
  };
}

/**
 * Calculate optimal grid parameters based on current conditions
 */
async function calculateOptimalGrid(exchange, bot, currentPrice, atr) {
  const currentRange = bot.upper_price - bot.lower_price;
  const currentRangePercent = currentRange / currentPrice;
  
  // Calculate volatility-adjusted range
  let volatilityMultiplier = 1.0;
  if (atr) {
    const atrPercent = atr / currentPrice;
    
    if (atrPercent < 0.01) {
      // Low volatility - contract grid
      volatilityMultiplier = REBALANCE_CONFIG.LOW_VOLATILITY_EXPANSION;
    } else if (atrPercent > 0.03) {
      // High volatility - expand grid
      volatilityMultiplier = REBALANCE_CONFIG.HIGH_VOLATILITY_EXPANSION;
    } else {
      // Normal volatility - linear interpolation
      volatilityMultiplier = 0.8 + ((atrPercent - 0.01) / 0.02) * 0.7;
    }
  }
  
  // Calculate new range centered on current price
  const baseRange = currentPrice * 0.20;  // 20% base range
  const adjustedRange = baseRange * volatilityMultiplier;
  
  const newLowerPrice = currentPrice - (adjustedRange / 2);
  const newUpperPrice = currentPrice + (adjustedRange / 2);
  
  // Calculate optimal grid count based on range
  const optimalSpacing = currentPrice * REBALANCE_CONFIG.OPTIMAL_GRID_SPACING_PERCENT;
  let optimalGridCount = Math.round(adjustedRange / optimalSpacing);
  
  // Clamp grid count
  optimalGridCount = Math.max(
    REBALANCE_CONFIG.MIN_GRID_COUNT,
    Math.min(REBALANCE_CONFIG.MAX_GRID_COUNT, optimalGridCount)
  );
  
  return {
    lowerPrice: parseFloat(newLowerPrice.toFixed(2)),
    upperPrice: parseFloat(newUpperPrice.toFixed(2)),
    gridCount: optimalGridCount,
    range: adjustedRange,
    rangePercent: (adjustedRange / currentPrice * 100).toFixed(2),
    volatilityMultiplier,
    spacing: adjustedRange / optimalGridCount,
    spacingPercent: ((adjustedRange / optimalGridCount) / currentPrice * 100).toFixed(3),
  };
}

/**
 * Estimate rebalancing cost
 */
function estimateRebalanceCost(bot, newParams, currentOrders, tradingFee = 0.001) {
  const ordersToCancel = currentOrders.length;
  const ordersToPlace = newParams.gridCount;
  
  // Estimate average order size
  const avgOrderSize = bot.order_size;
  
  // Cost is primarily from placing new orders (maker fees are usually lower)
  const placementCost = ordersToPlace * avgOrderSize * tradingFee;
  
  // Some orders might be filled during rebalance (taker fees)
  const potentialSlippage = avgOrderSize * 0.002 * ordersToPlace * 0.1;  // Assume 10% might slip
  
  return {
    ordersToCancel,
    ordersToPlace,
    estimatedFees: placementCost,
    potentialSlippage,
    totalCost: placementCost + potentialSlippage,
    costPercent: (placementCost + potentialSlippage) / (bot.order_size * bot.adjusted_grid_count) * 100,
  };
}

/**
 * Execute grid rebalance
 */
async function executeRebalance(exchange, bot, newParams, testMode = false) {
  console.log(`\n🔄 Executing rebalance for ${bot.name}...`);
  
  // Step 1: Cancel all existing orders
  console.log('   Cancelling existing orders...');
  const activeOrders = db.getActiveOrders(bot.name);
  
  let cancelledCount = 0;
  for (const order of activeOrders) {
    if (!testMode) {
      try {
        await exchange.cancelOrder(order.id, bot.symbol);
        cancelledCount++;
      } catch (e) {
        if (!e.message.includes('not found')) {
          console.log(`   ⚠️  Could not cancel order ${order.id}: ${e.message}`);
        }
      }
    }
    db.fillOrder(order.id, 'rebalance_cancelled');
  }
  console.log(`   ✅ Cancelled ${cancelledCount} orders`);
  
  // Step 2: Update bot parameters
  console.log('   Updating bot parameters...');
  db.db.prepare(`
    UPDATE bots SET 
      lower_price = ?,
      upper_price = ?,
      adjusted_grid_count = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE name = ?
  `).run(newParams.lowerPrice, newParams.upperPrice, newParams.gridCount, bot.name);
  
  // Step 3: Calculate new grid levels
  const gridLevels = [];
  const spacing = (newParams.upperPrice - newParams.lowerPrice) / newParams.gridCount;
  const ticker = await exchange.fetchTicker(bot.symbol);
  const currentPrice = ticker.last;
  
  for (let i = 0; i <= newParams.gridCount; i++) {
    const price = newParams.lowerPrice + (i * spacing);
    const side = price < currentPrice ? 'buy' : 'sell';
    gridLevels.push({ price: parseFloat(price.toFixed(2)), side });
  }
  
  // Step 4: Place new orders
  console.log(`   Placing ${gridLevels.length} new orders...`);
  let placedCount = 0;
  
  for (const level of gridLevels) {
    if (Math.abs(level.price - currentPrice) < spacing * 0.5) {
      continue;  // Skip orders too close to current price
    }
    
    const orderId = `${bot.name}_rebal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    if (testMode) {
      db.createOrder({
        id: orderId,
        bot_name: bot.name,
        symbol: bot.symbol,
        side: level.side,
        price: level.price,
        amount: bot.order_size,
      });
      placedCount++;
    } else {
      try {
        const order = await exchange.createLimitOrder(
          bot.symbol,
          level.side,
          bot.order_size,
          level.price
        );
        db.createOrder({
          id: order.id,
          bot_name: bot.name,
          symbol: bot.symbol,
          side: level.side,
          price: level.price,
          amount: bot.order_size,
        });
        placedCount++;
      } catch (e) {
        if (!e.message.includes('insufficient')) {
          console.log(`   ⚠️  Could not place ${level.side} at $${level.price}: ${e.message}`);
        }
      }
    }
  }
  
  console.log(`   ✅ Placed ${placedCount} new orders`);
  
  // Record rebalance event
  db.recordTrade({
    bot_name: bot.name,
    symbol: bot.symbol,
    side: 'rebalance',
    price: currentPrice,
    amount: 0,
    value: 0,
    type: 'grid_rebalance',
  });
  
  return {
    cancelled: cancelledCount,
    placed: placedCount,
    newParams,
  };
}

/**
 * Analyze and optionally rebalance a bot
 */
async function analyzeBot(botName, options = {}) {
  const { execute = false, force = false } = options;
  
  const bot = db.getBot(botName);
  if (!bot) {
    console.error(`❌ Bot "${botName}" not found`);
    return null;
  }
  
  // Initialize exchange
  const exchange = new ccxt.binanceus({
    apiKey: process.env.BINANCE_API_KEY,
    secret: process.env.BINANCE_API_SECRET,
    enableRateLimit: true,
  });
  
  const testMode = process.env.TRADING_MODE !== 'live';
  
  try {
    // Get current price
    const ticker = await exchange.fetchTicker(bot.symbol);
    const currentPrice = ticker.last;
    
    // Calculate ATR
    const atr = await calculateATR(exchange, bot.symbol, REBALANCE_CONFIG.ATR_PERIOD);
    
    // Analyze current position
    const position = analyzeGridPosition(bot, currentPrice);
    
    // Calculate optimal parameters
    const optimal = await calculateOptimalGrid(exchange, bot, currentPrice, atr);
    
    // Get current orders
    const activeOrders = db.getActiveOrders(botName);
    
    // Estimate rebalance cost
    const cost = estimateRebalanceCost(bot, optimal, activeOrders);
    
    // Display analysis
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  GRID REBALANCE ANALYSIS: ${bot.name}`);
    console.log(`${'═'.repeat(60)}`);
    
    console.log(`\n📊 Current Grid:`);
    console.log(`   Range: $${bot.lower_price.toFixed(2)} - $${bot.upper_price.toFixed(2)}`);
    console.log(`   Grid Count: ${bot.adjusted_grid_count}`);
    console.log(`   Active Orders: ${activeOrders.length}`);
    
    console.log(`\n📈 Market Position:`);
    console.log(`   Current Price: $${currentPrice.toFixed(2)}`);
    console.log(`   Grid Center: $${position.gridCenter.toFixed(2)}`);
    console.log(`   Position Zone: ${position.zone}`);
    console.log(`   Distance to Upper: ${position.upperPercent}%`);
    console.log(`   Distance to Lower: ${position.lowerPercent}%`);
    
    if (atr) {
      console.log(`\n📉 Volatility:`);
      console.log(`   ATR (14h): $${atr.toFixed(2)} (${(atr / currentPrice * 100).toFixed(2)}%)`);
      console.log(`   Volatility Multiplier: ${optimal.volatilityMultiplier.toFixed(2)}x`);
    }
    
    console.log(`\n🎯 Optimal Grid:`);
    console.log(`   Range: $${optimal.lowerPrice.toFixed(2)} - $${optimal.upperPrice.toFixed(2)}`);
    console.log(`   Range %: ${optimal.rangePercent}%`);
    console.log(`   Grid Count: ${optimal.gridCount}`);
    console.log(`   Spacing: $${optimal.spacing.toFixed(2)} (${optimal.spacingPercent}%)`);
    
    console.log(`\n💰 Rebalance Cost Estimate:`);
    console.log(`   Orders to Cancel: ${cost.ordersToCancel}`);
    console.log(`   Orders to Place: ${cost.ordersToPlace}`);
    console.log(`   Estimated Fees: $${cost.estimatedFees.toFixed(2)}`);
    console.log(`   Cost %: ${cost.costPercent.toFixed(3)}%`);
    
    // Determine if rebalance is recommended
    const shouldRebalance = force || 
      position.zone === 'CRITICAL' || 
      (position.zone === 'WARNING' && cost.costPercent < REBALANCE_CONFIG.MAX_REBALANCE_COST_PERCENT * 100);
    
    console.log(`\n📋 Recommendation:`);
    if (shouldRebalance) {
      console.log(`   ⚠️  REBALANCE RECOMMENDED`);
      console.log(`   Reason: ${force ? 'Forced' : `Price in ${position.zone} zone`}`);
      
      if (execute) {
        const result = await executeRebalance(exchange, bot, optimal, testMode);
        console.log(`\n✅ Rebalance Complete:`);
        console.log(`   Cancelled: ${result.cancelled} orders`);
        console.log(`   Placed: ${result.placed} orders`);
      } else {
        console.log(`\n   Run with --execute to perform rebalance`);
      }
    } else {
      console.log(`   ✅ Grid is optimally positioned`);
      console.log(`   No rebalance needed at this time`);
    }
    
    console.log(`\n${'═'.repeat(60)}\n`);
    
    return {
      bot: botName,
      position,
      optimal,
      cost,
      shouldRebalance,
    };
    
  } catch (error) {
    console.error(`❌ Error analyzing bot: ${error.message}`);
    return null;
  }
}

/**
 * Analyze all bots
 */
async function analyzeAllBots(options = {}) {
  const bots = db.getAllBots().filter(b => b.status === 'running');
  
  console.log(`\n🔍 Analyzing ${bots.length} running bot(s)...\n`);
  
  const results = [];
  for (const bot of bots) {
    const result = await analyzeBot(bot.name, options);
    if (result) {
      results.push(result);
    }
    // Rate limit between bots
    await new Promise(r => setTimeout(r, 1000));
  }
  
  // Summary
  const needsRebalance = results.filter(r => r.shouldRebalance);
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  SUMMARY`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`   Total Bots Analyzed: ${results.length}`);
  console.log(`   Needs Rebalance: ${needsRebalance.length}`);
  if (needsRebalance.length > 0) {
    console.log(`   Bots to Rebalance: ${needsRebalance.map(r => r.bot).join(', ')}`);
  }
  console.log(`${'═'.repeat(60)}\n`);
  
  return results;
}

// CLI
const args = process.argv.slice(2);
const command = args[0];
const botName = args.find(a => a.startsWith('--name='))?.split('=')[1];
const execute = args.includes('--execute');
const force = args.includes('--force');

if (command === 'analyze') {
  if (botName) {
    analyzeBot(botName, { execute, force });
  } else {
    analyzeAllBots({ execute, force });
  }
} else if (command === 'rebalance') {
  if (!botName) {
    console.error('❌ --name=<bot_name> required for rebalance');
    process.exit(1);
  }
  analyzeBot(botName, { execute: true, force: true });
} else {
  console.log(`
Grid Rebalancer - Dynamic grid adjustment tool

Usage:
  node grid-rebalancer.mjs analyze                    Analyze all running bots
  node grid-rebalancer.mjs analyze --name=<bot>       Analyze specific bot
  node grid-rebalancer.mjs analyze --execute          Analyze and execute if needed
  node grid-rebalancer.mjs rebalance --name=<bot>     Force rebalance a bot

Options:
  --name=<bot_name>   Target specific bot
  --execute           Execute recommended rebalances
  --force             Force rebalance even if not recommended
`);
}

export { analyzeBot, analyzeAllBots, executeRebalance, analyzeGridPosition, calculateOptimalGrid };
