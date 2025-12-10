#!/usr/bin/env node

/**
 * Grid Trading Bot - Simple Dashboard Server
 * Standalone Express server for bot management
 */

import express from 'express';
import ccxt from 'ccxt';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '.env.production') });

const app = express();
const PORT = process.env.DASHBOARD_PORT || 3001;

// Middleware
app.use(express.json());
app.use(express.static(join(__dirname, 'dashboard-public')));

// Data files
const DB_DIR = join(__dirname, 'data');
const BOTS_FILE = join(DB_DIR, 'grid-bots.json');
const TRADES_FILE = join(DB_DIR, 'grid-trades.json');

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// Load or initialize data
function loadData(file, defaultValue = []) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(defaultValue, null, 2));
    return defaultValue;
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`Error loading ${file}:`, error.message);
    return defaultValue;
  }
}

function saveData(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Initialize Binance.US client
let exchange;
try {
  exchange = new ccxt.binanceus({
    apiKey: process.env.BINANCE_API_KEY,
    secret: process.env.BINANCE_API_SECRET,
    enableRateLimit: true,
    options: {
      defaultType: 'spot',
      adjustForTimeDifference: true
    }
  });
} catch (error) {
  console.error('Failed to initialize Binance.US client:', error.message);
}

const TEST_MODE = process.env.BINANCE_TEST_MODE === 'true';

// Helper functions
function calculateGridLevels(lowerPrice, upperPrice, gridCount) {
  const gridSpacing = (upperPrice - lowerPrice) / (gridCount - 1);
  const levels = [];
  
  for (let i = 0; i < gridCount; i++) {
    const price = lowerPrice + (i * gridSpacing);
    levels.push({
      price: parseFloat(price.toFixed(2)),
      type: i < gridCount / 2 ? 'BUY' : 'SELL',
      status: 'PENDING'
    });
  }
  
  return levels;
}

// API Routes

// Get system status
app.get('/api/status', async (req, res) => {
  try {
    const status = {
      mode: TEST_MODE ? 'paper' : 'live',
      exchange: 'Binance.US',
      connected: false,
      balance: null,
      error: null
    };

    try {
      const balance = await exchange.fetchBalance();
      status.connected = true;
      status.balance = {
        usd: balance.free?.USD || 0,
        btc: balance.free?.BTC || 0,
        total: balance.total?.USD || 0
      };
    } catch (error) {
      status.error = error.message;
    }

    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all bots
app.get('/api/bots', (req, res) => {
  try {
    const bots = loadData(BOTS_FILE);
    const trades = loadData(TRADES_FILE);
    
    // Add trade stats to each bot
    const botsWithStats = bots.map(bot => {
      const botTrades = trades.filter(t => t.bot_id === bot.id);
      const buyCount = botTrades.filter(t => t.trade_type === 'BUY').length;
      const sellCount = botTrades.filter(t => t.trade_type === 'SELL').length;
      const totalProfit = botTrades.reduce((sum, t) => sum + (t.profit || 0), 0);
      
      return {
        ...bot,
        stats: {
          trade_count: botTrades.length,
          buy_count: buyCount,
          sell_count: sellCount,
          total_profit: totalProfit
        }
      };
    });
    
    res.json(botsWithStats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single bot
app.get('/api/bots/:id', async (req, res) => {
  try {
    const bots = loadData(BOTS_FILE);
    const trades = loadData(TRADES_FILE);
    const bot = bots.find(b => b.id === parseInt(req.params.id));
    
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    // Get current price
    let currentPrice = null;
    try {
      const ticker = await exchange.fetchTicker(bot.symbol);
      currentPrice = ticker.last;
    } catch (error) {
      console.error('Error fetching price:', error.message);
    }

    // Calculate grid levels
    const gridLevels = calculateGridLevels(bot.lower_price, bot.upper_price, bot.grid_count);

    // Get trade stats
    const botTrades = trades.filter(t => t.bot_id === bot.id);
    const buyCount = botTrades.filter(t => t.trade_type === 'BUY').length;
    const sellCount = botTrades.filter(t => t.trade_type === 'SELL').length;
    const totalProfit = botTrades.reduce((sum, t) => sum + (t.profit || 0), 0);
    
    res.json({
      ...bot,
      current_price: currentPrice,
      grid_levels: gridLevels,
      trades: botTrades.slice(0, 20).reverse(), // Last 20 trades
      stats: {
        trade_count: botTrades.length,
        buy_count: buyCount,
        sell_count: sellCount,
        total_profit: totalProfit,
        avg_profit: botTrades.length > 0 ? totalProfit / botTrades.length : 0
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create bot
app.post('/api/bots', async (req, res) => {
  try {
    const { name, symbol, lower_price, upper_price, grid_count, order_size } = req.body;

    // Validation
    if (!name || !lower_price || !upper_price || !grid_count || !order_size) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (lower_price >= upper_price) {
      return res.status(400).json({ error: 'Lower price must be less than upper price' });
    }

    if (grid_count < 2) {
      return res.status(400).json({ error: 'Grid count must be at least 2' });
    }

    const bots = loadData(BOTS_FILE);

    // Check if name exists
    if (bots.find(b => b.name === name)) {
      return res.status(400).json({ error: 'Bot with this name already exists' });
    }

    // Get current price to validate
    let currentPrice = null;
    try {
      const ticker = await exchange.fetchTicker(symbol || 'BTC/USD');
      currentPrice = ticker.last;
    } catch (error) {
      console.error('Error fetching price:', error.message);
    }

    // Create bot
    const bot = {
      id: bots.length > 0 ? Math.max(...bots.map(b => b.id)) + 1 : 1,
      name,
      symbol: symbol || 'BTC/USD',
      lower_price: parseFloat(lower_price),
      upper_price: parseFloat(upper_price),
      grid_count: parseInt(grid_count),
      order_size: parseFloat(order_size),
      status: 'stopped',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    bots.push(bot);
    saveData(BOTS_FILE, bots);

    res.json({
      ...bot,
      current_price: currentPrice,
      warning: currentPrice && (currentPrice < lower_price || currentPrice > upper_price)
        ? 'Current price is outside grid range'
        : null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start bot
app.post('/api/bots/:id/start', (req, res) => {
  try {
    const bots = loadData(BOTS_FILE);
    const bot = bots.find(b => b.id === parseInt(req.params.id));
    
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    if (bot.status === 'running') {
      return res.status(400).json({ error: 'Bot is already running' });
    }

    bot.status = 'running';
    bot.updated_at = new Date().toISOString();
    saveData(BOTS_FILE, bots);

    res.json(bot);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Stop bot
app.post('/api/bots/:id/stop', (req, res) => {
  try {
    const bots = loadData(BOTS_FILE);
    const bot = bots.find(b => b.id === parseInt(req.params.id));
    
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    if (bot.status === 'stopped') {
      return res.status(400).json({ error: 'Bot is already stopped' });
    }

    bot.status = 'stopped';
    bot.updated_at = new Date().toISOString();
    saveData(BOTS_FILE, bots);

    res.json(bot);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete bot
app.delete('/api/bots/:id', (req, res) => {
  try {
    let bots = loadData(BOTS_FILE);
    let trades = loadData(TRADES_FILE);
    
    const botIndex = bots.findIndex(b => b.id === parseInt(req.params.id));
    
    if (botIndex === -1) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    const bot = bots[botIndex];

    if (bot.status === 'running' && !req.query.force) {
      return res.status(400).json({ error: 'Bot is running. Stop it first or use force=true' });
    }

    // Delete trades
    trades = trades.filter(t => t.bot_id !== bot.id);
    saveData(TRADES_FILE, trades);

    // Delete bot
    bots.splice(botIndex, 1);
    saveData(BOTS_FILE, bots);

    res.json({ success: true, message: 'Bot deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get market price
app.get('/api/price/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.replace('-', '/');
    const ticker = await exchange.fetchTicker(symbol);
    
    res.json({
      symbol,
      price: ticker.last,
      change_24h: ticker.percentage,
      high_24h: ticker.high,
      low_24h: ticker.low,
      volume_24h: ticker.quoteVolume
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Grid Trading Bot Dashboard`);
  console.log(`================================`);
  console.log(`Dashboard: http://localhost:${PORT}`);
  console.log(`API: http://localhost:${PORT}/api`);
  console.log(`Mode: ${TEST_MODE ? 'PAPER TRADING ✅' : 'LIVE TRADING ⚠️'}`);
  console.log(`================================\n`);
});
