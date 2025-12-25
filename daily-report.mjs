#!/usr/bin/env node

/**
 * Daily Comprehensive Bot Status Report
 * Version: 1.0.0
 * 
 * Generates a daily status report for ALL trading bots (BTC, ETH, SOL) including:
 * - Bot running status for each
 * - Current prices and grid positions
 * - P&L summary (24h and all-time)
 * - Trade activity
 * - Open orders
 * - Dip Buyer status
 */

import Database from 'better-sqlite3';
import ccxt from 'ccxt';
import { execSync } from 'child_process';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env.production') });

// Bot configurations
const BOTS = [
  { name: 'live-btc-bot', symbol: 'BTC/USD', service: 'grid-bot-btc' },
  { name: 'live-eth-bot', symbol: 'ETH/USD', service: 'grid-bot-eth' },
  { name: 'live-sol-bot', symbol: 'SOL/USD', service: 'grid-bot-sol' },
];

const EMAIL_TO = 'bschneid7@gmail.com';

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
 * Check if a bot service is running
 */
function checkServiceStatus(serviceName) {
  try {
    const result = execSync(`systemctl is-active ${serviceName}`, { encoding: 'utf8' }).trim();
    return result === 'active';
  } catch (e) {
    return false;
  }
}

/**
 * Check dip buyer service status
 */
function checkDipBuyerStatus() {
  try {
    const result = execSync('systemctl is-active dip-buyer', { encoding: 'utf8' }).trim();
    return result === 'active';
  } catch (e) {
    return false;
  }
}

/**
 * Get bot configuration from database
 */
function getBotConfig(db, botName) {
  const stmt = db.prepare('SELECT * FROM bots WHERE name = ?');
  return stmt.get(botName);
}

/**
 * Get trade statistics for a bot
 * Uses price-sorted matching to calculate P&L (same as health-check.mjs)
 */
function getTradeStats(db, botName) {
  // Get timestamp for 24 hours ago (SQLite format)
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayStr = yesterday.toISOString().replace('T', ' ').slice(0, 19);
  
  // All-time trades
  const allTimeStmt = db.prepare(`
    SELECT side, price, amount, value, fee
    FROM trades 
    WHERE bot_name = ?
    ORDER BY timestamp ASC
  `);
  const allTimeTrades = allTimeStmt.all(botName);
  const allTimeStats = calculatePnL(allTimeTrades);
  
  // 24h trades
  const dailyStmt = db.prepare(`
    SELECT side, price, amount, value, fee
    FROM trades 
    WHERE bot_name = ? AND timestamp >= ?
    ORDER BY timestamp ASC
  `);
  const dailyTrades = dailyStmt.all(botName, yesterdayStr);
  const dailyStats = calculatePnL(dailyTrades);
  
  return {
    allTime: {
      totalTrades: allTimeStats.totalTrades,
      buys: allTimeStats.buys,
      sells: allTimeStats.sells,
      cycles: allTimeStats.cycles,
      winningTrades: allTimeStats.wins,
      winRate: allTimeStats.winRate,
      totalPnl: allTimeStats.pnl,
      totalFees: allTimeStats.fees,
    },
    daily: {
      trades: dailyStats.totalTrades,
      buys: dailyStats.buys,
      sells: dailyStats.sells,
      cycles: dailyStats.cycles,
      pnl: dailyStats.pnl,
      fees: dailyStats.fees,
    },
  };
}

/**
 * Calculate P&L from trades using price-sorted matching
 * (same algorithm as health-check.mjs and weekly-report.mjs)
 */
