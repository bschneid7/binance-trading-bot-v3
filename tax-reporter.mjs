/**
 * Tax Reporter Module
 * Tracks cost basis, calculates capital gains, and generates tax reports
 * Supports FIFO, LIFO, and Specific ID accounting methods
 * Generates Form 8949 compatible CSV exports
 */

import fs from 'fs';
import path from 'path';

// Tax configuration
const TAX_CONFIG = {
  // Default accounting method (FIFO is most common)
  DEFAULT_METHOD: 'FIFO',
  
  // Short-term vs Long-term threshold (in milliseconds)
  // 1 year = 365 days * 24 hours * 60 minutes * 60 seconds * 1000 ms
  LONG_TERM_THRESHOLD_MS: 365 * 24 * 60 * 60 * 1000,
  
  // Tax rates (2024 estimates - user should verify with tax professional)
  SHORT_TERM_RATE: 0.37,  // Ordinary income rate (varies by bracket)
  LONG_TERM_RATE: 0.20,   // Long-term capital gains rate (varies by bracket)
  
  // Wash sale window (31 days before and after)
  WASH_SALE_WINDOW_MS: 31 * 24 * 60 * 60 * 1000,
};

/**
 * Tax Lot - represents a purchase of crypto
 */
class TaxLot {
  constructor(data) {
    this.id = data.id || `lot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.symbol = data.symbol;           // e.g., 'BTC'
    this.acquiredDate = new Date(data.acquiredDate);
    this.quantity = parseFloat(data.quantity);
    this.costBasis = parseFloat(data.costBasis);  // Total cost including fees
    this.costPerUnit = this.costBasis / this.quantity;
    this.remainingQuantity = parseFloat(data.remainingQuantity ?? data.quantity);
    this.source = data.source || 'trade';  // 'trade', 'transfer', 'airdrop', etc.
    this.orderId = data.orderId;
    this.botName = data.botName;
  }
  
  /**
   * Check if this lot qualifies for long-term capital gains
   */
  isLongTerm(saleDate) {
    const holdingPeriod = new Date(saleDate) - this.acquiredDate;
    return holdingPeriod > TAX_CONFIG.LONG_TERM_THRESHOLD_MS;
  }
  
  /**
   * Get holding period in days
   */
  getHoldingDays(saleDate) {
    const holdingPeriod = new Date(saleDate) - this.acquiredDate;
    return Math.floor(holdingPeriod / (24 * 60 * 60 * 1000));
  }
  
  /**
   * Consume quantity from this lot for a sale
   */
  consume(quantity) {
    const consumed = Math.min(quantity, this.remainingQuantity);
    this.remainingQuantity -= consumed;
    return {
      quantity: consumed,
      costBasis: consumed * this.costPerUnit,
      acquiredDate: this.acquiredDate,
      lotId: this.id,
    };
  }
  
  /**
   * Check if lot is fully consumed
   */
  isExhausted() {
    return this.remainingQuantity <= 0.00000001; // Account for floating point
  }
  
  toJSON() {
    return {
      id: this.id,
      symbol: this.symbol,
      acquiredDate: this.acquiredDate.toISOString(),
      quantity: this.quantity,
      costBasis: this.costBasis,
      costPerUnit: this.costPerUnit,
      remainingQuantity: this.remainingQuantity,
      source: this.source,
      orderId: this.orderId,
      botName: this.botName,
    };
  }
}

/**
 * Taxable Event - represents a sale or disposal of crypto
 */
class TaxableEvent {
  constructor(data) {
    this.id = data.id || `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.symbol = data.symbol;
    this.saleDate = new Date(data.saleDate);
    this.quantity = parseFloat(data.quantity);
    this.proceeds = parseFloat(data.proceeds);  // Total proceeds minus fees
    this.costBasis = parseFloat(data.costBasis);
    this.gainLoss = this.proceeds - this.costBasis;
    this.isLongTerm = data.isLongTerm;
    this.holdingDays = data.holdingDays;
    this.acquiredDate = new Date(data.acquiredDate);
    this.lotId = data.lotId;
    this.orderId = data.orderId;
    this.botName = data.botName;
    this.washSale = data.washSale || false;
    this.washSaleDisallowed = data.washSaleDisallowed || 0;
  }
  
