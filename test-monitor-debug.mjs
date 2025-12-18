import { readFileSync } from 'fs';

const BOTS_FILE = './data/grid-bots.json';
const bots = JSON.parse(readFileSync(BOTS_FILE, 'utf8'));
const bot = bots.find(b => b.name === 'live-btc-bot');

console.log('Bot found:', bot ? 'YES' : 'NO');
console.log('Bot name:', bot?.name);

console.log('\n⏱️  Polling interval: 60 seconds');
console.log('After polling message...');

if (false) { // simulateVolatility check
  console.log('In simulation mode...');
} else {
  console.log('NOT in simulation mode');
}

console.log('About to create setInterval...');

const intervalId = setInterval(async () => {
  console.log('✅ INTERVAL FIRED!');
  clearInterval(intervalId);
}, 1000);

console.log('setInterval created, waiting...');

setTimeout(() => {
  console.log('Done waiting');
  process.exit(0);
}, 5000);