function calculatePnL(trades) {
  if (!trades || trades.length === 0) {
    return { totalTrades: 0, buys: 0, sells: 0, cycles: 0, pnl: 0, fees: 0, wins: 0, winRate: 0 };
  }
  
  const buys = [];
  const sells = [];
  let totalFees = 0;
  
  for (const trade of trades) {
    totalFees += trade.fee || 0;
    if (trade.side === 'buy') {
      buys.push({ price: trade.price, amount: trade.amount });
    } else if (trade.side === 'sell') {
      sells.push({ price: trade.price, amount: trade.amount });
    }
  }
  
  // Sort by price ascending
  buys.sort((a, b) => a.price - b.price);
  sells.sort((a, b) => a.price - b.price);
  
  // Match lowest buys with lowest sells
  let realizedPnL = 0;
  let wins = 0;
  const completedCycles = Math.min(buys.length, sells.length);
  
  for (let i = 0; i < completedCycles; i++) {
    const buy = buys[i];
    const sell = sells[i];
    const matchedAmount = Math.min(buy.amount, sell.amount);
    const profit = (sell.price - buy.price) * matchedAmount;
    realizedPnL += profit;
    if (profit > 0) wins++;
  }
  
  realizedPnL -= totalFees;
  const winRate = completedCycles > 0 ? (wins / completedCycles) * 100 : 0;
  
  return {
    totalTrades: trades.length,
    buys: buys.length,
    sells: sells.length,
    cycles: completedCycles,
    pnl: parseFloat(realizedPnL.toFixed(2)),
    fees: parseFloat(totalFees.toFixed(4)),
    wins,
    winRate: parseFloat(winRate.toFixed(1)),
  };
}

/**
 * Get open orders for a symbol
 */
