#!/usr/bin/env node

/**
 * Order Book Analysis Module
 * Version: 1.0.0
 * 
 * Analyzes order book depth to:
 * - Identify support/resistance levels
 * - Detect large orders (walls)
 * - Calculate bid/ask imbalance
 * - Optimize order placement
 * 
 * Helps place orders at levels with strong support/resistance.
 */

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  // Depth levels to analyze
  depthLevels: 20,
  
  // Wall detection threshold (as multiple of average order size)
  wallThreshold: 5.0,
  
  // Imbalance threshold for signal generation
  imbalanceThreshold: 0.3,  // 30% imbalance
  
  // Support/resistance clustering distance (as % of price)
  clusterDistance: 0.002,  // 0.2%
  
  // Minimum volume for significant level
  minSignificantVolume: 1000,  // USD equivalent
  
  // Cache duration
  cacheDuration: 10 * 1000,  // 10 seconds (order books change fast)
  
  // Price levels to identify
  maxLevels: 5
};

/**
 * Order Book Signal States
 */
export const ORDERBOOK_SIGNAL = {
  STRONG_BUY_PRESSURE: 2,
  BUY_PRESSURE: 1,
  BALANCED: 0,
  SELL_PRESSURE: -1,
  STRONG_SELL_PRESSURE: -2
};

export const SIGNAL_NAMES = {
  [ORDERBOOK_SIGNAL.STRONG_BUY_PRESSURE]: 'Strong Buy Pressure 🟢🟢',
  [ORDERBOOK_SIGNAL.BUY_PRESSURE]: 'Buy Pressure 🟢',
  [ORDERBOOK_SIGNAL.BALANCED]: 'Balanced ⚪',
  [ORDERBOOK_SIGNAL.SELL_PRESSURE]: 'Sell Pressure 🔴',
  [ORDERBOOK_SIGNAL.STRONG_SELL_PRESSURE]: 'Strong Sell Pressure 🔴🔴'
};

/**
 * Order Book Analyzer Class
 */
export class OrderBookAnalyzer {
  constructor(options = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.cache = new Map();
  }

  /**
   * Analyze order book for a symbol
   */
  async analyzeOrderBook(exchange, symbol) {
    // Check cache
    const cached = this.cache.get(symbol);
    if (cached && Date.now() - cached.timestamp < this.config.cacheDuration) {
      return cached;
    }
    
    try {
      // Fetch order book
      const orderBook = await exchange.fetchOrderBook(symbol, this.config.depthLevels);
      
      if (!orderBook || !orderBook.bids || !orderBook.asks) {
        return this.formatResult(ORDERBOOK_SIGNAL.BALANCED, 0, 'No order book data', {});
      }
      
      const bids = orderBook.bids;  // [[price, amount], ...]
      const asks = orderBook.asks;
      
      if (bids.length === 0 || asks.length === 0) {
        return this.formatResult(ORDERBOOK_SIGNAL.BALANCED, 0, 'Empty order book', {});
      }
      
      // Calculate metrics
      const midPrice = (bids[0][0] + asks[0][0]) / 2;
      const spread = (asks[0][0] - bids[0][0]) / midPrice;
      
      // Calculate total volume on each side
      const bidVolume = bids.reduce((sum, [price, amount]) => sum + (price * amount), 0);
      const askVolume = asks.reduce((sum, [price, amount]) => sum + (price * amount), 0);
      const totalVolume = bidVolume + askVolume;
      
      // Calculate imbalance (-1 to 1, positive = more bids)
      const imbalance = totalVolume > 0 ? (bidVolume - askVolume) / totalVolume : 0;
      
      // Detect walls (large orders)
      const avgBidSize = bidVolume / bids.length;
      const avgAskSize = askVolume / asks.length;
      
      const bidWalls = this.detectWalls(bids, avgBidSize, midPrice, 'bid');
      const askWalls = this.detectWalls(asks, avgAskSize, midPrice, 'ask');
      
      // Identify support/resistance levels
      const supportLevels = this.identifyLevels(bids, midPrice, 'support');
      const resistanceLevels = this.identifyLevels(asks, midPrice, 'resistance');
      
      // Calculate depth at various price levels
      const depthAnalysis = this.analyzeDepth(bids, asks, midPrice);
      
      // Determine signal
      let signal = ORDERBOOK_SIGNAL.BALANCED;
      let confidence = 0;
      
      if (imbalance >= this.config.imbalanceThreshold * 2) {
        signal = ORDERBOOK_SIGNAL.STRONG_BUY_PRESSURE;
        confidence = Math.min(1, Math.abs(imbalance));
      } else if (imbalance >= this.config.imbalanceThreshold) {
        signal = ORDERBOOK_SIGNAL.BUY_PRESSURE;
        confidence = Math.min(1, Math.abs(imbalance));
      } else if (imbalance <= -this.config.imbalanceThreshold * 2) {
        signal = ORDERBOOK_SIGNAL.STRONG_SELL_PRESSURE;
        confidence = Math.min(1, Math.abs(imbalance));
      } else if (imbalance <= -this.config.imbalanceThreshold) {
        signal = ORDERBOOK_SIGNAL.SELL_PRESSURE;
        confidence = Math.min(1, Math.abs(imbalance));
      }
      
      // Adjust confidence based on walls
      if (bidWalls.length > askWalls.length) {
        confidence = Math.min(1, confidence + 0.2);
        if (signal === ORDERBOOK_SIGNAL.BALANCED) signal = ORDERBOOK_SIGNAL.BUY_PRESSURE;
      } else if (askWalls.length > bidWalls.length) {
        confidence = Math.min(1, confidence + 0.2);
        if (signal === ORDERBOOK_SIGNAL.BALANCED) signal = ORDERBOOK_SIGNAL.SELL_PRESSURE;
      }
      
      const result = this.formatResult(signal, confidence, null, {
        midPrice,
        spread: parseFloat((spread * 100).toFixed(4)),
        spreadBps: parseFloat((spread * 10000).toFixed(2)),
        bidVolume: parseFloat(bidVolume.toFixed(2)),
        askVolume: parseFloat(askVolume.toFixed(2)),
        imbalance: parseFloat(imbalance.toFixed(4)),
        imbalancePercent: parseFloat((imbalance * 100).toFixed(2)),
        bidWalls,
        askWalls,
        supportLevels,
        resistanceLevels,
        depthAnalysis,
        bestBid: bids[0][0],
        bestAsk: asks[0][0]
      });
      
      // Cache result
      this.cache.set(symbol, result);
      
      return result;
      
    } catch (error) {
      console.error(`❌ Order book analysis error for ${symbol}:`, error.message);
      return this.formatResult(ORDERBOOK_SIGNAL.BALANCED, 0, error.message, {});
    }
  }

