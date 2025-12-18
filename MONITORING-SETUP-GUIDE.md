# Grid Bot Monitoring Setup Guide

**Author:** Bryan Schneider  
**Version:** 1.0  
**Last Updated:** December 11, 2024

---

## 📋 Overview

This monitoring system provides automated tracking, alerting, and daily reporting for your Grid Trading Bot v2.0. It collects performance metrics every 60 minutes, logs them to CSV files, and generates comprehensive daily reports.

---

## 📦 What You're Getting

| File | Size | Purpose |
|------|------|---------|
| `monitor-bot.sh` | 11 KB | Automated monitoring daemon with alerting |
| `daily-report.sh` | 12 KB | Daily performance report generator |
| `MONITORING-SETUP-GUIDE.md` | This file | Setup instructions |

---

## 🚀 Quick Start (5 Minutes)

### Step 1: Upload Files to VPS

**On your Mac:**

```bash
# Navigate to Downloads folder
cd ~/Downloads

# Upload monitoring scripts to VPS
scp monitor-bot.sh root@209.38.74.84:~/binance-trading-bot-v3/
scp daily-report.sh root@209.38.74.84:~/binance-trading-bot-v3/
```

---

### Step 2: Deploy on VPS

**SSH into your VPS:**

```bash
ssh root@209.38.74.84
```

**Navigate to bot directory:**

```bash
cd ~/binance-trading-bot-v3
```

**Verify files arrived:**

```bash
ls -lh monitor-bot.sh daily-report.sh
```

**Expected output:**
```
-rw-r--r-- 1 root root  11K Dec 11 12:00 monitor-bot.sh
-rw-r--r-- 1 root root  12K Dec 11 12:00 daily-report.sh
```

**Make scripts executable:**

```bash
chmod +x monitor-bot.sh daily-report.sh
```

---

### Step 3: Start Monitoring (Paper Trading)

**Run monitoring for your bot (checks every 60 minutes):**

```bash
./monitor-bot.sh test-v2-btc 60
```

**Or use `nohup` to run in background:**

```bash
nohup ./monitor-bot.sh test-v2-btc 60 > monitoring.log 2>&1 &
```

**Check it's running:**

```bash
ps aux | grep monitor-bot
```

---

## 📊 Using the Monitoring System

### Monitor Bot (Continuous)

**Basic usage:**
```bash
./monitor-bot.sh [bot-name] [interval-minutes]
```

**Examples:**

| Command | Description |
|---------|-------------|
| `./monitor-bot.sh` | Monitor `test-v2-btc` every 60 min |
| `./monitor-bot.sh test-v2-btc 30` | Monitor every 30 minutes |
| `./monitor-bot.sh live-micro-btc 15` | Monitor live bot every 15 min |

**What it does:**
- ✅ Checks bot status every N minutes
- ✅ Logs metrics to CSV: `logs/metrics-{bot-name}.csv`
- ✅ Detects and alerts on issues:
  - Bot stopped
  - Price outside grid range (>10%)
  - No trades after 24+ hours
  - Win rate below 35% (after 20+ trades)
  - Max drawdown exceeds 25%
- ✅ Saves full bot output: `logs/status-{bot-name}.log`

**Stop monitoring:**
- Press `Ctrl+C` if running in foreground
- Or kill background process: `pkill -f monitor-bot.sh`

---

### Daily Report (On-Demand)

**Basic usage:**
```bash
./daily-report.sh [bot-name] [days-back]
```

**Examples:**

| Command | Description |
|---------|-------------|
| `./daily-report.sh` | Report for `test-v2-btc` (last 24h) |
| `./daily-report.sh test-v2-btc 7` | 7-day report |
| `./daily-report.sh live-micro-btc 3` | 3-day report for live bot |

**What it shows:**
- 📊 Bot status & uptime
- 💰 Market conditions (price, volatility, regime)
- 🎯 Trading performance (trades, win rate, P&L)
- 🏆 Performance grade (A-F scale)
- 🎓 Actionable recommendations
- 🚨 Critical alerts summary

---

## 📁 Log Files Explained

All logs are stored in: `~/binance-trading-bot-v3/logs/`

| File | Format | Purpose | View Command |
|------|--------|---------|--------------|
| `metrics-{bot}.csv` | CSV | Time-series performance data | `tail -f logs/metrics-test-v2-btc.csv` |
| `alerts-{bot}.log` | Text | Critical/warning alerts | `tail -20 logs/alerts-test-v2-btc.log` |
| `status-{bot}.log` | Text | Full bot output snapshots | `tail -50 logs/status-test-v2-btc.log` |

