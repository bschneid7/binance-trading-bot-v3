#!/usr/bin/env node

/**
 * Grid Trading Bot - Alert Monitor
 * Version: 1.1.0
 * 
 * Monitors bot health and sends email alerts for critical issues:
 * 1. Bot process not running
 * 2. Stale log activity (no updates in 10+ minutes)
 * 3. Large drawdown (equity drop > 5% in 24h)
 * 4. Order sync issues (mismatch between DB and exchange)
 * 5. Daily summary report
 * 
 * Uses Gmail SMTP via nodemailer for sending emails.
 * 
 * Usage:
 *   node alert-monitor.mjs              # Check and alert if issues
 *   node alert-monitor.mjs --daily      # Send daily summary
 *   node alert-monitor.mjs --test       # Send test email
 */

import ccxt from 'ccxt';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import { execSync } from 'child_process';
import { existsSync, statSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDatabase, closeDatabase } from './database.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment
dotenv.config({ path: join(__dirname, '.env.production') });

// Configuration
const CONFIG = {
  alertEmail: process.env.ALERT_EMAIL || 'bschneid7@gmail.com',
  gmailUser: process.env.GMAIL_USER || 'bschneid7@gmail.com',
  gmailAppPassword: process.env.GMAIL_APP_PASSWORD,
  staleThresholdMinutes: 10,
  drawdownAlertThreshold: 0.05, // 5%
  orderMismatchThreshold: 5, // Alert if > 5 orders mismatch
  alertCooldownMinutes: 60, // Don't send same alert within 60 minutes
  alertStateFile: join(__dirname, 'data', 'alert-state.json')
};

// Validate configuration
if (!CONFIG.gmailAppPassword) {
  console.error('❌ GMAIL_APP_PASSWORD not set in .env.production');
  console.error('   Add: GMAIL_APP_PASSWORD=your_app_password');
  process.exit(1);
}

// Create email transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: CONFIG.gmailUser,
    pass: CONFIG.gmailAppPassword
  }
});

// Alert state management
function loadAlertState() {
  try {
    if (existsSync(CONFIG.alertStateFile)) {
      return JSON.parse(readFileSync(CONFIG.alertStateFile, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading alert state:', e.message);
  }
  return { lastAlerts: {}, lastDailySummary: null };
}

function saveAlertState(state) {
  try {
    writeFileSync(CONFIG.alertStateFile, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('Error saving alert state:', e.message);
  }
}

function shouldSendAlert(alertKey, state) {
  const lastAlert = state.lastAlerts[alertKey];
  if (!lastAlert) return true;
  
  const cooldownMs = CONFIG.alertCooldownMinutes * 60 * 1000;
  return (Date.now() - new Date(lastAlert).getTime()) > cooldownMs;
}

function markAlertSent(alertKey, state) {
  state.lastAlerts[alertKey] = new Date().toISOString();
  saveAlertState(state);
}

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
    return { fresh: false, reason: 'Log file not found' };
  }
  
  const stats = statSync(logPath);
  const ageMinutes = (Date.now() - stats.mtimeMs) / (1000 * 60);
  
  return {
    fresh: ageMinutes < CONFIG.staleThresholdMinutes,
    ageMinutes: Math.round(ageMinutes),
    lastModified: stats.mtime.toISOString()
  };
}

// Check order sync
async function checkOrderSync(botName, exchange, db) {
  try {
    const bot = db.getBot(botName);
    if (!bot) return { synced: true };
    
    const exchangeOrders = await exchange.fetchOpenOrders(bot.symbol);
    const dbOrders = db.getActiveOrders(botName);
    
    const mismatch = Math.abs(exchangeOrders.length - dbOrders.length);
    
    return {
      synced: mismatch <= CONFIG.orderMismatchThreshold,
      exchangeOrders: exchangeOrders.length,
      dbOrders: dbOrders.length,
      mismatch
    };
  } catch (e) {
    return { synced: true, error: e.message };
  }
}

// Check equity drawdown
function checkEquityDrawdown(db) {
  try {
    const latest = db.getLatestEquitySnapshot();
    const snapshot24hAgo = db.getEquitySnapshot24hAgo();
    
    if (!latest || !snapshot24hAgo) {
      return { hasDrawdown: false, reason: 'Not enough history' };
    }
    
    const change = (latest.total_equity_usd - snapshot24hAgo.total_equity_usd) / snapshot24hAgo.total_equity_usd;
    
    return {
      hasDrawdown: change < -CONFIG.drawdownAlertThreshold,
      change: change,
      changePct: (change * 100).toFixed(2),
      currentEquity: latest.total_equity_usd,
      previousEquity: snapshot24hAgo.total_equity_usd
    };
  } catch (e) {
    return { hasDrawdown: false, error: e.message };
  }
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
    
    return { pnl, trades: trades.length, cycles };
  } catch (e) {
    return { pnl: 0, trades: 0, cycles: 0 };
  }
}

// Send email via Gmail SMTP
async function sendEmail(subject, content) {
  const mailOptions = {
    from: `Grid Trading Bot <${CONFIG.gmailUser}>`,
    to: CONFIG.alertEmail,
    subject: subject,
    text: content
  };
  
  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Email sent:', info.messageId);
    return true;
  } catch (e) {
    console.error('❌ Failed to send email:', e.message);
    return false;
  }
}

