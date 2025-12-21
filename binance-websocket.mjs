#!/usr/bin/env node

/**
 * Native Binance WebSocket Module
 * Version: 1.0.0
 * 
 * Direct WebSocket connection to Binance.US for real-time:
 * - User data stream (order updates, trade executions, account updates)
 * - Price ticker stream
 * 
 * This bypasses ccxt's WebSocket limitations and provides sub-second
 * fill detection for the grid trading bot.
 */

import WebSocket from 'ws';
import crypto from 'crypto';
import https from 'https';

// Binance.US API endpoints
const REST_BASE = 'https://api.binance.us';
const WS_BASE = 'wss://stream.binance.us:9443';

/**
 * Binance WebSocket Manager
 * Handles user data stream and ticker streams with automatic reconnection
 */
export class BinanceWebSocket {
  constructor(apiKey, apiSecret, options = {}) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.options = {
      reconnectDelay: 5000,
      keepAliveInterval: 30 * 60 * 1000, // 30 minutes
      pingInterval: 3 * 60 * 1000, // 3 minutes
      ...options,
    };
    
    this.listenKey = null;
    this.userDataWs = null;
    this.tickerWs = null;
    this.keepAliveTimer = null;
    this.pingTimer = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    
    // Event handlers
    this.onOrderUpdate = null;
    this.onTradeUpdate = null;
    this.onAccountUpdate = null;
    this.onPriceUpdate = null;
    this.onError = null;
    this.onConnect = null;
    this.onDisconnect = null;
  }

  /**
   * Sign a request with HMAC SHA256
   */
  sign(queryString) {
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(queryString)
      .digest('hex');
  }

  /**
   * Make a signed REST API request
   */
  async apiRequest(method, endpoint, params = {}) {
    return new Promise((resolve, reject) => {
      const timestamp = Date.now();
      const queryParams = { ...params, timestamp };
      const queryString = Object.entries(queryParams)
        .map(([k, v]) => `${k}=${v}`)
        .join('&');
      const signature = this.sign(queryString);
      const fullQuery = `${queryString}&signature=${signature}`;
      
      const url = new URL(`${REST_BASE}${endpoint}?${fullQuery}`);
      
      const options = {
        method,
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: {
          'X-MBX-APIKEY': this.apiKey,
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              reject(new Error(parsed.msg || `HTTP ${res.statusCode}`));
            } else {
              resolve(parsed);
            }
          } catch (e) {
            reject(new Error(`Failed to parse response: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.end();
    });
  }

  /**
   * Create a listen key for user data stream
   */
  async createListenKey() {
    const result = await this.apiRequest('POST', '/api/v3/userDataStream');
    this.listenKey = result.listenKey;
    console.log('📡 Listen key created for user data stream');
    return this.listenKey;
  }

  /**
   * Keep the listen key alive (must be called every 30 minutes)
   */
  async keepAliveListenKey() {
    if (!this.listenKey) return;
    try {
      await this.apiRequest('PUT', '/api/v3/userDataStream', {
        listenKey: this.listenKey,
      });
      console.log('🔄 Listen key refreshed');
    } catch (error) {
      console.error('❌ Failed to refresh listen key:', error.message);
      // Recreate listen key and reconnect
      await this.reconnectUserDataStream();
    }
  }

  /**
   * Connect to user data stream for order/trade updates
   */
  async connectUserDataStream() {
    try {
      await this.createListenKey();
      
      const wsUrl = `${WS_BASE}/ws/${this.listenKey}`;
      this.userDataWs = new WebSocket(wsUrl);

      this.userDataWs.on('open', () => {
        console.log('✅ User data WebSocket connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        
        // Start keep-alive timer
        this.keepAliveTimer = setInterval(() => {
          this.keepAliveListenKey();
        }, this.options.keepAliveInterval);

        // Start ping timer
        this.pingTimer = setInterval(() => {
          if (this.userDataWs && this.userDataWs.readyState === WebSocket.OPEN) {
            this.userDataWs.ping();
          }
        }, this.options.pingInterval);

        if (this.onConnect) this.onConnect('userData');
      });

      this.userDataWs.on('message', (data) => {
        try {
          const event = JSON.parse(data.toString());
          this.handleUserDataEvent(event);
        } catch (error) {
          console.error('❌ Failed to parse user data message:', error.message);
        }
      });

      this.userDataWs.on('close', () => {
        console.log('⚠️ User data WebSocket disconnected');
        this.isConnected = false;
        this.clearTimers();
        if (this.onDisconnect) this.onDisconnect('userData');
        this.scheduleReconnect('userData');
      });

      this.userDataWs.on('error', (error) => {
        console.error('❌ User data WebSocket error:', error.message);
        if (this.onError) this.onError(error, 'userData');
      });

      this.userDataWs.on('pong', () => {
        // Connection is alive
      });

    } catch (error) {
      console.error('❌ Failed to connect user data stream:', error.message);
      this.scheduleReconnect('userData');
    }
  }

  /**
   * Handle user data stream events
   */
  handleUserDataEvent(event) {
    switch (event.e) {
      case 'executionReport':
        this.handleExecutionReport(event);
        break;
      case 'outboundAccountPosition':
        this.handleAccountUpdate(event);
        break;
      case 'balanceUpdate':
        // Balance changed
        if (this.onAccountUpdate) {
          this.onAccountUpdate({
            type: 'balanceUpdate',
            asset: event.a,
            delta: parseFloat(event.d),
            timestamp: event.T,
          });
        }
        break;
      default:
        // Unknown event type
        break;
    }
  }

  /**
   * Handle execution report (order updates)
   */
  handleExecutionReport(event) {
    const order = {
      id: event.i.toString(),
      clientOrderId: event.c,
      symbol: event.s,
      side: event.S.toLowerCase(),
      type: event.o,
      status: this.mapOrderStatus(event.X),
      price: parseFloat(event.p),
      amount: parseFloat(event.q),
      filled: parseFloat(event.z),
      remaining: parseFloat(event.q) - parseFloat(event.z),
      cost: parseFloat(event.Z),
      timestamp: event.T,
      lastTradeId: event.t,
      lastTradePrice: parseFloat(event.L),
      lastTradeQty: parseFloat(event.l),
      commission: parseFloat(event.n),
      commissionAsset: event.N,
    };

    // Determine event type
    const executionType = event.x; // NEW, CANCELED, TRADE, EXPIRED, etc.

    if (executionType === 'TRADE') {
      // Order was (partially) filled
      if (this.onTradeUpdate) {
        this.onTradeUpdate({
          orderId: order.id,
          symbol: order.symbol,
          side: order.side,
          price: order.lastTradePrice,
          amount: order.lastTradeQty,
          cost: order.lastTradePrice * order.lastTradeQty,
          fee: order.commission,
          feeAsset: order.commissionAsset,
          timestamp: order.timestamp,
          isFilled: order.status === 'closed',
          remaining: order.remaining,
        });
      }
    }

    if (this.onOrderUpdate) {
      this.onOrderUpdate({
        ...order,
        executionType,
      });
    }
  }

  /**
   * Map Binance order status to ccxt-style status
   */
  mapOrderStatus(status) {
    const statusMap = {
      'NEW': 'open',
      'PARTIALLY_FILLED': 'open',
      'FILLED': 'closed',
      'CANCELED': 'canceled',
      'PENDING_CANCEL': 'open',
      'REJECTED': 'rejected',
      'EXPIRED': 'expired',
    };
    return statusMap[status] || status.toLowerCase();
  }

  /**
   * Handle account update
   */
  handleAccountUpdate(event) {
    if (this.onAccountUpdate) {
      const balances = event.B.map(b => ({
        asset: b.a,
        free: parseFloat(b.f),
        locked: parseFloat(b.l),
      }));
      this.onAccountUpdate({
        type: 'accountUpdate',
        balances,
        timestamp: event.u,
      });
    }
  }

  /**
   * Connect to ticker stream for price updates
   */
  connectTickerStream(symbols) {
    const streams = symbols.map(s => {
      const formatted = s.replace('/', '').toLowerCase();
      return `${formatted}@ticker`;
    }).join('/');

    const wsUrl = `${WS_BASE}/stream?streams=${streams}`;
    this.tickerWs = new WebSocket(wsUrl);

    this.tickerWs.on('open', () => {
      console.log(`✅ Ticker WebSocket connected for ${symbols.join(', ')}`);
      if (this.onConnect) this.onConnect('ticker');
    });

    this.tickerWs.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.data && this.onPriceUpdate) {
          const ticker = message.data;
          this.onPriceUpdate({
            symbol: this.formatSymbol(ticker.s),
            price: parseFloat(ticker.c),
            bid: parseFloat(ticker.b),
            ask: parseFloat(ticker.a),
            volume: parseFloat(ticker.v),
            change: parseFloat(ticker.p),
            changePercent: parseFloat(ticker.P),
            timestamp: ticker.E,
          });
        }
      } catch (error) {
        console.error('❌ Failed to parse ticker message:', error.message);
      }
    });

    this.tickerWs.on('close', () => {
      console.log('⚠️ Ticker WebSocket disconnected');
      if (this.onDisconnect) this.onDisconnect('ticker');
      this.scheduleReconnect('ticker', symbols);
    });

    this.tickerWs.on('error', (error) => {
      console.error('❌ Ticker WebSocket error:', error.message);
      if (this.onError) this.onError(error, 'ticker');
    });
  }

  /**
   * Format symbol from BTCUSD to BTC/USD
   */
  formatSymbol(symbol) {
    // Handle common quote currencies
    const quotes = ['USD', 'USDT', 'USDC', 'BTC', 'ETH'];
    for (const quote of quotes) {
      if (symbol.endsWith(quote)) {
        const base = symbol.slice(0, -quote.length);
        return `${base}/${quote}`;
      }
    }
    return symbol;
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  scheduleReconnect(streamType, symbols = null) {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`❌ Max reconnection attempts reached for ${streamType}`);
      return;
    }

    const delay = Math.min(
      this.options.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      60000 // Max 1 minute
    );
    this.reconnectAttempts++;

    console.log(`🔄 Reconnecting ${streamType} in ${delay / 1000}s (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      if (streamType === 'userData') {
        this.reconnectUserDataStream();
      } else if (streamType === 'ticker' && symbols) {
        this.connectTickerStream(symbols);
      }
    }, delay);
  }

  /**
   * Reconnect user data stream
   */
  async reconnectUserDataStream() {
    this.clearTimers();
    if (this.userDataWs) {
      this.userDataWs.terminate();
    }
    await this.connectUserDataStream();
  }

  /**
   * Clear all timers
   */
  clearTimers() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /**
   * Close all connections
   */
  close() {
    this.clearTimers();
    if (this.userDataWs) {
      this.userDataWs.close();
      this.userDataWs = null;
    }
    if (this.tickerWs) {
      this.tickerWs.close();
      this.tickerWs = null;
    }
    this.isConnected = false;
    console.log('🔌 All WebSocket connections closed');
  }

  /**
   * Check if connected
   */
  get connected() {
    return this.isConnected && 
           this.userDataWs && 
           this.userDataWs.readyState === WebSocket.OPEN;
  }
}

// Export for use in grid bot
export default BinanceWebSocket;
