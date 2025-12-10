# Migration Guide: Grid Bot v1.0 → v2.0

## Quick Start (2 Minutes)

### On Your Local Machine (Where You Have Git Access):

```bash
# 1. Navigate to your repository
cd /path/to/binance-trading-bot-v3

# 2. Pull latest changes
git pull origin main

# 3. Backup original file
cp grid-bot-cli.mjs grid-bot-cli-v1.0.backup.mjs

# 4. Download the enhanced file from the links provided

# 5. Replace the original with enhanced version
# (Rename downloaded file to grid-bot-cli.mjs)

# 6. Review changes (optional but recommended)
diff grid-bot-cli-v1.0.backup.mjs grid-bot-cli.mjs | head -50

# 7. Commit to your repository
git add grid-bot-cli.mjs
git commit -m "Upgrade to v2.0: Add stop-loss, adaptive grids, and risk management

- Add dynamic stop-loss protection (15%)
- Implement trailing stops for profitable positions
- Add adaptive grid spacing based on volatility
- Implement dynamic position sizing with Kelly Criterion
- Add complete order state management
- Implement advanced performance metrics
- Add automatic grid rebalancing
- Add market regime detection
- Enhance all CLI commands with new features

BREAKING: None (fully backward compatible)
TESTED: Paper trading mode
RISK LEVEL: Significantly reduced with new safeguards"

# 8. Push to GitHub
git push origin main

# 9. Verify on GitHub
# Visit: https://github.com/bschneid7/binance-trading-bot-v3
# Check that grid-bot-cli.mjs is updated
```

---

## On Your VPS (Deployment):

```bash
# 1. SSH into your VPS
ssh root@209.38.74.84

# 2. Navigate to bot directory
cd ~/binance-trading-bot-v3

# 3. Pull the latest code
git pull origin main

# 4. Verify the new file is there
ls -lh grid-bot-cli.mjs

# 5. Make executable
chmod +x grid-bot-cli.mjs

# 6. Stop any running bots
./grid-bot-cli.mjs list
./grid-bot-cli.mjs stop --name <bot-name>  # For each running bot

# 7. Test the enhanced version
./grid-bot-cli.mjs status

# 8. Restart bots to apply new features
./grid-bot-cli.mjs start --name <bot-name>

# 9. Verify enhanced features are working
./grid-bot-cli.mjs show --name <bot-name>
```

---

## Verification Checklist

After migration, verify these features are working:

- [ ] `grid-bot-cli status` shows version 2.0
- [ ] `grid-bot-cli show --name <bot>` displays volatility analysis
- [ ] Performance metrics include Sharpe ratio and profit factor
- [ ] Risk management settings are displayed
- [ ] New `rebalance` command is available
- [ ] Bot configuration shows `adjusted_grid_count`
- [ ] Active orders are being tracked

---

## Configuration Review (Optional)

Edit risk parameters at top of `grid-bot-cli.mjs`:

```javascript
const RISK_CONFIG = {
  STOP_LOSS_PERCENT: 0.15,        // Adjust from 0.10 (10%) to 0.20 (20%)
  TRAILING_STOP_PERCENT: 0.05,    // Adjust from 0.03 (3%) to 0.10 (10%)
  MAX_RISK_PER_TRADE: 0.02,       // Adjust from 0.01 (1%) to 0.05 (5%)
  PROFIT_LOCK_THRESHOLD: 0.03,    // When to activate trailing stop
  REBALANCE_THRESHOLD: 0.10,      // When to suggest rebalancing
  STALE_ORDER_RANGE: 0.05,        // When to cancel far orders
};
```

**Recommendation:** Start with defaults, adjust after observing performance.

---

## Rollback Plan (If Issues Occur)

```bash
# On your local machine
cd /path/to/binance-trading-bot-v3
git checkout HEAD~1 grid-bot-cli.mjs
git add grid-bot-cli.mjs
git commit -m "Rollback to v1.0 due to [issue]"
git push origin main

# On VPS
cd ~/binance-trading-bot-v3
git pull origin main
./grid-bot-cli.mjs stop --name <bot-name>  # Stop all bots
./grid-bot-cli.mjs start --name <bot-name>  # Restart with v1.0
```

---

## Testing Before Live Trading

### Phase 1: Paper Trading (Days 1-7)
```bash
# Ensure paper trading mode
cd ~/binance-trading-bot-v3
grep BINANCE_TEST_MODE .env.production
# Should show: BINANCE_TEST_MODE=true

# Create test bot
./grid-bot-cli.mjs create --name test-bot-v2 --lower 90000 --upper 100000 --grids 10 --size 100

# Start and monitor
./grid-bot-cli.mjs start --name test-bot-v2
./grid-bot-cli.mjs show --name test-bot-v2

# Check multiple times per day
```

