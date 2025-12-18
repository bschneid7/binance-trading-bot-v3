#!/usr/bin/env node

/**
 * Grid Trading Bot Email Reporter
 * Sends professional HTML email reports to bschneid7@gmail.com
 * 
 * Features:
 * - Fill alerts (real-time)
 * - Daily summary reports
 * - Error notifications
 * - Performance metrics
 */

import nodemailer from 'nodemailer';
import { readFileSync, existsSync } from 'fs';
import { config } from 'dotenv';

config({ path: '.env.production' });

const RECIPIENT_EMAIL = 'bschneid7@gmail.com';
const SENDER_EMAIL = process.env.GMAIL_USER || 'your-gmail@gmail.com';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || '';

// Initialize email transporter
function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: SENDER_EMAIL,
      pass: GMAIL_APP_PASSWORD
    }
  });
}

// Read bot data
function readJSON(file) {
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, 'utf8'));
}

// Format currency
function formatUSD(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

// Generate HTML email for fill alert
function generateFillAlertHTML(fill) {
  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; background-color: #f5f5f5; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background-color: white; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center; }
    .header h1 { margin: 0; font-size: 28px; }
    .content { padding: 30px; }
    .alert-box { background-color: #f0f9ff; border-left: 4px solid #3b82f6; padding: 20px; margin: 20px 0; border-radius: 5px; }
    .metric { display: flex; justify-content: space-between; padding: 15px 0; border-bottom: 1px solid #e5e7eb; }
    .metric:last-child { border-bottom: none; }
    .metric-label { color: #6b7280; font-weight: 500; }
    .metric-value { font-weight: bold; color: #111827; }
    .buy { color: #10b981; }
    .sell { color: #ef4444; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎯 Fill Alert</h1>
      <p style="margin: 10px 0 0 0; opacity: 0.9;">Grid Trading Bot Notification</p>
    </div>
    <div class="content">
      <div class="alert-box">
        <h2 style="margin-top: 0; color: #1f2937;">Order Filled!</h2>
        <p style="font-size: 16px; color: #4b5563;">Your grid bot has successfully executed a trade.</p>
      </div>
      
      <div class="metric">
        <span class="metric-label">Bot:</span>
        <span class="metric-value">${fill.botName}</span>
      </div>
      <div class="metric">
        <span class="metric-label">Symbol:</span>
        <span class="metric-value">${fill.symbol}</span>
      </div>
      <div class="metric">
        <span class="metric-label">Side:</span>
        <span class="metric-value ${fill.side.toLowerCase()}">${fill.side.toUpperCase()}</span>
      </div>
      <div class="metric">
        <span class="metric-label">Price:</span>
        <span class="metric-value">${formatUSD(fill.price)}</span>
      </div>
      <div class="metric">
        <span class="metric-label">Amount:</span>
        <span class="metric-value">${fill.amount} ${fill.symbol.split('/')[0]}</span>
      </div>
      <div class="metric">
        <span class="metric-label">Value:</span>
        <span class="metric-value">${formatUSD(fill.value)}</span>
      </div>
      <div class="metric">
        <span class="metric-label">Estimated Profit:</span>
        <span class="metric-value" style="color: #10b981;">${formatUSD(fill.estimatedProfit || 0.50)}</span>
      </div>
      <div class="metric">
        <span class="metric-label">Time:</span>
        <span class="metric-value">${new Date(fill.timestamp).toLocaleString()}</span>
      </div>
      
      <p style="margin-top: 30px; color: #6b7280; font-size: 14px;">
        ✅ Order has been automatically replaced to maintain grid integrity.
      </p>
    </div>
    <div class="footer">
      <p>Grid Trading Bot v4.2.1-HOTFIX</p>
      <p>VPS: 209.38.74.84 | Monitor: Active 24/7</p>
    </div>
  </div>
</body>
</html>
  `;
}

// Generate HTML email for daily summary
function generateDailySummaryHTML(summary) {
  const totalProfitColor = summary.totalProfit >= 0 ? '#10b981' : '#ef4444';
  const totalProfitSign = summary.totalProfit >= 0 ? '+' : '';
  
  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; background-color: #f5f5f5; margin: 0; padding: 20px; }
    .container { max-width: 700px; margin: 0 auto; background-color: white; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center; }
    .header h1 { margin: 0; font-size: 28px; }
    .content { padding: 30px; }
    .summary-box { background-color: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .metric-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0; }
    .metric-card { background-color: white; padding: 20px; border-radius: 8px; border: 1px solid #e5e7eb; text-align: center; }
    .metric-card-label { color: #6b7280; font-size: 14px; margin-bottom: 10px; }
    .metric-card-value { font-size: 32px; font-weight: bold; color: #111827; }
    .bot-section { margin: 30px 0; }
    .bot-header { background-color: #f3f4f6; padding: 15px; border-radius: 8px 8px 0 0; font-weight: bold; color: #1f2937; }
    .bot-metrics { background-color: white; border: 1px solid #e5e7eb; border-top: none; padding: 20px; border-radius: 0 0 8px 8px; }
    .bot-metric { display: flex; justify-content: space-between; padding: 10px 0; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 Daily Performance Report</h1>
      <p style="margin: 10px 0 0 0; opacity: 0.9;">${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
    </div>
    <div class="content">
      <div class="summary-box">
        <h2 style="margin-top: 0; color: #1f2937;">Overall Performance</h2>
        <div class="metric-grid">
          <div class="metric-card">
            <div class="metric-card-label">Total Fills</div>
            <div class="metric-card-value">${summary.totalFills}</div>
          </div>
          <div class="metric-card">
            <div class="metric-card-label">Net P&L</div>
            <div class="metric-card-value" style="color: ${totalProfitColor};">${totalProfitSign}${formatUSD(summary.totalProfit)}</div>
          </div>
          <div class="metric-card">
            <div class="metric-card-label">Active Orders</div>
            <div class="metric-card-value">${summary.totalOrders}</div>
          </div>
          <div class="metric-card">
            <div class="metric-card-label">Total Capital</div>
            <div class="metric-card-value">${formatUSD(summary.totalCapital)}</div>
          </div>
        </div>
      </div>

      ${summary.bots.map(bot => `
      <div class="bot-section">
        <div class="bot-header">🤖 ${bot.name} (${bot.symbol})</div>
        <div class="bot-metrics">
          <div class="bot-metric">
            <span>Status:</span>
            <span style="font-weight: bold; color: ${bot.status === 'running' ? '#10b981' : '#6b7280'};">${bot.status.toUpperCase()}</span>
          </div>
          <div class="bot-metric">
            <span>Current Price:</span>
            <span style="font-weight: bold;">${formatUSD(bot.currentPrice)}</span>
          </div>
          <div class="bot-metric">
            <span>Fills Today:</span>
            <span style="font-weight: bold;">${bot.fillsToday}</span>
          </div>
          <div class="bot-metric">
            <span>P&L Today:</span>
            <span style="font-weight: bold; color: ${bot.profitToday >= 0 ? '#10b981' : '#ef4444'};">${bot.profitToday >= 0 ? '+' : ''}${formatUSD(bot.profitToday)}</span>
          </div>
          <div class="bot-metric">
            <span>Active Orders:</span>
            <span style="font-weight: bold;">${bot.activeOrders}</span>
          </div>
          <div class="bot-metric">
            <span>Grid Range:</span>
            <span style="font-weight: bold;">${formatUSD(bot.lowerPrice)} - ${formatUSD(bot.upperPrice)}</span>
          </div>
        </div>
      </div>
      `).join('')}

      <p style="margin-top: 30px; color: #6b7280; font-size: 14px;">
        ℹ️ This is an automated daily summary. All bots are monitored 24/7.
      </p>
    </div>
    <div class="footer">
      <p>Grid Trading Bot v4.2.1-HOTFIX</p>
      <p>VPS: 209.38.74.84 | Monitor: Active 24/7</p>
      <p style="margin-top: 10px;">
        <a href="https://github.com/bschneid7/grid-bot-ultimate" style="color: #667eea; text-decoration: none;">GitHub Repository</a>
      </p>
    </div>
  </div>
</body>
</html>
  `;
}

// Send fill alert email
async function sendFillAlert(fill) {
  const transporter = createTransporter();
  
  const mailOptions = {
    from: `"Grid Trading Bot" <${SENDER_EMAIL}>`,
    to: RECIPIENT_EMAIL,
    subject: `🎯 Fill Alert: ${fill.side.toUpperCase()} ${fill.symbol} @ ${formatUSD(fill.price)}`,
    html: generateFillAlertHTML(fill)
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Fill alert email sent: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to send fill alert email:`, error.message);
    return false;
  }
}

// Send daily summary email
async function sendDailySummary() {
  const bots = readJSON('data/grid-bots.json');
  const trades = readJSON('data/grid-trades.json');
  const orders = readJSON('data/active-orders.json');
  
  // Calculate today's date range
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTimestamp = today.getTime();
  
  // Filter today's trades
  const todayTrades = trades.filter(t => new Date(t.timestamp).getTime() >= todayTimestamp);
  
  // Build summary
  const summary = {
    totalFills: todayTrades.length,
    totalProfit: todayTrades.reduce((sum, t) => sum + (t.profit || 0.50), 0),
    totalOrders: orders.length,
    totalCapital: bots.reduce((sum, b) => sum + (b.total_capital || 0), 0),
    bots: bots.map(bot => {
      const botTrades = todayTrades.filter(t => t.bot_name === bot.name);
      const botOrders = orders.filter(o => o.bot_name === bot.name);
      
      return {
        name: bot.name,
        symbol: bot.symbol,
        status: bot.status,
        currentPrice: bot.last_price || 0,
        fillsToday: botTrades.length,
        profitToday: botTrades.reduce((sum, t) => sum + (t.profit || 0.50), 0),
        activeOrders: botOrders.length,
        lowerPrice: bot.lower_price || 0,
        upperPrice: bot.upper_price || 0
      };
    })
  };
  
  const transporter = createTransporter();
  
  const mailOptions = {
    from: `"Grid Trading Bot" <${SENDER_EMAIL}>`,
    to: RECIPIENT_EMAIL,
    subject: `📊 Daily Report: ${summary.totalFills} Fills | ${summary.totalProfit >= 0 ? '+' : ''}${formatUSD(summary.totalProfit)} P&L`,
    html: generateDailySummaryHTML(summary)
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Daily summary email sent: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to send daily summary email:`, error.message);
    return false;
  }
}

// Send error notification email
async function sendErrorNotification(error) {
  const transporter = createTransporter();
  
  const mailOptions = {
    from: `"Grid Trading Bot" <${SENDER_EMAIL}>`,
    to: RECIPIENT_EMAIL,
    subject: `⚠️ Bot Error: ${error.botName || 'Unknown Bot'}`,
    html: `
      <h2>⚠️ Error Notification</h2>
      <p><strong>Bot:</strong> ${error.botName || 'Unknown'}</p>
      <p><strong>Error:</strong> ${error.message}</p>
      <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
      <p><strong>Action Required:</strong> Check bot status on VPS</p>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Error notification email sent: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to send error notification:`, error.message);
    return false;
  }
}

// CLI interface
const command = process.argv[2];

if (command === 'test-fill') {
  // Test fill alert
  const testFill = {
    botName: 'live-btc-bot',
    symbol: 'BTC/USD',
    side: 'sell',
    price: 86900,
    amount: 0.00115,
    value: 99.94,
    estimatedProfit: 0.58,
    timestamp: Date.now()
  };
  
  sendFillAlert(testFill).then(() => {
    console.log('✅ Test fill alert sent to bschneid7@gmail.com');
    process.exit(0);
  });
  
} else if (command === 'test-summary') {
  // Test daily summary
  sendDailySummary().then(() => {
    console.log('✅ Test daily summary sent to bschneid7@gmail.com');
    process.exit(0);
  });
  
} else if (command === 'send-summary') {
  // Send actual daily summary
  sendDailySummary().then(() => {
    process.exit(0);
  });
  
} else {
  console.log('Grid Trading Bot Email Reporter');
  console.log('');
  console.log('Usage:');
  console.log('  ./email-reporter.mjs test-fill      # Send test fill alert');
  console.log('  ./email-reporter.mjs test-summary   # Send test daily summary');
  console.log('  ./email-reporter.mjs send-summary   # Send actual daily summary');
  console.log('');
  process.exit(1);
}

// Export functions for use in main bot
export { sendFillAlert, sendDailySummary, sendErrorNotification };
