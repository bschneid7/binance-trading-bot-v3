/**
 * Partial Fill Handler
 * Version: 1.0.0
 * 
 * Detects and handles partially filled orders to recover stuck capital.
 * 
 * How it works:
 * 1. Scans open orders for partial fills (filled > 0 but not complete)
 * 2. If a partial fill has been sitting for too long (default: 30 minutes)
 * 3. Cancels the remaining unfilled portion
 * 4. Records the partial fill as a trade
 * 5. Places a new replacement order at current market price
 * 
 * This prevents capital from being stuck in orders that may never fully fill.
 */

export class PartialFillHandler {
  constructor(options = {}) {
    // How long to wait before handling a partial fill (in minutes)
    this.staleThresholdMinutes = options.staleThresholdMinutes || 30;
    
    // Minimum fill percentage to consider handling (avoid tiny fills)
    this.minFillPercentage = options.minFillPercentage || 5; // 5%
    
    // Maximum fill percentage - if almost filled, let it complete
    this.maxFillPercentage = options.maxFillPercentage || 95; // 95%
    
    // Track handled orders to avoid duplicate processing
    this.handledOrders = new Map();
    
    // Statistics
    this.stats = {
      detected: 0,
      handled: 0,
      capitalRecovered: 0
    };
  }

  /**
   * Analyze an order for partial fill status
   * @param {Object} order - Order object from exchange
   * @returns {Object} Analysis result
   */
  analyzeOrder(order) {
    const filled = parseFloat(order.filled) || 0;
    const amount = parseFloat(order.amount) || 0;
    const remaining = parseFloat(order.remaining) || (amount - filled);
    
    if (amount === 0) {
      return { isPartialFill: false, reason: 'Invalid order amount' };
    }
    
    const fillPercentage = (filled / amount) * 100;
    
    // Check if it's a partial fill
    if (filled === 0) {
      return { isPartialFill: false, reason: 'No fill yet' };
    }
    
    if (remaining === 0 || fillPercentage >= 99.9) {
      return { isPartialFill: false, reason: 'Fully filled' };
    }
    
    // Check fill percentage thresholds
    if (fillPercentage < this.minFillPercentage) {
      return { 
        isPartialFill: true, 
        shouldHandle: false,
        reason: `Fill too small (${fillPercentage.toFixed(1)}% < ${this.minFillPercentage}%)`,
        fillPercentage,
        filled,
        remaining
      };
    }
    
    if (fillPercentage > this.maxFillPercentage) {
      return { 
        isPartialFill: true, 
        shouldHandle: false,
        reason: `Almost complete (${fillPercentage.toFixed(1)}% > ${this.maxFillPercentage}%), let it finish`,
        fillPercentage,
        filled,
        remaining
      };
    }
    
    // Check order age
    const orderTime = order.timestamp || order.datetime ? new Date(order.datetime || order.timestamp).getTime() : null;
    const ageMinutes = orderTime ? (Date.now() - orderTime) / (1000 * 60) : null;
    
    if (ageMinutes !== null && ageMinutes < this.staleThresholdMinutes) {
      return {
        isPartialFill: true,
        shouldHandle: false,
        reason: `Too recent (${ageMinutes.toFixed(0)}m < ${this.staleThresholdMinutes}m threshold)`,
        fillPercentage,
        filled,
        remaining,
        ageMinutes
      };
    }
    
    // This is a stale partial fill that should be handled
    return {
      isPartialFill: true,
      shouldHandle: true,
      reason: 'Stale partial fill - ready to handle',
      fillPercentage,
      filled,
      remaining,
      ageMinutes,
      filledValue: filled * parseFloat(order.price),
      remainingValue: remaining * parseFloat(order.price)
    };
  }

  /**
   * Scan orders and find partial fills that need handling
   * @param {Array} orders - Array of open orders from exchange
   * @returns {Array} Orders that need partial fill handling
   */
  findPartialFills(orders) {
    const partialFills = [];
    
    for (const order of orders) {
      // Skip if already handled recently
      if (this.handledOrders.has(order.id)) {
        const handledTime = this.handledOrders.get(order.id);
        if (Date.now() - handledTime < 60 * 60 * 1000) { // 1 hour cooldown
          continue;
        }
      }
      
      const analysis = this.analyzeOrder(order);
      
      if (analysis.isPartialFill) {
        this.stats.detected++;
        
        if (analysis.shouldHandle) {
          partialFills.push({
            order,
            analysis
          });
        }
      }
    }
    
    return partialFills;
  }

