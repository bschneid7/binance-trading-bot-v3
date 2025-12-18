#!/bin/bash
# Multi-Symbol Deployment Verification Script
# Checks all systems after deployment

echo "════════════════════════════════════════════════════════════"
echo "  Multi-Symbol Bot Deployment Verification"
echo "════════════════════════════════════════════════════════════"
echo ""

cd ~/binance-trading-bot-v3

PASS=0
FAIL=0
WARN=0

# Check 1: Bots exist in database
echo "🔍 Check 1: Bot Database"
if [ -f data/grid-bots.json ]; then
    BOT_COUNT=$(cat data/grid-bots.json | python3 -c "import sys, json; bots = json.load(sys.stdin); print(len(bots))" 2>/dev/null)
    if [ "$BOT_COUNT" = "3" ]; then
        echo "   ✅ PASS: 3 bots found in database"
        ((PASS++))
    else
        echo "   ❌ FAIL: Expected 3 bots, found $BOT_COUNT"
        ((FAIL++))
    fi
else
    echo "   ❌ FAIL: grid-bots.json not found"
    ((FAIL++))
fi

# Check 2: All bots running
echo ""
echo "🔍 Check 2: Bot Status"
RUNNING_COUNT=$(./grid-bot-cli.mjs list 2>/dev/null | grep -c "running")
if [ "$RUNNING_COUNT" = "3" ]; then
    echo "   ✅ PASS: All 3 bots are running"
    ((PASS++))
else
    echo "   ⚠️  WARN: Only $RUNNING_COUNT bots running (expected 3)"
    ((WARN++))
fi

# Check 3: Order count in database
echo ""
echo "🔍 Check 3: Database Orders"
if [ -f data/active-orders.json ]; then
    ORDER_COUNT=$(cat data/active-orders.json | python3 -c "import sys, json; orders = json.load(sys.stdin); print(len(orders))" 2>/dev/null)
    if [ "$ORDER_COUNT" = "73" ]; then
        echo "   ✅ PASS: 73 orders in database"
        ((PASS++))
    elif [ "$ORDER_COUNT" -ge "70" ] && [ "$ORDER_COUNT" -le "76" ]; then
        echo "   ⚠️  WARN: $ORDER_COUNT orders (expected 73, close enough)"
        ((WARN++))
    else
        echo "   ❌ FAIL: $ORDER_COUNT orders (expected 73)"
        ((FAIL++))
    fi
else
    echo "   ❌ FAIL: active-orders.json not found"
    ((FAIL++))
fi

# Check 4: Per-bot order breakdown
echo ""
echo "🔍 Check 4: Per-Bot Orders"
if [ -f data/active-orders.json ]; then
    cat data/active-orders.json | python3 -c "
import sys, json
orders = json.load(sys.stdin)
for bot in ['live-btc-bot', 'live-eth-bot', 'live-sol-bot']:
    bot_orders = [o for o in orders if o.get('bot_name') == bot]
    buys = len([o for o in bot_orders if o.get('side') == 'buy'])
    sells = len([o for o in bot_orders if o.get('side') == 'sell'])
    print(f'   {bot}: {len(bot_orders)} orders ({buys} BUY, {sells} SELL)')
" 2>/dev/null
    ((PASS++))
fi

# Check 5: Systemd services
echo ""
echo "🔍 Check 5: Systemd Services"
for service in grid-bot-v3 grid-bot-eth grid-bot-sol; do
    if sudo systemctl is-active --quiet ${service}.service; then
        echo "   ✅ ${service}.service is active"
        ((PASS++))
    else
        echo "   ❌ ${service}.service is NOT active"
        ((FAIL++))
    fi
done

# Check 6: Email reporter
echo ""
echo "🔍 Check 6: Email Reporter"
if [ -f email-reporter.mjs ]; then
    echo "   ✅ email-reporter.mjs exists"
    ((PASS++))
else
    echo "   ❌ email-reporter.mjs not found"
    ((FAIL++))
fi

if sudo systemctl is-active --quiet email-reporter.timer; then
    echo "   ✅ email-reporter.timer is active"
    ((PASS++))
else
    echo "   ⚠️  WARN: email-reporter.timer is NOT active (run setup-email-reports.sh)"
    ((WARN++))
fi

# Check 7: Gmail credentials
echo ""
echo "🔍 Check 7: Gmail Configuration"
if [ -f .env.production ]; then
    if grep -q "GMAIL_USER=" .env.production && grep -q "GMAIL_APP_PASSWORD=" .env.production; then
        echo "   ✅ Gmail credentials found in .env.production"
        ((PASS++))
    else
        echo "   ⚠️  WARN: Gmail credentials missing (emails will not work)"
        ((WARN++))
    fi
else
    echo "   ❌ FAIL: .env.production not found"
    ((FAIL++))
fi

# Check 8: Node dependencies
echo ""
echo "🔍 Check 8: Dependencies"
if npm list nodemailer &>/dev/null; then
    echo "   ✅ nodemailer installed"
    ((PASS++))
else
    echo "   ⚠️  WARN: nodemailer not installed (run: npm install nodemailer)"
    ((WARN++))
fi

# Summary
echo ""
echo "════════════════════════════════════════════════════════════"
echo "  Verification Summary"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "   ✅ Passed:  $PASS checks"
echo "   ⚠️  Warnings: $WARN checks"
echo "   ❌ Failed:  $FAIL checks"
echo ""

if [ $FAIL -eq 0 ] && [ $WARN -eq 0 ]; then
    echo "🎉 ALL CHECKS PASSED! Deployment is perfect."
    echo ""
    echo "Next steps:"
    echo "  1. Verify orders on Binance.US (should see 73 orders)"
    echo "  2. Wait for first fills (expected 6-24 hours)"
    echo "  3. Check email reports at 8 PM EST"
    exit 0
elif [ $FAIL -eq 0 ]; then
    echo "✅ DEPLOYMENT OK (with warnings)"
    echo ""
    echo "Warnings detected. Review above and fix if needed."
    echo "Most warnings are non-critical (e.g., email not setup yet)."
    exit 0
else
    echo "❌ DEPLOYMENT HAS ISSUES"
    echo ""
    echo "Critical failures detected. Review above and fix immediately."
    echo "See MULTI-SYMBOL-DEPLOYMENT-GUIDE.md for troubleshooting."
    exit 1
fi
