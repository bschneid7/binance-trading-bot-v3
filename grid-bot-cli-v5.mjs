#!/usr/bin/env node

/**
 * Grid Trading Bot CLI - Version 5.0.0
 * 
 * ═══════════════════════════════════════════════════════════════════
 * MAJOR ENHANCEMENTS IN v5.0.0:
 * - WebSocket real-time price feed (replaces REST polling)
 * - SQLite database for robust state management
 * - Comprehensive error handling with exponential backoff
 * - Improved monitoring with health checks
 * ═══════════════════════════════════════════════════════════════════
 * 
 * Preserved features:
 * - Dynamic stop-loss protection (15%)
 * - Trailing stop mechanism (5%)
 * - Adaptive grid spacing (volatility-based)
 * - Kelly Criterion position sizing
 * - Performance metrics (Sharpe ratio, profit factor)
 * - Market regime detection
 * - Risk management controls
 */

import ccxt from 'ccxt';
import dotenv from 'dotenv';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDatabase, closeDatabase } from './database.mjs';
import { WebSocketPriceFeed, createWebSocketExchange } from './websocket-feed.mjs';

// Load environment
dotenv.config({ path: '.env.production' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Version
const VERSION = '5.0.0-WEBSOCKET-SQLITE';

// Risk management configuration
const RISK_CONFIG = {
  STOP_LOSS_PERCENT: 0.15,
  TRAILING_STOP_PERCENT: 0.05,
  MAX_RISK_PER_TRADE: 0.02,
  POSITION_SIZE_MULTIPLIER: 1.0,
  REBALANCE_THRESHOLD: 0.10,
  MAX_DRAWDOWN_LIMIT: 0.25,
  MIN_PROFIT_FOR_TRAILING: 0.03,
};

// Volatility thresholds for adaptive grids
const VOLATILITY_THRESHOLDS = {
  LOW: 0.005,
  MEDIUM: 0.015,
  HIGH: 0.030,
};

// Initialize database
const db = getDatabase();

// Initialize exchange
function initExchange() {
  const apiKey = process.env.BINANCE_API_KEY;
  const secret = process.env.BINANCE_API_SECRET;
  const testMode = process.env.PAPER_TRADING_MODE === 'true';

  if (!apiKey || !secret) {
    console.error('❌ Error: BINANCE_API_KEY and BINANCE_API_SECRET must be set in .env.production');
    process.exit(1);
  }

  console.log('🔧 Initializing exchange...');
  
  const exchange = new ccxt.binanceus({
    apiKey,
    secret,
    enableRateLimit: true,
    options: {
      defaultType: 'spot',
      adjustForTimeDifference: true,
    },
  });

  if (testMode) {
    exchange.setSandboxMode(true);
  }

  console.log('✅ Exchange initialized successfully');
  console.log('   - Exchange ID:', exchange.id);
  console.log('   - Mode:', testMode ? 'PAPER TRADING' : 'LIVE TRADING');

  return { exchange, testMode };
}

// Calculate ATR (Average True Range) for volatility
async function calculateATR(exchange, symbol, period = 14) {
  try {
    const ohlcv = await exchange.fetchOHLCV(symbol, '1h', undefined, period + 1);
    
    let atrSum = 0;
    for (let i = 1; i < ohlcv.length; i++) {
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
    
    const atr = atrSum / period;
    const currentPrice = ohlcv[ohlcv.length - 1][4];
    return atr / currentPrice;
  } catch (error) {
    console.error('Error calculating ATR:', error.message);
    return 0.01;
  }
}

// Detect market regime
function detectMarketRegime(currentPrice, gridLower, gridUpper, atr) {
  const pricePosition = (currentPrice - gridLower) / (gridUpper - gridLower);
  
  let regime = 'RANGING';
  let direction = 'NEUTRAL';
  
  if (pricePosition > 0.7) {
    direction = 'BULLISH';
  } else if (pricePosition < 0.3) {
    direction = 'BEARISH';
  }
  
  if (atr > VOLATILITY_THRESHOLDS.HIGH) {
    regime = 'TRENDING';
  }
  
  return `${regime} (${direction})`;
}

// Calculate adaptive grid count based on volatility
function getAdaptiveGridCount(baseGridCount, atr) {
  if (atr < VOLATILITY_THRESHOLDS.LOW) {
    return Math.floor(baseGridCount * 1.3);
  } else if (atr > VOLATILITY_THRESHOLDS.HIGH) {
    return Math.floor(baseGridCount * 0.7);
  }
  return baseGridCount;
}

// Calculate grid levels with geometric spacing
function calculateGridLevels(lower, upper, gridCount, currentPrice) {
  const levels = [];
  const ratio = Math.pow(upper / lower, 1 / gridCount);
  
  for (let i = 0; i <= gridCount; i++) {
    const price = lower * Math.pow(ratio, i);
    const side = price < currentPrice ? 'buy' : 'sell';
    const distanceFromPrice = Math.abs(price - currentPrice) / currentPrice;
    const spacingMultiplier = 1 + distanceFromPrice;
    
    levels.push({
      level: i + 1,
      price: parseFloat(price.toFixed(2)),
      side,
      spacing_multiplier: parseFloat(spacingMultiplier.toFixed(2)),
    });
  }
  
  return levels;
}

// Calculate position size using Kelly Criterion
function calculatePositionSize(baseSize, winRate, avgWin, avgLoss) {
  if (winRate === 0 || avgWin === 0 || avgLoss === 0) {
    return baseSize;
  }
  
  const winProb = winRate / 100;
  const lossProb = 1 - winProb;
  const winLossRatio = avgWin / avgLoss;
  
  const kellyPercent = (winProb * winLossRatio - lossProb) / winLossRatio;
  const adjustedKelly = Math.max(0.5, Math.min(2.0, kellyPercent * RISK_CONFIG.POSITION_SIZE_MULTIPLIER));
  
  return baseSize * adjustedKelly;
}

// Place grid orders
async function placeGridOrders(bot, gridLevels, exchange, testMode) {
  // Cancel existing orders first
  db.cancelAllOrders(bot.name, 'grid_restart');
  
  const placedOrders = [];
  
  for (const level of gridLevels) {
    try {
      const orderId = `${bot.name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const amount = bot.order_size / level.price;
      
      if (testMode) {
        // Paper trading - create simulated order in database
        const order = db.createOrder({
          id: orderId,
          bot_name: bot.name,
          symbol: bot.symbol,
          side: level.side,
          price: level.price,
          amount: parseFloat(amount.toFixed(8)),
        });
        placedOrders.push(order);
      } else {
        // Live trading - place actual order
        const order = await exchange.createLimitOrder(
          bot.symbol,
          level.side,
          amount,
          level.price
        );
        
        db.createOrder({
          id: order.id,
          bot_name: bot.name,
          symbol: bot.symbol,
          side: level.side,
          price: level.price,
          amount: order.amount,
        });
        placedOrders.push(order);
      }
    } catch (error) {
      console.error(`❌ Failed to place ${level.side} order at $${level.price}:`, error.message);
    }
  }
  
  return placedOrders;
}

// Check stop-loss
function checkStopLoss(bot, currentPrice, metrics) {
  const entryPrice = (bot.lower_price + bot.upper_price) / 2;
  const loss = (entryPrice - currentPrice) / entryPrice;
  
  if (loss >= RISK_CONFIG.STOP_LOSS_PERCENT) {
    return {
      triggered: true,
      reason: `Stop-loss triggered: ${(loss * 100).toFixed(2)}% loss`,
    };
  }
  
  if (metrics.max_drawdown >= RISK_CONFIG.MAX_DRAWDOWN_LIMIT * 100) {
    return {
      triggered: true,
      reason: `Max drawdown exceeded: ${metrics.max_drawdown.toFixed(2)}%`,
    };
  }
  
  return { triggered: false };
}

// Check profit-taking
function checkProfitTaking(activeOrders, currentPrice, threshold = 0.025) {
  if (activeOrders.length === 0) return null;
  
  let totalCost = 0;
  let totalValue = 0;
  
  for (const order of activeOrders) {
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

// ==================== CLI COMMANDS ====================

async function createBot(args) {
  const name = args.name;
  const lower = parseFloat(args.lower);
  const upper = parseFloat(args.upper);
  const grids = parseInt(args.grids);
  const size = parseFloat(args.size);

  if (!name || !lower || !upper || !grids || !size) {
    console.error('❌ Error: Missing required arguments');
    console.log('Usage: grid-bot-cli create --name <name> --lower <price> --upper <price> --grids <count> --size <usd>');
    process.exit(1);
  }

  // Check if bot exists
  const existingBot = db.getBot(name);
  if (existingBot) {
    console.error(`❌ Error: Bot with name "${name}" already exists`);
    process.exit(1);
  }

  const { exchange } = initExchange();
  const symbol = args.symbol || 'BTC/USD';

  try {
    console.log(`📊 Fetching current market data for ${symbol}...\n`);
    
    const ticker = await exchange.fetchTicker(symbol);
    const currentPrice = ticker.last;
    const atr = await calculateATR(exchange, symbol);
    const adjustedGridCount = getAdaptiveGridCount(grids, atr);
    
    console.log(`✅ Current Price: $${currentPrice.toFixed(2)}`);
    console.log(`📊 Volatility (ATR): ${(atr * 100).toFixed(2)}%`);
    console.log(`🎯 Adjusted Grid Levels: ${adjustedGridCount} (base: ${grids})`);
    
    const regime = detectMarketRegime(currentPrice, lower, upper, atr);
    console.log(`📈 Market Regime: ${regime}\n`);

    // Create bot in database
    const bot = db.createBot({
      name,
      symbol,
      lower_price: lower,
      upper_price: upper,
      grid_count: grids,
      adjusted_grid_count: adjustedGridCount,
      order_size: size,
      status: 'stopped',
      version: VERSION,
    });

    console.log(`✅ Bot "${name}" created successfully!`);
    console.log(`💰 Total Capital Allocated: $${(size * adjustedGridCount).toFixed(2)}`);
    console.log(`🎯 Grid Range: $${lower.toFixed(2)} - $${upper.toFixed(2)}`);
    console.log(`\nRun 'node grid-bot-cli-v5.mjs start --name ${name}' to begin trading`);

  } catch (error) {
    console.error('❌ Error creating bot:', error.message);
    process.exit(1);
  }
}

async function startBot(args) {
  const name = args.name;

  if (!name) {
    console.error('❌ Error: Bot name required');
    process.exit(1);
  }

  const bot = db.getBot(name);
  if (!bot) {
    console.error(`❌ Error: Bot "${name}" not found`);
    process.exit(1);
  }

  if (bot.status === 'running') {
    console.log(`⚠️  Bot "${name}" is already running`);
    process.exit(0);
  }

  const { exchange, testMode } = initExchange();

  try {
    console.log(`🚀 Starting bot "${name}"...\n`);
    
    const ticker = await exchange.fetchTicker(bot.symbol);
    const currentPrice = ticker.last;
    const atr = await calculateATR(exchange, bot.symbol);
    
    const gridLevels = calculateGridLevels(
      bot.lower_price,
      bot.upper_price,
      bot.adjusted_grid_count,
      currentPrice
    );
    
    console.log(`📊 Current Price: $${currentPrice.toFixed(2)}`);
    console.log(`🎯 Placing ${gridLevels.length} grid orders...\n`);
    
    const orders = await placeGridOrders(bot, gridLevels, exchange, testMode);
    
    const buyOrders = orders.filter(o => o.side === 'buy').length;
    const sellOrders = orders.filter(o => o.side === 'sell').length;
    
    console.log(`✅ Placed ${buyOrders} BUY orders`);
    console.log(`✅ Placed ${sellOrders} SELL orders`);
    console.log(`✅ Total: ${orders.length} orders active\n`);
    
    // Update bot status
    db.updateBotStatus(name, 'running');
    
    console.log(`📝 Mode: ${testMode ? 'PAPER TRADING' : '🔴 LIVE TRADING'}`);
    console.log(`\n✅ Bot "${name}" started successfully!`);
    console.log(`Run 'node grid-bot-cli-v5.mjs monitor --name ${name}' to monitor`);

  } catch (error) {
    console.error('❌ Error starting bot:', error.message);
    process.exit(1);
  }
}

async function stopBot(args) {
  const name = args.name;

  if (!name) {
    console.error('❌ Error: Bot name required');
    process.exit(1);
  }

  const bot = db.getBot(name);
  if (!bot) {
    console.error(`❌ Error: Bot "${name}" not found`);
    process.exit(1);
  }

  const { exchange, testMode } = initExchange();

  try {
    console.log(`🛑 Stopping bot "${name}"...\n`);
    
    // Cancel all orders
    const cancelledCount = db.cancelAllOrders(name, 'bot_stopped');
    console.log(`✅ Cancelled ${cancelledCount.changes} orders in database`);
    
    if (!testMode) {
      // Also cancel on exchange for live trading
      const activeOrders = db.getActiveOrders(name);
      for (const order of activeOrders) {
        try {
          await exchange.cancelOrder(order.id, bot.symbol);
        } catch (error) {
          console.error(`Failed to cancel order ${order.id}:`, error.message);
        }
      }
    }
    
    // Update bot status
    db.updateBotStatus(name, 'stopped');
    
    console.log(`\n✅ Bot "${name}" stopped successfully`);

  } catch (error) {
    console.error('❌ Error stopping bot:', error.message);
    process.exit(1);
  }
}

async function showBot(args) {
  const name = args.name;

  if (!name) {
    console.error('❌ Error: Bot name required');
    process.exit(1);
  }

  const bot = db.getBot(name);
  if (!bot) {
    console.error(`❌ Bot "${name}" not found`);
    process.exit(1);
  }

  const { exchange } = initExchange();

  try {
    const ticker = await exchange.fetchTicker(bot.symbol);
    const currentPrice = ticker.last;
    const atr = await calculateATR(exchange, bot.symbol);
    const regime = detectMarketRegime(currentPrice, bot.lower_price, bot.upper_price, atr);
    
    const activeOrders = db.getActiveOrders(name);
    const metrics = db.getMetrics(name);
    
    const positionPct = ((currentPrice - bot.lower_price) / (bot.upper_price - bot.lower_price)) * 100;
    const withinGrid = currentPrice >= bot.lower_price && currentPrice <= bot.upper_price;
    
    console.log(`\n🤖 Grid Bot: ${name}`);
    console.log('═'.repeat(80));
    console.log();
    console.log('Bot Information:');
    console.log(`   ID: ${bot.id}`);
    console.log(`   Symbol: ${bot.symbol}`);
    console.log(`   Status: ${bot.status.toUpperCase()} ${bot.status === 'running' ? '🟢' : '🔴'}`);
    console.log(`   Version: ${bot.version}`);
    console.log();
    console.log('📈 Configuration:');
    console.log(`   Price Range: $${bot.lower_price.toFixed(2)} - $${bot.upper_price.toFixed(2)}`);
    console.log(`   Grid Levels: ${bot.adjusted_grid_count}`);
    console.log(`   Order Size: $${bot.order_size.toFixed(2)} per level`);
    console.log(`   Total Capital: $${(bot.order_size * bot.adjusted_grid_count).toFixed(2)}`);
    console.log();
    console.log('💰 Current Market:');
    console.log(`   Price: $${currentPrice.toFixed(2)}`);
    console.log(`   Position: ${withinGrid ? '✅ WITHIN' : '❌ OUTSIDE'} grid range (${positionPct.toFixed(1)}%)`);
    console.log(`   Volatility: ${atr < VOLATILITY_THRESHOLDS.LOW ? 'LOW' : atr > VOLATILITY_THRESHOLDS.HIGH ? 'HIGH' : 'MEDIUM'} (ATR: ${(atr * 100).toFixed(2)}%)`);
    console.log(`   Market Regime: ${regime}`);
    console.log();
    console.log('📋 Orders:');
    console.log(`   Active: ${activeOrders.length}`);
    console.log(`   Total Trades: ${metrics.total_trades}`);
    console.log();
    
    if (metrics.total_trades > 0) {
      console.log('📊 Performance Metrics:');
      console.log(`   Win Rate: ${metrics.win_rate.toFixed(2)}%`);
      console.log(`   Profit Factor: ${metrics.profit_factor.toFixed(2)}`);
      console.log(`   Total P&L: $${metrics.total_pnl.toFixed(2)}`);
      console.log(`   Avg Win: $${metrics.avg_win.toFixed(2)}`);
      console.log(`   Avg Loss: $${metrics.avg_loss.toFixed(2)}`);
      console.log(`   Max Drawdown: ${metrics.max_drawdown.toFixed(2)}%`);
      console.log(`   Sharpe Ratio: ${metrics.sharpe_ratio.toFixed(2)}`);
      console.log();
    }
    
    console.log('🛡️  Risk Management:');
    console.log(`   Stop Loss: ${(RISK_CONFIG.STOP_LOSS_PERCENT * 100).toFixed(0)}%`);
    console.log(`   Trailing Stop: ${(RISK_CONFIG.TRAILING_STOP_PERCENT * 100).toFixed(0)}%`);
    console.log(`   Max Risk/Trade: ${(RISK_CONFIG.MAX_RISK_PER_TRADE * 100).toFixed(0)}%`);
    console.log();
    console.log('═'.repeat(80));

  } catch (error) {
    console.error('❌ Error fetching bot details:', error.message);
    process.exit(1);
  }
}

function listBots() {
  const bots = db.getAllBots();

  if (bots.length === 0) {
    console.log('No bots found. Create one with: node grid-bot-cli-v5.mjs create');
    return;
  }

  console.log('\n📊 Grid Bots:\n');
  console.log('ID  Name              Symbol    Status     Grids  Range                    Capital');
  console.log('─'.repeat(90));

  bots.forEach(bot => {
    const status = bot.status === 'running' ? '🟢 Running' : '🔴 Stopped';
    console.log(
      `${bot.id.toString().padEnd(4)}` +
      `${bot.name.padEnd(18)}` +
      `${bot.symbol.padEnd(10)}` +
      `${status.padEnd(11)}` +
      `${bot.adjusted_grid_count.toString().padEnd(7)}` +
      `$${bot.lower_price.toFixed(0)}-$${bot.upper_price.toFixed(0)}`.padEnd(25) +
      `$${(bot.order_size * bot.adjusted_grid_count).toFixed(2)}`
    );
  });

  console.log();
}

async function monitorBot(args) {
  const botName = args.name;
  
  if (!botName) {
    console.error('❌ Error: --name parameter is required');
    process.exit(1);
  }

  const bot = db.getBot(botName);
  if (!bot) {
    console.error(`❌ Error: Bot "${botName}" not found`);
    process.exit(1);
  }

  const { exchange, testMode } = initExchange();

  console.log(`\n🔍 Starting WebSocket monitor for bot "${botName}"...`);
  console.log(`📊 Symbol: ${bot.symbol}`);
  console.log(`🔌 Connection: WebSocket (real-time)`);
  console.log(`📝 Mode: ${testMode ? 'PAPER TRADING' : '🔴 LIVE TRADING'}`);
  console.log();

  let totalFills = 0;
  let totalReplacements = 0;

  // Create WebSocket price feed
  const priceFeed = new WebSocketPriceFeed(exchange, {
    symbol: bot.symbol,
    healthCheckInterval: 30000,
    staleDataThreshold: 60000,
    fallbackInterval: 10000,
    
    onPrice: async (priceData) => {
      const currentPrice = priceData.price;
      const source = priceData.source;
      
      console.log(`\n[${new Date().toISOString()}] ${source === 'websocket' ? '🔌' : '📡'} Price: $${currentPrice.toFixed(2)}`);
      
      // Check for fills
      const filledOrders = db.checkAndFillOrders(botName, currentPrice);
      
      if (filledOrders.length > 0) {
        console.log(`🎯 ${filledOrders.length} order(s) filled at $${currentPrice.toFixed(2)}`);
        totalFills += filledOrders.length;
        
        // Record trades and place replacement orders
        for (const filledOrder of filledOrders) {
          // Record trade
          db.recordTrade({
            bot_name: botName,
            symbol: bot.symbol,
            side: filledOrder.side,
            price: currentPrice,
            amount: filledOrder.amount,
            value: currentPrice * filledOrder.amount,
            order_id: filledOrder.id,
            type: 'fill'
          });
          
          // Place replacement order
          const oppositeSide = filledOrder.side === 'buy' ? 'sell' : 'buy';
          const gridSpacing = (bot.upper_price - bot.lower_price) / bot.adjusted_grid_count;
          const newPrice = filledOrder.side === 'buy' 
            ? filledOrder.price + gridSpacing 
            : filledOrder.price - gridSpacing;
          
          const newOrderId = `${botName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          
          if (testMode) {
            db.createOrder({
              id: newOrderId,
              bot_name: botName,
              symbol: bot.symbol,
              side: oppositeSide,
              price: parseFloat(newPrice.toFixed(2)),
              amount: filledOrder.amount,
            });
          } else {
            try {
              const order = await exchange.createLimitOrder(
                bot.symbol,
                oppositeSide,
                filledOrder.amount,
                newPrice
              );
              db.createOrder({
                id: order.id,
                bot_name: botName,
                symbol: bot.symbol,
                side: oppositeSide,
                price: newPrice,
                amount: order.amount,
              });
            } catch (error) {
              console.error(`❌ Failed to place replacement order:`, error.message);
            }
          }
          
          totalReplacements++;
          console.log(`🔄 Placed ${oppositeSide.toUpperCase()} replacement at $${newPrice.toFixed(2)}`);
        }
        
        // Update metrics
        db.updateMetrics(botName);
      }
      
      // Check profit-taking
      const activeOrders = db.getActiveOrders(botName);
      const profitCheck = checkProfitTaking(activeOrders, currentPrice);
      
      if (profitCheck && profitCheck.action === 'PROFIT_TARGET_HIT') {
        console.log(`\n💰 PROFIT TARGET HIT!`);
        console.log(`   Unrealized P&L: $${profitCheck.pnl.toFixed(2)} (${(profitCheck.pnlPercent * 100).toFixed(2)}%)`);
        
        // Cancel all orders and restart grid
        db.cancelAllOrders(botName, 'profit_target_hit');
        console.log(`   ✅ Orders cancelled, fresh grid will be placed`);
        
        // Place new grid
        const gridLevels = calculateGridLevels(
          bot.lower_price,
          bot.upper_price,
          bot.adjusted_grid_count,
          currentPrice
        );
        await placeGridOrders(bot, gridLevels, exchange, testMode);
        console.log(`   🎯 Fresh grid active\n`);
      }
      
      // Check stop-loss
      const metrics = db.getMetrics(botName);
      const stopLoss = checkStopLoss(bot, currentPrice, metrics);
      
      if (stopLoss.triggered) {
        console.log(`\n🚨 ${stopLoss.reason}`);
        console.log(`   Stopping bot and cancelling all orders...`);
        db.cancelAllOrders(botName, 'stop_loss');
        db.updateBotStatus(botName, 'stopped');
        await priceFeed.stop();
        process.exit(0);
      }
      
      console.log(`📊 Stats: ${totalFills} fills, ${totalReplacements} replacements`);
    },
    
    onConnect: () => {
      console.log('✅ WebSocket connected');
    },
    
    onDisconnect: (error) => {
      console.log('⚠️  WebSocket disconnected:', error?.message || 'Unknown reason');
    },
    
    onError: (error) => {
      console.error('❌ Price feed error:', error.message);
    }
  });

  // Start price feed
  await priceFeed.start();

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\n🛑 Stopping monitor...');
    await priceFeed.stop();
    console.log(`📊 Final stats:`);
    console.log(`   - Total fills: ${totalFills}`);
    console.log(`   - Total replacements: ${totalReplacements}`);
    closeDatabase();
    process.exit(0);
  });
}

