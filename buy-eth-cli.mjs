#!/usr/bin/env node
/**
 * CLI Tool to Buy ETH via Market Order
 * Usage: node buy-eth-cli.mjs <amount_in_eth>
 * Example: node buy-eth-cli.mjs 0.59
 */

import 'dotenv/config';
import ccxt from 'ccxt';

async function buyETH(amountETH) {
  console.log('🚀 Initializing Binance.US connection...');
  
  const exchange = new ccxt.binanceus({
    apiKey: process.env.BINANCE_API_KEY,
    secret: process.env.BINANCE_API_SECRET,
    enableRateLimit: true,
  });

  try {
    // Get current ETH price
    console.log('📊 Fetching current ETH/USD price...');
    const ticker = await exchange.fetchTicker('ETH/USD');
    const currentPrice = ticker.last;
    const estimatedCost = amountETH * currentPrice;
    
    console.log(`\n💰 Current ETH Price: $${currentPrice.toFixed(2)}`);
    console.log(`📦 Amount to Buy: ${amountETH} ETH`);
    console.log(`💵 Estimated Cost: $${estimatedCost.toFixed(2)}`);
    
    // Check balance
    console.log('\n🔍 Checking USD balance...');
    const balance = await exchange.fetchBalance();
    const usdBalance = balance.USD?.free || 0;
    
    console.log(`💼 Available USD: $${usdBalance.toFixed(2)}`);
    
    if (usdBalance < estimatedCost) {
      console.log(`\n❌ ERROR: Insufficient USD balance!`);
      console.log(`   Required: $${estimatedCost.toFixed(2)}`);
      console.log(`   Available: $${usdBalance.toFixed(2)}`);
      console.log(`   Shortfall: $${(estimatedCost - usdBalance).toFixed(2)}`);
      process.exit(1);
    }
    
    // Confirm purchase
    console.log(`\n⚠️  CONFIRMATION REQUIRED`);
    console.log(`═══════════════════════════════════════════════════════`);
    console.log(`   Buy: ${amountETH} ETH`);
    console.log(`   At: ~$${currentPrice.toFixed(2)} per ETH`);
    console.log(`   Cost: ~$${estimatedCost.toFixed(2)} USD`);
    console.log(`   Remaining USD: ~$${(usdBalance - estimatedCost).toFixed(2)}`);
    console.log(`═══════════════════════════════════════════════════════`);
    console.log(`\nThis will execute a MARKET BUY order on Binance.US.`);
    console.log(`Press CTRL+C to cancel, or wait 5 seconds to proceed...\n`);
    
    // 5 second countdown
    for (let i = 5; i > 0; i--) {
      process.stdout.write(`\rProceeding in ${i} seconds... `);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    console.log('\n');
    
    // Execute market buy order
    console.log('🛒 Placing MARKET BUY order...');
    const order = await exchange.createMarketBuyOrder('ETH/USD', amountETH);
    
    console.log('\n✅ ORDER EXECUTED SUCCESSFULLY!');
    console.log(`═══════════════════════════════════════════════════════`);
    console.log(`   Order ID: ${order.id}`);
    console.log(`   Status: ${order.status}`);
    console.log(`   Amount: ${order.amount} ETH`);
    console.log(`   Filled: ${order.filled} ETH`);
    console.log(`   Average Price: $${order.average?.toFixed(2) || 'N/A'}`);
    console.log(`   Total Cost: $${order.cost?.toFixed(2) || 'N/A'}`);
    console.log(`   Fee: ${order.fee?.cost || 'N/A'} ${order.fee?.currency || ''}`);
    console.log(`═══════════════════════════════════════════════════════`);
    
    // Verify new balance
    console.log('\n🔍 Verifying new balances...');
    const newBalance = await exchange.fetchBalance();
    const newUsdBalance = newBalance.USD?.free || 0;
    const newEthBalance = newBalance.ETH?.total || 0;
    
    console.log(`\n💼 Updated Balances:`);
    console.log(`   USD: $${newUsdBalance.toFixed(2)} (was $${usdBalance.toFixed(2)})`);
    console.log(`   ETH: ${newEthBalance.toFixed(6)} ETH`);
    console.log(`   ETH Value: ~$${(newEthBalance * currentPrice).toFixed(2)}`);
    
    console.log('\n🎉 Purchase complete! ETH has been added to your account.');
    
    return order;
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    if (error.response) {
      console.error('Response:', error.response);
    }
    process.exit(1);
  }
}

// Main execution
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log('Usage: node buy-eth-cli.mjs <amount_in_eth>');
  console.log('Example: node buy-eth-cli.mjs 0.59');
  console.log('\nThis will buy the specified amount of ETH using a market order.');
  process.exit(1);
}

const amountETH = parseFloat(args[0]);

if (isNaN(amountETH) || amountETH <= 0) {
  console.error('❌ ERROR: Invalid amount. Must be a positive number.');
  console.error(`   You entered: "${args[0]}"`);
  process.exit(1);
}

// Execute purchase
buyETH(amountETH)
  .then(() => {
    console.log('\n✅ Script completed successfully.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error.message);
    process.exit(1);
  });
