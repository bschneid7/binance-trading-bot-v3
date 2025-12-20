#!/usr/bin/env node

/**
 * Telegram Notifier
 * 
 * Sends real-time notifications to Telegram for:
 * - Trade executions (fills)
 * - Stop-loss triggers
 * - Trailing stop activations
 * - Daily summaries
 * - Critical errors
 * 
 * Setup:
 * 1. Create a bot via @BotFather on Telegram
 * 2. Get your chat ID via @userinfobot
 * 3. Add to .env.production:
 *    TELEGRAM_BOT_TOKEN=your_bot_token
 *    TELEGRAM_CHAT_ID=your_chat_id
 */

import dotenv from 'dotenv';
import https from 'https';
import { getDatabase } from './database.mjs';

dotenv.config({ path: '.env.production' });

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Rate limiting
const MESSAGE_QUEUE = [];
let isProcessingQueue = false;
const MIN_MESSAGE_INTERVAL = 1000; // 1 second between messages

/**
 * Send a message via Telegram Bot API
 */
async function sendTelegramMessage(text, options = {}) {
  return new Promise((resolve, reject) => {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      // Silently skip if not configured
      return resolve({ ok: false, reason: 'Not configured' });
    }

    const { parseMode = 'HTML', disableNotification = false } = options;

    const data = JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: parseMode,
      disable_notification: disableNotification,
    });

    const requestOptions = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = https.request(requestOptions, (res) => {
      let responseData = '';
      res.on('data', (chunk) => responseData += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(responseData);
          resolve(result);
        } catch (e) {
          reject(new Error('Invalid response from Telegram'));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * Queue a message for rate-limited sending
 */
function queueMessage(text, options = {}) {
  MESSAGE_QUEUE.push({ text, options });
  processQueue();
}

/**
 * Process the message queue with rate limiting
 */
async function processQueue() {
  if (isProcessingQueue || MESSAGE_QUEUE.length === 0) return;
  
  isProcessingQueue = true;
  
  while (MESSAGE_QUEUE.length > 0) {
    const { text, options } = MESSAGE_QUEUE.shift();
    try {
      await sendTelegramMessage(text, options);
    } catch (e) {
      console.error('Telegram send error:', e.message);
    }
    await new Promise(r => setTimeout(r, MIN_MESSAGE_INTERVAL));
  }
  
  isProcessingQueue = false;
}

/**
 * Format currency for display
 */
function formatCurrency(value, decimals = 2) {
  return `$${value.toFixed(decimals)}`;
}

/**
 * Format percentage for display
 */
function formatPercent(value) {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(2)}%`;
}

// ============================================
// Notification Types
// ============================================

/**
 * Notify about a trade fill
 */
function notifyTradeFill(botName, trade) {
  const emoji = trade.side === 'buy' ? '🟢' : '🔴';
  const action = trade.side === 'buy' ? 'BOUGHT' : 'SOLD';
  
  const message = `
${emoji} <b>Trade Executed</b>

<b>Bot:</b> ${botName}
<b>Action:</b> ${action}
<b>Symbol:</b> ${trade.symbol}
<b>Price:</b> ${formatCurrency(trade.price)}
<b>Amount:</b> ${trade.amount}
<b>Value:</b> ${formatCurrency(trade.value)}
<b>Time:</b> ${new Date().toISOString()}
`.trim();

  queueMessage(message);
}

/**
 * Notify about order replacement
 */
function notifyOrderReplacement(botName, filledOrder, newOrder) {
  const message = `
🔄 <b>Order Replaced</b>

<b>Bot:</b> ${botName}
<b>Filled:</b> ${filledOrder.side.toUpperCase()} @ ${formatCurrency(filledOrder.price)}
<b>New:</b> ${newOrder.side.toUpperCase()} @ ${formatCurrency(newOrder.price)}
`.trim();

  queueMessage(message, { disableNotification: true });
}

/**
 * Notify about stop-loss trigger
 */
function notifyStopLoss(botName, reason, currentPrice, stopPrice) {
  const message = `
🚨 <b>STOP-LOSS TRIGGERED</b>

<b>Bot:</b> ${botName}
<b>Reason:</b> ${reason}
<b>Current Price:</b> ${formatCurrency(currentPrice)}
<b>Stop Price:</b> ${formatCurrency(stopPrice)}
<b>Time:</b> ${new Date().toISOString()}

⚠️ Bot has been stopped. Manual intervention required.
`.trim();

  queueMessage(message);
}

/**
 * Notify about trailing stop activation
 */
function notifyTrailingStopActivated(botName, entryPrice, currentPrice, profitPercent) {
  const message = `
📈 <b>Trailing Stop Activated</b>

<b>Bot:</b> ${botName}
<b>Entry:</b> ${formatCurrency(entryPrice)}
<b>Current:</b> ${formatCurrency(currentPrice)}
<b>Profit:</b> ${formatPercent(profitPercent)}

Trailing stop is now protecting your gains.
`.trim();

  queueMessage(message);
}

/**
 * Notify about trailing stop trigger
 */
function notifyTrailingStopTriggered(botName, entryPrice, exitPrice, profit) {
  const message = `
🎯 <b>TRAILING STOP TRIGGERED</b>

<b>Bot:</b> ${botName}
<b>Entry:</b> ${formatCurrency(entryPrice)}
<b>Exit:</b> ${formatCurrency(exitPrice)}
<b>Profit Locked:</b> ${formatCurrency(profit)}

✅ Position closed with profit protected.
`.trim();

  queueMessage(message);
}

/**
 * Notify about critical error
 */
function notifyCriticalError(botName, error, context = '') {
  const message = `
❌ <b>CRITICAL ERROR</b>

<b>Bot:</b> ${botName}
<b>Error:</b> ${error}
<b>Context:</b> ${context || 'N/A'}
<b>Time:</b> ${new Date().toISOString()}

⚠️ Immediate attention required.
`.trim();

  queueMessage(message);
}

/**
 * Send daily summary
 */
async function sendDailySummary() {
  const db = getDatabase();
  const bots = db.getAllBots();
  
  let totalPnL = 0;
  let totalTrades = 0;
  let botSummaries = [];
  
  for (const bot of bots) {
    const trades = db.getBotTrades(bot.name, 100);
    const todayTrades = trades.filter(t => {
      const tradeDate = new Date(t.created_at);
      const today = new Date();
      return tradeDate.toDateString() === today.toDateString();
    });
    
    const metrics = db.getMetrics(bot.name);
    const pnl = metrics?.total_pnl || 0;
    
    totalPnL += pnl;
    totalTrades += todayTrades.length;
    
    const statusEmoji = bot.status === 'running' ? '🟢' : '🔴';
    botSummaries.push(`${statusEmoji} <b>${bot.name}</b>: ${todayTrades.length} trades, P&L: ${formatCurrency(pnl)}`);
  }
  
  const overallEmoji = totalPnL >= 0 ? '📈' : '📉';
  
  const message = `
${overallEmoji} <b>Daily Trading Summary</b>

<b>Date:</b> ${new Date().toLocaleDateString()}
<b>Total Trades:</b> ${totalTrades}
<b>Total P&L:</b> ${formatCurrency(totalPnL)}

<b>Bot Status:</b>
${botSummaries.join('\n')}

<i>Generated by Grid Trading Bot</i>
`.trim();

  await sendTelegramMessage(message);
}

/**
 * Send bot startup notification
 */
function notifyBotStarted(botName, symbol, gridCount, range) {
  const message = `
🚀 <b>Bot Started</b>

<b>Bot:</b> ${botName}
<b>Symbol:</b> ${symbol}
<b>Grid Levels:</b> ${gridCount}
<b>Range:</b> ${formatCurrency(range.lower)} - ${formatCurrency(range.upper)}
<b>Time:</b> ${new Date().toISOString()}
`.trim();

  queueMessage(message);
}

/**
 * Send bot stopped notification
 */
function notifyBotStopped(botName, reason = 'Manual stop') {
  const message = `
🛑 <b>Bot Stopped</b>

<b>Bot:</b> ${botName}
<b>Reason:</b> ${reason}
<b>Time:</b> ${new Date().toISOString()}
`.trim();

  queueMessage(message);
}

/**
 * Send price alert
 */
function notifyPriceAlert(symbol, currentPrice, alertType, threshold) {
  const emoji = alertType === 'above' ? '⬆️' : '⬇️';
  
  const message = `
${emoji} <b>Price Alert</b>

<b>Symbol:</b> ${symbol}
<b>Current Price:</b> ${formatCurrency(currentPrice)}
<b>Alert:</b> Price ${alertType} ${formatCurrency(threshold)}
`.trim();

  queueMessage(message);
}

/**
 * Test the Telegram connection
 */
async function testConnection() {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('❌ Telegram not configured');
    console.log('   Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to .env.production');
    return false;
  }
  
  try {
    const result = await sendTelegramMessage('🤖 Grid Trading Bot connected successfully!');
    if (result.ok) {
      console.log('✅ Telegram connection successful');
      return true;
    } else {
      console.log('❌ Telegram error:', result.description);
      return false;
    }
  } catch (e) {
    console.log('❌ Telegram connection failed:', e.message);
    return false;
  }
}

// CLI
const args = process.argv.slice(2);
const command = args[0];

if (command === 'test') {
  testConnection();
} else if (command === 'summary') {
  sendDailySummary();
} else if (command === 'send') {
  const message = args.slice(1).join(' ');
  if (message) {
    sendTelegramMessage(message).then(r => {
      console.log(r.ok ? '✅ Message sent' : '❌ Failed: ' + r.description);
    });
  } else {
    console.log('Usage: node telegram-notifier.mjs send <message>');
  }
} else {
  console.log(`
Telegram Notifier - Send notifications to Telegram

Usage:
  node telegram-notifier.mjs test              Test Telegram connection
  node telegram-notifier.mjs summary           Send daily summary
  node telegram-notifier.mjs send <message>    Send custom message

Setup:
  1. Create a bot via @BotFather on Telegram
  2. Get your chat ID via @userinfobot
  3. Add to .env.production:
     TELEGRAM_BOT_TOKEN=your_bot_token
     TELEGRAM_CHAT_ID=your_chat_id
`);
}

export {
  sendTelegramMessage,
  queueMessage,
  notifyTradeFill,
  notifyOrderReplacement,
  notifyStopLoss,
  notifyTrailingStopActivated,
  notifyTrailingStopTriggered,
  notifyCriticalError,
  sendDailySummary,
  notifyBotStarted,
  notifyBotStopped,
  notifyPriceAlert,
  testConnection,
};