async function deleteBot(args) {
  const name = args.name;

  if (!name) {
    console.error('❌ Error: Bot name required');
    process.exit(1);
  }

  const bot = db.getBot(name);
  if (!bot) {
    console.error(`❌ Error: Bot "${name}" not found`);
    process.exit(1);
  }

  if (bot.status === 'running') {
    console.error(`❌ Error: Cannot delete running bot. Stop it first.`);
    process.exit(1);
  }

  db.deleteBot(name);
  console.log(`✅ Bot "${name}" deleted successfully`);
}

// Parse command line arguments
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args[key] = argv[i + 1];
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

// Main CLI
async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const args = parseArgs(argv.slice(1));

  switch (command) {
    case 'create':
      await createBot(args);
      break;
    case 'start':
      await startBot(args);
      break;
    case 'stop':
      await stopBot(args);
      break;
    case 'show':
      await showBot(args);
      break;
    case 'list':
      listBots();
      break;
    case 'monitor':
      await monitorBot(args);
      // Note: monitorBot runs indefinitely, closeDatabase is called in SIGINT handler
      return;
    case 'delete':
      await deleteBot(args);
      break;
    case 'help':
    case '--help':
    case '-h':
      console.log(`
Grid Trading Bot CLI - Version ${VERSION}

Usage: node grid-bot-cli-v5.mjs <command> [options]

Commands:
  create    Create a new grid bot
  start     Start a bot
  stop      Stop a bot
  show      Show detailed bot information
  list      List all bots
  monitor   Monitor bot with WebSocket real-time feed
  delete    Delete a bot
  help      Show this help message

Options:
  --name <name>       Bot name
  --symbol <pair>     Trading pair (default: BTC/USD)
  --lower <price>     Lower grid price (USD)
  --upper <price>     Upper grid price (USD)
  --grids <count>     Number of grid levels
  --size <usd>        Order size in USD per level

Examples:
  node grid-bot-cli-v5.mjs create --name my-bot --lower 90000 --upper 100000 --grids 10 --size 100
  node grid-bot-cli-v5.mjs start --name my-bot
  node grid-bot-cli-v5.mjs monitor --name my-bot
  node grid-bot-cli-v5.mjs stop --name my-bot
`);
      break;
    default:
      console.error(`❌ Unknown command: ${command}`);
      console.log('Run "node grid-bot-cli-v5.mjs help" for usage information');
      process.exit(1);
  }
  
  closeDatabase();
}

main().then(() => {
  // Normal exit for non-monitor commands
}).catch(error => {
  console.error('❌ Fatal error:', error.message);
  closeDatabase();
  process.exit(1);
});
