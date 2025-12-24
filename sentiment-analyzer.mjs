#!/usr/bin/env node

/**
 * News/Sentiment Analysis Module
 * Version: 1.0.0
 * 
 * Monitors crypto news and sentiment to:
 * - Pause buying during major negative news events
 * - Increase buying during positive catalysts
 * - Track Fear & Greed Index
 * - Monitor social sentiment
 * 
 * Uses free APIs for sentiment data.
 */

import https from 'https';

/**
 * Sentiment states
 */
export const SENTIMENT = {
  EXTREME_GREED: 2,
  GREED: 1,
  NEUTRAL: 0,
  FEAR: -1,
  EXTREME_FEAR: -2
};

export const SENTIMENT_NAMES = {
  [SENTIMENT.EXTREME_GREED]: 'Extreme Greed 🟢🟢',
  [SENTIMENT.GREED]: 'Greed 🟢',
  [SENTIMENT.NEUTRAL]: 'Neutral ⚪',
  [SENTIMENT.FEAR]: 'Fear 🔴',
  [SENTIMENT.EXTREME_FEAR]: 'Extreme Fear 🔴🔴'
};

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  // Fear & Greed thresholds
  extremeFearThreshold: 25,
  fearThreshold: 40,
  greedThreshold: 60,
  extremeGreedThreshold: 75,
  
  // Cache duration
  cacheDuration: 15 * 60 * 1000,  // 15 minutes
  
  // API endpoints
  fearGreedApi: 'https://api.alternative.me/fng/',
  
  // Trading behavior
  buyOnExtremeFear: true,  // Contrarian: buy when others are fearful
  reduceOnExtremeGreed: true,  // Reduce exposure when market is euphoric
  
  // Position adjustments
  extremeFearMultiplier: 1.3,  // Increase size on extreme fear
  fearMultiplier: 1.1,
  greedMultiplier: 0.9,
  extremeGreedMultiplier: 0.6  // Reduce size on extreme greed
};

/**
 * Simple HTTPS GET request
 */
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Failed to parse response'));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Sentiment Analyzer Class
 */
export class SentimentAnalyzer {
  constructor(options = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.cache = {
      fearGreed: null,
      lastUpdate: 0
    };
    
    // News event tracking
    this.activeAlerts = [];
    this.newsHistory = [];
  }

  /**
   * Fetch Fear & Greed Index
   */
  async fetchFearGreedIndex() {
    try {
      const data = await httpsGet(this.config.fearGreedApi);
      
      if (data && data.data && data.data.length > 0) {
        const current = data.data[0];
        return {
          value: parseInt(current.value),
          classification: current.value_classification,
          timestamp: parseInt(current.timestamp) * 1000,
          timeUntilUpdate: current.time_until_update
        };
      }
      
      return null;
    } catch (error) {
      console.error('❌ Failed to fetch Fear & Greed Index:', error.message);
      return null;
    }
  }

  /**
   * Convert Fear & Greed value to sentiment
   */
  valueToSentiment(value) {
    if (value <= this.config.extremeFearThreshold) return SENTIMENT.EXTREME_FEAR;
    if (value <= this.config.fearThreshold) return SENTIMENT.FEAR;
    if (value >= this.config.extremeGreedThreshold) return SENTIMENT.EXTREME_GREED;
    if (value >= this.config.greedThreshold) return SENTIMENT.GREED;
    return SENTIMENT.NEUTRAL;
  }

