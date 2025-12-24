# Grid Bot Backtesting Guide

## Overview

This guide teaches you how to properly backtest your grid bot configurations before deploying them with real money. Proper backtesting helps you:

1. **Validate strategies** before risking capital
2. **Optimize parameters** for maximum profitability
3. **Understand risk** through drawdown analysis
4. **Build confidence** in your trading system

---

## Quick Start

### Basic Backtest

```bash
cd /root/binance-trading-bot-v3

# Run a simple backtest
node backtest/run-backtest.mjs \
  --symbol BTC/USD \
  --start 2024-01-01 \
  --end 2024-06-01
```

### Compare Configurations

```bash
# Compare multiple grid configurations
node backtest/run-backtest.mjs \
  --compare \
  --symbol BTC/USD \
  --start 2024-01-01 \
  --end 2024-06-01
```

---

## Understanding Backtest Results

### Key Metrics

| Metric | What It Means | Good Value |
|--------|---------------|------------|
| **Total Return** | Overall profit/loss percentage | > 0% |
| **Annualized Return** | Return extrapolated to 1 year | > 20% |
| **Max Drawdown** | Largest peak-to-trough decline | < 20% |
| **Sharpe Ratio** | Risk-adjusted return | > 1.5 |
| **Win Rate** | Percentage of profitable trades | > 40% |
| **Profit Factor** | Gross profit / Gross loss | > 1.5 |

### Interpreting Results

**Example Output:**
```
📈 PERFORMANCE SUMMARY
   Total Return: +35.56%
   Max Drawdown: -13.10%
   Sharpe Ratio: 2.83
```

**Analysis:**
- **+35.56% return** is excellent for 5 months
- **-13.10% drawdown** means at worst, you were down 13% from peak
- **2.83 Sharpe** indicates very good risk-adjusted returns

---

## Backtesting Methodology

### Step 1: Choose Your Test Periods

**Don't just test one period!** Markets behave differently in different conditions:

```bash
# Bull market (BTC went from $40k to $70k)
node backtest/run-backtest.mjs --symbol BTC/USD --start 2024-01-01 --end 2024-03-15

# Sideways market (BTC ranged $60k-$70k)
node backtest/run-backtest.mjs --symbol BTC/USD --start 2024-03-15 --end 2024-06-01

# Bear market (BTC dropped from $70k to $50k)
node backtest/run-backtest.mjs --symbol BTC/USD --start 2024-06-01 --end 2024-09-01

# High volatility period
node backtest/run-backtest.mjs --symbol BTC/USD --start 2024-11-01 --end 2024-12-01
```

### Step 2: Test Multiple Configurations

Use the `--compare` flag to test different settings:

```bash
node backtest/run-backtest.mjs \
  --compare \
  --symbol BTC/USD \
  --start 2024-01-01 \
  --end 2024-06-01
```

This tests:
- **Conservative**: 15 levels, $75 orders, 0.8% spacing
- **Standard**: 20 levels, $100 orders, 1.0% spacing
- **Aggressive**: 25 levels, $150 orders, 1.2% spacing
- **Dense**: 30 levels, $100 orders, 0.5% spacing

### Step 3: Walk-Forward Analysis

**Critical for avoiding overfitting!**

1. **In-sample period** (optimize): Use 70% of data to find best parameters
2. **Out-of-sample period** (validate): Test on remaining 30%

```bash
# Optimize on Jan-Apr 2024
node backtest/run-backtest.mjs --compare --symbol BTC/USD --start 2024-01-01 --end 2024-04-30

# Validate on May-Jun 2024
node backtest/run-backtest.mjs --symbol BTC/USD --start 2024-05-01 --end 2024-06-30 \
  --grid-levels 20 --order-size 100  # Use best params from optimization
```

### Step 4: Monte Carlo Simulation

Run the same backtest multiple times with slight variations to understand result stability:

```bash
# Run 5 backtests with different random seeds
for i in {1..5}; do
  node backtest/run-backtest.mjs --symbol BTC/USD --start 2024-01-01 --end 2024-06-01
done
```

---

## Parameter Optimization Guide

### Grid Levels

| Levels | Best For | Trade-off |
|--------|----------|-----------|
| 10-15 | Low volatility, trending markets | Fewer trades, larger profits per trade |
| 20-25 | Normal conditions | Balanced approach |
| 30-40 | High volatility, ranging markets | More trades, smaller profits per trade |

**Test command:**
```bash
# Test different grid levels
node backtest/run-backtest.mjs --symbol BTC/USD --start 2024-01-01 --end 2024-06-01 --grid-levels 15
node backtest/run-backtest.mjs --symbol BTC/USD --start 2024-01-01 --end 2024-06-01 --grid-levels 25
node backtest/run-backtest.mjs --symbol BTC/USD --start 2024-01-01 --end 2024-06-01 --grid-levels 35
```

### Order Size

| Size | Capital Efficiency | Risk Level |
|------|-------------------|------------|
| $50-75 | Lower | Conservative |
| $100-150 | Medium | Standard |
| $175-250 | Higher | Aggressive |

