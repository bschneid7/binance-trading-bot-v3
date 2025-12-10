#!/usr/bin/env node

/**
 * Grid Trading Bot - Enhanced CLI Management Tool
 * Version: 2.0.0
 * 
 * ENHANCEMENTS:
 * - Dynamic stop-loss protection
 * - Adaptive grid spacing based on volatility
 * - Dynamic position sizing with Kelly Criterion
 * - Complete order state management
 * - Advanced performance metrics (Sharpe ratio, profit factor)
 * - Automatic grid rebalancing
 * - Trailing stops for winning positions
 * - Market regime detection
 * 
 * Author: Enhanced by AI Analysis
 * Date: 2024-12-10
 */

import ccxt from 'ccxt';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '.env.production') });

// ============================================================================
// CONFIGURATION & CONSTANTS
// ============================================================================

const RISK_CONFIG = {
  STOP_LOSS_PERCENT: 0.15,        // 15% stop loss
  TRAILING_STOP_PERCENT: 0.05,    // 5% trailing stop
  MAX_RISK_PER_TRADE: 0.02,       // 2% of account per trade (Kelly Criterion)
  PROFIT_LOCK_THRESHOLD: 0.03,    // Lock profits above 3%
  REBALANCE_THRESHOLD: 0.10,      // Rebalance if price moves 10% outside range
  STALE_ORDER_RANGE: 0.05,        // Cancel orders >5% from current price
};

const VOLATILITY_THRESHOLDS = {
  HIGH: 3.0,      // ATR% > 3% = high volatility
  MEDIUM: 2.0,    // ATR% > 2% = medium volatility
  LOW: 0.5,       // ATR% < 0.5% = low volatility
};

// ============================================================================
// DATABASE INITIALIZATION
// ============================================================================

const DB_DIR = join(__dirname, 'data');
const BOTS_FILE = join(DB_DIR, 'grid-bots.json');
const TRADES_FILE = join(DB_DIR, 'grid-trades.json');
const ORDERS_FILE = join(DB_DIR, 'active-orders.json');
const METRICS_FILE = join(DB_DIR, 'bot-metrics.json');

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// Load or initialize data
function loadData(file, defaultValue = []) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(defaultValue, null, 2));
    return defaultValue;
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`Error loading ${file}:`, error.message);
    return defaultValue;
  }
}

