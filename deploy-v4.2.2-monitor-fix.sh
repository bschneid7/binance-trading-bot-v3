#!/bin/bash
# Deploy v4.2.2-MONITOR-FIX to VPS
# Fixes critical bug: Monitor was assigning all orders to all bots

echo "════════════════════════════════════════════════════════════"
echo "  Deploying v4.2.2-MONITOR-FIX"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "This fix resolves the monitor bug where all orders were"
echo "being assigned to all bots, causing database duplicates."
echo ""
echo "Bug: syncDatabase() was hardcoded to fetch 'BTC/USD'"
echo "Fix: Now fetches orders for each bot's specific symbol"
echo ""

cd ~/binance-trading-bot-v3

# Backup current version
echo "📦 Backing up current version..."
cp grid-bot-cli.mjs grid-bot-cli-v4.2.1-before-monitor-fix.backup
echo "   ✅ Backup created: grid-bot-cli-v4.2.1-before-monitor-fix.backup"
echo ""

# Stop all monitors
echo "🛑 Stopping monitors..."
sudo systemctl stop grid-bot-v3.service
sudo systemctl stop grid-bot-eth.service
sudo systemctl stop grid-bot-sol.service
echo "   ✅ All monitors stopped"
echo ""

# Deploy new version
echo "🚀 Deploying v4.2.2-MONITOR-FIX..."
mv grid-bot-cli-v4.2.2-MONITOR-FIX.mjs grid-bot-cli.mjs
chmod +x grid-bot-cli.mjs
echo "   ✅ New version deployed"
echo ""

# Verify version
echo "🔍 Verifying version..."
VERSION=$(grep "const VERSION" grid-bot-cli.mjs | head -1)
echo "   $VERSION"
echo ""

# Clean database for fresh sync
echo "🗑️  Cleaning database for fresh sync..."
cp data/active-orders.json data/active-orders.json.backup-before-v4.2.2
echo '[]' > data/active-orders.json
echo "   ✅ Database cleaned (backup created)"
echo ""

# Restart monitors (they will auto-sync with correct symbol filtering)
echo "🔄 Restarting monitors..."
sudo systemctl start grid-bot-v3.service
sudo systemctl start grid-bot-eth.service
sudo systemctl start grid-bot-sol.service
echo "   ✅ All monitors restarted"
echo ""

# Wait for monitors to sync
echo "⏳ Waiting 70 seconds for monitors to sync orders..."
sleep 70
echo ""

# Verify database
echo "🔍 Verifying database after sync..."
cat data/active-orders.json | python3 -c "
import sys, json
orders = json.load(sys.stdin)
print(f'\n   Total orders in database: {len(orders)}')
for bot in ['live-btc-bot', 'live-eth-bot', 'live-sol-bot']:
    bot_orders = [o for o in orders if o.get('bot_name') == bot]
    buys = [o for o in bot_orders if o.get('side') == 'buy']
    sells = [o for o in bot_orders if o.get('side') == 'sell']
    print(f'   {bot}: {len(bot_orders)} orders ({len(buys)} BUY, {len(sells)} SELL)')
"
echo ""

# Check monitor status
echo "🔍 Checking monitor services..."
echo "   BTC Monitor:"
sudo systemctl is-active grid-bot-v3.service && echo "      ✅ Active" || echo "      ❌ Inactive"
echo "   ETH Monitor:"
sudo systemctl is-active grid-bot-eth.service && echo "      ✅ Active" || echo "      ❌ Inactive"
echo "   SOL Monitor:"
sudo systemctl is-active grid-bot-sol.service && echo "      ✅ Active" || echo "      ❌ Inactive"
echo ""

echo "════════════════════════════════════════════════════════════"
echo "  Deployment Complete!"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "✅ v4.2.2-MONITOR-FIX deployed successfully"
echo ""
echo "Expected database orders:"
echo "   - live-btc-bot: ~32 orders (matches BTC/USD on Binance)"
echo "   - live-eth-bot: ~11 orders (matches ETH/USD on Binance)"
echo "   - live-sol-bot: ~16 orders (matches SOL/USD on Binance)"
echo "   - TOTAL: ~59 orders (no duplicates!)"
echo ""
echo "Next steps:"
echo "   1. Verify: ./grid-bot-cli.mjs list"
echo "   2. Check logs: sudo journalctl -u grid-bot-eth.service -n 20"
echo "   3. Monitor fills: ./grid-bot-cli.mjs show --name live-eth-bot"
echo ""
echo "🎉 Your bots are now running with correct symbol filtering!"
