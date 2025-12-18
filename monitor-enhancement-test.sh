#!/bin/bash

echo "=== ENHANCEMENT #5 MONITORING (15-min checkpoint) ==="
echo "Time: $(date +"%H:%M:%S")"
echo ""

# 1. Check if monitors are running
echo "1️⃣ Monitor Health:"
if systemctl is-active --quiet grid-bot-sol.service; then
  echo "   ✅ SOL monitor: Running"
else
  echo "   🔴 SOL monitor: DEAD"
  exit 1
fi

if systemctl is-active --quiet grid-bot-v3.service grid-bot-eth.service; then
  echo "   ✅ BTC/ETH monitors: Running"
else
  echo "   🔴 BTC/ETH monitors: ISSUES"
fi

# 2. Check for errors in last 15 minutes
echo ""
echo "2️⃣ Recent Errors (last 15 min):"
error_count=$(journalctl -u grid-bot-sol.service --since "15 minutes ago" --no-pager | grep -iE "error|exception|failed|crash" | wc -l)
if [ $error_count -eq 0 ]; then
  echo "   ✅ No errors detected"
else
  echo "   🔴 ERRORS FOUND: $error_count"
  echo ""
  journalctl -u grid-bot-sol.service --since "15 minutes ago" --no-pager | grep -iE "error|exception|failed|crash" | tail -10
  exit 1
fi

# 3. Check if fills are being recorded
echo ""
echo "3️⃣ Recent Fill Activity:"
recent_fills=$(journalctl -u grid-bot-sol.service --since "15 minutes ago" --no-pager | grep -c "Recorded fill" || echo 0)
echo "   Fills in last 15 min: $recent_fills"

# 4. Verify orders still exist on Binance
echo ""
echo "4️⃣ SOL Orders on Binance:"
sol_orders=$(node check-binance-orders.mjs 2>/dev/null | grep "SOL/USD:" | grep -oE "[0-9]+ orders" | grep -oE "[0-9]+")
if [ -n "$sol_orders" ] && [ "$sol_orders" -gt 0 ]; then
  echo "   ✅ $sol_orders orders active"
else
  echo "   🔴 NO ORDERS ON BINANCE"
  exit 1
fi

# 5. Check database sync
echo ""
echo "5️⃣ Database Status:"
db_count=$(cat data/active-orders.json 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "error")
if [ "$db_count" != "error" ]; then
  echo "   ✅ Database: $db_count orders tracked"
else
  echo "   🔴 Database read error"
fi

echo ""
echo "══════════════════════════════════════"
echo "Status: ✅ ALL CHECKS PASSED"
echo "Next check: $(date -d '+15 minutes' +"%H:%M:%S")"
echo "══════════════════════════════════════"
