#!/usr/bin/env node

/**
 * Update Grid Range Script
 * 
 * Updates the grid range for a bot in the database.
 * After running this, use the rebalance command to apply the new range.
 * 
 * Usage:
 *   node update-grid-range.mjs --name <bot_name> --lower <price> --upper <price>
 * 
 * Example:
 *   node update-grid-range.mjs --name live-btc-bot --lower 80000 --upper 105000
 */

import { getDatabase } from './database.mjs';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.production' });

const db = getDatabase();

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const value = argv[i + 1];
      args[key] = value;
      i++;
    }
  }
  
  return args;
}

async function main() {
  const args = parseArgs();
  
  if (!args.name) {
    console.error('❌ Error: Bot name required (--name)');
    process.exit(1);
  }
  
  if (!args.lower || !args.upper) {
    console.error('❌ Error: Both --lower and --upper prices required');
    process.exit(1);
  }
  
  const botName = args.name;
  const newLower = parseFloat(args.lower);
  const newUpper = parseFloat(args.upper);
  
  if (isNaN(newLower) || isNaN(newUpper)) {
    console.error('❌ Error: Invalid price values');
    process.exit(1);
  }
  
  if (newLower >= newUpper) {
    console.error('❌ Error: Lower price must be less than upper price');
    process.exit(1);
  }
  
  // Get current bot config
  const bot = db.getBot(botName);
  if (!bot) {
    console.error(`❌ Error: Bot "${botName}" not found`);
    process.exit(1);
  }
  
  console.log(`\n📊 Updating Grid Range for "${botName}"\n`);
  console.log(`   Current Range: $${bot.lower_price.toLocaleString()} - $${bot.upper_price.toLocaleString()}`);
  console.log(`   New Range:     $${newLower.toLocaleString()} - $${newUpper.toLocaleString()}`);
  console.log(`   Grid Levels:   ${bot.adjusted_grid_count}`);
  
  const oldSpacing = (bot.upper_price - bot.lower_price) / bot.adjusted_grid_count;
  const newSpacing = (newUpper - newLower) / bot.adjusted_grid_count;
  
  console.log(`\n   Old Grid Spacing: $${oldSpacing.toFixed(2)}`);
  console.log(`   New Grid Spacing: $${newSpacing.toFixed(2)}`);
  console.log(`   Change: ${((newSpacing / oldSpacing - 1) * 100).toFixed(1)}%`);
  
  // Update the database
  db.updateBot(botName, {
    lower_price: newLower,
    upper_price: newUpper
  });
  
  console.log(`\n✅ Grid range updated in database!`);
  console.log(`\n⚠️  IMPORTANT: Run the following command to apply the new grid:`);
  console.log(`   node grid-bot-cli-v5.mjs rebalance --name ${botName}`);
  console.log(`\n   This will cancel all existing orders and place new ones at the updated range.`);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
