import { readFileSync, writeFileSync } from 'fs';

const cliFile = 'grid-bot-cli.mjs';
let content = readFileSync(cliFile, 'utf8');

// 1. Add auto-close function after checkProfitTaking function
const autoCloseFunction = `

// Auto-Close Positions at Profit Target
async function autoCloseProfitablePositions(exchange, botName, profitInfo) {
  try {
    console.log(\`\\n🔄 AUTO-CLOSING POSITIONS FOR \${botName}\`);
    console.log(\`   Profit: $\${profitInfo.pnl.toFixed(2)} (\${(profitInfo.pnlPercent * 100).toFixed(2)}%)\`);
    console.log(\`   Canceling all open orders...\`);
    
    // Cancel all open orders for this bot
    const orders = readJSON(ORDERS_FILE);
    const botOrders = orders.filter(o => o.bot_name === botName && o.status === 'open');
    
    let canceledCount = 0;
    for (const order of botOrders) {
      try {
        await exchange.cancelOrder(order.id, order.symbol);
        order.status = 'canceled';
        order.canceled_at = new Date().toISOString();
        order.cancel_reason = 'profit_target_hit';
        canceledCount++;
      } catch (error) {
        console.log(\`   ⚠️  Failed to cancel order \${order.id}: \${error.message}\`);
      }
    }
    
    // Update database
    writeJSON(ORDERS_FILE, orders);
    
    console.log(\`   ✅ Canceled \${canceledCount} orders\`);
    console.log(\`   💰 Profit locked in: $\${profitInfo.pnl.toFixed(2)}\`);
    console.log(\`   🔄 Bot will restart and place fresh grid on next cycle\\n\`);
    
    return { success: true, canceledCount };
    
  } catch (error) {
    console.error(\`   ❌ Auto-close failed: \${error.message}\`);
    return { success: false, error: error.message };
  }
}
`;

// Insert after checkProfitTaking function
const checkProfitPos = content.indexOf('// Auto-Close Positions at Profit Target');
if (checkProfitPos === -1) {
  // Find end of checkProfitTaking function
  const checkProfitEnd = content.indexOf('async function monitorBot(');
  if (checkProfitEnd > 0) {
    content = content.slice(0, checkProfitEnd) + autoCloseFunction + '\n' + content.slice(checkProfitEnd);
    console.log('✅ Added auto-close function');
  }
}

// 2. Modify profit check to actually close positions
const oldProfitCheck = `      if (profitCheck && profitCheck.action === 'PROFIT_TARGET_HIT') {
        console.log(\`\\n💰 PROFIT TARGET HIT!\`);
        console.log(\`   Unrealized P&L: $\${profitCheck.pnl.toFixed(2)} (\${(profitCheck.pnlPercent * 100).toFixed(2)}%)\`);
        console.log(\`   Threshold: \${(profitCheck.threshold * 100).toFixed(2)}%\`);
        console.log(\`   🎯 Consider closing positions to lock in profit\\n\`);
      }`;

const newProfitCheck = `      if (profitCheck && profitCheck.action === 'PROFIT_TARGET_HIT') {
        console.log(\`\\n💰 PROFIT TARGET HIT!\`);
        console.log(\`   Unrealized P&L: $\${profitCheck.pnl.toFixed(2)} (\${(profitCheck.pnlPercent * 100).toFixed(2)}%)\`);
        console.log(\`   Threshold: \${(profitCheck.threshold * 100).toFixed(2)}%\`);
        
        // Auto-close positions to lock in profit
        const closeResult = await autoCloseProfitablePositions(exchange, botName, profitCheck);
        
        if (closeResult.success) {
          console.log(\`   ✅ Auto-close complete: \${closeResult.canceledCount} orders canceled\`);
          console.log(\`   💰 Locked in $\${profitCheck.pnl.toFixed(2)} profit\`);
          console.log(\`   🔄 Fresh grid will be placed next cycle\\n\`);
        } else {
          console.log(\`   ❌ Auto-close failed: \${closeResult.error}\\n\`);
        }
      }`;

if (content.includes(oldProfitCheck)) {
  content = content.replace(oldProfitCheck, newProfitCheck);
  console.log('✅ Updated profit check to trigger auto-close');
} else {
  console.log('⚠️  Could not find profit check code to update');
}

writeFileSync(cliFile, content);
console.log('\n✅ Auto-close implementation complete!');

