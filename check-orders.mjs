/**
 * Check Orders Utility
 * Shows open orders on exchange vs database
 */

import 'dotenv/config';
import ccxt from 'ccxt';
import { getDatabase } from './database.mjs';

const db = getDatabase();

async function main() {
  console.log('═'.repeat(60));
  console.log('  ORDER CHECK - Exchange vs Database');
  console.log('═'.repeat(60));
  
  const exchange = new ccxt.binanceus({
    apiKey: process.env.BINANCE_API_KEY,
    secret: process.env.BINANCE_API_SECRET,
    enableRateLimit: true,
  });
  
  // Get all bots
  const bots = db.db.prepare('SELECT name, symbol, order_size FROM bots').all();
  
  let totalExchange = 0;
  let totalDatabase = 0;
  let totalValue = 0;
  
  for (const bot of bots) {
    console.log(`\n━━━ ${bot.name} (${bot.symbol}) ━━━`);
    
    // Get orders from exchange
    const exchangeOrders = await exchange.fetchOpenOrders(bot.symbol);
    const buyOrders = exchangeOrders.filter(o => o.side === 'buy');
    const sellOrders = exchangeOrders.filter(o => o.side === 'sell');
    
    // Calculate value
    let orderValue = 0;
    for (const o of exchangeOrders) {
      orderValue += o.price * o.amount;
    }
    
    // Get orders from database
    const dbOrders = db.db.prepare(
      "SELECT COUNT(*) as count FROM orders WHERE bot_name = ? AND status = 'open'"
    ).get(bot.name);
    
    console.log(`   Exchange: ${exchangeOrders.length} orders (${buyOrders.length} buy, ${sellOrders.length} sell)`);
    console.log(`   Database: ${dbOrders.count} orders`);
    console.log(`   Order Size: $${bot.order_size}`);
    console.log(`   Total Value: $${orderValue.toFixed(2)}`);
    
    if (exchangeOrders.length !== dbOrders.count) {
      console.log(`   ⚠️  Mismatch! Exchange and database counts differ.`);
    } else {
      console.log(`   ✅ Counts match`);
    }
    
    totalExchange += exchangeOrders.length;
    totalDatabase += dbOrders.count;
    totalValue += orderValue;
  }
  
  // Get account balance
  console.log('\n━━━ Account Balance ━━━');
  const balance = await exchange.fetchBalance();
  const usdBalance = balance.free['USD'] || 0;
  const usdTotal = balance.total['USD'] || 0;
  
  console.log(`   USD Available: $${usdBalance.toFixed(2)}`);
  console.log(`   USD Total: $${usdTotal.toFixed(2)}`);
  console.log(`   USD in Orders: $${(usdTotal - usdBalance).toFixed(2)}`);
  
  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('  SUMMARY');
  console.log('═'.repeat(60));
  console.log(`   Total Orders on Exchange: ${totalExchange}`);
  console.log(`   Total Orders in Database: ${totalDatabase}`);
  console.log(`   Total Order Value: $${totalValue.toFixed(2)}`);
  console.log(`   USD Available: $${usdBalance.toFixed(2)}`);
  console.log(`   Capital Utilization: ${((totalValue / (totalValue + usdBalance)) * 100).toFixed(1)}%`);
  console.log('═'.repeat(60));
  
  process.exit(0);
}

main().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