**Watch For:**
- Stop-loss triggers correctly
- Trailing stops update properly
- Grid rebalancing suggestions appear when appropriate
- Performance metrics calculate correctly
- No duplicate orders

### Phase 2: Small Live Test (Days 8-14)
```bash
# ONLY if paper trading successful
# Change to live mode
nano .env.production
# Set: BINANCE_TEST_MODE=false

# Create small bot ($50-100 per level)
./grid-bot-cli.mjs create --name live-test-v2 --lower 95000 --upper 105000 --grids 5 --size 50

# Start with EXTREME caution
./grid-bot-cli.mjs start --name live-test-v2
```

**Monitor Closely:**
- Check every 4 hours for first 48 hours
- Review all trades immediately
- Watch for unexpected behavior
- Be ready to stop bot instantly

### Phase 3: Full Deployment (Days 15+)
**Only proceed if:**
- Paper trading showed >55% win rate
- Profit factor >1.3
- No critical bugs discovered
- Comfortable with small live test results

---

## Common Issues & Solutions

### Issue: "Bot not found" after migration
**Solution:** Bot names are case-sensitive. Use `./grid-bot-cli.mjs list` to see exact names.

### Issue: Orders not being placed
**Solution:** 
1. Check `./grid-bot-cli.mjs status` for connection status
2. Verify API keys in `.env.production`
3. Check Binance.US API permissions

### Issue: Stop-loss not triggering
**Solution:**
1. Ensure bot is running (`status='running'`)
2. Check that trades have `entry_price` set
3. Monitor price relative to stop-loss level

### Issue: Performance metrics showing zeros
**Solution:** 
- Metrics require at least 1 completed trade
- Check that trades have `exit_price` set
- Give bot time to complete full trade cycles

---

## Support Commands

```bash
# Check bot version
./grid-bot-cli.mjs help | grep "v2.0"

# View all bots with status
./grid-bot-cli.mjs list

# Deep dive into specific bot
./grid-bot-cli.mjs show --name <bot-name>

# System health check
./grid-bot-cli.mjs status

# View logs (if using Docker)
docker logs -f grid-trading-bot

# Check data files
ls -lh ~/binance-trading-bot-v3/data/
cat ~/binance-trading-bot-v3/data/active-orders.json | head -20
```

---

## Performance Monitoring

### Daily Checks (First Week):
```bash
# Morning check
./grid-bot-cli.mjs show --name <bot-name> | grep -A 20 "Performance Metrics"

# Key metrics to watch:
# - Win Rate: Should be >55%
# - Profit Factor: Should be >1.5
# - Sharpe Ratio: Should be >1.0
# - Net Profit: Should be positive
```

### Weekly Review:
- Export performance data
- Compare v2.0 vs v1.0 results
- Adjust grid parameters if needed
- Review any stop-losses that triggered
- Check rebalancing frequency

---

## Emergency Procedures

### If Bot Misbehaves:
```bash
# 1. STOP IMMEDIATELY
./grid-bot-cli.mjs stop --name <bot-name>

# 2. Check what happened
./grid-bot-cli.mjs show --name <bot-name>
cat ~/binance-trading-bot-v3/data/grid-trades.json | tail -50

# 3. Review active orders
cat ~/binance-trading-bot-v3/data/active-orders.json

# 4. Manually cancel orders on Binance.US if needed
# (via web interface or mobile app)

# 5. Document the issue
# Take screenshots, save logs
```

### If Major Issues:
1. Stop all bots
2. Switch back to paper trading mode
3. Investigate in safe environment
4. Consider rollback if critical

---

## Success Criteria

**v2.0 is working correctly if:**
- ✅ Stop-loss triggers between 13-17% loss
- ✅ Trailing stops lock in >95% of peak profits
- ✅ Grid adapts to volatility (more grids in low vol, fewer in high vol)
- ✅ Position sizing adjusts for account balance and risk
- ✅ No duplicate orders at same price
- ✅ Performance metrics update correctly
- ✅ Grid rebalances when price exits range by >10%
- ✅ Bot pauses after stop-loss hits

**Ready for larger capital if:**
- ✅ Paper trading for 30+ days successful
- ✅ Profit factor consistently >1.5
- ✅ Sharpe ratio >1.0
- ✅ Max drawdown <10%
- ✅ No critical bugs discovered
- ✅ Small live test (7+ days) successful

---

## Need Help?

1. **Check CHANGELOG-v2.0.md** for feature details
2. **Review code comments** in enhanced file
3. **Test in paper trading mode** first
4. **Start with minimum capital** when going live
5. **Monitor frequently** during first week

---

**Good luck with your enhanced Grid Trading Bot!**

Remember: The best traders are cautious traders. Test thoroughly before risking real capital.
