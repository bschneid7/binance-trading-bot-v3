#!/usr/bin/env node

/**
 * Grid Trading Bot - Cron Monitor
 * Version: 1.0.0
 * 
 * Runs via cron every 5 minutes to check bot health.
 * Logs issues to a file for later review.
 * 
 * Usage:
 *   node monitor-cron.mjs           # Run health check, log issues
 *   node monitor-cron.mjs --summary # Print summary of recent issues
 *   node monitor-cron.mjs --clear   # Clear issue log
 */

import dotenv from 'dotenv';
import { execSync } from 'child_process';
import { existsSync, statSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDatabase, closeDatabase } from './database.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment
dotenv.config({ path: join(__dirname, '.env.production') });

// Configuration
const CONFIG = {
  issueLogFile: join(__dirname, 'data', 'issues.log'),
  summaryFile: join(__dirname, 'data', 'daily-summary.json'),
  staleThresholdMinutes: 10,
  drawdownAlertThreshold: 0.05 // 5%
};

// Check if monitor process is running
function checkProcess(botName) {
  try {
    const result = execSync(`ps aux | grep "enhanced-monitor.mjs ${botName}" | grep -v grep`, { encoding: 'utf8' });
    if (result.trim()) {
      const parts = result.trim().split(/\s+/);
      return { running: true, pid: parts[1] };
    }
  } catch (e) {
    // Process not found
  }
  return { running: false };
}

// Check log freshness
function checkLogFreshness(botName) {
  const serviceMap = {
    'live-btc-bot': 'enhanced-btc-bot',
    'live-eth-bot': 'enhanced-eth-bot',
    'live-sol-bot': 'enhanced-sol-bot'
  };
  
  const logName = serviceMap[botName] || botName;
  const logPath = join(__dirname, 'logs', `${logName}.log`);
  
  if (!existsSync(logPath)) {
    return { fresh: false, ageMinutes: -1 };
  }
  
  const stats = statSync(logPath);
  const ageMinutes = (Date.now() - stats.mtimeMs) / (1000 * 60);
  
  return {
    fresh: ageMinutes < CONFIG.staleThresholdMinutes,
    ageMinutes: Math.round(ageMinutes)
  };
}

// Calculate 24h P&L
function calculate24hPnL(db, botName) {
  try {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const yesterdayStr = yesterday.toISOString().replace('T', ' ').slice(0, 19);
    
    const trades = db.db.prepare(`
      SELECT side, price, amount, fee FROM trades 
      WHERE bot_name = ? AND timestamp >= ?
      ORDER BY price ASC
    `).all(botName, yesterdayStr);
    
    const buys = trades.filter(t => t.side.toLowerCase() === 'buy');
    const sells = trades.filter(t => t.side.toLowerCase() === 'sell');
    
    let pnl = 0;
    const cycles = Math.min(buys.length, sells.length);
    
    for (let i = 0; i < cycles; i++) {
      const buyValue = buys[i].price * buys[i].amount;
      const sellValue = sells[i].price * sells[i].amount;
      pnl += (sellValue - buyValue) - (buys[i].fee || 0) - (sells[i].fee || 0);
    }
    
    return { pnl: Math.round(pnl * 100) / 100, trades: trades.length, cycles };
  } catch (e) {
    return { pnl: 0, trades: 0, cycles: 0 };
  }
}

// Log an issue
function logIssue(type, bot, message) {
  const timestamp = new Date().toISOString();
  const logLine = `${timestamp} | ${type} | ${bot} | ${message}\n`;
  appendFileSync(CONFIG.issueLogFile, logLine);
  console.log(`[${type}] ${bot}: ${message}`);
}

