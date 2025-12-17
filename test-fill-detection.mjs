#!/usr/bin/env node

import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ORDERS_FILE = join(__dirname, 'data', 'active-orders.json');
const TRADES_FILE = join(__dirname, 'data', 'grid-trades.json');
const BACKUP_FILE = join(__dirname, 'data', 'active-orders-TEST-BACKUP.json');

function readJSON(filepath) {
  try {
    const data = fs.readFileSync(filepath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`❌ Error reading ${filepath}:`, error.message);
    return [];
  }
}

function writeJSON(filepath, data) {
  try {
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(`❌ Error writing ${filepath}:`, error.message);
    return false;
  }
}

async function main() {
  console.log('🧪 FILL DETECTION TEST');
  console.log('='.repeat(60));
  console.log('');
  
  console.log('📋 Step 1: Backing up active-orders.json...');
  const originalOrders = readJSON(ORDERS_FILE);
  if (originalOrders.length === 0) {
    console.error('❌ No orders found in database!');
    process.exit(1);
  }
  
  writeJSON(BACKUP_FILE, originalOrders);
  console.log(`   ✅ Backed up ${originalOrders.length} orders`);
  console.log('');
  
  console.log('🔍 Step 2: Finding a BTC order to simulate fill...');
  const btcBuyOrder = originalOrders.find(o => 
    o.symbol === 'BTC/USD' && 
    o.side === 'buy' && 
    o.status === 'open'
  );
  
  if (!btcBuyOrder) {
    console.error('❌ No open BTC BUY orders found!');
    writeJSON(ORDERS_FILE, originalOrders);
    process.exit(1);
  }
  
  console.log(`   ✅ Selected: ${btcBuyOrder.side.toUpperCase()} ${btcBuyOrder.amount} @ $${btcBuyOrder.price}`);
  console.log(`      Order ID: ${btcBuyOrder.id}`);
  console.log('');
  
  console.log('📊 Step 3: Counting current fills...');
  const tradesBefore = readJSON(TRADES_FILE);
  const fillsBeforeCount = tradesBefore.length;
  console.log(`   Current fills: ${fillsBeforeCount}`);
  console.log('');
  
  console.log('⚡ Step 4: Simulating fill...');
  const testOrders = originalOrders.map(o => {
    if (o.id === btcBuyOrder.id) {
      return {
        ...o,
        status: 'closed',
        filled_at: new Date().toISOString(),
        filled_price: o.price
      };
    }
    return o;
  });
  
  writeJSON(ORDERS_FILE, testOrders);
  console.log('   ✅ Marked order as FILLED');
  console.log('');
  
  console.log('⏳ Step 5: Waiting for monitor to detect (90s)...');
  console.log('');
  
  let detected = false;
  const startTime = Date.now();
  const maxWait = 90000;
  
  while (Date.now() - startTime < maxWait) {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    process.stdout.write(`\r   ⏱️  Elapsed: ${elapsed}s / 90s`);
    
    const tradesNow = readJSON(TRADES_FILE);
    if (tradesNow.length > fillsBeforeCount) {
      detected = true;
      console.log('\n');
      console.log('   🎉 FILL DETECTED AND RECORDED!');
      
      const newFill = tradesNow[tradesNow.length - 1];
      console.log('');
      console.log('   New trade:');
      console.log(`      Bot: ${newFill.bot_name}`);
      console.log(`      Symbol: ${newFill.symbol}`);
      console.log(`      Side: ${newFill.side.toUpperCase()}`);
      console.log(`      Price: $${newFill.price}`);
      console.log(`      Amount: ${newFill.amount}`);
      console.log(`      Value: $${newFill.value.toFixed(2)}`);
      break;
    }
    
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log('\n');
  
  if (!detected) {
    console.log('   ⚠️  No fill detected after 90 seconds');
    console.log('   Fill detection may not be working');
  }
  
  console.log('');
  console.log('🔄 Step 6: Restoring original orders...');
  writeJSON(ORDERS_FILE, originalOrders);
  console.log('   ✅ Restored');
  console.log('');
  
  console.log('='.repeat(60));
  console.log('📋 TEST SUMMARY');
  console.log('='.repeat(60));
  
  const tradesAfter = readJSON(TRADES_FILE);
  console.log(`Fills before: ${fillsBeforeCount}`);
  console.log(`Fills after:  ${tradesAfter.length}`);
  console.log(`New fills:    ${tradesAfter.length - fillsBeforeCount}`);
  console.log('');
  
  if (detected) {
    console.log('✅ TEST PASSED: Fill detection working!');
  } else {
    console.log('❌ TEST FAILED: Fill detection not working');
  }
  console.log('');
}

main().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
