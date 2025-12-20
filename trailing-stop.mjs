#!/usr/bin/env node

/**
 * Enhanced Trailing Stop Module
 * 
 * Provides sophisticated trailing stop functionality with:
 * - Multiple trailing stop strategies (percentage, ATR-based, step-based)
 * - Configurable activation thresholds
 * - Per-bot trailing stop state management
 * - Integration with the main bot monitoring loop
 */

import { getDatabase } from './database.mjs';

const db = getDatabase();

// Trailing stop strategies
const TrailingStopStrategy = {
  PERCENTAGE: 'percentage',      // Fixed percentage trailing
  ATR_BASED: 'atr_based',        // Volatility-adjusted trailing
  STEP_BASED: 'step_based',      // Step-wise trailing (locks in profits at levels)
  CHANDELIER: 'chandelier',      // Chandelier exit (ATR from highest high)
};

// Default configuration
const DEFAULT_CONFIG = {
  strategy: TrailingStopStrategy.PERCENTAGE,
  trailingPercent: 0.05,           // 5% trailing distance
  activationPercent: 0.03,         // Activate after 3% profit
  stepSize: 0.02,                  // 2% step size for step-based
  atrMultiplier: 2.5,              // ATR multiplier for ATR-based
  minTrailingDistance: 0.02,       // Minimum 2% trailing distance
  maxTrailingDistance: 0.15,       // Maximum 15% trailing distance
  useHighWaterMark: true,          // Track highest price reached
  lockInProfitAt: [0.05, 0.10, 0.15], // Lock in profits at these levels
};

/**
 * TrailingStopManager - Manages trailing stops for all bots
 */
class TrailingStopManager {
  constructor() {
    this.botStates = new Map();
  }

  /**
   * Initialize or get trailing stop state for a bot
   */
  getState(botName) {
    if (!this.botStates.has(botName)) {
      this.botStates.set(botName, {
        isActive: false,
        entryPrice: null,
        highWaterMark: null,
        stopPrice: null,
        activatedAt: null,
        lockedProfitLevel: 0,
        config: { ...DEFAULT_CONFIG },
      });
    }
    return this.botStates.get(botName);
  }

  /**
   * Configure trailing stop for a bot
   */
  configure(botName, config) {
    const state = this.getState(botName);
    state.config = { ...DEFAULT_CONFIG, ...config };
    return state.config;
  }

  /**
   * Set entry price for a bot (call when bot starts or grid is placed)
   */
  setEntryPrice(botName, entryPrice) {
    const state = this.getState(botName);
    state.entryPrice = entryPrice;
    state.highWaterMark = entryPrice;
    state.stopPrice = null;
    state.isActive = false;
    state.lockedProfitLevel = 0;
    return state;
  }

  /**
   * Calculate trailing stop based on strategy
   */
  calculateTrailingStop(state, currentPrice, atr = null) {
    const { config, entryPrice, highWaterMark } = state;
    
    switch (config.strategy) {
      case TrailingStopStrategy.PERCENTAGE:
        return this._calculatePercentageStop(highWaterMark, config.trailingPercent);
      
      case TrailingStopStrategy.ATR_BASED:
        if (!atr) {
          // Fall back to percentage if ATR not available
          return this._calculatePercentageStop(highWaterMark, config.trailingPercent);
        }
        return this._calculateATRStop(highWaterMark, atr, config.atrMultiplier, config);
      
      case TrailingStopStrategy.STEP_BASED:
        return this._calculateStepStop(state, currentPrice, entryPrice, config);
      
      case TrailingStopStrategy.CHANDELIER:
        if (!atr) {
          return this._calculatePercentageStop(highWaterMark, config.trailingPercent);
        }
        return highWaterMark - (atr * config.atrMultiplier);
      
      default:
        return this._calculatePercentageStop(highWaterMark, config.trailingPercent);
    }
  }

  _calculatePercentageStop(highWaterMark, trailingPercent) {
    return highWaterMark * (1 - trailingPercent);
  }

  _calculateATRStop(highWaterMark, atr, multiplier, config) {
    const atrDistance = atr * multiplier;
    const percentDistance = highWaterMark * config.trailingPercent;
    
    // Use the larger of ATR-based or minimum percentage
    const trailingDistance = Math.max(
      atrDistance,
      highWaterMark * config.minTrailingDistance
    );
    
    // Cap at maximum trailing distance
    const cappedDistance = Math.min(
      trailingDistance,
      highWaterMark * config.maxTrailingDistance
    );
    
    return highWaterMark - cappedDistance;
  }

  _calculateStepStop(state, currentPrice, entryPrice, config) {
    const profitPercent = (currentPrice - entryPrice) / entryPrice;
    
    // Find the highest locked profit level
    let lockedLevel = 0;
    for (const level of config.lockInProfitAt) {
      if (profitPercent >= level) {
        lockedLevel = level;
      }
    }
    
    // Update locked profit level
    if (lockedLevel > state.lockedProfitLevel) {
      state.lockedProfitLevel = lockedLevel;
    }
    
    // Calculate stop based on locked level
    if (state.lockedProfitLevel > 0) {
      // Lock in half of the achieved profit level
      const lockedProfit = state.lockedProfitLevel * 0.5;
      return entryPrice * (1 + lockedProfit);
    }
    
    // No profit locked yet, use standard trailing
    return this._calculatePercentageStop(state.highWaterMark, config.trailingPercent);
  }

