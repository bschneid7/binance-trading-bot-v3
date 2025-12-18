#!/usr/bin/env node

/**
 * Grid Trading Bot - CLI Management Tool
 * Manage grid bots without the web dashboard
 */

import ccxt from 'ccxt';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '.env.production') });

// Initialize JSON database
const DB_DIR = join(__dirname, 'data');
const BOTS_FILE = join(DB_DIR, 'grid-bots.json');
const TRADES_FILE = join(DB_DIR, 'grid-trades.json');

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// Load or initialize data
function loadData(file, defaultValue = []) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(defaultValue, null, 2));
    return defaultValue;
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`Error loading ${file}:`, error.message);
    return defaultValue;
  }
}

function saveData(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let bots = loadData(BOTS_FILE);
let trades = loadData(TRADES_FILE);

// Initialize Binance.US client
let exchange;
try {
  exchange = new ccxt.binanceus({
    apiKey: process.env.BINANCE_API_KEY,
    secret: process.env.BINANCE_API_SECRET,
    enableRateLimit: true,
    options: {
      defaultType: 'spot',
      adjustForTimeDifference: true
    }
  });
} catch (error) {
  console.error('❌ Failed to initialize Binance.US client:', error.message);
  process.exit(1);
}

const TEST_MODE = process.env.BINANCE_TEST_MODE === 'true';

// Helper functions
function formatPrice(price) {
  return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(date) {
  return new Date(date).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Calculate grid levels
function calculateGridLevels(lowerPrice, upperPrice, gridCount) {
  const gridSpacing = (upperPrice - lowerPrice) / (gridCount - 1);
  const levels = [];
  
  for (let i = 0; i < gridCount; i++) {
    const price = lowerPrice + (i * gridSpacing);
    levels.push({
      price: parseFloat(price.toFixed(2)),
      type: i < gridCount / 2 ? 'BUY' : 'SELL',
      status: 'PENDING'
    });
  }
  
  return levels;
}

// Get current market price
async function getCurrentPrice(symbol) {
  try {
    const ticker = await exchange.fetchTicker(symbol);
    return ticker.last;
  } catch (error) {
    console.error('❌ Error fetching price:', error.message);
    return null;
  }
}

// Commands

async function createBot(args) {
  const name = args.name;
  const symbol = args.symbol || 'BTC/USD';
  const lowerPrice = parseFloat(args.lower);
  const upperPrice = parseFloat(args.upper);
  const gridCount = parseInt(args.grids);
  const orderSize = parseFloat(args.size);

  if (!name || !lowerPrice || !upperPrice || !gridCount || !orderSize) {
    console.error('❌ Missing required arguments');
    console.log('\nUsage: grid-bot-cli create --name <name> --lower <price> --upper <price> --grids <count> --size <amount> [--symbol <symbol>]');
    console.log('\nExample: grid-bot-cli create --name btc-bot --lower 90000 --upper 100000 --grids 10 --size 100');
    return;
  }

  if (lowerPrice >= upperPrice) {
    console.error('❌ Lower price must be less than upper price');
    return;
  }

  if (gridCount < 2) {
    console.error('❌ Grid count must be at least 2');
    return;
  }

  try {
    // Check if bot name already exists
    const existing = bots.find(b => b.name === name);
    if (existing) {
      console.error(`❌ Bot with name "${name}" already exists`);
      return;
    }

    // Get current price to validate range
    console.log(`\n📊 Fetching current ${symbol} price...`);
    const currentPrice = await getCurrentPrice(symbol);
    
    if (!currentPrice) {
      console.error('❌ Could not fetch current price. Please try again.');
      return;
    }

    console.log(`Current price: ${formatPrice(currentPrice)}\n`);

    if (currentPrice < lowerPrice || currentPrice > upperPrice) {
      console.log(`⚠️  WARNING: Current price (${formatPrice(currentPrice)}) is outside grid range!`);
      console.log(`   Grid range: ${formatPrice(lowerPrice)} - ${formatPrice(upperPrice)}`);
      console.log(`   The bot may not operate optimally until price enters the range.\n`);
    }

    // Create new bot
    const bot = {
      id: bots.length > 0 ? Math.max(...bots.map(b => b.id)) + 1 : 1,
      name,
      symbol,
      lower_price: lowerPrice,
      upper_price: upperPrice,
      grid_count: gridCount,
      order_size: orderSize,
      status: 'stopped',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    bots.push(bot);
    saveData(BOTS_FILE, bots);
    
    console.log(`✅ Grid bot "${name}" created successfully!`);
    console.log(`\nBot ID: ${bot.id}`);
    console.log(`Symbol: ${symbol}`);
    console.log(`Price Range: ${formatPrice(lowerPrice)} - ${formatPrice(upperPrice)}`);
    console.log(`Grid Levels: ${gridCount}`);
    console.log(`Order Size: ${formatPrice(orderSize)} per level`);
    console.log(`Status: STOPPED`);
    console.log(`\n💡 Use "grid-bot-cli start --name ${name}" to start the bot`);
    
  } catch (error) {
    console.error('❌ Error creating bot:', error.message);
  }
}

async function listBots() {
  try {
    if (bots.length === 0) {
      console.log('\n📭 No grid bots found');
      console.log('\n💡 Create your first bot with: grid-bot-cli create --name <name> --lower <price> --upper <price> --grids <count> --size <amount>');
      return;
    }

    console.log(`\n📊 Grid Bots (${bots.length} total)\n`);
    console.log('═'.repeat(100));
    
    for (const bot of bots) {
      const statusIcon = bot.status === 'running' ? '🟢' : '🔴';
      const gridSpacing = (bot.upper_price - bot.lower_price) / (bot.grid_count - 1);
      
      console.log(`\n${statusIcon} ${bot.name} (ID: ${bot.id})`);
      console.log(`   Symbol: ${bot.symbol}`);
      console.log(`   Range: ${formatPrice(bot.lower_price)} - ${formatPrice(bot.upper_price)}`);
      console.log(`   Grids: ${bot.grid_count} levels (spacing: ${formatPrice(gridSpacing)})`);
      console.log(`   Order Size: ${formatPrice(bot.order_size)}`);
      console.log(`   Status: ${bot.status.toUpperCase()}`);
      console.log(`   Created: ${formatDate(bot.created_at)}`);
      
      // Get trade stats
      const botTrades = trades.filter(t => t.bot_id === bot.id);
      if (botTrades.length > 0) {
        const buyCount = botTrades.filter(t => t.trade_type === 'BUY').length;
        const sellCount = botTrades.filter(t => t.trade_type === 'SELL').length;
        const totalProfit = botTrades.reduce((sum, t) => sum + (t.profit || 0), 0);
        
        console.log(`   Trades: ${botTrades.length} (${buyCount} buys, ${sellCount} sells)`);
        console.log(`   Profit: ${formatPrice(totalProfit)}`);
      }
    }
    
    console.log('\n' + '═'.repeat(100) + '\n');
    
  } catch (error) {
    console.error('❌ Error listing bots:', error.message);
  }
}

async function showBot(args) {
  const name = args.name;
  
  if (!name) {
    console.error('❌ Bot name required');
    console.log('\nUsage: grid-bot-cli show --name <name>');
    return;
  }

  try {
    const bot = bots.find(b => b.name === name);
    
    if (!bot) {
      console.error(`❌ Bot "${name}" not found`);
      return;
    }

    // Get current price
    console.log(`\n📊 Fetching current ${bot.symbol} price...`);
    const currentPrice = await getCurrentPrice(bot.symbol);
    
    console.log(`\n🤖 Grid Bot: ${bot.name}`);
    console.log('═'.repeat(80));
    console.log(`\nID: ${bot.id}`);
    console.log(`Symbol: ${bot.symbol}`);
    console.log(`Status: ${bot.status.toUpperCase()} ${bot.status === 'running' ? '🟢' : '🔴'}`);
    console.log(`Created: ${formatDate(bot.created_at)}`);
    console.log(`Updated: ${formatDate(bot.updated_at)}`);
    
    console.log(`\n📈 Configuration:`);
    console.log(`   Price Range: ${formatPrice(bot.lower_price)} - ${formatPrice(bot.upper_price)}`);
    console.log(`   Grid Levels: ${bot.grid_count}`);
    console.log(`   Order Size: ${formatPrice(bot.order_size)} per level`);
    
    if (currentPrice) {
      console.log(`\n💰 Current Market:`);
      console.log(`   Price: ${formatPrice(currentPrice)}`);
      
      if (currentPrice < bot.lower_price) {
        console.log(`   Position: ⬇️  BELOW grid range (${((currentPrice - bot.lower_price) / bot.lower_price * 100).toFixed(2)}%)`);
      } else if (currentPrice > bot.upper_price) {
        console.log(`   Position: ⬆️  ABOVE grid range (${((currentPrice - bot.upper_price) / bot.upper_price * 100).toFixed(2)}%)`);
      } else {
        console.log(`   Position: ✅ WITHIN grid range`);
      }
    }
    
    // Calculate and show grid levels
    const levels = calculateGridLevels(bot.lower_price, bot.upper_price, bot.grid_count);
    
    console.log(`\n🎯 Grid Levels:`);
    console.log('   ' + '─'.repeat(70));
    
    levels.forEach((level, index) => {
      let status = '  ';
      if (currentPrice) {
        const diff = Math.abs(level.price - currentPrice);
        if (diff < (bot.upper_price - bot.lower_price) * 0.01) {
          status = '🎯';
        } else if (level.price < currentPrice) {
          status = '⬇️ ';
        } else {
          status = '⬆️ ';
        }
      }
      
      console.log(`   ${status} Level ${(index + 1).toString().padStart(2)}: ${level.type.padEnd(4)} at ${formatPrice(level.price)}`);
    });
    
    // Show trade history
    const botTrades = trades.filter(t => t.bot_id === bot.id).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 10);
    
    if (botTrades.length > 0) {
      console.log(`\n📊 Recent Trades (last 10):`);
      console.log('   ' + '─'.repeat(70));
      
      botTrades.forEach(trade => {
        const icon = trade.trade_type === 'BUY' ? '🟢' : '🔴';
        const profitStr = trade.profit ? ` | Profit: ${formatPrice(trade.profit)}` : '';
        console.log(`   ${icon} ${trade.trade_type.padEnd(4)} ${formatPrice(trade.price)} x ${trade.amount.toFixed(8)} = ${formatPrice(trade.total)}${profitStr}`);
        console.log(`      ${formatDate(trade.timestamp)}`);
      });
      
      // Show stats
      const allBotTrades = trades.filter(t => t.bot_id === bot.id);
      const buyCount = allBotTrades.filter(t => t.trade_type === 'BUY').length;
      const sellCount = allBotTrades.filter(t => t.trade_type === 'SELL').length;
      const totalProfit = allBotTrades.reduce((sum, t) => sum + (t.profit || 0), 0);
      const avgProfit = allBotTrades.length > 0 ? totalProfit / allBotTrades.length : 0;
      
      console.log(`\n💵 Statistics:`);
      console.log(`   Total Trades: ${allBotTrades.length}`);
      console.log(`   Buys: ${buyCount} | Sells: ${sellCount}`);
      console.log(`   Total Profit: ${formatPrice(totalProfit)}`);
      console.log(`   Avg Profit/Trade: ${formatPrice(avgProfit)}`);
    }
    
    console.log('\n' + '═'.repeat(80) + '\n');
    
  } catch (error) {
    console.error('❌ Error showing bot:', error.message);
  }
}

async function startBot(args) {
  const name = args.name;
  
  if (!name) {
    console.error('❌ Bot name required');
    console.log('\nUsage: grid-bot-cli start --name <name>');
    return;
  }

  try {
    const bot = bots.find(b => b.name === name);
    
    if (!bot) {
      console.error(`❌ Bot "${name}" not found`);
      return;
    }

    if (bot.status === 'running') {
      console.log(`⚠️  Bot "${name}" is already running`);
      return;
    }

    // Update status
    bot.status = 'running';
    bot.updated_at = new Date().toISOString();
    saveData(BOTS_FILE, bots);
    
    console.log(`✅ Bot "${name}" started successfully!`);
    console.log(`\n⚠️  Note: This CLI tool doesn't run the bot continuously.`);
    console.log(`   To run the bot 24/7, you need to:`);
    console.log(`   1. Deploy it to your VPS`);
    console.log(`   2. Use Docker or PM2 to keep it running`);
    console.log(`   3. Monitor it with "grid-bot-cli status --name ${name}"`);
    
    if (TEST_MODE) {
      console.log(`\n🎯 PAPER TRADING MODE: No real orders will be placed`);
    } else {
      console.log(`\n⚠️  LIVE TRADING MODE: Real money at risk!`);
    }
    
  } catch (error) {
    console.error('❌ Error starting bot:', error.message);
  }
}

async function stopBot(args) {
  const name = args.name;
  
  if (!name) {
    console.error('❌ Bot name required');
    console.log('\nUsage: grid-bot-cli stop --name <name>');
    return;
  }

  try {
    const bot = bots.find(b => b.name === name);
    
    if (!bot) {
      console.error(`❌ Bot "${name}" not found`);
      return;
    }

    if (bot.status === 'stopped') {
      console.log(`⚠️  Bot "${name}" is already stopped`);
      return;
    }

    // Update status
    bot.status = 'stopped';
    bot.updated_at = new Date().toISOString();
    saveData(BOTS_FILE, bots);
    
    console.log(`✅ Bot "${name}" stopped successfully!`);
    
  } catch (error) {
    console.error('❌ Error stopping bot:', error.message);
  }
}

async function deleteBot(args) {
  const name = args.name;
  const force = args.force;
  
  if (!name) {
    console.error('❌ Bot name required');
    console.log('\nUsage: grid-bot-cli delete --name <name> [--force]');
    return;
  }

  try {
    const botIndex = bots.findIndex(b => b.name === name);
    
    if (botIndex === -1) {
      console.error(`❌ Bot "${name}" not found`);
      return;
    }

    const bot = bots[botIndex];

    if (bot.status === 'running' && !force) {
      console.error(`❌ Bot "${name}" is running. Stop it first or use --force`);
      return;
    }

    // Delete trades first
    trades = trades.filter(t => t.bot_id !== bot.id);
    saveData(TRADES_FILE, trades);
    
    // Delete bot
    bots.splice(botIndex, 1);
    saveData(BOTS_FILE, bots);
    
    console.log(`✅ Bot "${name}" deleted successfully!`);
    
  } catch (error) {
    console.error('❌ Error deleting bot:', error.message);
  }
}

async function showStatus() {
  try {
    console.log('\n🤖 Grid Trading Bot - System Status\n');
    console.log('═'.repeat(80));
    
    // Connection status
    console.log(`\n📡 Connection:`);
    console.log(`   Exchange: Binance.US`);
    console.log(`   Mode: ${TEST_MODE ? 'PAPER TRADING ✅' : 'LIVE TRADING ⚠️'}`);
    
    try {
      const balance = await exchange.fetchBalance();
      console.log(`   Status: ✅ Connected`);
      console.log(`\n💰 Account Balance:`);
      console.log(`   USD: ${formatPrice(balance.free?.USD || 0)}`);
      console.log(`   BTC: ${(balance.free?.BTC || 0).toFixed(8)} BTC`);
    } catch (error) {
      console.log(`   Status: ❌ Connection failed - ${error.message}`);
    }
    
    // Bot statistics
    const runningBots = bots.filter(b => b.status === 'running').length;
    const stoppedBots = bots.filter(b => b.status === 'stopped').length;
    
    console.log(`\n📊 Bots:`);
    console.log(`   Total: ${bots.length}`);
    console.log(`   Running: ${runningBots} 🟢`);
    console.log(`   Stopped: ${stoppedBots} 🔴`);
    
    // Trade statistics
    if (trades.length > 0) {
      const totalProfit = trades.reduce((sum, t) => sum + (t.profit || 0), 0);
      
      console.log(`\n💵 Trading:`);
      console.log(`   Total Trades: ${trades.length}`);
      console.log(`   Total Profit: ${formatPrice(totalProfit)}`);
    }
    
    console.log('\n' + '═'.repeat(80) + '\n');
    
  } catch (error) {
    console.error('❌ Error fetching status:', error.message);
  }
}

function showHelp() {
  console.log(`
🤖 Grid Trading Bot - CLI Management Tool

USAGE:
  grid-bot-cli <command> [options]

COMMANDS:
  create      Create a new grid bot
  list        List all grid bots
  show        Show detailed bot information
  start       Start a bot
  stop        Stop a bot
  delete      Delete a bot
  status      Show system status
  help        Show this help message

CREATE OPTIONS:
  --name <name>       Bot name (required, unique)
  --symbol <symbol>   Trading pair (default: BTC/USD)
  --lower <price>     Lower price bound (required)
  --upper <price>     Upper price bound (required)
  --grids <count>     Number of grid levels (required)
  --size <amount>     Order size in USD per level (required)

EXAMPLES:
  # Create a new bot
  grid-bot-cli create --name btc-bot --lower 90000 --upper 100000 --grids 10 --size 100

  # List all bots
  grid-bot-cli list

  # Show bot details
  grid-bot-cli show --name btc-bot

  # Start a bot
  grid-bot-cli start --name btc-bot

  # Stop a bot
  grid-bot-cli stop --name btc-bot

  # Delete a bot
  grid-bot-cli delete --name btc-bot

  # Show system status
  grid-bot-cli status

MODE:
  Current mode: ${TEST_MODE ? 'PAPER TRADING ✅' : 'LIVE TRADING ⚠️'}
  ${TEST_MODE ? 'No real orders will be placed' : 'Real money at risk!'}

`);
}

// Main CLI handler
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    showHelp();
    return;
  }

  const command = args[0];
  const options = {};
  
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    const value = args[i + 1];
    options[key] = value;
  }

  switch (command) {
    case 'create':
      await createBot(options);
      break;
    case 'list':
      await listBots();
      break;
    case 'show':
      await showBot(options);
      break;
    case 'start':
      await startBot(options);
      break;
    case 'stop':
      await stopBot(options);
      break;
    case 'delete':
      await deleteBot(options);
      break;
    case 'status':
      await showStatus();
      break;
    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;
    default:
      console.error(`❌ Unknown command: ${command}`);
      console.log('\nUse "grid-bot-cli help" to see available commands');
  }
}

// Run CLI
main().catch(error => {
  console.error('❌ Fatal error:', error.message);
  console.error(error.stack);
  process.exit(1);
});
