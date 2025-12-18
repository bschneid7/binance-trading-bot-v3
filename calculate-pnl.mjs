#!/usr/bin/env node
/**
 * P&L Calculator - FIXED VERSION
 * Properly handles JSON array format
 */
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRADES_FILE = join(__dirname, 'data', 'grid-trades.json');

const args = process.argv.slice(2);
let startDate, endDate;

if (args.includes('--today')) {
  startDate = endDate = new Date().toISOString().split('T')[0];
} else if (args.includes('--yesterday')) {
  const yesterday = new Date(Date.now() - 86400000);
  startDate = endDate = yesterday.toISOString().split('T')[0];
} else if (args.includes('--week')) {
  endDate = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  startDate = weekAgo.toISOString().split('T')[0];
} else if (args.includes('--start') && args.includes('--end')) {
  startDate = args[args.indexOf('--start') + 1];
  endDate = args[args.indexOf('--end') + 1];
} else {
  startDate = endDate = new Date().toISOString().split('T')[0];
}

console.log(`\n📊 P&L Report: ${startDate} to ${endDate}\n`);

// Read as proper JSON array
const data = fs.readFileSync(TRADES_FILE, 'utf8');
const trades = JSON.parse(data);

const filtered = trades.filter(t => {
  const d = t.timestamp.split('T')[0];
  return d >= startDate && d <= endDate;
});

console.log(`Total fills: ${filtered.length}\n`);

if (filtered.length === 0) {
  console.log('No trades in this period.\n');
  process.exit(0);
}

const bots = {};
for (const t of filtered) {
  const bot = t.bot_name || 'unknown';
  if (!bots[bot]) bots[bot] = { buys: 0, sells: 0, volume: 0 };
  
  if (t.side.toUpperCase() === 'BUY') bots[bot].buys++;
  else if (t.side.toUpperCase() === 'SELL') bots[bot].sells++;
  bots[bot].volume += t.value || 0;
}

let totalVol = 0;
for (const [name, stats] of Object.entries(bots)) {
  console.log(`${name}:`);
  console.log(`  ${stats.buys} BUYs, ${stats.sells} SELLs`);
  console.log(`  Volume: $${stats.volume.toFixed(2)}`);
  totalVol += stats.volume;
}

const grossProfit = totalVol * 0.003;
const fees = totalVol * 0.002;
const netProfit = grossProfit - fees;

console.log(`\nEstimated gross profit: $${grossProfit.toFixed(2)}`);
console.log(`Estimated fees: -$${fees.toFixed(2)}`);
console.log(`Estimated net profit: $${netProfit.toFixed(2)}\n`);

if (args.includes('--capital')) {
  const cap = parseFloat(args[args.indexOf('--capital') + 1]);
  console.log(`ROI: ${((netProfit / cap) * 100).toFixed(2)}%\n`);
}
