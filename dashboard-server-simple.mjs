#!/usr/bin/env node

// Grid Trading Bot Dashboard - Simplified Server
// This version works without complex dependencies

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_FILE = join(__dirname, 'data', 'grid-bots.json');

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

// API Routes

// System status
app.get('/api/status', async (req, res) => {
    try {
        res.json({
            mode: process.env.PAPER_TRADING === 'true' ? 'paper' : 'live',
            exchange: 'Binance.US',
            connected: false,
            balance: {
                usd: 0,
                btc: 0
            },
            message: 'Dashboard running - Configure API keys in .env file'
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
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
async function start() {
    await initData();
    
    app.listen(PORT, '0.0.0.0', () => {
        console.log('');
        console.log('======================================');
        console.log('  Grid Trading Bot Dashboard');
        console.log('======================================');
        console.log(`  URL: http://0.0.0.0:${PORT}`);
        console.log(`  Mode: ${process.env.PAPER_TRADING === 'true' ? 'Paper Trading' : 'Live Trading'}`);
        console.log('======================================');
        console.log('');
    });
}

start().catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
