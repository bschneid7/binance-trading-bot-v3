#!/usr/bin/env node

/**
 * Binance Sync Tool
 * Version: 1.0.0
 * 
 * Comprehensive synchronization between local database and Binance.US:
 * - Sync open orders (detect orphaned, missing, and filled orders)
 * - Import trade history
 * - Sync account balances
 * - Update metrics and P&L calculations
 * - Generate detailed sync reports
 */

import ccxt from 'ccxt';
import dotenv from 'dotenv';
import { getDatabase, closeDatabase } from './database.mjs';
import { retryWithBackoff } from './error-handler.mjs';

dotenv.config({ path: '.env.production' });

const db = getDatabase();

// Colors for terminal output
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
};

// Initialize exchange
function initExchange() {
  const apiKey = process.env.BINANCE_API_KEY;
  const secret = process.env.BINANCE_API_SECRET;

  if (!apiKey || !secret) {
    console.error(`${colors.red}❌ Error: BINANCE_API_KEY and BINANCE_API_SECRET must be set${colors.reset}`);
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
 * Sync Result Tracker
 */
class SyncResults {
  constructor() {
    this.startTime = new Date();
    this.orders = {
      exchangeCount: 0,
      dbCount: 0,
      orphaned: [],
      missing: [],
      filled: [],
      repaired: 0,
    };
    this.trades = {
      fetched: 0,
      imported: 0,
      skipped: 0,
    };
    this.balances = {
      usd: 0,
      holdings: {},
    };
    this.bots = [];
    this.errors = [];
  }

  get duration() {
    return ((new Date() - this.startTime) / 1000).toFixed(1);
  }
}

/**
 * Fetch open orders from Binance.US
 */
async function fetchExchangeOrders(exchange, symbol) {
  try {
    return await retryWithBackoff(
      () => exchange.fetchOpenOrders(symbol),
      { maxAttempts: 3, context: `Fetch orders for ${symbol}` }
    );
  } catch (error) {
    console.error(`${colors.red}   Error fetching orders: ${error.message}${colors.reset}`);
    return [];
  }
}

/**
 * Fetch order history to detect filled orders
 */
async function fetchOrderHistory(exchange, symbol, since) {
  try {
    return await retryWithBackoff(
      () => exchange.fetchOrders(symbol, since, 500),
      { maxAttempts: 3, context: `Fetch order history for ${symbol}` }
    );
  } catch (error) {
    console.error(`${colors.red}   Error fetching order history: ${error.message}${colors.reset}`);
    return [];
  }
}

/**
 * Fetch trade history from Binance.US
 */
async function fetchTradeHistory(exchange, symbol, since) {
  const allTrades = [];
  let lastId = undefined;
  
  try {
    while (true) {
      const params = lastId ? { fromId: lastId } : {};
      const trades = await exchange.fetchMyTrades(symbol, since, 1000, params);
      
      if (trades.length === 0) break;
      
      const newTrades = trades.filter(t => !allTrades.find(at => at.id === t.id));
      if (newTrades.length === 0) break;
      
      allTrades.push(...newTrades);
      lastId = trades[trades.length - 1].id;
      
      await new Promise(resolve => setTimeout(resolve, 300));
      
      if (trades.length < 1000) break;
    }
    
    return allTrades;
  } catch (error) {
    console.error(`${colors.red}   Error fetching trades: ${error.message}${colors.reset}`);
    return allTrades;
  }
}

/**
 * Fetch account balances
 */
async function fetchBalances(exchange) {
  try {
    return await retryWithBackoff(
      () => exchange.fetchBalance(),
      { maxAttempts: 3, context: 'Fetch account balance' }
    );
  } catch (error) {
    console.error(`${colors.red}   Error fetching balance: ${error.message}${colors.reset}`);
    return null;
  }
}

/**
 * Sync orders for a bot
 */
async function syncOrders(exchange, bot, results, repair = false) {
  console.log(`\n   ${colors.cyan}Orders:${colors.reset}`);
  
  // Fetch from exchange
  const exchangeOrders = await fetchExchangeOrders(exchange, bot.symbol);
  const dbOrders = db.getActiveOrders(bot.name);
  
  results.orders.exchangeCount += exchangeOrders.length;
  results.orders.dbCount += dbOrders.length;
  
  console.log(`      Exchange: ${exchangeOrders.length} open orders`);
  console.log(`      Database: ${dbOrders.length} active orders`);
  
  // Create lookup sets
  const exchangeOrderIds = new Set(exchangeOrders.map(o => o.id));
  const dbOrderIds = new Set(dbOrders.map(o => o.id));
  
  // Find orphaned orders (in DB but not on exchange)
  const orphaned = dbOrders.filter(o => !exchangeOrderIds.has(o.id));
  if (orphaned.length > 0) {
    console.log(`      ${colors.yellow}⚠ Orphaned: ${orphaned.length} orders in DB not on exchange${colors.reset}`);
    results.orders.orphaned.push(...orphaned.map(o => ({ ...o, botName: bot.name })));
    
    if (repair) {
      for (const order of orphaned) {
        try {
          db.fillOrder(order.id, 'sync_orphaned');
          results.orders.repaired++;
        } catch (e) {
          results.errors.push({ type: 'orphan_repair', order: order.id, error: e.message });
        }
      }
      console.log(`      ${colors.green}✓ Marked ${orphaned.length} orphaned orders as cancelled${colors.reset}`);
    }
  }
  
  // Find missing orders (on exchange but not in DB)
  const missing = exchangeOrders.filter(o => !dbOrderIds.has(o.id));
  if (missing.length > 0) {
    console.log(`      ${colors.yellow}⚠ Missing: ${missing.length} orders on exchange not in DB${colors.reset}`);
    results.orders.missing.push(...missing.map(o => ({ ...o, botName: bot.name })));
    
    if (repair) {
      for (const order of missing) {
        try {
          db.createOrder({
            id: order.id,
            bot_name: bot.name,
            symbol: bot.symbol,
            side: order.side,
            price: order.price,
            amount: order.amount,
          });
          results.orders.repaired++;
        } catch (e) {
          results.errors.push({ type: 'missing_import', order: order.id, error: e.message });
        }
      }
      console.log(`      ${colors.green}✓ Imported ${missing.length} missing orders${colors.reset}`);
    }
  }
  
  // Check for filled orders in history
  const since = Date.now() - (7 * 24 * 60 * 60 * 1000); // Last 7 days
  const orderHistory = await fetchOrderHistory(exchange, bot.symbol, since);
  const filledOrders = orderHistory.filter(o => o.status === 'closed' && o.filled > 0);
  
  for (const filled of filledOrders) {
    const dbOrder = dbOrders.find(o => o.id === filled.id);
    if (dbOrder && dbOrder.status === 'open') {
      console.log(`      ${colors.yellow}⚠ Undetected fill: ${filled.id} @ $${filled.average || filled.price}${colors.reset}`);
      results.orders.filled.push({ ...filled, botName: bot.name });
      
      if (repair) {
        try {
          db.fillOrder(filled.id, 'sync_filled');
          db.recordTrade({
            bot_name: bot.name,
            symbol: bot.symbol,
            side: dbOrder.side,
            price: filled.average || filled.price,
            amount: dbOrder.amount,
            value: (filled.average || filled.price) * dbOrder.amount,
            order_id: filled.id,
            type: 'sync_fill',
          });
          results.orders.repaired++;
        } catch (e) {
          results.errors.push({ type: 'fill_record', order: filled.id, error: e.message });
        }
      }
    }
  }
  
  if (orphaned.length === 0 && missing.length === 0 && results.orders.filled.length === 0) {
    console.log(`      ${colors.green}✓ Orders in sync${colors.reset}`);
  }
  
  return { exchangeOrders, orphaned, missing };
}

/**
 * Sync trades for a bot
 */
async function syncTrades(exchange, bot, results, days = 30) {
  console.log(`\n   ${colors.cyan}Trades (last ${days} days):${colors.reset}`);
  
  const since = Date.now() - (days * 24 * 60 * 60 * 1000);
  const trades = await fetchTradeHistory(exchange, bot.symbol, since);
  
  results.trades.fetched += trades.length;
  console.log(`      Fetched: ${trades.length} trades from Binance`);
  
  let imported = 0;
  let skipped = 0;
  
  for (const trade of trades) {
    try {
      db.recordTrade({
        id: `binance_${trade.id}`,
        bot_name: bot.name,
        symbol: trade.symbol,
        side: trade.side,
        price: trade.price,
        amount: trade.amount,
        value: trade.cost || (trade.price * trade.amount),
        fee: trade.fee ? trade.fee.cost : 0,
        order_id: trade.order,
        type: 'synced',
      });
      imported++;
    } catch (error) {
      if (error.message.includes('UNIQUE constraint')) {
        skipped++;
      } else {
        results.errors.push({ type: 'trade_import', trade: trade.id, error: error.message });
      }
    }
  }
  
  results.trades.imported += imported;
  results.trades.skipped += skipped;
  
  console.log(`      Imported: ${imported}, Skipped: ${skipped} (already in DB)`);
  
  // Update metrics
  if (imported > 0) {
    db.updateMetrics(bot.name);
    console.log(`      ${colors.green}✓ Metrics updated${colors.reset}`);
  }
  
  return trades;
}

/**
 * Sync balances
 */
async function syncBalances(exchange, bots, results) {
  console.log(`\n${colors.bright}━━━ Account Balances ━━━${colors.reset}`);
  
  const balance = await fetchBalances(exchange);
  if (!balance) return;
  
  results.balances.usd = balance['USD']?.total || 0;
  console.log(`   USD: $${results.balances.usd.toFixed(2)}`);
  
  for (const bot of bots) {
    const baseCurrency = bot.symbol.split('/')[0];
    const holding = balance[baseCurrency];
    
    if (holding && holding.total > 0) {
      results.balances.holdings[baseCurrency] = {
        free: holding.free || 0,
        used: holding.used || 0,
        total: holding.total || 0,
      };
      console.log(`   ${baseCurrency}: ${holding.total.toFixed(6)} (${holding.free.toFixed(6)} free, ${holding.used.toFixed(6)} in orders)`);
    }
  }
}

/**
 * Main sync function
 */
async function runSync(options = {}) {
  const { repair = false, days = 30, ordersOnly = false, tradesOnly = false } = options;
  
  const exchange = initExchange();
  const bots = db.getAllBots();
  const results = new SyncResults();
  
  console.log(`\n${colors.bright}${colors.cyan}╔════════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}║${colors.reset}              ${colors.bright}BINANCE SYNC TOOL${colors.reset}                               ${colors.cyan}║${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}╚════════════════════════════════════════════════════════════════╝${colors.reset}`);
  console.log(`\n${colors.dim}Started: ${results.startTime.toISOString()}${colors.reset}`);
  console.log(`${colors.dim}Mode: ${repair ? 'REPAIR (will fix issues)' : 'CHECK (read-only)'}${colors.reset}`);
  
  if (bots.length === 0) {
    console.log(`\n${colors.yellow}No bots configured.${colors.reset}`);
    return results;
  }
  
  // Sync each bot
  for (const bot of bots) {
    console.log(`\n${colors.bright}━━━ ${bot.name} (${bot.symbol}) ━━━${colors.reset}`);
    results.bots.push(bot.name);
    
    if (!tradesOnly) {
      await syncOrders(exchange, bot, results, repair);
    }
    
    if (!ordersOnly) {
      await syncTrades(exchange, bot, results, days);
    }
  }
  
  // Sync balances
  await syncBalances(exchange, bots, results);
  
  // Print summary
  printSummary(results, repair);
  
  return results;
}

/**
 * Print sync summary
 */
function printSummary(results, repair) {
  console.log(`\n${colors.bright}${colors.magenta}╔════════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}║${colors.reset}                    ${colors.bright}SYNC SUMMARY${colors.reset}                              ${colors.magenta}║${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}╠════════════════════════════════════════════════════════════════╣${colors.reset}`);
  
  // Orders
  const orderIssues = results.orders.orphaned.length + results.orders.missing.length + results.orders.filled.length;
  const orderStatus = orderIssues === 0 ? `${colors.green}✓ IN SYNC${colors.reset}` : `${colors.yellow}⚠ ${orderIssues} ISSUES${colors.reset}`;
  console.log(`${colors.bright}${colors.magenta}║${colors.reset}  ${colors.bright}Orders:${colors.reset}                                                      ${colors.magenta}║${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}║${colors.reset}    Exchange: ${results.orders.exchangeCount.toString().padEnd(10)} Database: ${results.orders.dbCount.toString().padEnd(10)} ${orderStatus.padEnd(20)} ${colors.magenta}║${colors.reset}`);
  
  if (orderIssues > 0) {
    console.log(`${colors.bright}${colors.magenta}║${colors.reset}    Orphaned: ${results.orders.orphaned.length.toString().padEnd(10)} Missing: ${results.orders.missing.length.toString().padEnd(10)} Filled: ${results.orders.filled.length.toString().padEnd(10)} ${colors.magenta}║${colors.reset}`);
    if (repair) {
      console.log(`${colors.bright}${colors.magenta}║${colors.reset}    ${colors.green}Repaired: ${results.orders.repaired}${colors.reset}                                              ${colors.magenta}║${colors.reset}`);
    }
  }
  
  // Trades
  console.log(`${colors.bright}${colors.magenta}╠════════════════════════════════════════════════════════════════╣${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}║${colors.reset}  ${colors.bright}Trades:${colors.reset}                                                      ${colors.magenta}║${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}║${colors.reset}    Fetched: ${results.trades.fetched.toString().padEnd(10)} Imported: ${results.trades.imported.toString().padEnd(10)} Skipped: ${results.trades.skipped.toString().padEnd(10)} ${colors.magenta}║${colors.reset}`);
  
  // Balances
  console.log(`${colors.bright}${colors.magenta}╠════════════════════════════════════════════════════════════════╣${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}║${colors.reset}  ${colors.bright}Balances:${colors.reset}                                                    ${colors.magenta}║${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}║${colors.reset}    USD: $${results.balances.usd.toFixed(2).padEnd(15)}                                    ${colors.magenta}║${colors.reset}`);
  
  for (const [currency, holding] of Object.entries(results.balances.holdings)) {
    console.log(`${colors.bright}${colors.magenta}║${colors.reset}    ${currency}: ${holding.total.toFixed(6).padEnd(15)}                                    ${colors.magenta}║${colors.reset}`);
  }
  
  // Errors
  if (results.errors.length > 0) {
    console.log(`${colors.bright}${colors.magenta}╠════════════════════════════════════════════════════════════════╣${colors.reset}`);
    console.log(`${colors.bright}${colors.magenta}║${colors.reset}  ${colors.red}Errors: ${results.errors.length}${colors.reset}                                                     ${colors.magenta}║${colors.reset}`);
  }
  
  console.log(`${colors.bright}${colors.magenta}╠════════════════════════════════════════════════════════════════╣${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}║${colors.reset}  Duration: ${results.duration}s                                                  ${colors.magenta}║${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}╚════════════════════════════════════════════════════════════════╝${colors.reset}`);
  
  if (!repair && orderIssues > 0) {
    console.log(`\n${colors.yellow}Run with --repair to fix issues: node sync.mjs --repair${colors.reset}`);
  }
}

/**
 * Quick status check
 */
async function quickStatus() {
  const exchange = initExchange();
  const bots = db.getAllBots();
  
  console.log(`\n${colors.bright}Quick Sync Status${colors.reset}\n`);
  
  for (const bot of bots) {
    const exchangeOrders = await fetchExchangeOrders(exchange, bot.symbol);
    const dbOrders = db.getActiveOrders(bot.name);
    const dbTrades = db.getBotTrades(bot.name, 100000);
    
    const inSync = exchangeOrders.length === dbOrders.length;
    const status = inSync ? `${colors.green}✓${colors.reset}` : `${colors.yellow}⚠${colors.reset}`;
    
    console.log(`${status} ${bot.name} (${bot.symbol})`);
    console.log(`   Orders: Exchange=${exchangeOrders.length}, DB=${dbOrders.length}`);
    console.log(`   Trades in DB: ${dbTrades.length}`);
  }
}

// CLI interface
const args = process.argv.slice(2);
const command = args[0] || 'check';
const repair = args.includes('--repair') || args.includes('-r');
const daysArg = args.find(a => a.startsWith('--days='));
const days = daysArg ? parseInt(daysArg.split('=')[1]) : 30;
const ordersOnly = args.includes('--orders');
const tradesOnly = args.includes('--trades');

async function main() {
  switch (command) {
    case 'check':
    case 'sync':
      await runSync({ 
        repair: command === 'sync' || repair, 
        days, 
        ordersOnly, 
        tradesOnly 
      });
      break;
    
    case 'status':
      await quickStatus();
      break;
    
    case 'help':
    default:
      console.log(`
${colors.bright}Binance Sync Tool${colors.reset}

Synchronizes local database with Binance.US exchange.

${colors.bright}Usage:${colors.reset}
  node sync.mjs check              Check sync status (read-only)
  node sync.mjs sync               Check and repair sync issues
  node sync.mjs status             Quick status overview

${colors.bright}Options:${colors.reset}
  --repair, -r     Repair issues (same as 'sync' command)
  --days=N         Days of trade history to sync (default: 30)
  --orders         Sync orders only
  --trades         Sync trades only

${colors.bright}Examples:${colors.reset}
  node sync.mjs check              # Check all bots
  node sync.mjs sync               # Check and fix issues
  node sync.mjs sync --days=90     # Sync with 90 days of history
  node sync.mjs status             # Quick status check
      `);
  }
  
  closeDatabase();
}

main().catch(error => {
  console.error(`${colors.red}Error: ${error.message}${colors.reset}`);
  closeDatabase();
  process.exit(1);
});
