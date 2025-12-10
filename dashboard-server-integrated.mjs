#!/usr/bin/env node

// Grid Trading Bot Dashboard - With Binance.US Integration
// Full API integration for real balance display and paper trading

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';
import ccxt from 'ccxt';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_FILE = join(__dirname, 'data', 'grid-bots.json');

// Binance.US configuration
const PAPER_TRADING = process.env.PAPER_TRADING === 'true';
const API_KEY = process.env.BINANCE_API_KEY || '';
const API_SECRET = process.env.BINANCE_API_SECRET || '';

let exchange = null;
let isConnected = false;

// Initialize Binance.US exchange
async function initExchange() {
    try {
        if (!API_KEY || !API_SECRET) {
            console.log('⚠️  API keys not configured');
            return false;
        }

        exchange = new ccxt.binanceus({
            apiKey: API_KEY,
            secret: API_SECRET,
            enableRateLimit: true,
            options: {
                defaultType: 'spot',
                adjustForTimeDifference: true
            }
        });

        // Test connection
        await exchange.fetchBalance();
        isConnected = true;
        console.log('✓ Connected to Binance.US');
        return true;
    } catch (error) {
        console.error('Failed to connect to Binance.US:', error.message);
        isConnected = false;
        return false;
    }
}

// Middleware
app.use(express.json());
app.use(express.static(join(__dirname, 'dashboard-public')));

// Enable CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Initialize data file
async function initData() {
    try {
        await fs.mkdir(join(__dirname, 'data'), { recursive: true });
        try {
            await fs.access(DATA_FILE);
            console.log('✓ Data file exists');
        } catch {
            await fs.writeFile(DATA_FILE, JSON.stringify({ bots: [] }, null, 2));
            console.log('✓ Created new data file');
        }
    } catch (error) {
        console.error('Failed to initialize data:', error);
    }
}

// Read data
async function readData() {
    try {
        const content = await fs.readFile(DATA_FILE, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        console.error('Failed to read data:', error);
        return { bots: [] };
    }
}

// Write data
async function writeData(data) {
    try {
        await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Failed to write data:', error);
        throw error;
    }
}

// Get account balance
async function getBalance() {
    try {
        if (!exchange || !isConnected) {
            return { usd: 0, btc: 0 };
        }

        const balance = await exchange.fetchBalance();
        return {
            usd: balance.free['USD'] || 0,
            btc: balance.free['BTC'] || 0
        };
    } catch (error) {
        console.error('Failed to fetch balance:', error.message);
        return { usd: 0, btc: 0 };
    }
}

// Get current price
async function getCurrentPrice(symbol) {
    try {
        if (!exchange || !isConnected) {
            return null;
        }

        const ticker = await exchange.fetchTicker(symbol);
        return ticker.last;
    } catch (error) {
        console.error(`Failed to fetch price for ${symbol}:`, error.message);
        return null;
    }
}

// Calculate grid levels
function calculateGridLevels(lowerPrice, upperPrice, gridCount) {
    const levels = [];
    const spacing = (upperPrice - lowerPrice) / (gridCount - 1);
    
    for (let i = 0; i < gridCount; i++) {
        const price = lowerPrice + (spacing * i);
        const type = i < gridCount / 2 ? 'BUY' : 'SELL';
        levels.push({
            level: i + 1,
            price: Math.round(price * 100) / 100,
            type: type,
            filled: false
        });
    }
    
    return levels;
}

// Simulate paper trade
async function simulateTrade(bot, type, price, amount) {
    const trade = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        type: type,
        price: price,
        amount: amount,
        total: price * amount,
        fee: (price * amount) * 0.001, // 0.1% fee
        paper: true
    };

    bot.trades = bot.trades || [];
    bot.trades.unshift(trade);

    // Update stats
    bot.stats.trade_count++;
    if (type === 'BUY') {
        bot.stats.buy_count++;
    } else {
        bot.stats.sell_count++;
    }

    // Calculate profit (simplified)
    if (bot.trades.length >= 2) {
        const lastBuy = bot.trades.find(t => t.type === 'BUY');
        const lastSell = bot.trades.find(t => t.type === 'SELL');
        if (lastBuy && lastSell) {
            const profit = (lastSell.price - lastBuy.price) * amount;
            bot.stats.total_profit += profit;
            bot.stats.avg_profit = bot.stats.total_profit / bot.stats.trade_count;
        }
    }

    console.log(`📊 Paper trade: ${type} ${amount} ${bot.symbol} @ $${price}`);
    return trade;
}