// Generate daily summary
async function generateDailySummary(exchange, db) {
  const bots = db.getAllBots();
  let summary = `GRID TRADING BOT - DAILY SUMMARY\n`;
  summary += `================================\n`;
  summary += `Date: ${new Date().toISOString().split('T')[0]}\n\n`;
  
  let totalPnL = 0;
  let total24hPnL = 0;
  let allHealthy = true;
  
  for (const bot of bots) {
    const process = checkProcess(bot.name);
    const logStatus = checkLogFreshness(bot.name);
    const metrics = db.getMetrics(bot.name);
    const pnl24h = calculate24hPnL(db, bot.name);
    
    if (!process.running || !logStatus.fresh) allHealthy = false;
    
    totalPnL += metrics?.total_pnl || 0;
    total24hPnL += pnl24h.pnl;
    
    summary += `${bot.name.toUpperCase()} (${bot.symbol})\n`;
    summary += `-`.repeat(40) + `\n`;
    summary += `  Status: ${process.running ? 'RUNNING' : 'STOPPED'}\n`;
    summary += `  Log Activity: ${logStatus.fresh ? 'Active' : `Stale (${logStatus.ageMinutes}m ago)`}\n`;
    summary += `  Orders: ${db.getActiveOrders(bot.name).length}\n`;
    summary += `  Total Trades: ${metrics?.total_trades || 0}\n`;
    summary += `  Win Rate: ${metrics?.win_rate || 0}%\n`;
    summary += `  Total P&L: $${(metrics?.total_pnl || 0).toFixed(2)}\n`;
    summary += `  24h P&L: $${pnl24h.pnl.toFixed(2)} (${pnl24h.cycles} cycles)\n\n`;
  }
  
  // Equity summary
  const latest = db.getLatestEquitySnapshot();
  const snapshot24hAgo = db.getEquitySnapshot24hAgo();
  
  summary += `PORTFOLIO SUMMARY\n`;
  summary += `=`.repeat(40) + `\n`;
  summary += `  Total P&L (All Time): $${totalPnL.toFixed(2)}\n`;
  summary += `  24h Realized P&L: $${total24hPnL.toFixed(2)}\n`;
  
  if (latest) {
    summary += `  Current Equity: $${latest.total_equity_usd.toFixed(2)}\n`;
    if (snapshot24hAgo) {
      const eqChange = latest.total_equity_usd - snapshot24hAgo.total_equity_usd;
      const eqChangePct = (eqChange / snapshot24hAgo.total_equity_usd * 100).toFixed(2);
      summary += `  24h Equity Change: $${eqChange.toFixed(2)} (${eqChangePct}%)\n`;
    }
  }
  
  summary += `\nOverall Status: ${allHealthy ? 'ALL SYSTEMS HEALTHY' : 'ISSUES DETECTED'}\n`;
  summary += `\nGenerated: ${new Date().toISOString()}\n`;
  
  return summary;
}