### Metrics CSV Columns

```
timestamp, bot_name, status, btc_price, position_pct, volatility, market_regime,
active_orders, total_trades, win_rate, profit_factor, total_pnl, max_drawdown, sharpe_ratio
```

**Example row:**
```
2024-12-11 12:00:00,test-v2-btc,RUNNING,90337.18,3.4,0.72,RANGING BEARISH,0,0,0,0,0,0,0
```

---

## ⚙️ Recommended Monitoring Schedule

### Paper Trading (Days 1-10)

**Monitoring frequency:** Every 60 minutes

```bash
nohup ./monitor-bot.sh test-v2-btc 60 > monitoring.log 2>&1 &
```

**Daily routine:**
1. **Morning (9 AM):** Run daily report
   ```bash
   ./daily-report.sh test-v2-btc 1
   ```

2. **Evening (6 PM):** Check for alerts
   ```bash
   tail -20 logs/alerts-test-v2-btc.log
   ```

3. **Manual check:** View live bot status
   ```bash
   ./grid-bot-cli.mjs show --name test-v2-btc
   ```

---

### Live Trading (Days 11+)

**Monitoring frequency:** Every 15-30 minutes

```bash
nohup ./monitor-bot.sh live-micro-btc 15 > monitoring-live.log 2>&1 &
```

**Daily routine:**
1. **Morning & Evening:** Run daily report
   ```bash
   ./daily-report.sh live-micro-btc 1
   ```

2. **Throughout day:** Monitor alerts in real-time
   ```bash
   tail -f logs/alerts-live-micro-btc.log
   ```

3. **Weekly:** Generate 7-day performance report
   ```bash
   ./daily-report.sh live-micro-btc 7
   ```

---

## 🚨 Alert Severity Levels

| Severity | Icon | Meaning | Action Required |
|----------|------|---------|-----------------|
| **CRITICAL** | 🚨 | Bot stopped, win rate <35%, drawdown >25% | **Immediate** - Investigate now |
| **WARNING** | ⚠️ | Price outside grid, no trades 24h+ | **Soon** - Review within hours |
| **INFO** | ℹ️ | Monitoring started/stopped | **None** - Informational only |

---

## 📈 Performance Grading System

The daily report assigns a letter grade based on:

| Metric | Weight | Excellent (A) | Good (B) | Fair (C) | Poor (D) | Failing (F) |
|--------|--------|---------------|----------|----------|----------|-------------|
| Win Rate | 40% | ≥60% | ≥50% | ≥40% | ≥30% | <30% |
| Profit Factor | 40% | ≥1.5 | ≥1.2 | ≥1.0 | ≥0.8 | <0.8 |
| Sharpe Ratio | 20% | ≥1.0 | ≥0.5 | ≥0.2 | ≥0.0 | <0.0 |

**Minimum for live trading:** Grade B or higher (75+ points) after 20+ trades.

---

## 🔧 Troubleshooting

### Problem: "Bot not found"

**Cause:** Bot name mismatch or bot hasn't been created.

**Solution:**
```bash
# List all bots
./grid-bot-cli.mjs list

# Use correct bot name
./monitor-bot.sh test-v2-btc 60
```

---

### Problem: No metrics in CSV

**Cause:** Monitoring hasn't completed first check cycle.

**Solution:**
```bash
# Wait for first check interval (e.g., 60 minutes)
# Or run manual check
./grid-bot-cli.mjs show --name test-v2-btc

# Force immediate check (restart monitoring)
pkill -f monitor-bot.sh
./monitor-bot.sh test-v2-btc 1  # Check every 1 minute for testing
```

---

### Problem: Monitoring stops unexpectedly

**Cause:** SSH connection dropped, server reboot, or script error.

**Solution:**
```bash
# Check if still running
ps aux | grep monitor-bot

# Restart in background with nohup
nohup ./monitor-bot.sh test-v2-btc 60 > monitoring.log 2>&1 &

# Check logs for errors
tail -50 monitoring.log
```

---

### Problem: "Cannot access bot directory"

**Cause:** Scripts not in correct directory.

**Solution:**
```bash
# Move to bot directory
cd ~/binance-trading-bot-v3

# Verify you're in the right place
ls grid-bot-cli.mjs

# Run monitoring from here
./monitor-bot.sh test-v2-btc 60
```

---

## 📱 Remote Monitoring (Optional)

### SSH Alias for Quick Access

