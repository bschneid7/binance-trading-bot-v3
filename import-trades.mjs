#!/usr/bin/env node

/**
 * Trade History Import Tool
 * 
 * Imports trade history from Binance.US into the local SQLite database.
 * This populates the database with historical trades for accurate P&L tracking.
 */

import ccxt from 'ccxt';
import dotenv from 'dotenv';
import { getDatabase, closeDatabase } from './database.mjs';

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
 * Fetch all trades for a symbol from Binance.US
 */
async function fetchAllTrades(exchange, symbol, days = 90) {
  console.log(`📥 Fetching trades for ${symbol} (last ${days} days)...`);
  
  const since = Date.now() - (days * 24 * 60 * 60 * 1000);
  const allTrades = [];
  let lastId = undefined;
  
  try {
    // Fetch in batches (Binance limits to 1000 per request)
    while (true) {
      const params = lastId ? { fromId: lastId } : {};
      const trades = await exchange.fetchMyTrades(symbol, since, 1000, params);
      
      if (trades.length === 0) break;
      
      // Filter out duplicates
      const newTrades = trades.filter(t => !allTrades.find(at => at.id === t.id));
      if (newTrades.length === 0) break;
      
      allTrades.push(...newTrades);
      lastId = trades[trades.length - 1].id;
      
      console.log(`   Fetched ${allTrades.length} trades so far...`);
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // If we got less than 1000, we've reached the end
      if (trades.length < 1000) break;
    }
    
    console.log(`✅ Found ${allTrades.length} trades for ${symbol}`);
    return allTrades;
  } catch (error) {
    console.error(`❌ Error fetching trades for ${symbol}: ${error.message}`);
    return allTrades;
  }
}

/**
 * Import trades into the database
 */
function importTrades(trades, botName) {
  let imported = 0;
  let skipped = 0;
  
  for (const trade of trades) {
    try {
      db.recordTrade({
        id: `binance_${trade.id}`,
        bot_name: botName,
        symbol: trade.symbol,
        side: trade.side,
        price: trade.price,
        amount: trade.amount,
        value: trade.cost || (trade.price * trade.amount),
        fee: trade.fee ? trade.fee.cost : 0,
        order_id: trade.order,
        type: 'imported',
      });
      imported++;
    } catch (error) {
      if (error.message.includes('UNIQUE constraint')) {
        skipped++;
      } else {
        console.error(`Error importing trade ${trade.id}: ${error.message}`);
      }
    }
  }
  
  return { imported, skipped };
}

/**
 * Main import function
 */
async function importAllTrades(options = {}) {
  const { days = 90, symbols = null } = options;
  
  const exchange = initExchange();
  const bots = db.getAllBots();
  
  if (bots.length === 0) {
    console.log('No bots configured. Nothing to import.');
    return;
  }
  
  console.log('═'.repeat(60));
  console.log('       TRADE HISTORY IMPORT');
  console.log('═'.repeat(60));
  console.log(`Importing trades from the last ${days} days\n`);
  
  const results = [];
  
  for (const bot of bots) {
    // Skip if symbols filter is provided and doesn't match
    if (symbols && !symbols.includes(bot.symbol)) continue;
    
    console.log(`\n─── ${bot.name} (${bot.symbol}) ───`);
    
    const trades = await fetchAllTrades(exchange, bot.symbol, days);
    
    if (trades.length > 0) {
      const result = importTrades(trades, bot.name);
      results.push({
        botName: bot.name,
        symbol: bot.symbol,
        totalTrades: trades.length,
        ...result,
      });
      
      console.log(`   Imported: ${result.imported}, Skipped: ${result.skipped}`);
      
      // Update metrics after import
      db.updateMetrics(bot.name);
      console.log(`   ✅ Metrics updated`);
    }
  }
  
  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('       IMPORT SUMMARY');
  console.log('═'.repeat(60));
  
  let totalImported = 0;
  let totalSkipped = 0;
  
  for (const result of results) {
    console.log(`${result.botName}: ${result.imported} imported, ${result.skipped} skipped (${result.totalTrades} total)`);
    totalImported += result.imported;
    totalSkipped += result.skipped;
  }
  
  console.log('─'.repeat(60));
  console.log(`Total: ${totalImported} imported, ${totalSkipped} skipped`);
  console.log('═'.repeat(60));
  
  return results;
}

/**
 * Show current trade counts in database
 */
function showStats() {
  const bots = db.getAllBots();
  
  console.log('═'.repeat(60));
  console.log('       DATABASE TRADE STATISTICS');
  console.log('═'.repeat(60));
  
  for (const bot of bots) {
    const trades = db.getBotTrades(bot.name, 100000);
    const metrics = db.getMetrics(bot.name);
    
    console.log(`\n${bot.name} (${bot.symbol}):`);
    console.log(`   Trades in DB:  ${trades.length}`);
    console.log(`   Win Rate:      ${(metrics.win_rate || 0).toFixed(1)}%`);
    console.log(`   Total P&L:     $${(metrics.total_pnl || 0).toFixed(2)}`);
    console.log(`   Profit Factor: ${(metrics.profit_factor || 0).toFixed(2)}`);
  }
  
  console.log('\n' + '═'.repeat(60));
}

// CLI interface
const args = process.argv.slice(2);
const command = args[0];
const daysArg = args.find(a => a.startsWith('--days='));
const days = daysArg ? parseInt(daysArg.split('=')[1]) : 90;

async function main() {
  switch (command) {
    case 'import':
      await importAllTrades({ days });
      break;
    
    case 'stats':
      showStats();
      break;
    
    default:
      console.log(`
Trade History Import Tool

Usage:
  node import-trades.mjs import [--days=90]  - Import trades from Binance.US
  node import-trades.mjs stats               - Show current database statistics

Options:
  --days=N    Number of days of history to import (default: 90)

Examples:
  node import-trades.mjs import              # Import last 90 days
  node import-trades.mjs import --days=30    # Import last 30 days
  node import-trades.mjs stats               # Show current stats
      `);
  }
  
  closeDatabase();
}

main().catch(error => {
  console.error('Error:', error.message);
  closeDatabase();
  process.exit(1);
});
