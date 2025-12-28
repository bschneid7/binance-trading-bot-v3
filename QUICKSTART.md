'''
# Binance.US Trading Bot - QuickStart Guide

**Version:** 2.0
**Last Updated:** December 28, 2025

---

## 1. Introduction

This guide provides a comprehensive overview of your automated crypto trading system. It includes details on system components, CLI commands, scheduled tasks, and key features. This document serves as a central reference for managing and monitoring your trading bots.

---

## 2. Git Repository

All code and configurations are managed in a private GitHub repository. To get the latest updates, run the following command on your VPS:

```bash
cd /root/binance-trading-bot-v3
git pull origin main
```

- **URL:** `https://github.com/bschneid7/binance-trading-bot-v3`

---

## 3. System Components

The system consists of two primary trading strategies: Grid Bots and a Dip Buyer.

### 3.1. Grid Trading Bots

Grid bots place a series of buy and sell orders within a predefined price range, profiting from market volatility.

| Bot Name | Symbol | Grid Range | Grid Levels |
|---|---|---|---|
| `live-btc-bot` | BTC/USD | $65,000 - $130,000 | 30 |
| `live-eth-bot` | ETH/USD | $2,250 - $3,380 | 26 |
| `live-sol-bot` | SOL/USD | $95 - $150 | 12 |

### 3.2. Enhanced Monitor

All grid bots are managed by the **Enhanced Monitor**, which provides advanced features beyond simple grid trading:

- **Auto-Rebalance:** Automatically shifts the grid range if the price moves 10% outside the configured boundaries.
- **Volatility-Based Grid Adjustments:** Dynamically adjusts grid spacing based on market volatility.
- **Trend Filtering:** Reduces trades against strong market trends to minimize losses.
- **Dynamic Position Sizing:** Adjusts order sizes based on market conditions.

### 3.3. Dip Buyer

The Dip Buyer monitors for significant price drops and executes buys during market fear or flash crashes. It operates with its own capital reserve.

- **Strategy:** Tiered buying at -3%, -5%, -8%, and -12% dips.
- **Capital Reserve:** $1,000 (reserved for grid bot operations).
- **Order Sizes:** $50 to $300 per tier.
- **Flash Crash Mode:** Enabled for rapid buying during major drops.

---

## 4. CLI Commands

All commands should be run from the `/root/binance-trading-bot-v3` directory on your VPS.

### 4.1. Reporting Commands

| Command | Description |
|---|---|
| `node health-check.mjs` | **Most comprehensive report.** Detailed diagnostics for all bots, services, and capital.
| `node daily-report.mjs` | Summary for all bots, 24h stats, and last trade alerts. Use `--no-email` for console only.
| `node weekly-report.mjs` | Weekly performance summary, P&L breakdown, and sentiment analysis. Use `--no-email` for console only.

### 4.2. Bot Management Commands

| Command | Description |
|---|---|
| `node grid-bot-cli-v5.mjs show --name <bot_name>` | Display the configuration and status of a specific grid bot.
| `node grid-bot-cli-v5.mjs rebalance --name <bot_name>` | **Use with caution.** Cancels all orders and places a fresh grid. Useful after updating grid range.

### 4.3. Service Management Commands

These commands manage the background services for each bot.

| Command | Description |
|---|---|
| `sudo systemctl status <service_name>` | Check the status of a service.
| `sudo systemctl restart <service_name>` | Restart a service after code changes.
| `sudo systemctl stop <service_name>` | Stop a service.
| `sudo systemctl start <service_name>` | Start a stopped service.

**Service Names:**
- `grid-bot-btc`
- `grid-bot-eth`
- `grid-bot-sol`
- `dip-buyer`

---

## 5. Scheduled Tasks (Cron Jobs)

| Schedule | Time (PST) | Task |
|---|---|---|
| Daily | 8:00 AM | `daily-report.mjs` (sends email) |
| Weekly | Sunday 9:00 AM | `weekly-report.mjs` (sends email) |
| Every 5 min | `monitor-cron.mjs` | Health monitoring and alerts |

To view all scheduled tasks, run: `crontab -l`

---

## 6. Key Features & Enhancements

- **Automated Email Reports:** Daily and weekly reports are automatically sent to `bschneid7@gmail.com`.
- **Profit Milestone Alerts:** The daily report tracks progress towards P&L milestones (e.g., $2,500, $3,000) and provides alerts.
- **Sentiment Correlation Tracker:** The weekly report analyzes the correlation between market sentiment (Fear & Greed Index) and trading profitability over time.
- **"No Trade" Alerts:** The daily report flags any bot that hasn't executed a trade in over 24 hours.
- **PST Timestamps:** All reports display timestamps in PST for easier readability.

---

## 7. Troubleshooting

- **Bot shows as "Stopped" in health check:** This is often due to a crash loop. Check the service logs for errors: `sudo journalctl -u <service_name> -n 100`
- **Dip Buyer not buying:** Check for "Insufficient capital" errors in the logs: `sudo journalctl -u dip-buyer -n 50`. The Dip Buyer needs available USD in your Binance account that is not reserved for grid bots.
- **"$0.00 24h P&L":** This is normal during low volatility periods (like weekends) when prices don't cross grid levels. Check the "Last Trade" timestamp in the daily report to confirm.

'''
