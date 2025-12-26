#!/usr/bin/env node

/**
 * Grid Trading Bot - Health Check Script
 * Version: 1.3.3
 * 
 * Verifies bot health by checking:
 * 1. Monitor process status
 * 2. Recent log activity
 * 3. Open orders on Binance.US
 * 4. Database connectivity
 * 5. DCA Dip Buyer status
 * 6. Unrealized vs Realized P&L breakdown
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
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
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
 * Check systemd service status
 */
function checkSystemdService(serviceName) {
  try {
    const result = execSync(`systemctl is-active ${serviceName} 2>/dev/null`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return result.trim() === 'active';
  } catch (e) {
    return false;
  }
}

/**
 * Get systemd service details
 */
function getServiceDetails(serviceName) {
  try {
    const result = execSync(`systemctl show ${serviceName} --property=MainPID,ActiveState,SubState,MemoryCurrent 2>/dev/null`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    const props = {};
    for (const line of result.trim().split('\n')) {
      const [key, value] = line.split('=');
      props[key] = value;
    }
    
    return {
      pid: props.MainPID || 'N/A',
      state: props.ActiveState || 'unknown',
      subState: props.SubState || 'unknown',
      memory: props.MemoryCurrent ? (parseInt(props.MemoryCurrent) / 1024 / 1024).toFixed(1) + ' MB' : 'N/A'
    };
  } catch (e) {
    return null;
  }
}

/**
 * Check systemd service for CURRENT session errors only
 * Only shows errors from the current run - ignores errors from previous runs that were resolved by restart
 */
function checkCurrentSessionErrors(serviceName) {
  try {
    // First, get the timestamp when the service was last started
    const startTimeResult = execSync(
      `systemctl show ${serviceName} --property=ActiveEnterTimestamp 2>/dev/null`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    
    const startTimeMatch = startTimeResult.match(/ActiveEnterTimestamp=(.+)/);
    if (!startTimeMatch || !startTimeMatch[1] || startTimeMatch[1] === 'n/a') {
      // Service might not exist or never started
      return { hasErrors: false, count: 0, recentErrors: [], serviceNotFound: true };
    }
    
    const serviceStartTime = startTimeMatch[1].trim();
    
    // Now check for errors ONLY since the service started (current session)
    const result = execSync(
      `journalctl -u ${serviceName} --since "${serviceStartTime}" --no-pager 2>/dev/null | grep -iE "error|failed|failure|exception" | grep -v "No errors" | grep -v "error handler" | grep -v "ErrorLogger" | tail -5`,
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      }
    );
    
    const errors = result.trim().split('\n').filter(line => line.trim());
    
    if (errors.length > 0) {
      return {
        hasErrors: true,
        count: errors.length,
        recentErrors: errors.slice(0, 3),
        sessionStart: serviceStartTime
      };
    }
    
    return { hasErrors: false, count: 0, recentErrors: [], sessionStart: serviceStartTime };
  } catch (e) {
    // grep returns exit code 1 if no matches, which is good (no errors)
    return { hasErrors: false, count: 0, recentErrors: [] };
  }
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
    
    // Check for errors in recent lines (only in the log file, not journal history)
    const hasErrors = recentLines.some(line => 
      (line.toLowerCase().includes('error') || 
       line.toLowerCase().includes('failed') ||
       line.includes('TypeError') ||
       line.includes('ReferenceError')) &&
      // Exclude common non-critical messages
      !line.includes('No errors') &&
      !line.includes('error handler') &&
      !line.includes('ErrorLogger')
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
 * Includes both strict 24h P&L and estimated P&L (matching 24h sells with historical buys)
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
      return { pnl: 0, estimatedPnl: 0, trades: 0, buys: 0, sells: 0, completedCycles: 0 };
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
    
    // Calculate strict 24h realized P&L (only trades within 24h window)
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
    
    // Calculate ESTIMATED P&L: Match 24h sells with ALL historical buys
    // This shows profit from sells even if the buy was before 24h window
    let estimatedPnL = 0;
    
    if (sellCount > 0) {
      // Get ALL historical buys for this bot (not just 24h)
      const allBuysStmt = db.db.prepare(`
        SELECT price, amount
        FROM trades
        WHERE bot_name = ? AND side = 'buy'
        ORDER BY price ASC
      `);
      const allBuys = allBuysStmt.all(botName);
      
      // Sort 24h sells by price ascending
      sells.sort((a, b) => a.price - b.price);
      
      // Match each 24h sell with the lowest available historical buy
      // Create a copy of allBuys to track used amounts
      const availableBuys = allBuys.map(b => ({ ...b, remainingAmount: b.amount }));
      
      for (const sell of sells) {
        let sellAmountRemaining = sell.amount;
        
        for (const buy of availableBuys) {
          if (sellAmountRemaining <= 0) break;
          if (buy.remainingAmount <= 0) continue;
          
          // Match as much as possible
          const matchedAmount = Math.min(sellAmountRemaining, buy.remainingAmount);
          const profit = (sell.price - buy.price) * matchedAmount;
          estimatedPnL += profit;
          
          buy.remainingAmount -= matchedAmount;
          sellAmountRemaining -= matchedAmount;
        }
      }
      
      // Subtract fees
      estimatedPnL -= totalFees;
    }
    
    return {
      pnl: parseFloat(realizedPnL.toFixed(2)),
      estimatedPnl: parseFloat(estimatedPnL.toFixed(2)),
      trades: trades.length,
      buys: buyCount,
      sells: sellCount,
      completedCycles,
      totalBuyValue: parseFloat(totalBuyValue.toFixed(2)),
      totalSellValue: parseFloat(totalSellValue.toFixed(2)),
      totalFees: parseFloat(totalFees.toFixed(4))
    };
  } catch (e) {
    return { pnl: 0, estimatedPnl: 0, trades: 0, error: e.message };
  }
}

/**
 * Calculate unrealized P&L for crypto holdings
 * Compares current value to cost basis from recent buys
 */
function calculateUnrealizedPnL(db, currentEquity, snapshot24hAgo) {
  const result = {
    btc: { unrealized: 0, costBasis: 0, currentValue: 0, holdings: 0 },
    eth: { unrealized: 0, costBasis: 0, currentValue: 0, holdings: 0 },
    sol: { unrealized: 0, costBasis: 0, currentValue: 0, holdings: 0 },
    total: 0
  };
  
  if (!currentEquity || !snapshot24hAgo) return result;
  
  // Calculate unrealized P&L based on holdings change and price change
  // BTC
  const btcHoldingsChange = currentEquity.btc_balance - snapshot24hAgo.btc_balance;
  const btcPriceChange = currentEquity.btc_price - snapshot24hAgo.btc_price;
  // Unrealized from existing holdings (price movement)
  const btcUnrealizedFromPrice = snapshot24hAgo.btc_balance * btcPriceChange;
  // Unrealized from new holdings (bought at higher/lower than current)
  const btcUnrealizedFromNewHoldings = btcHoldingsChange * (currentEquity.btc_price - snapshot24hAgo.btc_price);
  result.btc.unrealized = btcUnrealizedFromPrice;
  result.btc.holdings = currentEquity.btc_balance;
  result.btc.currentValue = currentEquity.btc_balance * currentEquity.btc_price;
  
  // ETH
  const ethPriceChange = currentEquity.eth_price - snapshot24hAgo.eth_price;
  result.eth.unrealized = snapshot24hAgo.eth_balance * ethPriceChange;
  result.eth.holdings = currentEquity.eth_balance;
  result.eth.currentValue = currentEquity.eth_balance * currentEquity.eth_price;
  
  // SOL
  const solPriceChange = currentEquity.sol_price - snapshot24hAgo.sol_price;
  result.sol.unrealized = snapshot24hAgo.sol_balance * solPriceChange;
  result.sol.holdings = currentEquity.sol_balance;
  result.sol.currentValue = currentEquity.sol_balance * currentEquity.sol_price;
  
  result.total = result.btc.unrealized + result.eth.unrealized + result.sol.unrealized;
  
  return result;
}

/**
 * Check DCA Dip Buyer status
 */
function checkDipBuyer(db) {
  const result = {
    serviceRunning: false,
    serviceDetails: null,
    positions: [],
    stats: {
      totalTrades: 0,
      totalProfit: 0,
      openPositions: 0,
      deployedCapital: 0
    }
  };
  
  // Check if dip-buyer service is running
  result.serviceRunning = checkSystemdService('dip-buyer');
  if (result.serviceRunning) {
    result.serviceDetails = getServiceDetails('dip-buyer');
  }
  
  // Check for dip_positions table and get data
  try {
    // Check if table exists
    const tableExists = db.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='dip_positions'"
    ).get();
    
    if (tableExists) {
      // Get open positions
      const openPositions = db.db.prepare(
        "SELECT * FROM dip_positions WHERE status = 'open' ORDER BY entry_time DESC"
      ).all();
      
      result.positions = openPositions;
      result.stats.openPositions = openPositions.length;
      
      // Calculate deployed capital
      for (const pos of openPositions) {
        result.stats.deployedCapital += pos.entry_price * pos.amount;
      }
      
      // Get closed positions for stats
      const closedPositions = db.db.prepare(
        "SELECT * FROM dip_positions WHERE status = 'closed'"
      ).all();
      
      result.stats.totalTrades = closedPositions.length;
      result.stats.totalProfit = closedPositions.reduce((sum, pos) => sum + (pos.profit || 0), 0);
    }
  } catch (e) {
    // Table doesn't exist yet or other error - that's okay
  }
  
  return result;
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
    console.log(`   Active Orders in DB: ${dbStatus.dbOrders}`);
    console.log(`   Total Trades: ${dbStatus.totalTrades}`);
    console.log(`   Win Rate: ${dbStatus.winRate}%`);
    console.log(`   Total P&L: $${dbStatus.totalPnL.toFixed(2)}`);
    
    // Display 24-hour P&L
    if (dbStatus.pnl24h) {
      const pnl24h = dbStatus.pnl24h;
      const pnlColor = pnl24h.pnl >= 0 ? '\x1b[32m' : '\x1b[31m'; // Green for positive, red for negative
      const pnlSign = pnl24h.pnl >= 0 ? '+' : '';
      console.log(`   24h P&L: ${pnlColor}${pnlSign}$${pnl24h.pnl.toFixed(2)}\x1b[0m (${pnl24h.trades} trades: ${pnl24h.buys || 0} buys, ${pnl24h.sells || 0} sells, ${pnl24h.completedCycles || 0} cycles)`);
      
      // Show estimated P&L if there were sells (matches 24h sells with historical buys)
      if (pnl24h.sells > 0 && pnl24h.estimatedPnl !== undefined) {
        const estColor = pnl24h.estimatedPnl >= 0 ? '\x1b[32m' : '\x1b[31m';
        const estSign = pnl24h.estimatedPnl >= 0 ? '+' : '';
        console.log(`   24h Est. P&L: ${estColor}${estSign}$${pnl24h.estimatedPnl.toFixed(2)}\x1b[0m (sells matched with historical buys)`);
      }
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
    // Format the last activity timestamp for display
    // Log format is [HH:MM:SS] so we combine with file modification date
    const formatActivityTime = (timestamp, fileAgeSeconds) => {
      if (!timestamp) return null;
      try {
        // If timestamp is just time (HH:MM:SS), combine with today's date
        if (/^\d{2}:\d{2}:\d{2}$/.test(timestamp)) {
          // Use file modification time to get the correct date
          const fileModTime = new Date(Date.now() - (fileAgeSeconds * 1000));
          return fileModTime.toLocaleString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            hour: 'numeric', 
            minute: '2-digit', 
            second: '2-digit',
            hour12: true,
            timeZoneName: 'short'
          });
        }
        // Try parsing as full date
        const date = new Date(timestamp);
        if (isNaN(date.getTime())) return timestamp;
        return date.toLocaleString('en-US', { 
          month: 'short', 
          day: 'numeric', 
          hour: 'numeric', 
          minute: '2-digit', 
          second: '2-digit',
          hour12: true,
          timeZoneName: 'short'
        });
      } catch (e) {
        return timestamp;
      }
    };
    
    const formattedTime = formatActivityTime(logStatus.lastTimestamp, logStatus.ageSeconds);
    const timeDisplay = formattedTime ? ` (${formattedTime})` : '';
    
    if (logStatus.isStale && processStatus.running) {
      console.log(warning(`Log is stale (${logStatus.ageSeconds.toFixed(0)}s since last update)${timeDisplay}`));
      results.issues.push('Stale log activity');
    } else if (processStatus.running) {
      console.log(success(`Recent activity detected${timeDisplay}`));
    } else {
      console.log(info(`Last activity: ${logStatus.ageSeconds.toFixed(0)}s ago${timeDisplay}`));
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
  
  // 3b. Check systemd journal for errors in CURRENT session only
  // Map: live-btc-bot -> enhanced-btc-bot
  const serviceName = botName.replace('live-', 'enhanced-');
  const systemdErrors = checkCurrentSessionErrors(serviceName);
  
  if (systemdErrors.hasErrors) {
    console.log(warning(`Errors in current session (${systemdErrors.count})`));
    for (const err of systemdErrors.recentErrors) {
      // Extract just the relevant part of the error message
      const shortErr = err.length > 80 ? err.substring(0, 80) + '...' : err;
      console.log(`   ${colors.red}→ ${shortErr}${colors.reset}`);
    }
    results.issues.push('Errors in current session');
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
 * Display DCA Dip Buyer status
 */
function displayDipBuyerStatus(dipBuyerStatus, tickers) {
  console.log(`\n${header('━'.repeat(60))}`);
  console.log(header(`  ${colors.magenta}DCA DIP BUYER${colors.reset}`));
  console.log(`${header('━'.repeat(60))}\n`);
  
  // Service status
  console.log(header('🔄 Service Status:'));
  if (dipBuyerStatus.serviceRunning) {
    console.log(success(`Dip Buyer service is running`));
    if (dipBuyerStatus.serviceDetails) {
      console.log(`   PID: ${dipBuyerStatus.serviceDetails.pid}`);
      console.log(`   State: ${dipBuyerStatus.serviceDetails.state} (${dipBuyerStatus.serviceDetails.subState})`);
      console.log(`   Memory: ${dipBuyerStatus.serviceDetails.memory}`);
    }
  } else {
    console.log(warning(`Dip Buyer service is NOT running`));
  }
  
  // Configuration
  console.log(`\n${header('⚙️  Configuration:')}`);
  console.log(`   Dip Threshold: -3.0%`);
  console.log(`   Order Size: $100`);
  console.log(`   Take Profit: +2.5%`);
  console.log(`   Stop Loss: -5.0%`);
  console.log(`   Max Deployed: $1,000`);
  
  // Open positions
  console.log(`\n${header('📊 Open Positions:')}`);
  if (dipBuyerStatus.positions.length > 0) {
    for (const pos of dipBuyerStatus.positions) {
      const symbol = pos.symbol;
      const coin = symbol.split('/')[0];
      const currentPrice = tickers[symbol]?.last || 0;
      const entryValue = pos.entry_price * pos.amount;
      const currentValue = currentPrice * pos.amount;
      const pnl = currentValue - entryValue;
      const pnlPct = ((currentPrice - pos.entry_price) / pos.entry_price) * 100;
      
      const pnlColor = pnl >= 0 ? colors.green : colors.red;
      const pnlSign = pnl >= 0 ? '+' : '';
      
      console.log(`   ${colors.cyan}${symbol}${colors.reset}:`);
      console.log(`      Amount: ${pos.amount.toFixed(6)} ${coin}`);
      console.log(`      Entry: $${pos.entry_price.toFixed(2)} | Current: $${currentPrice.toFixed(2)}`);
      console.log(`      Value: $${entryValue.toFixed(2)} → $${currentValue.toFixed(2)}`);
      console.log(`      P&L: ${pnlColor}${pnlSign}$${pnl.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%)${colors.reset}`);
      console.log(`      Entry Time: ${pos.entry_time}`);
    }
  } else {
    console.log(info(`No open positions`));
  }
  
  // Statistics
  console.log(`\n${header('📈 Statistics:')}`);
  console.log(`   Open Positions: ${dipBuyerStatus.stats.openPositions}`);
  console.log(`   Capital Deployed: $${dipBuyerStatus.stats.deployedCapital.toFixed(2)}`);
  console.log(`   Completed Trades: ${dipBuyerStatus.stats.totalTrades}`);
  const profitColor = dipBuyerStatus.stats.totalProfit >= 0 ? colors.green : colors.red;
  const profitSign = dipBuyerStatus.stats.totalProfit >= 0 ? '+' : '';
  console.log(`   Total Profit: ${profitColor}${profitSign}$${dipBuyerStatus.stats.totalProfit.toFixed(2)}${colors.reset}`);
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
  
  console.log(info(`Found ${bots.length} grid bot(s) configured`));
  
  // Fetch current balances and prices for equity calculation
  let currentEquity = null;
  let allCoinsEquity = null;
  let tickers = null;
  let capitalDeployment = null;
  try {
    const balance = await exchange.fetchBalance();
    tickers = await exchange.fetchTickers(['BTC/USD', 'ETH/USD', 'SOL/USD']);
    
    // Monitored coins (BTC, ETH, SOL, USD)
    const usdBalance = balance.USD?.total || 0;
    const usdFree = balance.USD?.free || 0;
    const usdInOrders = balance.USD?.used || 0;
    const btcBalance = balance.BTC?.total || 0;
    const btcFree = balance.BTC?.free || 0;
    const btcInOrders = balance.BTC?.used || 0;
    const ethBalance = balance.ETH?.total || 0;
    const ethFree = balance.ETH?.free || 0;
    const ethInOrders = balance.ETH?.used || 0;
    const solBalance = balance.SOL?.total || 0;
    const solFree = balance.SOL?.free || 0;
    const solInOrders = balance.SOL?.used || 0;
    
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
    
    // Calculate capital deployment (funds tied up in orders)
    const btcInOrdersUsd = btcInOrders * btcPrice;
    const ethInOrdersUsd = ethInOrders * ethPrice;
    const solInOrdersUsd = solInOrders * solPrice;
    const totalInOrders = usdInOrders + btcInOrdersUsd + ethInOrdersUsd + solInOrdersUsd;
    const totalFree = usdFree + (btcFree * btcPrice) + (ethFree * ethPrice) + (solFree * solPrice);
    const utilizationPct = monitoredEquityUsd > 0 ? (totalInOrders / monitoredEquityUsd) * 100 : 0;
    
    capitalDeployment = {
      usdInOrders,
      btcInOrders,
      btcInOrdersUsd,
      ethInOrders,
      ethInOrdersUsd,
      solInOrders,
      solInOrdersUsd,
      totalInOrders,
      totalFree,
      utilizationPct
    };
    
    // Calculate total equity from ALL coins
    let totalAllCoinsUsd = 0;
    const otherCoins = [];
    const unpricedCoins = [];
    
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
          // Try multiple pricing methods for other coins
          let priced = false;
          let coinPrice = 0;
          let pricePair = '';
          
          // Method 1: Try USD pair
          try {
            const ticker = await exchange.fetchTicker(`${coin}/USD`);
            coinPrice = ticker?.last || 0;
            if (coinPrice > 0) {
              priced = true;
              pricePair = 'USD';
            }
          } catch (e) { /* No USD pair */ }
          
          // Method 2: Try USDT pair
          if (!priced) {
            try {
              const ticker = await exchange.fetchTicker(`${coin}/USDT`);
              coinPrice = ticker?.last || 0;
              if (coinPrice > 0) {
                priced = true;
                pricePair = 'USDT';
              }
            } catch (e) { /* No USDT pair */ }
          }
          
          // Method 3: Try BTC pair and convert via BTC price
          if (!priced) {
            try {
              const ticker = await exchange.fetchTicker(`${coin}/BTC`);
              const btcPairPrice = ticker?.last || 0;
              if (btcPairPrice > 0) {
                coinPrice = btcPairPrice * btcPrice;  // Convert to USD
                priced = true;
                pricePair = 'BTC';
              }
            } catch (e) { /* No BTC pair */ }
          }
          
          // Method 4: Try ETH pair and convert via ETH price
          if (!priced) {
            try {
              const ticker = await exchange.fetchTicker(`${coin}/ETH`);
              const ethPairPrice = ticker?.last || 0;
              if (ethPairPrice > 0) {
                coinPrice = ethPairPrice * ethPrice;  // Convert to USD
                priced = true;
                pricePair = 'ETH';
              }
            } catch (e) { /* No ETH pair */ }
          }
          
          if (priced) {
            const coinValue = total * coinPrice;
            if (coinValue > 0.01) {  // Only include if worth more than 1 cent
              totalAllCoinsUsd += coinValue;
              otherCoins.push({ coin, balance: total, price: coinPrice, value: coinValue, pricePair });
            }
          } else {
            // Track unpriced coins
            unpricedCoins.push({ coin, balance: total });
          }
        }
      }
    }
    
    allCoinsEquity = {
      total: totalAllCoinsUsd,
      otherCoins: otherCoins.sort((a, b) => b.value - a.value),  // Sort by value descending
      unpricedCoins: unpricedCoins
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
  
  // Check DCA Dip Buyer status
  const dipBuyerStatus = checkDipBuyer(db);
  displayDipBuyerStatus(dipBuyerStatus, tickers || {});
  
  // Overall summary
  console.log('\n' + '═'.repeat(60));
  console.log(header('       OVERALL SUMMARY'));
  console.log('═'.repeat(60) + '\n');
  
  const healthyBots = results.filter(r => r.healthy && r.issues.length === 0);
  const issueBots = results.filter(r => r.issues.length > 0);
  
  // Bot status summary
  console.log(header('Bot Status:'));
  console.log(`   Grid Bots: ${bots.length} (${colors.green}${healthyBots.length} healthy${colors.reset}, ${colors.red}${issueBots.length} with issues${colors.reset})`);
  console.log(`   Dip Buyer: ${dipBuyerStatus.serviceRunning ? `${colors.green}Running${colors.reset}` : `${colors.red}Stopped${colors.reset}`}`);
  
  // P&L Summary (including dip buyer)
  const combinedTotalProfit = totalPnL + dipBuyerStatus.stats.totalProfit;
  console.log(`\n${header('P&L Summary:')}`);  
  console.log(`   Grid Bots P&L (All Time): $${totalPnL.toFixed(2)}`);
  console.log(`   Dip Buyer P&L (All Time): $${dipBuyerStatus.stats.totalProfit.toFixed(2)}`);
  console.log(`   ${colors.bold}Combined P&L: $${combinedTotalProfit.toFixed(2)}${colors.reset}`);
  const pnl24hColor = total24hPnL >= 0 ? colors.green : colors.red;
  const pnl24hSign = total24hPnL >= 0 ? '+' : '';
  console.log(`   24h Grid P&L: ${pnl24hColor}${pnl24hSign}$${total24hPnL.toFixed(2)}${colors.reset} (${total24hTrades} trades)`);
  
  // Capital Deployment Summary
  if (capitalDeployment) {
    console.log(`\n${header('Capital Deployment:')}`);  
    console.log(`   ${colors.bold}Total in Grid Orders: $${capitalDeployment.totalInOrders.toFixed(2)}${colors.reset}`);
    console.log(`      USD in buy orders: $${capitalDeployment.usdInOrders.toFixed(2)}`);
    if (capitalDeployment.btcInOrdersUsd > 0.01) {
      console.log(`      BTC in sell orders: ${capitalDeployment.btcInOrders.toFixed(6)} ($${capitalDeployment.btcInOrdersUsd.toFixed(2)})`);
    }
    if (capitalDeployment.ethInOrdersUsd > 0.01) {
      console.log(`      ETH in sell orders: ${capitalDeployment.ethInOrders.toFixed(6)} ($${capitalDeployment.ethInOrdersUsd.toFixed(2)})`);
    }
    if (capitalDeployment.solInOrdersUsd > 0.01) {
      console.log(`      SOL in sell orders: ${capitalDeployment.solInOrders.toFixed(6)} ($${capitalDeployment.solInOrdersUsd.toFixed(2)})`);
    }
    console.log(`   Available (not in orders): $${capitalDeployment.totalFree.toFixed(2)}`);
    
    // Utilization bar
    const utilPct = capitalDeployment.utilizationPct;
    const barLength = 20;
    const filledLength = Math.round((utilPct / 100) * barLength);
    const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
    const utilColor = utilPct >= 70 ? colors.green : utilPct >= 40 ? colors.yellow : colors.red;
    console.log(`   Capital Utilization: ${utilColor}[${bar}] ${utilPct.toFixed(1)}%${colors.reset}`);
  }
  
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
        const pairInfo = coin.pricePair ? ` [via ${coin.pricePair}]` : '';
        console.log(`      ${coin.coin}: ${coin.balance.toFixed(6)} ($${coin.value.toFixed(2)})${colors.blue}${pairInfo}${colors.reset}`);
      }
    }
    
    // Show unpriced coins if any
    if (allCoinsEquity && allCoinsEquity.unpricedCoins && allCoinsEquity.unpricedCoins.length > 0) {
      console.log(`\n   ${colors.yellow}Unpriced Holdings (no trading pair found):${colors.reset}`);
      for (const coin of allCoinsEquity.unpricedCoins) {
        console.log(`      ${coin.coin}: ${coin.balance.toFixed(6)} ${colors.yellow}(value unknown)${colors.reset}`);
      }
    }
    
    // Calculate 24h equity change (based on monitored coins for consistency)
    const snapshot24hAgo = db.getEquitySnapshot24hAgo();
    if (snapshot24hAgo) {
      const equityChange = currentEquity.total_equity_usd - snapshot24hAgo.total_equity_usd;
      const equityChangePct = (equityChange / snapshot24hAgo.total_equity_usd) * 100;
      const eqColor = equityChange >= 0 ? colors.green : colors.red;
      const eqSign = equityChange >= 0 ? '+' : '';
      
      // Calculate unrealized P&L breakdown
      const unrealizedPnL = calculateUnrealizedPnL(db, currentEquity, snapshot24hAgo);
      
      // 24h P&L Breakdown section
      console.log(`\n${header('   24h P&L Breakdown:')}`);  
      console.log(`   ┌─────────────────────────────────────────────────────┐`);
      
      // Realized P&L (from completed trades)
      const realized24hColor = total24hPnL >= 0 ? colors.green : colors.red;
      const realized24hSign = total24hPnL >= 0 ? '+' : '';
      console.log(`   │ ${colors.green}✓ Realized P&L${colors.reset} (completed trades):  ${realized24hColor}${realized24hSign}$${total24hPnL.toFixed(2)}${colors.reset}`.padEnd(68) + '│');
      
      // Unrealized P&L (from price movement on holdings)
      const unrealizedColor = unrealizedPnL.total >= 0 ? colors.green : colors.red;
      const unrealizedSign = unrealizedPnL.total >= 0 ? '+' : '';
      console.log(`   │ ${colors.yellow}◷ Unrealized P&L${colors.reset} (price movement):  ${unrealizedColor}${unrealizedSign}$${unrealizedPnL.total.toFixed(2)}${colors.reset}`.padEnd(68) + '│');
      
      // Show breakdown by coin if significant
      if (Math.abs(unrealizedPnL.btc.unrealized) > 1) {
        const btcColor = unrealizedPnL.btc.unrealized >= 0 ? colors.green : colors.red;
        const btcSign = unrealizedPnL.btc.unrealized >= 0 ? '+' : '';
        console.log(`   │    BTC: ${btcColor}${btcSign}$${unrealizedPnL.btc.unrealized.toFixed(2)}${colors.reset}`.padEnd(60) + '│');
      }
      if (Math.abs(unrealizedPnL.eth.unrealized) > 1) {
        const ethColor = unrealizedPnL.eth.unrealized >= 0 ? colors.green : colors.red;
        const ethSign = unrealizedPnL.eth.unrealized >= 0 ? '+' : '';
        console.log(`   │    ETH: ${ethColor}${ethSign}$${unrealizedPnL.eth.unrealized.toFixed(2)}${colors.reset}`.padEnd(60) + '│');
      }
      if (Math.abs(unrealizedPnL.sol.unrealized) > 1) {
        const solColor = unrealizedPnL.sol.unrealized >= 0 ? colors.green : colors.red;
        const solSign = unrealizedPnL.sol.unrealized >= 0 ? '+' : '';
        console.log(`   │    SOL: ${solColor}${solSign}$${unrealizedPnL.sol.unrealized.toFixed(2)}${colors.reset}`.padEnd(60) + '│');
      }
      
      // Calculate and show discrepancy (other holdings, fees, USD changes)
      const trackedPnL = total24hPnL + unrealizedPnL.total;
      const discrepancy = equityChange - trackedPnL;
      if (Math.abs(discrepancy) > 0.50) {
        const discColor = discrepancy >= 0 ? colors.green : colors.red;
        const discSign = discrepancy >= 0 ? '+' : '';
        console.log(`   │    Other: ${discColor}${discSign}$${discrepancy.toFixed(2)}${colors.reset} (ZEC, fees, USD)`.padEnd(60) + '│');
      }
      
      console.log(`   ├─────────────────────────────────────────────────────┤`);
      
      // Net equity change
      console.log(`   │ ${colors.bold}Net Equity Change${colors.reset}:              ${eqColor}${eqSign}$${equityChange.toFixed(2)} (${eqSign}${equityChangePct.toFixed(2)}%)${colors.reset}`.padEnd(68) + '│');
      console.log(`   └─────────────────────────────────────────────────────┘`);
      
      // Explanation note
      if (equityChange < 0 && total24hPnL >= 0) {
        console.log(`\n   ${colors.cyan}ℹ️  Note: Your realized profits are positive. The equity drop is from${colors.reset}`);
        console.log(`   ${colors.cyan}   unrealized losses (market price movement on your holdings).${colors.reset}`);
        console.log(`   ${colors.cyan}   These will recover when prices bounce back.${colors.reset}`);
      }
      
      console.log(`\n   (Equity 24h ago: $${snapshot24hAgo.total_equity_usd.toFixed(2)})`);
    } else {
      console.log(`\n   ${colors.yellow}24h P&L Breakdown: Not enough history yet${colors.reset}`);
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
