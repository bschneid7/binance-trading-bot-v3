/**
 * Sentiment Integration Module
 * 
 * Integrates the SentimentAggregator with the Enhanced Grid Bot Monitor
 * Provides sentiment-adjusted trading signals and position sizing
 * 
 * Created: December 24, 2025
 */

import { SentimentAggregator } from './sentiment-analyzer.mjs';

// ═══════════════════════════════════════════════════════════════════════════
// SENTIMENT INTEGRATION CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

export const SENTIMENT_INTEGRATION_CONFIG = {
  // Enable/disable sentiment-based adjustments
  ENABLED: true,
  
  // How often to update sentiment (ms)
  UPDATE_INTERVAL: 15 * 60 * 1000,  // 15 minutes
  
  // Position sizing adjustments
  POSITION_SIZING: {
    ENABLED: true,
    MIN_MULTIPLIER: 0.5,   // Minimum position size multiplier
    MAX_MULTIPLIER: 1.5,   // Maximum position size multiplier
  },
  
  // Grid spacing adjustments
  GRID_SPACING: {
    ENABLED: true,
    MIN_MULTIPLIER: 0.8,   // Tighter grids in extreme sentiment
    MAX_MULTIPLIER: 1.2,   // Wider grids in neutral sentiment
  },
  
  // Order placement adjustments
  ORDER_PLACEMENT: {
    ENABLED: true,
    // Skip buy orders in extreme greed
    SKIP_BUYS_ABOVE_SCORE: 80,
    // Skip sell orders in extreme fear
    SKIP_SELLS_BELOW_SCORE: 20,
  },
  
  // Dip buyer integration
  DIP_BUYER: {
    ENABLED: true,
    // Increase dip buyer aggression in extreme fear
    EXTREME_FEAR_MULTIPLIER: 2.0,
    FEAR_MULTIPLIER: 1.5,
    NEUTRAL_MULTIPLIER: 1.0,
    GREED_MULTIPLIER: 0.5,
    EXTREME_GREED_MULTIPLIER: 0.25,
  },
  
  // Alert thresholds
  ALERTS: {
    EXTREME_FEAR_THRESHOLD: 20,
    EXTREME_GREED_THRESHOLD: 80,
    SIGNIFICANT_CHANGE_THRESHOLD: 15,  // Alert if sentiment changes by 15+ points
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// SENTIMENT INTEGRATION CLASS
// ═══════════════════════════════════════════════════════════════════════════

export class SentimentIntegration {
  constructor(options = {}) {
    this.config = { ...SENTIMENT_INTEGRATION_CONFIG, ...options };
    this.aggregator = null;
    this.lastScores = {};
    this.updateInterval = null;
    this.callbacks = {
      onSentimentUpdate: [],
      onExtremeAlert: [],
      onSignificantChange: [],
    };
  }
  
  /**
   * Initialize the sentiment integration
   */
  async init() {
    if (!this.config.ENABLED) {
      console.log('⚠️  Sentiment integration disabled');
      return this;
    }
    
    console.log('🧠 Initializing Sentiment Integration...');
    
    this.aggregator = new SentimentAggregator();
    await this.aggregator.init();
    
    // Store initial scores
    this.lastScores = { ...this.aggregator.compositeScores };
    
    // Start automatic updates
    this.startAutoUpdate();
    
    console.log('✅ Sentiment Integration ready');
    
    return this;
  }
  
  /**
   * Start automatic sentiment updates
   */
  startAutoUpdate() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    
    this.updateInterval = setInterval(async () => {
      await this.update();
    }, this.config.UPDATE_INTERVAL);
    
    console.log(`   Auto-update every ${this.config.UPDATE_INTERVAL / 60000} minutes`);
  }
  
  /**
   * Update sentiment and check for alerts
   */
  async update() {
    if (!this.aggregator) return;
    
    const oldScores = { ...this.lastScores };
    
    await this.aggregator.updateAll();
    
    const newScores = this.aggregator.compositeScores;
    
    // Check for significant changes and alerts
    for (const symbol of Object.keys(newScores)) {
      const newScore = newScores[symbol]?.composite;
      const oldScore = oldScores[symbol]?.composite;
      
      if (newScore === undefined) continue;
      
      // Check for extreme sentiment alerts
      if (newScore <= this.config.ALERTS.EXTREME_FEAR_THRESHOLD) {
        this.triggerCallback('onExtremeAlert', {
          type: 'extreme_fear',
          symbol,
          score: newScore,
          message: `🚨 EXTREME FEAR for ${symbol}: ${newScore}/100 - Consider accumulating`,
        });
      } else if (newScore >= this.config.ALERTS.EXTREME_GREED_THRESHOLD) {
        this.triggerCallback('onExtremeAlert', {
          type: 'extreme_greed',
          symbol,
          score: newScore,
          message: `🚨 EXTREME GREED for ${symbol}: ${newScore}/100 - Consider reducing exposure`,
        });
      }
      
      // Check for significant changes
      if (oldScore !== undefined) {
        const change = newScore - oldScore;
        if (Math.abs(change) >= this.config.ALERTS.SIGNIFICANT_CHANGE_THRESHOLD) {
          this.triggerCallback('onSignificantChange', {
            symbol,
            oldScore,
            newScore,
            change,
            message: `📊 Significant sentiment change for ${symbol}: ${oldScore} → ${newScore} (${change > 0 ? '+' : ''}${change})`,
          });
        }
      }
    }
    
    this.lastScores = { ...newScores };
    
    // Trigger general update callback
    this.triggerCallback('onSentimentUpdate', newScores);
    
    return newScores;
  }
  
  /**
   * Register callback for sentiment events
   */
  on(event, callback) {
    if (this.callbacks[event]) {
      this.callbacks[event].push(callback);
    }
    return this;
  }
  
  /**
   * Trigger callbacks for an event
   */
  triggerCallback(event, data) {
    if (this.callbacks[event]) {
      for (const callback of this.callbacks[event]) {
        try {
          callback(data);
        } catch (e) {
          console.error(`Callback error: ${e.message}`);
        }
      }
    }
  }
  
  /**
   * Get position size multiplier for a symbol
   */
  getPositionSizeMultiplier(symbol = 'BTC') {
    if (!this.config.POSITION_SIZING.ENABLED || !this.aggregator) {
      return 1.0;
    }
    
    const multiplier = this.aggregator.getPositionSizeMultiplier(symbol);
    
    return Math.max(
      this.config.POSITION_SIZING.MIN_MULTIPLIER,
      Math.min(this.config.POSITION_SIZING.MAX_MULTIPLIER, multiplier)
    );
  }
  
  /**
   * Get grid spacing multiplier for a symbol
   */
  getGridSpacingMultiplier(symbol = 'BTC') {
    if (!this.config.GRID_SPACING.ENABLED || !this.aggregator) {
      return 1.0;
    }
    
    const multiplier = this.aggregator.getGridSpacingMultiplier(symbol);
    
    return Math.max(
      this.config.GRID_SPACING.MIN_MULTIPLIER,
      Math.min(this.config.GRID_SPACING.MAX_MULTIPLIER, multiplier)
    );
  }
  
  /**
   * Check if buy orders should be placed based on sentiment
   */
  shouldPlaceBuyOrders(symbol = 'BTC') {
    if (!this.config.ORDER_PLACEMENT.ENABLED || !this.aggregator) {
      return true;
    }
    
    const sentiment = this.aggregator.getSentiment(symbol);
    if (!sentiment) return true;
    
    // Skip buys in extreme greed
    if (sentiment.composite >= this.config.ORDER_PLACEMENT.SKIP_BUYS_ABOVE_SCORE) {
      console.log(`⚠️  Skipping buy orders for ${symbol} - Extreme greed (${sentiment.composite}/100)`);
      return false;
    }
    
    return true;
  }
  
  /**
   * Check if sell orders should be placed based on sentiment
   */
  shouldPlaceSellOrders(symbol = 'BTC') {
    if (!this.config.ORDER_PLACEMENT.ENABLED || !this.aggregator) {
      return true;
    }
    
    const sentiment = this.aggregator.getSentiment(symbol);
    if (!sentiment) return true;
    
    // Skip sells in extreme fear (hold for recovery)
    if (sentiment.composite <= this.config.ORDER_PLACEMENT.SKIP_SELLS_BELOW_SCORE) {
      console.log(`⚠️  Skipping sell orders for ${symbol} - Extreme fear (${sentiment.composite}/100)`);
      return false;
    }
    
    return true;
  }
  
  /**
   * Get dip buyer multiplier based on sentiment
   */
  getDipBuyerMultiplier(symbol = 'BTC') {
    if (!this.config.DIP_BUYER.ENABLED || !this.aggregator) {
      return 1.0;
    }
    
    const sentiment = this.aggregator.getSentiment(symbol);
    if (!sentiment) return 1.0;
    
    const score = sentiment.composite;
    
    if (score <= 25) return this.config.DIP_BUYER.EXTREME_FEAR_MULTIPLIER;
    if (score <= 40) return this.config.DIP_BUYER.FEAR_MULTIPLIER;
    if (score <= 60) return this.config.DIP_BUYER.NEUTRAL_MULTIPLIER;
    if (score <= 75) return this.config.DIP_BUYER.GREED_MULTIPLIER;
    return this.config.DIP_BUYER.EXTREME_GREED_MULTIPLIER;
  }
  
  /**
   * Get current sentiment summary
   */
  getSummary() {
    if (!this.aggregator) {
      return { enabled: false };
    }
    
    return {
      enabled: true,
      fearGreed: {
        value: this.aggregator.fearGreed.currentValue,
        classification: this.aggregator.fearGreed.classification,
      },
      scores: this.aggregator.compositeScores,
      lastUpdate: this.aggregator.lastFullUpdate,
    };
  }
  
  /**
   * Get trading recommendation for a symbol
   */
  getRecommendation(symbol = 'BTC') {
    if (!this.aggregator) {
      return { action: 'hold', reason: 'Sentiment analysis unavailable' };
    }
    
    const sentiment = this.aggregator.getSentiment(symbol);
    if (!sentiment) {
      return { action: 'hold', reason: 'No sentiment data for symbol' };
    }
    
    return {
      action: sentiment.signal.action,
      confidence: sentiment.signal.confidence,
      reason: sentiment.signal.reason,
      score: sentiment.composite,
      components: sentiment.components,
      aiAnalysis: sentiment.aiAnalysis,
      positionMultiplier: this.getPositionSizeMultiplier(symbol),
      gridMultiplier: this.getGridSpacingMultiplier(symbol),
      dipBuyerMultiplier: this.getDipBuyerMultiplier(symbol),
    };
  }
  
  /**
   * Print current sentiment status
   */
  printStatus() {
    if (!this.aggregator) {
      console.log('⚠️  Sentiment integration not initialized');
      return;
    }
    
    this.aggregator.printSummary();
    
    console.log('\n  Trading Adjustments:');
    for (const symbol of ['BTC', 'ETH', 'SOL']) {
      const rec = this.getRecommendation(symbol);
      console.log(`\n  ${symbol}:`);
      console.log(`    Action: ${rec.action} (${rec.confidence} confidence)`);
      console.log(`    Position Size: ${(rec.positionMultiplier * 100).toFixed(0)}%`);
      console.log(`    Grid Spacing: ${(rec.gridMultiplier * 100).toFixed(0)}%`);
      console.log(`    Dip Buyer: ${(rec.dipBuyerMultiplier * 100).toFixed(0)}%`);
    }
  }
  
  /**
   * Stop the sentiment integration
   */
  stop() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    if (this.aggregator) {
      this.aggregator.stop();
    }
    
    console.log('🛑 Sentiment Integration stopped');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS FOR DIRECT INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════

let globalSentimentIntegration = null;

/**
 * Get or create the global sentiment integration instance
 */
export async function getSentimentIntegration() {
  if (!globalSentimentIntegration) {
    globalSentimentIntegration = new SentimentIntegration();
    await globalSentimentIntegration.init();
  }
  return globalSentimentIntegration;
}

/**
 * Quick sentiment check for a symbol
 */
export async function quickSentimentCheck(symbol = 'BTC') {
  const integration = await getSentimentIntegration();
  return integration.getRecommendation(symbol);
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════

if (import.meta.url === `file://${process.argv[1]}`) {
  const integration = new SentimentIntegration();
  
  // Register alert callbacks
  integration.on('onExtremeAlert', (alert) => {
    console.log(`\n${alert.message}`);
  });
  
  integration.on('onSignificantChange', (change) => {
    console.log(`\n${change.message}`);
  });
  
  await integration.init();
  integration.printStatus();
  
  console.log('\nPress Ctrl+C to exit...');
  
  process.on('SIGINT', () => {
    integration.stop();
    process.exit(0);
  });
}

export default SentimentIntegration;
