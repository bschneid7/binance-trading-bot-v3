#!/usr/bin/env node

/**
 * Daily SOL Bot Status Report
 * Version: 1.0.0
 * 
 * Generates a daily status report for the live-sol-bot including:
 * - Bot running status
 * - Current price and grid position
 * - P&L summary (24h and all-time)
 * - Trade activity
 * - Open orders
 */

import Database from 'better-sqlite3';
import ccxt from 'ccxt';
import { execSync } from 'child_process';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env.production') });

const BOT_NAME = 'live-sol-bot';
const SYMBOL = 'SOL/USD';

/**
 * Initialize database connection
 */
function initDatabase() {
  const dbPath = path.join(__dirname, 'data', 'grid-bot.db');
  return new Database(dbPath, { readonly: true });
}

/**
 * Initialize exchange connection
 */
function initExchange() {
  return new ccxt.binanceus({
    apiKey: process.env.BINANCE_API_KEY,
    secret: process.env.BINANCE_API_SECRET,
  });
}

/**
 * Check if the bot service is running
 */
function checkServiceStatus() {
  try {
    const result = execSync('systemctl is-active grid-bot-sol', { encoding: 'utf8' }).trim();
    return result === 'active';
  } catch (e) {
    return false;
  }
}

/**
 * Get bot configuration from database
 */
function getBotConfig(db) {
  const stmt = db.prepare('SELECT * FROM bots WHERE name = ?');
  return stmt.get(BOT_NAME);
}

/**
 * Get trade statistics
 */
function getTradeStats(db) {
  const now = Date.now();
  const oneDayAgo = now - (24 * 60 * 60 * 1000);
  
  // All-time stats
  const allTimeStmt = db.prepare(`
    SELECT 
      COUNT(*) as total_trades,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as winning_trades,
      SUM(pnl) as total_pnl,
      SUM(fee) as total_fees
    FROM trades 
    WHERE bot_name = ?
  `);
  const allTime = allTimeStmt.get(BOT_NAME) || { total_trades: 0, winning_trades: 0, total_pnl: 0, total_fees: 0 };
  
  // 24h stats
  const dailyStmt = db.prepare(`
    SELECT 
      COUNT(*) as trades_24h,
      SUM(pnl) as pnl_24h,
      SUM(fee) as fees_24h
    FROM trades 
    WHERE bot_name = ? AND timestamp > ?
  `);
  const daily = dailyStmt.get(BOT_NAME, oneDayAgo) || { trades_24h: 0, pnl_24h: 0, fees_24h: 0 };
  
  // Recent trades
  const recentStmt = db.prepare(`
    SELECT side, price, amount, pnl, timestamp
    FROM trades 
    WHERE bot_name = ?
    ORDER BY timestamp DESC
    LIMIT 5
  `);
  const recentTrades = recentStmt.all(BOT_NAME);
  
  return {
    allTime: {
      totalTrades: allTime.total_trades || 0,
      winningTrades: allTime.winning_trades || 0,
      winRate: allTime.total_trades > 0 ? (allTime.winning_trades / allTime.total_trades * 100) : 0,
      totalPnl: allTime.total_pnl || 0,
      totalFees: allTime.total_fees || 0,
    },
    daily: {
      trades: daily.trades_24h || 0,
      pnl: daily.pnl_24h || 0,
      fees: daily.fees_24h || 0,
    },
    recentTrades,
  };
}

/**
 * Get open orders count
 */
async function getOpenOrders(exchange) {
  try {
    const orders = await exchange.fetchOpenOrders(SYMBOL);
    const buyOrders = orders.filter(o => o.side === 'buy');
    const sellOrders = orders.filter(o => o.side === 'sell');
    return {
      total: orders.length,
      buy: buyOrders.length,
      sell: sellOrders.length,
    };
  } catch (e) {
    return { total: 0, buy: 0, sell: 0, error: e.message };
  }
}

/**
 * Get current price and calculate grid position
 */
