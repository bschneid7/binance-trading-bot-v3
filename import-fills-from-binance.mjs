#!/usr/bin/env node
import { config } from 'dotenv';
import ccxt from 'ccxt';
import fs from 'fs';

config({ path: '.env.production' });

const exchange = new ccxt.binanceus({
  apiKey: process.env.BINANCE_API_KEY,
  secret: process.env.BINANCE_API_SECRET,
  enableRateLimit: true
});

console.log('📥 Importing ALL fills from Binance.US into local database...\n');

const allFills = [];

for (const symbol of ['BTC/USD', 'ETH/USD', 'SOL/USD']) {
  console.log(`Fetching ${symbol} fills...`);
  try {
    const trades = await exchange.fetchMyTrades(symbol);
    console.log(`  Found ${trades.length} fills`);
    
    for (const trade of trades) {
      allFills.push({
        orderId: trade.order,
        botName: symbol === 'BTC/USD' ? 'live-btc-bot' : symbol === 'ETH/USD' ? 'live-eth-bot' : 'live-sol-bot',
        symbol: symbol,
        side: trade.side.toUpperCase(),
        price: trade.price,
        amount: trade.amount,
        value: trade.cost,
        fee: trade.fee?.cost || 0,
        timestamp: new Date(trade.timestamp).toISOString(),
        type: "fill"
      });
    }
  } catch (error) {
    console.log(`  ❌ Error: ${error.message}`);
  }
}

console.log(`\n✅ Total fills to import: ${allFills.length}`);

// Backup existing file
if (fs.existsSync('data/grid-trades.json')) {
  fs.copyFileSync('data/grid-trades.json', 'data/grid-trades.json.backup');
  console.log('📦 Backed up existing grid-trades.json');
}

// Write new file
fs.writeFileSync('data/grid-trades.json', JSON.stringify(allFills, null, 2));
console.log(`✅ Imported ${allFills.length} fills to data/grid-trades.json`);

console.log('\n📊 Breakdown:');
const breakdown = {};
allFills.forEach(f => {
  breakdown[f.symbol] = (breakdown[f.symbol] || 0) + 1;
});
Object.entries(breakdown).forEach(([sym, count]) => {
  console.log(`  ${sym}: ${count} fills`);
});
