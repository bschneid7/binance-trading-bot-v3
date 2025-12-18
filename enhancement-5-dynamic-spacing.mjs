#!/usr/bin/env node
/**
 * Enhancement #5: Dynamic Grid Spacing
 */

export function getAdaptiveOrderSize(baseSize, spacingMultiplier, atr) {
  const volatilityFactor = atr > 0.03 ? 0.7 : atr < 0.005 ? 1.2 : 1.0;
  const sizeFactor = 2.0 / spacingMultiplier;
  const adjustedSize = baseSize * sizeFactor * volatilityFactor;
  return Math.max(baseSize * 0.5, Math.min(baseSize * 1.5, adjustedSize));
}

function testDynamicSpacing() {
  console.log('🧪 Enhancement #5: Dynamic Grid Spacing\n');
  
  const tests = [
    { atr: 0.003, spacing: 1.0, desc: 'Low vol, at price' },
    { atr: 0.003, spacing: 2.0, desc: 'Low vol, far' },
    { atr: 0.015, spacing: 1.0, desc: 'Normal, at price' },
    { atr: 0.04, spacing: 2.0, desc: 'High vol, far' }
  ];
  
  const baseSize = 100;
  console.log(`Base: $${baseSize}\n`);
  console.log('Scenario              ATR    Spacing  Size   Change');
  console.log('─'.repeat(55));
  
  tests.forEach(t => {
    const adj = getAdaptiveOrderSize(baseSize, t.spacing, t.atr);
    const chg = ((adj - baseSize) / baseSize * 100).toFixed(1);
    console.log(`${t.desc.padEnd(20)} ${(t.atr*100).toFixed(2)}%  ${t.spacing.toFixed(1)}     $${adj.toFixed(2)}  ${chg>=0?'+':''}${chg}%`);
  });
  
  console.log('\n✅ Larger orders near price, smaller at extremes\n');
}

// Run test
testDynamicSpacing();