  /**
   * Get Form 8949 category
   * A = Short-term with basis reported to IRS
   * B = Short-term without basis reported
   * C = Short-term not reported to IRS
   * D = Long-term with basis reported to IRS
   * E = Long-term without basis reported
   * F = Long-term not reported to IRS
   */
  getForm8949Category() {
    // Crypto is typically not reported to IRS by exchanges (Category C or F)
    return this.isLongTerm ? 'F' : 'C';
  }
  
  toJSON() {
    return {
      id: this.id,
      symbol: this.symbol,
      saleDate: this.saleDate.toISOString(),
      acquiredDate: this.acquiredDate.toISOString(),
      quantity: this.quantity,
      proceeds: this.proceeds,
      costBasis: this.costBasis,
      gainLoss: this.gainLoss,
      isLongTerm: this.isLongTerm,
      holdingDays: this.holdingDays,
      lotId: this.lotId,
      orderId: this.orderId,
      botName: this.botName,
      washSale: this.washSale,
      washSaleDisallowed: this.washSaleDisallowed,
      form8949Category: this.getForm8949Category(),
    };
  }
}

/**
 * Tax Reporter - main class for tax tracking and reporting
 */
export class TaxReporter {
  constructor(db, options = {}) {
    this.db = db;
    this.method = options.method || TAX_CONFIG.DEFAULT_METHOD;
    this.lots = new Map();  // symbol -> TaxLot[]
    this.events = [];       // TaxableEvent[]
    this.initialized = false;
  }
  
  /**
   * Initialize tax reporter - load existing lots from database
   */
  async init() {
    // Load existing tax lots from database
    const savedLots = this.db.getTaxLots?.() || [];
    for (const lotData of savedLots) {
      const lot = new TaxLot(lotData);
      if (!lot.isExhausted()) {
        this.addLotToMemory(lot);
      }
    }
    
    // Load existing taxable events
    const savedEvents = this.db.getTaxEvents?.() || [];
    this.events = savedEvents.map(e => new TaxableEvent(e));
    
    this.initialized = true;
    console.log(`📊 Tax reporter initialized (${this.method} method)`);
    console.log(`   ${this.getTotalLots()} active lots, ${this.events.length} taxable events`);
  }
  
  /**
   * Add a lot to memory storage
   */
  addLotToMemory(lot) {
    if (!this.lots.has(lot.symbol)) {
      this.lots.set(lot.symbol, []);
    }
    this.lots.get(lot.symbol).push(lot);
  }
  
  /**
   * Get total number of active lots
   */
  getTotalLots() {
    let total = 0;
    for (const lots of this.lots.values()) {
      total += lots.filter(l => !l.isExhausted()).length;
    }
    return total;
  }
  
  /**
   * Record a purchase (creates a new tax lot)
   */
  recordPurchase(data) {
    const lot = new TaxLot({
      symbol: data.symbol,
      acquiredDate: data.date || new Date(),
      quantity: data.quantity,
      costBasis: data.totalCost,  // Price * quantity + fees
      source: 'trade',
      orderId: data.orderId,
      botName: data.botName,
    });
    
    this.addLotToMemory(lot);
    
    // Save to database
    if (this.db.saveTaxLot) {
      this.db.saveTaxLot(lot.toJSON());
    }
    
    return lot;
  }
  