  /**
   * Detect large orders (walls)
   */
  detectWalls(orders, avgSize, midPrice, side) {
    const walls = [];
    
    for (const [price, amount] of orders) {
      const value = price * amount;
      
      if (value >= avgSize * this.config.wallThreshold && value >= this.config.minSignificantVolume) {
        const distanceFromMid = Math.abs(price - midPrice) / midPrice;
        
        walls.push({
          price: parseFloat(price.toFixed(2)),
          amount: parseFloat(amount.toFixed(6)),
          value: parseFloat(value.toFixed(2)),
          distancePercent: parseFloat((distanceFromMid * 100).toFixed(2)),
          side
        });
      }
      
      if (walls.length >= this.config.maxLevels) break;
    }
    
    return walls;
  }

  /**
   * Identify support/resistance levels by clustering orders
   */
  identifyLevels(orders, midPrice, type) {
    const levels = [];
    const clusters = new Map();
    
    for (const [price, amount] of orders) {
      // Round to cluster distance
      const clusterPrice = Math.round(price / (midPrice * this.config.clusterDistance)) 
                          * (midPrice * this.config.clusterDistance);
      
      if (!clusters.has(clusterPrice)) {
        clusters.set(clusterPrice, { totalVolume: 0, orderCount: 0 });
      }
      
      const cluster = clusters.get(clusterPrice);
      cluster.totalVolume += price * amount;
      cluster.orderCount += 1;
    }
    
    // Sort by volume and take top levels
    const sortedClusters = Array.from(clusters.entries())
      .filter(([, data]) => data.totalVolume >= this.config.minSignificantVolume)
      .sort((a, b) => b[1].totalVolume - a[1].totalVolume)
      .slice(0, this.config.maxLevels);
    
    for (const [price, data] of sortedClusters) {
      const distanceFromMid = Math.abs(price - midPrice) / midPrice;
      
      levels.push({
        price: parseFloat(price.toFixed(2)),
        volume: parseFloat(data.totalVolume.toFixed(2)),
        orderCount: data.orderCount,
        distancePercent: parseFloat((distanceFromMid * 100).toFixed(2)),
        type,
        strength: data.totalVolume >= this.config.minSignificantVolume * 3 ? 'strong' : 'moderate'
      });
    }
    
    return levels;
  }

  /**
   * Analyze depth at various price levels
   */
  analyzeDepth(bids, asks, midPrice) {
    const levels = [0.5, 1, 2, 5];  // Percentage from mid
    const analysis = {};
    
    for (const pct of levels) {
      const lowerBound = midPrice * (1 - pct / 100);
      const upperBound = midPrice * (1 + pct / 100);
      
      const bidDepth = bids
        .filter(([price]) => price >= lowerBound)
        .reduce((sum, [price, amount]) => sum + price * amount, 0);
      
      const askDepth = asks
        .filter(([price]) => price <= upperBound)
        .reduce((sum, [price, amount]) => sum + price * amount, 0);
      
      analysis[`${pct}%`] = {
        bidDepth: parseFloat(bidDepth.toFixed(2)),
        askDepth: parseFloat(askDepth.toFixed(2)),
        ratio: askDepth > 0 ? parseFloat((bidDepth / askDepth).toFixed(2)) : Infinity
      };
    }
    
    return analysis;
  }

