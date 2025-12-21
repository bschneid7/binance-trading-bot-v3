#!/usr/bin/env node

/**
 * SQLite Database Module for Grid Trading Bot
 * Version: 1.0.0
 * 
 * Provides robust, transactional state management using SQLite
 * to replace the fragile JSON file-based storage.
 */

import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database configuration
const DB_DIR = join(__dirname, 'data');
const DB_FILE = join(DB_DIR, 'grid-bot.db');

// Ensure data directory exists
if (!existsSync(DB_DIR)) {
  mkdirSync(DB_DIR, { recursive: true });
}

/**
 * Database Manager Class
 * Handles all database operations with proper transaction support
 */
export class DatabaseManager {
  constructor(dbPath = DB_FILE) {
    this.dbPath = dbPath;
    this.db = null;
  }

  /**
   * Initialize database connection and create tables
   */
  init() {
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    
    this.createTables();
    console.log('✅ Database initialized:', this.dbPath);
    
    return this;
  }

  /**
   * Create database tables if they don't exist
   */
  createTables() {
    // Bots table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        symbol TEXT NOT NULL,
        lower_price REAL NOT NULL,
        upper_price REAL NOT NULL,
        grid_count INTEGER NOT NULL,
        adjusted_grid_count INTEGER NOT NULL,
        order_size REAL NOT NULL,
        status TEXT DEFAULT 'stopped',
        version TEXT,
        rebalance_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Orders table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        bot_name TEXT NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        type TEXT DEFAULT 'limit',
        price REAL NOT NULL,
        amount REAL NOT NULL,
        status TEXT DEFAULT 'open',
        filled REAL DEFAULT 0,
        remaining REAL,
        filled_price REAL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        filled_at TEXT,
        cancelled_at TEXT,
        cancel_reason TEXT,
        FOREIGN KEY (bot_name) REFERENCES bots(name) ON DELETE CASCADE
      )
    `);

    // Trades table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trades (
        id TEXT PRIMARY KEY,
        bot_name TEXT NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        price REAL NOT NULL,
        amount REAL NOT NULL,
        value REAL NOT NULL,
        fee REAL DEFAULT 0,
        order_id TEXT,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
        type TEXT DEFAULT 'fill',
        FOREIGN KEY (bot_name) REFERENCES bots(name) ON DELETE CASCADE,
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
      )
    `);

    // Metrics table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bot_name TEXT NOT NULL,
        total_trades INTEGER DEFAULT 0,
        win_rate REAL DEFAULT 0,
        profit_factor REAL DEFAULT 0,
        total_pnl REAL DEFAULT 0,
        avg_win REAL DEFAULT 0,
        avg_loss REAL DEFAULT 0,
        max_drawdown REAL DEFAULT 0,
        sharpe_ratio REAL DEFAULT 0,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (bot_name) REFERENCES bots(name) ON DELETE CASCADE
      )
    `);

    // Equity snapshots table for tracking total equity over time
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS equity_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
        usd_balance REAL NOT NULL,
        btc_balance REAL DEFAULT 0,
        btc_price REAL DEFAULT 0,
        eth_balance REAL DEFAULT 0,
        eth_price REAL DEFAULT 0,
        sol_balance REAL DEFAULT 0,
        sol_price REAL DEFAULT 0,
        total_equity_usd REAL NOT NULL
      )
    `);

    // Create indexes for performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_orders_bot_name ON orders(bot_name);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_trades_bot_name ON trades(bot_name);
      CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
      CREATE INDEX IF NOT EXISTS idx_equity_timestamp ON equity_snapshots(timestamp);
    `);
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // ==================== BOT OPERATIONS ====================

  /**
   * Create a new bot
   */
  createBot(bot) {
    const stmt = this.db.prepare(`
      INSERT INTO bots (name, symbol, lower_price, upper_price, grid_count, 
                        adjusted_grid_count, order_size, status, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      bot.name,
      bot.symbol,
      bot.lower_price,
      bot.upper_price,
      bot.grid_count,
      bot.adjusted_grid_count,
      bot.order_size,
      bot.status || 'stopped',
      bot.version || '5.0.0'
    );
    
    return { ...bot, id: result.lastInsertRowid };
  }

  /**
   * Get bot by name
   */
  getBot(name) {
    const stmt = this.db.prepare('SELECT * FROM bots WHERE name = ?');
    return stmt.get(name);
  }

  /**
   * Get all bots
   */
  getAllBots() {
    const stmt = this.db.prepare('SELECT * FROM bots ORDER BY id');
    return stmt.all();
  }

  /**
   * Update bot status
   */
  updateBotStatus(name, status) {
    const stmt = this.db.prepare(`
      UPDATE bots SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?
    `);
    return stmt.run(status, name);
  }

  /**
   * Update bot configuration
   */
  updateBot(name, updates) {
    const fields = [];
    const values = [];
    
    for (const [key, value] of Object.entries(updates)) {
      if (key !== 'name' && key !== 'id') {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
    
    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(name);
    
    const stmt = this.db.prepare(`UPDATE bots SET ${fields.join(', ')} WHERE name = ?`);
    return stmt.run(...values);
  }

  /**
   * Delete a bot and all related data
   */
  deleteBot(name) {
    const stmt = this.db.prepare('DELETE FROM bots WHERE name = ?');
    return stmt.run(name);
  }

  // ==================== ORDER OPERATIONS ====================

  /**
   * Create a new order
   */
  createOrder(order) {
    const stmt = this.db.prepare(`
      INSERT INTO orders (id, bot_name, symbol, side, type, price, amount, status, remaining)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      order.id,
      order.bot_name,
      order.symbol,
      order.side,
      order.type || 'limit',
      order.price,
      order.amount,
      order.status || 'open',
      order.remaining || order.amount
    );
    
    return order;
  }

  /**
   * Create multiple orders in a transaction
   */
  createOrders(orders) {
    const stmt = this.db.prepare(`
      INSERT INTO orders (id, bot_name, symbol, side, type, price, amount, status, remaining)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insertMany = this.db.transaction((orders) => {
      for (const order of orders) {
        stmt.run(
          order.id,
          order.bot_name,
          order.symbol,
          order.side,
          order.type || 'limit',
          order.price,
          order.amount,
          order.status || 'open',
          order.remaining || order.amount
        );
      }
    });
    
    insertMany(orders);
    return orders;
  }

  /**
   * Get order by ID
   */
  getOrder(id) {
    const stmt = this.db.prepare('SELECT * FROM orders WHERE id = ?');
    return stmt.get(id);
  }

  /**
   * Get active orders for a bot
   */
  getActiveOrders(botName) {
    const stmt = this.db.prepare(`
      SELECT * FROM orders WHERE bot_name = ? AND status = 'open' ORDER BY price
    `);
    return stmt.all(botName);
  }

  /**
   * Get all orders for a bot
   */
  getBotOrders(botName) {
    const stmt = this.db.prepare('SELECT * FROM orders WHERE bot_name = ? ORDER BY created_at DESC');
    return stmt.all(botName);
  }

  /**
   * Update order status to filled
   */
  fillOrder(id, filledPrice) {
    const stmt = this.db.prepare(`
      UPDATE orders 
      SET status = 'filled', filled = amount, remaining = 0, 
          filled_price = ?, filled_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    return stmt.run(filledPrice, id);
  }

  /**
   * Cancel an order
   */
  cancelOrder(id, reason = null) {
    const stmt = this.db.prepare(`
      UPDATE orders 
      SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, cancel_reason = ?
      WHERE id = ?
    `);
    return stmt.run(reason, id);
  }

  /**
   * Cancel all orders for a bot
   */
  cancelAllOrders(botName, reason = null) {
    const stmt = this.db.prepare(`
      UPDATE orders 
      SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, cancel_reason = ?
      WHERE bot_name = ? AND status = 'open'
    `);
    return stmt.run(reason, botName);
  }

  /**
   * Check and fill orders based on current price
   */
  checkAndFillOrders(botName, currentPrice) {
    const filledOrders = [];
    
    const checkFills = this.db.transaction(() => {
      const activeOrders = this.getActiveOrders(botName);
      
      for (const order of activeOrders) {
        let shouldFill = false;
        
        if (order.side === 'buy' && currentPrice <= order.price) {
          shouldFill = true;
        } else if (order.side === 'sell' && currentPrice >= order.price) {
          shouldFill = true;
        }
        
        if (shouldFill) {
          this.fillOrder(order.id, currentPrice);
          filledOrders.push({ ...order, filled_price: currentPrice });
        }
      }
    });
    
    checkFills();
    return filledOrders;
  }

  // ==================== TRADE OPERATIONS ====================

  /**
   * Record a trade
   */
  recordTrade(trade) {
    const stmt = this.db.prepare(`
      INSERT INTO trades (id, bot_name, symbol, side, price, amount, value, fee, order_id, type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const id = trade.id || `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    stmt.run(
      id,
      trade.bot_name,
      trade.symbol,
      trade.side,
      trade.price,
      trade.amount,
      trade.value || trade.price * trade.amount,
      trade.fee || 0,
      trade.order_id || null,
      trade.type || 'fill'
    );
    
    return { ...trade, id };
  }

  /**
   * Get trades for a bot
   */
  getBotTrades(botName, limit = 100) {
    const stmt = this.db.prepare(`
      SELECT * FROM trades WHERE bot_name = ? ORDER BY timestamp DESC LIMIT ?
    `);
    return stmt.all(botName, limit);
  }

  /**
   * Get today's trades for a bot
   */
  getTodaysTrades(botName) {
    const stmt = this.db.prepare(`
      SELECT * FROM trades 
      WHERE bot_name = ? AND date(timestamp) = date('now')
      ORDER BY timestamp DESC
    `);
    return stmt.all(botName);
  }

  /**
   * Get all trades
   */
  getAllTrades(limit = 1000) {
    const stmt = this.db.prepare('SELECT * FROM trades ORDER BY timestamp DESC LIMIT ?');
    return stmt.all(limit);
  }

  // ==================== METRICS OPERATIONS ====================

  /**
   * Calculate and update metrics for a bot
   */
  updateMetrics(botName) {
    const trades = this.getBotTrades(botName, 10000);
    
    if (trades.length === 0) {
      return {
        total_trades: 0,
        win_rate: 0,
        profit_factor: 0,
        total_pnl: 0,
        avg_win: 0,
        avg_loss: 0,
        max_drawdown: 0,
        sharpe_ratio: 0
      };
    }
    
    // Pair buy/sell trades
    const buyTrades = trades.filter(t => t.side.toLowerCase() === 'buy').reverse();
    const sellTrades = trades.filter(t => t.side.toLowerCase() === 'sell').reverse();
    
    let totalPnL = 0;
    let wins = 0;
    let losses = 0;
    let totalWin = 0;
    let totalLoss = 0;
    const returns = [];
    
    const minLength = Math.min(buyTrades.length, sellTrades.length);
    
    for (let i = 0; i < minLength; i++) {
      const buy = buyTrades[i];
      const sell = sellTrades[i];
      const pnl = (sell.price - buy.price) * buy.amount;
      const returnPct = (sell.price - buy.price) / buy.price;
      
      totalPnL += pnl;
      returns.push(returnPct);
      
      if (pnl > 0) {
        wins++;
        totalWin += pnl;
      } else {
        losses++;
        totalLoss += Math.abs(pnl);
      }
    }
    
    const totalTrades = wins + losses;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const avgWin = wins > 0 ? totalWin / wins : 0;
    const avgLoss = losses > 0 ? totalLoss / losses : 0;
    const profitFactor = totalLoss > 0 ? totalWin / totalLoss : 0;
    
    // Calculate max drawdown
    let peak = 0;
    let maxDrawdown = 0;
    let cumulative = 0;
    
    for (const ret of returns) {
      cumulative += ret;
      peak = Math.max(peak, cumulative);
      const drawdown = peak > 0 ? (peak - cumulative) / (1 + peak) : 0;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }
    
    // Calculate Sharpe ratio
    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const variance = returns.length > 0 
      ? returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length 
      : 0;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;
    
    const metrics = {
      total_trades: totalTrades,
      win_rate: parseFloat(winRate.toFixed(2)),
      profit_factor: parseFloat(profitFactor.toFixed(2)),
      total_pnl: parseFloat(totalPnL.toFixed(2)),
      avg_win: parseFloat(avgWin.toFixed(2)),
      avg_loss: parseFloat(avgLoss.toFixed(2)),
      max_drawdown: parseFloat((maxDrawdown * 100).toFixed(2)),
      sharpe_ratio: parseFloat(sharpeRatio.toFixed(2))
    };
    
    // Upsert metrics
    const existingMetrics = this.db.prepare('SELECT id FROM metrics WHERE bot_name = ?').get(botName);
    
    if (existingMetrics) {
      this.db.prepare(`
        UPDATE metrics SET 
          total_trades = ?, win_rate = ?, profit_factor = ?, total_pnl = ?,
          avg_win = ?, avg_loss = ?, max_drawdown = ?, sharpe_ratio = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE bot_name = ?
      `).run(
        metrics.total_trades, metrics.win_rate, metrics.profit_factor, metrics.total_pnl,
        metrics.avg_win, metrics.avg_loss, metrics.max_drawdown, metrics.sharpe_ratio,
        botName
      );
    } else {
      this.db.prepare(`
        INSERT INTO metrics (bot_name, total_trades, win_rate, profit_factor, total_pnl,
                            avg_win, avg_loss, max_drawdown, sharpe_ratio)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        botName, metrics.total_trades, metrics.win_rate, metrics.profit_factor, metrics.total_pnl,
        metrics.avg_win, metrics.avg_loss, metrics.max_drawdown, metrics.sharpe_ratio
      );
    }
    
    return metrics;
  }

  /**
   * Get metrics for a bot
   */
  getMetrics(botName) {
    const stmt = this.db.prepare('SELECT * FROM metrics WHERE bot_name = ?');
    return stmt.get(botName) || this.updateMetrics(botName);
  }

  // ==================== MIGRATION UTILITIES ====================

  /**
   * Import data from JSON files (for migration)
   */
  importFromJSON(botsData, ordersData, tradesData) {
    const importAll = this.db.transaction(() => {
      // Import bots
      for (const bot of botsData) {
        try {
          this.createBot(bot);
        } catch (e) {
          if (!e.message.includes('UNIQUE constraint')) throw e;
        }
      }
      
      // Import orders
      for (const order of ordersData) {
        try {
          this.createOrder(order);
        } catch (e) {
          if (!e.message.includes('UNIQUE constraint')) throw e;
        }
      }
      
      // Import trades
      for (const trade of tradesData) {
        try {
          this.recordTrade(trade);
        } catch (e) {
          if (!e.message.includes('UNIQUE constraint')) throw e;
        }
      }
    });
    
    importAll();
    console.log('✅ Data imported from JSON files');
  }

  /**
   * Export data to JSON format (for backup)
   */
  exportToJSON() {
    return {
      bots: this.getAllBots(),
      orders: this.db.prepare('SELECT * FROM orders').all(),
      trades: this.getAllTrades(100000),
      metrics: this.db.prepare('SELECT * FROM metrics').all(),
      exportedAt: new Date().toISOString()
    };
  }

  // ==================== EQUITY TRACKING ====================

  /**
   * Save an equity snapshot
   */
  saveEquitySnapshot(snapshot) {
    const stmt = this.db.prepare(`
      INSERT INTO equity_snapshots (
        timestamp, usd_balance, btc_balance, btc_price, 
        eth_balance, eth_price, sol_balance, sol_price, total_equity_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const timestamp = snapshot.timestamp || new Date().toISOString().replace('T', ' ').slice(0, 19);
    
    return stmt.run(
      timestamp,
      snapshot.usd_balance || 0,
      snapshot.btc_balance || 0,
      snapshot.btc_price || 0,
      snapshot.eth_balance || 0,
      snapshot.eth_price || 0,
      snapshot.sol_balance || 0,
      snapshot.sol_price || 0,
      snapshot.total_equity_usd
    );
  }

  /**
   * Get the most recent equity snapshot
   */
  getLatestEquitySnapshot() {
    const stmt = this.db.prepare(`
      SELECT * FROM equity_snapshots ORDER BY timestamp DESC LIMIT 1
    `);
    return stmt.get();
  }

  /**
   * Get equity snapshot from approximately 24 hours ago
   */
  getEquitySnapshot24hAgo() {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const yesterdayStr = yesterday.toISOString().replace('T', ' ').slice(0, 19);
    
    // Get the closest snapshot to 24 hours ago
    const stmt = this.db.prepare(`
      SELECT * FROM equity_snapshots 
      WHERE timestamp <= ?
      ORDER BY timestamp DESC LIMIT 1
    `);
    return stmt.get(yesterdayStr);
  }

  /**
   * Get all equity snapshots within a time range
   */
  getEquitySnapshots(hoursBack = 24) {
    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    const sinceStr = since.toISOString().replace('T', ' ').slice(0, 19);
    
    const stmt = this.db.prepare(`
      SELECT * FROM equity_snapshots 
      WHERE timestamp >= ?
      ORDER BY timestamp ASC
    `);
    return stmt.all(sinceStr);
  }

  /**
   * Clean up old equity snapshots (keep last N days)
   */
  cleanupEquitySnapshots(daysToKeep = 30) {
    const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
    const cutoffStr = cutoff.toISOString().replace('T', ' ').slice(0, 19);
    
    const stmt = this.db.prepare(`
      DELETE FROM equity_snapshots WHERE timestamp < ?
    `);
    return stmt.run(cutoffStr);
  }
}

// Singleton instance
let dbInstance = null;

/**
 * Get database instance (singleton)
 */
export function getDatabase() {
  if (!dbInstance) {
    dbInstance = new DatabaseManager().init();
  }
  return dbInstance;
}

/**
 * Close database connection
 */
export function closeDatabase() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export default {
  DatabaseManager,
  getDatabase,
  closeDatabase
};
