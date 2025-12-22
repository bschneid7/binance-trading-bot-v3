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
 * Supports both old (grid-bot-cli-v5.mjs) and new (enhanced-monitor.mjs) monitors
 */
function checkProcess(botName) {
  // Try enhanced monitor first (new)
  try {
    const result = execSync(`ps aux | grep "enhanced-monitor.mjs ${botName}" | grep -v grep`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    if (result.trim()) {
      const parts = result.trim().split(/\s+/);
      const pid = parts[1];
      const cpu = parts[2];
      const mem = parts[3];
      return { running: true, pid, cpu, mem, type: 'enhanced' };
    }
  } catch (e) {
    // grep returns exit code 1 if no match
  }
  
  // Try old monitor (legacy)
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
      return { running: true, pid, cpu, mem, type: 'legacy' };
    }
  } catch (e) {
    // grep returns exit code 1 if no match
  }
  
  return { running: false };
}

/**
 * Check log file for recent activity
 * Checks both enhanced monitor logs and legacy logs
 */
function checkLogActivity(botName) {
  // Map bot name to enhanced log file name
  // live-btc-bot -> enhanced-btc-bot.log
  // live-eth-bot -> enhanced-eth-bot.log
  // live-sol-bot -> enhanced-sol-bot.log
  const enhancedLogName = botName.replace('live-', 'enhanced-') + '.log';
  let logPath = join(__dirname, 'logs', enhancedLogName);
  
  // If enhanced log doesn't exist, try the legacy log path
  if (!existsSync(logPath)) {
    logPath = join(__dirname, 'logs', `${botName}.log`);
  }
  
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
    
    // Calculate 24-hour P&L from trades
    const pnl24h = calculate24hPnL(db, botName);
    
    return {
      success: true,
      status: bot.status,
      dbOrders: activeOrders.length,
      totalTrades: metrics.total_trades,
      winRate: metrics.win_rate,
      totalPnL: metrics.total_pnl,
      pnl24h: pnl24h
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Calculate P&L from the last 24 hours
 */
function calculate24hPnL(db, botName) {
  try {
    // Get timestamp for 24 hours ago
    // Database stores timestamps as 'YYYY-MM-DD HH:MM:SS' (SQLite format, no T)
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    // Format as SQLite-compatible timestamp (space instead of T, no milliseconds)
    const yesterdayStr = yesterday.toISOString().replace('T', ' ').slice(0, 19);
    
    // Query trades from the last 24 hours
    const stmt = db.db.prepare(`
      SELECT side, price, amount, value, fee
      FROM trades
      WHERE bot_name = ? AND timestamp >= ?
      ORDER BY timestamp ASC
    `);
    
    const trades = stmt.all(botName, yesterdayStr);
    
    if (trades.length === 0) {
      return { pnl: 0, trades: 0, buys: 0, sells: 0 };
    }
    
    // Calculate P&L from trades
    // For grid bots, profit comes from completed buy-sell cycles
    let buyCount = 0;
    let sellCount = 0;
    let totalBuyValue = 0;
    let totalSellValue = 0;
    let totalFees = 0;
    
    // Collect all buys and sells with their values
    const buys = [];
    const sells = [];
    
    for (const trade of trades) {
      const fee = trade.fee || 0;
      totalFees += fee;
      
      if (trade.side === 'buy') {
        buyCount++;
        totalBuyValue += trade.value;
        buys.push({ price: trade.price, value: trade.value, amount: trade.amount });
      } else if (trade.side === 'sell') {
        sellCount++;
        totalSellValue += trade.value;
        sells.push({ price: trade.price, value: trade.value, amount: trade.amount });
      }
    }
    
    // For grid bots, realized P&L comes from completed cycles
    // A cycle = buy at lower price, sell at higher price
    // Profit per cycle ≈ grid_spacing_percent * trade_value
    
    // Calculate realized P&L:
    // Method: For each sell, assume it closes a previous buy at a lower price
    // Grid profit = sum of (sell_price - buy_price) * amount for matched pairs
    
    let realizedPnL = 0;
    const completedCycles = Math.min(buyCount, sellCount);
    
    if (completedCycles > 0) {
      // Sort buys by price ascending (lowest first)
      // Sort sells by price ascending (lowest first)
      buys.sort((a, b) => a.price - b.price);
      sells.sort((a, b) => a.price - b.price);
      
      // Match lowest buys with lowest sells (FIFO-like matching)
      // In grid trading, sells should be at higher prices than buys
      for (let i = 0; i < completedCycles; i++) {
        const buy = buys[i];
        const sell = sells[i];
        // Profit = sell value - buy value (assuming similar amounts)
        // Use the smaller amount if they differ
        const matchedAmount = Math.min(buy.amount, sell.amount);
        const profit = (sell.price - buy.price) * matchedAmount;
        realizedPnL += profit;
      }
    }
    
    // Subtract fees from realized P&L
    realizedPnL -= totalFees;
    
    return {
      pnl: parseFloat(realizedPnL.toFixed(2)),
      trades: trades.length,
      buys: buyCount,
      sells: sellCount,
      completedCycles,
      totalBuyValue: parseFloat(totalBuyValue.toFixed(2)),
      totalSellValue: parseFloat(totalSellValue.toFixed(2)),
      totalFees: parseFloat(totalFees.toFixed(4))
    };
  } catch (e) {
    return { pnl: 0, trades: 0, error: e.message };
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
    
    // Display 24-hour P&L
    if (dbStatus.pnl24h) {
      const pnl24h = dbStatus.pnl24h;
      const pnlColor = pnl24h.pnl >= 0 ? '\x1b[32m' : '\x1b[31m'; // Green for positive, red for negative
      const pnlSign = pnl24h.pnl >= 0 ? '+' : '';
      console.log(`   24h P&L: ${pnlColor}${pnlSign}$${pnl24h.pnl.toFixed(2)}\x1b[0m (${pnl24h.trades} trades, ${pnl24h.completedCycles || 0} cycles)`);
    }
  } else {
    console.log(error(`Database error: ${dbStatus.error}`));
    results.healthy = false;
    results.issues.push('Database error');
  }
  
  // 2. Check process
  console.log(`\n${header('⚙️  Monitor Process:')}`);
  const processStatus = checkProcess(botName);
  
  if (processStatus.running) {
    const monitorType = processStatus.type === 'enhanced' ? 'Enhanced Monitor' : 'Legacy Monitor';
    console.log(success(`Monitor process running (${monitorType})`));
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
  
  // Fetch current balances and prices for equity calculation
  let currentEquity = null;
  let allCoinsEquity = null;
  try {
    const balance = await exchange.fetchBalance();
    const tickers = await exchange.fetchTickers(['BTC/USD', 'ETH/USD', 'SOL/USD']);
    
    // Monitored coins (BTC, ETH, SOL, USD)
    const usdBalance = balance.USD?.total || 0;
    const btcBalance = balance.BTC?.total || 0;
    const ethBalance = balance.ETH?.total || 0;
    const solBalance = balance.SOL?.total || 0;
    
    const btcPrice = tickers['BTC/USD']?.last || 0;
    const ethPrice = tickers['ETH/USD']?.last || 0;
    const solPrice = tickers['SOL/USD']?.last || 0;
    
    const monitoredEquityUsd = usdBalance + 
      (btcBalance * btcPrice) + 
      (ethBalance * ethPrice) + 
      (solBalance * solPrice);
    
    currentEquity = {
      usd_balance: usdBalance,
      btc_balance: btcBalance,
      btc_price: btcPrice,
      eth_balance: ethBalance,
      eth_price: ethPrice,
      sol_balance: solBalance,
      sol_price: solPrice,
      total_equity_usd: monitoredEquityUsd
    };
    
    // Calculate total equity from ALL coins
    let totalAllCoinsUsd = 0;
    const otherCoins = [];
    
    // Get all non-zero balances
    for (const [coin, balanceInfo] of Object.entries(balance)) {
      const total = balanceInfo?.total || 0;
      if (total > 0 && coin !== 'info' && coin !== 'free' && coin !== 'used' && coin !== 'total') {
        if (coin === 'USD') {
          totalAllCoinsUsd += total;
        } else if (coin === 'BTC') {
          totalAllCoinsUsd += total * btcPrice;
        } else if (coin === 'ETH') {
          totalAllCoinsUsd += total * ethPrice;
        } else if (coin === 'SOL') {
          totalAllCoinsUsd += total * solPrice;
        } else {
          // Try to fetch price for other coins
          try {
            const ticker = await exchange.fetchTicker(`${coin}/USD`);
            const coinPrice = ticker?.last || 0;
            const coinValue = total * coinPrice;
            if (coinValue > 0.01) {  // Only include if worth more than 1 cent
              totalAllCoinsUsd += coinValue;
              otherCoins.push({ coin, balance: total, price: coinPrice, value: coinValue });
            }
          } catch (e) {
            // Coin might not have a USD pair, try USDT
            try {
              const ticker = await exchange.fetchTicker(`${coin}/USDT`);
              const coinPrice = ticker?.last || 0;
              const coinValue = total * coinPrice;
              if (coinValue > 0.01) {
                totalAllCoinsUsd += coinValue;
                otherCoins.push({ coin, balance: total, price: coinPrice, value: coinValue });
              }
            } catch (e2) {
              // Skip coins we can't price
            }
          }
        }
      }
    }
    
    allCoinsEquity = {
      total: totalAllCoinsUsd,
      otherCoins: otherCoins.sort((a, b) => b.value - a.value)  // Sort by value descending
    };
    
    // Save current equity snapshot (monitored coins only for historical tracking)
    db.saveEquitySnapshot(currentEquity);
  } catch (e) {
    console.log(warning(`Could not fetch equity data: ${e.message}`));
  }
  
  // Check each bot and collect P&L data
  const results = [];
  let totalPnL = 0;
  let total24hPnL = 0;
  let total24hTrades = 0;
  
  for (const bot of bots) {
    const result = await checkBotHealth(bot.name, exchange, db);
    results.push(result);
    
    // Collect P&L data for summary
    const dbStatus = checkDatabase(db, bot.name);
    if (dbStatus.success) {
      totalPnL += dbStatus.totalPnL || 0;
      if (dbStatus.pnl24h) {
        total24hPnL += dbStatus.pnl24h.pnl || 0;
        total24hTrades += dbStatus.pnl24h.trades || 0;
      }
    }
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
  
  // P&L Summary
  console.log(`\n${header('P&L Summary:')}`);  
  console.log(`   Total P&L (All Time): $${totalPnL.toFixed(2)}`);
  const pnl24hColor = total24hPnL >= 0 ? colors.green : colors.red;
  const pnl24hSign = total24hPnL >= 0 ? '+' : '';
  console.log(`   24h Realized P&L: ${pnl24hColor}${pnl24hSign}$${total24hPnL.toFixed(2)}${colors.reset} (${total24hTrades} trades)`);
  
  // Equity Summary
  if (currentEquity) {
    console.log(`\n${header('Equity Summary:')}`);
    
    // Show total equity (all coins) first if available
    if (allCoinsEquity) {
      console.log(`   ${colors.bold}Total Equity (All Coins): $${allCoinsEquity.total.toFixed(2)}${colors.reset}`);
    }
    
    console.log(`   Total Equity (Monitored): $${currentEquity.total_equity_usd.toFixed(2)}`);
    
    console.log(`\n   Monitored Holdings:`);
    console.log(`      USD: $${currentEquity.usd_balance.toFixed(2)}`);
    console.log(`      BTC: ${currentEquity.btc_balance.toFixed(6)} ($${(currentEquity.btc_balance * currentEquity.btc_price).toFixed(2)})`);
    console.log(`      ETH: ${currentEquity.eth_balance.toFixed(6)} ($${(currentEquity.eth_balance * currentEquity.eth_price).toFixed(2)})`);
    console.log(`      SOL: ${currentEquity.sol_balance.toFixed(6)} ($${(currentEquity.sol_balance * currentEquity.sol_price).toFixed(2)})`);
    
    // Show other coins if any
    if (allCoinsEquity && allCoinsEquity.otherCoins.length > 0) {
      console.log(`\n   Other Holdings:`);
      for (const coin of allCoinsEquity.otherCoins) {
        console.log(`      ${coin.coin}: ${coin.balance.toFixed(6)} ($${coin.value.toFixed(2)})`);
      }
    }
    
    // Calculate 24h equity change (based on monitored coins for consistency)
    const snapshot24hAgo = db.getEquitySnapshot24hAgo();
    if (snapshot24hAgo) {
      const equityChange = currentEquity.total_equity_usd - snapshot24hAgo.total_equity_usd;
      const equityChangePct = (equityChange / snapshot24hAgo.total_equity_usd) * 100;
      const eqColor = equityChange >= 0 ? colors.green : colors.red;
      const eqSign = equityChange >= 0 ? '+' : '';
      console.log(`\n   24h Equity Change (Monitored): ${eqColor}${eqSign}$${equityChange.toFixed(2)} (${eqSign}${equityChangePct.toFixed(2)}%)${colors.reset}`);
      console.log(`   (Monitored equity 24h ago: $${snapshot24hAgo.total_equity_usd.toFixed(2)})`);
    } else {
      console.log(`\n   ${colors.yellow}24h Equity Change: Not enough history yet${colors.reset}`);
      console.log(`   (First snapshot recorded - check back in 24 hours)`);
    }
  }
  
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