// Main alert check
async function runAlertCheck(options = {}) {
  console.log(`\n🔍 Running alert check at ${new Date().toISOString()}\n`);
  
  const state = loadAlertState();
  const alerts = [];
  
  // Initialize exchange
  const exchange = new ccxt.binanceus({
    apiKey: process.env.BINANCE_API_KEY,
    secret: process.env.BINANCE_SECRET_KEY,
    enableRateLimit: true
  });
  
  const db = getDatabase();
  const bots = db.getAllBots();
  
  for (const bot of bots) {
    // Check process
    const process = checkProcess(bot.name);
    if (!process.running) {
      const alertKey = `process_down_${bot.name}`;
      if (shouldSendAlert(alertKey, state)) {
        alerts.push({
          type: 'CRITICAL',
          bot: bot.name,
          message: `Bot process is NOT RUNNING`,
          key: alertKey
        });
      }
    }
    
    // Check log freshness
    const logStatus = checkLogFreshness(bot.name);
    if (!logStatus.fresh && process.running) {
      const alertKey = `stale_log_${bot.name}`;
      if (shouldSendAlert(alertKey, state)) {
        alerts.push({
          type: 'WARNING',
          bot: bot.name,
          message: `Log is stale - no activity for ${logStatus.ageMinutes} minutes`,
          key: alertKey
        });
      }
    }
    
    // Check order sync
    const syncStatus = await checkOrderSync(bot.name, exchange, db);
    if (!syncStatus.synced && syncStatus.mismatch > CONFIG.orderMismatchThreshold) {
      const alertKey = `order_mismatch_${bot.name}`;
      if (shouldSendAlert(alertKey, state)) {
        alerts.push({
          type: 'WARNING',
          bot: bot.name,
          message: `Order mismatch: ${syncStatus.exchangeOrders} on exchange, ${syncStatus.dbOrders} in DB`,
          key: alertKey
        });
      }
    }
  }
  
  // Check equity drawdown
  const drawdown = checkEquityDrawdown(db);
  if (drawdown.hasDrawdown) {
    const alertKey = 'equity_drawdown';
    if (shouldSendAlert(alertKey, state)) {
      alerts.push({
        type: 'CRITICAL',
        bot: 'PORTFOLIO',
        message: `Equity dropped ${drawdown.changePct}% in 24h ($${drawdown.previousEquity.toFixed(2)} -> $${drawdown.currentEquity.toFixed(2)})`,
        key: alertKey
      });
    }
  }
  
  // Send alerts if any
  if (alerts.length > 0) {
    let emailContent = `GRID TRADING BOT ALERT\n`;
    emailContent += `======================\n\n`;
    emailContent += `Time: ${new Date().toISOString()}\n\n`;
    
    for (const alert of alerts) {
      emailContent += `[${alert.type}] ${alert.bot}\n`;
      emailContent += `  ${alert.message}\n\n`;
    }
    
    emailContent += `\nPlease check your bots at your earliest convenience.\n`;
    emailContent += `SSH: ssh root@147.182.249.1\n`;
    emailContent += `Health check: node health-check.mjs\n`;
    
    const subject = `🚨 Grid Bot Alert: ${alerts.length} issue(s) detected`;
    const sent = await sendEmail(subject, emailContent);
    
    if (sent) {
      for (const alert of alerts) {
        markAlertSent(alert.key, state);
      }
    }
    
    console.log(`⚠️  ${alerts.length} alert(s) sent`);
  } else {
    console.log('✅ All systems healthy - no alerts needed');
  }
  
  // Daily summary
  if (options.daily) {
    const summary = await generateDailySummary(exchange, db);
    const subject = `📊 Grid Bot Daily Summary - ${new Date().toISOString().split('T')[0]}`;
    await sendEmail(subject, summary);
    state.lastDailySummary = new Date().toISOString();
    saveAlertState(state);
    console.log('📧 Daily summary sent');
  }
  
  // Test email
  if (options.test) {
    const testContent = `This is a test email from your Grid Trading Bot alert system.\n\n`;
    const testSubject = `✅ Grid Bot Alert System - Test Email`;
    await sendEmail(testSubject, testContent + `Time: ${new Date().toISOString()}\n\nIf you received this, your alert system is working correctly!\n\nAlert Types Configured:\n- Bot process not running (CRITICAL)\n- Stale log activity > 10 minutes (WARNING)\n- Order sync mismatch > 5 orders (WARNING)\n- Equity drawdown > 5% in 24h (CRITICAL)\n\n-- Your Grid Trading Bot`);
    console.log('📧 Test email sent');
  }
  
  closeDatabase();
}

// CLI
const args = process.argv.slice(2);
const options = {
  daily: args.includes('--daily'),
  test: args.includes('--test')
};

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Grid Trading Bot - Alert Monitor (Gmail SMTP)

Usage:
  node alert-monitor.mjs              Check and alert if issues
  node alert-monitor.mjs --daily      Send daily summary report
  node alert-monitor.mjs --test       Send test email

Alert Types:
  - Bot process not running (CRITICAL)
  - Stale log activity > 10 minutes (WARNING)
  - Order sync mismatch > 5 orders (WARNING)
  - Equity drawdown > 5% in 24h (CRITICAL)

Environment Variables Required:
  GMAIL_USER          Gmail address (default: bschneid7@gmail.com)
  GMAIL_APP_PASSWORD  Gmail app password
  ALERT_EMAIL         Recipient email (default: bschneid7@gmail.com)

Emails sent to: ${CONFIG.alertEmail}
  `);
  process.exit(0);
}

runAlertCheck(options).catch(error => {
  console.error('Alert check failed:', error.message);
  process.exit(1);
});