**On your Mac, edit `~/.ssh/config`:**

```bash
Host gridbot
    HostName 209.38.74.84
    User root
    IdentityFile ~/.ssh/id_rsa
```

**Now connect with:**
```bash
ssh gridbot
```

---

### Quick Check Script (Run from Mac)

**Create `~/check-bot.sh` on your Mac:**

```bash
#!/bin/bash
ssh root@209.38.74.84 "cd ~/binance-trading-bot-v3 && ./daily-report.sh test-v2-btc 1"
```

**Make executable and run:**
```bash
chmod +x ~/check-bot.sh
./check-bot.sh
```

---

## 📊 Advanced: Export Data for Excel

**Export last 7 days to CSV:**

```bash
cd ~/binance-trading-bot-v3/logs
tail -168 metrics-test-v2-btc.csv > export-7days.csv
```

**Download to your Mac:**

```bash
scp root@209.38.74.84:~/binance-trading-bot-v3/logs/export-7days.csv ~/Downloads/
```

**Open in Excel/Numbers:**
- Import as CSV
- Set delimiter: comma (`,`)
- Chart win rate, P&L, drawdown over time

---

## 🎯 Your 10-Day Paper Trading Checklist

Use this checklist to track your bot's readiness for live trading:

### Days 1-3: Initial Validation ✅

- [ ] Monitoring running continuously (check `ps aux | grep monitor`)
- [ ] No CRITICAL alerts in logs
- [ ] Bot status = RUNNING for 72+ hours straight
- [ ] At least 5+ trades executed
- [ ] Stop-loss logic tested (manual trigger if needed)

---

### Days 4-7: Performance Evaluation ✅

- [ ] Daily reports show consistent uptime (>95%)
- [ ] 10-20+ trades executed
- [ ] Win rate > 40%
- [ ] Profit factor > 1.0
- [ ] Max drawdown < 25%
- [ ] No duplicate orders or stuck trades

---

### Days 8-10: Final Validation ✅

- [ ] 20+ trades completed
- [ ] Win rate ≥ 50%
- [ ] Profit factor ≥ 1.2
- [ ] Performance grade: B or higher
- [ ] Sharpe ratio > 0.5
- [ ] Grid rebalancing tested (if price moved outside range)
- [ ] Ready for live micro test ($150 capital)

---

## 🚀 Next Steps After Paper Trading

Once you've completed 10 days of successful paper trading:

1. **Review final report:**
   ```bash
   ./daily-report.sh test-v2-btc 10
   ```

2. **Prepare for live trading:**
   - Stop paper bot: `./grid-bot-cli.mjs stop --name test-v2-btc`
   - Switch to live mode: Edit `.env.production`, set `BINANCE_TEST_MODE=false`
   - Fund Binance.US with **max $200**

3. **Create micro live bot:**
   ```bash
   ./grid-bot-cli.mjs create --name live-micro-btc --lower 90000 --upper 100000 --grids 5 --size 30
   ./grid-bot-cli.mjs start --name live-micro-btc
   ```

4. **Start live monitoring (15-minute checks):**
   ```bash
   nohup ./monitor-bot.sh live-micro-btc 15 > monitoring-live.log 2>&1 &
   ```

5. **Monitor VERY closely for first 24-48 hours**

---

## 📞 Support Commands

Quick reference for when you need help:

```bash
# Show monitoring help
./monitor-bot.sh --help

# Show daily report help
./daily-report.sh --help

# List all running monitors
ps aux | grep monitor-bot

# Stop all monitors
pkill -f monitor-bot.sh

# View all logs
ls -lh logs/

# Clean old logs (backup first!)
cp -r logs logs-backup-$(date +%Y%m%d)
rm logs/*.csv logs/*.log
```

---

## ✅ Summary

You now have professional-grade monitoring for your grid bot:

- ✅ **Automated checks** every 60 minutes
- ✅ **Real-time alerting** for critical issues
- ✅ **Daily performance reports** with actionable insights
- ✅ **Historical data** for backtesting and analysis
- ✅ **Performance grading** to validate live trading readiness

**Your immediate action:**
1. Upload `monitor-bot.sh` and `daily-report.sh` to VPS
2. Run `./monitor-bot.sh test-v2-btc 60`
3. Check daily with `./daily-report.sh`
4. Review after 10 days before going live

---

**Questions?** Check the troubleshooting section or review the bot status with:
```bash
./grid-bot-cli.mjs status
./grid-bot-cli.mjs show --name test-v2-btc
```

Good luck with your paper trading! 🚀
