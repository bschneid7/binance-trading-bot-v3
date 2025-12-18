#!/usr/bin/env node
import { config } from 'dotenv';
import ccxt from 'ccxt';

config({ path: '.env.production' });

const exchange = new ccxt.binanceus({
  apiKey: process.env.BINANCE_API_KEY,
  secret: process.env.BINANCE_API_SECRET,
  enableRateLimit: true,
  options: { warnOnFetchOpenOrdersWithoutSymbol: false }
});

console.log('🔍 Fetching open orders from Binance.US per symbol...\n');

const symbols = ['BTC/USD', 'ETH/USD', 'SOL/USD'];
let totalOrders = 0;

for (const symbol of symbols) {
  const orders = await exchange.fetchOpenOrders(symbol);
  const buys = orders.filter(o => o.side === 'buy').length;
  const sells = orders.filter(o => o.side === 'sell').length;
  console.log(`${symbol}: ${orders.length} orders (${buys} BUY, ${sells} SELL)`);
  totalOrders += orders.length;
}

console.log(`\n📊 Total orders on Binance.US: ${totalOrders}`);
console.log(`📊 Database shows: 144 orders`);
if (totalOrders !== 144) {
  console.log(`❌ Discrepancy: ${144 - totalOrders} duplicate orders in database`);
} else {
  console.log(`✅ Database matches Binance!`);
}
