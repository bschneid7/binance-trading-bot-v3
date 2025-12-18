import { readFileSync, writeFileSync } from 'fs';

const cliFile = 'grid-bot-cli.mjs';
let content = readFileSync(cliFile, 'utf8');

// Add restart logic after profit check
const restartLogic = `
      
      // Check if bot has no orders and needs restart
      if (activeOrders.length === 0) {
        console.log(\`\\n🔄 NO ACTIVE ORDERS DETECTED - Restarting bot...\`);
        
        // Read bot config
        const bots = readJSON(BOTS_FILE);
        const bot = bots.find(b => b.name === botName);
        
        if (bot) {
          try {
            console.log(\`   Placing fresh grid for \${botName}...\`);
            
            // Place grid orders using existing bot configuration
            const { exchange: restartExchange } = initExchange();
            const ticker = await restartExchange.fetchTicker(bot.symbol);
            const currentPrice = ticker.last;
            
            const gridLevels = calculateGridLevels(
              bot.lower_price,
              bot.upper_price,
              bot.grid_count,
              currentPrice,
              bot.spacing_type || 'geometric'
            );
            
            let placedCount = 0;
            for (const level of gridLevels) {
              try {
                const side = level.price < currentPrice ? 'buy' : 'sell';
                const amount = bot.order_size / level.price;
                
                const order = await restartExchange.createLimitOrder(
                  bot.symbol,
                  side,
                  amount,
                  level.price
                );
                
                // Save to database
                const orders = readJSON(ORDERS_FILE);
                orders.push({
                  id: order.id,
                  bot_name: botName,
                  symbol: bot.symbol,
                  side: side,
                  price: level.price,
                  amount: amount,
                  status: 'open',
                  created_at: new Date().toISOString()
                });
                writeJSON(ORDERS_FILE, orders);
                
                placedCount++;
              } catch (error) {
                console.log(\`   ⚠️  Failed to place order at \${level.price}: \${error.message}\`);
              }
            }
            
            console.log(\`   ✅ Placed \${placedCount} new orders\`);
            console.log(\`   🎯 Fresh grid active - trading resumed\\n\`);
            
          } catch (error) {
            console.error(\`   ❌ Failed to restart bot: \${error.message}\\n\`);
          }
        }
      }`;

// Find where to insert (after profit check)
const insertAfter = `        }
      }`;

const insertPos = content.lastIndexOf(insertAfter);
if (insertPos > 0) {
  const afterPos = insertPos + insertAfter.length;
  content = content.slice(0, afterPos) + restartLogic + content.slice(afterPos);
  console.log('✅ Added auto-restart logic');
  writeFileSync(cliFile, content);
} else {
  console.log('🔴 Could not find insertion point');
  process.exit(1);
}