// Bot trading loop
async function runBotTradingLoop(botId) {
    const data = await readData();
    const bot = data.bots.find(b => b.id === botId);

    if (!bot || bot.status !== 'running') {
        return;
    }

    try {
        // Get current price
        const currentPrice = await getCurrentPrice(bot.symbol);
        if (!currentPrice) {
            console.log(`⚠️  Could not fetch price for ${bot.symbol}`);
            setTimeout(() => runBotTradingLoop(botId), 30000);
            return;
        }

        bot.current_price = currentPrice;

        // Check grid levels for trading opportunities
        for (const level of bot.grid_levels) {
            if (level.filled) continue;

            // Buy logic: price crosses below buy level
            if (level.type === 'BUY' && currentPrice <= level.price) {
                if (PAPER_TRADING) {
                    await simulateTrade(bot, 'BUY', level.price, bot.order_size);
                    level.filled = true;
                }
            }

            // Sell logic: price crosses above sell level
            if (level.type === 'SELL' && currentPrice >= level.price) {
                if (PAPER_TRADING) {
                    await simulateTrade(bot, 'SELL', level.price, bot.order_size);
                    level.filled = true;
                }
            }
        }

        // Save updated bot data
        await writeData(data);

        // Continue trading loop
        setTimeout(() => runBotTradingLoop(botId), 30000); // Check every 30 seconds

    } catch (error) {
        console.error(`Error in trading loop for bot ${bot.name}:`, error.message);
        setTimeout(() => runBotTradingLoop(botId), 30000);
    }
}

// API Routes

