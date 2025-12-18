import { readFileSync, writeFileSync } from 'fs';

const cliFile = 'grid-bot-cli.mjs';
let content = readFileSync(cliFile, 'utf8');

// Find the profit check call and add activeOrders fetch before it
const oldCode = `      // Check for profit-taking opportunities
      const profitCheck = await checkProfitTaking(exchange, botName, activeOrders);`;

const newCode = `      // Check for profit-taking opportunities
      const orders = readJSON(ORDERS_FILE);
      const activeOrders = orders.filter(o => o.bot_name === botName && o.status === 'open');
      const profitCheck = await checkProfitTaking(exchange, botName, activeOrders);`;

if (content.includes(oldCode)) {
  content = content.replace(oldCode, newCode);
  console.log('✅ Fixed activeOrders reference');
  writeFileSync(cliFile, content);
} else {
  console.log('🔴 Could not find target code');
  process.exit(1);
}
