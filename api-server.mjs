#!/usr/bin/env node

/**
 * Grid Trading Bot - REST API Server
 * 
 * Provides HTTP endpoints for remote monitoring and control:
 * - GET /api/status - Overall system status
 * - GET /api/bots - List all bots
 * - GET /api/bots/:name - Get specific bot details
 * - GET /api/bots/:name/orders - Get bot's active orders
 * - GET /api/bots/:name/trades - Get bot's trade history
 * - POST /api/bots/:name/start - Start a bot
 * - POST /api/bots/:name/stop - Stop a bot
 * - GET /api/health - Health check endpoint
 * - GET /api/portfolio - Portfolio summary
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import ccxt from 'ccxt';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDatabase } from './database.mjs';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: '.env.production' });

const app = express();
const db = getDatabase();
const PORT = process.env.API_PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Initialize exchange (read-only for most operations)
let exchange = null;
function getExchange() {
  if (!exchange) {
    exchange = new ccxt.binanceus({
      apiKey: process.env.BINANCE_API_KEY,
      secret: process.env.BINANCE_API_SECRET,
      enableRateLimit: true,
    });
  }
  return exchange;
}

// Auth middleware (simple API key auth)
const apiKeyAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  const expectedKey = process.env.BOT_API_KEY;
  
  // If no API key is configured, allow all requests (for local use)
  if (!expectedKey) {
    return next();
  }
  
  if (apiKey !== expectedKey) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing API key' });
  }
  
  next();
};

// Apply auth to all /api routes
app.use('/api', apiKeyAuth);

/**
 * GET /api/status - Overall system status
 */
app.get('/api/status', async (req, res) => {
  try {
    const bots = db.getAllBots();
    const runningBots = bots.filter(b => b.status === 'running');
    
    // Check monitor processes
    let processStatus = {};
    for (const bot of runningBots) {
      try {
        const result = execSync(`pgrep -f "monitor --name ${bot.name}"`, { encoding: 'utf8' });
        processStatus[bot.name] = { running: true, pid: result.trim() };
      } catch {
        processStatus[bot.name] = { running: false };
      }
    }
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      bots: {
        total: bots.length,
        running: runningBots.length,
        stopped: bots.length - runningBots.length,
      },
      processes: processStatus,
      version: '5.2.0',
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal error', message: error.message });
  }
});

/**
 * GET /api/health - Health check endpoint
 */
app.get('/api/health', async (req, res) => {
  try {
    const bots = db.getAllBots();
    const issues = [];
    
    for (const bot of bots.filter(b => b.status === 'running')) {
      // Check if monitor is running
      try {
        execSync(`pgrep -f "monitor --name ${bot.name}"`, { encoding: 'utf8' });
      } catch {
        issues.push({ bot: bot.name, issue: 'Monitor process not running' });
      }
    }
    
    const healthy = issues.length === 0;
    
    res.status(healthy ? 200 : 503).json({
      healthy,
      timestamp: new Date().toISOString(),
      issues,
    });
  } catch (error) {
    res.status(500).json({ healthy: false, error: error.message });
  }
});

/**
 * GET /api/bots - List all bots
 */
app.get('/api/bots', (req, res) => {
  try {
    const bots = db.getAllBots();
    
    const botsWithMetrics = bots.map(bot => {
      const orders = db.getActiveOrders(bot.name);
      const metrics = db.getMetrics(bot.name);
      
      return {
        ...bot,
        activeOrders: orders.length,
        buyOrders: orders.filter(o => o.side === 'buy').length,
        sellOrders: orders.filter(o => o.side === 'sell').length,
        metrics: metrics || {},
      };
    });
    
    res.json({ bots: botsWithMetrics });
  } catch (error) {
    res.status(500).json({ error: 'Internal error', message: error.message });
  }
});

/**
 * GET /api/bots/:name - Get specific bot details
 */
app.get('/api/bots/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const bot = db.getBot(name);
    
    if (!bot) {
      return res.status(404).json({ error: 'Not found', message: `Bot "${name}" not found` });
    }
    
    const orders = db.getActiveOrders(name);
    const metrics = db.getMetrics(name);
    const trades = db.getBotTrades(name, 10);
    
    // Get current price
    let currentPrice = null;
    try {
      const ex = getExchange();
      const ticker = await ex.fetchTicker(bot.symbol);
      currentPrice = ticker.last;
    } catch (e) {
      // Ignore price fetch errors
    }
    
    // Check monitor status
    let monitorRunning = false;
    try {
      execSync(`pgrep -f "monitor --name ${name}"`, { encoding: 'utf8' });
      monitorRunning = true;
    } catch {
      // Not running
    }
    
    res.json({
      bot,
      currentPrice,
      monitorRunning,
      orders: {
        total: orders.length,
        buy: orders.filter(o => o.side === 'buy').length,
        sell: orders.filter(o => o.side === 'sell').length,
      },
      metrics: metrics || {},
      recentTrades: trades,
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal error', message: error.message });
  }
});

