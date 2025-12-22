/**
 * Smart Order Batching Module
 * Version: 1.0.0
 * 
 * Optimizes order placement through intelligent batching:
 * - Groups multiple orders into batched operations
 * - Reduces API rate limit usage
 * - Provides faster execution during rebalancing
 * - Handles partial batch failures gracefully
 * 
 * Benefits:
 * - Fewer API calls = less rate limiting
 * - Faster grid setup and rebalancing
 * - Better error handling for bulk operations
 */

export class OrderBatcher {
  constructor(options = {}) {
    // Batch configuration
    this.maxBatchSize = options.maxBatchSize || 10;  // Max orders per batch
    this.batchDelayMs = options.batchDelayMs || 100;  // Delay between batches
    this.retryAttempts = options.retryAttempts || 3;
    this.retryDelayMs = options.retryDelayMs || 500;
    
    // Rate limiting
    this.minOrderIntervalMs = options.minOrderIntervalMs || 50;  // Min time between individual orders
    this.lastOrderTime = 0;
    
    // Statistics
    this.stats = {
      totalBatches: 0,
      totalOrders: 0,
      successfulOrders: 0,
      failedOrders: 0,
      apiCallsSaved: 0,
      avgBatchSize: 0,
      totalExecutionTime: 0,
    };
    
    // Pending orders queue
    this.pendingOrders = [];
    this.isProcessing = false;
  }

  /**
   * Queue an order for batched execution
   * @param {Object} order - Order details
   * @returns {Promise} Resolves when order is placed
   */
  queueOrder(order) {
    return new Promise((resolve, reject) => {
      this.pendingOrders.push({
        order,
        resolve,
        reject,
        timestamp: Date.now(),
      });
    });
  }

  /**
   * Place multiple orders in optimized batches
   * @param {Object} exchange - CCXT exchange instance
   * @param {Array} orders - Array of order objects
   * @param {Object} options - Execution options
   * @returns {Object} Batch execution results
   */
  async placeBatchOrders(exchange, orders, options = {}) {
    const { symbol, onProgress } = options;
    const startTime = Date.now();
    
    if (!orders || orders.length === 0) {
      return {
        success: true,
        placed: 0,
        failed: 0,
        results: [],
        executionTime: 0,
      };
    }
    
    const results = [];
    const batches = this.createBatches(orders);
    
    this.stats.totalBatches += batches.length;
    this.stats.apiCallsSaved += Math.max(0, orders.length - batches.length);
    
    let placedCount = 0;
    let failedCount = 0;
    
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      
      // Report progress
      if (onProgress) {
        onProgress({
          batch: batchIndex + 1,
          totalBatches: batches.length,
          ordersPlaced: placedCount,
          totalOrders: orders.length,
        });
      }
      
      // Process batch
      const batchResults = await this.processBatch(exchange, batch, symbol);
      
      for (const result of batchResults) {
        results.push(result);
        if (result.success) {
          placedCount++;
          this.stats.successfulOrders++;
        } else {
          failedCount++;
          this.stats.failedOrders++;
        }
      }
      
      // Delay between batches to respect rate limits
      if (batchIndex < batches.length - 1) {
        await this.delay(this.batchDelayMs);
      }
    }
    
    const executionTime = Date.now() - startTime;
    this.stats.totalOrders += orders.length;
    this.stats.totalExecutionTime += executionTime;
    this.stats.avgBatchSize = this.stats.totalOrders / Math.max(1, this.stats.totalBatches);
    
