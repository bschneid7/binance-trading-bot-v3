#!/usr/bin/env node

/**
 * Grid Trading Bot - Real-Time Performance Dashboard
 * 
 * Provides a live terminal-based dashboard showing:
 * - Real-time P&L tracking
 * - Order status and fill rates
 * - Performance metrics (Sharpe ratio, win rate, profit factor)
 * - Grid visualization
 * - Historical trade analysis
 */

import ccxt from 'ccxt';
import dotenv from 'dotenv';
import { getDatabase, closeDatabase } from './database.mjs';

dotenv.config({ path: '.env.production' });

const db = getDatabase();

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
};

// Clear screen and move cursor to top
function clearScreen() {
  process.stdout.write('\x1b[2J\x1b[H');
}

// Format currency
function formatCurrency(value, decimals = 2) {
  const formatted = Math.abs(value).toFixed(decimals);
  if (value >= 0) {
    return `${colors.green}$${formatted}${colors.reset}`;
  }
  return `${colors.red}-$${formatted}${colors.reset}`;
}

// Format percentage
function formatPercent(value, decimals = 2) {
  const formatted = Math.abs(value).toFixed(decimals);
  if (value >= 0) {
    return `${colors.green}+${formatted}%${colors.reset}`;
  }
  return `${colors.red}-${formatted}%${colors.reset}`;
}

// Create a progress bar
function progressBar(value, max, width = 20, filled = '█', empty = '░') {
  const percent = Math.min(Math.max(value / max, 0), 1);
  const filledCount = Math.round(percent * width);
  const emptyCount = width - filledCount;
  return filled.repeat(filledCount) + empty.repeat(emptyCount);
}

// Initialize exchange
function initExchange() {
  const apiKey = process.env.BINANCE_API_KEY;
  const secret = process.env.BINANCE_API_SECRET;

  if (!apiKey || !secret) {
    console.error('❌ Error: BINANCE_API_KEY and BINANCE_API_SECRET must be set');
    process.exit(1);
  }

  return new ccxt.binanceus({
    apiKey,
    secret,
    enableRateLimit: true,
    options: {
      defaultType: 'spot',
      adjustForTimeDifference: true,
    },
  });
}

// Calculate real-time P&L for a bot
async function calculateRealTimePnL(bot, exchange, currentPrice) {
  const trades = db.getTrades(bot.name);
  
  let realizedPnL = 0;
  let totalBuyCost = 0;
  let totalBuyAmount = 0;
  let totalSellRevenue = 0;
  let totalSellAmount = 0;
  
  for (const trade of trades) {
    if (trade.side === 'buy') {
      totalBuyCost += trade.value;
      totalBuyAmount += trade.amount;
    } else {
      totalSellRevenue += trade.value;
      totalSellAmount += trade.amount;
    }
  }
  
  // Calculate realized P&L from completed round trips
  const completedAmount = Math.min(totalBuyAmount, totalSellAmount);
  if (completedAmount > 0 && totalBuyAmount > 0) {
    const avgBuyPrice = totalBuyCost / totalBuyAmount;
    const avgSellPrice = totalSellRevenue / totalSellAmount;
    realizedPnL = (avgSellPrice - avgBuyPrice) * completedAmount;
  }
  
  // Calculate unrealized P&L from open positions
  const openPosition = totalBuyAmount - totalSellAmount;
  const unrealizedPnL = openPosition > 0 
    ? (currentPrice - (totalBuyCost / totalBuyAmount)) * openPosition 
    : 0;
  
  return {
    realizedPnL,
    unrealizedPnL,
    totalPnL: realizedPnL + unrealizedPnL,
    openPosition,
    totalTrades: trades.length,
  };
}

