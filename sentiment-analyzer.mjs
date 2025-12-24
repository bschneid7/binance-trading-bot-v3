/**
 * Sentiment Analyzer Module v1.0.0
 * 
 * Multi-source sentiment analysis for crypto trading decisions
 * 
 * Sources:
 * 1. Fear & Greed Index (alternative.me) - Market-wide sentiment
 * 2. CryptoPanic News Feed - News headlines with panic scores
 * 3. OpenAI GPT Analysis - AI-powered sentiment scoring
 * 4. On-chain metrics (funding rates, long/short ratio)
 * 
 * Created: December 24, 2025
 */

import 'dotenv/config';
import OpenAI from 'openai';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const SENTIMENT_CONFIG = {
  // Update intervals
  FEAR_GREED_UPDATE_INTERVAL: 60 * 60 * 1000,    // 1 hour (updates daily anyway)
  NEWS_UPDATE_INTERVAL: 5 * 60 * 1000,            // 5 minutes
  ONCHAIN_UPDATE_INTERVAL: 15 * 60 * 1000,        // 15 minutes
  
  // Source weights for composite score
  SOURCE_WEIGHTS: {
    FEAR_GREED: 0.25,        // 25% weight
    NEWS_SENTIMENT: 0.30,    // 30% weight
    AI_ANALYSIS: 0.25,       // 25% weight
    ONCHAIN: 0.20,           // 20% weight
  },
  
  // Thresholds for trading signals
  EXTREME_FEAR_THRESHOLD: 25,
  FEAR_THRESHOLD: 40,
  GREED_THRESHOLD: 60,
  EXTREME_GREED_THRESHOLD: 75,
  
  // News analysis
  MAX_NEWS_ITEMS: 20,
  NEWS_LOOKBACK_HOURS: 24,
  
  // Symbols to track
  SYMBOLS: ['BTC', 'ETH', 'SOL'],
  
  // CryptoPanic API (requires free account)
  CRYPTOPANIC_API_KEY: process.env.CRYPTOPANIC_API_KEY || '',
  
  // Cache settings
  CACHE_DURATION_MS: 5 * 60 * 1000,  // 5 minutes
};

// ═══════════════════════════════════════════════════════════════════════════
// FEAR & GREED INDEX
// ═══════════════════════════════════════════════════════════════════════════

export class FearGreedIndex {
  constructor() {
    this.currentValue = null;
    this.classification = null;
    this.lastUpdate = null;
    this.history = [];
  }
  
