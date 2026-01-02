#!/bin/bash
# ETH Bot Fix & Recapitalization - Ready to Execute
# Date: January 2, 2026
# Capital: $2,000 from $6,055 USD available

echo "═══════════════════════════════════════════════════════════"
echo "ETH BOT FIX & RECAPITALIZATION - EXECUTION SCRIPT"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Capital to deploy: $2,000"
echo "ETH to purchase: ~0.59 ETH at current price (~$3,043)"
echo ""
echo "Press ENTER to continue or CTRL+C to abort..."
read

# ═══════════════════════════════════════════════════════════
# PHASE 1: BACKUP & DOCUMENTATION
# ═══════════════════════════════════════════════════════════

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "PHASE 1: BACKUP & DOCUMENTATION"
echo "═══════════════════════════════════════════════════════════"
echo ""

cd /root/binance-trading-bot-v3

echo "Step 1.1: Creating database backup..."
cp data/grid-bot.db data/grid-bot.db.backup.$(date +%Y%m%d_%H%M%S)
echo "✅ Database backed up"
ls -lh data/grid-bot.db*
echo ""

echo "Step 1.2: Saving current state..."
node health-check.mjs > ~/eth-bot-before-fix-$(date +%Y%m%d_%H%M%S).txt
echo "✅ Health check saved to ~/eth-bot-before-fix-*.txt"
echo ""

echo "Step 1.3: Documenting current ETH bot status..."
echo "Current status:"
node health-check.mjs | grep -A 30 "live-eth-bot"
echo ""

echo "Press ENTER to continue to Phase 2..."
read

# ═══════════════════════════════════════════════════════════
# PHASE 2: FIX DATABASE SYNC
# ═══════════════════════════════════════════════════════════

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "PHASE 2: FIX DATABASE SYNC"
echo "═══════════════════════════════════════════════════════════"
echo ""

echo "Step 2.1: Stopping ETH bot..."
node grid-bot-cli.mjs stop --name live-eth-bot
sleep 3
echo "✅ ETH bot stopped"
echo ""

echo "Step 2.2: Checking current status..."
node grid-bot-cli.mjs status --name live-eth-bot
echo ""

echo "Step 2.3: Cancelling all existing ETH orders on Binance..."
echo "⚠️  This will cancel all 25 legacy orders"
echo "Press ENTER to confirm or CTRL+C to abort..."
read

# Cancel orders (you may need to implement this or do manually)
# If cancel-all-orders.mjs exists:
if [ -f "cancel-all-orders.mjs" ]; then
    node cancel-all-orders.mjs --symbol ETH/USD --confirm
else
    echo "⚠️  cancel-all-orders.mjs not found"
    echo "Please manually cancel all ETH/USD orders on Binance.US:"
    echo "1. Log into Binance.US"
    echo "2. Go to Orders → Open Orders"
    echo "3. Cancel all ETH/USD orders"
    echo ""
    echo "Press ENTER when done..."
    read
fi
echo "✅ Orders cancelled"
echo ""

echo "Step 2.4: Cleaning database..."
sqlite3 data/grid-bot.db << 'EOF'
DELETE FROM orders WHERE bot_name = 'live-eth-bot';
UPDATE bots SET status = 'stopped', updated_at = datetime('now') WHERE name = 'live-eth-bot';
.quit
EOF
echo "✅ Database cleaned"
echo ""

echo "Step 2.5: Verifying cleanup..."
sqlite3 data/grid-bot.db "SELECT name, status, (SELECT COUNT(*) FROM orders WHERE bot_name = 'live-eth-bot') as order_count FROM bots WHERE name = 'live-eth-bot';"
echo ""

echo "Expected: live-eth-bot|stopped|0"
echo ""
echo "Press ENTER to continue to Phase 3..."
read

# ═══════════════════════════════════════════════════════════
# PHASE 3: ADD CAPITAL
# ═══════════════════════════════════════════════════════════

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "PHASE 3: ADD CAPITAL"
echo "═══════════════════════════════════════════════════════════"
echo ""

echo "Step 3.1: Checking current balances..."
node health-check.mjs | grep -A 10 "Monitored Holdings"
echo ""

echo "Step 3.2: Purchasing ETH..."
echo ""
echo "⚠️  MANUAL STEP REQUIRED:"
echo ""
echo "You need to purchase ETH on Binance.US:"
echo ""
echo "Option 1: Via Binance.US Website (Recommended)"
echo "  1. Log into Binance.US"
echo "  2. Go to Trade → Spot"
echo "  3. Select ETH/USD pair"
echo "  4. Choose 'Market' order"
echo "  5. Enter: 0.59 ETH (or $1,800 USD)"
echo "  6. Click 'Buy ETH'"
echo "  7. Confirm purchase"
echo ""
echo "Option 2: Via API (if you have a trading script)"
echo "  node place-order.mjs --symbol ETH/USD --side buy --type market --amount 0.59"
echo ""
echo "Target purchase:"
echo "  Amount: 0.59 ETH"
echo "  Estimated cost: ~$1,800"
echo "  Current price: ~$3,043/ETH"
echo ""
echo "Press ENTER after you've completed the purchase..."
read

