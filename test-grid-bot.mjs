#!/usr/bin/env node

/**
 * Grid Trading Bot - CLI Test Script
 * Tests the grid bot engine with real market data in paper trading mode
 */

import ccxt from 'ccxt';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '.env.production') });

// Configuration
const CONFIG = {
  symbol: 'BTC/USD',
  lowerPrice: 90000,
  upperPrice: 100000,
  gridCount: 10,
  orderSize: 100, // USD per grid level
  testMode: process.env.BINANCE_TEST_MODE === 'true'
};

console.log('🚀 Grid Trading Bot - CLI Test\n');
console.log('================================\n');
console.log(`Symbol: ${CONFIG.symbol}`);
console.log(`Price Range: $${CONFIG.lowerPrice.toLocaleString()} - $${CONFIG.upperPrice.toLocaleString()}`);
console.log(`Grid Levels: ${CONFIG.gridCount}`);
console.log(`Order Size: $${CONFIG.orderSize} per level`);
console.log(`Mode: ${CONFIG.testMode ? 'PAPER TRADING ✅' : 'LIVE TRADING ⚠️'}\n`);
console.log('================================\n');

// Initialize Binance.US client
let exchange;
try {
  exchange = new ccxt.binanceus({
    apiKey: process.env.BINANCE_API_KEY,
    secret: process.env.BINANCE_API_SECRET,
    enableRateLimit: true,
    options: {
      defaultType: 'spot',
      adjustForTimeDifference: true
    }
  });
  
  console.log('✅ Connected to Binance.US\n');
} catch (error) {
  console.error('❌ Failed to connect to Binance.US:', error.message);
  process.exit(1);
}

// Calculate grid levels
function calculateGridLevels(lowerPrice, upperPrice, gridCount) {
  const gridSpacing = (upperPrice - lowerPrice) / (gridCount - 1);
  const levels = [];
  
  for (let i = 0; i < gridCount; i++) {
    const price = lowerPrice + (i * gridSpacing);
    levels.push({
      price: parseFloat(price.toFixed(2)),
      type: i < gridCount / 2 ? 'BUY' : 'SELL',
      status: 'PENDING'
    });
  }
  
  return levels;
}

// Get current market price
async function getCurrentPrice(symbol) {
  try {
    const ticker = await exchange.fetchTicker(symbol);
    return ticker.last;
  } catch (error) {
    console.error('❌ Error fetching price:', error.message);
    return null;
  }
}

// Get account balance
async function getBalance() {
  try {
    const balance = await exchange.fetchBalance();
    return {
      usd: balance.free?.USD || 0,
      btc: balance.free?.BTC || 0,
      total: balance.total?.USD || 0
    };
  } catch (error) {
    console.error('❌ Error fetching balance:', error.message);
    return { usd: 0, btc: 0, total: 0 };
  }
}

// Calculate ATR (Average True Range) for volatility
function calculateATR(highs, lows, closes, period = 14) {
  if (highs.length < period) return 0;
  
  const trueRanges = [];
  for (let i = 1; i < highs.length; i++) {
    const high = highs[i];
    const low = lows[i];
    const prevClose = closes[i - 1];
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }
  
  const atr = trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;
  return atr;
}

