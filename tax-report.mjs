#!/usr/bin/env node

/**
 * Tax Report Generator CLI
 * Generates tax reports, Form 8949 CSV, and tax software exports
 * 
 * Usage:
 *   node tax-report.mjs --year 2024                    # Generate full report for 2024
 *   node tax-report.mjs --year 2024 --format csv      # Export Form 8949 CSV
 *   node tax-report.mjs --year 2024 --format turbotax # Export TurboTax format
 *   node tax-report.mjs --process                      # Process historical trades
 *   node tax-report.mjs --holdings                     # Show current holdings with cost basis
 *   node tax-report.mjs --summary 2024                # Quick summary for year
 */

import { getDatabase } from './database.mjs';
import { TaxReporter } from './tax-reporter.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Output directory for reports
const REPORTS_DIR = path.join(__dirname, 'data', 'tax-reports');

// Ensure reports directory exists
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    year: new Date().getFullYear(),
    format: 'report',  // 'report', 'csv', 'turbotax', 'taxact', 'cointracker'
    method: 'FIFO',    // 'FIFO', 'LIFO', 'HIFO', 'LOFO'
    process: false,
    holdings: false,
    summary: false,
    clear: false,
    help: false,
  };
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--year':
      case '-y':
        options.year = parseInt(args[++i]);
        break;
      case '--format':
      case '-f':
        options.format = args[++i];
        break;
      case '--method':
      case '-m':
        options.method = args[++i].toUpperCase();
        break;
      case '--process':
      case '-p':
        options.process = true;
        break;
      case '--holdings':
        options.holdings = true;
        break;
      case '--summary':
      case '-s':
        options.summary = true;
        if (args[i + 1] && !args[i + 1].startsWith('-')) {
          options.year = parseInt(args[++i]);
        }
        break;
      case '--clear':
        options.clear = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
    }
  }
  
  return options;
}

/**
 * Print help message
 */
function printHelp() {
  console.log(`
════════════════════════════════════════════════════════════
       TAX REPORT GENERATOR
════════════════════════════════════════════════════════════

Usage: node tax-report.mjs [options]

Options:
  --year, -y <year>      Tax year (default: current year)
  --format, -f <format>  Output format:
                           report    - Full text report (default)
                           csv       - Form 8949 CSV
                           turbotax  - TurboTax import format
                           taxact    - TaxAct import format
                           cointracker - CoinTracker format
                           all       - Generate all formats
  --method, -m <method>  Accounting method:
                           FIFO - First In, First Out (default)
                           LIFO - Last In, First Out
                           HIFO - Highest In, First Out
                           LOFO - Lowest In, First Out
  --process, -p          Process historical trades to build tax lots
  --holdings             Show current holdings with cost basis
  --summary, -s [year]   Quick capital gains summary
  --clear                Clear all tax data (use before reprocessing)
  --help, -h             Show this help message

Examples:
  node tax-report.mjs --process
    Process all historical trades to create tax lots

  node tax-report.mjs --year 2024 --format all
    Generate all report formats for 2024

  node tax-report.mjs --summary 2024
    Show quick capital gains summary for 2024

  node tax-report.mjs --holdings
    Show current crypto holdings with cost basis

  node tax-report.mjs --method HIFO --year 2024
    Generate report using Highest In First Out method

Output files are saved to: ${REPORTS_DIR}

════════════════════════════════════════════════════════════
`);
}

/**
 * Format currency for display
 */
