#!/usr/bin/env node

import ccxt from 'ccxt';
import { config } from 'dotenv';

config({ path: '.env.production' });

const exchange = new ccxt.binanceus({
  apiKey: process.env.BINANCE_API_KEY,
  secret: process.env.BINANCE_API_SECRET,
  options: { defaultType: 'spot' }
});

async function checkFills() {
  try {
    console.log('📊 Fetching trade history from Binance.US...\n');
    
    // Fetch trades for last 24 hours
    const trades = await exchange.fetchMyTrades('BTC/USD', undefined, 50);
    
    // Filter trades from today (Dec 16)
    const today = new Date().toISOString().split('T')[0];
    const todayTrades = trades.filter(t => {
      const tradeDate = new Date(t.timestamp).toISOString().split('T')[0];
      return tradeDate === today;
    });
    
    console.log(`Total trades today (Dec 16): ${todayTrades.length}`);
    
    if (todayTrades.length > 0) {
      console.log('\n🎯 Recent fills:\n');
      todayTrades.slice(-10).forEach(t => {
        const time = new Date(t.timestamp).toLocaleTimeString();
        console.log(`  ${time} | ${t.side.toUpperCase()} ${t.amount} BTC @ $${t.price.toFixed(2)} | Fee: $${(t.fee.cost || 0).toFixed(2)}`);
      });
      
      // Calculate P&L
      const buyTotal = todayTrades.filter(t => t.side === 'buy').reduce((sum, t) => sum + (t.amount * t.price), 0);
      const sellTotal = todayTrades.filter(t => t.side === 'sell').reduce((sum, t) => sum + (t.amount * t.price), 0);
      const fees = todayTrades.reduce((sum, t) => sum + (t.fee.cost || 0), 0);
      
      console.log(`\n💰 Summary:`);
      console.log(`   BUY: ${todayTrades.filter(t => t.side === 'buy').length} trades, $${buyTotal.toFixed(2)} spent`);
      console.log(`   SELL: ${todayTrades.filter(t => t.side === 'sell').length} trades, $${sellTotal.toFixed(2)} received`);
      console.log(`   Fees: $${fees.toFixed(2)}`);
      console.log(`   Net P&L: $${(sellTotal - buyTotal - fees).toFixed(2)}`);
    } else {
      console.log('\n❌ No trades found today');
    }
    
  } catch (error) {
    console.error('❌ Error fetching trades:', error.message);
  }
}

checkFills();
