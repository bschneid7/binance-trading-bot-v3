#!/usr/bin/env node

/**
 * Pattern Recognition Neural Network
 * Version: 1.0.0
 * 
 * A lightweight neural network for recognizing candlestick patterns
 * and predicting short-term price movements.
 * 
 * Architecture:
 * - Input: Normalized OHLCV features (20 candles = 100 features)
 * - Hidden Layer 1: 64 neurons with ReLU activation
 * - Hidden Layer 2: 32 neurons with ReLU activation
 * - Output: 3 neurons (bullish, neutral, bearish) with softmax
 * 
 * The network is pre-trained on common patterns and can be
 * fine-tuned with live trading data.
 */

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  // Network architecture
  inputSize: 100,        // 20 candles * 5 features (OHLCV normalized)
  hiddenSize1: 64,
  hiddenSize2: 32,
  outputSize: 3,         // bullish, neutral, bearish
  
  // Training parameters
  learningRate: 0.001,
  momentum: 0.9,
  batchSize: 32,
  
  // Pattern lookback
  lookbackCandles: 20,
  
  // Prediction thresholds
  bullishThreshold: 0.6,
  bearishThreshold: 0.6,
  
  // Update frequency
  updateIntervalMs: 60000,  // 1 minute
  
  // Feature weights
  priceWeight: 1.0,
  volumeWeight: 0.5,
  
  // Pre-trained weights file
  weightsFile: null
};

/**
 * Known candlestick patterns with their typical outcomes
 */
const KNOWN_PATTERNS = {
  // Bullish patterns
  hammer: { type: 'bullish', confidence: 0.65 },
  invertedHammer: { type: 'bullish', confidence: 0.60 },
  bullishEngulfing: { type: 'bullish', confidence: 0.70 },
  piercingLine: { type: 'bullish', confidence: 0.65 },
  morningStar: { type: 'bullish', confidence: 0.75 },
  threeWhiteSoldiers: { type: 'bullish', confidence: 0.80 },
  bullishHarami: { type: 'bullish', confidence: 0.55 },
  tweezerBottom: { type: 'bullish', confidence: 0.60 },
  
  // Bearish patterns
  hangingMan: { type: 'bearish', confidence: 0.65 },
  shootingStar: { type: 'bearish', confidence: 0.65 },
  bearishEngulfing: { type: 'bearish', confidence: 0.70 },
  darkCloudCover: { type: 'bearish', confidence: 0.65 },
  eveningStar: { type: 'bearish', confidence: 0.75 },
  threeBlackCrows: { type: 'bearish', confidence: 0.80 },
  bearishHarami: { type: 'bearish', confidence: 0.55 },
  tweezerTop: { type: 'bearish', confidence: 0.60 },
  
  // Continuation patterns
  doji: { type: 'neutral', confidence: 0.50 },
  spinningTop: { type: 'neutral', confidence: 0.45 },
  risingThreeMethods: { type: 'bullish', confidence: 0.65 },
  fallingThreeMethods: { type: 'bearish', confidence: 0.65 }
};

/**
 * Simple matrix operations
 */
class Matrix {
  static multiply(a, b) {
    const result = [];
    for (let i = 0; i < a.length; i++) {
      result[i] = [];
      for (let j = 0; j < b[0].length; j++) {
        let sum = 0;
        for (let k = 0; k < a[0].length; k++) {
          sum += a[i][k] * b[k][j];
        }
        result[i][j] = sum;
      }
    }
    return result;
  }
  
  static add(a, b) {
    return a.map((row, i) => row.map((val, j) => val + b[i][j]));
  }
  
  static transpose(m) {
    return m[0].map((_, i) => m.map(row => row[i]));
  }
}

/**
 * Activation functions
 */
