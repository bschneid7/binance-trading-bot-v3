#!/usr/bin/env node

/**
 * Cancel All Orders Script
 * 
 * Cancels all open orders for a specific bot on both the exchange and database.
 * 
 * Usage:
 *   node cancel-orders.mjs --name <bot_name>
 * 
 * Example:
 *   node cancel-orders.mjs --name live-eth-bot
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.production' });

import ccxt from 'ccxt';
import { getDatabase } from './database.mjs';

// Initialize exchange
function initExchange() {
  const apiKey = process.env.BINANCE_API_KEY;
  const secret = process.env.BINANCE_API_SECRET;
  
  if (!apiKey || !secret) {
    console.error('Error: BINANCE_API_KEY and BINANCE_API_SECRET must be set');
    process.exit(1);
  }
  
  const exchange = new ccxt.binanceus({
    apiKey,
    secret,
    enableRateLimit: true,
    options: {
      defaultType: 'spot',
      adjustForTimeDifference: true,
    },
  });
  
  return exchange;
}

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

async function main() {
  const args = parseArgs();
  
  if (!args.name) {
    console.error('❌ Error: Bot name required (--name)');
    console.log('\nUsage: node cancel-orders.mjs --name <bot_name>');
    console.log('Example: node cancel-orders.mjs --name live-eth-bot');
    process.exit(1);
  }
  
  const botName = args.name;
  
  // Get bot info
  const bot = db.getBot(botName);
  if (!bot) {
    console.error(`❌ Error: Bot "${botName}" not found`);
    process.exit(1);
  }
  
  console.log(`\n════════════════════════════════════════════════════════════`);
  console.log(`       CANCEL ALL ORDERS: ${botName}`);
  console.log(`════════════════════════════════════════════════════════════`);
  console.log(`   Symbol: ${bot.symbol}`);
  console.log(`════════════════════════════════════════════════════════════\n`);
  
  // Initialize exchange
  console.log('🔧 Initializing exchange...');
  const exchange = initExchange();
  console.log('✅ Exchange initialized');
  
  // Get open orders from database
  const openOrders = db.getOpenOrders(botName);
  console.log(`📋 Found ${openOrders.length} open orders in database\n`);
  
  if (openOrders.length === 0) {
    console.log('✅ No orders to cancel.\n');
    return;
  }
  
  // Cancel orders on exchange
  console.log('🔄 Cancelling orders on exchange...\n');
  
  let cancelledCount = 0;
  let failedCount = 0;
  
  for (const order of openOrders) {
    try {
      await exchange.cancelOrder(order.id, bot.symbol);
      cancelledCount++;
      console.log(`   ✅ Cancelled order ${order.id} (${order.side} @ $${order.price})`);
    } catch (e) {
      // Order might already be filled or cancelled
      if (e.message.includes('Unknown order') || e.message.includes('not found')) {
        console.log(`   ⚠️  Order ${order.id} already filled/cancelled`);
      } else {
        console.log(`   ❌ Failed to cancel ${order.id}: ${e.message}`);
        failedCount++;
      }
    }
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Cancel orders in database
  console.log('\n🗄️  Updating database...');
  const cancelledDb = db.cancelAllOrders(botName, 'manual_liquidation');
  console.log(`   ✅ Marked ${cancelledDb.changes} orders as cancelled in database`);
  
  // Update bot status
  db.updateBotStatus(botName, 'stopped');
  console.log(`   ✅ Bot status set to 'stopped'`);
  
  // Summary
  console.log(`\n════════════════════════════════════════════════════════════`);
  console.log(`       SUMMARY`);
  console.log(`════════════════════════════════════════════════════════════`);
  console.log(`   Orders cancelled on exchange: ${cancelledCount}`);
  console.log(`   Orders failed to cancel: ${failedCount}`);
  console.log(`   Orders marked cancelled in DB: ${cancelledDb.changes}`);
  console.log(`════════════════════════════════════════════════════════════\n`);
  
  if (failedCount > 0) {
    console.log('⚠️  Some orders failed to cancel. They may have been filled.');
    console.log('   Check your Binance.US account to verify.\n');
  } else {
    console.log('✅ All orders cancelled successfully!\n');
  }
  
  // Show freed capital estimate
  const buyOrders = openOrders.filter(o => o.side === 'buy');
  const sellOrders = openOrders.filter(o => o.side === 'sell');
  
  const usdFreed = buyOrders.reduce((sum, o) => sum + (o.price * o.amount), 0);
  const cryptoFreed = sellOrders.reduce((sum, o) => sum + o.amount, 0);
  const cryptoSymbol = bot.symbol.split('/')[0];
  
  console.log(`💰 Estimated Capital Freed:`);
  console.log(`   USD from buy orders: $${usdFreed.toFixed(2)}`);
  console.log(`   ${cryptoSymbol} from sell orders: ${cryptoFreed.toFixed(6)} ${cryptoSymbol}`);
  console.log('');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
