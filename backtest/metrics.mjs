#!/usr/bin/env node

/**
 * Performance Metrics Module
 * Version: 1.0.0
 * 
 * Calculates comprehensive trading performance metrics
 * for backtesting and live trading analysis.
 */

import fs from 'fs';
import path from 'path';

/**
 * Calculate basic return metrics
 */
export function calculateReturns(equityCurve) {
  if (equityCurve.length < 2) return null;
  
  const startEquity = equityCurve[0].equity;
  const endEquity = equityCurve[equityCurve.length - 1].equity;
  
  // Total return
  const totalReturn = (endEquity - startEquity) / startEquity;
  
  // Period returns
  const returns = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const periodReturn = (equityCurve[i].equity - equityCurve[i-1].equity) / equityCurve[i-1].equity;
    returns.push({
      timestamp: equityCurve[i].timestamp,
      return: periodReturn
    });
  }
  
  // Average return
  const avgReturn = returns.reduce((sum, r) => sum + r.return, 0) / returns.length;
  
  // Standard deviation
  const variance = returns.reduce((sum, r) => sum + Math.pow(r.return - avgReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  
  return {
    totalReturn,
    avgReturn,
    stdDev,
    returns
  };
}

/**
 * Calculate Sharpe Ratio
 * @param {Array} returns - Array of period returns
 * @param {number} riskFreeRate - Annual risk-free rate (default 0.05 = 5%)
 * @param {number} periodsPerYear - Number of periods per year
 */
export function calculateSharpeRatio(returns, riskFreeRate = 0.05, periodsPerYear = 365 * 24) {
  if (returns.length < 2) return 0;
  
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  
  if (stdDev === 0) return 0;
  
  const periodRiskFreeRate = riskFreeRate / periodsPerYear;
  const excessReturn = avgReturn - periodRiskFreeRate;
  
  // Annualized Sharpe
  return (excessReturn / stdDev) * Math.sqrt(periodsPerYear);
}

/**
 * Calculate Sortino Ratio (only considers downside volatility)
 */
export function calculateSortinoRatio(returns, riskFreeRate = 0.05, periodsPerYear = 365 * 24) {
  if (returns.length < 2) return 0;
  
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const periodRiskFreeRate = riskFreeRate / periodsPerYear;
  
  // Only consider negative returns for downside deviation
  const negativeReturns = returns.filter(r => r < 0);
  if (negativeReturns.length === 0) return Infinity;
  
  const downsideVariance = negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / returns.length;
  const downsideDeviation = Math.sqrt(downsideVariance);
  
  if (downsideDeviation === 0) return 0;
  
  const excessReturn = avgReturn - periodRiskFreeRate;
  return (excessReturn / downsideDeviation) * Math.sqrt(periodsPerYear);
}

/**
 * Calculate Maximum Drawdown
 */
export function calculateMaxDrawdown(equityCurve) {
  if (equityCurve.length < 2) return { maxDrawdown: 0, maxDrawdownDuration: 0 };
  
  let peak = equityCurve[0].equity;
  let maxDrawdown = 0;
  let maxDrawdownStart = 0;
  let maxDrawdownEnd = 0;
  let currentDrawdownStart = 0;
  let maxDrawdownDuration = 0;
  
  for (let i = 0; i < equityCurve.length; i++) {
    const equity = equityCurve[i].equity;
    
    if (equity > peak) {
      peak = equity;
      currentDrawdownStart = i;
    }
    
    const drawdown = (peak - equity) / peak;
    
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownStart = currentDrawdownStart;
      maxDrawdownEnd = i;
    }
  }
  
  // Calculate duration in days
  if (maxDrawdownStart < equityCurve.length && maxDrawdownEnd < equityCurve.length) {
    maxDrawdownDuration = (equityCurve[maxDrawdownEnd].timestamp - equityCurve[maxDrawdownStart].timestamp) / (1000 * 60 * 60 * 24);
  }
  
  return {
    maxDrawdown,
    maxDrawdownPercent: maxDrawdown * 100,
    maxDrawdownStart: equityCurve[maxDrawdownStart]?.date,
    maxDrawdownEnd: equityCurve[maxDrawdownEnd]?.date,
    maxDrawdownDuration
  };
}

/**
 * Calculate Calmar Ratio (Annual Return / Max Drawdown)
 */
export function calculateCalmarRatio(annualizedReturn, maxDrawdown) {
  if (maxDrawdown === 0) return 0;
  return annualizedReturn / (maxDrawdown * 100);
}

/**
 * Calculate Win Rate and related metrics
 */
