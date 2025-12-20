#!/usr/bin/env node

/**
 * Grid Trading Bot - Health Check Script
 * Version: 1.0.0
 * 
 * Verifies bot health by checking:
 * 1. Monitor process status
 * 2. Recent log activity
 * 3. Open orders on Binance.US
 * 4. Database connectivity
 */

import ccxt from 'ccxt';
import dotenv from 'dotenv';
import { execSync } from 'child_process';
import { existsSync, statSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDatabase, closeDatabase } from './database.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment
dotenv.config({ path: '.env.production' });

// ANSI color codes for terminal output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function success(msg) { return `${colors.green}✅ ${msg}${colors.reset}`; }
function error(msg) { return `${colors.red}❌ ${msg}${colors.reset}`; }
function warning(msg) { return `${colors.yellow}⚠️  ${msg}${colors.reset}`; }
function info(msg) { return `${colors.blue}ℹ️  ${msg}${colors.reset}`; }
function header(msg) { return `${colors.bold}${msg}${colors.reset}`; }

/**
 * Check if a monitor process is running for a bot
 */
function checkProcess(botName) {
  try {
    const result = execSync(`ps aux | grep "grid-bot-cli-v5.mjs monitor --name ${botName}" | grep -v grep`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    if (result.trim()) {
      const parts = result.trim().split(/\s+/);
      const pid = parts[1];
      const cpu = parts[2];
      const mem = parts[3];
      return { running: true, pid, cpu, mem };
    }
  } catch (e) {
    // grep returns exit code 1 if no match
  }
  return { running: false };
}

/**
 * Check log file for recent activity
 */
function checkLogActivity(botName) {
  const logPath = join(__dirname, 'logs', `${botName}.log`);
  
  if (!existsSync(logPath)) {
    return { exists: false, message: 'Log file not found' };
  }
  
  const stats = statSync(logPath);
  const lastModified = stats.mtime;
  const ageSeconds = (Date.now() - lastModified.getTime()) / 1000;
  
  // Read last few lines to get recent price
  try {
    const content = readFileSync(logPath, 'utf-8');
    const lines = content.trim().split('\n');
    const recentLines = lines.slice(-10);
    
    // Find most recent price line
    let lastPrice = null;
    let lastTimestamp = null;
    
    for (const line of recentLines.reverse()) {
      const priceMatch = line.match(/Price: \$([0-9,.]+)/);
      const timeMatch = line.match(/\[([^\]]+)\]/);
      
      if (priceMatch && !lastPrice) {
        lastPrice = priceMatch[1];
      }
      if (timeMatch && !lastTimestamp) {
        lastTimestamp = timeMatch[1];
      }
      if (lastPrice && lastTimestamp) break;
    }
    
    // Check for errors in recent lines
    const hasErrors = recentLines.some(line => 
      line.toLowerCase().includes('error') || 
      line.toLowerCase().includes('failed') ||
      line.includes('TypeError') ||
      line.includes('ReferenceError')
    );
    
    return {
      exists: true,
      ageSeconds,
      lastPrice,
      lastTimestamp,
      hasErrors,
      isStale: ageSeconds > 60 // Consider stale if no update in 60 seconds
    };
  } catch (e) {
    return { exists: true, ageSeconds, error: e.message };
  }
}

/**
 * Check open orders on Binance.US
 */
