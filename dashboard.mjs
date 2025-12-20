#!/usr/bin/env node

/**
 * Grid Trading Bot - Real-Time Performance Dashboard
 * Version: 2.0.0
 * 
 * Provides a live terminal-based dashboard showing:
 * - Real-time P&L tracking from Binance.US account
 * - Actual account balances and positions
 * - Order status and fill rates
 * - Performance metrics
 * - Grid visualization
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
  if (value === null || value === undefined || isNaN(value)) {
    return `${colors.dim}$0.00${colors.reset}`;
  }
  const formatted = Math.abs(value).toFixed(decimals);
  if (value >= 0) {
    return `${colors.green}$${formatted}${colors.reset}`;
  }
  return `${colors.red}-$${formatted}${colors.reset}`;
}

// Format percentage
function formatPercent(value, decimals = 2) {
  if (value === null || value === undefined || isNaN(value)) {
    return `${colors.dim}0.00%${colors.reset}`;
  }
  const formatted = Math.abs(value).toFixed(decimals);
  if (value >= 0) {
    return `${colors.green}+${formatted}%${colors.reset}`;
  }
  return `${colors.red}-${formatted}%${colors.reset}`;
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

/**
 * Fetch real account balances from Binance.US
 */
async function fetchAccountBalances(exchange) {
  try {
    const balance = await exchange.fetchBalance();
    return balance;
  } catch (error) {
    console.error(`Error fetching balance: ${error.message}`);
    return null;
  }
}

/**
 * Fetch recent trade history from Binance.US for a symbol
 */
async function fetchTradeHistory(exchange, symbol, since = null) {
  try {
    // Fetch trades from the last 30 days if no since provided
    const sinceTimestamp = since || (Date.now() - 30 * 24 * 60 * 60 * 1000);
    const trades = await exchange.fetchMyTrades(symbol, sinceTimestamp, 500);
    return trades;
  } catch (error) {
    console.error(`Error fetching trades for ${symbol}: ${error.message}`);
    return [];
  }
}

/**
 * Calculate P&L from actual Binance trade history
 */
async function calculateRealPnL(exchange, symbol, currentPrice) {
  const trades = await fetchTradeHistory(exchange, symbol);
  
  if (trades.length === 0) {
    return {
      realizedPnL: 0,
      unrealizedPnL: 0,
      totalPnL: 0,
      totalBought: 0,
      totalSold: 0,
      avgBuyPrice: 0,
      avgSellPrice: 0,
      netPosition: 0,
      totalTrades: 0,
      fees: 0,
    };
  }
  
  let totalBuyCost = 0;
  let totalBuyAmount = 0;
  let totalSellRevenue = 0;
  let totalSellAmount = 0;
  let totalFees = 0;
  
  for (const trade of trades) {
    const cost = trade.cost || (trade.price * trade.amount);
    const fee = trade.fee ? trade.fee.cost : 0;
    totalFees += fee;
    
    if (trade.side === 'buy') {
      totalBuyCost += cost;
      totalBuyAmount += trade.amount;
    } else {
      totalSellRevenue += cost;
      totalSellAmount += trade.amount;
    }
  }
  
  const avgBuyPrice = totalBuyAmount > 0 ? totalBuyCost / totalBuyAmount : 0;
  const avgSellPrice = totalSellAmount > 0 ? totalSellRevenue / totalSellAmount : 0;
  
  // Realized P&L: profit from completed round trips (matched buys and sells)
  const completedAmount = Math.min(totalBuyAmount, totalSellAmount);
  let realizedPnL = 0;
  if (completedAmount > 0 && avgBuyPrice > 0) {
    realizedPnL = (avgSellPrice - avgBuyPrice) * completedAmount;
  }
  
  // Net position (what we still hold)
  const netPosition = totalBuyAmount - totalSellAmount;
  
  // Unrealized P&L: current value of holdings vs what we paid
  let unrealizedPnL = 0;
  if (netPosition > 0 && avgBuyPrice > 0) {
    unrealizedPnL = (currentPrice - avgBuyPrice) * netPosition;
  }
  
  // Subtract fees from total P&L
  const totalPnL = realizedPnL + unrealizedPnL - totalFees;
  
  return {
    realizedPnL,
    unrealizedPnL,
    totalPnL,
    totalBought: totalBuyAmount,
    totalSold: totalSellAmount,
    avgBuyPrice,
    avgSellPrice,
    netPosition,
    totalTrades: trades.length,
    fees: totalFees,
  };
}

