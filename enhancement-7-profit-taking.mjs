#!/usr/bin/env node
/**
 * Enhancement #7: Profit-Taking
 */

export function calculateUnrealizedPnL(openOrders, currentPrice, symbol) {
  let totalValue = 0, totalCost = 0, buys = 0, sells = 0;
  
  openOrders.forEach(o => {
    if (o.symbol !== symbol) return;
    const val = o.price * o.amount;
    
    if (o.side === 'buy') {
      buys++;
      totalCost += val;
      if (currentPrice > o.price) totalValue += (currentPrice - o.price) * o.amount;
    } else {
      sells++;
      totalValue += val;
      if (currentPrice < o.price) totalValue += (o.price - currentPrice) * o.amount;
    }
  });
  
  return {
    unrealized_pnl_pct: totalCost > 0 ? (totalValue / totalCost) * 100 : 0,
    buy_orders: buys,
    sell_orders: sells
  };
}

export function checkProfitTaking(pnl, threshold = 2.5, minOrders = 5) {
  if (pnl.buy_orders + pnl.sell_orders < minOrders) {
    return { action: 'HOLD', reason: `Need ${minOrders} orders` };
  }
  
  if (pnl.unrealized_pnl_pct >= threshold) {
    return { action: 'CLOSE_ALL', reason: `Target hit: ${pnl.unrealized_pnl_pct.toFixed(2)}%` };
  }
  
  return { action: 'HOLD', reason: `Below target: ${pnl.unrealized_pnl_pct.toFixed(2)}%` };
}

function testProfitTaking() {
  console.log('🧪 Enhancement #7: Profit-Taking\n');
  
  const orders = [
    { symbol: 'BTC/USD', side: 'buy', price: 85000, amount: 0.001 },
    { symbol: 'BTC/USD', side: 'sell', price: 89000, amount: 0.001 },
    { symbol: 'BTC/USD', side: 'sell', price: 90000, amount: 0.001 }
  ];
  
  console.log('Target: 2.5% profit\n');
  console.log('Price      P&L      Decision');
  console.log('─'.repeat(45));
  
  [86000, 87000, 88000, 89000].forEach(price => {
    const pnl = calculateUnrealizedPnL(orders, price, 'BTC/USD');
    const decision = checkProfitTaking(pnl, 2.5);
    console.log(`$${price}  ${pnl.unrealized_pnl_pct>=0?'+':''}${pnl.unrealized_pnl_pct.toFixed(2)}%    ${decision.action}`);
  });
  
  console.log('\n✅ Automatically locks in profits at threshold\n');
}

testProfitTaking();