  /**
   * Fetch current Fear & Greed Index from alternative.me
   * Free API, no authentication required
   */
  async fetch() {
    try {
      const response = await fetch('https://api.alternative.me/fng/?limit=7');
      const data = await response.json();
      
      if (data.data && data.data.length > 0) {
        const latest = data.data[0];
        this.currentValue = parseInt(latest.value);
        this.classification = latest.value_classification;
        this.lastUpdate = new Date(parseInt(latest.timestamp) * 1000);
        
        // Store history for trend analysis
        this.history = data.data.map(d => ({
          value: parseInt(d.value),
          classification: d.value_classification,
          timestamp: new Date(parseInt(d.timestamp) * 1000),
        }));
        
        console.log(`📊 Fear & Greed Index: ${this.currentValue} (${this.classification})`);
        
        return {
          value: this.currentValue,
          classification: this.classification,
          trend: this.calculateTrend(),
          lastUpdate: this.lastUpdate,
        };
      }
      
      throw new Error('Invalid response from Fear & Greed API');
    } catch (error) {
      console.error(`❌ Fear & Greed fetch error: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Calculate trend direction over the past week
   */
  calculateTrend() {
    if (this.history.length < 2) return 'unknown';
    
    const current = this.history[0].value;
    const weekAgo = this.history[this.history.length - 1].value;
    const change = current - weekAgo;
    
    if (change > 10) return 'strongly_improving';
    if (change > 5) return 'improving';
    if (change < -10) return 'strongly_declining';
    if (change < -5) return 'declining';
    return 'stable';
  }
  
  /**
   * Get normalized score (0-100 where 50 is neutral)
   */
  getNormalizedScore() {
    return this.currentValue || 50;
  }
  
  /**
   * Get trading signal based on Fear & Greed
   */
  getSignal() {
    if (!this.currentValue) return { signal: 'neutral', strength: 0 };
    
    if (this.currentValue <= SENTIMENT_CONFIG.EXTREME_FEAR_THRESHOLD) {
      return { signal: 'strong_buy', strength: (25 - this.currentValue) / 25 };
    }
    if (this.currentValue <= SENTIMENT_CONFIG.FEAR_THRESHOLD) {
      return { signal: 'buy', strength: (40 - this.currentValue) / 40 };
    }
    if (this.currentValue >= SENTIMENT_CONFIG.EXTREME_GREED_THRESHOLD) {
      return { signal: 'strong_sell', strength: (this.currentValue - 75) / 25 };
    }
    if (this.currentValue >= SENTIMENT_CONFIG.GREED_THRESHOLD) {
      return { signal: 'sell', strength: (this.currentValue - 60) / 40 };
    }
    
    return { signal: 'neutral', strength: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CRYPTO NEWS ANALYZER
// ═══════════════════════════════════════════════════════════════════════════

export class CryptoNewsAnalyzer {
  constructor(apiKey = '') {
    this.apiKey = apiKey || SENTIMENT_CONFIG.CRYPTOPANIC_API_KEY;
    this.newsCache = new Map();
    this.lastFetch = null;
  }
  
  /**
   * Fetch news from CryptoPanic API
   * Falls back to RSS if no API key
   */
  async fetchNews(symbols = SENTIMENT_CONFIG.SYMBOLS) {
    try {
      // If we have an API key, use the full API
      if (this.apiKey) {
        return await this.fetchFromAPI(symbols);
      }
      
      // Otherwise, use the free RSS feed
      return await this.fetchFromRSS();
    } catch (error) {
      console.error(`❌ News fetch error: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Fetch from CryptoPanic API (requires auth token)
   */
  async fetchFromAPI(symbols) {
    const currencies = symbols.join(',');
    const url = `https://cryptopanic.com/api/v1/posts/?auth_token=${this.apiKey}&currencies=${currencies}&filter=hot&public=true`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.results) {
      return data.results.map(item => ({
        id: item.id,
        title: item.title,
        source: item.source?.title || 'Unknown',
        url: item.url,
        publishedAt: new Date(item.published_at),
        currencies: item.currencies?.map(c => c.code) || [],
        votes: item.votes || {},
        panicScore: item.panic_score || null,
      }));
    }
    
    return [];
  }
  
  /**
   * Fetch from free RSS feed (no auth required)
   * Parses the public RSS feed for basic news data
   */
  async fetchFromRSS() {
    try {
      const response = await fetch('https://cryptopanic.com/news/rss/');
      const text = await response.text();
      
      // Simple RSS parsing
      const items = [];
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      const titleRegex = /<title><!\[CDATA\[(.*?)\]\]><\/title>/;
      const linkRegex = /<link>(.*?)<\/link>/;
      const pubDateRegex = /<pubDate>(.*?)<\/pubDate>/;
      
      let match;
      while ((match = itemRegex.exec(text)) !== null) {
        const itemContent = match[1];
        const title = titleRegex.exec(itemContent)?.[1] || '';
        const link = linkRegex.exec(itemContent)?.[1] || '';
        const pubDate = pubDateRegex.exec(itemContent)?.[1] || '';
        
        // Detect which symbols are mentioned
        const currencies = [];
        if (/bitcoin|btc/i.test(title)) currencies.push('BTC');
        if (/ethereum|eth/i.test(title)) currencies.push('ETH');
        if (/solana|sol/i.test(title)) currencies.push('SOL');
        
        items.push({
          id: link,
          title: title,
          source: 'CryptoPanic RSS',
          url: link,
          publishedAt: new Date(pubDate),
          currencies,
          votes: {},
          panicScore: null,
        });
        
        if (items.length >= SENTIMENT_CONFIG.MAX_NEWS_ITEMS) break;
      }
      
      console.log(`📰 Fetched ${items.length} news items from RSS`);
      return items;
    } catch (error) {
      console.error(`❌ RSS fetch error: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Calculate basic sentiment from news votes (if available)
   */
  calculateVoteSentiment(news) {
    let totalPositive = 0;
    let totalNegative = 0;
    let totalItems = 0;
    
    for (const item of news) {
      if (item.votes) {
        totalPositive += (item.votes.positive || 0) + (item.votes.liked || 0);
        totalNegative += (item.votes.negative || 0) + (item.votes.disliked || 0);
        totalItems++;
      }
    }
    
    if (totalItems === 0) return 50; // Neutral
    
    const total = totalPositive + totalNegative;
    if (total === 0) return 50;
    
    return Math.round((totalPositive / total) * 100);
  }
  
  /**
   * Get headlines for AI analysis
   */
  getHeadlinesForAnalysis(news, symbol = null) {
    let filtered = news;
    
    if (symbol) {
      // First try to find symbol-specific news
      filtered = news.filter(item => 
        item.currencies.includes(symbol) || 
        item.title.toLowerCase().includes(symbol.toLowerCase())
      );
      
      // If no symbol-specific news, use general crypto news
      if (filtered.length === 0) {
        filtered = news;
      }
    }
    
    const headlines = filtered
      .slice(0, 10)
      .map(item => item.title);
    
    console.log(`   Headlines for ${symbol || 'general'}: ${headlines.length} found`);
    
    return headlines;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// AI SENTIMENT ANALYZER (OpenAI)
// ═══════════════════════════════════════════════════════════════════════════

export class AISentimentAnalyzer {
  constructor() {
    this.openai = null;
    this.cache = new Map();
    this.cacheExpiry = SENTIMENT_CONFIG.CACHE_DURATION_MS;
    
    if (process.env.OPENAI_API_KEY) {
      // Use default configuration which picks up OPENAI_API_KEY and OPENAI_BASE_URL from env
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        // Base URL is pre-configured in environment for compatible API
      });
      console.log('🤖 OpenAI sentiment analyzer initialized');
    } else {
      console.warn('⚠️  OPENAI_API_KEY not set - AI sentiment analysis disabled');
    }
  }
  
  /**
   * Analyze sentiment of news headlines using GPT
   */
  async analyzeHeadlines(headlines, symbol = 'crypto') {
    if (!this.openai || headlines.length === 0) {
      return { score: 50, analysis: 'AI analysis unavailable', confidence: 0 };
    }
    
    // Check cache
    const cacheKey = `${symbol}_${headlines.slice(0, 5).join('_').substring(0, 100)}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.result;
    }
    
    try {
      // Format headlines as a clear list
      const headlinesList = headlines.map((h, i) => `${i + 1}. ${h}`).join('\n');
      
      const userMessage = `Here are ${symbol} cryptocurrency news headlines to analyze:

${headlinesList}

Analyze the sentiment and respond with ONLY a JSON object (no other text):
{"score": <0-100>, "analysis": "<1-2 sentences>", "keyFactors": ["factor1", "factor2"], "confidence": <0-100>}`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4.1-nano',
        messages: [
          {
            role: 'system',
            content: 'You are a crypto market sentiment analyst. Analyze the provided news headlines and respond with ONLY a valid JSON object containing score (0-100), analysis (string), keyFactors (array), and confidence (0-100). No other text.'
          },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.3,
        max_tokens: 300,
      });
      
      const content = response.choices[0].message.content;
      
      // Parse JSON response - try multiple approaches
      let result = null;
      
      // Try to find JSON in the response
      const jsonMatch = content.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        try {
          result = JSON.parse(jsonMatch[0]);
        } catch (parseError) {
          // Try to clean up the JSON
          const cleaned = jsonMatch[0]
            .replace(/[\n\r]/g, ' ')
            .replace(/,\s*}/g, '}')
            .replace(/([{,])\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
          try {
            result = JSON.parse(cleaned);
          } catch (e) {
            // Extract values manually
            const scoreMatch = content.match(/score["']?\s*[:=]\s*(\d+)/i);
            const analysisMatch = content.match(/analysis["']?\s*[:=]\s*["']([^"']+)["']/i);
            const confidenceMatch = content.match(/confidence["']?\s*[:=]\s*(\d+)/i);
            
            if (scoreMatch) {
              result = {
                score: parseInt(scoreMatch[1]),
                analysis: analysisMatch ? analysisMatch[1] : 'Analysis extracted from response',
                confidence: confidenceMatch ? parseInt(confidenceMatch[1]) : 50,
                keyFactors: []
              };
            }
          }
        }
      }
      
      if (result && typeof result.score === 'number') {
        // Ensure score is in valid range
        result.score = Math.max(0, Math.min(100, result.score));
        result.confidence = result.confidence || 50;
        
        // Cache the result
        this.cache.set(cacheKey, { result, timestamp: Date.now() });
        
        console.log(`🤖 AI Sentiment for ${symbol}: ${result.score}/100 (${result.confidence}% confidence)`);
        
        return result;
      }
      
      // Log the raw response for debugging
      console.log(`   Raw AI response for ${symbol}: ${content.substring(0, 200)}...`);
      throw new Error('Could not parse AI response');
    } catch (error) {
      console.error(`❌ AI analysis error: ${error.message}`);
      return { score: 50, analysis: 'Analysis failed', confidence: 0 };
    }
  }
  
  /**
   * Get market outlook based on multiple factors
   */
  async getMarketOutlook(fearGreedValue, newsHeadlines, symbol = 'BTC') {
    if (!this.openai) {
      return { outlook: 'neutral', reasoning: 'AI analysis unavailable' };
    }
    
    try {
      const prompt = `Given the following market data for ${symbol}:

Fear & Greed Index: ${fearGreedValue}/100 (${this.classifyFearGreed(fearGreedValue)})

Recent News Headlines:
${newsHeadlines.slice(0, 5).map((h, i) => `${i + 1}. ${h}`).join('\n')}

Provide a brief market outlook in JSON format:
{
  "outlook": "<bullish|bearish|neutral>",
  "strength": <1-5>,
  "reasoning": "<1-2 sentence explanation>",
  "riskLevel": "<low|medium|high>",
  "suggestedAction": "<accumulate|hold|reduce|avoid>"
}`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4.1-nano',
        messages: [
          {
            role: 'system',
            content: 'You are a crypto trading advisor. Provide objective, risk-aware market outlooks based on sentiment data.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 200,
      });
      
      const content = response.choices[0].message.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      
      return { outlook: 'neutral', reasoning: 'Unable to parse response' };
    } catch (error) {
      console.error(`❌ Market outlook error: ${error.message}`);
      return { outlook: 'neutral', reasoning: 'Analysis failed' };
    }
  }
  
  classifyFearGreed(value) {
    if (value <= 25) return 'Extreme Fear';
    if (value <= 40) return 'Fear';
    if (value <= 60) return 'Neutral';
    if (value <= 75) return 'Greed';
    return 'Extreme Greed';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ON-CHAIN SENTIMENT (Funding Rates, Long/Short Ratio)
// ═══════════════════════════════════════════════════════════════════════════

export class OnChainSentiment {
  constructor() {
    this.fundingRates = {};
    this.longShortRatios = {};
    this.lastUpdate = null;
  }
  
  /**
   * Fetch funding rates from Binance Futures
   * Positive = longs pay shorts (bullish sentiment)
   * Negative = shorts pay longs (bearish sentiment)
   */
  async fetchFundingRates() {
    try {
      // Binance Futures funding rate endpoint (public)
      const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
      
      for (const symbol of symbols) {
        const response = await fetch(
          `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`
        );
        const data = await response.json();
        
        if (data && data.length > 0) {
          this.fundingRates[symbol] = {
            rate: parseFloat(data[0].fundingRate),
            timestamp: new Date(data[0].fundingTime),
          };
        }
      }
      
      this.lastUpdate = new Date();
      console.log('📈 Funding rates updated');
      
      return this.fundingRates;
    } catch (error) {
      console.error(`❌ Funding rate fetch error: ${error.message}`);
      return {};
    }
  }
  
  /**
   * Fetch long/short ratio from Binance
   */
  async fetchLongShortRatio() {
    try {
      const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
      
      for (const symbol of symbols) {
        const response = await fetch(
          `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=1h&limit=1`
        );
        const data = await response.json();
        
        if (data && data.length > 0) {
          this.longShortRatios[symbol] = {
            ratio: parseFloat(data[0].longShortRatio),
            longAccount: parseFloat(data[0].longAccount),
            shortAccount: parseFloat(data[0].shortAccount),
            timestamp: new Date(data[0].timestamp),
          };
        }
      }
      
      console.log('📊 Long/Short ratios updated');
      return this.longShortRatios;
    } catch (error) {
      console.error(`❌ Long/Short ratio fetch error: ${error.message}`);
      return {};
    }
  }
  
  /**
   * Calculate on-chain sentiment score (0-100)
   */
  calculateScore(symbol = 'BTCUSDT') {
    let score = 50; // Start neutral
    
    // Funding rate contribution
    const funding = this.fundingRates[symbol];
    if (funding) {
      // Extreme positive funding (>0.1%) = overbought = bearish signal
      // Extreme negative funding (<-0.05%) = oversold = bullish signal
      const fundingPct = funding.rate * 100;
      if (fundingPct > 0.1) score -= 15;
      else if (fundingPct > 0.05) score -= 10;
      else if (fundingPct < -0.05) score += 15;
      else if (fundingPct < -0.02) score += 10;
    }
    
    // Long/Short ratio contribution
    const lsRatio = this.longShortRatios[symbol];
    if (lsRatio) {
      // High long ratio (>2.0) = crowded long = potential bearish
      // Low long ratio (<0.8) = crowded short = potential bullish
      if (lsRatio.ratio > 2.0) score -= 10;
      else if (lsRatio.ratio > 1.5) score -= 5;
      else if (lsRatio.ratio < 0.8) score += 10;
      else if (lsRatio.ratio < 1.0) score += 5;
    }
    
    return Math.max(0, Math.min(100, score));
  }
  
  /**
   * Get contrarian signal based on on-chain data
   */
  getContrarianSignal(symbol = 'BTCUSDT') {
    const score = this.calculateScore(symbol);
    
    if (score >= 70) return { signal: 'buy', reason: 'Market oversold (contrarian bullish)' };
    if (score <= 30) return { signal: 'sell', reason: 'Market overbought (contrarian bearish)' };
    return { signal: 'neutral', reason: 'No extreme positioning' };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// UNIFIED SENTIMENT AGGREGATOR
// ═══════════════════════════════════════════════════════════════════════════

export class SentimentAggregator {
  constructor(options = {}) {
    this.config = { ...SENTIMENT_CONFIG, ...options };
    
    // Initialize all sources
    this.fearGreed = new FearGreedIndex();
    this.newsAnalyzer = new CryptoNewsAnalyzer(options.cryptoPanicApiKey);
    this.aiAnalyzer = new AISentimentAnalyzer();
    this.onChain = new OnChainSentiment();
    
    // Cached composite scores
    this.compositeScores = {};
    this.lastFullUpdate = null;
    
    // Update intervals
    this.updateIntervals = [];
  }
  
  /**
   * Initialize and start automatic updates
   */
  async init() {
    console.log('\n' + '═'.repeat(60));
    console.log('  SENTIMENT ANALYZER v1.0.0');
    console.log('═'.repeat(60));
    
    // Initial fetch of all data
    await this.updateAll();
    
    console.log('✅ Sentiment Analyzer initialized');
    console.log(`   Sources: Fear & Greed, News, AI Analysis, On-Chain`);
    console.log(`   Symbols: ${this.config.SYMBOLS.join(', ')}`);
    
    return this;
  }
  
  /**
   * Update all sentiment sources
   */
  async updateAll() {
    console.log('\n📊 Updating all sentiment sources...');
    
    const results = await Promise.allSettled([
      this.fearGreed.fetch(),
      this.newsAnalyzer.fetchNews(),
      this.onChain.fetchFundingRates(),
      this.onChain.fetchLongShortRatio(),
    ]);
    
    // Get news for AI analysis
    const news = results[1].status === 'fulfilled' ? results[1].value : [];
    
    // Run AI analysis for each symbol
    for (const symbol of this.config.SYMBOLS) {
      const headlines = this.newsAnalyzer.getHeadlinesForAnalysis(news, symbol);
      if (headlines.length > 0) {
        await this.aiAnalyzer.analyzeHeadlines(headlines, symbol);
      }
    }
    
    // Calculate composite scores
    await this.calculateCompositeScores(news);
    
    this.lastFullUpdate = new Date();
    
    return this.compositeScores;
  }
  
  /**
   * Calculate composite sentiment scores for each symbol
   */
  async calculateCompositeScores(news = []) {
    const weights = this.config.SOURCE_WEIGHTS;
    
    for (const symbol of this.config.SYMBOLS) {
      // 1. Fear & Greed (market-wide)
      const fearGreedScore = this.fearGreed.getNormalizedScore();
      
      // 2. News sentiment
      const headlines = this.newsAnalyzer.getHeadlinesForAnalysis(news, symbol);
      const aiResult = await this.aiAnalyzer.analyzeHeadlines(headlines, symbol);
      const newsScore = aiResult.score;
      
      // 3. On-chain sentiment
      const onChainSymbol = `${symbol}USDT`;
      const onChainScore = this.onChain.calculateScore(onChainSymbol);
      
      // Calculate weighted composite
      const composite = Math.round(
        (fearGreedScore * weights.FEAR_GREED) +
        (newsScore * weights.NEWS_SENTIMENT) +
        (aiResult.score * weights.AI_ANALYSIS) +
        (onChainScore * weights.ONCHAIN)
      );
      
      this.compositeScores[symbol] = {
        composite,
        components: {
          fearGreed: fearGreedScore,
          news: newsScore,
          ai: aiResult.score,
          onChain: onChainScore,
        },
        aiAnalysis: aiResult.analysis,
        signal: this.getSignalFromScore(composite),
        timestamp: new Date(),
      };
    }
    
    return this.compositeScores;
  }
  
  /**
   * Get trading signal from composite score
   */
  getSignalFromScore(score) {
    if (score <= 20) return { action: 'strong_buy', confidence: 'high', reason: 'Extreme fear - accumulation opportunity' };
    if (score <= 35) return { action: 'buy', confidence: 'medium', reason: 'Fear - favorable buying conditions' };
    if (score <= 45) return { action: 'slight_buy', confidence: 'low', reason: 'Mild fear - consider small buys' };
    if (score <= 55) return { action: 'hold', confidence: 'medium', reason: 'Neutral sentiment' };
    if (score <= 65) return { action: 'slight_sell', confidence: 'low', reason: 'Mild greed - consider taking profits' };
    if (score <= 80) return { action: 'sell', confidence: 'medium', reason: 'Greed - reduce exposure' };
    return { action: 'strong_sell', confidence: 'high', reason: 'Extreme greed - high risk' };
  }
  
  /**
   * Get sentiment for a specific symbol
   */
  getSentiment(symbol = 'BTC') {
    return this.compositeScores[symbol] || null;
  }
  
  /**
   * Get all sentiment data
   */
  getAllSentiment() {
    return {
      scores: this.compositeScores,
      fearGreed: {
        value: this.fearGreed.currentValue,
        classification: this.fearGreed.classification,
        trend: this.fearGreed.calculateTrend(),
      },
      onChain: {
        fundingRates: this.onChain.fundingRates,
        longShortRatios: this.onChain.longShortRatios,
      },
      lastUpdate: this.lastFullUpdate,
    };
  }
  
  /**
   * Get position size multiplier based on sentiment
   * Returns 0.5 to 1.5 multiplier
   */
  getPositionSizeMultiplier(symbol = 'BTC') {
    const sentiment = this.compositeScores[symbol];
    if (!sentiment) return 1.0;
    
    const score = sentiment.composite;
    
    // Extreme fear = increase position size (buy the dip)
    if (score <= 25) return 1.5;
    if (score <= 40) return 1.25;
    
    // Neutral
    if (score <= 60) return 1.0;
    
    // Greed = reduce position size
    if (score <= 75) return 0.75;
    return 0.5;
  }
  
  /**
   * Get grid spacing multiplier based on sentiment
   * High fear = tighter grids (expect volatility)
   * High greed = wider grids
   */
  getGridSpacingMultiplier(symbol = 'BTC') {
    const sentiment = this.compositeScores[symbol];
    if (!sentiment) return 1.0;
    
    const score = sentiment.composite;
    
    // Extreme conditions = expect more volatility
    if (score <= 20 || score >= 80) return 0.8;
    if (score <= 35 || score >= 65) return 0.9;
    
    return 1.0;
  }
  
  /**
   * Print sentiment summary
   */
  printSummary() {
    console.log('\n' + '═'.repeat(60));
    console.log('  SENTIMENT SUMMARY');
    console.log('═'.repeat(60));
    
    console.log(`\n  Fear & Greed Index: ${this.fearGreed.currentValue} (${this.fearGreed.classification})`);
    console.log(`  Trend: ${this.fearGreed.calculateTrend()}`);
    
    console.log('\n  Composite Scores by Symbol:');
    for (const [symbol, data] of Object.entries(this.compositeScores)) {
      console.log(`\n  ${symbol}:`);
      console.log(`    Composite: ${data.composite}/100`);
      console.log(`    Signal: ${data.signal.action} (${data.signal.confidence} confidence)`);
      console.log(`    Components: FG=${data.components.fearGreed}, News=${data.components.news}, AI=${data.components.ai}, OnChain=${data.components.onChain}`);
      if (data.aiAnalysis) {
        console.log(`    AI Analysis: ${data.aiAnalysis}`);
      }
    }
    
    console.log('\n' + '═'.repeat(60));
  }
  
  /**
   * Stop automatic updates
   */
  stop() {
    for (const interval of this.updateIntervals) {
      clearInterval(interval);
    }
    this.updateIntervals = [];
    console.log('🛑 Sentiment Analyzer stopped');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════

if (import.meta.url === `file://${process.argv[1]}`) {
  const aggregator = new SentimentAggregator();
  
  await aggregator.init();
  aggregator.printSummary();
  
  // Keep running for testing
  console.log('\nPress Ctrl+C to exit...');
  
  process.on('SIGINT', () => {
    aggregator.stop();
    process.exit(0);
  });
}

export default SentimentAggregator;
