#!/usr/bin/env node

/**
 * Order Synchronization Module
 * 
 * Reconciles the local database with actual orders on Binance.US exchange.
 * 
 * Features:
 * - Detect and handle orphaned orders (in DB but not on exchange)
 * - Detect and import missing orders (on exchange but not in DB)
 * - Identify filled orders that weren't detected by the monitor
 * - Automatic repair mode for fixing discrepancies
 * - Detailed sync reports
 */

import ccxt from 'ccxt';
import dotenv from 'dotenv';
import { getDatabase, closeDatabase } from './database.mjs';
import { retryWithBackoff } from './error-handler.mjs';

dotenv.config({ path: '.env.production' });

const db = getDatabase();

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
 * Sync result structure
 */
class SyncResult {
  constructor(botName, symbol) {
    this.botName = botName;
    this.symbol = symbol;
    this.timestamp = new Date().toISOString();
    this.exchangeOrders = [];
    this.databaseOrders = [];
    this.orphanedOrders = [];      // In DB but not on exchange
    this.missingOrders = [];       // On exchange but not in DB
    this.filledOrders = [];        // Orders that were filled but not detected
    this.matchedOrders = [];       // Orders that match between DB and exchange
    this.repairActions = [];       // Actions taken during repair
    this.errors = [];
  }

  get isInSync() {
    return this.orphanedOrders.length === 0 && 
           this.missingOrders.length === 0 && 
           this.filledOrders.length === 0;
  }

  get summary() {
    return {
      inSync: this.isInSync,
      exchangeOrderCount: this.exchangeOrders.length,
      databaseOrderCount: this.databaseOrders.length,
      orphanedCount: this.orphanedOrders.length,
      missingCount: this.missingOrders.length,
      filledCount: this.filledOrders.length,
      matchedCount: this.matchedOrders.length,
      repairActionsCount: this.repairActions.length,
      errorCount: this.errors.length,
    };
  }
}

/**
 * Fetch all open orders from exchange for a symbol
 */
async function fetchExchangeOrders(exchange, symbol) {
  try {
    const orders = await retryWithBackoff(
      () => exchange.fetchOpenOrders(symbol),
      { maxAttempts: 3, context: `Fetch open orders for ${symbol}` }
    );
    return orders;
  } catch (error) {
    console.error(`❌ Failed to fetch exchange orders: ${error.message}`);
    return [];
  }
}

/**
 * Fetch recent order history to detect filled orders
 */