  /**
   * Record a sale (creates taxable event, consumes lots based on method)
   */
  recordSale(data) {
    const symbol = data.symbol;
    const quantity = parseFloat(data.quantity);
    const proceeds = parseFloat(data.totalProceeds);  // Price * quantity - fees
    const saleDate = data.date || new Date();
    
    // Get lots for this symbol
    const symbolLots = this.lots.get(symbol) || [];
    if (symbolLots.length === 0) {
      console.warn(`⚠️  No tax lots found for ${symbol} - cannot calculate cost basis`);
      return null;
    }
    
    // Sort lots based on accounting method
    const sortedLots = this.sortLotsByMethod(symbolLots, this.method);
    
    // Consume lots to cover the sale quantity
    let remainingQuantity = quantity;
    const consumedLots = [];
    
    for (const lot of sortedLots) {
      if (remainingQuantity <= 0) break;
      if (lot.isExhausted()) continue;
      
      const consumed = lot.consume(remainingQuantity);
      consumedLots.push({
        ...consumed,
        isLongTerm: lot.isLongTerm(saleDate),
        holdingDays: lot.getHoldingDays(saleDate),
      });
      remainingQuantity -= consumed.quantity;
      
      // Update lot in database
      if (this.db.updateTaxLot) {
        this.db.updateTaxLot(lot.toJSON());
      }
    }
    
    if (remainingQuantity > 0.00000001) {
      console.warn(`⚠️  Insufficient lots to cover sale of ${quantity} ${symbol}`);
      console.warn(`   Missing: ${remainingQuantity} ${symbol}`);
    }
    
    // Create taxable events for each consumed lot
    const events = [];
    for (const consumed of consumedLots) {
      const proportionalProceeds = (consumed.quantity / quantity) * proceeds;
      
      const event = new TaxableEvent({
        symbol,
        saleDate,
        quantity: consumed.quantity,
        proceeds: proportionalProceeds,
        costBasis: consumed.costBasis,
        isLongTerm: consumed.isLongTerm,
        holdingDays: consumed.holdingDays,
        acquiredDate: consumed.acquiredDate,
        lotId: consumed.lotId,
        orderId: data.orderId,
        botName: data.botName,
      });
      
      events.push(event);
      this.events.push(event);
      
      // Save to database
      if (this.db.saveTaxEvent) {
        this.db.saveTaxEvent(event.toJSON());
      }
    }
    
    return events;
  }
  
  /**
   * Sort lots based on accounting method
   */
  sortLotsByMethod(lots, method) {
    const activeLots = lots.filter(l => !l.isExhausted());
    
    switch (method) {
      case 'FIFO':
        // First In, First Out - oldest lots first
        return activeLots.sort((a, b) => a.acquiredDate - b.acquiredDate);
        
      case 'LIFO':
        // Last In, First Out - newest lots first
        return activeLots.sort((a, b) => b.acquiredDate - a.acquiredDate);
        
      case 'HIFO':
        // Highest In, First Out - highest cost basis first (minimizes gains)
        return activeLots.sort((a, b) => b.costPerUnit - a.costPerUnit);
        
      case 'LOFO':
        // Lowest In, First Out - lowest cost basis first (maximizes gains)
        return activeLots.sort((a, b) => a.costPerUnit - b.costPerUnit);
        
      default:
        return activeLots.sort((a, b) => a.acquiredDate - b.acquiredDate);
    }
  }
  
  /**
   * Process historical trades from database
   */
  async processHistoricalTrades(startDate = null, endDate = null) {
    console.log('📊 Processing historical trades for tax reporting...');
    
    // Get all trades from database
    const trades = this.db.getAllTrades?.() || [];
    
    // Filter by date range if specified
    let filteredTrades = trades;
    if (startDate) {
      filteredTrades = filteredTrades.filter(t => new Date(t.filled_at) >= new Date(startDate));
    }
    if (endDate) {
      filteredTrades = filteredTrades.filter(t => new Date(t.filled_at) <= new Date(endDate));
    }
    
    // Sort by date
    filteredTrades.sort((a, b) => new Date(a.filled_at) - new Date(b.filled_at));
    
    console.log(`   Found ${filteredTrades.length} trades to process`);
    
    let purchases = 0;
    let sales = 0;
    
    for (const trade of filteredTrades) {
      const symbol = trade.symbol.split('/')[0];  // 'BTC/USD' -> 'BTC'
      const quantity = parseFloat(trade.filled_amount || trade.amount);
      const price = parseFloat(trade.filled_price || trade.price);
      const fee = parseFloat(trade.fee || 0);
      
      if (trade.side === 'buy') {
        // Purchase - create tax lot
        this.recordPurchase({
          symbol,
          date: trade.filled_at,
          quantity,
          totalCost: (price * quantity) + fee,
          orderId: trade.id,
          botName: trade.bot_name,
        });
        purchases++;
      } else {
        // Sale - create taxable event
        this.recordSale({
          symbol,
          date: trade.filled_at,
          quantity,
          totalProceeds: (price * quantity) - fee,
          orderId: trade.id,
          botName: trade.bot_name,
        });
        sales++;
      }
    }
    
    console.log(`   Processed ${purchases} purchases, ${sales} sales`);
    return { purchases, sales };
  }
  