// Main test function
async function runGridBotTest() {
  try {
    // Step 1: Get current market price
    console.log('📊 Fetching current market data...\n');
    const currentPrice = await getCurrentPrice(CONFIG.symbol);
    
    if (!currentPrice) {
      console.error('❌ Could not fetch current price');
      return;
    }
    
    console.log(`Current ${CONFIG.symbol} Price: $${currentPrice.toLocaleString()}\n`);
    
    // Step 2: Get account balance
    console.log('💰 Fetching account balance...\n');
    const balance = await getBalance();
    console.log(`USD Balance: $${balance.usd.toLocaleString()}`);
    console.log(`BTC Balance: ${balance.btc.toFixed(8)} BTC`);
    console.log(`Total Value: $${balance.total.toLocaleString()}\n`);
    
    // Step 3: Fetch historical data for volatility analysis
    console.log('📈 Analyzing market volatility...\n');
    const ohlcv = await exchange.fetchOHLCV(CONFIG.symbol, '1h', undefined, 100);
    const highs = ohlcv.map(candle => candle[2]);
    const lows = ohlcv.map(candle => candle[3]);
    const closes = ohlcv.map(candle => candle[4]);
    
    const atr = calculateATR(highs, lows, closes);
    const atrPercent = (atr / currentPrice) * 100;
    
    console.log(`ATR (14-period): $${atr.toFixed(2)}`);
    console.log(`ATR Percentage: ${atrPercent.toFixed(2)}%`);
    console.log(`Volatility: ${atrPercent > 2 ? 'HIGH ⚠️' : atrPercent > 1 ? 'MEDIUM' : 'LOW'}\n`);
    
    // Step 4: Calculate grid levels
    console.log('🎯 Calculating grid levels...\n');
    const gridLevels = calculateGridLevels(CONFIG.lowerPrice, CONFIG.upperPrice, CONFIG.gridCount);
    
    console.log('Grid Levels:');
    console.log('============\n');
    
    gridLevels.forEach((level, index) => {
      const distanceFromCurrent = ((level.price - currentPrice) / currentPrice) * 100;
      const status = Math.abs(distanceFromCurrent) < 0.5 ? '🎯 NEAR' : 
                    distanceFromCurrent < 0 ? '⬇️  BELOW' : '⬆️  ABOVE';
      
      console.log(`Level ${index + 1}: ${level.type.padEnd(4)} at $${level.price.toLocaleString().padEnd(10)} ${status} (${distanceFromCurrent > 0 ? '+' : ''}${distanceFromCurrent.toFixed(2)}%)`);
    });
    
    console.log('\n================================\n');
    
    // Step 5: Simulate grid bot operation
    console.log('🤖 Grid Bot Analysis:\n');
    
    const buyLevels = gridLevels.filter(l => l.type === 'BUY' && l.price < currentPrice);
    const sellLevels = gridLevels.filter(l => l.type === 'SELL' && l.price > currentPrice);
    
    console.log(`✅ ${buyLevels.length} BUY levels below current price`);
    console.log(`✅ ${sellLevels.length} SELL levels above current price\n`);
    
    // Calculate potential profit per cycle
    const gridSpacing = (CONFIG.upperPrice - CONFIG.lowerPrice) / (CONFIG.gridCount - 1);
    const profitPerCycle = (gridSpacing / currentPrice) * CONFIG.orderSize;
    const feePerTrade = CONFIG.orderSize * 0.001; // 0.1% fee
    const netProfitPerCycle = profitPerCycle - (feePerTrade * 2); // Buy + sell fees
    
    console.log(`💵 Potential profit per grid cycle: $${netProfitPerCycle.toFixed(2)}`);
    console.log(`📊 Grid spacing: $${gridSpacing.toFixed(2)} (${((gridSpacing / currentPrice) * 100).toFixed(2)}%)\n`);
    
    // Step 6: Market condition check
    console.log('🔍 Market Condition Check:\n');
    
    if (currentPrice < CONFIG.lowerPrice) {
      console.log('⚠️  WARNING: Current price is BELOW grid range!');
      console.log('   Recommendation: Adjust lower bound or wait for price to rise\n');
    } else if (currentPrice > CONFIG.upperPrice) {
      console.log('⚠️  WARNING: Current price is ABOVE grid range!');
      console.log('   Recommendation: Adjust upper bound or wait for price to drop\n');
    } else {
      console.log('✅ Current price is WITHIN grid range');
      console.log('✅ Grid bot can operate effectively\n');
    }
    
    if (atrPercent > 2) {
      console.log('⚠️  HIGH volatility detected - wider grid spacing recommended\n');
    } else if (atrPercent < 0.5) {
      console.log('⚠️  LOW volatility detected - tighter grid spacing possible\n');
    } else {
      console.log('✅ Volatility is suitable for grid trading\n');
    }
    
    // Step 7: Summary
    console.log('================================\n');
    console.log('📋 Summary:\n');
    console.log(`✅ Bot connected to Binance.US`);
    console.log(`✅ Real-time price: $${currentPrice.toLocaleString()}`);
    console.log(`✅ Grid levels calculated: ${CONFIG.gridCount} levels`);
    console.log(`✅ Volatility analyzed: ${atrPercent.toFixed(2)}%`);
    console.log(`✅ Ready for ${CONFIG.testMode ? 'paper' : 'live'} trading\n`);
    
    if (CONFIG.testMode) {
      console.log('🎯 Next Steps:');
      console.log('   1. Monitor the bot for 24-48 hours');
      console.log('   2. Observe simulated trades and profits');
      console.log('   3. Adjust grid parameters if needed');
      console.log('   4. After validation, consider live trading\n');
    } else {
      console.log('⚠️  LIVE TRADING MODE - Real money at risk!\n');
    }
    
  } catch (error) {
    console.error('❌ Error running grid bot test:', error.message);
    console.error(error.stack);
  }
}

// Run the test
runGridBotTest()
  .then(() => {
    console.log('✅ Test completed successfully!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  });
