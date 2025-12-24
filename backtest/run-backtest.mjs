#!/usr/bin/env node

/**
 * Backtest CLI
 * Version: 1.0.0
 * 
 * Command-line interface for running grid bot backtests.
 * 
 * Usage:
 *   node backtest/run-backtest.mjs --symbol BTC/USD --start 2024-01-01 --end 2024-12-01
 *   node backtest/run-backtest.mjs --config backtest-config.json
 *   node backtest/run-backtest.mjs --compare  # Compare multiple configurations
 */

import { HistoricalDataFetcher } from './historical-data.mjs';
import { BacktestEngine, compareConfigurations } from './backtest-engine.mjs';
import { generateHTMLReport, generateJSONReport, generateTradesCSV } from './metrics.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    symbol: 'BTC/USD',
    timeframe: '1h',
    start: null,
    end: null,
    gridLevels: 20,
    orderSize: 100,
    initialCapital: 10000,
    config: null,
    compare: false,
    output: 'reports',
    html: true,
    json: true,
    csv: false,
    help: false
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    
    switch (arg) {
      case '--symbol':
      case '-s':
        options.symbol = nextArg;
        i++;
        break;
      case '--timeframe':
      case '-t':
        options.timeframe = nextArg;
        i++;
        break;
      case '--start':
        options.start = nextArg;
        i++;
        break;
      case '--end':
        options.end = nextArg;
        i++;
        break;
      case '--grid-levels':
      case '-g':
        options.gridLevels = parseInt(nextArg);
        i++;
        break;
      case '--order-size':
      case '-o':
        options.orderSize = parseFloat(nextArg);
        i++;
        break;
      case '--capital':
      case '-c':
        options.initialCapital = parseFloat(nextArg);
        i++;
        break;
      case '--config':
        options.config = nextArg;
        i++;
        break;
      case '--compare':
        options.compare = true;
        break;
      case '--output':
        options.output = nextArg;
        i++;
        break;
      case '--html':
        options.html = true;
        break;
      case '--no-html':
        options.html = false;
        break;
      case '--json':
        options.json = true;
        break;
      case '--no-json':
        options.json = false;
        break;
      case '--csv':
        options.csv = true;
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
╔═══════════════════════════════════════════════════════════════════╗
║                    GRID BOT BACKTESTER                            ║
╚═══════════════════════════════════════════════════════════════════╝

Usage:
  node backtest/run-backtest.mjs [options]

Options:
  --symbol, -s      Trading pair (default: BTC/USD)
  --timeframe, -t   Candle timeframe: 1m, 5m, 15m, 1h, 4h, 1d (default: 1h)
  --start           Start date (YYYY-MM-DD, required)
  --end             End date (YYYY-MM-DD, required)
  --grid-levels, -g Number of grid levels (default: 20)
  --order-size, -o  USD per order (default: 100)
  --capital, -c     Initial capital in USD (default: 10000)
  --config          Path to JSON config file
  --compare         Compare multiple configurations
  --output          Output directory for reports (default: reports)
  --html            Generate HTML report (default: true)
  --no-html         Skip HTML report
  --json            Generate JSON report (default: true)
  --csv             Generate trades CSV
  --help, -h        Show this help message

Examples:
  # Basic backtest
  node backtest/run-backtest.mjs --symbol BTC/USD --start 2024-01-01 --end 2024-06-01

  # Custom configuration
  node backtest/run-backtest.mjs --symbol ETH/USD --start 2024-01-01 --end 2024-06-01 \\
    --grid-levels 30 --order-size 150 --capital 20000

  # Using config file
  node backtest/run-backtest.mjs --config my-config.json

  # Compare configurations
  node backtest/run-backtest.mjs --compare --config comparison-config.json
`);
}

/**
 * Default comparison configurations
 */
function getDefaultComparisonConfigs(baseConfig) {
  return [
    {
      name: 'Conservative (10 levels)',
      ...baseConfig,
      gridLevels: 10,
      orderSize: 200
    },
    {
      name: 'Standard (20 levels)',
      ...baseConfig,
      gridLevels: 20,
      orderSize: 100
    },
    {
      name: 'Aggressive (30 levels)',
      ...baseConfig,
      gridLevels: 30,
      orderSize: 66
    },
    {
      name: 'Dense (50 levels)',
      ...baseConfig,
      gridLevels: 50,
      orderSize: 40
    }
  ];
}

/**
 * Main function
 */
async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                    GRID BOT BACKTESTER v1.0                       ║
╚═══════════════════════════════════════════════════════════════════╝
`);

  const options = parseArgs();
  
  if (options.help) {
    printHelp();
    process.exit(0);
  }
  
  // Load config file if provided
  let config = {};
  if (options.config && fs.existsSync(options.config)) {
    config = JSON.parse(fs.readFileSync(options.config, 'utf8'));
    console.log(`📂 Loaded config from ${options.config}`);
  }
  
  // Merge CLI options with config
  const finalConfig = {
    symbol: config.symbol || options.symbol,
    timeframe: config.timeframe || options.timeframe,
    startDate: config.startDate || options.start,
    endDate: config.endDate || options.end,
    gridLevels: config.gridLevels || options.gridLevels,
    orderSize: config.orderSize || options.orderSize,
    initialCapital: config.initialCapital || options.initialCapital,
    lowerPrice: config.lowerPrice || null,
    upperPrice: config.upperPrice || null,
    makerFee: config.makerFee || 0.001,
    takerFee: config.takerFee || 0.001
  };
  
  // Validate required options
  if (!finalConfig.startDate || !finalConfig.endDate) {
    console.error('❌ Error: --start and --end dates are required');
    console.log('   Use --help for usage information');
    process.exit(1);
  }
  
  // Create output directory
  const outputDir = path.join(__dirname, options.output);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Fetch historical data
  console.log('\n📡 Fetching historical data...');
  const fetcher = new HistoricalDataFetcher();
  const historicalData = await fetcher.fetchOHLCV(
    finalConfig.symbol,
    finalConfig.timeframe,
    finalConfig.startDate,
    finalConfig.endDate
  );
  
  if (!historicalData || historicalData.candles.length === 0) {
    console.error('❌ Error: Failed to fetch historical data');
    process.exit(1);
  }
  
  // Run comparison or single backtest
  if (options.compare) {
    console.log('\n🔄 Running configuration comparison...');
    
    const configs = config.configurations || getDefaultComparisonConfigs(finalConfig);
    const results = await compareConfigurations(historicalData, configs);
    
    // Save comparison results
    const comparisonPath = path.join(outputDir, `comparison_${finalConfig.symbol.replace('/', '-')}_${Date.now()}.json`);
    fs.writeFileSync(comparisonPath, JSON.stringify(results.map(r => ({
      name: r.name,
      summary: r.report.summary,
      trades: r.report.trades
    })), null, 2));
    console.log(`\n📄 Comparison saved to ${comparisonPath}`);
    
  } else {
    // Single backtest
    console.log('\n🚀 Running backtest...');
    
    const engine = new BacktestEngine({
      ...finalConfig,
      symbol: finalConfig.symbol
    });
    
    const report = await engine.run(historicalData);
    
    // Print report
    engine.printReport(report);
    
    // Generate output files
    const timestamp = Date.now();
    const baseName = `backtest_${finalConfig.symbol.replace('/', '-')}_${timestamp}`;
    
    if (options.html) {
      generateHTMLReport(report, path.join(outputDir, `${baseName}.html`));
    }
    
    if (options.json) {
      generateJSONReport(report, path.join(outputDir, `${baseName}.json`));
    }
    
    if (options.csv) {
      generateTradesCSV(report.allTrades, path.join(outputDir, `${baseName}_trades.csv`));
    }
    
    console.log(`\n📁 Reports saved to ${outputDir}/`);
  }
  
  console.log('\n✅ Backtest complete!');
}

// Run main function
main().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