  /**
   * Get capital gains summary for a tax year
   */
  getCapitalGainsSummary(year) {
    const yearStart = new Date(`${year}-01-01T00:00:00Z`);
    const yearEnd = new Date(`${year}-12-31T23:59:59Z`);
    
    const yearEvents = this.events.filter(e => 
      e.saleDate >= yearStart && e.saleDate <= yearEnd
    );
    
    const summary = {
      year,
      totalTransactions: yearEvents.length,
      
      shortTerm: {
        transactions: 0,
        proceeds: 0,
        costBasis: 0,
        gains: 0,
        losses: 0,
        netGainLoss: 0,
      },
      
      longTerm: {
        transactions: 0,
        proceeds: 0,
        costBasis: 0,
        gains: 0,
        losses: 0,
        netGainLoss: 0,
      },
      
      total: {
        proceeds: 0,
        costBasis: 0,
        netGainLoss: 0,
      },
      
      bySymbol: {},
      byBot: {},
    };
    
    for (const event of yearEvents) {
      const category = event.isLongTerm ? summary.longTerm : summary.shortTerm;
      
      category.transactions++;
      category.proceeds += event.proceeds;
      category.costBasis += event.costBasis;
      
      if (event.gainLoss >= 0) {
        category.gains += event.gainLoss;
      } else {
        category.losses += Math.abs(event.gainLoss);
      }
      category.netGainLoss += event.gainLoss;
      
      // By symbol
      if (!summary.bySymbol[event.symbol]) {
        summary.bySymbol[event.symbol] = { transactions: 0, netGainLoss: 0 };
      }
      summary.bySymbol[event.symbol].transactions++;
      summary.bySymbol[event.symbol].netGainLoss += event.gainLoss;
      
      // By bot
      if (event.botName) {
        if (!summary.byBot[event.botName]) {
          summary.byBot[event.botName] = { transactions: 0, netGainLoss: 0 };
        }
        summary.byBot[event.botName].transactions++;
        summary.byBot[event.botName].netGainLoss += event.gainLoss;
      }
    }
    
    // Calculate totals
    summary.total.proceeds = summary.shortTerm.proceeds + summary.longTerm.proceeds;
    summary.total.costBasis = summary.shortTerm.costBasis + summary.longTerm.costBasis;
    summary.total.netGainLoss = summary.shortTerm.netGainLoss + summary.longTerm.netGainLoss;
    
    return summary;
  }
  
  /**
   * Generate Form 8949 compatible CSV
   */
  generateForm8949CSV(year, outputPath) {
    const yearStart = new Date(`${year}-01-01T00:00:00Z`);
    const yearEnd = new Date(`${year}-12-31T23:59:59Z`);
    
    const yearEvents = this.events.filter(e => 
      e.saleDate >= yearStart && e.saleDate <= yearEnd
    );
    
    // Sort by date
    yearEvents.sort((a, b) => a.saleDate - b.saleDate);
    
    // CSV header matching Form 8949 columns
    const headers = [
      'Description of Property',
      'Date Acquired',
      'Date Sold',
      'Proceeds',
      'Cost Basis',
      'Adjustment Code',
      'Adjustment Amount',
      'Gain or Loss',
      'Term',
      'Category',
    ];
    
    const rows = [headers.join(',')];
    
    for (const event of yearEvents) {
      const row = [
        `${event.quantity.toFixed(8)} ${event.symbol}`,
        event.acquiredDate.toLocaleDateString('en-US'),
        event.saleDate.toLocaleDateString('en-US'),
        event.proceeds.toFixed(2),
        event.costBasis.toFixed(2),
        event.washSale ? 'W' : '',
        event.washSaleDisallowed > 0 ? event.washSaleDisallowed.toFixed(2) : '',
        event.gainLoss.toFixed(2),
        event.isLongTerm ? 'Long-term' : 'Short-term',
        event.getForm8949Category(),
      ];
      rows.push(row.map(v => `"${v}"`).join(','));
    }
    
    const csv = rows.join('\n');
    fs.writeFileSync(outputPath, csv);
    
    console.log(`📄 Form 8949 CSV exported to: ${outputPath}`);
    console.log(`   ${yearEvents.length} transactions for tax year ${year}`);
    
    return outputPath;
  }
  
