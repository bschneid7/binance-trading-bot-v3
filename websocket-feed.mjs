#!/usr/bin/env node

/**
 * WebSocket Price Feed Module
 * Version: 1.0.0
 * 
 * Provides real-time price streaming via WebSocket connection
 * with automatic reconnection and REST API fallback.
 */

import ccxt from 'ccxt';

/**
 * WebSocket Price Feed Manager
 * Handles real-time price streaming with automatic reconnection
 */
export class WebSocketPriceFeed {
  constructor(exchange, options = {}) {
    this.exchange = exchange;
    this.symbol = options.symbol || 'BTC/USD';
    this.onPrice = options.onPrice || (() => {});
    this.onError = options.onError || console.error;
    this.onConnect = options.onConnect || (() => {});
    this.onDisconnect = options.onDisconnect || (() => {});
    
    // Connection state
    this.isConnected = false;
    this.isRunning = false;
    this.lastPrice = null;
    this.lastUpdate = null;
    
    // Reconnection settings
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
    this.baseReconnectDelay = options.baseReconnectDelay || 1000;
    this.maxReconnectDelay = options.maxReconnectDelay || 30000;
    
    // Health check settings
    this.healthCheckInterval = options.healthCheckInterval || 30000;
    this.staleDataThreshold = options.staleDataThreshold || 60000;
    this.healthCheckTimer = null;
    
    // Fallback REST polling
    this.fallbackInterval = options.fallbackInterval || 5000;
    this.fallbackTimer = null;
    this.usingFallback = false;
  }

  /**
   * Start the WebSocket price feed
   */
  async start() {
    if (this.isRunning) {
      console.log('⚠️  WebSocket feed already running');
      return;
    }
    
    this.isRunning = true;
    console.log(`🔌 Starting WebSocket price feed for ${this.symbol}...`);
    
    await this.connect();
    this.startHealthCheck();
  }

  /**
   * Stop the WebSocket price feed
   */
  async stop() {
    this.isRunning = false;
    this.stopHealthCheck();
    this.stopFallback();
    
    if (this.exchange.close) {
      try {
        await this.exchange.close();
      } catch (error) {
        // Ignore close errors
      }
    }
    
    this.isConnected = false;
    console.log('🛑 WebSocket price feed stopped');
  }

  /**
   * Connect to WebSocket stream
   */
  async connect() {
    try {
      console.log(`🔄 Connecting to WebSocket for ${this.symbol}...`);
      
      // Check if exchange supports WebSocket
      if (!this.exchange.has['watchTicker']) {
        console.log('⚠️  Exchange does not support WebSocket watchTicker, using REST fallback');
        this.startFallback();
        return;
      }
      
      // Start watching ticker
      await this.watchTicker();
      
    } catch (error) {
      console.error('❌ WebSocket connection failed:', error.message);
      await this.handleConnectionError(error);
    }
  }

  /**
   * Watch ticker via WebSocket
   */
  async watchTicker() {
    while (this.isRunning) {
      try {
        const ticker = await this.exchange.watchTicker(this.symbol);
        
        if (!this.isConnected) {
          this.isConnected = true;
          this.usingFallback = false;
          this.reconnectAttempts = 0;
          this.stopFallback();
          console.log(`✅ WebSocket connected for ${this.symbol}`);
          this.onConnect();
        }
        
        this.lastPrice = ticker.last;
        this.lastUpdate = Date.now();
        
        this.onPrice({
          symbol: this.symbol,
          price: ticker.last,
          bid: ticker.bid,
          ask: ticker.ask,
          timestamp: ticker.timestamp || Date.now(),
          source: 'websocket'
        });
        
      } catch (error) {
        if (this.isRunning) {
          console.error('❌ WebSocket error:', error.message);
          await this.handleConnectionError(error);
        }
        break;
      }
    }
  }

  /**
   * Handle connection errors with exponential backoff
   */
  async handleConnectionError(error) {
    this.isConnected = false;
    this.onDisconnect(error);
    
    if (!this.isRunning) return;
    
    this.reconnectAttempts++;
    
    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      console.log('⚠️  Max reconnection attempts reached, switching to REST fallback');
      this.startFallback();
      return;
    }
    
