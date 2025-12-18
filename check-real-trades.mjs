#!/usr/bin/env node
import { config } from 'dotenv';
import ccxt from 'ccxt';

config({ path: '.env.production' });

const exchange = new ccxt.binanceus({
  apiKey: process.env.BINANCE_API_KEY,
  secret: process.env.BINANCE_API_SECRET,
  enableRateLimit: true
});

console.log('📊 Fetching ACTUAL trades from Binance.US (last 24 hours)...\n');

for (const symbol of ['BTC/USD', 'ETH/USD', 'SOL/USD']) {
  try {
    const since = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
    const trades = await exchange.fetchMyTrades(symbol, since);
    
    console.log(`\n${symbol}: ${trades.length} fills`);
    
    if (trades.length > 0) {
      console.log('Recent fills:');
      trades.slice(-5).forEach(t => {
        console.log(`  ${t.side.toUpperCase()} ${t.amount} @ $${t.price} - ${new Date(t.timestamp).toLocaleString()}`);
      });
    }
  } catch (error) {
    console.log(`  ❌ Error: ${error.message}`);
  }
}

console.log('\n' + '='.repeat(60));
console.log('📊 TOTAL FILLS (all time):');
for (const symbol of ['BTC/USD', 'ETH/USD', 'SOL/USD']) {
  try {
    const trades = await exchange.fetchMyTrades(symbol);
    console.log(`${symbol}: ${trades.length} fills total`);
  } catch (error) {
    console.log(`${symbol}: Error fetching`);
  }
}