  /**
   * Analyze current market sentiment
   */
  async analyzeSentiment() {
    // Check cache
    if (this.cache.fearGreed && 
        Date.now() - this.cache.lastUpdate < this.config.cacheDuration) {
      return this.cache.fearGreed;
    }
    
    try {
      const fearGreed = await this.fetchFearGreedIndex();
      
      if (!fearGreed) {
        return this.formatResult(SENTIMENT.NEUTRAL, 0, 'Failed to fetch data', {});
      }
      
      const sentiment = this.valueToSentiment(fearGreed.value);
      const confidence = Math.abs(fearGreed.value - 50) / 50;  // 0-1 based on distance from neutral
      
      const result = this.formatResult(sentiment, confidence, null, {
        fearGreedIndex: fearGreed.value,
        fearGreedClassification: fearGreed.classification,
        dataTimestamp: fearGreed.timestamp,
        activeAlerts: this.activeAlerts.length,
        recommendation: this.getRecommendation(sentiment, fearGreed.value)
      });
      
      // Cache result
      this.cache.fearGreed = result;
      this.cache.lastUpdate = Date.now();
      
      return result;
      
    } catch (error) {
      console.error('❌ Sentiment analysis error:', error.message);
      return this.formatResult(SENTIMENT.NEUTRAL, 0, error.message, {});
    }
  }

  /**
   * Format result object
   */
  formatResult(sentiment, confidence, error, data) {
    return {
      sentiment,
      sentimentName: SENTIMENT_NAMES[sentiment],
      confidence: parseFloat(confidence.toFixed(2)),
      error,
      data,
      timestamp: Date.now()
    };
  }

  /**
   * Get trading recommendation based on sentiment
   */
  getRecommendation(sentiment, fearGreedValue) {
    const rec = {
      allowBuy: true,
      sizeMultiplier: 1.0,
      message: '',
      contrarian: false
    };
    
    switch (sentiment) {
      case SENTIMENT.EXTREME_FEAR:
        if (this.config.buyOnExtremeFear) {
          rec.sizeMultiplier = this.config.extremeFearMultiplier;
          rec.message = `Extreme Fear (${fearGreedValue}) - Contrarian buy opportunity`;
          rec.contrarian = true;
        } else {
          rec.allowBuy = false;
          rec.message = `Extreme Fear (${fearGreedValue}) - Market panic, waiting`;
        }
        break;
        
      case SENTIMENT.FEAR:
        rec.sizeMultiplier = this.config.fearMultiplier;
        rec.message = `Fear (${fearGreedValue}) - Good accumulation zone`;
        break;
        
      case SENTIMENT.GREED:
        rec.sizeMultiplier = this.config.greedMultiplier;
        rec.message = `Greed (${fearGreedValue}) - Reduce position sizes`;
        break;
        
      case SENTIMENT.EXTREME_GREED:
        if (this.config.reduceOnExtremeGreed) {
          rec.sizeMultiplier = this.config.extremeGreedMultiplier;
          rec.message = `Extreme Greed (${fearGreedValue}) - Market euphoria, reduce exposure`;
        } else {
          rec.message = `Extreme Greed (${fearGreedValue}) - Caution advised`;
        }
        break;
        
      default:
        rec.message = `Neutral (${fearGreedValue}) - Standard behavior`;
    }
    
    return rec;
  }

  /**
   * Add a news alert (can be called externally or via webhook)
   */
  addNewsAlert(alert) {
    const newsAlert = {
      id: Date.now(),
      title: alert.title,
      impact: alert.impact || 'medium',  // 'low', 'medium', 'high', 'critical'
      sentiment: alert.sentiment || 'neutral',  // 'positive', 'negative', 'neutral'
      asset: alert.asset || 'BTC',
      timestamp: Date.now(),
      expiresAt: Date.now() + (alert.duration || 60 * 60 * 1000)  // Default 1 hour
    };
    
    this.activeAlerts.push(newsAlert);
    this.newsHistory.push(newsAlert);
    
    // Keep history limited
    if (this.newsHistory.length > 100) {
      this.newsHistory = this.newsHistory.slice(-100);
    }
    
    console.log(`📰 News Alert: ${newsAlert.title} (${newsAlert.impact} impact, ${newsAlert.sentiment})`);
    
    return newsAlert;
  }

  /**
   * Remove expired alerts
   */
  cleanupAlerts() {
    const now = Date.now();
    this.activeAlerts = this.activeAlerts.filter(alert => alert.expiresAt > now);
  }

