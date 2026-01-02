# ETH Bot Fix - Quick Start

**Purpose**: Fix ETH bot database sync issue and recapitalize with $2,000

**Capital**: $2,000 from $6,055 USD available  
**Time**: 30-45 minutes  
**Deadline**: January 14, 2026

---

## Files Included

1. **eth_bot_fix_quick_start.md** - Simplest guide (6 steps, 30 min) ⭐ RECOMMENDED
2. **eth_bot_fix_checklist.txt** - Printable checklist to track progress
3. **eth_bot_fix_final_commands.txt** - Detailed commands with color codes
4. **eth_bot_fix_commands.sh** - Automated bash script with prompts

---

## Quick Start (Recommended)

### Option A: Follow the Quick Start Guide

```bash
# 1. Pull the latest files
cd /root/binance-trading-bot-v3
git pull origin main

# 2. Read the guide
cat eth_bot_fix_quick_start.md

# 3. Follow the 6 steps in the guide
```

### Option B: Run the Automated Script

```bash
# 1. Pull the latest files
cd /root/binance-trading-bot-v3
git pull origin main

# 2. Run the script
bash eth_bot_fix_commands.sh

# 3. Follow the prompts (press ENTER at each pause)
```

---

## What This Fix Does

**Before**:
- ETH holdings: $97 (undercapitalized)
- Orders: 25 (24 buy / 1 sell) - Unbalanced
- Database: 0 orders (out of sync)
- Status: Not trading (247 hour drought)

**After**:
- ETH holdings: $1,890 (fully capitalized) ✅
- Orders: 32 (16 buy / 16 sell) - Balanced ✅
- Database: 32 orders (in sync) ✅
- Status: Ready to trade ✅

---

## Manual Steps Required

Two steps cannot be automated and require Binance.US website:

1. **Cancel orders** (Phase 2): Cancel all 25 ETH/USD orders
2. **Buy ETH** (Phase 3): Purchase 0.59 ETH (~$1,800)

Everything else is automated via CLI commands.

---

## Success Criteria

After completion, verify:
- ✅ Bot status: 🟢 Running
- ✅ Database orders: 28-32 (not 0)
- ✅ Exchange orders: 28-32 (not 25)
- ✅ Order balance: ~16 buy / ~16 sell (not 24/1)
- ✅ ETH balance: ~0.621 ETH (~$1,890)

---

## Need Help?

Check logs:
```bash
tail -50 logs/live-eth-bot.log
```

Run health check:
```bash
node health-check.mjs | grep -A 30 "live-eth-bot"
```

Restore from backup (if needed):
```bash
cp data/grid-bot.db.backup.YYYYMMDD_HHMMSS data/grid-bot.db
```

---

## Timeline

- **Today**: Execute fix (30-45 min)
- **Next 7 days**: Daily monitoring
- **Jan 7**: Weekly review
- **Jan 14**: Verify success (deadline)

---

**Ready to start?** Open `eth_bot_fix_quick_start.md` and follow the steps!