/**
 * GET /api/bots/:name/orders - Get bot's active orders
 */
app.get('/api/bots/:name/orders', (req, res) => {
  try {
    const { name } = req.params;
    const bot = db.getBot(name);
    
    if (!bot) {
      return res.status(404).json({ error: 'Not found', message: `Bot "${name}" not found` });
    }
    
    const orders = db.getActiveOrders(name);
    
    res.json({
      bot: name,
      symbol: bot.symbol,
      orders: orders.map(o => ({
        id: o.id,
        side: o.side,
        price: o.price,
        amount: o.amount,
        status: o.status,
        createdAt: o.created_at,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal error', message: error.message });
  }
});

/**
 * GET /api/bots/:name/trades - Get bot's trade history
 */
app.get('/api/bots/:name/trades', (req, res) => {
  try {
    const { name } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    
    const bot = db.getBot(name);
    if (!bot) {
      return res.status(404).json({ error: 'Not found', message: `Bot "${name}" not found` });
    }
    
    const trades = db.getBotTrades(name, limit);
    
    res.json({
      bot: name,
      symbol: bot.symbol,
      trades,
      count: trades.length,
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal error', message: error.message });
  }
});

/**
 * POST /api/bots/:name/start - Start a bot
 */
app.post('/api/bots/:name/start', async (req, res) => {
  try {
    const { name } = req.params;
    const bot = db.getBot(name);
    
    if (!bot) {
      return res.status(404).json({ error: 'Not found', message: `Bot "${name}" not found` });
    }
    
    if (bot.status === 'running') {
      return res.status(400).json({ error: 'Bad request', message: 'Bot is already running' });
    }
    
    // Start the bot via systemd if available
    try {
      execSync(`sudo systemctl start grid-bot-${name.replace('live-', '').replace('-bot', '')}.service`, { encoding: 'utf8' });
      db.updateBotStatus(name, 'running');
      
      res.json({
        success: true,
        message: `Bot "${name}" started successfully`,
        status: 'running',
      });
    } catch (e) {
      // Fall back to direct start
      res.status(500).json({
        error: 'Start failed',
        message: 'Could not start bot via systemd. Start manually with: node grid-bot-cli-v5.mjs start --name ' + name,
      });
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal error', message: error.message });
  }
});

/**
 * POST /api/bots/:name/stop - Stop a bot
 */
app.post('/api/bots/:name/stop', async (req, res) => {
  try {
    const { name } = req.params;
    const bot = db.getBot(name);
    
    if (!bot) {
      return res.status(404).json({ error: 'Not found', message: `Bot "${name}" not found` });
    }
    
    if (bot.status === 'stopped') {
      return res.status(400).json({ error: 'Bad request', message: 'Bot is already stopped' });
    }
    
    // Stop the bot via systemd if available
    try {
      execSync(`sudo systemctl stop grid-bot-${name.replace('live-', '').replace('-bot', '')}.service`, { encoding: 'utf8' });
      db.updateBotStatus(name, 'stopped');
      
      res.json({
        success: true,
        message: `Bot "${name}" stopped successfully`,
        status: 'stopped',
      });
    } catch (e) {
      // Fall back to killing process
      try {
        execSync(`pkill -f "monitor --name ${name}"`, { encoding: 'utf8' });
        db.updateBotStatus(name, 'stopped');
        
        res.json({
          success: true,
          message: `Bot "${name}" stopped successfully`,
          status: 'stopped',
        });
      } catch {
        res.status(500).json({
          error: 'Stop failed',
          message: 'Could not stop bot. Stop manually with: node grid-bot-cli-v5.mjs stop --name ' + name,
        });
      }
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal error', message: error.message });
  }
});

/**
 * GET /api/portfolio - Portfolio summary
 */
app.get('/api/portfolio', async (req, res) => {
  try {
    const ex = getExchange();
    const balance = await ex.fetchBalance();
    
    // Get USD balance
    const usdBalance = balance.USD?.free || 0;
    const usdTotal = balance.USD?.total || 0;
    
    // Get crypto holdings
    const holdings = [];
    const symbols = ['BTC', 'ETH', 'SOL'];
    
    for (const symbol of symbols) {
      const holding = balance[symbol];
      if (holding && holding.total > 0) {
        try {
          const ticker = await ex.fetchTicker(`${symbol}/USD`);
          holdings.push({
            symbol,
            amount: holding.total,
            free: holding.free,
            inOrders: holding.used || 0,
            price: ticker.last,
            value: holding.total * ticker.last,
          });
        } catch {
          holdings.push({
            symbol,
            amount: holding.total,
            free: holding.free,
            inOrders: holding.used || 0,
            price: null,
            value: null,
          });
        }
      }
    }
    
    const totalCryptoValue = holdings.reduce((sum, h) => sum + (h.value || 0), 0);
    
    // Get trade stats
    const bots = db.getAllBots();
    let totalTrades = 0;
    let totalPnL = 0;
    
    for (const bot of bots) {
      const trades = db.getBotTrades(bot.name, 1000);
      totalTrades += trades.length;
      
      const metrics = db.getMetrics(bot.name);
      if (metrics) {
        totalPnL += metrics.total_pnl || 0;
      }
    }
    
    res.json({
      timestamp: new Date().toISOString(),
      usdBalance: usdTotal,
      cryptoValue: totalCryptoValue,
      totalValue: usdTotal + totalCryptoValue,
      pnl: totalPnL,
      pnlPercent: totalPnL / (usdTotal + totalCryptoValue) * 100,
      usd: {
        free: usdBalance,
        total: usdTotal,
        inOrders: usdTotal - usdBalance,
      },
      holdings,
      totalCryptoValue,
      totalPortfolioValue: usdTotal + totalCryptoValue,
      stats: {
        totalBots: bots.length,
        runningBots: bots.filter(b => b.status === 'running').length,
        totalTrades,
        totalPnL,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal error', message: error.message });
  }
});

/**
 * GET /api/trades - Get recent trades across all bots
 */
app.get('/api/trades', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const bots = db.getAllBots();
    const allTrades = [];
    
    for (const bot of bots) {
      const trades = db.getBotTrades(bot.name, limit);
      for (const trade of trades) {
        allTrades.push({
          ...trade,
          botName: bot.name,
        });
      }
    }
    
    // Sort by timestamp descending and limit
    allTrades.sort((a, b) => new Date(b.created_at || b.timestamp) - new Date(a.created_at || a.timestamp));
    
    res.json(allTrades.slice(0, limit));
  } catch (error) {
    res.status(500).json({ error: 'Internal error', message: error.message });
  }
});

/**
 * GET /api/prices - Get current prices for all trading pairs
 */
app.get('/api/prices', async (req, res) => {
  try {
    const ex = getExchange();
    const bots = db.getAllBots();
    const symbols = [...new Set(bots.map(b => b.symbol))];
    
    const prices = {};
    for (const symbol of symbols) {
      try {
        const ticker = await ex.fetchTicker(symbol);
        prices[symbol] = {
          last: ticker.last,
          bid: ticker.bid,
          ask: ticker.ask,
          high: ticker.high,
          low: ticker.low,
          change: ticker.percentage,
          volume: ticker.baseVolume,
        };
      } catch {
        prices[symbol] = { error: 'Failed to fetch' };
      }
    }
    
    res.json({
      timestamp: new Date().toISOString(),
      prices,
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal error', message: error.message });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('API Error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║          GRID TRADING BOT - API SERVER                    ║
╠════════════════════════════════════════════════════════════╣
║  Status: Running                                          ║
║  Port: ${PORT}                                               ║
║  Auth: ${process.env.BOT_API_KEY ? 'Enabled (X-Api-Key header required)' : 'Disabled (local use only)'}
╚════════════════════════════════════════════════════════════╝

Endpoints:
  GET  /api/status          - System status
  GET  /api/health          - Health check
  GET  /api/bots            - List all bots
  GET  /api/bots/:name      - Bot details
  GET  /api/bots/:name/orders - Bot's orders
  GET  /api/bots/:name/trades - Bot's trades
  POST /api/bots/:name/start  - Start bot
  POST /api/bots/:name/stop   - Stop bot
  GET  /api/portfolio       - Portfolio summary
  GET  /api/prices          - Current prices
`);
});

export default app;
