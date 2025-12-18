/**
 * Grid Bot Enhancements Module
 * Version: 1.0.0
 * Safe integration with feature flags
 */

// Feature flags (easy on/off switches)
export const ENHANCEMENTS = {
  DYNAMIC_SPACING: {
    enabled: true,  // Enhancement #5
    bots: ['live-sol-bot'],  // Only SOL for testing
  },
  SMART_SIZING: {
    enabled: true,  // Enhancement #6
    bots: ['live-sol-bot'],  // Only SOL for testing
  },
  PROFIT_TAKING: {
    enabled: true,  // Enhancement #7
    threshold: 0.025,  // 2.5% profit target
    bots: ['live-sol-bot', 'live-btc-bot', 'live-eth-bot'],  // All bots
  }
};

/**
 * Enhancement #5: Dynamic Grid Spacing
 * Adjusts order size based on distance from current price
 */
export function applyDynamicSpacing(baseSize, currentPrice, levelPrice, atr = 0.02) {
  const distance = Math.abs(currentPrice - levelPrice) / currentPrice;
  
  // More aggressive sizing near current price
  const distanceFactor = Math.exp(-distance * 10); // Exponential decay
  const volatilityFactor = 1 + (atr * 10); // Higher volatility = more aggressive
  
  // Size multiplier: 1.5x near price, 0.7x at extremes
  const multiplier = 0.7 + (0.8 * distanceFactor * volatilityFactor);
  
  return baseSize * Math.max(0.5, Math.min(2.0, multiplier)); // Clamp between 0.5x and 2x
}

/**
 * Enhancement #6: Smart Order Sizing
 * Pyramid allocation: more capital where fills are likely
 */
export function applySmartSizing(baseSize, totalCapital, gridCount, currentPrice, levelPrice) {
  const distance = Math.abs(currentPrice - levelPrice) / currentPrice;
  
  // Pyramid weights: 60% near price, 30% mid-range, 10% extremes
  let weight;
  if (distance < 0.02) {
    weight = 1.5; // 50% larger near price
  } else if (distance < 0.05) {
    weight = 1.2; // 20% larger mid-range
  } else if (distance < 0.10) {
    weight = 1.0; // Normal
  } else {
    weight = 0.7; // 30% smaller at extremes
  }
  
  return baseSize * weight;
}

/**
 * Enhancement #7: Profit-Taking Logic
 * Checks if unrealized P&L exceeds threshold
 */
export function shouldTakeProfit(openOrders, currentPrices, threshold = 0.025) {
  if (openOrders.length === 0) return { action: 'HOLD', reason: 'No open orders' };
  
  let totalCost = 0;
  let totalValue = 0;
  
  for (const order of openOrders) {
    const symbol = order.symbol;
    const currentPrice = currentPrices[symbol];
    
    if (!currentPrice) continue;
    
    if (order.side === 'buy') {
      // For BUY orders: cost is order price, value is current price
      totalCost += order.price * order.amount;
      totalValue += currentPrice * order.amount;
    } else {
      // For SELL orders: already holding, cost is lower
      // This is simplified - real logic would track entry price
      totalCost += order.price * order.amount * 0.98; // Assume bought 2% lower
      totalValue += currentPrice * order.amount;
    }
  }
  
  const unrealizedPnL = totalValue - totalCost;
  const pnlPercent = totalCost > 0 ? unrealizedPnL / totalCost : 0;
  
  if (pnlPercent >= threshold) {
    return {
      action: 'CLOSE_PROFITABLE',
      reason: `P&L ${(pnlPercent * 100).toFixed(2)}% exceeds ${(threshold * 100).toFixed(2)}% threshold`,
      pnl: unrealizedPnL,
      pnlPercent
    };
  }
  
  return {
    action: 'HOLD',
    reason: `P&L ${(pnlPercent * 100).toFixed(2)}% below threshold`,
    pnl: unrealizedPnL,
    pnlPercent
  };
}

/**
 * Check if enhancement is enabled for specific bot
 */
export function isEnhancementEnabled(enhancementName, botName) {
  const enhancement = ENHANCEMENTS[enhancementName];
  if (!enhancement) return false;
  if (!enhancement.enabled) return false;
  if (!enhancement.bots || enhancement.bots.length === 0) return true;
  return enhancement.bots.includes(botName);
}

/**
 * Calculate ATR (Average True Range) for volatility
 * Simplified version using recent price data
 */
export function calculateATR(priceHistory, periods = 14) {
  if (!priceHistory || priceHistory.length < 2) return 0.02; // Default 2%
  
  let sum = 0;
  for (let i = 1; i < Math.min(periods, priceHistory.length); i++) {
    const trueRange = Math.abs(priceHistory[i] - priceHistory[i - 1]) / priceHistory[i - 1];
    sum += trueRange;
  }
  
  return sum / Math.min(periods, priceHistory.length - 1);
}

export default {
  ENHANCEMENTS,
  applyDynamicSpacing,
  applySmartSizing,
  shouldTakeProfit,
  isEnhancementEnabled,
  calculateATR
};