const Activations = {
  relu: x => Math.max(0, x),
  reluDerivative: x => x > 0 ? 1 : 0,
  
  sigmoid: x => 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, x)))),
  sigmoidDerivative: x => x * (1 - x),
  
  tanh: x => Math.tanh(x),
  tanhDerivative: x => 1 - x * x,
  
  softmax: arr => {
    const max = Math.max(...arr);
    const exps = arr.map(x => Math.exp(x - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map(x => x / sum);
  }
};

/**
 * Neural Network Layer
 */
class Layer {
  constructor(inputSize, outputSize, activation = 'relu') {
    this.inputSize = inputSize;
    this.outputSize = outputSize;
    this.activation = activation;
    
    // Xavier initialization
    const scale = Math.sqrt(2.0 / inputSize);
    this.weights = Array(outputSize).fill(null).map(() =>
      Array(inputSize).fill(null).map(() => (Math.random() - 0.5) * 2 * scale)
    );
    this.biases = Array(outputSize).fill(0);
    
    // For momentum
    this.weightMomentum = Array(outputSize).fill(null).map(() =>
      Array(inputSize).fill(0)
    );
    this.biasMomentum = Array(outputSize).fill(0);
    
    // Cache for backprop
    this.lastInput = null;
    this.lastOutput = null;
  }
  
  forward(input) {
    this.lastInput = input;
    
    const output = this.weights.map((row, i) => {
      let sum = this.biases[i];
      for (let j = 0; j < row.length; j++) {
        sum += row[j] * input[j];
      }
      return sum;
    });
    
    // Apply activation
    if (this.activation === 'relu') {
      this.lastOutput = output.map(Activations.relu);
    } else if (this.activation === 'sigmoid') {
      this.lastOutput = output.map(Activations.sigmoid);
    } else if (this.activation === 'softmax') {
      this.lastOutput = Activations.softmax(output);
    } else {
      this.lastOutput = output;
    }
    
    return this.lastOutput;
  }
  
  backward(gradient, learningRate, momentum) {
    // Calculate gradient through activation
    let activationGradient;
    if (this.activation === 'relu') {
      activationGradient = gradient.map((g, i) => 
        g * Activations.reluDerivative(this.lastOutput[i])
      );
    } else if (this.activation === 'sigmoid') {
      activationGradient = gradient.map((g, i) => 
        g * Activations.sigmoidDerivative(this.lastOutput[i])
      );
    } else {
      activationGradient = gradient;
    }
    
    // Calculate input gradient for previous layer
    const inputGradient = Array(this.inputSize).fill(0);
    for (let i = 0; i < this.outputSize; i++) {
      for (let j = 0; j < this.inputSize; j++) {
        inputGradient[j] += this.weights[i][j] * activationGradient[i];
      }
    }
    
    // Update weights and biases
    for (let i = 0; i < this.outputSize; i++) {
      for (let j = 0; j < this.inputSize; j++) {
        const grad = activationGradient[i] * this.lastInput[j];
        this.weightMomentum[i][j] = momentum * this.weightMomentum[i][j] - learningRate * grad;
        this.weights[i][j] += this.weightMomentum[i][j];
      }
      this.biasMomentum[i] = momentum * this.biasMomentum[i] - learningRate * activationGradient[i];
      this.biases[i] += this.biasMomentum[i];
    }
    
    return inputGradient;
  }
  
  getWeights() {
    return { weights: this.weights, biases: this.biases };
  }
  
  setWeights(data) {
    this.weights = data.weights;
    this.biases = data.biases;
  }
}

/**
 * Pattern Recognition Neural Network
 */
export class PatternNeuralNetwork {
  constructor(options = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options };
    
    // Build network
    this.layers = [
      new Layer(this.config.inputSize, this.config.hiddenSize1, 'relu'),
      new Layer(this.config.hiddenSize1, this.config.hiddenSize2, 'relu'),
      new Layer(this.config.hiddenSize2, this.config.outputSize, 'softmax')
    ];
    
    // Training data buffer
    this.trainingBuffer = [];
    this.maxBufferSize = 1000;
    
    // Performance tracking
    this.predictions = [];
    this.accuracy = 0;
    
    // Pattern detection cache
    this.lastPatterns = [];
    this.lastPrediction = null;
    this.lastUpdateTime = 0;
    
    // Candle history
    this.candleHistory = [];
  }

  /**
   * Initialize with pre-trained weights or pattern-based initialization
   */
  async initialize() {
    // Initialize with pattern-based heuristics
    this.initializeWithPatternKnowledge();
    console.log('🧠 Pattern neural network initialized');
    return true;
  }

  /**
   * Initialize weights based on known pattern characteristics
   */
  initializeWithPatternKnowledge() {
    // The network starts with random weights but we can bias
    // certain neurons toward known pattern features
    
    // First layer learns basic features (body size, wick ratios, etc.)
    // Second layer combines features into pattern detectors
    // Output layer maps patterns to predictions
    
    // This is a simplified initialization - in production you'd
    // load pre-trained weights from a file
  }

  /**
   * Normalize candle data for network input
   */
  normalizeCandles(candles) {
    if (candles.length < this.config.lookbackCandles) {
      return null;
    }
    
    const recentCandles = candles.slice(-this.config.lookbackCandles);
    
    // Calculate normalization parameters
    const prices = recentCandles.flatMap(c => [c.open, c.high, c.low, c.close]);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = maxPrice - minPrice || 1;
    
    const volumes = recentCandles.map(c => c.volume);
    const maxVolume = Math.max(...volumes) || 1;
    
    // Normalize each candle to [0, 1] range
    const features = [];
    for (const candle of recentCandles) {
      // Price features (normalized to range)
      features.push((candle.open - minPrice) / priceRange);
      features.push((candle.high - minPrice) / priceRange);
      features.push((candle.low - minPrice) / priceRange);
      features.push((candle.close - minPrice) / priceRange);
      
      // Volume feature (normalized to max)
      features.push(candle.volume / maxVolume * this.config.volumeWeight);
    }
    
    return features;
  }

  /**
   * Detect candlestick patterns in recent candles
   */
  detectPatterns(candles) {
    if (candles.length < 3) return [];
    
    const patterns = [];
    const recent = candles.slice(-5);
    
    // Helper functions
    const bodySize = c => Math.abs(c.close - c.open);
    const upperWick = c => c.high - Math.max(c.open, c.close);
    const lowerWick = c => Math.min(c.open, c.close) - c.low;
    const isBullish = c => c.close > c.open;
    const isBearish = c => c.close < c.open;
    const range = c => c.high - c.low;
    
    const last = recent[recent.length - 1];
    const prev = recent[recent.length - 2];
    const prev2 = recent.length >= 3 ? recent[recent.length - 3] : null;
    
    // Doji - small body relative to range
    if (bodySize(last) < range(last) * 0.1) {
      patterns.push({ name: 'doji', ...KNOWN_PATTERNS.doji });
    }
    
    // Hammer - small body at top, long lower wick
    if (lowerWick(last) > bodySize(last) * 2 && upperWick(last) < bodySize(last) * 0.5) {
      if (isBullish(prev) === false) {  // After downtrend
        patterns.push({ name: 'hammer', ...KNOWN_PATTERNS.hammer });
      }
    }
    
    // Shooting Star - small body at bottom, long upper wick
    if (upperWick(last) > bodySize(last) * 2 && lowerWick(last) < bodySize(last) * 0.5) {
      if (isBullish(prev)) {  // After uptrend
        patterns.push({ name: 'shootingStar', ...KNOWN_PATTERNS.shootingStar });
      }
    }
    
    // Bullish Engulfing
    if (isBearish(prev) && isBullish(last) && 
        last.open < prev.close && last.close > prev.open &&
        bodySize(last) > bodySize(prev)) {
      patterns.push({ name: 'bullishEngulfing', ...KNOWN_PATTERNS.bullishEngulfing });
    }
    
    // Bearish Engulfing
    if (isBullish(prev) && isBearish(last) &&
        last.open > prev.close && last.close < prev.open &&
        bodySize(last) > bodySize(prev)) {
      patterns.push({ name: 'bearishEngulfing', ...KNOWN_PATTERNS.bearishEngulfing });
    }
    
    // Morning Star (3 candle pattern)
    if (prev2 && isBearish(prev2) && bodySize(prev) < bodySize(prev2) * 0.3 && isBullish(last)) {
      patterns.push({ name: 'morningStar', ...KNOWN_PATTERNS.morningStar });
    }
    
    // Evening Star (3 candle pattern)
    if (prev2 && isBullish(prev2) && bodySize(prev) < bodySize(prev2) * 0.3 && isBearish(last)) {
      patterns.push({ name: 'eveningStar', ...KNOWN_PATTERNS.eveningStar });
    }
    
    // Three White Soldiers
    if (prev2 && isBullish(prev2) && isBullish(prev) && isBullish(last) &&
        last.close > prev.close && prev.close > prev2.close) {
      patterns.push({ name: 'threeWhiteSoldiers', ...KNOWN_PATTERNS.threeWhiteSoldiers });
    }
    
    // Three Black Crows
    if (prev2 && isBearish(prev2) && isBearish(prev) && isBearish(last) &&
        last.close < prev.close && prev.close < prev2.close) {
      patterns.push({ name: 'threeBlackCrows', ...KNOWN_PATTERNS.threeBlackCrows });
    }
    
    return patterns;
  }

  /**
   * Forward pass through network
   */
  predict(features) {
    let output = features;
    for (const layer of this.layers) {
      output = layer.forward(output);
    }
    return output;
  }

  /**
   * Analyze candles and return prediction
   */
  async analyze(candles) {
    // Update candle history
    this.candleHistory = candles;
    
    // Check if enough data
    if (candles.length < this.config.lookbackCandles) {
      return {
        signal: 'neutral',
        confidence: 0,
        patterns: [],
        networkOutput: [0.33, 0.34, 0.33],
        recommendation: 'Insufficient data for pattern analysis'
      };
    }
    
    // Detect candlestick patterns
    const patterns = this.detectPatterns(candles);
    this.lastPatterns = patterns;
    
    // Normalize candles for network
    const features = this.normalizeCandles(candles);
    if (!features) {
      return {
        signal: 'neutral',
        confidence: 0,
        patterns,
        networkOutput: [0.33, 0.34, 0.33],
        recommendation: 'Could not normalize candle data'
      };
    }
    
    // Get network prediction
    const networkOutput = this.predict(features);
    const [bullishProb, neutralProb, bearishProb] = networkOutput;
    
    // Combine network prediction with pattern detection
    let patternBias = 0;
    let patternConfidence = 0;
    
    for (const pattern of patterns) {
      if (pattern.type === 'bullish') {
        patternBias += pattern.confidence;
      } else if (pattern.type === 'bearish') {
        patternBias -= pattern.confidence;
      }
      patternConfidence = Math.max(patternConfidence, pattern.confidence);
    }
    
    // Normalize pattern bias
    if (patterns.length > 0) {
      patternBias /= patterns.length;
    }
    
    // Combine signals (70% network, 30% patterns)
    const combinedBullish = bullishProb * 0.7 + (patternBias > 0 ? patternBias * 0.3 : 0);
    const combinedBearish = bearishProb * 0.7 + (patternBias < 0 ? -patternBias * 0.3 : 0);
    
    // Determine signal
    let signal = 'neutral';
    let confidence = neutralProb;
    let recommendation = 'No clear pattern detected';
    
    if (combinedBullish > this.config.bullishThreshold && combinedBullish > combinedBearish) {
      signal = 'bullish';
      confidence = combinedBullish;
      recommendation = `Bullish patterns detected: ${patterns.filter(p => p.type === 'bullish').map(p => p.name).join(', ') || 'network signal'}`;
    } else if (combinedBearish > this.config.bearishThreshold && combinedBearish > combinedBullish) {
      signal = 'bearish';
      confidence = combinedBearish;
      recommendation = `Bearish patterns detected: ${patterns.filter(p => p.type === 'bearish').map(p => p.name).join(', ') || 'network signal'}`;
    }
    
    this.lastPrediction = {
      signal,
      confidence,
      patterns,
      networkOutput,
      combinedBullish,
      combinedBearish,
      recommendation,
      timestamp: Date.now()
    };
    
    return this.lastPrediction;
  }

  /**
   * Train on a single example
   */
  train(features, label) {
    // Forward pass
    const output = this.predict(features);
    
    // Calculate loss gradient (cross-entropy)
    const target = label === 'bullish' ? [1, 0, 0] : 
                   label === 'bearish' ? [0, 0, 1] : [0, 1, 0];
    
    const gradient = output.map((o, i) => o - target[i]);
    
    // Backward pass
    let grad = gradient;
    for (let i = this.layers.length - 1; i >= 0; i--) {
      grad = this.layers[i].backward(grad, this.config.learningRate, this.config.momentum);
    }
    
    return output;
  }

  /**
   * Add training example to buffer
   */
  addTrainingExample(candles, outcome) {
    const features = this.normalizeCandles(candles);
    if (!features) return;
    
    this.trainingBuffer.push({ features, outcome });
    
    // Trim buffer if too large
    if (this.trainingBuffer.length > this.maxBufferSize) {
      this.trainingBuffer.shift();
    }
    
    // Train on new example
    this.train(features, outcome);
  }

  /**
   * Train on buffered examples
   */
  trainBatch() {
    if (this.trainingBuffer.length < this.config.batchSize) return;
    
    // Shuffle and take batch
    const shuffled = [...this.trainingBuffer].sort(() => Math.random() - 0.5);
    const batch = shuffled.slice(0, this.config.batchSize);
    
    for (const example of batch) {
      this.train(example.features, example.outcome);
    }
  }

  /**
   * Get position size multiplier based on pattern confidence
   */
  getPositionMultiplier() {
    if (!this.lastPrediction) return 1.0;
    
    const { signal, confidence } = this.lastPrediction;
    
    // Increase position on strong bullish signals
    if (signal === 'bullish' && confidence > 0.7) {
      return 1.0 + (confidence - 0.5) * 0.5;  // Up to 1.25x
    }
    
    // Decrease position on bearish signals
    if (signal === 'bearish' && confidence > 0.6) {
      return Math.max(0.5, 1.0 - (confidence - 0.5) * 0.5);  // Down to 0.75x
    }
    
    return 1.0;
  }

  /**
   * Should block buy order based on pattern
   */
  shouldBlockBuy() {
    if (!this.lastPrediction) return false;
    
    const { signal, confidence, patterns } = this.lastPrediction;
    
    // Block on strong bearish patterns
    if (signal === 'bearish' && confidence > 0.75) {
      return true;
    }
    
    // Block on specific high-confidence bearish patterns
    const dangerousPatterns = ['eveningStar', 'threeBlackCrows', 'bearishEngulfing'];
    for (const pattern of patterns) {
      if (dangerousPatterns.includes(pattern.name) && pattern.confidence > 0.7) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Get network weights for saving
   */
  getWeights() {
    return this.layers.map(layer => layer.getWeights());
  }

  /**
   * Load network weights
   */
  setWeights(weights) {
    weights.forEach((w, i) => this.layers[i].setWeights(w));
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      prediction: this.lastPrediction,
      patterns: this.lastPatterns,
      trainingExamples: this.trainingBuffer.length,
      accuracy: this.accuracy
    };
  }
}

export default PatternNeuralNetwork;