    // Exponential backoff with jitter
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts - 1) + Math.random() * 1000,
      this.maxReconnectDelay
    );
    
    console.log(`🔄 Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
    
    await this.sleep(delay);
    
    if (this.isRunning) {
      await this.connect();
    }
  }

  /**
   * Start REST API fallback polling
   */
  startFallback() {
    if (this.usingFallback) return;
    
    this.usingFallback = true;
    console.log(`📡 Starting REST API fallback (polling every ${this.fallbackInterval / 1000}s)...`);
    
    this.fallbackTimer = setInterval(async () => {
      try {
        const ticker = await this.exchange.fetchTicker(this.symbol);
        
        this.lastPrice = ticker.last;
        this.lastUpdate = Date.now();
        
        this.onPrice({
          symbol: this.symbol,
          price: ticker.last,
          bid: ticker.bid,
          ask: ticker.ask,
          timestamp: ticker.timestamp || Date.now(),
          source: 'rest_fallback'
        });
        
      } catch (error) {
        console.error('❌ REST fallback error:', error.message);
        this.onError(error);
      }
    }, this.fallbackInterval);
    
    // Also fetch immediately
    this.exchange.fetchTicker(this.symbol).then(ticker => {
      this.lastPrice = ticker.last;
      this.lastUpdate = Date.now();
      this.onPrice({
        symbol: this.symbol,
        price: ticker.last,
        bid: ticker.bid,
        ask: ticker.ask,
        timestamp: ticker.timestamp || Date.now(),
        source: 'rest_fallback'
      });
    }).catch(error => {
      console.error('❌ Initial REST fetch error:', error.message);
    });
  }

  /**
   * Stop REST API fallback polling
   */
  stopFallback() {
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    this.usingFallback = false;
  }

  /**
   * Start health check timer
   */
  startHealthCheck() {
    this.healthCheckTimer = setInterval(() => {
      this.checkHealth();
    }, this.healthCheckInterval);
  }

  /**
   * Stop health check timer
   */
  stopHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Check connection health
   */
  checkHealth() {
    const now = Date.now();
    const timeSinceUpdate = now - (this.lastUpdate || 0);
    
    if (timeSinceUpdate > this.staleDataThreshold) {
      console.log(`⚠️  Stale data detected (${(timeSinceUpdate / 1000).toFixed(0)}s since last update)`);
      
      if (!this.usingFallback) {
        console.log('🔄 Attempting to reconnect WebSocket...');
        this.isConnected = false;
        this.connect();
      }
    }
  }

  /**
   * Get current connection status
   */
  getStatus() {
    return {
      isConnected: this.isConnected,
      isRunning: this.isRunning,
      usingFallback: this.usingFallback,
      lastPrice: this.lastPrice,
      lastUpdate: this.lastUpdate,
      reconnectAttempts: this.reconnectAttempts,
      symbol: this.symbol
    };
  }

  /**
   * Destroy instance and release all resources
   * Call this when completely done with the WebSocket instance
   */
  async destroy() {
    await this.stop();
    // Clear all references
    this.onPrice = null;
    this.onError = null;
    this.onConnect = null;
    this.onDisconnect = null;
    this.exchange = null;
    console.log('🗑️  WebSocketPriceFeed instance destroyed');
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Create a pro exchange instance with WebSocket support
 */
export function createWebSocketExchange(apiKey, secret, options = {}) {
  // Use the pro version for WebSocket support
  const ExchangeClass = ccxt.pro?.binanceus || ccxt.binanceus;
  
  const exchange = new ExchangeClass({
    apiKey,
    secret,
    enableRateLimit: true,
    options: {
      defaultType: 'spot',
      adjustForTimeDifference: true,
      ...options
    }
  });
  
  return exchange;
}

export default {
  WebSocketPriceFeed,
  createWebSocketExchange
};