// Run health check
function runHealthCheck() {
  const timestamp = new Date().toISOString();
  console.log(`\n🔍 Health check at ${timestamp}\n`);
  
  const db = getDatabase();
  const bots = db.getAllBots();
  const issues = [];
  
  let totalPnL = 0;
  let total24hPnL = 0;
  let allHealthy = true;
  
  for (const bot of bots) {
    const process = checkProcess(bot.name);
    const logStatus = checkLogFreshness(bot.name);
    const metrics = db.getMetrics(bot.name);
    const pnl24h = calculate24hPnL(db, bot.name);
    
    totalPnL += metrics?.total_pnl || 0;
    total24hPnL += pnl24h.pnl;
    
    // Check for issues
    if (!process.running) {
      logIssue('CRITICAL', bot.name, 'Process not running');
      issues.push({ type: 'CRITICAL', bot: bot.name, message: 'Process not running' });
      allHealthy = false;
    } else if (!logStatus.fresh) {
      logIssue('WARNING', bot.name, `Log stale (${logStatus.ageMinutes}m ago)`);
      issues.push({ type: 'WARNING', bot: bot.name, message: `Log stale (${logStatus.ageMinutes}m ago)` });
      allHealthy = false;
    } else {
      console.log(`✅ ${bot.name}: Running, ${db.getActiveOrders(bot.name).length} orders`);
    }
  }
  
  // Check equity drawdown
  const latestEquity = db.getLatestEquitySnapshot();
  const equity24hAgo = db.getEquitySnapshot24hAgo();
  
  if (latestEquity && equity24hAgo) {
    const change = (latestEquity.total_equity_usd - equity24hAgo.total_equity_usd) / equity24hAgo.total_equity_usd;
    if (change < -CONFIG.drawdownAlertThreshold) {
      const changePct = (change * 100).toFixed(2);
      logIssue('CRITICAL', 'PORTFOLIO', `Equity down ${changePct}% in 24h`);
      issues.push({ type: 'CRITICAL', bot: 'PORTFOLIO', message: `Equity down ${changePct}%` });
      allHealthy = false;
    }
  }
  
  // Save summary
  const summary = {
    timestamp,
    healthy: allHealthy,
    issues: issues.length,
    totalPnL: Math.round(totalPnL * 100) / 100,
    pnl24h: Math.round(total24hPnL * 100) / 100,
    equity: latestEquity ? Math.round(latestEquity.total_equity_usd * 100) / 100 : null
  };
  
  writeFileSync(CONFIG.summaryFile, JSON.stringify(summary, null, 2));
  
  closeDatabase();
  
  if (allHealthy) {
    console.log('\n✅ All systems healthy');
  } else {
    console.log(`\n⚠️  ${issues.length} issue(s) detected - logged to ${CONFIG.issueLogFile}`);
  }
  
  return { healthy: allHealthy, issues };
}

// Show summary of recent issues
function showSummary() {
  console.log('\n📊 ISSUE SUMMARY\n');
  
  if (!existsSync(CONFIG.issueLogFile)) {
    console.log('No issues logged yet.');
    return;
  }
  
  const issues = readFileSync(CONFIG.issueLogFile, 'utf8').trim().split('\n').filter(Boolean);
  
  if (issues.length === 0) {
    console.log('No issues logged.');
    return;
  }
  
  // Group by date
  const byDate = {};
  for (const line of issues) {
    const [timestamp, type, bot, message] = line.split(' | ');
    const date = timestamp.split('T')[0];
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push({ timestamp, type, bot, message });
  }
  
  // Show last 7 days
  const dates = Object.keys(byDate).sort().reverse().slice(0, 7);
  
  for (const date of dates) {
    console.log(`\n${date}:`);
    const dayIssues = byDate[date];
    const critical = dayIssues.filter(i => i.type === 'CRITICAL').length;
    const warning = dayIssues.filter(i => i.type === 'WARNING').length;
    console.log(`  ${critical} critical, ${warning} warnings`);
    
    // Show unique issues
    const unique = new Map();
    for (const issue of dayIssues) {
      const key = `${issue.bot}:${issue.message}`;
      if (!unique.has(key)) {
        unique.set(key, { ...issue, count: 1 });
      } else {
        unique.get(key).count++;
      }
    }
    
    for (const [key, issue] of unique) {
      console.log(`  [${issue.type}] ${issue.bot}: ${issue.message} (${issue.count}x)`);
    }
  }
  
  // Current status
  if (existsSync(CONFIG.summaryFile)) {
    const summary = JSON.parse(readFileSync(CONFIG.summaryFile, 'utf8'));
    console.log('\n📈 CURRENT STATUS:');
    console.log(`  Last check: ${summary.timestamp}`);
    console.log(`  Healthy: ${summary.healthy ? 'Yes' : 'No'}`);
    console.log(`  Total P&L: $${summary.totalPnL}`);
    console.log(`  24h P&L: $${summary.pnl24h}`);
    console.log(`  Equity: $${summary.equity}`);
  }
  
  console.log(`\nTotal issues in log: ${issues.length}`);
}

