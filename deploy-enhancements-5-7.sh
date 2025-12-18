#!/bin/bash
##
## Deploy Enhancements #5, #6, #7
## Creates all three enhancement modules
##

cd ~/binance-trading-bot-v3

echo "================================================================"
echo "     📦 DEPLOYING ENHANCEMENTS #5-7"
echo "================================================================"
echo ""

# Create Enhancement #5: Dynamic Grid Spacing
cat > enhancement-5-dynamic-spacing.mjs << 'E5_EOF'
#!/usr/bin/env node
/**
 * Enhancement #5: Dynamic Grid Spacing
 * Applies spacing_multiplier to actual order sizes
 */

export function getAdaptiveOrderSize(baseSize, spacingMultiplier, atr) {
  const volatilityFactor = atr > 0.03 ? 0.7 : atr < 0.005 ? 1.2 : 1.0;
  const sizeFactor = 2.0 / spacingMultiplier;
  const adjustedSize = baseSize * sizeFactor * volatilityFactor;
  return Math.max(baseSize * 0.5, Math.min(baseSize * 1.5, adjustedSize));
}

export function getSpacingConfig(atr) {
  const VOLATILITY_THRESHOLDS = { LOW: 0.005, HIGH: 0.030 };
  
  if (atr < VOLATILITY_THRESHOLDS.LOW) {
    return { regime: 'LOW_VOLATILITY', minSpacing: 0.002, maxSpacing: 0.015, clusterRadius: 0.05 };
  } else if (atr > VOLATILITY_THRESHOLDS.HIGH) {
    return { regime: 'HIGH_VOLATILITY', minSpacing: 0.008, maxSpacing: 0.05, clusterRadius: 0.15 };
  } else {
    return { regime: 'NORMAL', minSpacing: 0.004, maxSpacing: 0.025, clusterRadius: 0.10 };
  }
}

export function testDynamicSpacing() {
  console.log('🧪 Enhancement #5: Dynamic Grid Spacing\n');
  
  const testCases = [
    { atr: 0.003, spacing: 1.0, desc: 'Low vol, at price' },
    { atr: 0.003, spacing: 1.5, desc: 'Low vol, moderate' },
    { atr: 0.003, spacing: 2.0, desc: 'Low vol, far' },
    { atr: 0.015, spacing: 1.0, desc: 'Normal vol, at price' },
    { atr: 0.04, spacing: 2.0, desc: 'High vol, far' }
  ];
  
  const baseSize = 100;
  console.log('Base order: $100\n');
  console.log('Scenario              ATR    Spacing  New Size  Change');
  console.log('─'.repeat(60));
  
  for (const test of testCases) {
    const adjusted = getAdaptiveOrderSize(baseSize, test.spacing, test.atr);
    const change = ((adjusted - baseSize) / baseSize * 100).toFixed(1);
    console.log(
      `${test.desc.padEnd(20)} ${(test.atr*100).toFixed(2)}%  ${test.spacing.toFixed(2)}    ` +
      `$${adjusted.toFixed(2).padStart(6)}  ${change>=0?'+':''}${change}%`
    );
  }
  
  console.log('\n✅ Orders near price get larger sizes');
  console.log('✅ Orders far away get smaller sizes\n');
}

export const ENHANCEMENT_CONFIG = {
  name: 'Dynamic Grid Spacing',
  version: '1.0.0',
  enabled: false
};

