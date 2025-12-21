#!/usr/bin/env node

/**
 * Grid Trading Bot - Health Check API
 * Version: 1.0.0
 * 
 * Simple HTTP endpoint that returns bot health status as JSON.
 * Used by Manus scheduled tasks to monitor bots remotely.
 * 
 * Usage:
 *   node health-api.mjs              # Start server on port 3001
 *   node health-api.mjs --port 8080  # Start on custom port
 * 
 * Endpoints:
 *   GET /health     - Full health check (JSON)
 *   GET /ping       - Simple ping (for uptime checks)
 */

import http from 'http';
import ccxt from 'ccxt';
import dotenv from 'dotenv';
import { execSync } from 'child_process';
import { existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDatabase, closeDatabase } from './database.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment
dotenv.config({ path: join(__dirname, '.env.production') });

// Configuration
const PORT = parseInt(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || '3001');
const STALE_THRESHOLD_MINUTES = 10;

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
    return { fresh: false, ageMinutes: -1, reason: 'Log file not found' };
  }
  
  const stats = statSync(logPath);
  const ageMinutes = (Date.now() - stats.mtimeMs) / (1000 * 60);
  
  return {
    fresh: ageMinutes < STALE_THRESHOLD_MINUTES,
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

// Get full health status
async function getHealthStatus() {
  const db = getDatabase();
  const bots = db.getAllBots();
  const issues = [];
  const botStatuses = [];
  
  let totalPnL = 0;
  let total24hPnL = 0;
  
  for (const bot of bots) {
    const process = checkProcess(bot.name);
    const logStatus = checkLogFreshness(bot.name);
    const metrics = db.getMetrics(bot.name);
    const orders = db.getActiveOrders(bot.name);
    const pnl24h = calculate24hPnL(db, bot.name);
    
    totalPnL += metrics?.total_pnl || 0;
    total24hPnL += pnl24h.pnl;
    
    const botStatus = {
      name: bot.name,
      symbol: bot.symbol,
      processRunning: process.running,
      pid: process.pid || null,
      logFresh: logStatus.fresh,
      logAgeMinutes: logStatus.ageMinutes,
      orders: orders.length,
      totalTrades: metrics?.total_trades || 0,
      winRate: metrics?.win_rate || 0,
      totalPnL: Math.round((metrics?.total_pnl || 0) * 100) / 100,
      pnl24h: pnl24h.pnl,
      trades24h: pnl24h.trades,
      cycles24h: pnl24h.cycles,
      healthy: process.running && logStatus.fresh
    };
    
    botStatuses.push(botStatus);
    
    // Collect issues
    if (!process.running) {
      issues.push({ type: 'CRITICAL', bot: bot.name, message: 'Process not running' });
    }
    if (!logStatus.fresh && process.running) {
      issues.push({ type: 'WARNING', bot: bot.name, message: `Log stale (${logStatus.ageMinutes}m)` });
    }
  }
  
  // Equity info
  const latestEquity = db.getLatestEquitySnapshot();
  const equity24hAgo = db.getEquitySnapshot24hAgo();
  
  let equityChange = null;
  let equityChangePct = null;
  
  if (latestEquity && equity24hAgo) {
    equityChange = Math.round((latestEquity.total_equity_usd - equity24hAgo.total_equity_usd) * 100) / 100;
    equityChangePct = Math.round((equityChange / equity24hAgo.total_equity_usd) * 10000) / 100;
    
    // Check for drawdown
    if (equityChangePct < -5) {
      issues.push({ type: 'CRITICAL', bot: 'PORTFOLIO', message: `Equity down ${equityChangePct}%` });
    }
  }
  
  closeDatabase();
  
  return {
    timestamp: new Date().toISOString(),
    healthy: issues.filter(i => i.type === 'CRITICAL').length === 0,
    issueCount: issues.length,
    criticalCount: issues.filter(i => i.type === 'CRITICAL').length,
    issues,
    bots: botStatuses,
    summary: {
      totalPnL: Math.round(totalPnL * 100) / 100,
      pnl24h: Math.round(total24hPnL * 100) / 100,
      currentEquity: latestEquity ? Math.round(latestEquity.total_equity_usd * 100) / 100 : null,
      equityChange24h: equityChange,
      equityChangePct24h: equityChangePct
    }
  };
}

// Create HTTP server
const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  
  if (req.url === '/ping') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    return;
  }
  
  if (req.url === '/health' || req.url === '/') {
    try {
      const health = await getHealthStatus();
      res.writeHead(200);
      res.end(JSON.stringify(health, null, 2));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Health API running on http://0.0.0.0:${PORT}`);
  console.log(`   Endpoints:`);
  console.log(`   - GET /health  (full status)`);
  console.log(`   - GET /ping    (uptime check)`);
});