export function calculateTradeMetrics(trades) {
  if (trades.length === 0) return null;
  
  const buyTrades = trades.filter(t => t.type === 'buy');
  const sellTrades = trades.filter(t => t.type === 'sell');
  
  // Match trades to calculate P&L
  const completedTrades = [];
  const buyQueue = [...buyTrades];
  
  for (const sell of sellTrades) {
    if (buyQueue.length > 0) {
      const buy = buyQueue.shift();
      const pnl = (sell.price - buy.price) * Math.min(buy.amount, sell.amount);
      const pnlPercent = (sell.price - buy.price) / buy.price * 100;
      completedTrades.push({
        buyPrice: buy.price,
        sellPrice: sell.price,
        amount: Math.min(buy.amount, sell.amount),
        pnl,
        pnlPercent,
        holdingTime: sell.timestamp - buy.timestamp
      });
    }
  }
  
  const winningTrades = completedTrades.filter(t => t.pnl > 0);
  const losingTrades = completedTrades.filter(t => t.pnl < 0);
  
  const winRate = completedTrades.length > 0 ? (winningTrades.length / completedTrades.length) * 100 : 0;
  
  const avgWin = winningTrades.length > 0 
    ? winningTrades.reduce((sum, t) => sum + t.pnl, 0) / winningTrades.length 
    : 0;
  
  const avgLoss = losingTrades.length > 0 
    ? Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0) / losingTrades.length)
    : 0;
  
  const profitFactor = avgLoss > 0 ? avgWin / avgLoss : Infinity;
  
  const avgHoldingTime = completedTrades.length > 0
    ? completedTrades.reduce((sum, t) => sum + t.holdingTime, 0) / completedTrades.length / (1000 * 60 * 60)
    : 0;
  
  const totalPnL = completedTrades.reduce((sum, t) => sum + t.pnl, 0);
  const totalFees = trades.reduce((sum, t) => sum + (t.fee || 0), 0);
  
  return {
    totalTrades: trades.length,
    completedRoundTrips: completedTrades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate,
    avgWin,
    avgLoss,
    profitFactor,
    avgHoldingTimeHours: avgHoldingTime,
    totalPnL,
    totalFees,
    netPnL: totalPnL - totalFees
  };
}

/**
 * Calculate risk-adjusted metrics
 */
export function calculateRiskMetrics(equityCurve, trades, riskFreeRate = 0.05) {
  const returnMetrics = calculateReturns(equityCurve);
  if (!returnMetrics) return null;
  
  const returns = returnMetrics.returns.map(r => r.return);
  const drawdownMetrics = calculateMaxDrawdown(equityCurve);
  const tradeMetrics = calculateTradeMetrics(trades);
  
  // Calculate annualized return
  const startTime = equityCurve[0].timestamp;
  const endTime = equityCurve[equityCurve.length - 1].timestamp;
  const durationYears = (endTime - startTime) / (1000 * 60 * 60 * 24 * 365);
  const annualizedReturn = (Math.pow(1 + returnMetrics.totalReturn, 1 / durationYears) - 1) * 100;
  
  return {
    totalReturn: returnMetrics.totalReturn * 100,
    annualizedReturn,
    volatility: returnMetrics.stdDev * Math.sqrt(365 * 24) * 100,
    sharpeRatio: calculateSharpeRatio(returns, riskFreeRate),
    sortinoRatio: calculateSortinoRatio(returns, riskFreeRate),
    calmarRatio: calculateCalmarRatio(annualizedReturn, drawdownMetrics.maxDrawdown),
    ...drawdownMetrics,
    ...tradeMetrics
  };
}

/**
 * Generate HTML report
 */