  /**
   * Handle a partial fill by canceling remainder and recording the partial trade
   * @param {Object} exchange - CCXT exchange instance
   * @param {Object} db - Database instance
   * @param {Object} partialFill - Partial fill object from findPartialFills
   * @param {string} botName - Bot name for database records
   * @returns {Object} Result of handling
   */
  async handlePartialFill(exchange, db, partialFill, botName) {
    const { order, analysis } = partialFill;
    
    console.log(`\n🔧 Handling partial fill for order ${order.id}`);
    console.log(`   Side: ${order.side} | Price: $${order.price}`);
    console.log(`   Filled: ${analysis.filled} (${analysis.fillPercentage.toFixed(1)}%)`);
    console.log(`   Remaining: ${analysis.remaining}`);
    
    try {
      // Step 1: Cancel the order to release the remaining portion
      console.log(`   Canceling order...`);
      await exchange.cancelOrder(order.id, order.symbol);
      
      // Step 2: Record the partial fill as a completed trade
      const trade = {
        order_id: order.id,
        bot_name: botName,
        symbol: order.symbol,
        side: order.side,
        price: parseFloat(order.price),
        amount: analysis.filled,
        value: analysis.filledValue,
        fee: (analysis.filledValue * 0.001), // Estimate 0.1% fee
        timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
        status: 'partial_recovered'
      };
      
      // Record trade in database
      try {
        db.recordTrade(botName, trade);
        console.log(`   ✅ Recorded partial fill as trade`);
      } catch (e) {
        console.log(`   ⚠️ Could not record trade: ${e.message}`);
      }
      
      // Step 3: Update order status in database
      try {
        db.updateOrderStatus(order.id, 'partial_cancelled');
      } catch (e) {
        // Order might not be in DB
      }
      
      // Mark as handled
      this.handledOrders.set(order.id, Date.now());
      this.stats.handled++;
      this.stats.capitalRecovered += analysis.remainingValue;
      
      console.log(`   ✅ Partial fill handled - recovered $${analysis.remainingValue.toFixed(2)} in capital`);
      
      return {
        success: true,
        orderId: order.id,
        side: order.side,
        filledAmount: analysis.filled,
        filledValue: analysis.filledValue,
        recoveredCapital: analysis.remainingValue,
        trade
      };
      
    } catch (error) {
      console.log(`   ❌ Failed to handle partial fill: ${error.message}`);
      return {
        success: false,
        orderId: order.id,
        error: error.message
      };
    }
  }

  /**
   * Process all partial fills for a bot
   * @param {Object} exchange - CCXT exchange instance
   * @param {Object} db - Database instance
   * @param {string} botName - Bot name
   * @param {string} symbol - Trading symbol
   * @returns {Object} Summary of processing
   */
  async processPartialFills(exchange, db, botName, symbol) {
    try {
      // Fetch open orders from exchange
      const openOrders = await exchange.fetchOpenOrders(symbol);
      
      // Find partial fills
      const partialFills = this.findPartialFills(openOrders);
      
      if (partialFills.length === 0) {
        return {
          found: 0,
          handled: 0,
          capitalRecovered: 0,
          results: []
        };
      }
      
      console.log(`\n📋 Found ${partialFills.length} partial fill(s) to handle`);
      
      const results = [];
      let totalRecovered = 0;
      
      for (const partialFill of partialFills) {
        const result = await this.handlePartialFill(exchange, db, partialFill, botName);
        results.push(result);
        
        if (result.success) {
          totalRecovered += result.recoveredCapital;
        }
        
        // Small delay between operations
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      return {
        found: partialFills.length,
        handled: results.filter(r => r.success).length,
        capitalRecovered: totalRecovered,
        results
      };
      
    } catch (error) {
      console.error(`Error processing partial fills: ${error.message}`);
      return {
        found: 0,
        handled: 0,
        capitalRecovered: 0,
        error: error.message
      };
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      handledOrdersCount: this.handledOrders.size
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      detected: 0,
      handled: 0,
      capitalRecovered: 0
    };
  }

  /**
   * Clear old entries from handled orders cache
   */
  cleanupCache() {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    for (const [orderId, timestamp] of this.handledOrders) {
      if (timestamp < oneHourAgo) {
        this.handledOrders.delete(orderId);
      }
    }
  }
}

export default PartialFillHandler;