  /**
   * Generate detailed tax report
   */
  generateTaxReport(year, outputPath) {
    const summary = this.getCapitalGainsSummary(year);
    
    let report = `
════════════════════════════════════════════════════════════
       CRYPTOCURRENCY TAX REPORT - ${year}
════════════════════════════════════════════════════════════
Generated: ${new Date().toISOString()}
Accounting Method: ${this.method}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  CAPITAL GAINS SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SHORT-TERM CAPITAL GAINS (held < 1 year):
   Transactions: ${summary.shortTerm.transactions}
   Total Proceeds: $${summary.shortTerm.proceeds.toFixed(2)}
   Total Cost Basis: $${summary.shortTerm.costBasis.toFixed(2)}
   Gains: $${summary.shortTerm.gains.toFixed(2)}
   Losses: $${summary.shortTerm.losses.toFixed(2)}
   Net Short-Term: $${summary.shortTerm.netGainLoss.toFixed(2)}

LONG-TERM CAPITAL GAINS (held > 1 year):
   Transactions: ${summary.longTerm.transactions}
   Total Proceeds: $${summary.longTerm.proceeds.toFixed(2)}
   Total Cost Basis: $${summary.longTerm.costBasis.toFixed(2)}
   Gains: $${summary.longTerm.gains.toFixed(2)}
   Losses: $${summary.longTerm.losses.toFixed(2)}
   Net Long-Term: $${summary.longTerm.netGainLoss.toFixed(2)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  TOTALS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   Total Transactions: ${summary.totalTransactions}
   Total Proceeds: $${summary.total.proceeds.toFixed(2)}
   Total Cost Basis: $${summary.total.costBasis.toFixed(2)}
   
   ════════════════════════════════════════
   NET CAPITAL GAIN/LOSS: $${summary.total.netGainLoss.toFixed(2)}
   ════════════════════════════════════════

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  BREAKDOWN BY CRYPTOCURRENCY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    
    for (const [symbol, data] of Object.entries(summary.bySymbol)) {
      report += `
   ${symbol}:
      Transactions: ${data.transactions}
      Net Gain/Loss: $${data.netGainLoss.toFixed(2)}
`;
    }
    
    report += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  BREAKDOWN BY BOT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    
    for (const [botName, data] of Object.entries(summary.byBot)) {
      report += `
   ${botName}:
      Transactions: ${data.transactions}
      Net Gain/Loss: $${data.netGainLoss.toFixed(2)}
`;
    }
    
    report += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  TAX FILING NOTES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. This report uses the ${this.method} accounting method.
2. Short-term gains are taxed as ordinary income.
3. Long-term gains are taxed at preferential rates (0%, 15%, or 20%).
4. Cryptocurrency transactions should be reported on:
   - Form 8949 (Sales and Dispositions of Capital Assets)
   - Schedule D (Capital Gains and Losses)
5. Consult a tax professional for personalized advice.

════════════════════════════════════════════════════════════
       DISCLAIMER
════════════════════════════════════════════════════════════

This report is provided for informational purposes only and
should not be considered tax advice. Please consult with a
qualified tax professional for your specific situation.

════════════════════════════════════════════════════════════
`;
    
    fs.writeFileSync(outputPath, report);
    
    console.log(`📄 Tax report exported to: ${outputPath}`);
    
    return outputPath;
  }
  