    return {
      success: failedCount === 0,
      placed: placedCount,
      failed: failedCount,
      results,
      executionTime,
      batchCount: batches.length,
      avgTimePerOrder: executionTime / orders.length,
    };
  }

  /**
   * Cancel multiple orders in optimized batches
   * @param {Object} exchange - CCXT exchange instance
   * @param {Array} orderIds - Array of order IDs to cancel
   * @param {string} symbol - Trading symbol
   * @returns {Object} Batch cancellation results
   */
  async cancelBatchOrders(exchange, orderIds, symbol) {
    const startTime = Date.now();
    
    if (!orderIds || orderIds.length === 0) {
      return {
        success: true,
        cancelled: 0,
        failed: 0,
        results: [],
        executionTime: 0,
      };
    }
    
    const results = [];
    const batches = this.createBatches(orderIds);
    
    let cancelledCount = 0;
    let failedCount = 0;
    
    for (const batch of batches) {
      const batchResults = await this.processCancelBatch(exchange, batch, symbol);
      
      for (const result of batchResults) {
        results.push(result);
        if (result.success) {
          cancelledCount++;
        } else {
          failedCount++;
        }
      }
      
      // Delay between batches
      await this.delay(this.batchDelayMs);
    }
    
    return {
      success: failedCount === 0,
      cancelled: cancelledCount,
      failed: failedCount,
      results,
      executionTime: Date.now() - startTime,
    };
  }

  /**
   * Create batches from array of items
   * @param {Array} items - Items to batch
   * @returns {Array} Array of batches
   */
  createBatches(items) {
    const batches = [];
    for (let i = 0; i < items.length; i += this.maxBatchSize) {
      batches.push(items.slice(i, i + this.maxBatchSize));
    }
    return batches;
  }

  /**
   * Process a batch of orders
   * @param {Object} exchange - CCXT exchange instance
   * @param {Array} batch - Batch of orders
   * @param {string} symbol - Trading symbol
   * @returns {Array} Results for each order
   */
  async processBatch(exchange, batch, symbol) {
    const results = [];
    
    // Check if exchange supports batch orders
    if (exchange.has['createOrders']) {
      // Use native batch order API
      try {
        const batchOrders = batch.map(order => ({
          symbol: symbol,
          type: 'limit',
          side: order.side,
          amount: order.amount,
          price: order.price,
        }));
        
        const response = await exchange.createOrders(batchOrders);
        
        for (let i = 0; i < batch.length; i++) {
          results.push({
            success: true,
            order: batch[i],
            response: response[i],
            method: 'batch',
          });
        }
        
        return results;
      } catch (error) {
        // Fall back to sequential if batch fails
        console.log(`⚠️  Batch order API failed, falling back to sequential: ${error.message}`);
      }
    }
    
    // Sequential fallback with optimized timing
    for (const order of batch) {
      const result = await this.placeOrderWithRetry(exchange, order, symbol);
      results.push(result);
      
      // Minimal delay between orders in same batch
      await this.delay(this.minOrderIntervalMs);
    }
    
    return results;
  }

  /**
   * Process a batch of cancellations
   * @param {Object} exchange - CCXT exchange instance
   * @param {Array} batch - Batch of order IDs
   * @param {string} symbol - Trading symbol
   * @returns {Array} Results for each cancellation
   */
  async processCancelBatch(exchange, batch, symbol) {
    const results = [];
    
    // Check if exchange supports batch cancellation
    if (exchange.has['cancelOrders']) {
      try {
        await exchange.cancelOrders(batch, symbol);
        
        for (const orderId of batch) {
          results.push({
            success: true,
            orderId,
            method: 'batch',
          });
        }
        
        return results;
      } catch (error) {
        // Fall back to sequential
        console.log(`⚠️  Batch cancel API failed, falling back to sequential: ${error.message}`);
      }
    }
    
    // Sequential fallback
    for (const orderId of batch) {
      try {
        await exchange.cancelOrder(orderId, symbol);
        results.push({
          success: true,
          orderId,
          method: 'sequential',
        });
      } catch (error) {
        // Order might already be filled/cancelled
        const isExpected = error.message?.includes('not found') || 
                          error.message?.includes('already') ||
                          error.message?.includes('filled');
        results.push({
          success: isExpected,  // Consider "not found" as success
          orderId,
          error: error.message,
          method: 'sequential',
        });
      }
      
      await this.delay(this.minOrderIntervalMs);
    }
    
    return results;
  }

  /**
   * Place a single order with retry logic
   * @param {Object} exchange - CCXT exchange instance
   * @param {Object} order - Order details
   * @param {string} symbol - Trading symbol
   * @returns {Object} Order result
   */
  async placeOrderWithRetry(exchange, order, symbol) {
    let lastError = null;
    
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        // Respect rate limiting
        const timeSinceLastOrder = Date.now() - this.lastOrderTime;
        if (timeSinceLastOrder < this.minOrderIntervalMs) {
          await this.delay(this.minOrderIntervalMs - timeSinceLastOrder);
        }
        
        const response = await exchange.createLimitOrder(
          symbol,
          order.side,
          order.amount,
          order.price
        );
        
        this.lastOrderTime = Date.now();
        
        return {
          success: true,
          order,
          response,
          method: 'sequential',
          attempts: attempt,
        };
        
      } catch (error) {
        lastError = error;
        
        // Don't retry certain errors
        if (this.isNonRetryableError(error)) {
          break;
        }
        
        // Wait before retry
        if (attempt < this.retryAttempts) {
          await this.delay(this.retryDelayMs * attempt);
        }
      }
    }
    
    return {
      success: false,
      order,
      error: lastError?.message || 'Unknown error',
      method: 'sequential',
      attempts: this.retryAttempts,
    };
  }

  /**
   * Check if error should not be retried
   * @param {Error} error - The error
   * @returns {boolean} True if should not retry
   */
  isNonRetryableError(error) {
    const message = error.message?.toLowerCase() || '';
    return (
      message.includes('insufficient') ||
      message.includes('balance') ||
      message.includes('minimum') ||
      message.includes('invalid') ||
      message.includes('precision')
    );
  }

  /**
   * Optimize order list for efficient execution
   * @param {Array} orders - Orders to optimize
   * @returns {Array} Optimized order list
   */
  optimizeOrderList(orders) {
    // Sort by price to minimize market impact
    // Buys: highest to lowest (fill from top of book)
    // Sells: lowest to highest (fill from bottom of book)
    
    const buys = orders.filter(o => o.side === 'buy').sort((a, b) => b.price - a.price);
    const sells = orders.filter(o => o.side === 'sell').sort((a, b) => a.price - b.price);
    
    // Interleave buys and sells for balanced execution
    const optimized = [];
    const maxLen = Math.max(buys.length, sells.length);
    
    for (let i = 0; i < maxLen; i++) {
      if (i < buys.length) optimized.push(buys[i]);
      if (i < sells.length) optimized.push(sells[i]);
    }
    
    return optimized;
  }

  /**
   * Estimate execution time for orders
   * @param {number} orderCount - Number of orders
   * @returns {Object} Time estimates
   */
  estimateExecutionTime(orderCount) {
    const batchCount = Math.ceil(orderCount / this.maxBatchSize);
    const sequentialTime = orderCount * (this.minOrderIntervalMs + 200);  // 200ms avg API response
    const batchedTime = (batchCount * this.batchDelayMs) + (orderCount * this.minOrderIntervalMs);
    
    return {
      orderCount,
      batchCount,
      estimatedMs: batchedTime,
      estimatedSeconds: batchedTime / 1000,
      sequentialMs: sequentialTime,
      timeSaved: sequentialTime - batchedTime,
      timeSavedPercent: ((sequentialTime - batchedTime) / sequentialTime) * 100,
    };
  }

  /**
   * Get batching statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.totalOrders > 0 
        ? (this.stats.successfulOrders / this.stats.totalOrders) * 100 
        : 100,
      avgExecutionTime: this.stats.totalBatches > 0
        ? this.stats.totalExecutionTime / this.stats.totalBatches
        : 0,
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalBatches: 0,
      totalOrders: 0,
      successfulOrders: 0,
      failedOrders: 0,
      apiCallsSaved: 0,
      avgBatchSize: 0,
      totalExecutionTime: 0,
    };
  }

  /**
   * Delay helper
   * @param {number} ms - Milliseconds to delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default OrderBatcher;
