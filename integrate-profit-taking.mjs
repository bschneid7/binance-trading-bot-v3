import { readFileSync, writeFileSync } from 'fs';

const cliFile = 'grid-bot-cli.mjs';
let content = readFileSync(cliFile, 'utf8');

// 1. Add profit-taking function before monitorBot function
const profitTakingCode = `
// Profit-Taking Check Function
async function checkProfitTaking(exchange, botName, activeOrders) {
  try {
    if (activeOrders.length === 0) return null;
    
    const PROFIT_THRESHOLD = 0.025; // 2.5%
    const symbols = [...new Set(activeOrders.map(o => o.symbol))];
    const prices = {};
    
    for (const symbol of symbols) {
      const ticker = await exchange.fetchTicker(symbol);
      prices[symbol] = ticker.last;
    }
    
    let totalCost = 0;
    let totalValue = 0;
    
    for (const order of activeOrders) {
      const currentPrice = prices[order.symbol];
      const orderValue = order.price * order.amount;
      
      if (order.side === 'buy') {
        totalCost += orderValue;
        totalValue += currentPrice * order.amount;
      } else {
        totalCost += orderValue * 0.98;
        totalValue += currentPrice * order.amount;
      }
    }
    
    const unrealizedPnL = totalValue - totalCost;
    const pnlPercent = totalCost > 0 ? unrealizedPnL / totalCost : 0;
    
    if (pnlPercent >= PROFIT_THRESHOLD) {
      return {
        action: 'PROFIT_TARGET_HIT',
        pnl: unrealizedPnL,
        pnlPercent,
        threshold: PROFIT_THRESHOLD
      };
    }
    
    return null;
  } catch (error) {
    console.error('⚠️  Profit-taking check failed:', error.message);
    return null;
  }
}

`;

// Insert before monitorBot function
const monitorBotPos = content.indexOf('async function monitorBot(');
if (monitorBotPos > 0) {
  content = content.slice(0, monitorBotPos) + profitTakingCode + content.slice(monitorBotPos);
  console.log('✅ Added profit-taking function');
}

// 2. Add profit check call in monitoring loop (after Stats line)
const statsPattern = /console\.log\(`📊 Stats: \$\{totalFills\} fills, \$\{totalReplacements\} replacements`\);/;

const profitCheckCall = `
      
      // Check for profit-taking opportunities
      const profitCheck = await checkProfitTaking(exchange, botName, activeOrders);
      if (profitCheck && profitCheck.action === 'PROFIT_TARGET_HIT') {
        console.log(\`\\n💰 PROFIT TARGET HIT!\`);
        console.log(\`   Unrealized P&L: $\${profitCheck.pnl.toFixed(2)} (\${(profitCheck.pnlPercent * 100).toFixed(2)}%)\`);
        console.log(\`   Threshold: \${(profitCheck.threshold * 100).toFixed(2)}%\`);
        console.log(\`   🎯 Consider closing positions to lock in profit\\n\`);
      }`;

if (content.match(statsPattern)) {
  content = content.replace(statsPattern, (match) => match + profitCheckCall);
  console.log('✅ Added profit check to monitoring loop');
}

// Write enhanced version
writeFileSync(cliFile, content);
console.log('');
console.log('✅ Integration complete!');
console.log('');
console.log('Changes:');
console.log('  1. Added checkProfitTaking() function');
console.log('  2. Integrated into monitoring loop (all 3 bots)');
console.log('  3. Checks every cycle (60 seconds)');
console.log('  4. Alerts when 2.5% profit threshold hit');