  /**
   * Check if trading should be paused due to news
   */
  shouldPauseTrading(asset = 'BTC') {
    this.cleanupAlerts();
    
    const relevantAlerts = this.activeAlerts.filter(
      alert => alert.asset === asset || alert.asset === 'ALL'
    );
    
    // Check for critical negative news
    const criticalNegative = relevantAlerts.find(
      alert => alert.impact === 'critical' && alert.sentiment === 'negative'
    );
    
    if (criticalNegative) {
      return {
        pause: true,
        reason: `Critical negative news: ${criticalNegative.title}`,
        resumeAt: criticalNegative.expiresAt
      };
    }
    
    // Check for multiple high-impact negative news
    const highNegative = relevantAlerts.filter(
      alert => alert.impact === 'high' && alert.sentiment === 'negative'
    );
    
    if (highNegative.length >= 2) {
      return {
        pause: true,
        reason: `Multiple negative news events (${highNegative.length})`,
        resumeAt: Math.max(...highNegative.map(a => a.expiresAt))
      };
    }
    
    return { pause: false, reason: null, resumeAt: null };
  }

  /**
   * Get position size multiplier based on sentiment and news
   */
  async getPositionMultiplier(asset = 'BTC') {
    const sentiment = await this.analyzeSentiment();
    const pauseCheck = this.shouldPauseTrading(asset);
    
    if (pauseCheck.pause) {
      return {
        multiplier: 0,
        reason: pauseCheck.reason,
        sentiment: sentiment.sentimentName
      };
    }
    
    // Check for positive news boost
    this.cleanupAlerts();
    const positiveNews = this.activeAlerts.filter(
      alert => (alert.asset === asset || alert.asset === 'ALL') && 
               alert.sentiment === 'positive' &&
               (alert.impact === 'high' || alert.impact === 'critical')
    );
    
    let multiplier = sentiment.data.recommendation?.sizeMultiplier || 1.0;
    
    if (positiveNews.length > 0) {
      multiplier *= 1.2;  // 20% boost on positive news
    }
    
    return {
      multiplier,
      reason: sentiment.data.recommendation?.message || 'Standard',
      sentiment: sentiment.sentimentName,
      fearGreedIndex: sentiment.data.fearGreedIndex,
      positiveNewsCount: positiveNews.length
    };
  }

  /**
   * Get summary of current state
   */
  getSummary() {
    this.cleanupAlerts();
    
    return {
      fearGreed: this.cache.fearGreed ? {
        value: this.cache.fearGreed.data.fearGreedIndex,
        sentiment: this.cache.fearGreed.sentimentName,
        age: Math.round((Date.now() - this.cache.lastUpdate) / 1000) + 's ago'
      } : null,
      activeAlerts: this.activeAlerts.map(a => ({
        title: a.title,
        impact: a.impact,
        sentiment: a.sentiment,
        expiresIn: Math.round((a.expiresAt - Date.now()) / 60000) + ' min'
      })),
      recentNews: this.newsHistory.slice(-5).map(n => n.title)
    };
  }
}

/**
 * Pre-defined news events that can be triggered
 */
export const NEWS_EVENTS = {
  FED_RATE_DECISION: {
    title: 'Federal Reserve Rate Decision',
    impact: 'critical',
    duration: 4 * 60 * 60 * 1000  // 4 hours
  },
  MAJOR_HACK: {
    title: 'Major Exchange/Protocol Hack',
    impact: 'critical',
    sentiment: 'negative',
    duration: 24 * 60 * 60 * 1000  // 24 hours
  },
  ETF_APPROVAL: {
    title: 'Bitcoin ETF Approval',
    impact: 'critical',
    sentiment: 'positive',
    duration: 12 * 60 * 60 * 1000  // 12 hours
  },
  REGULATORY_NEWS: {
    title: 'Major Regulatory Announcement',
    impact: 'high',
    duration: 6 * 60 * 60 * 1000  // 6 hours
  },
  WHALE_MOVEMENT: {
    title: 'Large Whale Movement Detected',
    impact: 'medium',
    duration: 2 * 60 * 60 * 1000  // 2 hours
  }
};

export default SentimentAnalyzer;
