#!/usr/bin/env node
/**
 * Enhancement #6: Smart Order Sizing
 */

export function calculateSmartOrderSize(totalCapital, gridCount, currentPrice, levelPrice, atr) {
  const baseSize = totalCapital / gridCount;
  const distancePct = Math.abs(levelPrice - currentPrice) / currentPrice;
  
  let distanceFactor;
  if (distancePct < 0.02) distanceFactor = 1.5;
  else if (distancePct < 0.05) distanceFactor = 1.2;
  else if (distancePct < 0.10) distanceFactor = 1.0;
  else if (distancePct < 0.15) distanceFactor = 0.7;
  else distanceFactor = 0.5;
  
  const volatilityFactor = atr < 0.005 ? 1.2 : atr > 0.03 ? 0.8 : 1.0;
  let adjustedSize = baseSize * distanceFactor * volatilityFactor;
  return Math.max(baseSize * 0.3, Math.min(baseSize * 2.0, adjustedSize));
}

function testSmartSizing() {
  console.log('🧪 Enhancement #6: Smart Order Sizing\n');
  
  const capital = 3100, grids = 31, price = 87000, atr = 0.012;
  const baseSize = capital / grids;
  
  console.log(`Capital: $${capital}, Grids: ${grids}, Price: $${price}`);
  console.log(`Base size: $${baseSize.toFixed(2)}\n`);
  
  const levels = [
    { price: 87000, desc: 'At price (0%)' },
    { price: 88500, desc: 'Near (+1.7%)' },
    { price: 90000, desc: 'Moderate (+3.4%)' },
    { price: 92000, desc: 'Far (+5.7%)' },
    { price: 94000, desc: 'Very far (+8%)' }
  ];
  
  console.log('Level      Distance           Base    Smart   Diff');
  console.log('─'.repeat(60));
  
  levels.forEach(l => {
    const smart = calculateSmartOrderSize(capital, grids, price, l.price, atr);
    const diff = smart - baseSize;
    console.log(`$${l.price}  ${l.desc.padEnd(20)} $${baseSize.toFixed(2)}  $${smart.toFixed(2)}  ${diff>=0?'+':''}$${diff.toFixed(2)}`);
  });
  
  console.log('\n✅ Pyramid strategy: More capital where fills happen\n');
}

testSmartSizing();