async function getOpenOrders(exchange, symbol) {
  try {
    const orders = await exchange.fetchOpenOrders(symbol);
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
async function getPriceAndPosition(exchange, symbol, bot) {
  try {
    const ticker = await exchange.fetchTicker(symbol);
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
 * Get dip buyer positions
 */
function getDipBuyerPositions(db) {
  try {
    const stmt = db.prepare(`
      SELECT symbol, tier, entry_price, amount, status, timestamp
      FROM dip_positions
      WHERE status = 'open'
      ORDER BY timestamp DESC
    `);
    return stmt.all();
  } catch (e) {
    return [];
  }
}

/**
 * Format the report as text
 */
function formatReport(data) {
  const { bots, dipBuyer, totals, timestamp } = data;
  
  const lines = [
    '═══════════════════════════════════════════════════════════════════════',
    '              DAILY COMPREHENSIVE BOT STATUS REPORT',
    '═══════════════════════════════════════════════════════════════════════',
    '',
    `📅 Report Date: ${new Date(timestamp).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PST`,
    '',
  ];
  
  // Summary section
  lines.push(
    '┌─────────────────────────────────────────────────────────────────────┐',
    '│                         SUMMARY                                     │',
    '└─────────────────────────────────────────────────────────────────────┘',
    '',
    `   📊 Total 24h P&L:     $${totals.daily.pnl.toFixed(2)}`,
    `   📊 Total 24h Trades:  ${totals.daily.trades}`,
    `   📊 All-Time P&L:      $${totals.allTime.pnl.toFixed(2)}`,
    `   📊 All-Time Trades:   ${totals.allTime.trades}`,
    ''
  );
  
  // Individual bot sections
  for (const bot of bots) {
    const statusIcon = bot.serviceRunning ? '🟢' : '🔴';
    const statusText = bot.serviceRunning ? 'Running' : 'Stopped';
    
    lines.push(
      '┌─────────────────────────────────────────────────────────────────────┐',
      `│  ${bot.symbol.padEnd(10)} ${statusIcon} ${statusText.padEnd(10)}                                    │`,
      '└─────────────────────────────────────────────────────────────────────┘',
      ''
    );
    
    if (bot.config) {
      lines.push(
        `   Grid Range: $${bot.config.lower_price.toLocaleString()} - $${bot.config.upper_price.toLocaleString()}`,
      );
    }
    
    if (bot.price && bot.price.currentPrice) {
      lines.push(
        `   Current Price: $${bot.price.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        `   Grid Position: ${bot.price.positionInGrid.toFixed(1)}% ${bot.price.isWithinGrid ? '✅' : '⚠️ Outside Grid'}`,
      );
    }
    
    lines.push(
      `   Open Orders: ${bot.orders.total} (${bot.orders.buy} buy / ${bot.orders.sell} sell)`,
      '',
      `   24h Stats:`,
      `      Trades: ${bot.stats.daily.trades} (${bot.stats.daily.buys} buys / ${bot.stats.daily.sells} sells)`,
      `      Cycles: ${bot.stats.daily.cycles} completed`,
      `      P&L: $${(bot.stats.daily.pnl || 0).toFixed(2)}`,
      `      Fees: $${(bot.stats.daily.fees || 0).toFixed(2)}`,
      '',
      `   All-Time Stats:`,
      `      Trades: ${bot.stats.allTime.totalTrades} (${bot.stats.allTime.buys} buys / ${bot.stats.allTime.sells} sells)`,
      `      Cycles: ${bot.stats.allTime.cycles} completed`,
      `      P&L: $${(bot.stats.allTime.totalPnl || 0).toFixed(2)}`,
      `      Win Rate: ${bot.stats.allTime.winRate.toFixed(1)}%`,
      ''
    );
  }
  
  // Dip Buyer section
  lines.push(
    '┌─────────────────────────────────────────────────────────────────────┐',
    `│  DIP BUYER     ${dipBuyer.running ? '🟢 Running' : '🔴 Stopped'}                                       │`,
    '└─────────────────────────────────────────────────────────────────────┘',
    ''
  );
  
  if (dipBuyer.positions && dipBuyer.positions.length > 0) {
    lines.push('   Open Positions:');
    for (const pos of dipBuyer.positions) {
      lines.push(`      ${pos.symbol} Tier ${pos.tier}: ${pos.amount} @ $${pos.entry_price.toFixed(2)}`);
    }
  } else {
    lines.push('   No open positions');
  }
  lines.push('');
  
  lines.push('═══════════════════════════════════════════════════════════════════════');
  
  return lines.join('\n');
}

/**
 * Send email report
 */
async function sendEmail(report) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
  
  const today = new Date().toLocaleDateString('en-US', { 
    timeZone: 'America/Los_Angeles',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: EMAIL_TO,
    subject: `📊 Daily Bot Report - ${today}`,
    text: report,
  };
  
  try {
    await transporter.sendMail(mailOptions);
    console.log('✅ Email sent successfully to', EMAIL_TO);
    return true;
  } catch (error) {
    console.error('❌ Failed to send email:', error.message);
    return false;
  }
}

/**
 * Main function to generate the report
 */
async function generateReport(options = { sendEmail: true }) {
  console.log('Generating daily comprehensive bot status report...\n');
  
  const db = initDatabase();
  const exchange = initExchange();
  
  try {
    const botsData = [];
    const totals = {
      daily: { trades: 0, pnl: 0, fees: 0 },
      allTime: { trades: 0, pnl: 0 },
    };
    
    // Gather data for each bot
    for (const botInfo of BOTS) {
      const serviceRunning = checkServiceStatus(botInfo.service);
      const config = getBotConfig(db, botInfo.name);
      const stats = getTradeStats(db, botInfo.name);
      const orders = await getOpenOrders(exchange, botInfo.symbol);
      
      let price = {};
      if (config) {
        price = await getPriceAndPosition(exchange, botInfo.symbol, config);
      }
      
      // Accumulate totals
      totals.daily.trades += stats.daily.trades;
      totals.daily.pnl += stats.daily.pnl || 0;
      totals.daily.fees += stats.daily.fees || 0;
      totals.allTime.trades += stats.allTime.totalTrades;
      totals.allTime.pnl += stats.allTime.totalPnl || 0;
      
      botsData.push({
        ...botInfo,
        serviceRunning,
        config,
        stats,
        orders,
        price,
      });
    }
    
    // Dip buyer data
    const dipBuyerRunning = checkDipBuyerStatus();
    const dipPositions = getDipBuyerPositions(db);
    
    const reportData = {
      timestamp: Date.now(),
      bots: botsData,
      dipBuyer: {
        running: dipBuyerRunning,
        positions: dipPositions,
      },
      totals,
    };
    
    // Format and output the report
    const report = formatReport(reportData);
    console.log(report);
    
    // Send email if requested
    if (options.sendEmail) {
      await sendEmail(report);
    }
    
    // Return data for programmatic use
    return { report, data: reportData };
    
  } finally {
    db.close();
  }
}

// Run if called directly
const args = process.argv.slice(2);
const skipEmail = args.includes('--no-email');

generateReport({ sendEmail: !skipEmail }).catch(console.error);

export { generateReport };