// Get order distribution for grid visualization
function getOrderDistribution(bot, orders, currentPrice) {
  const gridSpacing = (bot.upper_price - bot.lower_price) / bot.adjusted_grid_count;
  const levels = [];
  
  for (let i = 0; i <= bot.adjusted_grid_count; i++) {
    const price = bot.lower_price + (i * gridSpacing);
    const ordersAtLevel = orders.filter(o => 
      Math.abs(o.price - price) < gridSpacing * 0.1
    );
    
    levels.push({
      price,
      buyOrders: ordersAtLevel.filter(o => o.side === 'buy').length,
      sellOrders: ordersAtLevel.filter(o => o.side === 'sell').length,
      isCurrent: currentPrice >= price && currentPrice < price + gridSpacing,
    });
  }
  
  return levels;
}

// Render the dashboard header
function renderHeader() {
  const now = new Date().toISOString();
  console.log(`${colors.bright}${colors.cyan}╔════════════════════════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}║${colors.reset}          ${colors.bright}GRID TRADING BOT - PERFORMANCE DASHBOARD${colors.reset}                          ${colors.cyan}║${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}║${colors.reset}          ${colors.dim}Last Updated: ${now}${colors.reset}                   ${colors.cyan}║${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}╚════════════════════════════════════════════════════════════════════════════════╝${colors.reset}`);
  console.log();
}

// Render bot summary card
function renderBotCard(bot, pnl, metrics, currentPrice, orders) {
  const statusColor = bot.status === 'running' ? colors.green : colors.red;
  const statusIcon = bot.status === 'running' ? '●' : '○';
  
  console.log(`${colors.bright}┌─────────────────────────────────────────────────────────────────────────────────┐${colors.reset}`);
  console.log(`${colors.bright}│${colors.reset} ${statusColor}${statusIcon}${colors.reset} ${colors.bright}${bot.name.toUpperCase()}${colors.reset} (${bot.symbol})                                                          ${colors.bright}│${colors.reset}`);
  console.log(`${colors.bright}├─────────────────────────────────────────────────────────────────────────────────┤${colors.reset}`);
  
  // Price and Range
  const pricePosition = ((currentPrice - bot.lower_price) / (bot.upper_price - bot.lower_price) * 100).toFixed(1);
  console.log(`${colors.bright}│${colors.reset} Current Price: ${colors.bright}$${currentPrice.toFixed(2)}${colors.reset}  │  Grid Range: $${bot.lower_price.toFixed(0)} - $${bot.upper_price.toFixed(0)}  │  Position: ${pricePosition}%  ${colors.bright}│${colors.reset}`);
  
  // P&L Section
  console.log(`${colors.bright}├─────────────────────────────────────────────────────────────────────────────────┤${colors.reset}`);
  console.log(`${colors.bright}│${colors.reset} ${colors.bright}P&L Summary:${colors.reset}                                                                      ${colors.bright}│${colors.reset}`);
  console.log(`${colors.bright}│${colors.reset}   Realized P&L:   ${formatCurrency(pnl.realizedPnL).padEnd(25)}  Unrealized P&L: ${formatCurrency(pnl.unrealizedPnL).padEnd(20)} ${colors.bright}│${colors.reset}`);
  console.log(`${colors.bright}│${colors.reset}   ${colors.bright}Total P&L:${colors.reset}      ${formatCurrency(pnl.totalPnL).padEnd(25)}  Open Position:  ${pnl.openPosition.toFixed(6).padEnd(20)} ${colors.bright}│${colors.reset}`);
  
  // Orders Section
  console.log(`${colors.bright}├─────────────────────────────────────────────────────────────────────────────────┤${colors.reset}`);
  const buyOrders = orders.filter(o => o.side === 'buy').length;
  const sellOrders = orders.filter(o => o.side === 'sell').length;
  console.log(`${colors.bright}│${colors.reset} ${colors.bright}Orders:${colors.reset} ${colors.green}${buyOrders} BUY${colors.reset} │ ${colors.red}${sellOrders} SELL${colors.reset} │ Total: ${orders.length}                                       ${colors.bright}│${colors.reset}`);
  
  // Metrics Section
  console.log(`${colors.bright}├─────────────────────────────────────────────────────────────────────────────────┤${colors.reset}`);
  console.log(`${colors.bright}│${colors.reset} ${colors.bright}Performance Metrics:${colors.reset}                                                              ${colors.bright}│${colors.reset}`);
  console.log(`${colors.bright}│${colors.reset}   Win Rate: ${formatPercent(metrics.win_rate).padEnd(20)} Profit Factor: ${(metrics.profit_factor || 0).toFixed(2).padEnd(10)} Trades: ${pnl.totalTrades.toString().padEnd(8)} ${colors.bright}│${colors.reset}`);
  console.log(`${colors.bright}│${colors.reset}   Sharpe:   ${(metrics.sharpe_ratio || 0).toFixed(2).padEnd(20)} Max Drawdown:  ${formatPercent(-(metrics.max_drawdown || 0)).padEnd(10)}                  ${colors.bright}│${colors.reset}`);
  
  // Grid Visualization
  console.log(`${colors.bright}├─────────────────────────────────────────────────────────────────────────────────┤${colors.reset}`);
  console.log(`${colors.bright}│${colors.reset} ${colors.bright}Grid Visualization:${colors.reset}                                                               ${colors.bright}│${colors.reset}`);
  
  const gridLevels = Math.min(10, bot.adjusted_grid_count);
  const gridSpacing = (bot.upper_price - bot.lower_price) / gridLevels;
  
  for (let i = gridLevels; i >= 0; i--) {
    const levelPrice = bot.lower_price + (i * gridSpacing);
    const isCurrent = currentPrice >= levelPrice && currentPrice < levelPrice + gridSpacing;
    const marker = isCurrent ? `${colors.yellow}◄ PRICE${colors.reset}` : '       ';
    const levelOrders = orders.filter(o => Math.abs(o.price - levelPrice) < gridSpacing * 0.5);
    const buyCount = levelOrders.filter(o => o.side === 'buy').length;
    const sellCount = levelOrders.filter(o => o.side === 'sell').length;
    
    const buyBar = colors.green + '█'.repeat(Math.min(buyCount, 5)) + colors.reset;
    const sellBar = colors.red + '█'.repeat(Math.min(sellCount, 5)) + colors.reset;
    
    console.log(`${colors.bright}│${colors.reset}   $${levelPrice.toFixed(0).padStart(6)} │ ${buyBar.padEnd(15)}${sellBar.padEnd(15)} ${marker}                       ${colors.bright}│${colors.reset}`);
  }
  
  console.log(`${colors.bright}└─────────────────────────────────────────────────────────────────────────────────┘${colors.reset}`);
  console.log();
}

