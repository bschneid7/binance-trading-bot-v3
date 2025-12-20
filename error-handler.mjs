#!/usr/bin/env node

/**
 * Grid Trading Bot - Error Handling Module
 * Version: 1.0.0
 * 
 * Provides sophisticated error handling with:
 * - Exponential backoff for retries
 * - Error classification and categorization
 * - State recovery mechanisms
 * - Email notifications for critical errors
 */

import nodemailer from 'nodemailer';
import { MONITOR_CONFIG, NOTIFICATION_CONFIG } from './config.mjs';

/**
 * Error categories for classification
 */
export const ErrorCategory = {
  NETWORK: 'network',
  API_RATE_LIMIT: 'api_rate_limit',
  API_ERROR: 'api_error',
  AUTHENTICATION: 'authentication',
  INSUFFICIENT_FUNDS: 'insufficient_funds',
  INVALID_ORDER: 'invalid_order',
  DATABASE: 'database',
  CONFIGURATION: 'configuration',
  UNKNOWN: 'unknown'
};

/**
 * Error severity levels
 */
export const ErrorSeverity = {
  LOW: 'low',         // Log only
  MEDIUM: 'medium',   // Log + retry
  HIGH: 'high',       // Log + retry + alert
  CRITICAL: 'critical' // Log + alert + pause bot
};

/**
 * Classify an error based on its message and type
 */
export function classifyError(error) {
  const message = error.message?.toLowerCase() || '';
  const name = error.name?.toLowerCase() || '';
  
  // Network errors
  if (message.includes('econnrefused') || 
      message.includes('enotfound') || 
      message.includes('etimedout') ||
      message.includes('network') ||
      message.includes('socket hang up') ||
      message.includes('connection reset')) {
    return {
      category: ErrorCategory.NETWORK,
      severity: ErrorSeverity.MEDIUM,
      retryable: true,
      message: 'Network connection error'
    };
  }
  
  // Rate limit errors
  if (message.includes('rate limit') || 
      message.includes('too many requests') ||
      message.includes('429') ||
      message.includes('ip banned')) {
    return {
      category: ErrorCategory.API_RATE_LIMIT,
      severity: ErrorSeverity.HIGH,
      retryable: true,
      message: 'API rate limit exceeded'
    };
  }
  
  // Authentication errors
  if (message.includes('invalid api') || 
      message.includes('authentication') ||
      message.includes('signature') ||
      message.includes('unauthorized') ||
      message.includes('api key')) {
    return {
      category: ErrorCategory.AUTHENTICATION,
      severity: ErrorSeverity.CRITICAL,
      retryable: false,
      message: 'Authentication failed - check API credentials'
    };
  }
  
  // Insufficient funds
  if (message.includes('insufficient') || 
      message.includes('balance') ||
      message.includes('not enough')) {
    return {
      category: ErrorCategory.INSUFFICIENT_FUNDS,
      severity: ErrorSeverity.MEDIUM,
      retryable: false,
      message: 'Insufficient funds for order'
    };
  }
  
  // Invalid order errors
  if (message.includes('invalid order') || 
      message.includes('min notional') ||
      message.includes('lot size') ||
      message.includes('price filter')) {
    return {
      category: ErrorCategory.INVALID_ORDER,
      severity: ErrorSeverity.LOW,
      retryable: false,
      message: 'Invalid order parameters'
    };
  }
  
  // Database errors
  if (message.includes('sqlite') || 
      message.includes('database') ||
      message.includes('constraint')) {
    return {
      category: ErrorCategory.DATABASE,
      severity: ErrorSeverity.HIGH,
      retryable: true,
      message: 'Database error'
    };
  }
  
  // Default unknown error
  return {
    category: ErrorCategory.UNKNOWN,
    severity: ErrorSeverity.MEDIUM,
    retryable: true,
    message: 'Unknown error occurred'
  };
}

/**
 * Calculate delay for exponential backoff
 */