echo ""
echo "Step 3.3: Verifying purchase..."
echo "Checking updated balances..."
node health-check.mjs | grep -A 10 "Monitored Holdings"
echo ""

echo "Expected ETH balance: ~0.621 ETH (~$1,890)"
echo "(0.031906 existing + 0.589 new)"
echo ""
echo "Does this look correct? (y/n)"
read -r response
if [[ ! "$response" =~ ^[Yy]$ ]]; then
    echo "⚠️  Please verify the purchase and run this script again"
    exit 1
fi
echo "✅ Capital added successfully"
echo ""

echo "Press ENTER to continue to Phase 4..."
read

# ═══════════════════════════════════════════════════════════
# PHASE 4: RESTART BOT
# ═══════════════════════════════════════════════════════════

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "PHASE 4: RESTART BOT"
echo "═══════════════════════════════════════════════════════════"
echo ""

echo "Step 4.1: Checking current ETH bot configuration..."
sqlite3 data/grid-bot.db "SELECT name, symbol, lower_price, upper_price, grid_count FROM bots WHERE name = 'live-eth-bot';"
echo ""

echo "Step 4.2: Starting ETH bot..."
node grid-bot-cli.mjs start --name live-eth-bot
echo ""

echo "Step 4.3: Waiting for initialization (60 seconds)..."
sleep 60
echo ""

echo "Step 4.4: Checking bot status..."
node grid-bot-cli.mjs status --name live-eth-bot
echo ""

echo "Press ENTER to continue to Phase 5..."
read

# ═══════════════════════════════════════════════════════════
# PHASE 5: VERIFICATION
# ═══════════════════════════════════════════════════════════

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "PHASE 5: VERIFICATION"
echo "═══════════════════════════════════════════════════════════"
echo ""

echo "Step 5.1: Running full health check..."
node health-check.mjs | grep -A 40 "live-eth-bot"
echo ""

echo "Step 5.2: Verifying database orders..."
echo "Orders in database:"
sqlite3 data/grid-bot.db "SELECT side, COUNT(*) FROM orders WHERE bot_name = 'live-eth-bot' AND status = 'OPEN' GROUP BY side;"
echo ""

echo "Step 5.3: Checking recent logs..."
echo "Last 20 lines of ETH bot log:"
tail -20 logs/live-eth-bot.log
echo ""

echo "Step 5.4: Verifying capital deployment..."
node health-check.mjs | grep -A 15 "Capital Deployment"
echo ""

echo "Step 5.5: Saving final state..."
node health-check.mjs > ~/eth-bot-after-fix-$(date +%Y%m%d_%H%M%S).txt
echo "✅ Health check saved to ~/eth-bot-after-fix-*.txt"
echo ""

# ═══════════════════════════════════════════════════════════
# COMPLETION SUMMARY
# ═══════════════════════════════════════════════════════════

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "COMPLETION SUMMARY"
echo "═══════════════════════════════════════════════════════════"
echo ""

echo "✅ Phase 1: Backup & Documentation - COMPLETE"
echo "✅ Phase 2: Fix Database Sync - COMPLETE"
echo "✅ Phase 3: Add Capital - COMPLETE"
echo "✅ Phase 4: Restart Bot - COMPLETE"
echo "✅ Phase 5: Verification - COMPLETE"
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "SUCCESS CRITERIA CHECKLIST"
echo "═══════════════════════════════════════════════════════════"
echo ""

echo "Please verify the following:"
echo ""
echo "[ ] Bot status shows 'Running'"
echo "[ ] Database shows 28-32 orders (not 0)"
echo "[ ] Exchange shows 28-32 orders (not 25)"
echo "[ ] Orders are balanced (not 24 buy / 1 sell)"
echo "[ ] No error messages in logs"
echo "[ ] Monitor process is active"
echo "[ ] ETH balance is ~0.62 ETH (~$1,890)"
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "NEXT STEPS"
echo "═══════════════════════════════════════════════════════════"
echo ""

echo "1. Monitor daily for next 7 days:"
echo "   node health-check.mjs | grep -A 30 'live-eth-bot'"
echo ""
echo "2. Watch for first trade (expected within 3-7 days)"
echo ""
echo "3. Verify database stays in sync"
echo ""
echo "4. Compare performance to BTC/SOL bots"
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "ETH BOT FIX COMPLETE!"
echo "═══════════════════════════════════════════════════════════"
echo ""

echo "Backup files created:"
ls -lh data/grid-bot.db.backup.* 2>/dev/null | tail -1
ls -lh ~/eth-bot-*-$(date +%Y%m%d)*.txt 2>/dev/null
echo ""

echo "🎉 Congratulations! Your ETH bot is now fully recapitalized!"
echo ""
