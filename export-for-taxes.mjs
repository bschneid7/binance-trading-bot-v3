#!/usr/bin/env node
/**
 * Tax Export - FIXED VERSION
 * Properly handles JSON array format
 */
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRADES_FILE = join(__dirname, 'data', 'grid-trades.json');

const args = process.argv.slice(2);
const year = args.includes('--year') ? parseInt(args[args.indexOf('--year') + 1]) : new Date().getFullYear();
const output = `tax-report-${year}.csv`;

console.log(`\n📋 Exporting ${year} trades for tax reporting...\n`);

// Read as proper JSON array
const data = fs.readFileSync(TRADES_FILE, 'utf8');
const trades = JSON.parse(data);

const filtered = args.includes('--all') ? trades : trades.filter(t => 
  new Date(t.timestamp).getFullYear() === year
);

console.log(`Found ${filtered.length} trades\n`);

if (filtered.length === 0) {
  console.log(`No trades found for ${year}\n`);
  process.exit(0);
}

const csv = ['Date,Time,Bot,Symbol,Side,Amount,Price,Value,Fee,OrderID'];

for (const t of filtered) {
  const dt = new Date(t.timestamp);
  const row = [
    dt.toISOString().split('T')[0],
    dt.toISOString().split('T')[1].replace('Z', ''),
    t.bot_name || 'unknown',
    t.symbol || 'N/A',
    (t.side || 'N/A').toUpperCase(),
    t.amount || 0,
    t.price || 0,
    (t.value || 0).toFixed(2),
    (t.fee || 0).toFixed(6),
    t.orderId || t.order_id || 'N/A'
  ];
  csv.push(row.join(','));
}

fs.writeFileSync(output, csv.join('\n'));

console.log(`✅ Exported to: ${output}`);
console.log(`Records: ${filtered.length}`);
console.log(`Size: ${(csv.join('\n').length / 1024).toFixed(2)} KB\n`);

const buys = filtered.filter(t => t.side?.toUpperCase() === 'BUY').length;
const sells = filtered.filter(t => t.side?.toUpperCase() === 'SELL').length;
const totalVol = filtered.reduce((sum, t) => sum + (t.value || 0), 0);
const totalFees = filtered.reduce((sum, t) => sum + (t.fee || 0), 0);

console.log('=== Summary ===');
console.log(`Buys:  ${buys}`);
console.log(`Sells: ${sells}`);
console.log(`Total volume: $${totalVol.toFixed(2)}`);
console.log(`Total fees: $${totalFees.toFixed(2)}\n`);

console.log('💡 Import into TurboTax, CoinTracker, Koinly, or give to your accountant\n');