**Rule of thumb:** Order size × Grid levels × 2 ≈ Total capital needed

### Grid Spacing

| Spacing | Volatility Match | Expected Trades |
|---------|------------------|-----------------|
| 0.5% | Low volatility | Very frequent |
| 1.0% | Normal | Moderate |
| 1.5-2.0% | High volatility | Less frequent |

---

## Risk Management Checklist

Before deploying any configuration, verify:

### ✅ Drawdown Tolerance
- [ ] Max drawdown < your risk tolerance (typically < 20%)
- [ ] Recovery time from drawdowns is acceptable

### ✅ Capital Requirements
- [ ] You have 2x the minimum capital needed (for safety margin)
- [ ] Capital is money you can afford to lose

### ✅ Market Conditions
- [ ] Strategy tested in bull, bear, AND sideways markets
- [ ] Strategy handles high volatility periods

### ✅ Statistical Significance
- [ ] At least 50+ trades in backtest
- [ ] At least 3 months of data
- [ ] Tested across multiple time periods

---

## Common Backtesting Mistakes

### 1. Overfitting
**Problem:** Optimizing too perfectly for historical data
**Solution:** Always validate on out-of-sample data

### 2. Survivorship Bias
**Problem:** Only testing coins that performed well
**Solution:** Test on coins that existed during the period, not just winners

### 3. Ignoring Fees
**Problem:** Not accounting for trading fees
**Solution:** Our backtester includes 0.1% fees by default

### 4. Look-Ahead Bias
**Problem:** Using future information in decisions
**Solution:** Our backtester processes data chronologically

### 5. Single Period Testing
**Problem:** Only testing one market condition
**Solution:** Test multiple periods (bull, bear, sideways)

---

## Advanced: Custom Configuration File

Create a JSON config for complex backtests:

```json
{
  "symbol": "BTC/USD",
  "timeframe": "1h",
  "startDate": "2024-01-01",
  "endDate": "2024-06-01",
  "initialCapital": 10000,
  "gridLevels": 20,
  "orderSize": 100,
  "gridSpacing": 0.01,
  "fees": {
    "maker": 0.001,
    "taker": 0.001
  },
  "features": {
    "volatilityAdjustment": true,
    "trendFilter": true,
    "momentumFilter": false
  }
}
```

Run with:
```bash
node backtest/run-backtest.mjs --config my-config.json
```

---

## Recommended Testing Protocol

### Before Going Live

1. **Initial Validation** (1 hour)
   ```bash
   # Quick test to verify setup
   node backtest/run-backtest.mjs --symbol BTC/USD --start 2024-06-01 --end 2024-06-15
   ```

2. **Full Historical Test** (2-3 hours)
   ```bash
   # Test full year
   node backtest/run-backtest.mjs --symbol BTC/USD --start 2024-01-01 --end 2024-12-01
   ```

3. **Configuration Comparison** (1-2 hours)
   ```bash
   # Find optimal settings
   node backtest/run-backtest.mjs --compare --symbol BTC/USD --start 2024-01-01 --end 2024-12-01
   ```

4. **Multi-Asset Test** (1-2 hours)
   ```bash
   # Test each asset you plan to trade
   node backtest/run-backtest.mjs --symbol ETH/USD --start 2024-01-01 --end 2024-12-01
   node backtest/run-backtest.mjs --symbol SOL/USD --start 2024-01-01 --end 2024-12-01
   ```

5. **Stress Test** (30 min)
   ```bash
   # Test during known volatile periods
   node backtest/run-backtest.mjs --symbol BTC/USD --start 2024-03-01 --end 2024-03-15
   ```

### Confidence Criteria

**Deploy only if:**
- Total return > 0% across all test periods
- Max drawdown < 25%
- Sharpe ratio > 1.0
- At least 100 trades in backtest
- Profitable in at least 2 of 3 market conditions (bull/bear/sideways)

---

## Interpreting HTML Reports

The backtester generates interactive HTML reports with:

1. **Equity Curve** - Visual representation of portfolio value over time
2. **Drawdown Chart** - Shows periods of decline
3. **Trade Distribution** - Histogram of trade profits/losses
4. **Monthly Returns** - Heatmap of returns by month

Open reports in your browser:
```bash
# List available reports
ls backtest/reports/

# Open in browser (on your local machine, download the file first)
```

---

## FAQ

**Q: How long should I backtest?**
A: Minimum 3 months, ideally 6-12 months covering different market conditions.

**Q: What Sharpe ratio should I target?**
A: > 1.0 is acceptable, > 1.5 is good, > 2.0 is excellent.

**Q: Should I trust backtests completely?**
A: No. Backtests are optimistic. Expect 20-30% worse performance in live trading due to slippage, timing differences, and market impact.

**Q: How often should I re-backtest?**
A: Every 3-6 months, or when market conditions change significantly.

---

## Next Steps

After successful backtesting:

1. **Paper trade** for 1-2 weeks with test mode
2. **Start small** with 25% of intended capital
3. **Scale up gradually** as you gain confidence
4. **Monitor and adjust** based on live performance

Good luck! 🚀