async function fetchOrderHistory(exchange, symbol, since = null) {
  try {
    // Fetch orders from the last 7 days if no since provided
    const sinceTimestamp = since || (Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const orders = await retryWithBackoff(
      () => exchange.fetchOrders(symbol, sinceTimestamp),
      { maxAttempts: 3, context: `Fetch order history for ${symbol}` }
    );
    return orders;
  } catch (error) {
    console.error(`❌ Failed to fetch order history: ${error.message}`);
    return [];
  }
}

/**
 * Synchronize orders for a specific bot
 */
async function syncBot(exchange, botName, options = {}) {
  const { repair = false, verbose = false } = options;
  
  const bot = db.getBot(botName);
  if (!bot) {
    throw new Error(`Bot "${botName}" not found`);
  }

  const result = new SyncResult(botName, bot.symbol);
  
  if (verbose) {
    console.log(`\n🔄 Syncing orders for ${botName} (${bot.symbol})...`);
  }

  // Fetch orders from exchange
  result.exchangeOrders = await fetchExchangeOrders(exchange, bot.symbol);
  
  // Get orders from database
  result.databaseOrders = db.getActiveOrders(botName);
  
  // Create lookup maps
  const exchangeOrderIds = new Set(result.exchangeOrders.map(o => o.id));
  const dbOrderIds = new Set(result.databaseOrders.map(o => o.id));
  
  // Find orphaned orders (in DB but not on exchange)
  for (const dbOrder of result.databaseOrders) {
    if (!exchangeOrderIds.has(dbOrder.id)) {
      result.orphanedOrders.push(dbOrder);
      
      if (verbose) {
        console.log(`  ⚠️  Orphaned order: ${dbOrder.id} (${dbOrder.side} @ $${dbOrder.price})`);
      }
    } else {
      result.matchedOrders.push(dbOrder);
    }
  }
  
  // Find missing orders (on exchange but not in DB)
  for (const exOrder of result.exchangeOrders) {
    if (!dbOrderIds.has(exOrder.id)) {
      result.missingOrders.push(exOrder);
      
      if (verbose) {
        console.log(`  ⚠️  Missing from DB: ${exOrder.id} (${exOrder.side} @ $${exOrder.price})`);
      }
    }
  }
  
  // Check order history for filled orders that weren't detected
  const orderHistory = await fetchOrderHistory(exchange, bot.symbol);
  const filledOrders = orderHistory.filter(o => o.status === 'closed' && o.filled > 0);
  
  for (const filledOrder of filledOrders) {
    // Check if this order was in our database but not marked as filled
    const dbOrder = result.databaseOrders.find(o => o.id === filledOrder.id);
    if (dbOrder && dbOrder.status === 'active') {
      result.filledOrders.push({
        dbOrder,
        exchangeOrder: filledOrder,
        filledAt: filledOrder.timestamp,
        filledPrice: filledOrder.average || filledOrder.price,
      });
      
      if (verbose) {
        console.log(`  ⚠️  Undetected fill: ${filledOrder.id} filled at $${filledOrder.average || filledOrder.price}`);
      }
    }
  }
  
  // Repair mode - fix discrepancies
  if (repair) {
    await repairSync(result, verbose);
  }
  
  return result;
}

/**
 * Repair synchronization issues
 */
async function repairSync(result, verbose = false) {
  if (verbose) {
    console.log(`\n🔧 Repairing sync issues...`);
  }
  
  // Handle orphaned orders - mark as cancelled in DB
  for (const orphanedOrder of result.orphanedOrders) {
    try {
      db.fillOrder(orphanedOrder.id, 'cancelled_sync');
      result.repairActions.push({
        action: 'mark_cancelled',
        orderId: orphanedOrder.id,
        reason: 'Order not found on exchange',
      });
      
      if (verbose) {
        console.log(`  ✅ Marked orphaned order ${orphanedOrder.id} as cancelled`);
      }
    } catch (error) {
      result.errors.push({
        action: 'mark_cancelled',
        orderId: orphanedOrder.id,
        error: error.message,
      });
    }
  }
  
  // Handle missing orders - import to DB
  for (const missingOrder of result.missingOrders) {
    try {
      db.createOrder({
        id: missingOrder.id,
        bot_name: result.botName,
        symbol: result.symbol,
        side: missingOrder.side,
        price: missingOrder.price,
        amount: missingOrder.amount,
      });
      result.repairActions.push({
        action: 'import_order',
        orderId: missingOrder.id,
        reason: 'Order found on exchange but not in database',
      });
      
      if (verbose) {
        console.log(`  ✅ Imported missing order ${missingOrder.id}`);
      }
    } catch (error) {
      result.errors.push({
        action: 'import_order',
        orderId: missingOrder.id,
        error: error.message,
      });
    }
  }
  
  // Handle undetected fills - mark as filled and record trade
  for (const fill of result.filledOrders) {
    try {
      db.fillOrder(fill.dbOrder.id, 'filled_sync');
      
      // Record the trade
      db.recordTrade({
        bot_name: result.botName,
        symbol: result.symbol,
        side: fill.dbOrder.side,
        price: fill.filledPrice,
        amount: fill.dbOrder.amount,
        value: fill.filledPrice * fill.dbOrder.amount,
        order_id: fill.dbOrder.id,
        type: 'fill_sync',
      });
      
      result.repairActions.push({
        action: 'record_fill',
        orderId: fill.dbOrder.id,
        filledPrice: fill.filledPrice,
        reason: 'Fill detected from order history',
      });
      
      if (verbose) {
        console.log(`  ✅ Recorded fill for order ${fill.dbOrder.id} at $${fill.filledPrice}`);
      }
    } catch (error) {
      result.errors.push({
        action: 'record_fill',
        orderId: fill.dbOrder.id,
        error: error.message,
      });
    }
  }
  
  // Update metrics after repairs
  if (result.repairActions.length > 0) {
    db.updateMetrics(result.botName);
    
    if (verbose) {
      console.log(`  ✅ Updated metrics for ${result.botName}`);
    }
  }
}

/**
 * Sync all bots
 */
async function syncAllBots(options = {}) {
  const exchange = initExchange();
  const bots = db.getAllBots();
  const results = [];
  
  for (const bot of bots) {
    try {
      const result = await syncBot(exchange, bot.name, options);
      results.push(result);
    } catch (error) {
      console.error(`❌ Error syncing ${bot.name}: ${error.message}`);
    }
  }
  
  return results;
}

/**
 * Generate sync report
 */
function generateReport(results) {
  const lines = [];
  
  lines.push('═'.repeat(80));
  lines.push('       ORDER SYNCHRONIZATION REPORT');
  lines.push('═'.repeat(80));
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  
  let totalOrphaned = 0;
  let totalMissing = 0;
  let totalFilled = 0;
  let totalRepairs = 0;
  
  for (const result of results) {
    lines.push('─'.repeat(80));
    lines.push(`Bot: ${result.botName} (${result.symbol})`);
    lines.push('─'.repeat(80));
    
    const summary = result.summary;
    lines.push(`  Exchange Orders:  ${summary.exchangeOrderCount}`);
    lines.push(`  Database Orders:  ${summary.databaseOrderCount}`);
    lines.push(`  Matched:          ${summary.matchedCount}`);
    lines.push(`  Orphaned:         ${summary.orphanedCount}`);
    lines.push(`  Missing from DB:  ${summary.missingCount}`);
    lines.push(`  Undetected Fills: ${summary.filledCount}`);
    lines.push(`  Repair Actions:   ${summary.repairActionsCount}`);
    lines.push(`  Status:           ${summary.inSync ? '✅ IN SYNC' : '⚠️  OUT OF SYNC'}`);
    lines.push('');
    
    totalOrphaned += summary.orphanedCount;
    totalMissing += summary.missingCount;
    totalFilled += summary.filledCount;
    totalRepairs += summary.repairActionsCount;
    
    // Detail repair actions if any
    if (result.repairActions.length > 0) {
      lines.push('  Repair Actions:');
      for (const action of result.repairActions) {
        lines.push(`    - ${action.action}: ${action.orderId} (${action.reason})`);
      }
      lines.push('');
    }
    
    // Detail errors if any
    if (result.errors.length > 0) {
      lines.push('  Errors:');
      for (const error of result.errors) {
        lines.push(`    - ${error.action}: ${error.orderId} - ${error.error}`);
      }
      lines.push('');
    }
  }
  
  lines.push('═'.repeat(80));
  lines.push('       SUMMARY');
  lines.push('═'.repeat(80));
  lines.push(`  Total Bots Synced:     ${results.length}`);
  lines.push(`  Total Orphaned Orders: ${totalOrphaned}`);
  lines.push(`  Total Missing Orders:  ${totalMissing}`);
  lines.push(`  Total Undetected Fills: ${totalFilled}`);
  lines.push(`  Total Repair Actions:  ${totalRepairs}`);
  lines.push('═'.repeat(80));
  
  return lines.join('\n');
}

// Export functions
export {
  syncBot,
  syncAllBots,
  fetchExchangeOrders,
  fetchOrderHistory,
  generateReport,
  SyncResult,
};

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const command = args[0];
  const botName = args.find(a => a.startsWith('--name='))?.split('=')[1];
  const repair = args.includes('--repair') || args.includes('-r');
  const verbose = args.includes('--verbose') || args.includes('-v');
  const json = args.includes('--json');
  
  async function main() {
    const exchange = initExchange();
    
    switch (command) {
      case 'check':
      case 'sync':
        if (botName) {
          const result = await syncBot(exchange, botName, { repair: command === 'sync', verbose: true });
          if (json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(generateReport([result]));
          }
        } else {
          const results = await syncAllBots({ repair: command === 'sync', verbose });
          if (json) {
            console.log(JSON.stringify(results, null, 2));
          } else {
            console.log(generateReport(results));
          }
        }
        break;
      
      case 'status':
        const bots = db.getAllBots();
        console.log('\n📊 Order Sync Status:\n');
        
        for (const bot of bots) {
          const exchangeOrders = await fetchExchangeOrders(exchange, bot.symbol);
          const dbOrders = db.getActiveOrders(bot.name);
          
          const inSync = exchangeOrders.length === dbOrders.length;
          const status = inSync ? '✅' : '⚠️';
          
          console.log(`${status} ${bot.name}: Exchange=${exchangeOrders.length}, DB=${dbOrders.length}`);
        }
        break;
      
      default:
        console.log(`
Order Synchronization Tool

Usage:
  node order-sync.mjs check [--name=bot-name] [--verbose]
    Check sync status without making changes

  node order-sync.mjs sync [--name=bot-name] [--verbose]
    Check and repair sync issues

  node order-sync.mjs status
    Quick status overview of all bots

Options:
  --name=<bot-name>  Sync specific bot only
  --verbose, -v      Show detailed output
  --json             Output in JSON format

Examples:
  node order-sync.mjs check                    # Check all bots
  node order-sync.mjs sync --name=live-btc-bot # Sync specific bot
  node order-sync.mjs status                   # Quick status check
        `);
    }
    
    closeDatabase();
  }
  
  main().catch(error => {
    console.error('❌ Error:', error.message);
    closeDatabase();
    process.exit(1);
  });
}
