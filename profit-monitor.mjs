#!/usr/bin/env node
/**
 * Standalone Profit-Taking Monitor
 * Checks unrealized P&L and alerts when threshold is hit
 * Does NOT auto-close positions - alerts only
 */

import { readFileSync } from 'fs';
import ccxt from 'ccxt';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.production' });

const ORDERS_FILE = './data/active-orders.json';
const PROFIT_THRESHOLD = 0.025; // 2.5%

// Initialize exchange
function initExchange() {
  return new ccxt.binanceus({
    apiKey: process.env.BINANCE_API_KEY,
    secret: process.env.BINANCE_SECRET_KEY,
    enableRateLimit: true,
  });
}

// Calculate unrealized P&L
async function checkProfitOpportunity(botName) {
  try {
    const exchange = initExchange();
    const orders = JSON.parse(readFileSync(ORDERS_FILE, 'utf8'));
    const botOrders = orders.filter(o => o.bot_name === botName && o.status === 'open');
    
    if (botOrders.length === 0) {
      return { action: 'HOLD', reason: 'No open orders', pnl: 0, pnlPercent: 0 };
    }
    
    // Get current prices for all symbols
    const symbols = [...new Set(botOrders.map(o => o.symbol))];
    const prices = {};
    
    for (const symbol of symbols) {
      const ticker = await exchange.fetchTicker(symbol);
      prices[symbol] = ticker.last;
    }
    
    // Calculate P&L
    let totalCost = 0;
    let totalValue = 0;
    
    for (const order of botOrders) {
      const currentPrice = prices[order.symbol];
      const orderValue = order.price * order.amount;
      
      if (order.side === 'buy') {
        // BUY orders: we pay order price, current value is market price
        totalCost += orderValue;
        totalValue += currentPrice * order.amount;
      } else {
        // SELL orders: we already hold the asset (bought lower)
        // Estimate cost basis as 2% below SELL price
        totalCost += orderValue * 0.98;
        totalValue += currentPrice * order.amount;
      }
    }
    
    const unrealizedPnL = totalValue - totalCost;
    const pnlPercent = totalCost > 0 ? unrealizedPnL / totalCost : 0;
    
    if (pnlPercent >= PROFIT_THRESHOLD) {
      return {
        action: 'PROFIT_TARGET_HIT',
        reason: `Unrealized P&L ${(pnlPercent * 100).toFixed(2)}% exceeds ${(PROFIT_THRESHOLD * 100).toFixed(2)}% threshold`,
        pnl: unrealizedPnL,
        pnlPercent,
        orders: botOrders.length
      };
    }
    
    return {
      action: 'HOLD',
      reason: `P&L ${(pnlPercent * 100).toFixed(2)}% below threshold`,
      pnl: unrealizedPnL,
      pnlPercent,
      orders: botOrders.length
    };
    
  } catch (error) {
    return {
      action: 'ERROR',
      reason: error.message,
      pnl: 0,
      pnlPercent: 0
    };
  }
}

// Main check for all bots
async function checkAllBots() {
  console.log(`\n[${new Date().toISOString()}] Profit-Taking Monitor`);
  console.log('═'.repeat(60));
  
  const bots = ['live-btc-bot', 'live-eth-bot', 'live-sol-bot'];
  
  for (const botName of bots) {
    const result = await checkProfitOpportunity(botName);
    
    console.log(`\n${botName}:`);
    console.log(`  Action: ${result.action}`);
    console.log(`  P&L: $${result.pnl.toFixed(2)} (${(result.pnlPercent * 100).toFixed(2)}%)`);
    console.log(`  Orders: ${result.orders || 0}`);
    
    if (result.action === 'PROFIT_TARGET_HIT') {
      console.log(`  🎯 RECOMMENDATION: Consider closing positions to lock in profit`);
    }
  }
  
  console.log('\n' + '═'.repeat(60));
}

// Run check
checkAllBots()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
