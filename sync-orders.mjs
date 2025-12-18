#!/usr/bin/env node

import ccxt from 'ccxt';
import { config } from 'dotenv';
import { readFileSync, writeFileSync } from 'fs';

config({ path: '.env.production' });

const exchange = new ccxt.binanceus({
  apiKey: process.env.BINANCE_API_KEY,
  secret: process.env.BINANCE_API_SECRET,
  options: { defaultType: 'spot' }
});

async function syncOrders() {
  try {
    console.log('🔄 Fetching open orders from Binance.US...');
    
    // Fetch all open orders for BTC/USD
    const openOrders = await exchange.fetchOpenOrders('BTC/USD');
    console.log(`   Found ${openOrders.length} open orders on Binance.US`);
    
    // Read current bot config
    const bots = JSON.parse(readFileSync('data/grid-bots.json', 'utf8'));
    const liveBotConfig = bots.find(b => b.name === 'live-btc-bot');
    
    if (!liveBotConfig) {
      console.error('❌ live-btc-bot not found in grid-bots.json');
      process.exit(1);
    }
    
    // Format orders for active-orders.json
    const formattedOrders = openOrders.map(order => ({
      id: order.id,
      bot_name: 'live-btc-bot',
      symbol: order.symbol,
      side: order.side,
      price: order.price,
      amount: order.amount,
      status: 'open',
      timestamp: order.timestamp || Date.now()
    }));
    
    // Read existing active-orders.json
    let allOrders = [];
    try {
      allOrders = JSON.parse(readFileSync('data/active-orders.json', 'utf8'));
    } catch (e) {
      console.log('   Creating new active-orders.json');
    }
    
    // Remove old live-btc-bot orders
    allOrders = allOrders.filter(o => o.bot_name !== 'live-btc-bot');
    
    // Add synced orders
    allOrders = allOrders.concat(formattedOrders);
    
    // Save updated file
    writeFileSync('data/active-orders.json', JSON.stringify(allOrders, null, 2));
    
    console.log('✅ Database synced successfully!');
    console.log(`   Removed: old live-btc-bot orders`);
    console.log(`   Added: ${formattedOrders.length} orders from Binance.US`);
    console.log('\nOrder breakdown:');
    const buys = formattedOrders.filter(o => o.side === 'buy').length;
    const sells = formattedOrders.filter(o => o.side === 'sell').length;
    console.log(`   BUY: ${buys} orders`);
    console.log(`   SELL: ${sells} orders`);
    
  } catch (error) {
    console.error('❌ Sync failed:', error.message);
    process.exit(1);
  }
}

syncOrders();