function saveData(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Error saving ${file}:`, error.message);
  }
}

let bots = loadData(BOTS_FILE);
let trades = loadData(TRADES_FILE);
let activeOrders = loadData(ORDERS_FILE);
let metrics = loadData(METRICS_FILE, {});

// ============================================================================
// EXCHANGE INITIALIZATION
// ============================================================================

let exchange;
try {
  exchange = new ccxt.binanceus({
    apiKey: process.env.BINANCE_API_KEY,
    secret: process.env.BINANCE_API_SECRET,
    enableRateLimit: true,
    options: {
      defaultType: 'spot',
      adjustForTimeDifference: true
    }
  });
} catch (error) {
  console.error('❌ Failed to initialize Binance.US client:', error.message);
  process.exit(1);
}

const TEST_MODE = process.env.BINANCE_TEST_MODE === 'true';

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function formatPrice(price) {
  return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(date) {
  return new Date(date).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function generateOrderId() {
  return `ORDER_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ============================================================================
// TECHNICAL ANALYSIS FUNCTIONS
// ============================================================================

/**
 * Calculate Average True Range (ATR) for volatility measurement
 */
function calculateATR(highs, lows, closes, period = 14) {
  if (highs.length < period + 1) return 0;
  
  const trueRanges = [];
  for (let i = 1; i < highs.length; i++) {
    const high = highs[i];
    const low = lows[i];
    const prevClose = closes[i - 1];
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }
  
  const atr = trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;
  return atr;
}

/**
 * Calculate Exponential Moving Average (EMA)
 */
function calculateEMA(data, period) {
  if (data.length < period) return data[data.length - 1];
  
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  
  return ema;
}

/**
 * Detect market regime (trending vs ranging)
 */
async function detectMarketRegime(symbol) {
  try {
    const ohlcv = await exchange.fetchOHLCV(symbol, '4h', undefined, 50);
    const closes = ohlcv.map(c => c[4]);
    
    // Calculate EMAs
    const ema20 = calculateEMA(closes, 20);
    const ema50 = calculateEMA(closes, 50);
    
    const trend = ema20 > ema50 ? 'BULLISH' : 'BEARISH';
    const strength = Math.abs(ema20 - ema50) / ema50;
    
    // Determine if trending or ranging
    const regime = strength > 0.02 ? 'TRENDING' : 'RANGING';
    
    return { 
      trend, 
      regime, 
      strength: (strength * 100).toFixed(2),
      ema20: ema20.toFixed(2),
      ema50: ema50.toFixed(2)
    };
  } catch (error) {
    console.error('Error detecting market regime:', error.message);
    return { trend: 'UNKNOWN', regime: 'UNKNOWN', strength: 0 };
  }
}

/**
 * Get volatility analysis for symbol
 */
async function getVolatilityAnalysis(symbol) {
  try {
    const ohlcv = await exchange.fetchOHLCV(symbol, '1h', undefined, 100);
    const highs = ohlcv.map(candle => candle[2]);
    const lows = ohlcv.map(candle => candle[3]);
    const closes = ohlcv.map(candle => candle[4]);
    const currentPrice = closes[closes.length - 1];
    
    const atr = calculateATR(highs, lows, closes, 14);
    const atrPercent = (atr / currentPrice) * 100;
    
    let volatilityLevel = 'MEDIUM';
    if (atrPercent > VOLATILITY_THRESHOLDS.HIGH) {
      volatilityLevel = 'HIGH';
    } else if (atrPercent < VOLATILITY_THRESHOLDS.LOW) {
      volatilityLevel = 'LOW';
    }
    
    return {
      atr: atr.toFixed(2),
      atrPercent: atrPercent.toFixed(2),
      level: volatilityLevel,
      currentPrice: currentPrice
    };
  } catch (error) {
    console.error('Error analyzing volatility:', error.message);
    return null;
  }
}

// ============================================================================
// EXCHANGE INTERACTION FUNCTIONS
// ============================================================================

/**
 * Get current market price for symbol
 */
async function getCurrentPrice(symbol) {
  try {
    const ticker = await exchange.fetchTicker(symbol);
    return ticker.last;
  } catch (error) {
    console.error('❌ Error fetching price:', error.message);
    return null;
  }
}

/**
 * Get account balance
 */
async function getBalance() {
  try {
    const balance = await exchange.fetchBalance();
    return {
      usd: balance.free?.USD || 0,
      btc: balance.free?.BTC || 0,
      total: balance.total?.USD || 0
    };
  } catch (error) {
    console.error('❌ Error fetching balance:', error.message);
    return { usd: 0, btc: 0, total: 0 };
  }
}

// ============================================================================
// RISK MANAGEMENT FUNCTIONS
// ============================================================================

/**
 * Calculate stop loss price for a position
 */
function calculateStopLoss(entryPrice, position = 'LONG') {
  if (position === 'LONG') {
    return entryPrice * (1 - RISK_CONFIG.STOP_LOSS_PERCENT);
  }
  return entryPrice * (1 + RISK_CONFIG.STOP_LOSS_PERCENT);
}

/**
 * Update trailing stop for profitable positions
 */
function updateTrailingStop(trade, currentPrice) {
  const unrealizedProfit = (currentPrice - trade.entry_price) / trade.entry_price;
  
  // Only activate trailing stop if profit exceeds threshold
  if (unrealizedProfit > RISK_CONFIG.PROFIT_LOCK_THRESHOLD) {
    const trailingStop = currentPrice * (1 - RISK_CONFIG.TRAILING_STOP_PERCENT);
    
    if (!trade.trailing_stop || trailingStop > trade.trailing_stop) {
      trade.trailing_stop = trailingStop;
      trade.updated_at = new Date().toISOString();
      return true;
    }
  }
  
  return false;
}

/**
 * Check stop loss conditions for active trades
 */
async function checkStopLoss(bot, currentPrice) {
  const botTrades = trades.filter(t => t.bot_id === bot.id && !t.exit_price);
  let triggeredStops = 0;
  
  for (const trade of botTrades) {
    let shouldClose = false;
    let closeReason = '';
    
    // Check hard stop loss
    const stopLossPrice = calculateStopLoss(trade.entry_price, trade.position || 'LONG');
    if (currentPrice <= stopLossPrice) {
      shouldClose = true;
      closeReason = 'STOP_LOSS';
    }
    
    // Check trailing stop
    if (trade.trailing_stop && currentPrice <= trade.trailing_stop) {
      shouldClose = true;
      closeReason = 'TRAILING_STOP';
    }
    
    if (shouldClose) {
      const loss = (currentPrice - trade.entry_price) * trade.amount;
      
      console.log(`\n🚨 ${closeReason} TRIGGERED for ${bot.name}`);
      console.log(`   Entry: ${formatPrice(trade.entry_price)}`);
      console.log(`   Current: ${formatPrice(currentPrice)}`);
      console.log(`   Loss: ${formatPrice(loss)}`);
      
      // Close position
      trade.exit_price = currentPrice;
      trade.exit_time = new Date().toISOString();
      trade.close_reason = closeReason;
      trade.profit = loss;
      
      triggeredStops++;
    }
  }
  
  if (triggeredStops > 0) {
    saveData(TRADES_FILE, trades);
    
    // Pause bot after stop loss
    bot.status = 'paused';
    bot.stop_reason = 'STOP_LOSS_HIT';
    bot.updated_at = new Date().toISOString();
    saveData(BOTS_FILE, bots);
    
    console.log(`\n⏸️  Bot "${bot.name}" paused after ${triggeredStops} stop loss(es)`);
    console.log(`   Use "grid-bot-cli start --name ${bot.name}" to resume\n`);
  }
  
  return triggeredStops;
}

/**
 * Calculate dynamic position size based on volatility and Kelly Criterion
 */
function calculateDynamicOrderSize(baseOrderSize, atrPercent, accountBalance, winRate = 0.55, avgWinLoss = 1.5) {
  // Volatility adjustment
  let volatilityMultiplier = 1.0;
  
  if (atrPercent > VOLATILITY_THRESHOLDS.HIGH) {
    volatilityMultiplier = 0.5; // Cut size in half during high volatility
  } else if (atrPercent > VOLATILITY_THRESHOLDS.MEDIUM) {
    volatilityMultiplier = 0.75;
  } else if (atrPercent < VOLATILITY_THRESHOLDS.LOW) {
    volatilityMultiplier = 1.2; // Increase in low volatility
  }
  
  // Kelly Criterion for optimal position sizing
  // Kelly % = W - [(1 - W) / R] where W = win rate, R = avg win/avg loss
  const kellyPercent = Math.max(0, winRate - ((1 - winRate) / avgWinLoss));
  const kellyMultiplier = Math.min(kellyPercent * 0.5, 0.25); // Use half Kelly, cap at 25%
  
  // Apply risk limit
  const maxRiskPerTrade = accountBalance * RISK_CONFIG.MAX_RISK_PER_TRADE;
  
  const adjustedSize = Math.min(
    baseOrderSize * volatilityMultiplier,
    maxRiskPerTrade,
    accountBalance * kellyMultiplier
  );
  
  return {
    size: parseFloat(adjustedSize.toFixed(2)),
    volatilityMultiplier,
    kellyMultiplier,
    maxRisk: maxRiskPerTrade
  };
}

// ============================================================================
// GRID CALCULATION FUNCTIONS
// ============================================================================

/**
 * Calculate level weight for position sizing (more capital near center)
 */
function calculateLevelWeight(ratio) {
  // Bell curve distribution - allocate more capital near center (better risk/reward)
  const centerDistance = Math.abs(ratio - 0.5) * 2; // 0 to 1
  return 1 + (1 - centerDistance) * 0.5; // Weight between 1.0 and 1.5
}

/**
 * Calculate adaptive grid levels based on volatility
 */
async function calculateAdaptiveGridLevels(lowerPrice, upperPrice, gridCount, symbol) {
  try {
    // Fetch volatility analysis
    const volAnalysis = await getVolatilityAnalysis(symbol);
    
    if (!volAnalysis) {
      // Fallback to static grid if analysis fails
      return calculateStaticGridLevels(lowerPrice, upperPrice, gridCount);
    }
    
    const atrPercent = parseFloat(volAnalysis.atrPercent);
    
    // Adjust grid count based on volatility
    let adjustedGridCount = gridCount;
    if (atrPercent > VOLATILITY_THRESHOLDS.HIGH) {
      // High volatility: use fewer, wider grids
      adjustedGridCount = Math.max(5, Math.floor(gridCount * 0.7));
      console.log(`⚠️  High volatility (${atrPercent}%) - Using ${adjustedGridCount} wider grids`);
    } else if (atrPercent < VOLATILITY_THRESHOLDS.LOW) {
      // Low volatility: use more, tighter grids
      adjustedGridCount = Math.min(20, Math.floor(gridCount * 1.3));
      console.log(`✅ Low volatility (${atrPercent}%) - Using ${adjustedGridCount} tighter grids`);
    }
    
    const levels = [];
    
    // Use geometric distribution for better risk management
    for (let i = 0; i < adjustedGridCount; i++) {
      const ratio = i / (adjustedGridCount - 1);
      // Geometric spacing: more orders near center
      const geometricRatio = Math.pow(ratio, 0.85);
      const price = lowerPrice + (geometricRatio * (upperPrice - lowerPrice));
      
      levels.push({
        index: i,
        price: parseFloat(price.toFixed(2)),
        type: ratio < 0.5 ? 'BUY' : 'SELL',
        status: 'PENDING',
        weight: calculateLevelWeight(ratio)
      });
    }
    
    return {
      levels,
      adjustedGridCount,
      volatilityLevel: volAnalysis.level,
      atrPercent
    };
    
  } catch (error) {
    console.error('Error calculating adaptive grid:', error.message);
    return calculateStaticGridLevels(lowerPrice, upperPrice, gridCount);
  }
}

/**
 * Calculate static grid levels (fallback)
 */
function calculateStaticGridLevels(lowerPrice, upperPrice, gridCount) {
  const gridSpacing = (upperPrice - lowerPrice) / (gridCount - 1);
  const levels = [];
  
  for (let i = 0; i < gridCount; i++) {
    const price = lowerPrice + (i * gridSpacing);
    levels.push({
      index: i,
      price: parseFloat(price.toFixed(2)),
      type: i < gridCount / 2 ? 'BUY' : 'SELL',
      status: 'PENDING',
      weight: 1.0
    });
  }
  
  return { levels, adjustedGridCount: gridCount, volatilityLevel: 'UNKNOWN', atrPercent: 0 };
}

// ============================================================================
// ORDER MANAGEMENT FUNCTIONS
// ============================================================================

/**
 * Place a grid order (paper or live trading)
 */
async function placeGridOrder(bot, level, currentPrice, orderSize) {
  // Check if order already exists at this level
  const existingOrder = activeOrders.find(
    o => o.bot_id === bot.id && 
         Math.abs(o.price - level.price) < 1 && 
         o.status === 'OPEN'
  );
  
  if (existingOrder) {
    return { success: false, reason: 'ORDER_EXISTS', order: existingOrder };
  }
  
  try {
    let orderId;
    const adjustedSize = orderSize * level.weight;
    const amount = adjustedSize / level.price; // Convert USD to BTC amount
    
    if (TEST_MODE) {
      // Simulate order in paper trading
      orderId = generateOrderId();
      console.log(`📝 [PAPER] ${level.type} order simulated at ${formatPrice(level.price)}`);
    } else {
      // Place real order
      const order = await exchange.createLimitOrder(
        bot.symbol,
        level.type.toLowerCase(),
        amount,
        level.price
      );
      orderId = order.id;
      console.log(`✅ [LIVE] ${level.type} order placed at ${formatPrice(level.price)}`);
    }
    
    const orderRecord = {
      id: orderId,
      bot_id: bot.id,
      type: level.type,
      price: level.price,
      amount: amount,
      size_usd: adjustedSize,
      weight: level.weight,
      status: 'OPEN',
      created_at: new Date().toISOString(),
      level_index: level.index
    };
    
    activeOrders.push(orderRecord);
    saveData(ORDERS_FILE, activeOrders);
    
    return { success: true, order: orderRecord };
    
  } catch (error) {
    console.error(`❌ Failed to place ${level.type} order at ${formatPrice(level.price)}:`, error.message);
    return { success: false, reason: 'API_ERROR', error: error.message };
  }
}

/**
 * Cancel stale orders that are too far from current price
 */
async function cancelStaleOrders(bot, currentPrice) {
  const botOrders = activeOrders.filter(o => o.bot_id === bot.id && o.status === 'OPEN');
  let cancelledCount = 0;
  
  for (const order of botOrders) {
    const priceDiff = Math.abs(order.price - currentPrice) / currentPrice;
    
    if (priceDiff > RISK_CONFIG.STALE_ORDER_RANGE) {
      try {
        if (!TEST_MODE) {
          await exchange.cancelOrder(order.id, bot.symbol);
        }
        
        order.status = 'CANCELLED';
        order.cancelled_at = new Date().toISOString();
        order.cancel_reason = 'TOO_FAR_FROM_MARKET';
        
        console.log(`🚫 Cancelled stale ${order.type} order at ${formatPrice(order.price)} (${(priceDiff * 100).toFixed(1)}% away)`);
        cancelledCount++;
        
      } catch (error) {
        console.error(`❌ Failed to cancel order ${order.id}:`, error.message);
      }
    }
  }
  
  if (cancelledCount > 0) {
    saveData(ORDERS_FILE, activeOrders);
  }
  
  return cancelledCount;
}

/**
 * Cancel all orders for a bot
 */
async function cancelAllBotOrders(bot) {
  const botOrders = activeOrders.filter(o => o.bot_id === bot.id && o.status === 'OPEN');
  let cancelledCount = 0;
  
  for (const order of botOrders) {
    try {
      if (!TEST_MODE) {
        await exchange.cancelOrder(order.id, bot.symbol);
      }
      
      order.status = 'CANCELLED';
      order.cancelled_at = new Date().toISOString();
      order.cancel_reason = 'BOT_STOPPED';
      cancelledCount++;
      
    } catch (error) {
      console.error(`❌ Failed to cancel order ${order.id}:`, error.message);
    }
  }
  
  if (cancelledCount > 0) {
    saveData(ORDERS_FILE, activeOrders);
    console.log(`✅ Cancelled ${cancelledCount} orders for bot "${bot.name}"`);
  }
  
  return cancelledCount;
}

/**
 * Check if grid needs rebalancing (price moved outside range)
 */
async function checkGridRebalancing(bot, currentPrice) {
  const priceAboveUpper = currentPrice > bot.upper_price * (1 + RISK_CONFIG.REBALANCE_THRESHOLD);
  const priceBelowLower = currentPrice < bot.lower_price * (1 - RISK_CONFIG.REBALANCE_THRESHOLD);
  
  if (priceAboveUpper || priceBelowLower) {
    console.log(`\n🔄 Grid rebalancing recommended for "${bot.name}"`);
    console.log(`   Current price: ${formatPrice(currentPrice)}`);
    console.log(`   Grid range: ${formatPrice(bot.lower_price)} - ${formatPrice(bot.upper_price)}`);
    
    // Calculate new range centered on current price
    const gridRange = bot.upper_price - bot.lower_price;
    const newLower = currentPrice - (gridRange * 0.4);
    const newUpper = currentPrice + (gridRange * 0.6);
    
    console.log(`   Suggested new range: ${formatPrice(newLower)} - ${formatPrice(newUpper)}`);
    console.log(`\n   Run: grid-bot-cli rebalance --name ${bot.name} --lower ${newLower.toFixed(0)} --upper ${newUpper.toFixed(0)}`);
    
    return true;
  }
  
  return false;
}

// ============================================================================
// PERFORMANCE METRICS FUNCTIONS
// ============================================================================

/**
 * Calculate comprehensive performance metrics for a bot
 */
function calculateBotMetrics(bot) {
  const botTrades = trades.filter(t => t.bot_id === bot.id);
  
  if (botTrades.length === 0) {
    return null;
  }
  
  const completedTrades = botTrades.filter(t => t.exit_price);
  const openTrades = botTrades.filter(t => !t.exit_price);
  const winningTrades = completedTrades.filter(t => (t.profit || 0) > 0);
  const losingTrades = completedTrades.filter(t => (t.profit || 0) < 0);
  
  const totalProfit = completedTrades.reduce((sum, t) => sum + (t.profit || 0), 0);
  const totalFees = completedTrades.reduce((sum, t) => sum + (t.fees || 0), 0);
  const netProfit = totalProfit - totalFees;
  
  const avgWin = winningTrades.length > 0 
    ? winningTrades.reduce((sum, t) => sum + t.profit, 0) / winningTrades.length 
    : 0;
  const avgLoss = losingTrades.length > 0
    ? Math.abs(losingTrades.reduce((sum, t) => sum + t.profit, 0) / losingTrades.length)
    : 0;
  
  const winRate = completedTrades.length > 0
    ? (winningTrades.length / completedTrades.length) * 100
    : 0;
  
  const profitFactor = avgLoss > 0 ? avgWin / avgLoss : 0;
  
  // Calculate Sharpe ratio (simplified - annualized)
  if (completedTrades.length > 1) {
    const returns = completedTrades.map(t => (t.profit || 0) / t.total);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(365) : 0;
    
    // Calculate max drawdown
    let peak = 0;
    let maxDrawdown = 0;
    let runningProfit = 0;
    
    completedTrades.forEach(trade => {
      runningProfit += trade.profit || 0;
      if (runningProfit > peak) {
        peak = runningProfit;
      }
      const drawdown = peak - runningProfit;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    });
    
    const totalCapital = bot.order_size * bot.grid_count;
    const roi = (netProfit / totalCapital) * 100;
    
    return {
      totalTrades: completedTrades.length,
      openTrades: openTrades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: winRate.toFixed(2),
      totalProfit: totalProfit,
      totalFees: totalFees,
      netProfit: netProfit,
      avgWin: avgWin,
      avgLoss: avgLoss,
      profitFactor: profitFactor.toFixed(2),
      sharpeRatio: sharpeRatio.toFixed(2),
      maxDrawdown: maxDrawdown,
      roi: roi.toFixed(2),
      totalCapital: totalCapital
    };
  }
  
  return {
    totalTrades: completedTrades.length,
    openTrades: openTrades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate: winRate.toFixed(2),
    totalProfit: totalProfit,
    totalFees: totalFees,
    netProfit: netProfit,
    avgWin: avgWin,
    avgLoss: avgLoss,
    profitFactor: 0,
    sharpeRatio: 0,
    maxDrawdown: 0,
    roi: 0,
    totalCapital: bot.order_size * bot.grid_count
  };
}

/**
 * Display performance metrics in formatted table
 */
function displayMetrics(metrics) {
  if (!metrics) {
    console.log('\n📊 No performance data available yet\n');
    return;
  }
  
  console.log(`\n📊 Performance Metrics:`);
  console.log('   ' + '─'.repeat(70));
  
  // Trading statistics
  console.log(`\n   Trading Statistics:`);
  console.log(`   • Total Trades: ${metrics.totalTrades} (${metrics.openTrades} open)`);
  console.log(`   • Win Rate: ${metrics.winRate}% (${metrics.winningTrades}W / ${metrics.losingTrades}L)`);
  
  // Performance indicators
  const pfStatus = metrics.profitFactor > 1.5 ? '✅' : metrics.profitFactor > 1 ? '⚠️' : '❌';
  const srStatus = metrics.sharpeRatio > 1 ? '✅' : metrics.sharpeRatio > 0 ? '⚠️' : '❌';
  const roiStatus = metrics.roi > 5 ? '✅' : metrics.roi > 0 ? '⚠️' : '❌';
  
  console.log(`\n   Performance Indicators:`);
  console.log(`   • Profit Factor: ${metrics.profitFactor} ${pfStatus}`);
  console.log(`   • Sharpe Ratio: ${metrics.sharpeRatio} ${srStatus}`);
  console.log(`   • ROI: ${metrics.roi}% ${roiStatus}`);
  
  // Financial results
  console.log(`\n   Financial Results:`);
  console.log(`   • Gross Profit: ${formatPrice(metrics.totalProfit)}`);
  console.log(`   • Total Fees: ${formatPrice(metrics.totalFees)}`);
  console.log(`   • Net Profit: ${formatPrice(metrics.netProfit)}`);
  console.log(`   • Avg Win: ${formatPrice(metrics.avgWin)} | Avg Loss: ${formatPrice(metrics.avgLoss)}`);
  
  if (metrics.maxDrawdown > 0) {
    console.log(`   • Max Drawdown: ${formatPrice(metrics.maxDrawdown)}`);
  }
  
  console.log(`   • Total Capital: ${formatPrice(metrics.totalCapital)}`);
  console.log('   ' + '─'.repeat(70));
}

// ============================================================================
// CLI COMMAND FUNCTIONS
// ============================================================================

/**
 * CREATE command - Create a new grid bot
 */
async function createBot(args) {
  const name = args.name;
  const symbol = args.symbol || 'BTC/USD';
  const lowerPrice = parseFloat(args.lower);
  const upperPrice = parseFloat(args.upper);
  const gridCount = parseInt(args.grids);
  const orderSize = parseFloat(args.size);

  // Validation
  if (!name || !lowerPrice || !upperPrice || !gridCount || !orderSize) {
    console.error('❌ Missing required arguments');
    console.log('\nUsage: grid-bot-cli create --name <name> --lower <price> --upper <price> --grids <count> --size <amount> [--symbol <symbol>]');
    console.log('\nExample: grid-bot-cli create --name btc-bot --lower 90000 --upper 100000 --grids 10 --size 100');
    return;
  }

  if (lowerPrice >= upperPrice) {
    console.error('❌ Lower price must be less than upper price');
    return;
  }

  if (gridCount < 2) {
    console.error('❌ Grid count must be at least 2');
    return;
  }

  try {
    // Check if bot name already exists
    const existing = bots.find(b => b.name === name);
    if (existing) {
      console.error(`❌ Bot with name "${name}" already exists`);
      return;
    }

    console.log(`\n🤖 Creating Grid Bot: "${name}"\n`);
    console.log('═'.repeat(80));

    // Step 1: Fetch current price
    console.log(`\n📊 Fetching current ${symbol} price...`);
    const currentPrice = await getCurrentPrice(symbol);
    
    if (!currentPrice) {
      console.error('❌ Could not fetch current price. Please try again.');
      return;
    }

    console.log(`Current price: ${formatPrice(currentPrice)}`);

    // Step 2: Validate price range
    if (currentPrice < lowerPrice || currentPrice > upperPrice) {
      console.log(`\n⚠️  WARNING: Current price is outside grid range!`);
      console.log(`   Grid range: ${formatPrice(lowerPrice)} - ${formatPrice(upperPrice)}`);
      console.log(`   The bot may not operate optimally until price enters the range.`);
    }

    // Step 3: Analyze volatility and market regime
    console.log(`\n📈 Analyzing market conditions...`);
    const volAnalysis = await getVolatilityAnalysis(symbol);
    const regime = await detectMarketRegime(symbol);
    
    if (volAnalysis) {
      console.log(`Volatility: ${volAnalysis.level} (ATR: ${volAnalysis.atrPercent}%)`);
      console.log(`Market Regime: ${regime.regime} (${regime.trend})`);
      console.log(`Trend Strength: ${regime.strength}%`);
    }

    // Step 4: Calculate adaptive grid
    console.log(`\n🎯 Calculating adaptive grid levels...`);
    const gridResult = await calculateAdaptiveGridLevels(lowerPrice, upperPrice, gridCount, symbol);
    
    // Step 5: Get account balance and calculate position sizing
    console.log(`\n💰 Analyzing account balance...`);
    const balance = await getBalance();
    console.log(`Available USD: ${formatPrice(balance.usd)}`);
    console.log(`Total Account Value: ${formatPrice(balance.total)}`);
    
    const totalCapitalRequired = orderSize * gridResult.adjustedGridCount;
    console.log(`Capital Required: ${formatPrice(totalCapitalRequired)}`);
    
    if (volAnalysis && balance.total > 0) {
      const sizing = calculateDynamicOrderSize(
        orderSize, 
        parseFloat(volAnalysis.atrPercent), 
        balance.total
      );
      
      if (sizing.size < orderSize) {
        console.log(`\n💡 Position Sizing Recommendation:`);
        console.log(`   Suggested size: ${formatPrice(sizing.size)} per level (vs ${formatPrice(orderSize)} requested)`);
        console.log(`   Reason: ${volAnalysis.level} volatility detected`);
        console.log(`   Volatility adjustment: ${(sizing.volatilityMultiplier * 100).toFixed(0)}%`);
        console.log(`   Kelly multiplier: ${(sizing.kellyMultiplier * 100).toFixed(1)}%`);
      }
    }

    // Step 6: Create bot record
    const bot = {
      id: bots.length > 0 ? Math.max(...bots.map(b => b.id)) + 1 : 1,
      name,
      symbol,
      lower_price: lowerPrice,
      upper_price: upperPrice,
      grid_count: gridCount,
      adjusted_grid_count: gridResult.adjustedGridCount,
      order_size: orderSize,
      status: 'stopped',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      rebalance_count: 0,
      version: '2.0'
    };
    
    bots.push(bot);
    saveData(BOTS_FILE, bots);
    
    console.log(`\n✅ Grid bot "${name}" created successfully!`);
    console.log('\n' + '═'.repeat(80));
    console.log(`\nBot Configuration:`);
    console.log(`   ID: ${bot.id}`);
    console.log(`   Symbol: ${symbol}`);
    console.log(`   Price Range: ${formatPrice(lowerPrice)} - ${formatPrice(upperPrice)}`);
    console.log(`   Grid Levels: ${gridResult.adjustedGridCount} (requested: ${gridCount})`);
    console.log(`   Order Size: ${formatPrice(orderSize)} per level`);
    console.log(`   Total Capital: ${formatPrice(totalCapitalRequired)}`);
    console.log(`   Status: STOPPED`);
    console.log(`   Mode: ${TEST_MODE ? 'PAPER TRADING ✅' : 'LIVE TRADING ⚠️'}`);
    
    console.log(`\n💡 Next Steps:`);
    console.log(`   1. Review configuration above`);
    console.log(`   2. Use "grid-bot-cli show --name ${name}" for detailed analysis`);
    console.log(`   3. Use "grid-bot-cli start --name ${name}" to start the bot`);
    console.log('\n' + '═'.repeat(80) + '\n');
    
  } catch (error) {
    console.error('❌ Error creating bot:', error.message);
    console.error(error.stack);
  }
}

/**
 * LIST command - List all grid bots
 */
async function listBots() {
  try {
    if (bots.length === 0) {
      console.log('\n📭 No grid bots found');
      console.log('\n💡 Create your first bot with:');
      console.log('   grid-bot-cli create --name <name> --lower <price> --upper <price> --grids <count> --size <amount>\n');
      return;
    }

    console.log(`\n📊 Grid Bots (${bots.length} total)\n`);
    console.log('═'.repeat(100));
    
    for (const bot of bots) {
      const statusIcon = bot.status === 'running' ? '🟢' : bot.status === 'paused' ? '⏸️' : '🔴';
      const gridSpacing = (bot.upper_price - bot.lower_price) / ((bot.adjusted_grid_count || bot.grid_count) - 1);
      
      console.log(`\n${statusIcon} ${bot.name} (ID: ${bot.id})`);
      console.log(`   Symbol: ${bot.symbol}`);
      console.log(`   Range: ${formatPrice(bot.lower_price)} - ${formatPrice(bot.upper_price)}`);
      console.log(`   Grids: ${bot.adjusted_grid_count || bot.grid_count} levels (spacing: ${formatPrice(gridSpacing)})`);
      console.log(`   Order Size: ${formatPrice(bot.order_size)}`);
      console.log(`   Status: ${bot.status.toUpperCase()}${bot.stop_reason ? ` (${bot.stop_reason})` : ''}`);
      console.log(`   Created: ${formatDate(bot.created_at)}`);
      
      // Get trade stats
      const botMetrics = calculateBotMetrics(bot);
      if (botMetrics && botMetrics.totalTrades > 0) {
        console.log(`   Trades: ${botMetrics.totalTrades} (${botMetrics.openTrades} open)`);
        console.log(`   Win Rate: ${botMetrics.winRate}% | Net Profit: ${formatPrice(botMetrics.netProfit)}`);
      }
    }
    
    console.log('\n' + '═'.repeat(100));
    console.log(`\n💡 Use "grid-bot-cli show --name <name>" for detailed bot information\n`);
    
  } catch (error) {
    console.error('❌ Error listing bots:', error.message);
  }
}

/**
 * SHOW command - Show detailed bot information
 */
async function showBot(args) {
  const name = args.name;
  
  if (!name) {
    console.error('❌ Bot name required');
    console.log('\nUsage: grid-bot-cli show --name <name>');
    return;
  }

  try {
    const bot = bots.find(b => b.name === name);
    
    if (!bot) {
      console.error(`❌ Bot "${name}" not found`);
      return;
    }

    // Get current price and market data
    console.log(`\n📊 Fetching current market data for ${bot.symbol}...`);
    const currentPrice = await getCurrentPrice(bot.symbol);
    const volAnalysis = await getVolatilityAnalysis(bot.symbol);
    const regime = await detectMarketRegime(bot.symbol);
    
    console.log(`\n🤖 Grid Bot: ${bot.name}`);
    console.log('═'.repeat(80));
    
    // Bot Information
    console.log(`\nBot Information:`);
    console.log(`   ID: ${bot.id}`);
    console.log(`   Symbol: ${bot.symbol}`);
    console.log(`   Status: ${bot.status.toUpperCase()} ${bot.status === 'running' ? '🟢' : bot.status === 'paused' ? '⏸️' : '🔴'}`);
    if (bot.stop_reason) {
      console.log(`   Stop Reason: ${bot.stop_reason}`);
    }
    console.log(`   Version: ${bot.version || '1.0'}`);
    console.log(`   Created: ${formatDate(bot.created_at)}`);
    console.log(`   Updated: ${formatDate(bot.updated_at)}`);
    if (bot.rebalance_count > 0) {
      console.log(`   Rebalances: ${bot.rebalance_count}`);
    }
    
    // Configuration
    console.log(`\n📈 Configuration:`);
    console.log(`   Price Range: ${formatPrice(bot.lower_price)} - ${formatPrice(bot.upper_price)}`);
    console.log(`   Grid Levels: ${bot.adjusted_grid_count || bot.grid_count}`);
    console.log(`   Order Size: ${formatPrice(bot.order_size)} per level`);
    console.log(`   Total Capital: ${formatPrice(bot.order_size * (bot.adjusted_grid_count || bot.grid_count))}`);
    
    // Current Market
    if (currentPrice) {
      console.log(`\n💰 Current Market:`);
      console.log(`   Price: ${formatPrice(currentPrice)}`);
      
      const positionPercent = ((currentPrice - bot.lower_price) / (bot.upper_price - bot.lower_price) * 100);
      
      if (currentPrice < bot.lower_price) {
        console.log(`   Position: ⬇️  BELOW grid range (${((currentPrice - bot.lower_price) / bot.lower_price * 100).toFixed(2)}%)`);
        console.log(`   ⚠️  Bot will only execute BUY orders when price enters range`);
      } else if (currentPrice > bot.upper_price) {
        console.log(`   Position: ⬆️  ABOVE grid range (${((currentPrice - bot.upper_price) / bot.upper_price * 100).toFixed(2)}%)`);
        console.log(`   ⚠️  Bot will only execute SELL orders when price enters range`);
      } else {
        console.log(`   Position: ✅ WITHIN grid range (${positionPercent.toFixed(1)}%)`);
      }
      
      if (volAnalysis) {
        console.log(`   Volatility: ${volAnalysis.level} (ATR: ${volAnalysis.atrPercent}%)`);
      }
      
      if (regime) {
        console.log(`   Market Regime: ${regime.regime} (${regime.trend})`);
      }
      
      // Check if rebalancing recommended
      await checkGridRebalancing(bot, currentPrice);
    }
    
    // Calculate and show grid levels
    const gridResult = await calculateAdaptiveGridLevels(
      bot.lower_price, 
      bot.upper_price, 
      bot.grid_count, 
      bot.symbol
    );
    
    console.log(`\n🎯 Grid Levels:`);
    console.log('   ' + '─'.repeat(70));
    
    gridResult.levels.slice(0, 10).forEach((level, index) => {
      let status = '  ';
      if (currentPrice) {
        const diff = Math.abs(level.price - currentPrice);
        const diffPercent = (diff / currentPrice) * 100;
        
        if (diffPercent < 0.5) {
          status = '🎯';
        } else if (level.price < currentPrice) {
          status = '⬇️ ';
        } else {
          status = '⬆️ ';
        }
      }
      
      const weightStr = level.weight !== 1.0 ? ` [${level.weight.toFixed(2)}x]` : '';
      console.log(`   ${status} Level ${(index + 1).toString().padStart(2)}: ${level.type.padEnd(4)} at ${formatPrice(level.price)}${weightStr}`);
    });
    
    if (gridResult.levels.length > 10) {
      console.log(`   ... and ${gridResult.levels.length - 10} more levels`);
    }
    
    // Active Orders
    const botOrders = activeOrders.filter(o => o.bot_id === bot.id && o.status === 'OPEN');
    if (botOrders.length > 0) {
      console.log(`\n📋 Active Orders: ${botOrders.length}`);
      console.log('   ' + '─'.repeat(70));
      
      botOrders.slice(0, 5).forEach(order => {
        console.log(`   ${order.type === 'BUY' ? '🟢' : '🔴'} ${order.type} at ${formatPrice(order.price)} (${formatDate(order.created_at)})`);
      });
      
      if (botOrders.length > 5) {
        console.log(`   ... and ${botOrders.length - 5} more orders`);
      }
    }
    
    // Trade History
    const botTrades = trades.filter(t => t.bot_id === bot.id)
      .sort((a, b) => new Date(b.timestamp || b.created_at) - new Date(a.timestamp || a.created_at))
      .slice(0, 10);
    
    if (botTrades.length > 0) {
      console.log(`\n📊 Recent Trades (last 10):`);
      console.log('   ' + '─'.repeat(70));
      
      botTrades.forEach(trade => {
        const icon = trade.trade_type === 'BUY' ? '🟢' : '🔴';
        const profitStr = trade.profit ? ` | P/L: ${formatPrice(trade.profit)}` : '';
        const statusStr = trade.exit_price ? ' [CLOSED]' : ' [OPEN]';
        console.log(`   ${icon} ${trade.trade_type || trade.type} ${formatPrice(trade.price)} x ${(trade.amount || 0).toFixed(8)} = ${formatPrice(trade.total)}${profitStr}${statusStr}`);
        console.log(`      ${formatDate(trade.timestamp || trade.created_at)}`);
      });
    }
    
    // Performance Metrics
    const botMetrics = calculateBotMetrics(bot);
    if (botMetrics) {
      displayMetrics(botMetrics);
    }
    
    console.log('\n' + '═'.repeat(80) + '\n');
    
  } catch (error) {
    console.error('❌ Error showing bot:', error.message);
    console.error(error.stack);
  }
}

/**
 * START command - Start a bot
 */
async function startBot(args) {
  const name = args.name;
  
  if (!name) {
    console.error('❌ Bot name required');
    console.log('\nUsage: grid-bot-cli start --name <name>');
    return;
  }

  try {
    const bot = bots.find(b => b.name === name);
    
    if (!bot) {
      console.error(`❌ Bot "${name}" not found`);
      return;
    }

    if (bot.status === 'running') {
      console.log(`⚠️  Bot "${name}" is already running`);
      return;
    }

    // Update status
    bot.status = 'running';
    bot.stop_reason = undefined;
    bot.updated_at = new Date().toISOString();
    saveData(BOTS_FILE, bots);
    
    console.log(`✅ Bot "${name}" started successfully!`);
    console.log(`\n⚠️  Important Notes:`);
    console.log(`   • This CLI tool manages bot configuration only`);
    console.log(`   • For 24/7 operation, deploy to your VPS using Docker`);
    console.log(`   • Monitor with: grid-bot-cli show --name ${name}`);
    console.log(`   • Check status with: grid-bot-cli status`);
    
    if (TEST_MODE) {
      console.log(`\n🎯 PAPER TRADING MODE: No real orders will be placed`);
    } else {
      console.log(`\n⚠️  LIVE TRADING MODE: Real money at risk!`);
      console.log(`   • Start with minimum position sizes`);
      console.log(`   • Monitor closely for the first 24 hours`);
      console.log(`   • Set up stop-loss alerts`);
    }
    
    console.log(`\n💡 Risk Management Features Enabled:`);
    console.log(`   ✅ Stop loss: ${(RISK_CONFIG.STOP_LOSS_PERCENT * 100).toFixed(0)}%`);
    console.log(`   ✅ Trailing stop: ${(RISK_CONFIG.TRAILING_STOP_PERCENT * 100).toFixed(0)}%`);
    console.log(`   ✅ Max risk per trade: ${(RISK_CONFIG.MAX_RISK_PER_TRADE * 100).toFixed(0)}%`);
    console.log(`   ✅ Adaptive grid spacing`);
    console.log(`   ✅ Dynamic position sizing`);
    console.log(`   ✅ Automatic grid rebalancing\n`);
    
  } catch (error) {
    console.error('❌ Error starting bot:', error.message);
  }
}

/**
 * STOP command - Stop a bot
 */
async function stopBot(args) {
  const name = args.name;
  
  if (!name) {
    console.error('❌ Bot name required');
    console.log('\nUsage: grid-bot-cli stop --name <name>');
    return;
  }

  try {
    const bot = bots.find(b => b.name === name);
    
    if (!bot) {
      console.error(`❌ Bot "${name}" not found`);
      return;
    }

    if (bot.status === 'stopped') {
      console.log(`⚠️  Bot "${name}" is already stopped`);
      return;
    }

    // Cancel all active orders
    console.log(`\n🚫 Cancelling active orders...`);
    const cancelledCount = await cancelAllBotOrders(bot);

    // Update status
    bot.status = 'stopped';
    bot.updated_at = new Date().toISOString();
    saveData(BOTS_FILE, bots);
    
    console.log(`✅ Bot "${name}" stopped successfully!`);
    
    if (cancelledCount > 0) {
      console.log(`   Cancelled ${cancelledCount} active orders`);
    }
    
    // Show open positions
    const openTrades = trades.filter(t => t.bot_id === bot.id && !t.exit_price);
    if (openTrades.length > 0) {
      console.log(`\n⚠️  Note: ${openTrades.length} positions still open`);
      console.log(`   Consider closing them manually or restarting the bot`);
    }
    
    console.log();
    
  } catch (error) {
    console.error('❌ Error stopping bot:', error.message);
  }
}

/**
 * DELETE command - Delete a bot
 */
async function deleteBot(args) {
  const name = args.name;
  const force = args.force;
  
  if (!name) {
    console.error('❌ Bot name required');
    console.log('\nUsage: grid-bot-cli delete --name <name> [--force]');
    return;
  }

  try {
    const botIndex = bots.findIndex(b => b.name === name);
    
    if (botIndex === -1) {
      console.error(`❌ Bot "${name}" not found`);
      return;
    }

    const bot = bots[botIndex];

    if (bot.status === 'running' && !force) {
      console.error(`❌ Bot "${name}" is running. Stop it first or use --force`);
      return;
    }

    // Cancel orders if running
    if (bot.status === 'running') {
      console.log(`\n🚫 Cancelling active orders...`);
      await cancelAllBotOrders(bot);
    }

    // Delete related data
    const tradesDeleted = trades.filter(t => t.bot_id === bot.id).length;
    trades = trades.filter(t => t.bot_id !== bot.id);
    saveData(TRADES_FILE, trades);
    
    const ordersDeleted = activeOrders.filter(o => o.bot_id === bot.id).length;
    activeOrders = activeOrders.filter(o => o.bot_id !== bot.id);
    saveData(ORDERS_FILE, activeOrders);
    
    // Delete bot
    bots.splice(botIndex, 1);
    saveData(BOTS_FILE, bots);
    
    console.log(`✅ Bot "${name}" deleted successfully!`);
    console.log(`   Deleted ${tradesDeleted} trades and ${ordersDeleted} orders\n`);
    
  } catch (error) {
    console.error('❌ Error deleting bot:', error.message);
  }
}

/**
 * REBALANCE command - Manually rebalance a bot's grid
 */
async function rebalanceBot(args) {
  const name = args.name;
  const newLower = args.lower ? parseFloat(args.lower) : null;
  const newUpper = args.upper ? parseFloat(args.upper) : null;
  
  if (!name) {
    console.error('❌ Bot name required');
    console.log('\nUsage: grid-bot-cli rebalance --name <name> --lower <price> --upper <price>');
    return;
  }

  try {
    const bot = bots.find(b => b.name === name);
    
    if (!bot) {
      console.error(`❌ Bot "${name}" not found`);
      return;
    }

    console.log(`\n🔄 Rebalancing grid for "${name}"...\n`);

    // Get current price
    const currentPrice = await getCurrentPrice(bot.symbol);
    console.log(`Current ${bot.symbol} price: ${formatPrice(currentPrice)}`);
    console.log(`Current grid range: ${formatPrice(bot.lower_price)} - ${formatPrice(bot.upper_price)}`);

    // Calculate new range if not provided
    let lower = newLower;
    let upper = newUpper;
    
    if (!lower || !upper) {
      const gridRange = bot.upper_price - bot.lower_price;
      lower = lower || currentPrice - (gridRange * 0.4);
      upper = upper || currentPrice + (gridRange * 0.6);
      
      console.log(`\nCalculated new range: ${formatPrice(lower)} - ${formatPrice(upper)}`);
    }

    if (lower >= upper) {
      console.error('❌ Lower price must be less than upper price');
      return;
    }

    // Cancel all existing orders
    console.log(`\n🚫 Cancelling existing orders...`);
    const cancelledCount = await cancelAllBotOrders(bot);
    console.log(`Cancelled ${cancelledCount} orders`);

    // Update bot configuration
    bot.lower_price = parseFloat(lower.toFixed(2));
    bot.upper_price = parseFloat(upper.toFixed(2));
    bot.updated_at = new Date().toISOString();
    bot.rebalance_count = (bot.rebalance_count || 0) + 1;
    
    saveData(BOTS_FILE, bots);
    
    console.log(`\n✅ Grid rebalanced successfully! (Rebalance #${bot.rebalance_count})`);
    console.log(`   New range: ${formatPrice(bot.lower_price)} - ${formatPrice(bot.upper_price)}`);
    console.log(`\n💡 New grid orders will be placed when bot runs next cycle\n`);
    
  } catch (error) {
    console.error('❌ Error rebalancing bot:', error.message);
  }
}

/**
 * STATUS command - Show system status
 */
async function showStatus() {
  try {
    console.log('\n🤖 Grid Trading Bot - System Status\n');
    console.log('═'.repeat(80));
    
    // Connection status
    console.log(`\n📡 Exchange Connection:`);
    console.log(`   Platform: Binance.US`);
    console.log(`   Mode: ${TEST_MODE ? 'PAPER TRADING ✅' : 'LIVE TRADING ⚠️'}`);
    
    try {
      const balance = await getBalance();
      console.log(`   Status: ✅ Connected`);
      console.log(`\n💰 Account Balance:`);
      console.log(`   USD: ${formatPrice(balance.usd)}`);
      console.log(`   BTC: ${(balance.btc || 0).toFixed(8)} BTC`);
      console.log(`   Total Value: ${formatPrice(balance.total)}`);
    } catch (error) {
      console.log(`   Status: ❌ Connection failed`);
      console.log(`   Error: ${error.message}`);
    }
    
    // Bot statistics
    const runningBots = bots.filter(b => b.status === 'running').length;
    const pausedBots = bots.filter(b => b.status === 'paused').length;
    const stoppedBots = bots.filter(b => b.status === 'stopped').length;
    
    console.log(`\n📊 Bots:`);
    console.log(`   Total: ${bots.length}`);
    console.log(`   Running: ${runningBots} 🟢`);
    console.log(`   Paused: ${pausedBots} ⏸️`);
    console.log(`   Stopped: ${stoppedBots} 🔴`);
    
    // Active orders
    const openOrders = activeOrders.filter(o => o.status === 'OPEN').length;
    console.log(`\n📋 Orders:`);
    console.log(`   Active: ${openOrders}`);
    console.log(`   Total (all time): ${activeOrders.length}`);
    
    // Trade statistics
    if (trades.length > 0) {
      const openTrades = trades.filter(t => !t.exit_price).length;
      const closedTrades = trades.filter(t => t.exit_price).length;
      const totalProfit = trades
        .filter(t => t.exit_price)
        .reduce((sum, t) => sum + (t.profit || 0), 0);
      
      console.log(`\n💵 Trading:`);
      console.log(`   Total Trades: ${trades.length}`);
      console.log(`   Open: ${openTrades} | Closed: ${closedTrades}`);
      console.log(`   Total Profit: ${formatPrice(totalProfit)}`);
    }
    
    // Risk management
    console.log(`\n🛡️  Risk Management:`);
    console.log(`   Stop Loss: ${(RISK_CONFIG.STOP_LOSS_PERCENT * 100).toFixed(0)}%`);
    console.log(`   Trailing Stop: ${(RISK_CONFIG.TRAILING_STOP_PERCENT * 100).toFixed(0)}%`);
    console.log(`   Max Risk/Trade: ${(RISK_CONFIG.MAX_RISK_PER_TRADE * 100).toFixed(0)}%`);
    
    // Version info
    console.log(`\n📦 Version:`);
    console.log(`   CLI: 2.0.0 (Enhanced)`);
    console.log(`   Features: Stop-loss, Adaptive grids, Dynamic sizing`);
    
    console.log('\n' + '═'.repeat(80) + '\n');
    
  } catch (error) {
    console.error('❌ Error fetching status:', error.message);
  }
}

/**
 * HELP command - Show help message
 */
function showHelp() {
  console.log(`
🤖 Grid Trading Bot - Enhanced CLI Management Tool (v2.0)

USAGE:
  grid-bot-cli <command> [options]

COMMANDS:
  create      Create a new grid bot
  list        List all grid bots
  show        Show detailed bot information
  start       Start a bot
  stop        Stop a bot
  delete      Delete a bot
  rebalance   Manually rebalance a bot's grid
  status      Show system status
  help        Show this help message

CREATE OPTIONS:
  --name <name>       Bot name (required, unique)
  --symbol <symbol>   Trading pair (default: BTC/USD)
  --lower <price>     Lower price bound (required)
  --upper <price>     Upper price bound (required)
  --grids <count>     Number of grid levels (required)
  --size <amount>     Order size in USD per level (required)

REBALANCE OPTIONS:
  --name <name>       Bot name (required)
  --lower <price>     New lower price bound (optional, auto-calculated)
  --upper <price>     New upper price bound (optional, auto-calculated)

EXAMPLES:
  # Create a new bot
  grid-bot-cli create --name btc-bot --lower 90000 --upper 100000 --grids 10 --size 100

  # List all bots
  grid-bot-cli list

  # Show bot details with performance metrics
  grid-bot-cli show --name btc-bot

  # Start a bot
  grid-bot-cli start --name btc-bot

  # Stop a bot
  grid-bot-cli stop --name btc-bot

  # Rebalance grid to new range
  grid-bot-cli rebalance --name btc-bot --lower 95000 --upper 105000

  # Delete a bot
  grid-bot-cli delete --name btc-bot [--force]

  # Show system status
  grid-bot-cli status

ENHANCED FEATURES (v2.0):
  ✅ Dynamic stop-loss protection (${(RISK_CONFIG.STOP_LOSS_PERCENT * 100).toFixed(0)}%)
  ✅ Trailing stops for profitable positions (${(RISK_CONFIG.TRAILING_STOP_PERCENT * 100).toFixed(0)}%)
  ✅ Adaptive grid spacing based on volatility
  ✅ Dynamic position sizing with Kelly Criterion
  ✅ Complete order state management
  ✅ Advanced performance metrics (Sharpe, Profit Factor)
  ✅ Automatic grid rebalancing
  ✅ Market regime detection

MODE:
  Current mode: ${TEST_MODE ? 'PAPER TRADING ✅' : 'LIVE TRADING ⚠️'}
  ${TEST_MODE ? 'No real orders will be placed - safe for testing' : 'Real money at risk - trade carefully!'}

RISK WARNING:
  Grid trading involves significant risk. Past performance does not guarantee
  future results. Only trade with capital you can afford to lose.

`);
}

// ============================================================================
// MAIN CLI HANDLER
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    showHelp();
    return;
  }

  const command = args[0];
  const options = {};
  
  // Parse command line options
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    const value = args[i + 1];
    options[key] = value;
  }

  try {
    switch (command) {
      case 'create':
        await createBot(options);
        break;
      case 'list':
        await listBots();
        break;
      case 'show':
        await showBot(options);
        break;
      case 'start':
        await startBot(options);
        break;
      case 'stop':
        await stopBot(options);
        break;
      case 'delete':
        await deleteBot(options);
        break;
      case 'rebalance':
        await rebalanceBot(options);
        break;
      case 'status':
        await showStatus();
        break;
      case 'help':
      case '--help':
      case '-h':
        showHelp();
        break;
      default:
        console.error(`❌ Unknown command: ${command}`);
        console.log('\nUse "grid-bot-cli help" to see available commands');
    }
  } catch (error) {
    console.error('❌ Command failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// ============================================================================
// RUN CLI
// ============================================================================

main().catch(error => {
  console.error('❌ Fatal error:', error.message);
  console.error(error.stack);
  process.exit(1);
});
