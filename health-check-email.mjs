#!/usr/bin/env node

/**
 * Grid Trading Bot - Health Check Email Reporter
 * Version: 1.0.0
 * 
 * Runs the health check and emails the summary report.
 * Designed to be run daily via systemd timer.
 */

import ccxt from 'ccxt';
import nodemailer from 'nodemailer';
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

const RECIPIENT_EMAIL = 'bschneid7@gmail.com';
const SENDER_EMAIL = process.env.GMAIL_USER || 'your-gmail@gmail.com';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || '';

// Format currency
function formatUSD(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

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
      return { running: true, pid: parts[1], cpu: parts[2], mem: parts[3] };
    }
  } catch (e) {}
  return { running: false };
}

/**
 * Check log file for recent activity
 */
function checkLogActivity(botName) {
  const logPath = join(__dirname, 'logs', `${botName}.log`);
  
  if (!existsSync(logPath)) {
    return { exists: false };
  }
  
  const stats = statSync(logPath);
  const ageSeconds = (Date.now() - stats.mtime.getTime()) / 1000;
  
  try {
    const content = readFileSync(logPath, 'utf-8');
    const lines = content.trim().split('\n').slice(-10);
    
    let lastPrice = null;
    let lastTimestamp = null;
    
    for (const line of lines.reverse()) {
      const priceMatch = line.match(/Price: \$([0-9,.]+)/);
      const timeMatch = line.match(/\[([^\]]+)\]/);
      
      if (priceMatch && !lastPrice) lastPrice = priceMatch[1];
      if (timeMatch && !lastTimestamp) lastTimestamp = timeMatch[1];
      if (lastPrice && lastTimestamp) break;
    }
    
    const hasErrors = lines.some(line => 
      line.toLowerCase().includes('error') || 
      line.toLowerCase().includes('failed') ||
      line.includes('TypeError')
    );
    
    return { exists: true, ageSeconds, lastPrice, lastTimestamp, hasErrors, isStale: ageSeconds > 120 };
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
    return {
      success: true,
      total: orders.length,
      buyCount: orders.filter(o => o.side === 'buy').length,
      sellCount: orders.filter(o => o.side === 'sell').length
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Run health check and collect data
 */
async function runHealthCheck() {
  const apiKey = process.env.BINANCE_API_KEY;
  const secret = process.env.BINANCE_API_SECRET;
  
  const exchange = new ccxt.binanceus({
    apiKey,
    secret,
    enableRateLimit: true,
    options: { defaultType: 'spot', adjustForTimeDifference: true }
  });
  
  const db = getDatabase();
  const bots = db.getAllBots();
  
  const results = [];
  let healthyCount = 0;
  let issueCount = 0;
  
  for (const bot of bots) {
    const processStatus = checkProcess(bot.name);
    const logStatus = checkLogActivity(bot.name);
    const binanceStatus = await checkBinanceOrders(exchange, bot.symbol);
    const metrics = db.getMetrics(bot.name);
    
    const issues = [];
    
    if (bot.status === 'running' && !processStatus.running) {
      issues.push('Monitor not running');
    }
    if (logStatus.isStale && processStatus.running) {
      issues.push('Stale log activity');
    }
    if (logStatus.hasErrors) {
      issues.push('Errors in logs');
    }
    if (binanceStatus.success && binanceStatus.total === 0 && bot.status === 'running') {
      issues.push('No orders on exchange');
    }
    
    const isHealthy = issues.length === 0 && (bot.status === 'stopped' || processStatus.running);
    if (isHealthy) healthyCount++;
    else issueCount++;
    
    results.push({
      name: bot.name,
      symbol: bot.symbol,
      status: bot.status,
      processRunning: processStatus.running,
      pid: processStatus.pid,
      cpu: processStatus.cpu,
      mem: processStatus.mem,
      lastPrice: logStatus.lastPrice,
      lastUpdate: logStatus.lastTimestamp,
      ordersOnExchange: binanceStatus.total || 0,
      buyOrders: binanceStatus.buyCount || 0,
      sellOrders: binanceStatus.sellCount || 0,
      totalTrades: metrics.total_trades,
      winRate: metrics.win_rate,
      totalPnL: metrics.total_pnl,
      issues,
      isHealthy
    });
  }
  
  closeDatabase();
  
  return { bots: results, healthyCount, issueCount, totalBots: bots.length };
}

/**
 * Generate HTML email
 */
function generateEmailHTML(data) {
  const overallStatus = data.issueCount === 0 ? '✅ All Systems Healthy' : `⚠️ ${data.issueCount} Bot(s) Need Attention`;
  const statusColor = data.issueCount === 0 ? '#10b981' : '#f59e0b';
  
  const botRows = data.bots.map(bot => {
    const statusIcon = bot.status === 'running' ? '🟢' : '🔴';
    const healthIcon = bot.isHealthy ? '✅' : '❌';
    const processIcon = bot.processRunning ? '✅' : '❌';
    
    return `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">
          <strong>${bot.name}</strong><br>
          <span style="color: #6b7280; font-size: 12px;">${bot.symbol}</span>
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">
          ${statusIcon} ${bot.status.toUpperCase()}
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">
          ${processIcon}
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">
          ${bot.lastPrice ? '$' + bot.lastPrice : 'N/A'}
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">
          ${bot.ordersOnExchange}<br>
          <span style="color: #6b7280; font-size: 11px;">${bot.buyOrders}B / ${bot.sellOrders}S</span>
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">
          ${bot.totalTrades}
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">
          ${healthIcon}
          ${bot.issues.length > 0 ? `<br><span style="color: #ef4444; font-size: 11px;">${bot.issues.join(', ')}</span>` : ''}
        </td>
      </tr>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; background-color: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 800px; margin: 0 auto; background-color: white; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
      <h1 style="margin: 0; font-size: 28px;">🏥 Daily Health Check Report</h1>
      <p style="margin: 10px 0 0 0; opacity: 0.9;">${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
    </div>
    
    <!-- Overall Status -->
    <div style="padding: 30px;">
      <div style="background-color: ${statusColor}15; border-left: 4px solid ${statusColor}; padding: 20px; border-radius: 5px; margin-bottom: 30px;">
        <h2 style="margin: 0; color: ${statusColor}; font-size: 24px;">${overallStatus}</h2>
        <p style="margin: 10px 0 0 0; color: #4b5563;">
          ${data.healthyCount} of ${data.totalBots} bots are healthy
        </p>
      </div>
      
      <!-- Summary Cards -->
      <div style="display: flex; gap: 15px; margin-bottom: 30px; flex-wrap: wrap;">
        <div style="flex: 1; min-width: 120px; background-color: #f9fafb; padding: 20px; border-radius: 8px; text-align: center;">
          <div style="color: #6b7280; font-size: 14px;">Total Bots</div>
          <div style="font-size: 32px; font-weight: bold; color: #111827;">${data.totalBots}</div>
        </div>
        <div style="flex: 1; min-width: 120px; background-color: #f0fdf4; padding: 20px; border-radius: 8px; text-align: center;">
          <div style="color: #6b7280; font-size: 14px;">Healthy</div>
          <div style="font-size: 32px; font-weight: bold; color: #10b981;">${data.healthyCount}</div>
        </div>
        <div style="flex: 1; min-width: 120px; background-color: ${data.issueCount > 0 ? '#fef2f2' : '#f9fafb'}; padding: 20px; border-radius: 8px; text-align: center;">
          <div style="color: #6b7280; font-size: 14px;">Issues</div>
          <div style="font-size: 32px; font-weight: bold; color: ${data.issueCount > 0 ? '#ef4444' : '#111827'};">${data.issueCount}</div>
        </div>
        <div style="flex: 1; min-width: 120px; background-color: #f9fafb; padding: 20px; border-radius: 8px; text-align: center;">
          <div style="color: #6b7280; font-size: 14px;">Total Orders</div>
          <div style="font-size: 32px; font-weight: bold; color: #111827;">${data.bots.reduce((sum, b) => sum + b.ordersOnExchange, 0)}</div>
        </div>
      </div>
      
      <!-- Bot Details Table -->
      <h3 style="color: #1f2937; margin-bottom: 15px;">Bot Details</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <thead>
          <tr style="background-color: #f9fafb;">
            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #e5e7eb;">Bot</th>
            <th style="padding: 12px; text-align: center; border-bottom: 2px solid #e5e7eb;">Status</th>
            <th style="padding: 12px; text-align: center; border-bottom: 2px solid #e5e7eb;">Process</th>
            <th style="padding: 12px; text-align: right; border-bottom: 2px solid #e5e7eb;">Price</th>
            <th style="padding: 12px; text-align: center; border-bottom: 2px solid #e5e7eb;">Orders</th>
            <th style="padding: 12px; text-align: center; border-bottom: 2px solid #e5e7eb;">Trades</th>
            <th style="padding: 12px; text-align: center; border-bottom: 2px solid #e5e7eb;">Health</th>
          </tr>
        </thead>
        <tbody>
          ${botRows}
        </tbody>
      </table>
      
      <p style="margin-top: 30px; color: #6b7280; font-size: 14px; text-align: center;">
        ℹ️ This is an automated daily health check. Run <code>node health-check.mjs</code> on VPS for detailed output.
      </p>
    </div>
    
    <!-- Footer -->
    <div style="text-align: center; padding: 20px; color: #6b7280; font-size: 14px; border-top: 1px solid #e5e7eb;">
      <p>Grid Trading Bot v5.0.4</p>
      <p>Report generated at ${new Date().toISOString()}</p>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Send email
 */
async function sendEmail(data) {
  if (!GMAIL_APP_PASSWORD) {
    console.error('❌ GMAIL_APP_PASSWORD not set in .env.production');
    console.log('Add these to your .env.production file:');
    console.log('  GMAIL_USER=your-gmail@gmail.com');
    console.log('  GMAIL_APP_PASSWORD=your-app-password');
    return false;
  }
  
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: SENDER_EMAIL,
      pass: GMAIL_APP_PASSWORD
    }
  });
  
  const statusEmoji = data.issueCount === 0 ? '✅' : '⚠️';
  const subject = `${statusEmoji} Grid Bot Health: ${data.healthyCount}/${data.totalBots} Healthy - ${new Date().toLocaleDateString()}`;
  
  const mailOptions = {
    from: `"Grid Trading Bot" <${SENDER_EMAIL}>`,
    to: RECIPIENT_EMAIL,
    subject: subject,
    html: generateEmailHTML(data)
  };
  
  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Health check email sent: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to send email:`, error.message);
    return false;
  }
}

/**
 * Main function
 */
async function main() {
  console.log('════════════════════════════════════════════════════════════');
  console.log('       GRID TRADING BOT - HEALTH CHECK EMAIL');
  console.log('════════════════════════════════════════════════════════════');
  console.log(`Time: ${new Date().toISOString()}\n`);
  
  console.log('🔍 Running health check...');
  const data = await runHealthCheck();
  
  console.log(`\n📊 Results:`);
  console.log(`   Total Bots: ${data.totalBots}`);
  console.log(`   Healthy: ${data.healthyCount}`);
  console.log(`   Issues: ${data.issueCount}`);
  
  console.log('\n📧 Sending email report...');
  await sendEmail(data);
  
  console.log('\n════════════════════════════════════════════════════════════\n');
}

main().catch(error => {
  console.error('❌ Health check email failed:', error.message);
  process.exit(1);
});