  /**
   * Format result object
   */
  formatResult(signal, confidence, error, data) {
    return {
      signal,
      signalName: SIGNAL_NAMES[signal],
      confidence: parseFloat(confidence.toFixed(2)),
      error,
      data,
      timestamp: Date.now(),
      recommendation: this.getRecommendation(signal, confidence, data)
    };
  }

  /**
   * Get trading recommendation
   */
  getRecommendation(signal, confidence, data) {
    const rec = {
      optimalBuyPrice: null,
      optimalSellPrice: null,
      avoidBuy: false,
      avoidSell: false,
      message: ''
    };
    
    if (!data || !data.supportLevels) {
      rec.message = 'Insufficient data for recommendation';
      return rec;
    }
    
    // Suggest optimal buy price (near support)
    if (data.supportLevels.length > 0) {
      rec.optimalBuyPrice = data.supportLevels[0].price;
    }
    
    // Suggest optimal sell price (near resistance)
    if (data.resistanceLevels.length > 0) {
      rec.optimalSellPrice = data.resistanceLevels[0].price;
    }
    
    // Recommendations based on signal
    switch (signal) {
      case ORDERBOOK_SIGNAL.STRONG_BUY_PRESSURE:
        rec.message = 'Strong buying pressure - favorable for buys';
        break;
        
      case ORDERBOOK_SIGNAL.BUY_PRESSURE:
        rec.message = 'Moderate buying pressure - consider buying near support';
        break;
        
      case ORDERBOOK_SIGNAL.SELL_PRESSURE:
        rec.avoidBuy = confidence > 0.5;
        rec.message = 'Selling pressure detected - be cautious with buys';
        break;
        
      case ORDERBOOK_SIGNAL.STRONG_SELL_PRESSURE:
        rec.avoidBuy = true;
        rec.message = 'Strong selling pressure - avoid new buys';
        break;
        
      default:
        rec.message = 'Balanced order book - standard behavior';
    }
    
    // Add spread warning
    if (data.spreadBps > 50) {
      rec.message += ` (Wide spread: ${data.spreadBps}bps)`;
    }
    
    return rec;
  }

  /**
   * Get optimal price for order placement
   */
  async getOptimalPrice(exchange, symbol, side, targetPrice) {
    const analysis = await this.analyzeOrderBook(exchange, symbol);
    
    if (analysis.error) {
      return { price: targetPrice, adjusted: false, reason: analysis.error };
    }
    
    const data = analysis.data;
    
    if (side === 'buy') {
      // For buys, try to place near support or just above best bid
      if (data.supportLevels.length > 0) {
        const nearestSupport = data.supportLevels.find(s => s.price <= targetPrice);
        if (nearestSupport && nearestSupport.price >= targetPrice * 0.99) {
          return {
            price: nearestSupport.price,
            adjusted: true,
            reason: `Adjusted to support level at ${nearestSupport.price}`
          };
        }
      }
      
      // Place just above best bid to be maker
      const optimalBid = data.bestBid + 0.01;
      if (optimalBid < targetPrice) {
        return {
          price: optimalBid,
          adjusted: true,
          reason: `Adjusted to best bid + 0.01 at ${optimalBid}`
        };
      }
    } else {
      // For sells, try to place near resistance or just below best ask
      if (data.resistanceLevels.length > 0) {
        const nearestResistance = data.resistanceLevels.find(r => r.price >= targetPrice);
        if (nearestResistance && nearestResistance.price <= targetPrice * 1.01) {
          return {
            price: nearestResistance.price,
            adjusted: true,
            reason: `Adjusted to resistance level at ${nearestResistance.price}`
          };
        }
      }
      
      // Place just below best ask to be maker
      const optimalAsk = data.bestAsk - 0.01;
      if (optimalAsk > targetPrice) {
        return {
          price: optimalAsk,
          adjusted: true,
          reason: `Adjusted to best ask - 0.01 at ${optimalAsk}`
        };
      }
    }
    
    return { price: targetPrice, adjusted: false, reason: 'No adjustment needed' };
  }

  /**
   * Get summary of cached analyses
   */
  getSummary() {
    const summary = {};
    for (const [symbol, data] of this.cache.entries()) {
      summary[symbol] = {
        signal: data.signalName,
        imbalance: data.data.imbalancePercent + '%',
        spread: data.data.spreadBps + 'bps',
        bidWalls: data.data.bidWalls.length,
        askWalls: data.data.askWalls.length,
        age: Math.round((Date.now() - data.timestamp) / 1000) + 's ago'
      };
    }
    return summary;
  }
}

export default OrderBookAnalyzer;
