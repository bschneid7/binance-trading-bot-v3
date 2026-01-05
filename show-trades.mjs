#!/usr/bin/env node

/**
 * Show Trade History Script
 * 
 * Displays recent trades for a specific bot.
 * 
 * Usage:
 *   node show-trades.mjs --name <bot_name> [--hours <hours>] [--limit <count>]
 * 
 * Example:
 *   node show-trades.mjs --name live-eth-bot --hours 24
 */

import { getDatabase } from './database.mjs';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.production' });

const db = getDatabase();

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const value = argv[i + 1];
      args[key] = value;
      i++;
    }
  }
  
  return args;
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', { 
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}

async function main() {
  const args = parseArgs();
  
  if (!args.name) {
    console.error('❌ Error: Bot name required (--name)');
    console.log('\nUsage: node show-trades.mjs --name <bot_name> [--hours <hours>] [--limit <count>]');
    process.exit(1);
  }
  
  const botName = args.name;
  const hours = parseInt(args.hours) || 24;
  const limit = parseInt(args.limit) || 50;
  
  // Get bot info
  const bot = db.getBot(botName);
  if (!bot) {
    console.error(`❌ Error: Bot "${botName}" not found`);
    process.exit(1);
  }
  
  // Query trades from database
  const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  
  const stmt = db.db.prepare(`
    SELECT * FROM trades 
    WHERE bot_name = ? AND timestamp >= ?
    ORDER BY timestamp DESC
    LIMIT ?
  `);
  
  const trades = stmt.all(botName, cutoffTime, limit);
  
  console.log(`\n════════════════════════════════════════════════════════════`);
  console.log(`       TRADE HISTORY: ${botName}`);
  console.log(`════════════════════════════════════════════════════════════`);
  console.log(`   Symbol: ${bot.symbol}`);
  console.log(`   Period: Last ${hours} hours`);
  console.log(`   Total Trades Found: ${trades.length}`);
  console.log(`════════════════════════════════════════════════════════════\n`);
  
  if (trades.length === 0) {
    console.log('   No trades found in the specified period.\n');
    return;
  }
  
  // Calculate summary stats
  const buys = trades.filter(t => t.side === 'buy');
  const sells = trades.filter(t => t.side === 'sell');
  const totalBuyValue = buys.reduce((sum, t) => sum + (t.value || t.price * t.amount), 0);
  const totalSellValue = sells.reduce((sum, t) => sum + (t.value || t.price * t.amount), 0);
  const totalFees = trades.reduce((sum, t) => sum + (t.fee || 0), 0);
  
  console.log(`📊 Summary:`);
  console.log(`   Buy Orders:  ${buys.length} (Total: $${totalBuyValue.toFixed(2)})`);
  console.log(`   Sell Orders: ${sells.length} (Total: $${totalSellValue.toFixed(2)})`);
  console.log(`   Total Fees:  $${totalFees.toFixed(2)}`);
  console.log(`   Net Flow:    $${(totalSellValue - totalBuyValue).toFixed(2)}`);
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  
  // Display individual trades
  console.log(`📋 Trade Details (newest first):\n`);
  
  for (const trade of trades) {
    const side = trade.side.toUpperCase();
    const sideEmoji = trade.side === 'buy' ? '🟢' : '🔴';
    const price = parseFloat(trade.price).toFixed(2);
    const amount = parseFloat(trade.amount).toFixed(6);
    const value = (trade.value || trade.price * trade.amount).toFixed(2);
    const fee = (trade.fee || 0).toFixed(4);
    const time = formatDate(trade.timestamp);
    
    console.log(`${sideEmoji} ${side.padEnd(4)} | ${time}`);
    console.log(`   Price:  $${price}`);
    console.log(`   Amount: ${amount} ${bot.symbol.split('/')[0]}`);
    console.log(`   Value:  $${value}`);
    if (trade.fee > 0) {
      console.log(`   Fee:    $${fee}`);
    }
    console.log(`   Order:  ${trade.order_id || 'N/A'}`);
    console.log('');
  }
  
  // Try to identify complete cycles (buy followed by sell at higher price)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`\n🔄 Complete Cycles (Buy → Sell):\n`);
  
  // Sort trades by time ascending for cycle detection
  const sortedTrades = [...trades].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  
  let cycles = [];
  let unmatchedBuys = [];
  
  for (const trade of sortedTrades) {
    if (trade.side === 'buy') {
      unmatchedBuys.push(trade);
    } else if (trade.side === 'sell' && unmatchedBuys.length > 0) {
      // Match with the oldest unmatched buy
      const buy = unmatchedBuys.shift();
      const profit = (trade.price - buy.price) * Math.min(trade.amount, buy.amount) - (trade.fee || 0) - (buy.fee || 0);
      cycles.push({
        buy,
        sell: trade,
        profit
      });
    }
  }
  
  if (cycles.length === 0) {
    console.log('   No complete cycles found in this period.\n');
  } else {
    for (const cycle of cycles) {
      const profitEmoji = cycle.profit >= 0 ? '✅' : '❌';
      console.log(`${profitEmoji} Cycle:`);
      console.log(`   Buy:    $${parseFloat(cycle.buy.price).toFixed(2)} @ ${formatDate(cycle.buy.timestamp)}`);
      console.log(`   Sell:   $${parseFloat(cycle.sell.price).toFixed(2)} @ ${formatDate(cycle.sell.timestamp)}`);
      console.log(`   Profit: $${cycle.profit.toFixed(2)}`);
      console.log('');
    }
  }
  
  console.log(`════════════════════════════════════════════════════════════\n`);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