export function calculateBackoffDelay(attempt, config = {}) {
  const {
    initialDelay = MONITOR_CONFIG.reconnection.initialDelay,
    maxDelay = MONITOR_CONFIG.reconnection.maxDelay,
    multiplier = MONITOR_CONFIG.reconnection.backoffMultiplier,
    jitter = true
  } = config;
  
  // Calculate base delay with exponential backoff
  let delay = initialDelay * Math.pow(multiplier, attempt - 1);
  
  // Cap at maximum delay
  delay = Math.min(delay, maxDelay);
  
  // Add jitter (±25%) to prevent thundering herd
  if (jitter) {
    const jitterFactor = 0.75 + Math.random() * 0.5;
    delay = Math.floor(delay * jitterFactor);
  }
  
  return delay;
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff(fn, options = {}) {
  const {
    maxAttempts = 3,
    initialDelay = 1000,
    maxDelay = 60000,
    multiplier = 2.0,
    onRetry = null,
    shouldRetry = null,
    context = 'operation'
  } = options;
  
  let lastError;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const classification = classifyError(error);
      
      // Check if we should retry
      const canRetry = shouldRetry 
        ? shouldRetry(error, classification, attempt)
        : classification.retryable;
      
      if (!canRetry || attempt === maxAttempts) {
        // Log final failure
        console.error(`❌ ${context} failed after ${attempt} attempt(s):`, error.message);
        throw error;
      }
      
      // Calculate delay
      const delay = calculateBackoffDelay(attempt, { initialDelay, maxDelay, multiplier });
      
      // Log retry attempt
      console.warn(`⚠️ ${context} failed (attempt ${attempt}/${maxAttempts}): ${error.message}`);
      console.warn(`   Retrying in ${(delay / 1000).toFixed(1)}s...`);
      
      // Call onRetry callback if provided
      if (onRetry) {
        await onRetry(error, attempt, delay);
      }
      
      // Wait before retrying
      await sleep(delay);
    }
  }
  
  throw lastError;
}

/**
 * Error logger with structured output
 */
export class ErrorLogger {
  constructor(options = {}) {
    this.errors = [];
    this.maxErrors = options.maxErrors || 1000;
    this.notifyOnCritical = options.notifyOnCritical ?? true;
  }
  
  /**
   * Log an error with classification
   */
  log(error, context = {}) {
    const classification = classifyError(error);
    const timestamp = new Date().toISOString();
    
    const entry = {
      timestamp,
      message: error.message,
      stack: error.stack,
      classification,
      context,
      resolved: false
    };
    
    // Add to error list
    this.errors.push(entry);
    
    // Trim if exceeds max
    if (this.errors.length > this.maxErrors) {
      this.errors = this.errors.slice(-this.maxErrors);
    }
    
    // Console output based on severity
    const prefix = this.getSeverityPrefix(classification.severity);
    console.error(`${prefix} [${timestamp}] ${classification.message}`);
    console.error(`   Category: ${classification.category}`);
    console.error(`   Details: ${error.message}`);
    if (context.botName) {
      console.error(`   Bot: ${context.botName}`);
    }
    
    // Send notification for critical errors
    if (classification.severity === ErrorSeverity.CRITICAL && this.notifyOnCritical) {
      this.sendCriticalAlert(entry).catch(e => {
        console.error('Failed to send critical alert:', e.message);
      });
    }
    
    return entry;
  }
  
  /**
   * Get severity prefix for console output
   */
  getSeverityPrefix(severity) {
    switch (severity) {
      case ErrorSeverity.LOW: return '⚪';
      case ErrorSeverity.MEDIUM: return '🟡';
      case ErrorSeverity.HIGH: return '🟠';
      case ErrorSeverity.CRITICAL: return '🔴';
      default: return '⚪';
    }
  }
  
