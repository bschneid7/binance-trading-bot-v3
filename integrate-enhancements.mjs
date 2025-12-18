import fs from 'fs';

const cliFile = 'grid-bot-cli.mjs';
let content = fs.readFileSync(cliFile, 'utf8');

// 1. Add import at the top (after existing imports)
const importLine = `import enhancements from './enhancements.mjs';\n`;
if (!content.includes('enhancements.mjs')) {
  // Find the last import statement
  const lastImportIndex = content.lastIndexOf('import ');
  const nextNewline = content.indexOf('\n', lastImportIndex);
  content = content.slice(0, nextNewline + 1) + importLine + content.slice(nextNewline + 1);
  console.log('✅ Added enhancement module import');
}

// 2. Enhance order size calculation (around line 445)
// Find: bot.order_size / level.price
// Replace with: enhanced order size calculation

const orderSizePattern = /amount:\s*bot\.order_size\s*\/\s*level\.price/g;
const enhancedOrderSize = `amount: (() => {
          let baseSize = bot.order_size;
          
          // Apply Enhancement #5: Dynamic Spacing
          if (enhancements.isEnhancementEnabled('DYNAMIC_SPACING', bot.name)) {
            const atr = 0.02; // Default ATR, could fetch real-time
            baseSize = enhancements.applyDynamicSpacing(baseSize, currentPrice, level.price, atr);
          }
          
          // Apply Enhancement #6: Smart Sizing
          if (enhancements.isEnhancementEnabled('SMART_SIZING', bot.name)) {
            baseSize = enhancements.applySmartSizing(
              baseSize,
              bot.capital,
              bot.grid_count,
              currentPrice,
              level.price
            );
          }
          
          return baseSize / level.price;
        })()`;

if (content.match(orderSizePattern)) {
  content = content.replace(orderSizePattern, enhancedOrderSize);
  console.log('✅ Enhanced order size calculation');
}

// 3. Add profit-taking check in monitor loop (after fill detection)
// Find the section after newTrades processing
const profitCheckCode = `
          // Enhancement #7: Profit-Taking Check
          if (enhancements.isEnhancementEnabled('PROFIT_TAKING', bot.name)) {
            try {
              const currentPrices = { [bot.symbol]: currentPrice };
              const profitCheck = enhancements.shouldTakeProfit(
                activeOrders,
                currentPrices,
                enhancements.ENHANCEMENTS.PROFIT_TAKING.threshold
              );
              
              if (profitCheck.action === 'CLOSE_PROFITABLE') {
                console.log(\`💰 PROFIT TARGET HIT: \${profitCheck.reason}\`);
                console.log(\`   Unrealized P&L: $\${profitCheck.pnl.toFixed(2)} (\${(profitCheck.pnlPercent * 100).toFixed(2)}%)\`);
                console.log(\`   Consider closing positions to lock in profits\`);
                // Note: Actual closing logic would go here in production
                // For now, just alert and continue trading
              }
            } catch (error) {
              console.error('⚠️  Profit-taking check failed:', error.message);
            }
          }
`;

// Insert after the "Recorded X trade(s)" console.log
const insertAfter = /console\.log\(`📝 Recorded \$\{newTrades\.length\} trade\(s\) to grid-trades\.json`\);/;
if (content.match(insertAfter) && !content.includes('Enhancement #7: Profit-Taking')) {
  content = content.replace(insertAfter, (match) => match + profitCheckCode);
  console.log('✅ Added profit-taking logic');
}

// Write the enhanced version
fs.writeFileSync(cliFile, content);
console.log('');
console.log('✅ Integration complete!');
console.log('');
console.log('Changes made:');
console.log('  1. Imported enhancements.mjs module');
console.log('  2. Enhanced order size calculation (Enhancements #5 & #6)');
console.log('  3. Added profit-taking checks (Enhancement #7)');
console.log('');
console.log('Feature flags (in enhancements.mjs):');
console.log('  - DYNAMIC_SPACING: enabled for live-sol-bot only');
console.log('  - SMART_SIZING: enabled for live-sol-bot only');
console.log('  - PROFIT_TAKING: enabled for all bots');

