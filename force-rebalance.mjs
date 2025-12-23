/**
 * Force Rebalance Script
 * Cancels all open orders and places new grid orders at configured sizes
 */

import 'dotenv/config';
import ccxt from 'ccxt';
import { getDatabase } from './database.mjs';

const botName = process.argv[2];
if (!botName) {
  console.log('Usage: node force-rebalance.mjs <bot-name>');
  console.log('  or: node force-rebalance.mjs --all');
  process.exit(1);
}

const db = getDatabase();

async function rebalanceBot(name) {
  console.log(`\n🔄 Force rebalancing ${name}...`);
  
  const bot = db.getBot(name);
  if (!bot) {
    console.log(`❌ Bot ${name} not found`);
    return;
  }
  
  console.log(`   Symbol: ${bot.symbol}`);
  console.log(`   Order Size: $${bot.order_size}`);
  console.log(`   Grid: $${bot.lower_price} - $${bot.upper_price}`);
  console.log(`   Grid Count: ${bot.grid_count}`);
  
  const exchange = new ccxt.binanceus({
    apiKey: process.env.BINANCE_API_KEY,
    secret: process.env.BINANCE_API_SECRET,
    enableRateLimit: true,
  });
  
  // Cancel all open orders
  console.log(`\n   Cancelling all open orders for ${bot.symbol}...`);
  try {
    const openOrders = await exchange.fetchOpenOrders(bot.symbol);
    console.log(`   Found ${openOrders.length} open orders`);
    
    let cancelled = 0;
    for (const order of openOrders) {
      try {
        await exchange.cancelOrder(order.id, bot.symbol);
        db.db.prepare('DELETE FROM orders WHERE id = ?').run(order.id);
        cancelled++;
      } catch (e) {
        // Ignore cancel errors for already cancelled orders
      }
      
      // Rate limit
      await new Promise(r => setTimeout(r, 50));
    }
    console.log(`   ✅ Cancelled ${cancelled} orders`);
  } catch (e) {
    console.log(`   ⚠️ Error cancelling: ${e.message}`);
  }
  
  // Get current price
  const ticker = await exchange.fetchTicker(bot.symbol);
  const currentPrice = ticker.last;
  console.log(`\n   Current price: $${currentPrice.toFixed(2)}`);
  
  // Check if price is within grid range
  if (currentPrice < bot.lower_price || currentPrice > bot.upper_price) {
    console.log(`   ⚠️ Price is outside grid range!`);
    console.log(`   Grid will be placed but may not be optimal.`);
  }
  
  // Calculate grid levels
  const gridSpacing = (bot.upper_price - bot.lower_price) / bot.grid_count;
  console.log(`   Grid spacing: $${gridSpacing.toFixed(2)}`);
  
  const levels = [];
  
  for (let i = 0; i <= bot.grid_count; i++) {
    const price = bot.lower_price + (i * gridSpacing);
    const side = price < currentPrice ? 'buy' : 'sell';
    
    // Calculate amount based on order_size (in USD)
    const amount = bot.order_size / price;
    
    levels.push({ price: parseFloat(price.toFixed(2)), side, amount });
  }
  
  // Filter out levels too close to current price (within 30% of grid spacing)
  const minDistance = gridSpacing * 0.3;
  const filteredLevels = levels.filter(l => 
    Math.abs(l.price - currentPrice) > minDistance
  );
  
  const buyLevels = filteredLevels.filter(l => l.side === 'buy');
  const sellLevels = filteredLevels.filter(l => l.side === 'sell');
  
  console.log(`\n   Placing ${filteredLevels.length} orders:`);
  console.log(`   - ${buyLevels.length} buy orders below $${currentPrice.toFixed(2)}`);
  console.log(`   - ${sellLevels.length} sell orders above $${currentPrice.toFixed(2)}`);
  console.log(`   - Order size: $${bot.order_size} each`);
  
  let placed = 0;
  let failed = 0;
  
  for (const level of filteredLevels) {
    try {
      const order = await exchange.createLimitOrder(
        bot.symbol,
        level.side,
        level.amount,
        level.price
      );
      
      db.createOrder({
        id: order.id,
        bot_name: name,
        symbol: bot.symbol,
        side: level.side,
        price: level.price,
        amount: level.amount,
      });
      
      placed++;
      
      // Progress indicator
      if (placed % 10 === 0) {
        console.log(`   📦 Placed ${placed}/${filteredLevels.length} orders...`);
      }
      
      // Rate limit
      await new Promise(r => setTimeout(r, 100));
    } catch (e) {
      failed++;
      if (!e.message?.includes('insufficient') && !e.message?.includes('MIN_NOTIONAL')) {
        console.log(`   ⚠️ Could not place ${level.side} at $${level.price.toFixed(2)}: ${e.message}`);
      }
    }
  }
  
  const totalCapital = placed * bot.order_size;
  
  console.log(`\n   ✅ Placed ${placed}/${filteredLevels.length} orders`);
  if (failed > 0) {
    console.log(`   ⚠️ ${failed} orders failed (likely insufficient funds)`);
  }
  console.log(`   📊 Capital deployed: ~$${totalCapital.toFixed(2)}`);
  
  return { placed, failed, totalCapital };
}

async function main() {
  console.log('═'.repeat(60));
  console.log('  FORCE REBALANCE - Grid Order Reset');
  console.log('═'.repeat(60));
  
  const results = [];
  
  if (botName === '--all') {
    const bots = db.db.prepare('SELECT name FROM bots').all();
    console.log(`\nRebalancing ${bots.length} bot(s)...`);
    
    for (const bot of bots) {
      const result = await rebalanceBot(bot.name);
      if (result) results.push({ name: bot.name, ...result });
    }
  } else {
    const result = await rebalanceBot(botName);
    if (result) results.push({ name: botName, ...result });
  }
  
  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('  REBALANCE SUMMARY');
  console.log('═'.repeat(60));
  
  let totalPlaced = 0;
  let totalCapital = 0;
  
  for (const r of results) {
    console.log(`  ${r.name}: ${r.placed} orders, ~$${r.totalCapital.toFixed(2)}`);
    totalPlaced += r.placed;
    totalCapital += r.totalCapital;
  }
  
  console.log('─'.repeat(60));
  console.log(`  TOTAL: ${totalPlaced} orders, ~$${totalCapital.toFixed(2)} deployed`);
  console.log('═'.repeat(60));
  
  console.log('\n✅ Rebalance complete!');
  console.log('   Remember to restart the bots:');
  console.log('   sudo systemctl start enhanced-btc-bot enhanced-eth-bot enhanced-sol-bot\n');
  
  process.exit(0);
}

main().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