// Clear issue log
function clearLog() {
  if (existsSync(CONFIG.issueLogFile)) {
    writeFileSync(CONFIG.issueLogFile, '');
    console.log('✅ Issue log cleared');
  } else {
    console.log('No issue log to clear');
  }
}

// Generate email-ready summary
function generateEmailSummary() {
  let summary = `GRID TRADING BOT - STATUS REPORT\n`;
  summary += `================================\n`;
  summary += `Generated: ${new Date().toISOString()}\n\n`;
  
  const db = getDatabase();
  const bots = db.getAllBots();
  
  let totalPnL = 0;
  let total24hPnL = 0;
  let allHealthy = true;
  
  for (const bot of bots) {
    const process = checkProcess(bot.name);
    const logStatus = checkLogFreshness(bot.name);
    const metrics = db.getMetrics(bot.name);
    const orders = db.getActiveOrders(bot.name);
    const pnl24h = calculate24hPnL(db, bot.name);
    
    totalPnL += metrics?.total_pnl || 0;
    total24hPnL += pnl24h.pnl;
    
    if (!process.running || !logStatus.fresh) allHealthy = false;
    
    summary += `${bot.name.toUpperCase()} (${bot.symbol})\n`;
    summary += `-`.repeat(40) + `\n`;
    summary += `  Status: ${process.running ? '✅ RUNNING' : '❌ STOPPED'}\n`;
    summary += `  Log: ${logStatus.fresh ? 'Active' : `Stale (${logStatus.ageMinutes}m)`}\n`;
    summary += `  Orders: ${orders.length}\n`;
    summary += `  Total Trades: ${metrics?.total_trades || 0}\n`;
    summary += `  Win Rate: ${metrics?.win_rate || 0}%\n`;
    summary += `  Total P&L: $${(metrics?.total_pnl || 0).toFixed(2)}\n`;
    summary += `  24h P&L: $${pnl24h.pnl.toFixed(2)} (${pnl24h.cycles} cycles)\n\n`;
  }
  
  // Equity
  const latestEquity = db.getLatestEquitySnapshot();
  const equity24hAgo = db.getEquitySnapshot24hAgo();
  
  summary += `PORTFOLIO SUMMARY\n`;
  summary += `=`.repeat(40) + `\n`;
  summary += `  Total P&L (All Time): $${totalPnL.toFixed(2)}\n`;
  summary += `  24h Realized P&L: $${total24hPnL.toFixed(2)}\n`;
  
  if (latestEquity) {
    summary += `  Current Equity: $${latestEquity.total_equity_usd.toFixed(2)}\n`;
    if (equity24hAgo) {
      const eqChange = latestEquity.total_equity_usd - equity24hAgo.total_equity_usd;
      const eqChangePct = (eqChange / equity24hAgo.total_equity_usd * 100).toFixed(2);
      summary += `  24h Equity Change: $${eqChange.toFixed(2)} (${eqChangePct}%)\n`;
    }
  }
  
  // Recent issues
  if (existsSync(CONFIG.issueLogFile)) {
    const issues = readFileSync(CONFIG.issueLogFile, 'utf8').trim().split('\n').filter(Boolean);
    const today = new Date().toISOString().split('T')[0];
    const todayIssues = issues.filter(i => i.startsWith(today));
    
    if (todayIssues.length > 0) {
      summary += `\nTODAY'S ISSUES (${todayIssues.length})\n`;
      summary += `-`.repeat(40) + `\n`;
      for (const issue of todayIssues.slice(-10)) {
        const [timestamp, type, bot, message] = issue.split(' | ');
        summary += `  [${type}] ${bot}: ${message}\n`;
      }
    }
  }
  
  summary += `\nOverall Status: ${allHealthy ? '✅ ALL SYSTEMS HEALTHY' : '⚠️ ISSUES DETECTED'}\n`;
  
  closeDatabase();
  
  return summary;
}

// CLI
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Grid Trading Bot - Cron Monitor

Usage:
  node monitor-cron.mjs           Run health check, log issues
  node monitor-cron.mjs --summary Show summary of recent issues
  node monitor-cron.mjs --clear   Clear issue log
  node monitor-cron.mjs --email   Generate email-ready summary

Designed to run via cron every 5 minutes.
  `);
  process.exit(0);
}

if (args.includes('--summary')) {
  showSummary();
} else if (args.includes('--clear')) {
  clearLog();
} else if (args.includes('--email')) {
  console.log(generateEmailSummary());
} else {
  runHealthCheck();
}
