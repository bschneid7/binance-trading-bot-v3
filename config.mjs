#!/usr/bin/env node

/**
 * Grid Trading Bot - Centralized Configuration Module
 * Version: 1.0.0
 * 
 * This module centralizes all configuration settings for the grid trading bot.
 * All hardcoded values have been moved here for easy management and modification.
 */

import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
const envPath = join(__dirname, '.env.production');
if (existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

/**
 * Exchange Configuration
 */
export const EXCHANGE_CONFIG = {
  // Exchange identifier
  id: 'binanceus',
  
  // API credentials (from environment)
  apiKey: process.env.BINANCE_API_KEY || '',
  apiSecret: process.env.BINANCE_API_SECRET || '',
  
  // Rate limiting
  enableRateLimit: true,
  rateLimit: 50, // requests per second
  
  // Connection options
  options: {
    defaultType: 'spot',
    adjustForTimeDifference: true,
    recvWindow: 60000
  },
  
  // Trading mode
  paperTrading: process.env.PAPER_TRADING_MODE === 'true'
};

/**
 * Grid Trading Configuration
 */
export const GRID_CONFIG = {
  // Default trading pair
  defaultSymbol: 'BTC/USD',
  
  // Grid spacing type: 'geometric' or 'arithmetic'
  spacingType: 'geometric',
  
  // Default grid parameters
  defaults: {
    gridCount: 10,
    orderSize: 100, // USD per grid level
    lowerPrice: 90000,
    upperPrice: 100000
  },
  
  // Grid adjustment thresholds
  adjustment: {
    // Minimum price movement (%) to trigger grid recalculation
    minPriceMovement: 2.0,
    
    // Maximum grid levels
    maxGridLevels: 100,
    
    // Minimum grid levels
    minGridLevels: 3
  }
};

/**
 * Risk Management Configuration
 */
export const RISK_CONFIG = {
  // Stop-loss settings
  stopLoss: {
    enabled: true,
    percentage: 15.0, // Trigger stop-loss at 15% loss
    action: 'cancel_all' // 'cancel_all', 'pause', or 'notify'
  },
  
  // Trailing stop settings
  trailingStop: {
    enabled: true,
    percentage: 5.0, // Trail by 5%
    activationProfit: 3.0 // Activate after 3% profit
  },
  
  // Maximum drawdown
  maxDrawdown: {
    enabled: true,
    percentage: 25.0, // Maximum 25% drawdown
    action: 'pause'
  },
  
  // Position sizing (Kelly Criterion)
  positionSizing: {
    enabled: true,
    minMultiplier: 0.5, // Minimum 50% of base size
    maxMultiplier: 2.0, // Maximum 200% of base size
    defaultWinRate: 55 // Default win rate assumption (%)
  },
  
  // Profit taking
  profitTaking: {
    enabled: true,
    targetPercentage: 5.0, // Take profit at 5% gain
    partialTakePercentage: 50 // Take 50% of position
  }
};

/**
 * Monitoring Configuration
 */
export const MONITOR_CONFIG = {
  // Price feed settings
  priceFeed: {
    // Preferred method: 'websocket' or 'rest'
    preferredMethod: 'websocket',
    
    // REST API fallback polling interval (milliseconds)
    fallbackInterval: 10000, // 10 seconds
    
    // WebSocket health check interval (milliseconds)
    healthCheckInterval: 30000, // 30 seconds
    
    // Stale data threshold (milliseconds)
    staleDataThreshold: 60000 // 60 seconds
  },
  
  // Reconnection settings
  reconnection: {
    enabled: true,
    maxAttempts: 10,
    initialDelay: 1000, // 1 second
    maxDelay: 60000, // 60 seconds
    backoffMultiplier: 2.0
  },
  
  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info', // 'debug', 'info', 'warn', 'error'
    timestamps: true,
    colorize: true
  }
};

/**
 * Database Configuration
 */