  /**
   * Update trailing stop with new price data
   * Returns: { triggered: boolean, stopPrice: number, reason: string }
   */
  update(botName, currentPrice, atr = null) {
    const state = this.getState(botName);
    
    if (!state.entryPrice) {
      return { triggered: false, stopPrice: null, reason: 'No entry price set' };
    }
    
    const { config, entryPrice } = state;
    const profitPercent = (currentPrice - entryPrice) / entryPrice;
    
    // Check if trailing stop should be activated
    if (!state.isActive && profitPercent >= config.activationPercent) {
      state.isActive = true;
      state.activatedAt = new Date().toISOString();
      state.highWaterMark = currentPrice;
      console.log(`📈 Trailing stop ACTIVATED for ${botName} at ${(profitPercent * 100).toFixed(2)}% profit`);
    }
    
    // Update high water mark if price is higher
    if (state.isActive && currentPrice > state.highWaterMark) {
      state.highWaterMark = currentPrice;
    }
    
    // Calculate stop price if active
    if (state.isActive) {
      state.stopPrice = this.calculateTrailingStop(state, currentPrice, atr);
      
      // Check if stop is triggered
      if (currentPrice <= state.stopPrice) {
        const lockedProfit = ((state.stopPrice - entryPrice) / entryPrice * 100).toFixed(2);
        return {
          triggered: true,
          stopPrice: state.stopPrice,
          reason: `Trailing stop triggered at $${state.stopPrice.toFixed(2)} (locked ${lockedProfit}% profit)`,
          profit: state.stopPrice - entryPrice,
          profitPercent: (state.stopPrice - entryPrice) / entryPrice,
        };
      }
    }
    
    return {
      triggered: false,
      stopPrice: state.stopPrice,
      isActive: state.isActive,
      highWaterMark: state.highWaterMark,
      profitPercent,
      lockedProfitLevel: state.lockedProfitLevel,
    };
  }

  /**
   * Get status report for a bot's trailing stop
   */
  getStatus(botName) {
    const state = this.getState(botName);
    
    return {
      botName,
      isActive: state.isActive,
      entryPrice: state.entryPrice,
      highWaterMark: state.highWaterMark,
      stopPrice: state.stopPrice,
      activatedAt: state.activatedAt,
      lockedProfitLevel: state.lockedProfitLevel,
      config: state.config,
    };
  }

  /**
   * Reset trailing stop for a bot
   */
  reset(botName) {
    this.botStates.delete(botName);
  }

  /**
   * Get all bot statuses
   */
  getAllStatuses() {
    const statuses = [];
    for (const [botName, state] of this.botStates) {
      statuses.push(this.getStatus(botName));
    }
    return statuses;
  }
}

// Singleton instance
const trailingStopManager = new TrailingStopManager();

/**
 * Integration helper for the main bot monitor
 * Call this in the price update loop
 */
export function checkTrailingStop(botName, currentPrice, entryPrice, atr = null, config = null) {
  // Initialize entry price if not set
  const state = trailingStopManager.getState(botName);
  if (!state.entryPrice && entryPrice) {
    trailingStopManager.setEntryPrice(botName, entryPrice);
  }
  
  // Apply custom config if provided
  if (config) {
    trailingStopManager.configure(botName, config);
  }
  
  // Update and check trailing stop
  return trailingStopManager.update(botName, currentPrice, atr);
}

/**
 * Configure trailing stop for a bot
 */
export function configureTrailingStop(botName, config) {
  return trailingStopManager.configure(botName, config);
}

/**
 * Get trailing stop status
 */
export function getTrailingStopStatus(botName) {
  return trailingStopManager.getStatus(botName);
}

/**
 * Reset trailing stop
 */
export function resetTrailingStop(botName) {
  trailingStopManager.reset(botName);
}

// Export strategy enum and manager
export { TrailingStopStrategy, TrailingStopManager, trailingStopManager };

// CLI interface for testing
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const command = args[0];
  
  switch (command) {
    case 'status':
      const botName = args[1];
      if (botName) {
        console.log(JSON.stringify(getTrailingStopStatus(botName), null, 2));
      } else {
        console.log(JSON.stringify(trailingStopManager.getAllStatuses(), null, 2));
      }
      break;
    
    case 'test':
      // Simulate trailing stop behavior
      console.log('Testing trailing stop with simulated price movement...\n');
      
      const testBot = 'test-bot';
      trailingStopManager.setEntryPrice(testBot, 100);
      
      const prices = [100, 102, 104, 106, 108, 110, 108, 106, 105, 104, 103];
      
      for (const price of prices) {
        const result = trailingStopManager.update(testBot, price);
        console.log(`Price: $${price.toFixed(2)} | Active: ${result.isActive} | Stop: $${result.stopPrice?.toFixed(2) || 'N/A'} | HWM: $${result.highWaterMark?.toFixed(2) || 'N/A'}`);
        
        if (result.triggered) {
          console.log(`\n🛑 ${result.reason}`);
          break;
        }
      }
      break;
    
    default:
      console.log(`
Enhanced Trailing Stop Module

Usage:
  node trailing-stop.mjs status [bot-name]  - Show trailing stop status
  node trailing-stop.mjs test               - Run simulation test

Strategies:
  - percentage:  Fixed percentage trailing (default 5%)
  - atr_based:   Volatility-adjusted trailing using ATR
  - step_based:  Lock in profits at predefined levels
  - chandelier:  Chandelier exit (ATR from highest high)
      `);
  }
}
