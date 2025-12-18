#!/bin/bash
# Grid Bot v4.2.3 - Fill Tracking Fix Patcher
# Applies fix to monitor's checkFills function

set -e

echo "=========================================="
echo "Grid Bot v4.2.3 - Fill Tracking Fix"
echo "=========================================="
echo ""

# Backup current version
echo "📦 Creating backup..."
cp grid-bot-cli.mjs grid-bot-cli-v4.2.2-before-fill-fix.mjs.backup
echo "✅ Backup created: grid-bot-cli-v4.2.2-before-fill-fix.mjs.backup"
echo ""

# Find the line number of the checkFills function in monitor
echo "🔍 Locating checkFills function..."
LINE_NUM=$(grep -n "const filled = \[\];" grid-bot-cli.mjs | tail -1 | cut -d: -f1)
echo "   Found at line $LINE_NUM"
echo ""

# Create the patch
echo "🔧 Applying fix..."

# The fix: Add newTrades array and trade recording logic
# We need to inject code after "const filled = [];"

# Step 1: Add newTrades array declaration after "const filled = [];"
sed -i "${LINE_NUM}a\\          const newTrades = [];" grid-bot-cli.mjs

# Step 2: Find where order.filled_price is set and add trade recording after
FILL_PRICE_LINE=$(grep -n "order.filled_price = currentPrice;" grid-bot-cli.mjs | tail -1 | cut -d: -f1)

# Insert trade recording code after filled_price line
sed -i "${FILL_PRICE_LINE}a\\
\\
              // ✅ FIXED: Record trade to grid-trades.json\\
              const trade = {\\
                orderId: order.id,\\
                botName: order.botName,\\
                symbol: order.symbol,\\
                side: order.side.toUpperCase(),\\
                price: currentPrice,\\
                amount: order.amount,\\
                value: currentPrice * order.amount,\\
                fee: 0,\\
                timestamp: new Date().toISOString(),\\
                type: \"fill\"\\
              };\\
              newTrades.push(trade);" grid-bot-cli.mjs

# Step 3: Find where writeJSON(ORDERS_FILE, orders) is called and add trades writing after
WRITE_ORDERS_LINE=$(grep -n "writeJSON(ORDERS_FILE, orders);" grid-bot-cli.mjs | tail -1 | cut -d: -f1)

sed -i "${WRITE_ORDERS_LINE}a\\
\\
            // ✅ FIXED: Append trades to grid-trades.json\\
            const existingTrades = readJSON(TRADES_FILE);\\
            const updatedTrades = existingTrades.concat(newTrades);\\
            writeJSON(TRADES_FILE, updatedTrades);\\
\\
            console.log(\\\`📝 Recorded \${newTrades.length} trade(s) to grid-trades.json\\\`);" grid-bot-cli.mjs

echo "✅ Fix applied successfully!"
echo ""

# Update version string
echo "🏷️  Updating version to v4.2.3-FILL-TRACKING-FIX..."
sed -i "s/v4\.2\.2-MONITOR-FIX/v4.2.3-FILL-TRACKING-FIX/g" grid-bot-cli.mjs
echo "✅ Version updated"
echo ""

# Verify the fix
echo "🔍 Verifying fix..."
if grep -q "newTrades.push(trade)" grid-bot-cli.mjs && \
   grep -q "writeJSON(TRADES_FILE, updatedTrades)" grid-bot-cli.mjs; then
    echo "✅ Fix verified - trade recording code present"
else
    echo "❌ Verification failed - fix may not have applied correctly"
    exit 1
fi
echo ""

echo "=========================================="
echo "✅ Fix Applied Successfully!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Restart monitors:"
echo "   sudo systemctl restart grid-bot-v3.service grid-bot-eth.service grid-bot-sol.service"
echo ""
echo "2. Watch for fills being recorded:"
echo "   journalctl -u grid-bot-v3.service -f | grep 'Recorded'"
echo ""
echo "3. Verify fills appear in database:"
echo "   tail -5 data/grid-trades.json"
echo ""
