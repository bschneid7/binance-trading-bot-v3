#!/bin/bash
# Multi-Symbol Grid Bot Deployment
# Deploy ETH/USD and SOL/USD bots alongside existing BTC/USD bot

echo "════════════════════════════════════════════════════════════"
echo "  Multi-Symbol Grid Bot Deployment"
echo "════════════════════════════════════════════════════════════"
echo ""

# Check if on VPS
if [ ! -d ~/binance-trading-bot-v3 ]; then
    echo "❌ Error: Not in VPS environment"
    echo "Run this script on VPS: ssh root@209.38.74.84"
    exit 1
fi

cd ~/binance-trading-bot-v3

echo "📊 Current Bot Status:"
./grid-bot-cli.mjs list

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  Creating ETH/USD Grid Bot"
echo "════════════════════════════════════════════════════════════"
echo ""

# Create ETH/USD bot
./grid-bot-cli.mjs create \
  --name live-eth-bot \
  --symbol ETH/USD \
  --lower 2700 \
  --upper 3300 \
  --grids 23 \
  --size 60

echo ""
read -p "✅ ETH bot created. Press Enter to start it..."

# Start ETH bot
./grid-bot-cli.mjs start --name live-eth-bot

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  Creating SOL/USD Grid Bot"
echo "════════════════════════════════════════════════════════════"
echo ""

# Create SOL/USD bot
./grid-bot-cli.mjs create \
  --name live-sol-bot \
  --symbol SOL/USD \
  --lower 110 \
  --upper 145 \
  --grids 23 \
  --size 40

echo ""
read -p "✅ SOL bot created. Press Enter to start it..."

# Start SOL bot
./grid-bot-cli.mjs start --name live-sol-bot

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  Deployment Summary"
echo "════════════════════════════════════════════════════════════"
echo ""

./grid-bot-cli.mjs list

echo ""
echo "📊 Capital Allocation:"
echo "   BTC/USD: \$2,400 (25 orders × \$100)"
echo "   ETH/USD: \$1,440 (24 orders × \$60)"
echo "   SOL/USD: \$960 (24 orders × \$40)"
echo "   ────────────────────────────────────"
echo "   TOTAL:   \$4,800 (73 orders)"
echo ""

echo "🔄 Next Steps:"
echo "1. Verify all orders on Binance.US:"
echo "   https://www.binance.us/en/my/orders/exchange/openorder"
echo ""
echo "2. Update systemd to monitor all 3 bots:"
echo "   ./update-monitoring.sh"
echo ""
echo "3. Enable email reports:"
echo "   ./setup-email-reports.sh"
echo ""

echo "✅ Multi-symbol deployment complete!"