// Render portfolio summary
function renderPortfolioSummary(botData) {
  let totalRealizedPnL = 0;
  let totalUnrealizedPnL = 0;
  let totalCapital = 0;
  let totalOrders = 0;
  
  for (const data of botData) {
    totalRealizedPnL += data.pnl.realizedPnL;
    totalUnrealizedPnL += data.pnl.unrealizedPnL;
    totalCapital += data.bot.order_size * data.bot.adjusted_grid_count;
    totalOrders += data.orders.length;
  }
  
  const totalPnL = totalRealizedPnL + totalUnrealizedPnL;
  const roi = totalCapital > 0 ? (totalPnL / totalCapital) * 100 : 0;
  
  console.log(`${colors.bright}${colors.magenta}╔════════════════════════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}║${colors.reset}                        ${colors.bright}PORTFOLIO SUMMARY${colors.reset}                                      ${colors.magenta}║${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}╠════════════════════════════════════════════════════════════════════════════════╣${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}║${colors.reset}  Total Capital:    $${totalCapital.toFixed(2).padEnd(15)}  Total Orders:     ${totalOrders.toString().padEnd(15)}     ${colors.magenta}║${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}║${colors.reset}  Realized P&L:     ${formatCurrency(totalRealizedPnL).padEnd(20)}  Unrealized P&L:   ${formatCurrency(totalUnrealizedPnL).padEnd(20)} ${colors.magenta}║${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}║${colors.reset}  ${colors.bright}Total P&L:${colors.reset}        ${formatCurrency(totalPnL).padEnd(20)}  ${colors.bright}ROI:${colors.reset}              ${formatPercent(roi).padEnd(20)} ${colors.magenta}║${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}╚════════════════════════════════════════════════════════════════════════════════╝${colors.reset}`);
  console.log();
}