  /**
   * Send email alert for critical errors
   */
  async sendCriticalAlert(errorEntry) {
    if (!NOTIFICATION_CONFIG.email.appPassword) {
      console.warn('Email notifications not configured - skipping critical alert');
      return;
    }
    
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: NOTIFICATION_CONFIG.email.sender,
        pass: NOTIFICATION_CONFIG.email.appPassword
      }
    });
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #ef4444; color: white; padding: 20px; text-align: center;">
          <h1 style="margin: 0;">🚨 Critical Error Alert</h1>
        </div>
        <div style="padding: 20px; background: #fef2f2; border: 1px solid #fecaca;">
          <p><strong>Time:</strong> ${errorEntry.timestamp}</p>
          <p><strong>Category:</strong> ${errorEntry.classification.category}</p>
          <p><strong>Message:</strong> ${errorEntry.classification.message}</p>
          <p><strong>Details:</strong> ${errorEntry.message}</p>
          ${errorEntry.context.botName ? `<p><strong>Bot:</strong> ${errorEntry.context.botName}</p>` : ''}
          <hr style="border: none; border-top: 1px solid #fecaca; margin: 20px 0;">
          <p style="color: #991b1b; font-weight: bold;">Action Required: Please check your trading bot immediately.</p>
        </div>
        <div style="padding: 10px; text-align: center; color: #6b7280; font-size: 12px;">
          Grid Trading Bot v5.1.0
        </div>
      </div>
    `;
    
    await transporter.sendMail({
      from: `"Grid Bot Alert" <${NOTIFICATION_CONFIG.email.sender}>`,
      to: NOTIFICATION_CONFIG.email.recipient,
      subject: `🚨 CRITICAL: Grid Bot Error - ${errorEntry.classification.category}`,
      html
    });
    
    console.log('📧 Critical alert email sent');
  }
  
  /**
   * Get recent errors
   */
  getRecent(count = 10) {
    return this.errors.slice(-count);
  }
  
  /**
   * Get errors by category
   */
  getByCategory(category) {
    return this.errors.filter(e => e.classification.category === category);
  }
  
  /**
   * Get error statistics
   */
  getStats() {
    const stats = {
      total: this.errors.length,
      byCategory: {},
      bySeverity: {},
      last24Hours: 0
    };
    
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    
    for (const error of this.errors) {
      // Count by category
      const cat = error.classification.category;
      stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1;
      
      // Count by severity
      const sev = error.classification.severity;
      stats.bySeverity[sev] = (stats.bySeverity[sev] || 0) + 1;
      
      // Count last 24 hours
      if (new Date(error.timestamp).getTime() > oneDayAgo) {
        stats.last24Hours++;
      }
    }
    
    return stats;
  }
  
  /**
   * Clear all errors
   */
  clear() {
    this.errors = [];
  }
}

/**
 * Circuit breaker for preventing cascading failures
 */
export class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 60000; // 1 minute
    this.halfOpenRequests = options.halfOpenRequests || 1;
    
    this.state = 'closed'; // closed, open, half-open
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = null;
    this.halfOpenAttempts = 0;
  }
  
  /**
   * Execute a function through the circuit breaker
   */
  async execute(fn) {
    // Check if circuit should be reset
    if (this.state === 'open') {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure >= this.resetTimeout) {
        this.state = 'half-open';
        this.halfOpenAttempts = 0;
        console.log('🔄 Circuit breaker entering half-open state');
      } else {
        throw new Error(`Circuit breaker is open. Retry in ${Math.ceil((this.resetTimeout - timeSinceFailure) / 1000)}s`);
      }
    }
    
    // Check half-open limit
    if (this.state === 'half-open' && this.halfOpenAttempts >= this.halfOpenRequests) {
      throw new Error('Circuit breaker half-open limit reached');
    }
    
    try {
      if (this.state === 'half-open') {
        this.halfOpenAttempts++;
      }
      
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  /**
   * Handle successful execution
   */
  onSuccess() {
    if (this.state === 'half-open') {
      this.state = 'closed';
      this.failures = 0;
      console.log('✅ Circuit breaker closed - service recovered');
    }
    this.successes++;
  }
  
  /**
   * Handle failed execution
   */
  onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.state === 'half-open') {
      this.state = 'open';
      console.log('🔴 Circuit breaker reopened - service still failing');
    } else if (this.failures >= this.failureThreshold) {
      this.state = 'open';
      console.log(`🔴 Circuit breaker opened after ${this.failures} failures`);
    }
  }
  
  /**
   * Get circuit breaker status
   */
  getStatus() {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime
    };
  }
  
  /**
   * Manually reset the circuit breaker
   */
  reset() {
    this.state = 'closed';
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = null;
    this.halfOpenAttempts = 0;
  }
}

// Create singleton instances
export const errorLogger = new ErrorLogger();
export const apiCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 60000
});

export default {
  ErrorCategory,
  ErrorSeverity,
  classifyError,
  calculateBackoffDelay,
  sleep,
  retryWithBackoff,
  ErrorLogger,
  CircuitBreaker,
  errorLogger,
  apiCircuitBreaker
};