export const DATABASE_CONFIG = {
  // Database type: 'sqlite' or 'mysql'
  type: 'sqlite',
  
  // SQLite settings
  sqlite: {
    filename: join(__dirname, 'data', 'grid-bot.db'),
    journalMode: 'WAL',
    foreignKeys: true
  },
  
  // MySQL settings (for future use)
  mysql: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    database: process.env.DB_NAME || 'grid_bot',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || ''
  }
};

/**
 * Notification Configuration
 */
export const NOTIFICATION_CONFIG = {
  // Email settings
  email: {
    enabled: true,
    recipient: process.env.NOTIFICATION_EMAIL || 'bschneid7@gmail.com', // Set NOTIFICATION_EMAIL env var to override
    sender: process.env.GMAIL_USER || '',
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    appPassword: process.env.GMAIL_APP_PASSWORD || ''
  },
  
  // Notification triggers
  triggers: {
    onFill: true,
    onError: true,
    onStopLoss: true,
    onDailySummary: true,
    onHealthCheck: true
  },
  
  // Daily summary time (UTC)
  dailySummaryTime: '08:00'
};

/**
 * API Rate Limits (Binance.US specific)
 */
export const RATE_LIMITS = {
  // Request weight limits
  requestWeight: {
    perMinute: 1200,
    warningThreshold: 0.8 // Warn at 80% usage
  },
  
  // Order limits
  orders: {
    perSecond: 10,
    perDay: 200000
  },
  
  // Safety buffer
  safetyBuffer: 0.2 // Use only 80% of available capacity
};

/**
 * File Paths
 */
export const PATHS = {
  root: __dirname,
  data: join(__dirname, 'data'),
  logs: join(__dirname, 'logs'),
  config: join(__dirname, 'config'),
  
  // Legacy JSON files (for migration)
  legacy: {
    bots: join(__dirname, 'data', 'grid-bots.json'),
    orders: join(__dirname, 'data', 'active-orders.json'),
    trades: join(__dirname, 'data', 'grid-trades.json')
  }
};

/**
 * Version Information
 */
export const VERSION = {
  // Core version - increment on major releases
  core: '5.2.0',
  
  // Component versions
  enhancedMonitor: '1.7.0',
  gridBotCli: '5.2.0',
  config: '1.0.0',
  
  // Requirements
  minNodeVersion: '18.0.0',
  
  // Helper to get display string
  getDisplayVersion(component = 'core') {
    return this[component] || this.core;
  }
};

/**
 * Validate configuration
 */
export function validateConfig() {
  const errors = [];
  
  // Check required environment variables
  if (!EXCHANGE_CONFIG.apiKey) {
    errors.push('BINANCE_API_KEY is not set');
  }
  if (!EXCHANGE_CONFIG.apiSecret) {
    errors.push('BINANCE_API_SECRET is not set');
  }
  
  // Check Node.js version
  const nodeVersion = process.version.slice(1).split('.').map(Number);
  const minVersion = VERSION.minNodeVersion.split('.').map(Number);
  if (nodeVersion[0] < minVersion[0]) {
    errors.push(`Node.js ${VERSION.minNodeVersion} or higher is required`);
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Get configuration summary
 */
export function getConfigSummary() {
  return {
    version: VERSION.bot,
    exchange: EXCHANGE_CONFIG.id,
    paperTrading: EXCHANGE_CONFIG.paperTrading,
    priceFeedMethod: MONITOR_CONFIG.priceFeed.preferredMethod,
    pollingInterval: MONITOR_CONFIG.priceFeed.fallbackInterval,
    stopLossEnabled: RISK_CONFIG.stopLoss.enabled,
    stopLossPercentage: RISK_CONFIG.stopLoss.percentage,
    emailNotifications: NOTIFICATION_CONFIG.email.enabled,
    databaseType: DATABASE_CONFIG.type
  };
}

// Export default configuration object
export default {
  EXCHANGE_CONFIG,
  GRID_CONFIG,
  RISK_CONFIG,
  MONITOR_CONFIG,
  DATABASE_CONFIG,
  NOTIFICATION_CONFIG,
  RATE_LIMITS,
  PATHS,
  VERSION,
  validateConfig,
  getConfigSummary
};