// System status
app.get('/api/status', async (req, res) => {
    try {
        const balance = await getBalance();
        
        res.json({
            mode: PAPER_TRADING ? 'paper' : 'live',
            exchange: 'Binance.US',
            connected: isConnected,
            balance: balance,
            message: isConnected 
                ? 'Connected to Binance.US' 
                : 'Not connected - check API keys in .env file'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// List all bots
app.get('/api/bots', async (req, res) => {
    try {
        const data = await readData();
        res.json(data.bots || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get bot by ID
app.get('/api/bots/:id', async (req, res) => {
    try {
        const data = await readData();
        const bot = data.bots.find(b => b.id === parseInt(req.params.id));
        
        if (!bot) {
            return res.status(404).json({ error: 'Bot not found' });
        }

        // Update current price
        if (bot.status === 'running') {
            const currentPrice = await getCurrentPrice(bot.symbol);
            if (currentPrice) {
                bot.current_price = currentPrice;
            }
        }
        
        res.json(bot);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create new bot
app.post('/api/bots', async (req, res) => {
    try {
        const { name, symbol, lower_price, upper_price, grid_count, order_size } = req.body;
        
        // Validate input
        if (!name || !symbol || !lower_price || !upper_price || !grid_count || !order_size) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        if (lower_price >= upper_price) {
            return res.status(400).json({ error: 'Lower price must be less than upper price' });
        }
        
        if (grid_count < 2) {
            return res.status(400).json({ error: 'Grid count must be at least 2' });
        }
        
        const data = await readData();
        
        // Check for duplicate name
        if (data.bots.some(b => b.name === name)) {
            return res.status(400).json({ error: 'Bot name already exists' });
        }
        
        // Verify symbol exists on exchange
        if (isConnected) {
            try {
                await exchange.fetchTicker(symbol);
            } catch (error) {
                return res.status(400).json({ error: `Invalid trading pair: ${symbol}` });
            }
        }
        
        // Calculate grid levels
        const gridLevels = calculateGridLevels(lower_price, upper_price, grid_count);
        
        // Create new bot
        const newBot = {
            id: Date.now(),
            name,
            symbol,
            lower_price: parseFloat(lower_price),
            upper_price: parseFloat(upper_price),
            grid_count: parseInt(grid_count),
            order_size: parseFloat(order_size),
            status: 'stopped',
            created_at: new Date().toISOString(),
            current_price: null,
            stats: {
                trade_count: 0,
                buy_count: 0,
                sell_count: 0,
                total_profit: 0,
                avg_profit: 0
            },
            grid_levels: gridLevels,
            trades: []
        };
        
        data.bots.push(newBot);
        await writeData(data);
        
        console.log(`✓ Created bot: ${name}`);
        res.json(newBot);
    } catch (error) {
        console.error('Failed to create bot:', error);
        res.status(500).json({ error: error.message });
    }
});

// Start bot
app.post('/api/bots/:id/start', async (req, res) => {
    try {
        if (!isConnected) {
            return res.status(400).json({ error: 'Not connected to Binance.US' });
        }

        const data = await readData();
        const bot = data.bots.find(b => b.id === parseInt(req.params.id));
        
        if (!bot) {
            return res.status(404).json({ error: 'Bot not found' });
        }
        
        if (bot.status === 'running') {
            return res.status(400).json({ error: 'Bot is already running' });
        }
        
        bot.status = 'running';
        bot.started_at = new Date().toISOString();
        
        await writeData(data);
        
        // Start trading loop
        runBotTradingLoop(bot.id);
        
        console.log(`✓ Started bot: ${bot.name}`);
        res.json(bot);
    } catch (error) {
        console.error('Failed to start bot:', error);
        res.status(500).json({ error: error.message });
    }
});

// Stop bot
app.post('/api/bots/:id/stop', async (req, res) => {
    try {
        const data = await readData();
        const bot = data.bots.find(b => b.id === parseInt(req.params.id));
        
        if (!bot) {
            return res.status(404).json({ error: 'Bot not found' });
        }
        
        if (bot.status === 'stopped') {
            return res.status(400).json({ error: 'Bot is already stopped' });
        }
        
        bot.status = 'stopped';
        bot.stopped_at = new Date().toISOString();
        
        await writeData(data);
        
        console.log(`✓ Stopped bot: ${bot.name}`);
        res.json(bot);
    } catch (error) {
        console.error('Failed to stop bot:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete bot
app.delete('/api/bots/:id', async (req, res) => {
    try {
        const data = await readData();
        const botIndex = data.bots.findIndex(b => b.id === parseInt(req.params.id));
        
        if (botIndex === -1) {
            return res.status(404).json({ error: 'Bot not found' });
        }
        
        const bot = data.bots[botIndex];
        
        // Check if bot is running
        if (bot.status === 'running' && !req.query.force) {
            return res.status(400).json({ error: 'Cannot delete running bot. Stop it first or use force=true' });
        }
        
        data.bots.splice(botIndex, 1);
        await writeData(data);
        
        console.log(`✓ Deleted bot: ${bot.name}`);
        res.json({ success: true, message: 'Bot deleted' });
    } catch (error) {
        console.error('Failed to delete bot:', error);
        res.status(500).json({ error: error.message });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        connected: isConnected,
        mode: PAPER_TRADING ? 'paper' : 'live'
    });
});

// Start server
async function start() {
    await initData();
    await initExchange();
    
    // Resume running bots
    const data = await readData();
    const runningBots = data.bots.filter(b => b.status === 'running');
    for (const bot of runningBots) {
        console.log(`↻ Resuming bot: ${bot.name}`);
        runBotTradingLoop(bot.id);
    }
    
    app.listen(PORT, '0.0.0.0', () => {
        console.log('');
        console.log('======================================');
        console.log('  Grid Trading Bot Dashboard');
        console.log('======================================');
        console.log(`  URL: http://0.0.0.0:${PORT}`);
        console.log(`  Mode: ${PAPER_TRADING ? 'Paper Trading' : 'Live Trading'}`);
        console.log(`  Exchange: Binance.US`);
        console.log(`  Status: ${isConnected ? 'Connected ✓' : 'Disconnected ✗'}`);
        console.log('======================================');
        console.log('');
    });
}

start().catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