export function generateHTMLReport(report, outputPath) {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Backtest Report - ${report.summary.symbol}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #1a1a2e; color: #eee; }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { color: #00d4ff; }
    h2 { color: #00ff88; border-bottom: 1px solid #333; padding-bottom: 10px; }
    .metrics-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin: 20px 0; }
    .metric-card { background: #16213e; padding: 20px; border-radius: 10px; text-align: center; }
    .metric-value { font-size: 24px; font-weight: bold; color: #00d4ff; }
    .metric-label { color: #888; margin-top: 5px; }
    .positive { color: #00ff88; }
    .negative { color: #ff4444; }
    .chart-container { background: #16213e; padding: 20px; border-radius: 10px; margin: 20px 0; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #333; }
    th { background: #16213e; color: #00d4ff; }
    tr:hover { background: #1a1a3e; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 Backtest Report</h1>
    <p>${report.summary.symbol} | ${report.summary.startDate} to ${report.summary.endDate} (${report.summary.durationDays} days)</p>
    
    <h2>Performance Summary</h2>
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-value ${report.summary.totalReturn >= 0 ? 'positive' : 'negative'}">
          ${report.summary.totalReturn >= 0 ? '+' : ''}${report.summary.totalReturn.toFixed(2)}%
        </div>
        <div class="metric-label">Total Return</div>
      </div>
      <div class="metric-card">
        <div class="metric-value ${report.summary.annualizedReturn >= 0 ? 'positive' : 'negative'}">
          ${report.summary.annualizedReturn >= 0 ? '+' : ''}${report.summary.annualizedReturn.toFixed(2)}%
        </div>
        <div class="metric-label">Annualized Return</div>
      </div>
      <div class="metric-card">
        <div class="metric-value negative">-${report.summary.maxDrawdown.toFixed(2)}%</div>
        <div class="metric-label">Max Drawdown</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${report.summary.sharpeRatio.toFixed(2)}</div>
        <div class="metric-label">Sharpe Ratio</div>
      </div>
    </div>
    
    <h2>Equity Curve</h2>
    <div class="chart-container">
      <canvas id="equityChart"></canvas>
    </div>
    
    <h2>Trade Statistics</h2>
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-value">${report.trades.totalTrades}</div>
        <div class="metric-label">Total Trades</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${report.trades.winRate.toFixed(1)}%</div>
        <div class="metric-label">Win Rate</div>
      </div>
      <div class="metric-card">
        <div class="metric-value positive">$${report.trades.realizedProfit.toFixed(2)}</div>
        <div class="metric-label">Realized Profit</div>
      </div>
      <div class="metric-card">
        <div class="metric-value negative">$${report.trades.totalFees.toFixed(2)}</div>
        <div class="metric-label">Total Fees</div>
      </div>
    </div>
    
    <h2>Configuration</h2>
    <table>
      <tr><th>Parameter</th><th>Value</th></tr>
      <tr><td>Initial Capital</td><td>$${report.config.initialCapital.toLocaleString()}</td></tr>
      <tr><td>Grid Levels</td><td>${report.config.gridLevels}</td></tr>
      <tr><td>Order Size</td><td>$${report.config.orderSize}</td></tr>
      <tr><td>Maker Fee</td><td>${(report.config.makerFee * 100).toFixed(2)}%</td></tr>
      <tr><td>Taker Fee</td><td>${(report.config.takerFee * 100).toFixed(2)}%</td></tr>
    </table>
    
    <h2>Final Positions</h2>
    <table>
      <tr><th>Asset</th><th>Balance</th><th>Value</th></tr>
      <tr><td>USD</td><td>$${report.positions.finalUsdBalance.toFixed(2)}</td><td>$${report.positions.finalUsdBalance.toFixed(2)}</td></tr>
      <tr><td>Crypto</td><td>${report.positions.finalCryptoBalance.toFixed(6)}</td><td>$${report.positions.finalCryptoValue.toFixed(2)}</td></tr>
      <tr><td><strong>Total</strong></td><td></td><td><strong>$${report.summary.finalEquity.toFixed(2)}</strong></td></tr>
    </table>
  </div>
  
  <script>
    const equityData = ${JSON.stringify(report.equityCurve.filter((_, i) => i % 10 === 0).map(e => ({ x: e.date, y: e.equity })))};
    
    new Chart(document.getElementById('equityChart'), {
      type: 'line',
      data: {
        datasets: [{
          label: 'Equity',
          data: equityData,
          borderColor: '#00d4ff',
          backgroundColor: 'rgba(0, 212, 255, 0.1)',
          fill: true,
          tension: 0.1
        }]
      },
      options: {
        responsive: true,
        scales: {
          x: { type: 'category', ticks: { color: '#888' } },
          y: { ticks: { color: '#888' } }
        },
        plugins: {
          legend: { labels: { color: '#eee' } }
        }
      }
    });
  </script>
</body>
</html>
`;

  fs.writeFileSync(outputPath, html);
  console.log(`📄 HTML report saved to ${outputPath}`);
  return outputPath;
}

/**
 * Generate JSON report
 */
export function generateJSONReport(report, outputPath) {
  // Create a slimmed version without full equity curve
  const slimReport = {
    ...report,
    equityCurve: report.equityCurve.filter((_, i) => i % 100 === 0),  // Sample every 100th point
    drawdownCurve: report.drawdownCurve.filter((_, i) => i % 100 === 0)
  };
  
  fs.writeFileSync(outputPath, JSON.stringify(slimReport, null, 2));
  console.log(`📄 JSON report saved to ${outputPath}`);
  return outputPath;
}

/**
 * Generate CSV of trades
 */
export function generateTradesCSV(trades, outputPath) {
  const headers = ['timestamp', 'date', 'type', 'price', 'amount', 'value', 'fee'];
  const rows = trades.map(t => [
    t.timestamp,
    t.date,
    t.type,
    t.price.toFixed(2),
    t.amount.toFixed(6),
    t.value.toFixed(2),
    t.fee.toFixed(4)
  ]);
  
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  fs.writeFileSync(outputPath, csv);
  console.log(`📄 Trades CSV saved to ${outputPath}`);
  return outputPath;
}

export default {
  calculateReturns,
  calculateSharpeRatio,
  calculateSortinoRatio,
  calculateMaxDrawdown,
  calculateCalmarRatio,
  calculateTradeMetrics,
  calculateRiskMetrics,
  generateHTMLReport,
  generateJSONReport,
  generateTradesCSV
};
