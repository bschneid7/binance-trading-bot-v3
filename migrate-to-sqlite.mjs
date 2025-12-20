#!/usr/bin/env node

/**
 * Migration Script: JSON to SQLite
 * Version: 1.0.0
 * 
 * Migrates existing data from JSON files to the new SQLite database.
 * This script is safe to run multiple times - it will skip existing records.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDatabase, closeDatabase } from './database.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// JSON file paths (legacy)
const LEGACY_DATA_DIR = join(__dirname, 'data');
const LEGACY_BOTS_FILE = join(LEGACY_DATA_DIR, 'grid-bots.json');
const LEGACY_ORDERS_FILE = join(LEGACY_DATA_DIR, 'active-orders.json');
const LEGACY_TRADES_FILE = join(LEGACY_DATA_DIR, 'grid-trades.json');

/**
 * Read JSON file safely
 */
function readJSON(filepath) {
  try {
    if (!existsSync(filepath)) {
      console.log(`⚠️  File not found: ${filepath}`);
      return [];
    }
    const data = readFileSync(filepath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`❌ Error reading ${filepath}:`, error.message);
    return [];
  }
}

/**
 * Normalize bot data for database
 */
function normalizeBot(bot) {
  return {
    name: bot.name,
    symbol: bot.symbol || 'BTC/USD',
    lower_price: bot.lower_price || bot.lowerBound || 0,
    upper_price: bot.upper_price || bot.upperBound || 0,
    grid_count: bot.grid_count || bot.numLevels || 10,
    adjusted_grid_count: bot.adjusted_grid_count || bot.grid_count || bot.numLevels || 10,
    order_size: bot.order_size || bot.orderSize || 100,
    status: bot.status || 'stopped',
    version: bot.version || '5.0.0'
  };
}

/**
 * Normalize order data for database
 */
function normalizeOrder(order) {
  return {
    id: order.id || `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    bot_name: order.bot_name || order.botName,
    symbol: order.symbol || 'BTC/USD',
    side: order.side?.toLowerCase() || 'buy',
    type: order.type || 'limit',
    price: parseFloat(order.price) || 0,
    amount: parseFloat(order.amount) || 0,
    status: order.status || 'open',
    remaining: order.remaining || order.amount || 0
  };
}

/**
 * Normalize trade data for database
 */
function normalizeTrade(trade) {
  return {
    id: trade.id || trade.orderId || `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    bot_name: trade.bot_name || trade.botName,
    symbol: trade.symbol || 'BTC/USD',
    side: trade.side?.toLowerCase() || 'buy',
    price: parseFloat(trade.price) || 0,
    amount: parseFloat(trade.amount) || 0,
    value: parseFloat(trade.value) || (parseFloat(trade.price) * parseFloat(trade.amount)) || 0,
    fee: parseFloat(trade.fee) || 0,
    order_id: trade.order_id || trade.orderId || null,
    type: trade.type || 'fill'
  };
}

/**
 * Run migration
 */
async function migrate() {
  console.log('═'.repeat(60));
  console.log('🔄 Grid Bot Data Migration: JSON → SQLite');
  console.log('═'.repeat(60));
  console.log();

  // Initialize database
  const db = getDatabase();
  console.log('✅ Database initialized\n');

  // Read legacy data
  console.log('📖 Reading legacy JSON files...');
  const legacyBots = readJSON(LEGACY_BOTS_FILE);
  const legacyOrders = readJSON(LEGACY_ORDERS_FILE);
  const legacyTrades = readJSON(LEGACY_TRADES_FILE);

  console.log(`   - Bots: ${legacyBots.length}`);
  console.log(`   - Orders: ${legacyOrders.length}`);
  console.log(`   - Trades: ${legacyTrades.length}`);
  console.log();

  // Migrate bots
  console.log('📦 Migrating bots...');
  let botsImported = 0;
  let botsSkipped = 0;

  for (const bot of legacyBots) {
    try {
      const normalizedBot = normalizeBot(bot);
      const existing = db.getBot(normalizedBot.name);
      
      if (existing) {
        console.log(`   ⏭️  Skipping existing bot: ${normalizedBot.name}`);
        botsSkipped++;
        continue;
      }
      
      db.createBot(normalizedBot);
      console.log(`   ✅ Imported bot: ${normalizedBot.name}`);
      botsImported++;
    } catch (error) {
      console.error(`   ❌ Failed to import bot ${bot.name}:`, error.message);
    }
  }

  console.log(`   → Imported: ${botsImported}, Skipped: ${botsSkipped}\n`);

  // Migrate orders
  console.log('📦 Migrating orders...');
  let ordersImported = 0;
  let ordersSkipped = 0;

  for (const order of legacyOrders) {
    try {
      const normalizedOrder = normalizeOrder(order);
      
      // Check if bot exists
      const bot = db.getBot(normalizedOrder.bot_name);
      if (!bot) {
        console.log(`   ⚠️  Skipping order for unknown bot: ${normalizedOrder.bot_name}`);
        ordersSkipped++;
        continue;
      }
      
      // Check if order already exists
      const existing = db.getOrder(normalizedOrder.id);
      if (existing) {
        ordersSkipped++;
        continue;
      }
      
      db.createOrder(normalizedOrder);
      ordersImported++;
    } catch (error) {
      if (!error.message.includes('UNIQUE constraint')) {
        console.error(`   ❌ Failed to import order:`, error.message);
      }
      ordersSkipped++;
    }
  }

  console.log(`   → Imported: ${ordersImported}, Skipped: ${ordersSkipped}\n`);

  // Migrate trades
  console.log('📦 Migrating trades...');
  let tradesImported = 0;
  let tradesSkipped = 0;

  for (const trade of legacyTrades) {
    try {
      const normalizedTrade = normalizeTrade(trade);
      
      // Check if bot exists
      const bot = db.getBot(normalizedTrade.bot_name);
      if (!bot) {
        tradesSkipped++;
        continue;
      }
      
      db.recordTrade(normalizedTrade);
      tradesImported++;
    } catch (error) {
      if (!error.message.includes('UNIQUE constraint')) {
        console.error(`   ❌ Failed to import trade:`, error.message);
      }
      tradesSkipped++;
    }
  }

  console.log(`   → Imported: ${tradesImported}, Skipped: ${tradesSkipped}\n`);

  // Update metrics for all bots
  console.log('📊 Calculating metrics...');
  const allBots = db.getAllBots();
  for (const bot of allBots) {
    const metrics = db.updateMetrics(bot.name);
    console.log(`   ✅ ${bot.name}: ${metrics.total_trades} trades, ${metrics.win_rate}% win rate`);
  }
  console.log();

  // Summary
  console.log('═'.repeat(60));
  console.log('✅ Migration Complete!');
  console.log('═'.repeat(60));
  console.log();
  console.log('Summary:');
  console.log(`   Bots:   ${botsImported} imported, ${botsSkipped} skipped`);
  console.log(`   Orders: ${ordersImported} imported, ${ordersSkipped} skipped`);
  console.log(`   Trades: ${tradesImported} imported, ${tradesSkipped} skipped`);
  console.log();
  console.log('📁 Database location: data/grid-bot.db');
  console.log();
  console.log('⚠️  Note: Legacy JSON files have been preserved.');
  console.log('   You can safely delete them after verifying the migration.');
  console.log();

  // Close database
  closeDatabase();
}

// Run migration
migrate().catch(error => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});