/**
 * Get actual holdings from account balance
 */
function getHoldings(balance, symbol) {
  // Extract base currency from symbol (e.g., BTC from BTC/USD)
  const baseCurrency = symbol.split('/')[0];
  
  if (balance && balance[baseCurrency]) {
    return {
      free: balance[baseCurrency].free || 0,
      used: balance[baseCurrency].used || 0,
      total: balance[baseCurrency].total || 0,
    };
  }
  
  return { free: 0, used: 0, total: 0 };
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
function renderBotCard(bot, pnl, holdings, currentPrice, orders, usdBalance) {
  const statusColor = bot.status === 'running' ? colors.green : colors.red;
  const statusIcon = bot.status === 'running' ? '●' : '○';
  const baseCurrency = bot.symbol.split('/')[0];
  
  console.log(`${colors.bright}┌─────────────────────────────────────────────────────────────────────────────────┐${colors.reset}`);
  console.log(`${colors.bright}│${colors.reset} ${statusColor}${statusIcon}${colors.reset} ${colors.bright}${bot.name.toUpperCase()}${colors.reset} (${bot.symbol})                                                          ${colors.bright}│${colors.reset}`);
  console.log(`${colors.bright}├─────────────────────────────────────────────────────────────────────────────────┤${colors.reset}`);
  
  // Price and Range
  const pricePosition = ((currentPrice - bot.lower_price) / (bot.upper_price - bot.lower_price) * 100).toFixed(1);
  console.log(`${colors.bright}│${colors.reset} Current Price: ${colors.bright}$${currentPrice.toFixed(2)}${colors.reset}  │  Range: $${bot.lower_price.toFixed(0)}-$${bot.upper_price.toFixed(0)}  │  Position: ${pricePosition}%       ${colors.bright}│${colors.reset}`);
  
  // Holdings Section
  console.log(`${colors.bright}├─────────────────────────────────────────────────────────────────────────────────┤${colors.reset}`);
  const holdingsValue = holdings.total * currentPrice;
  console.log(`${colors.bright}│${colors.reset} ${colors.bright}Holdings:${colors.reset} ${holdings.total.toFixed(6)} ${baseCurrency} (${formatCurrency(holdingsValue)})                                    ${colors.bright}│${colors.reset}`);
  console.log(`${colors.bright}│${colors.reset}   Available: ${holdings.free.toFixed(6)}  │  In Orders: ${holdings.used.toFixed(6)}                              ${colors.bright}│${colors.reset}`);
  
  // P&L Section (from actual trades)
  console.log(`${colors.bright}├─────────────────────────────────────────────────────────────────────────────────┤${colors.reset}`);
  console.log(`${colors.bright}│${colors.reset} ${colors.bright}P&L (Last 30 Days):${colors.reset}                                                           ${colors.bright}│${colors.reset}`);
  console.log(`${colors.bright}│${colors.reset}   Realized:    ${formatCurrency(pnl.realizedPnL).padEnd(20)}  Unrealized:   ${formatCurrency(pnl.unrealizedPnL).padEnd(15)}    ${colors.bright}│${colors.reset}`);
  console.log(`${colors.bright}│${colors.reset}   ${colors.bright}Total P&L:${colors.reset}   ${formatCurrency(pnl.totalPnL).padEnd(20)}  Fees Paid:    ${formatCurrency(pnl.fees).padEnd(15)}    ${colors.bright}│${colors.reset}`);
  
  // Trade Stats
  console.log(`${colors.bright}├─────────────────────────────────────────────────────────────────────────────────┤${colors.reset}`);
  console.log(`${colors.bright}│${colors.reset} ${colors.bright}Trade Stats:${colors.reset}                                                                    ${colors.bright}│${colors.reset}`);
  console.log(`${colors.bright}│${colors.reset}   Total Trades: ${pnl.totalTrades.toString().padEnd(10)}  Avg Buy: $${pnl.avgBuyPrice.toFixed(2).padEnd(12)}  Avg Sell: $${pnl.avgSellPrice.toFixed(2).padEnd(10)} ${colors.bright}│${colors.reset}`);
  console.log(`${colors.bright}│${colors.reset}   Bought: ${pnl.totalBought.toFixed(6).padEnd(15)}  Sold: ${pnl.totalSold.toFixed(6).padEnd(15)}                    ${colors.bright}│${colors.reset}`);
  
  // Orders Section
  console.log(`${colors.bright}├─────────────────────────────────────────────────────────────────────────────────┤${colors.reset}`);
  const buyOrders = orders.filter(o => o.side === 'buy').length;
  const sellOrders = orders.filter(o => o.side === 'sell').length;
  const buyValue = orders.filter(o => o.side === 'buy').reduce((sum, o) => sum + (o.price * o.amount), 0);
  const sellValue = orders.filter(o => o.side === 'sell').reduce((sum, o) => sum + (o.price * o.amount), 0);
  console.log(`${colors.bright}│${colors.reset} ${colors.bright}Open Orders:${colors.reset} ${orders.length} total                                                        ${colors.bright}│${colors.reset}`);
  console.log(`${colors.bright}│${colors.reset}   ${colors.green}BUY:${colors.reset}  ${buyOrders} orders (${formatCurrency(buyValue)})                                            ${colors.bright}│${colors.reset}`);
  console.log(`${colors.bright}│${colors.reset}   ${colors.red}SELL:${colors.reset} ${sellOrders} orders (${formatCurrency(sellValue)})                                            ${colors.bright}│${colors.reset}`);
  
  // Grid Visualization (compact)
  console.log(`${colors.bright}├─────────────────────────────────────────────────────────────────────────────────┤${colors.reset}`);
  console.log(`${colors.bright}│${colors.reset} ${colors.bright}Grid:${colors.reset} ${colors.green}${'█'.repeat(buyOrders > 10 ? 10 : buyOrders)}${colors.reset}${colors.dim}${'░'.repeat(10 - (buyOrders > 10 ? 10 : buyOrders))}${colors.reset} BUY  ${colors.yellow}◄ $${currentPrice.toFixed(0)} ►${colors.reset}  SELL ${colors.red}${'█'.repeat(sellOrders > 10 ? 10 : sellOrders)}${colors.reset}${colors.dim}${'░'.repeat(10 - (sellOrders > 10 ? 10 : sellOrders))}${colors.reset}  ${colors.bright}│${colors.reset}`);
  
  console.log(`${colors.bright}└─────────────────────────────────────────────────────────────────────────────────┘${colors.reset}`);
  console.log();
}

// Render portfolio summary
function renderPortfolioSummary(botData, usdBalance) {
  let totalRealizedPnL = 0;
  let totalUnrealizedPnL = 0;
  let totalHoldingsValue = 0;
  let totalOrders = 0;
  let totalFees = 0;
  
  for (const data of botData) {
    totalRealizedPnL += data.pnl.realizedPnL || 0;
    totalUnrealizedPnL += data.pnl.unrealizedPnL || 0;
    totalHoldingsValue += data.holdings.total * data.currentPrice;
    totalOrders += data.orders.length;
    totalFees += data.pnl.fees || 0;
  }
  
  const totalPnL = totalRealizedPnL + totalUnrealizedPnL - totalFees;
  const totalPortfolioValue = totalHoldingsValue + usdBalance;
  
  console.log(`${colors.bright}${colors.magenta}╔════════════════════════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}║${colors.reset}                        ${colors.bright}PORTFOLIO SUMMARY${colors.reset}                                      ${colors.magenta}║${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}╠════════════════════════════════════════════════════════════════════════════════╣${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}║${colors.reset}  ${colors.bright}Account Value:${colors.reset}                                                              ${colors.magenta}║${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}║${colors.reset}    USD Balance:     ${formatCurrency(usdBalance).padEnd(20)}                                   ${colors.magenta}║${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}║${colors.reset}    Crypto Holdings: ${formatCurrency(totalHoldingsValue).padEnd(20)}                                   ${colors.magenta}║${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}║${colors.reset}    ${colors.bright}Total Value:${colors.reset}     ${formatCurrency(totalPortfolioValue).padEnd(20)}                                   ${colors.magenta}║${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}╠════════════════════════════════════════════════════════════════════════════════╣${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}║${colors.reset}  ${colors.bright}P&L (Last 30 Days):${colors.reset}                                                         ${colors.magenta}║${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}║${colors.reset}    Realized P&L:    ${formatCurrency(totalRealizedPnL).padEnd(20)}                                   ${colors.magenta}║${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}║${colors.reset}    Unrealized P&L:  ${formatCurrency(totalUnrealizedPnL).padEnd(20)}                                   ${colors.magenta}║${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}║${colors.reset}    Fees Paid:       ${formatCurrency(totalFees).padEnd(20)}                                   ${colors.magenta}║${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}║${colors.reset}    ${colors.bright}Net P&L:${colors.reset}         ${formatCurrency(totalPnL).padEnd(20)}                                   ${colors.magenta}║${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}╠════════════════════════════════════════════════════════════════════════════════╣${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}║${colors.reset}  Active Orders: ${totalOrders}                                                            ${colors.magenta}║${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}╚════════════════════════════════════════════════════════════════════════════════╝${colors.reset}`);
  console.log();
}

// Main dashboard loop
async function runDashboard(refreshInterval = 30000) {
  const exchange = initExchange();
  const bots = db.getAllBots();
  
  if (bots.length === 0) {
    console.log('No bots configured. Create a bot first.');
    process.exit(0);
  }
  
  console.log(`${colors.dim}Starting dashboard... Press Ctrl+C to exit.${colors.reset}\n`);
  console.log(`${colors.dim}Fetching data from Binance.US (this may take a moment)...${colors.reset}\n`);
  
  async function refresh() {
    try {
      clearScreen();
      renderHeader();
      
      // Fetch account balance once
      const balance = await fetchAccountBalances(exchange);
      const usdBalance = balance ? (balance['USD']?.free || 0) : 0;
      
      const botData = [];
      
      for (const bot of bots) {
        try {
          // Fetch current price
          const ticker = await exchange.fetchTicker(bot.symbol);
          const currentPrice = ticker.last;
          
          // Fetch open orders from exchange
          const exchangeOrders = await exchange.fetchOpenOrders(bot.symbol);
          
          // Calculate P&L from actual trade history
          const pnl = await calculateRealPnL(exchange, bot.symbol, currentPrice);
          
          // Get actual holdings
          const holdings = getHoldings(balance, bot.symbol);
          
          botData.push({
            bot,
            pnl,
            holdings,
            currentPrice,
            orders: exchangeOrders,
          });
          
          renderBotCard(bot, pnl, holdings, currentPrice, exchangeOrders, usdBalance);
        } catch (error) {
          console.log(`${colors.red}Error fetching data for ${bot.name}: ${error.message}${colors.reset}\n`);
        }
      }
      
      if (botData.length > 0) {
        renderPortfolioSummary(botData, usdBalance);
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
  
  console.log(`${colors.dim}Fetching data from Binance.US...${colors.reset}\n`);
  
  renderHeader();
  
  // Fetch account balance once
  const balance = await fetchAccountBalances(exchange);
  const usdBalance = balance ? (balance['USD']?.free || 0) : 0;
  
  const botData = [];
  
  for (const bot of bots) {
    try {
      const ticker = await exchange.fetchTicker(bot.symbol);
      const currentPrice = ticker.last;
      const exchangeOrders = await exchange.fetchOpenOrders(bot.symbol);
      const pnl = await calculateRealPnL(exchange, bot.symbol, currentPrice);
      const holdings = getHoldings(balance, bot.symbol);
      
      botData.push({ bot, pnl, holdings, currentPrice, orders: exchangeOrders });
      renderBotCard(bot, pnl, holdings, currentPrice, exchangeOrders, usdBalance);
    } catch (error) {
      console.log(`${colors.red}Error fetching data for ${bot.name}: ${error.message}${colors.reset}\n`);
    }
  }
  
  if (botData.length > 0) {
    renderPortfolioSummary(botData, usdBalance);
  }
  
  closeDatabase();
}

// Parse arguments and run
const args = process.argv.slice(2);
const isLive = args.includes('--live') || args.includes('-l');
const intervalArg = args.find(a => a.startsWith('--interval='));
const interval = intervalArg ? parseInt(intervalArg.split('=')[1]) * 1000 : 30000;

if (isLive) {
  runDashboard(interval);
} else {
  showSnapshot();
}
