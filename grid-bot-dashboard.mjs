#!/usr/bin/env node
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Serve static HTML
app.get('/', (req, res) => {
  res.send(generateHTML());
});

// API endpoint for bot data
app.get('/api/bots', (req, res) => {
  try {
    const bots = JSON.parse(fs.readFileSync('data/grid-bots.json', 'utf8'));
    const orders = JSON.parse(fs.readFileSync('data/active-orders.json', 'utf8'));
    const trades = JSON.parse(fs.readFileSync('data/grid-trades.json', 'utf8'));
    
    // Calculate stats per bot
    const botStats = bots.map(bot => {
      const botOrders = orders.filter(o => o.botName === bot.name);
      const botTrades = trades.filter(t => t.botName === bot.name);
      
      // Filter today's trades
      const today = new Date().toISOString().split('T')[0];
      const todayTrades = botTrades.filter(t => t.timestamp?.startsWith(today));
      
      // Calculate P&L (simplified)
      const buyTrades = botTrades.filter(t => t.side === 'BUY');
      const sellTrades = botTrades.filter(t => t.side === 'SELL');
      const totalBought = buyTrades.reduce((sum, t) => sum + (t.value || 0), 0);
      const totalSold = sellTrades.reduce((sum, t) => sum + (t.value || 0), 0);
      const estimatedPL = totalSold - totalBought;
      
      return {
        name: bot.name,
        symbol: bot.symbol,
        status: bot.status,
        gridRange: `$${bot.lower_price || bot.lowerBound} - $${bot.upper_price || bot.upperBound}`,
        capital: bot.capital_allocated || bot.totalCapital || 0,
        activeOrders: botOrders.length,
        totalFills: botTrades.length,
        fillsToday: todayTrades.length,
        estimatedPL: estimatedPL,
        buyOrders: botOrders.filter(o => o.side === 'buy').length,
        sellOrders: botOrders.filter(o => o.side === 'sell').length,
      };
    });
    
    // Overall stats
    const overallStats = {
      totalCapital: botStats.reduce((sum, b) => sum + b.capital, 0),
      totalOrders: botStats.reduce((sum, b) => sum + b.activeOrders, 0),
      totalFills: botStats.reduce((sum, b) => sum + b.totalFills, 0),
      fillsToday: botStats.reduce((sum, b) => sum + b.fillsToday, 0),
      totalPL: botStats.reduce((sum, b) => sum + b.estimatedPL, 0),
    };
    
    res.json({ bots: botStats, overall: overallStats, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API endpoint for recent trades
app.get('/api/recent-trades', (req, res) => {
  try {
    const trades = JSON.parse(fs.readFileSync('data/grid-trades.json', 'utf8'));
    const recentTrades = trades.slice(-20).reverse(); // Last 20 trades
    res.json(recentTrades);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function generateHTML() {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Grid Bot Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
    }
    .header {
      text-align: center;
      color: white;
      margin-bottom: 30px;
    }
    .header h1 {
      font-size: 2.5em;
      margin-bottom: 10px;
      text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
    }
    .timestamp {
      font-size: 0.9em;
      opacity: 0.9;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .stat-card {
      background: white;
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      transition: transform 0.2s;
    }
    .stat-card:hover {
      transform: translateY(-5px);
      box-shadow: 0 8px 12px rgba(0,0,0,0.15);
    }
    .stat-label {
      font-size: 0.85em;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }
    .stat-value {
      font-size: 2em;
      font-weight: bold;
      color: #333;
    }
    .stat-value.positive { color: #10b981; }
    .stat-value.negative { color: #ef4444; }
    .bot-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .bot-card {
      background: white;
      border-radius: 12px;
      padding: 25px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }
    .bot-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 15px;
      border-bottom: 2px solid #f0f0f0;
    }
    .bot-name {
      font-size: 1.3em;
      font-weight: bold;
      color: #333;
    }
    .bot-symbol {
      font-size: 1.1em;
      color: #667eea;
      font-weight: 600;
    }
    .status-badge {
      padding: 5px 12px;
      border-radius: 20px;
      font-size: 0.85em;
      font-weight: 600;
      text-transform: uppercase;
    }
    .status-running {
      background: #d1fae5;
      color: #065f46;
    }
    .status-stopped {
      background: #fee2e2;
      color: #991b1b;
    }
    .bot-stats {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 15px;
    }
    .bot-stat {
      padding: 10px;
      background: #f9fafb;
      border-radius: 8px;
    }
    .bot-stat-label {
      font-size: 0.8em;
      color: #666;
      margin-bottom: 5px;
    }
    .bot-stat-value {
      font-size: 1.2em;
      font-weight: bold;
      color: #333;
    }
    .trades-section {
      background: white;
      border-radius: 12px;
      padding: 25px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }
    .section-title {
      font-size: 1.5em;
      font-weight: bold;
      margin-bottom: 20px;
      color: #333;
    }
    .trades-table {
      width: 100%;
      border-collapse: collapse;
    }
    .trades-table th {
      background: #f9fafb;
      padding: 12px;
      text-align: left;
      font-size: 0.85em;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .trades-table td {
      padding: 12px;
      border-bottom: 1px solid #f0f0f0;
    }
    .trade-buy {
      color: #10b981;
      font-weight: 600;
    }
    .trade-sell {
      color: #ef4444;
      font-weight: 600;
    }
    .refresh-btn {
      position: fixed;
      bottom: 30px;
      right: 30px;
      background: #667eea;
      color: white;
      border: none;
      padding: 15px 25px;
      border-radius: 30px;
      font-size: 1em;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
      transition: all 0.3s;
    }
    .refresh-btn:hover {
      background: #5568d3;
      transform: scale(1.05);
    }
    .loading {
      text-align: center;
      color: white;
      font-size: 1.2em;
      padding: 40px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🤖 Grid Bot Dashboard</h1>
      <div class="timestamp" id="timestamp">Loading...</div>
    </div>

    <div id="content" class="loading">Loading bot data...</div>
  </div>

  <button class="refresh-btn" onclick="loadData()">🔄 Refresh</button>

  <script>
    async function loadData() {
      try {
        const response = await fetch('/api/bots');
        const data = await response.json();
        
        const tradesResponse = await fetch('/api/recent-trades');
        const trades = await tradesResponse.json();
        
        renderDashboard(data, trades);
      } catch (error) {
        document.getElementById('content').innerHTML = 
          '<div class="loading">Error loading data: ' + error.message + '</div>';
      }
    }

    function renderDashboard(data, trades) {
      const timestamp = new Date(data.timestamp).toLocaleString();
      document.getElementById('timestamp').textContent = 'Last updated: ' + timestamp;
      
      const html = \`
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">Total Capital</div>
            <div class="stat-value">$\${data.overall.totalCapital.toFixed(2)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Active Orders</div>
            <div class="stat-value">\${data.overall.totalOrders}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Total Fills</div>
            <div class="stat-value">\${data.overall.totalFills}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Fills Today</div>
            <div class="stat-value">\${data.overall.fillsToday}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Estimated P&L</div>
            <div class="stat-value \${data.overall.totalPL >= 0 ? 'positive' : 'negative'}">
              $\${data.overall.totalPL.toFixed(2)}
            </div>
          </div>
        </div>

        <div class="bot-cards">
          \${data.bots.map(bot => \`
            <div class="bot-card">
              <div class="bot-header">
                <div>
                  <div class="bot-name">\${bot.name}</div>
                  <div class="bot-symbol">\${bot.symbol}</div>
                </div>
                <span class="status-badge status-\${bot.status}">\${bot.status}</span>
              </div>
              <div class="bot-stats">
                <div class="bot-stat">
                  <div class="bot-stat-label">Grid Range</div>
                  <div class="bot-stat-value" style="font-size: 0.9em;">\${bot.gridRange}</div>
                </div>
                <div class="bot-stat">
                  <div class="bot-stat-label">Capital</div>
                  <div class="bot-stat-value">$\${bot.capital.toFixed(0)}</div>
                </div>
                <div class="bot-stat">
                  <div class="bot-stat-label">Active Orders</div>
                  <div class="bot-stat-value">\${bot.activeOrders} <span style="font-size: 0.7em; color: #10b981;">(\${bot.buyOrders}B)</span> <span style="font-size: 0.7em; color: #ef4444;">(\${bot.sellOrders}S)</span></div>
                </div>
                <div class="bot-stat">
                  <div class="bot-stat-label">Fills (Today/Total)</div>
                  <div class="bot-stat-value">\${bot.fillsToday} / \${bot.totalFills}</div>
                </div>
                <div class="bot-stat" style="grid-column: 1 / -1;">
                  <div class="bot-stat-label">Estimated P&L</div>
                  <div class="bot-stat-value \${bot.estimatedPL >= 0 ? 'positive' : 'negative'}">
                    $\${bot.estimatedPL.toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          \`).join('')}
        </div>

        <div class="trades-section">
          <div class="section-title">📊 Recent Trades (Last 20)</div>
          <table class="trades-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Bot</th>
                <th>Symbol</th>
                <th>Side</th>
                <th>Price</th>
                <th>Amount</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              \${trades.map(t => \`
                <tr>
                  <td>\${new Date(t.timestamp).toLocaleTimeString()}</td>
                  <td>\${t.botName}</td>
                  <td>\${t.symbol}</td>
                  <td class="trade-\${t.side.toLowerCase()}">\${t.side}</td>
                  <td>$\${t.price.toFixed(2)}</td>
                  <td>\${t.amount}</td>
                  <td>$\${t.value.toFixed(2)}</td>
                </tr>
              \`).join('')}
            </tbody>
          </table>
        </div>
      \`;
      
      document.getElementById('content').innerHTML = html;
    }

    // Load data on page load
    loadData();
    
    // Auto-refresh every 30 seconds
    setInterval(loadData, 30000);
  </script>
</body>
</html>
  `;
}

app.listen(PORT, () => {
  console.log(\`\n🚀 Grid Bot Dashboard running at:\`);
  console.log(\`   http://localhost:\${PORT}\`);
  console.log(\`   http://209.38.74.84:\${PORT}\`);
  console.log(\`\n✅ Dashboard auto-refreshes every 30 seconds\`);
  console.log(\`🔄 Press Ctrl+C to stop\n\`);
});