function formatCurrency(amount) {
  const sign = amount >= 0 ? '' : '-';
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

/**
 * Print capital gains summary
 */
function printSummary(summary) {
  console.log(`
════════════════════════════════════════════════════════════
       CAPITAL GAINS SUMMARY - ${summary.year}
════════════════════════════════════════════════════════════

SHORT-TERM (held < 1 year):
   Transactions: ${summary.shortTerm.transactions}
   Proceeds:     ${formatCurrency(summary.shortTerm.proceeds)}
   Cost Basis:   ${formatCurrency(summary.shortTerm.costBasis)}
   Net Gain/Loss: ${formatCurrency(summary.shortTerm.netGainLoss)}

LONG-TERM (held > 1 year):
   Transactions: ${summary.longTerm.transactions}
   Proceeds:     ${formatCurrency(summary.longTerm.proceeds)}
   Cost Basis:   ${formatCurrency(summary.longTerm.costBasis)}
   Net Gain/Loss: ${formatCurrency(summary.longTerm.netGainLoss)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOTAL:
   Transactions: ${summary.totalTransactions}
   Proceeds:     ${formatCurrency(summary.total.proceeds)}
   Cost Basis:   ${formatCurrency(summary.total.costBasis)}
   
   ════════════════════════════════════════
   NET CAPITAL GAIN/LOSS: ${formatCurrency(summary.total.netGainLoss)}
   ════════════════════════════════════════
`);

  if (Object.keys(summary.bySymbol).length > 0) {
    console.log('\nBy Cryptocurrency:');
    for (const [symbol, data] of Object.entries(summary.bySymbol)) {
      console.log(`   ${symbol}: ${data.transactions} transactions, ${formatCurrency(data.netGainLoss)}`);
    }
  }

  if (Object.keys(summary.byBot).length > 0) {
    console.log('\nBy Bot:');
    for (const [botName, data] of Object.entries(summary.byBot)) {
      console.log(`   ${botName}: ${data.transactions} transactions, ${formatCurrency(data.netGainLoss)}`);
    }
  }
  
  console.log();
}

/**
 * Print current holdings
 */
function printHoldings(holdings) {
  console.log(`
════════════════════════════════════════════════════════════
       CURRENT HOLDINGS - COST BASIS
════════════════════════════════════════════════════════════
`);

  let totalCostBasis = 0;
  
  for (const [symbol, data] of Object.entries(holdings)) {
    console.log(`${symbol}:`);
    console.log(`   Quantity:    ${data.quantity.toFixed(8)}`);
    console.log(`   Cost Basis:  ${formatCurrency(data.costBasis)}`);
    console.log(`   Avg Cost:    ${formatCurrency(data.averageCost)}`);
    console.log(`   Tax Lots:    ${data.lots}`);
    console.log();
    totalCostBasis += data.costBasis;
  }
  
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Total Cost Basis: ${formatCurrency(totalCostBasis)}`);
  console.log();
}

/**
 * Main function
 */
async function main() {
  const options = parseArgs();
  
  if (options.help) {
    printHelp();
    process.exit(0);
  }
  
  console.log('📊 Tax Report Generator');
  console.log(`   Accounting Method: ${options.method}`);
  console.log();
  
  // Initialize database
  const db = getDatabase();
  
  // Initialize tax reporter
  const taxReporter = new TaxReporter(db, { method: options.method });
  await taxReporter.init();
  
  // Clear tax data if requested
  if (options.clear) {
    console.log('⚠️  Clearing all tax data...');
    db.clearTaxData();
    console.log('✅ Tax data cleared. Run --process to rebuild.\n');
    process.exit(0);
  }
  
  // Process historical trades if requested
  if (options.process) {
    console.log('📋 Processing historical trades...\n');
    const result = await taxReporter.processHistoricalTrades();
    console.log(`\n✅ Processed ${result.purchases} purchases and ${result.sales} sales`);
    console.log(`   Tax lots created: ${taxReporter.getTotalLots()}`);
    console.log(`   Taxable events: ${taxReporter.events.length}\n`);
  }
  
  // Show holdings if requested
  if (options.holdings) {
    const holdings = taxReporter.getCurrentHoldings();
    if (Object.keys(holdings).length === 0) {
      console.log('⚠️  No holdings found. Run --process first to build tax lots.\n');
    } else {
      printHoldings(holdings);
    }
    process.exit(0);
  }
  
  // Show summary if requested
  if (options.summary) {
    const summary = taxReporter.getCapitalGainsSummary(options.year);
    if (summary.totalTransactions === 0) {
      console.log(`⚠️  No taxable events found for ${options.year}.`);
      console.log('   Run --process first to build tax data from trades.\n');
    } else {
      printSummary(summary);
    }
    process.exit(0);
  }
  
  // Generate reports
  const year = options.year;
  const summary = taxReporter.getCapitalGainsSummary(year);
  
  if (summary.totalTransactions === 0) {
    console.log(`⚠️  No taxable events found for ${year}.`);
    console.log('   Run --process first to build tax data from trades.\n');
    process.exit(1);
  }
  
  console.log(`\n📄 Generating reports for tax year ${year}...`);
  console.log(`   Found ${summary.totalTransactions} taxable transactions\n`);
  
  const timestamp = new Date().toISOString().slice(0, 10);
  const generatedFiles = [];
  
  // Generate based on format
  if (options.format === 'report' || options.format === 'all') {
    const reportPath = path.join(REPORTS_DIR, `tax-report-${year}-${timestamp}.txt`);
    taxReporter.generateTaxReport(year, reportPath);
    generatedFiles.push(reportPath);
  }
  
  if (options.format === 'csv' || options.format === 'all') {
    const csvPath = path.join(REPORTS_DIR, `form-8949-${year}-${timestamp}.csv`);
    taxReporter.generateForm8949CSV(year, csvPath);
    generatedFiles.push(csvPath);
  }
  
  if (options.format === 'turbotax' || options.format === 'all') {
    const ttPath = path.join(REPORTS_DIR, `turbotax-${year}-${timestamp}.csv`);
    taxReporter.generateTaxSoftwareCSV(year, ttPath, 'turbotax');
    generatedFiles.push(ttPath);
  }
  
  if (options.format === 'taxact' || options.format === 'all') {
    const taPath = path.join(REPORTS_DIR, `taxact-${year}-${timestamp}.csv`);
    taxReporter.generateTaxSoftwareCSV(year, taPath, 'taxact');
    generatedFiles.push(taPath);
  }
  
  if (options.format === 'cointracker' || options.format === 'all') {
    const ctPath = path.join(REPORTS_DIR, `cointracker-${year}-${timestamp}.csv`);
    taxReporter.generateTaxSoftwareCSV(year, ctPath, 'cointracker');
    generatedFiles.push(ctPath);
  }
  
  // Print summary
  printSummary(summary);
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Generated Files:');
  for (const file of generatedFiles) {
    console.log(`   📄 ${file}`);
  }
  console.log();
  
  console.log('⚠️  DISCLAIMER: This report is for informational purposes only.');
  console.log('   Please consult a qualified tax professional for advice.\n');
}

// Run
main().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