async function getPriceAndPosition(exchange, bot) {
  try {
    const ticker = await exchange.fetchTicker(SYMBOL);
    const currentPrice = ticker.last;
    const gridRange = bot.upper_price - bot.lower_price;
    const positionInGrid = ((currentPrice - bot.lower_price) / gridRange) * 100;
    
    return {
      currentPrice,
      bid: ticker.bid,
      ask: ticker.ask,
      positionInGrid: Math.max(0, Math.min(100, positionInGrid)),
      isWithinGrid: currentPrice >= bot.lower_price && currentPrice <= bot.upper_price,
    };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Format the report as text
 */
function formatReport(data) {
  const { serviceRunning, bot, price, orders, stats, timestamp } = data;
  
  const lines = [
    '═══════════════════════════════════════════════════════════',
    '       DAILY SOL BOT STATUS REPORT',
    '═══════════════════════════════════════════════════════════',
    '',
    `📅 Report Date: ${new Date(timestamp).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PST`,
    '',
    '📊 BOT STATUS:',
    `   Service: ${serviceRunning ? '🟢 Running' : '🔴 Stopped'}`,
    `   Symbol: ${SYMBOL}`,
    `   Grid Range: $${bot.lower_price.toFixed(2)} - $${bot.upper_price.toFixed(2)}`,
    '',
  ];
  
  if (price.currentPrice) {
    lines.push(
      '💰 CURRENT PRICE:',
      `   Price: $${price.currentPrice.toFixed(2)}`,
      `   Bid/Ask: $${price.bid?.toFixed(2)} / $${price.ask?.toFixed(2)}`,
      `   Grid Position: ${price.positionInGrid.toFixed(1)}%`,
      `   Within Grid: ${price.isWithinGrid ? '✅ Yes' : '⚠️ No'}`,
      ''
    );
  }
  
  lines.push(
    '📈 OPEN ORDERS:',
    `   Total: ${orders.total}`,
    `   Buy Orders: ${orders.buy}`,
    `   Sell Orders: ${orders.sell}`,
    ''
  );
  
  lines.push(
    '💵 P&L SUMMARY:',
    `   24h Trades: ${stats.daily.trades}`,
    `   24h P&L: $${stats.daily.pnl?.toFixed(2) || '0.00'}`,
    `   24h Fees: $${stats.daily.fees?.toFixed(2) || '0.00'}`,
    '',
    `   All-Time Trades: ${stats.allTime.totalTrades}`,
    `   All-Time P&L: $${stats.allTime.totalPnl?.toFixed(2) || '0.00'}`,
    `   Win Rate: ${stats.allTime.winRate.toFixed(1)}%`,
    `   Total Fees: $${stats.allTime.totalFees?.toFixed(2) || '0.00'}`,
    ''
  );
  
  if (stats.recentTrades && stats.recentTrades.length > 0) {
    lines.push('📝 RECENT TRADES:');
    stats.recentTrades.forEach(trade => {
      const time = new Date(trade.timestamp).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
      const pnlStr = trade.pnl ? `P&L: $${trade.pnl.toFixed(2)}` : '';
      lines.push(`   ${trade.side.toUpperCase()} ${trade.amount} @ $${trade.price.toFixed(2)} ${pnlStr}`);
    });
    lines.push('');
  }
  
  lines.push('═══════════════════════════════════════════════════════════');
  
  return lines.join('\n');
}

/**
 * Main function to generate the report
 */
async function generateReport() {
  console.log('Generating daily SOL bot status report...\n');
  
  const db = initDatabase();
  const exchange = initExchange();
  
  try {
    // Gather all data
    const serviceRunning = checkServiceStatus();
    const bot = getBotConfig(db);
    
    if (!bot) {
      console.error('❌ Bot not found in database:', BOT_NAME);
      process.exit(1);
    }
    
    const price = await getPriceAndPosition(exchange, bot);
    const orders = await getOpenOrders(exchange);
    const stats = getTradeStats(db);
    
    const reportData = {
      timestamp: Date.now(),
      serviceRunning,
      bot,
      price,
      orders,
      stats,
    };
    
    // Format and output the report
    const report = formatReport(reportData);
    console.log(report);
    
    // Return data for email sending
    return { report, data: reportData };
    
  } finally {
    db.close();
  }
}

// Run if called directly
generateReport().catch(console.error);

export { generateReport };
