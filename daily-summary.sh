#!/bin/bash
## Daily Summary Report

cd ~/binance-trading-bot-v3

echo "================================================================"
echo "       📊 GRID BOT DAILY SUMMARY - $(date +%Y-%m-%d)"
echo "================================================================"
echo ""

echo "=== Bot Status ==="
./grid-bot-cli.mjs list 2>/dev/null | tail -8

echo ""
echo "=== Today's Fills ==="
TODAY=$(date +%Y-%m-%d)
grep "$TODAY" data/grid-trades.json 2>/dev/null | wc -l | xargs echo "Fills today:"

echo ""
echo "=== This Week's P&L ==="
node calculate-pnl.mjs --week --capital 7340 2>/dev/null | grep -E "Total fills:|Estimated net:|ROI:"

echo ""
echo "=== Quick Commands ==="
echo "  node calculate-pnl.mjs --today --capital 7340"
echo "  node export-for-taxes.mjs --year 2025"
echo "  tail -10 data/grid-trades.json"
echo ""
