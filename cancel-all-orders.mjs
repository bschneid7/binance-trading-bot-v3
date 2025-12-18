#!/usr/bin/env node
import { config } from 'dotenv';
import ccxt from 'ccxt';

config({ path: '.env.production' });

const exchange = new ccxt.binanceus({
  apiKey: process.env.BINANCE_API_KEY,
  secret: process.env.BINANCE_API_SECRET,
  enableRateLimit: true
});

console.log('🛑 Cancelling all ETH/USD and SOL/USD orders...\n');

for (const symbol of ['ETH/USD', 'SOL/USD']) {
  console.log(`Cancelling ${symbol} orders...`);
  const orders = await exchange.fetchOpenOrders(symbol);
  console.log(`   Found ${orders.length} orders`);
  
  for (const order of orders) {
    try {
      await exchange.cancelOrder(order.id, symbol);
      console.log(`   ✅ Cancelled order ${order.id}`);
    } catch (error) {
      console.log(`   ❌ Failed: ${error.message}`);
    }
  }
}

console.log('\n✅ All orders cancelled. Verifying...\n');

// Verify
for (const symbol of ['BTC/USD', 'ETH/USD', 'SOL/USD']) {
  const orders = await exchange.fetchOpenOrders(symbol);
  console.log(`${symbol}: ${orders.length} orders remaining`);
}