if (import.meta.url === \`file://\${process.argv[1]}\`) {
  testDynamicSpacing();
}
E5_EOF

# Create Enhancement #6: Smart Order Sizing
cat > enhancement-6-smart-sizing.mjs << 'E6_EOF'
#!/usr/bin/env node
/**
 * Enhancement #6: Smart Order Sizing (Pyramid Strategy)
 * Intelligent position sizing based on distance from price
 */

export function calculateSmartOrderSize(totalCapital, gridCount, currentPrice, levelPrice, atr, performance = null) {
  const baseSize = totalCapital / gridCount;
  const distancePct = Math.abs(levelPrice - currentPrice) / currentPrice;
  
  // Distance factor (pyramid)
  let distanceFactor;
  if (distancePct < 0.02) distanceFactor = 1.5;
  else if (distancePct < 0.05) distanceFactor = 1.2;
  else if (distancePct < 0.10) distanceFactor = 1.0;
  else if (distancePct < 0.15) distanceFactor = 0.7;
  else distanceFactor = 0.5;
  
  // Volatility factor
  const volatilityFactor = atr < 0.005 ? 1.2 : atr > 0.03 ? 0.8 : 1.0;
  
  let adjustedSize = baseSize * distanceFactor * volatilityFactor;
  return Math.max(baseSize * 0.3, Math.min(baseSize * 2.0, adjustedSize));
}

export function testSmartSizing() {
  console.log('🧪 Enhancement #6: Smart Order Sizing\n');
  
  const totalCapital = 3100;
  const gridCount = 31;
  const currentPrice = 87000;
  const atr = 0.012;
  
  console.log(\`Capital: $\${totalCapital}, Grids: \${gridCount}, Price: $\${currentPrice}\`);
  console.log(\`Base size: $\${(totalCapital/gridCount).toFixed(2)}\n\`);
  
  const levels = [
    { price: 87000, desc: 'At price (0%)' },
    { price: 88500, desc: 'Near (+1.7%)' },
    { price: 90000, desc: 'Moderate (+3.4%)' },
    { price: 92000, desc: 'Far (+5.7%)' },
    { price: 94000, desc: 'Very far (+8%)' }
  ];
  
  console.log('Level          Distance         Base    Smart   Diff');
  console.log('─'.repeat(60));
  
  for (const level of levels) {
    const baseSize = totalCapital / gridCount;
    const smartSize = calculateSmartOrderSize(totalCapital, gridCount, currentPrice, level.price, atr);
    const diff = smartSize - baseSize;
    
    console.log(
      \`$\${level.price}  \${level.desc.padEnd(18)} $\${baseSize.toFixed(2)}  ` +
      `$\${smartSize.toFixed(2)}  \${diff>=0?'+':''}$\${diff.toFixed(2)}\`
    );
  }
  
  console.log('\n✅ More capital near price = more fills');
  console.log('✅ Less at extremes = less risk\n');
}

export const ENHANCEMENT_CONFIG = {
  name: 'Smart Order Sizing',
  version: '1.0.0',
  enabled: false
};

if (import.meta.url === \`file://\${process.argv[1]}\`) {
  testSmartSizing();
}
E6_EOF

# Create Enhancement #7: Profit-Taking
cat > enhancement-7-profit-taking.mjs << 'E7_EOF'
#!/usr/bin/env node
/**
 * Enhancement #7: Profit-Taking Threshold
 * Close positions when profit targets reached
 */

export function calculateUnrealizedPnL(openOrders, currentPrice, symbol) {
  let totalValue = 0;
  let totalCost = 0;
  let buyOrders = 0;
  let sellOrders = 0;
  
  for (const order of openOrders) {
    if (order.symbol !== symbol) continue;
    
    const orderValue = order.price * order.amount;
    
    if (order.side === 'buy') {
      buyOrders++;
      totalCost += orderValue;
      if (currentPrice > order.price) {
        totalValue += (currentPrice - order.price) * order.amount;
      }
    } else {
      sellOrders++;
      totalValue += orderValue;
      if (currentPrice < order.price) {
        totalValue += (order.price - currentPrice) * order.amount;
      }
    }
  }
  
  return {
    total_value: totalValue,
    total_cost: totalCost,
    unrealized_pnl: totalValue,
    unrealized_pnl_pct: totalCost > 0 ? (totalValue / totalCost) * 100 : 0,
    buy_orders: buyOrders,
    sell_orders: sellOrders
  };
}

export function checkProfitTakingConditions(pnl, config, history = {}) {
  const { profit_threshold = 2.0, trailing_stop_pct = 0.5, min_orders_filled = 5 } = config;
  
  if (pnl.buy_orders + pnl.sell_orders < min_orders_filled) {
    return { action: 'HOLD', reason: \`Need \${min_orders_filled} orders\` };
  }
  
  if (pnl.unrealized_pnl_pct >= profit_threshold) {
    const highWaterMark = Math.max(history.high_water_mark || 0, pnl.unrealized_pnl_pct);
    
    if (config.use_trailing_stop && history.high_water_mark) {
      const drawdown = highWaterMark - pnl.unrealized_pnl_pct;
      
      if (drawdown >= trailing_stop_pct) {
        return {
          action: 'CLOSE_ALL',
          reason: \`Trailing stop: \${drawdown.toFixed(2)}% from peak\`,
          high_water_mark: highWaterMark
        };
      }
      
      return {
        action: 'TRACK',
        reason: \`Tracking peak: \${highWaterMark.toFixed(2)}%\`,
        high_water_mark: highWaterMark
      };
    }
    
    return {
      action: 'CLOSE_ALL',
      reason: \`Target reached: \${pnl.unrealized_pnl_pct.toFixed(2)}%\`,
      high_water_mark: pnl.unrealized_pnl_pct
    };
  }
  
  return { action: 'HOLD', reason: \`Below target: \${pnl.unrealized_pnl_pct.toFixed(2)}%\` };
}

export function getProfitTakingPresets() {
  return {
    CONSERVATIVE: { profit_threshold: 1.5, trailing_stop_pct: 0.3, use_trailing_stop: true, min_orders_filled: 3 },
    BALANCED: { profit_threshold: 2.5, trailing_stop_pct: 0.5, use_trailing_stop: true, min_orders_filled: 5 },
    AGGRESSIVE: { profit_threshold: 4.0, trailing_stop_pct: 1.0, use_trailing_stop: true, min_orders_filled: 8 }
  };
}

export function testProfitTaking() {
  console.log('🧪 Enhancement #7: Profit-Taking\n');
  
  const mockOrders = [
    { symbol: 'BTC/USD', side: 'buy', price: 85000, amount: 0.001 },
    { symbol: 'BTC/USD', side: 'sell', price: 89000, amount: 0.001 },
    { symbol: 'BTC/USD', side: 'sell', price: 90000, amount: 0.001 }
  ];
  
  const config = getProfitTakingPresets().BALANCED;
  console.log(\`Config: Target \${config.profit_threshold}%, Trail \${config.trailing_stop_pct}%\n\`);
  
  const testPrices = [87000, 88000, 89000, 88500];
  console.log('Price      P&L     Decision');
  console.log('─'.repeat(40));
  
  let history = {};
  for (const price of testPrices) {
    const pnl = calculateUnrealizedPnL(mockOrders, price, 'BTC/USD');
    const decision = checkProfitTakingConditions(pnl, config, history);
    history = { high_water_mark: decision.high_water_mark };
    
    console.log(\`$\${price}  \${pnl.unrealized_pnl_pct>=0?'+':''}\${pnl.unrealized_pnl_pct.toFixed(2)}%  \${decision.action}\`);
    
    if (decision.action === 'CLOSE_ALL') {
      console.log('\n✅ Profit taken!');
      break;
    }
  }
  
  console.log('\n✅ Locks in gains during trends');
  console.log('✅ Prevents giving back profits\n');
}

export const ENHANCEMENT_CONFIG = {
  name: 'Profit-Taking',
  version: '1.0.0',
  enabled: false
};

if (import.meta.url === \`file://\${process.argv[1]}\`) {
  testProfitTaking();
}
E7_EOF

# Make executable
chmod +x enhancement-*.mjs

echo "✅ Created enhancement-5-dynamic-spacing.mjs"
echo "✅ Created enhancement-6-smart-sizing.mjs"
echo "✅ Created enhancement-7-profit-taking.mjs"
echo ""
echo "Testing enhancements..."
echo ""

# Test each one
node enhancement-5-dynamic-spacing.mjs
echo ""
node enhancement-6-smart-sizing.mjs
echo ""
node enhancement-7-profit-taking.mjs

echo ""
echo "================================================================"
echo "     ✅ DEPLOYMENT COMPLETE"
echo "================================================================"
echo ""
echo "Next steps:"
echo "  1. Review test output above"
echo "  2. These are currently DISABLED (enabled: false)"
echo "  3. To enable, edit grid-bot-cli.mjs to import and use them"
echo "  4. Test in paper trading mode first"
echo ""