async function checkBinanceOrders(exchange, symbol) {
  try {
    const orders = await exchange.fetchOpenOrders(symbol);
    
    const buyOrders = orders.filter(o => o.side === 'buy');
    const sellOrders = orders.filter(o => o.side === 'sell');
    
    return {
      success: true,
      total: orders.length,
      buyCount: buyOrders.length,
      sellCount: sellOrders.length,
      orders: orders.map(o => ({
        id: o.id,
        side: o.side,
        price: o.price,
        amount: o.amount
      }))
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Check database status for a bot
 */
function checkDatabase(db, botName) {
  try {
    const bot = db.getBot(botName);
    if (!bot) {
      return { success: false, error: 'Bot not found in database' };
    }
    
    const activeOrders = db.getActiveOrders(botName);
    const metrics = db.getMetrics(botName);
    
    return {
      success: true,
      status: bot.status,
      dbOrders: activeOrders.length,
      totalTrades: metrics.total_trades,
      winRate: metrics.win_rate,
      totalPnL: metrics.total_pnl
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Run health check for a single bot
 */
async function checkBotHealth(botName, exchange, db) {
  console.log(`\n${header('━'.repeat(60))}`);
  console.log(header(`  BOT: ${botName}`));
  console.log(`${header('━'.repeat(60))}\n`);
  
  const results = {
    botName,
    healthy: true,
    issues: []
  };
  
  // 1. Check database
  console.log(header('📦 Database Status:'));
  const dbStatus = checkDatabase(db, botName);
  
  if (dbStatus.success) {
    console.log(success(`Bot found in database`));
    console.log(`   Status: ${dbStatus.status === 'running' ? '🟢 Running' : '🔴 Stopped'}`);
    console.log(`   Orders in DB: ${dbStatus.dbOrders}`);
    console.log(`   Total Trades: ${dbStatus.totalTrades}`);
    console.log(`   Win Rate: ${dbStatus.winRate}%`);
    console.log(`   Total P&L: $${dbStatus.totalPnL.toFixed(2)}`);
  } else {
    console.log(error(`Database error: ${dbStatus.error}`));
    results.healthy = false;
    results.issues.push('Database error');
  }
  
  // 2. Check process
  console.log(`\n${header('⚙️  Monitor Process:')}`);
  const processStatus = checkProcess(botName);
  
  if (processStatus.running) {
    console.log(success(`Monitor process running`));
    console.log(`   PID: ${processStatus.pid}`);
    console.log(`   CPU: ${processStatus.cpu}%`);
    console.log(`   Memory: ${processStatus.mem}%`);
  } else {
    if (dbStatus.status === 'running') {
      console.log(error(`Monitor process NOT running (but bot status is 'running')`));
      results.healthy = false;
      results.issues.push('Monitor process not running');
    } else {
      console.log(warning(`Monitor process not running (bot is stopped)`));
    }
  }
  
  // 3. Check log activity
  console.log(`\n${header('📋 Log Activity:')}`);
  const logStatus = checkLogActivity(botName);
  
  if (!logStatus.exists) {
    console.log(warning(`Log file not found`));
    if (processStatus.running) {
      results.issues.push('Log file missing');
    }
  } else if (logStatus.error) {
    console.log(error(`Error reading log: ${logStatus.error}`));
  } else {
    if (logStatus.isStale && processStatus.running) {
      console.log(warning(`Log is stale (${logStatus.ageSeconds.toFixed(0)}s since last update)`));
      results.issues.push('Stale log activity');
    } else if (processStatus.running) {
      console.log(success(`Recent activity detected`));
    } else {
      console.log(info(`Last activity: ${logStatus.ageSeconds.toFixed(0)}s ago`));
    }
    
    if (logStatus.lastPrice) {
      console.log(`   Last Price: $${logStatus.lastPrice}`);
    }
    if (logStatus.lastTimestamp) {
      console.log(`   Last Update: ${logStatus.lastTimestamp}`);
    }
    if (logStatus.hasErrors) {
      console.log(warning(`Errors detected in recent logs`));
      results.issues.push('Errors in logs');
    }
  }
  
  // 4. Check Binance orders (only if bot should be running)
  if (dbStatus.status === 'running' || processStatus.running) {
    console.log(`\n${header('📈 Binance.US Orders:')}`);
    
    const bot = db.getBot(botName);
    const binanceStatus = await checkBinanceOrders(exchange, bot.symbol);
    
    if (binanceStatus.success) {
      if (binanceStatus.total > 0) {
        console.log(success(`${binanceStatus.total} open orders on exchange`));
        console.log(`   Buy Orders: ${binanceStatus.buyCount}`);
        console.log(`   Sell Orders: ${binanceStatus.sellCount}`);
      } else {
        console.log(warning(`No open orders on exchange`));
        results.issues.push('No orders on Binance');
      }
    } else {
      console.log(error(`Failed to fetch orders: ${binanceStatus.error}`));
      results.issues.push('Cannot fetch Binance orders');
    }
  }
  
  // Summary
  console.log(`\n${header('📊 Health Summary:')}`);
  if (results.issues.length === 0) {
    if (dbStatus.status === 'running' && processStatus.running) {
      console.log(success(`Bot is HEALTHY and actively trading`));
    } else if (dbStatus.status === 'stopped' && !processStatus.running) {
      console.log(info(`Bot is STOPPED (as expected)`));
    } else {
      console.log(warning(`Bot status is inconsistent`));
    }
  } else {
    console.log(error(`Issues detected: ${results.issues.join(', ')}`));
    results.healthy = false;
  }
  
  return results;
}

/**
 * Main health check function
 */
async function runHealthCheck() {
  console.log('\n' + '═'.repeat(60));
  console.log(header('       GRID TRADING BOT - HEALTH CHECK'));
  console.log('═'.repeat(60));
  console.log(`Time: ${new Date().toISOString()}`);
  
  // Initialize exchange
  const apiKey = process.env.BINANCE_API_KEY;
  const secret = process.env.BINANCE_API_SECRET;
  
  if (!apiKey || !secret) {
    console.log(error('BINANCE_API_KEY and BINANCE_API_SECRET not set'));
    process.exit(1);
  }
  
  const exchange = new ccxt.binanceus({
    apiKey,
    secret,
    enableRateLimit: true,
    options: {
      defaultType: 'spot',
      adjustForTimeDifference: true
    }
  });
  
  // Initialize database
  const db = getDatabase();
  
  // Get all bots
  const bots = db.getAllBots();
  
  if (bots.length === 0) {
    console.log(warning('No bots configured'));
    closeDatabase();
    return;
  }
  
  console.log(info(`Found ${bots.length} bot(s) configured`));
  
  // Check each bot
  const results = [];
  for (const bot of bots) {
    const result = await checkBotHealth(bot.name, exchange, db);
    results.push(result);
  }
  
  // Overall summary
  console.log('\n' + '═'.repeat(60));
  console.log(header('       OVERALL SUMMARY'));
  console.log('═'.repeat(60) + '\n');
  
  const healthyBots = results.filter(r => r.healthy && r.issues.length === 0);
  const issueBots = results.filter(r => r.issues.length > 0);
  
  console.log(`Total Bots: ${bots.length}`);
  console.log(`${colors.green}Healthy: ${healthyBots.length}${colors.reset}`);
  console.log(`${colors.red}Issues: ${issueBots.length}${colors.reset}`);
  
  if (issueBots.length > 0) {
    console.log(`\n${header('Bots with issues:')}`);
    for (const bot of issueBots) {
      console.log(`  - ${bot.botName}: ${bot.issues.join(', ')}`);
    }
  }
  
  console.log('\n' + '═'.repeat(60) + '\n');
  
  closeDatabase();
}

// Run health check
runHealthCheck().catch(error => {
  console.error('Health check failed:', error.message);
  closeDatabase();
  process.exit(1);
});