  /**
   * Generate CSV export for tax software (TurboTax, TaxAct, etc.)
   */
  generateTaxSoftwareCSV(year, outputPath, format = 'turbotax') {
    const yearStart = new Date(`${year}-01-01T00:00:00Z`);
    const yearEnd = new Date(`${year}-12-31T23:59:59Z`);
    
    const yearEvents = this.events.filter(e => 
      e.saleDate >= yearStart && e.saleDate <= yearEnd
    );
    
    yearEvents.sort((a, b) => a.saleDate - b.saleDate);
    
    let headers, formatRow;
    
    switch (format.toLowerCase()) {
      case 'turbotax':
        headers = [
          'Currency Name',
          'Purchase Date',
          'Cost Basis',
          'Date Sold',
          'Proceeds',
        ];
        formatRow = (event) => [
          event.symbol,
          event.acquiredDate.toLocaleDateString('en-US'),
          event.costBasis.toFixed(2),
          event.saleDate.toLocaleDateString('en-US'),
          event.proceeds.toFixed(2),
        ];
        break;
        
      case 'taxact':
        headers = [
          'Description',
          'Date Acquired',
          'Date Sold',
          'Sales Price',
          'Cost',
          'Short/Long',
        ];
        formatRow = (event) => [
          `${event.quantity.toFixed(8)} ${event.symbol}`,
          event.acquiredDate.toLocaleDateString('en-US'),
          event.saleDate.toLocaleDateString('en-US'),
          event.proceeds.toFixed(2),
          event.costBasis.toFixed(2),
          event.isLongTerm ? 'L' : 'S',
        ];
        break;
        
      case 'cointracker':
        headers = [
          'Date',
          'Type',
          'Asset',
          'Amount',
          'Price',
          'Fee',
          'Total',
        ];
        formatRow = (event) => [
          event.saleDate.toISOString(),
          'sell',
          event.symbol,
          event.quantity.toFixed(8),
          (event.proceeds / event.quantity).toFixed(2),
          '0',
          event.proceeds.toFixed(2),
        ];
        break;
        
      default:
        // Generic format
        headers = [
          'Symbol',
          'Quantity',
          'Acquired Date',
          'Sold Date',
          'Cost Basis',
          'Proceeds',
          'Gain/Loss',
          'Term',
        ];
        formatRow = (event) => [
          event.symbol,
          event.quantity.toFixed(8),
          event.acquiredDate.toLocaleDateString('en-US'),
          event.saleDate.toLocaleDateString('en-US'),
          event.costBasis.toFixed(2),
          event.proceeds.toFixed(2),
          event.gainLoss.toFixed(2),
          event.isLongTerm ? 'Long' : 'Short',
        ];
    }
    
    const rows = [headers.join(',')];
    for (const event of yearEvents) {
      rows.push(formatRow(event).map(v => `"${v}"`).join(','));
    }
    
    const csv = rows.join('\n');
    fs.writeFileSync(outputPath, csv);
    
    console.log(`📄 ${format} CSV exported to: ${outputPath}`);
    console.log(`   ${yearEvents.length} transactions for tax year ${year}`);
    
    return outputPath;
  }
  
  /**
   * Get current holdings with cost basis
   */
  getCurrentHoldings() {
    const holdings = {};
    
    for (const [symbol, lots] of this.lots) {
      const activeLots = lots.filter(l => !l.isExhausted());
      if (activeLots.length === 0) continue;
      
      let totalQuantity = 0;
      let totalCostBasis = 0;
      
      for (const lot of activeLots) {
        totalQuantity += lot.remainingQuantity;
        totalCostBasis += lot.remainingQuantity * lot.costPerUnit;
      }
      
      holdings[symbol] = {
        quantity: totalQuantity,
        costBasis: totalCostBasis,
        averageCost: totalCostBasis / totalQuantity,
        lots: activeLots.length,
      };
    }
    
    return holdings;
  }
  
  /**
   * Print current holdings summary
   */
  printHoldingsSummary() {
    const holdings = this.getCurrentHoldings();
    
    console.log('\n📊 Current Holdings (Cost Basis)');
    console.log('━'.repeat(50));
    
    for (const [symbol, data] of Object.entries(holdings)) {
      console.log(`   ${symbol}:`);
      console.log(`      Quantity: ${data.quantity.toFixed(8)}`);
      console.log(`      Cost Basis: $${data.costBasis.toFixed(2)}`);
      console.log(`      Avg Cost: $${data.averageCost.toFixed(2)}`);
      console.log(`      Tax Lots: ${data.lots}`);
    }
    
    console.log('━'.repeat(50));
  }
}

export default TaxReporter;