// Main dashboard loop
async function runDashboard(refreshInterval = 10000) {
  const exchange = initExchange();
  const bots = db.getAllBots();
  
  if (bots.length === 0) {
    console.log('No bots configured. Create a bot first.');
    process.exit(0);
  }
  
  console.log(`${colors.dim}Starting dashboard... Press Ctrl+C to exit.${colors.reset}\n`);
  
  async function refresh() {
    try {
      clearScreen();
      renderHeader();
      
      const botData = [];
      
      for (const bot of bots) {
        try {
          // Fetch current price
          const ticker = await exchange.fetchTicker(bot.symbol);
          const currentPrice = ticker.last;
          
          // Fetch open orders from exchange
          const exchangeOrders = await exchange.fetchOpenOrders(bot.symbol);
          
          // Calculate P&L
          const pnl = await calculateRealTimePnL(bot, exchange, currentPrice);
          
          // Get metrics
          const metrics = db.getMetrics(bot.name);
          
          botData.push({
            bot,
            pnl,
            metrics,
            currentPrice,
            orders: exchangeOrders,
          });
          
          renderBotCard(bot, pnl, metrics, currentPrice, exchangeOrders);
        } catch (error) {
          console.log(`${colors.red}Error fetching data for ${bot.name}: ${error.message}${colors.reset}\n`);
        }
      }
      
      if (botData.length > 0) {
        renderPortfolioSummary(botData);
      }
      
      console.log(`${colors.dim}Refreshing every ${refreshInterval / 1000} seconds... Press Ctrl+C to exit.${colors.reset}`);
    } catch (error) {
      console.error(`${colors.red}Dashboard error: ${error.message}${colors.reset}`);
    }
  }
  
  // Initial render
  await refresh();
  
  // Set up refresh interval
  const intervalId = setInterval(refresh, refreshInterval);
  
  // Graceful shutdown
  process.on('SIGINT', () => {
    clearInterval(intervalId);
    console.log('\n\nDashboard stopped.');
    closeDatabase();
    process.exit(0);
  });
}

// Single snapshot mode (non-interactive)
async function showSnapshot() {
  const exchange = initExchange();
  const bots = db.getAllBots();
  
  if (bots.length === 0) {
    console.log('No bots configured.');
    closeDatabase();
    return;
  }
  
  renderHeader();
  
  const botData = [];
  
  for (const bot of bots) {
    try {
      const ticker = await exchange.fetchTicker(bot.symbol);
      const currentPrice = ticker.last;
      const exchangeOrders = await exchange.fetchOpenOrders(bot.symbol);
      const pnl = await calculateRealTimePnL(bot, exchange, currentPrice);
      const metrics = db.getMetrics(bot.name);
      
      botData.push({ bot, pnl, metrics, currentPrice, orders: exchangeOrders });
      renderBotCard(bot, pnl, metrics, currentPrice, exchangeOrders);
    } catch (error) {
      console.log(`${colors.red}Error fetching data for ${bot.name}: ${error.message}${colors.reset}\n`);
    }
  }
  
  if (botData.length > 0) {
    renderPortfolioSummary(botData);
  }
  
  closeDatabase();
}

// Parse arguments and run
const args = process.argv.slice(2);
const isLive = args.includes('--live') || args.includes('-l');
const intervalArg = args.find(a => a.startsWith('--interval='));
const interval = intervalArg ? parseInt(intervalArg.split('=')[1]) * 1000 : 10000;

if (isLive) {
  runDashboard(interval);
} else {
  showSnapshot();
}
