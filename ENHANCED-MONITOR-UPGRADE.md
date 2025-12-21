# Enhanced Monitor Upgrade Guide

## What's New in the Enhanced Monitor

The enhanced monitor includes **3 major improvements**:

### 1. Native Binance WebSocket for Real-Time Order Updates
- **Before:** Orders were detected by polling the REST API every 10 seconds
- **After:** Orders are detected instantly via WebSocket stream
- **Benefit:** Sub-second fill detection, reduced API calls

### 2. Continuous Order Database Synchronization
- **Before:** Database could get out of sync with exchange
- **After:** Automatic sync every 60 seconds + immediate sync after fills
- **Benefit:** Accurate order tracking, automatic repair of orphaned/missing orders

### 3. Smart Grid Rebalancing
- **Before:** Grid stayed fixed even when price moved far outside range
- **After:** Automatically adjusts grid when price moves >10% outside range
- **Benefit:** Capital stays active, adapts to market conditions

---

## Upgrade Instructions

### Step 1: SSH into your VPS
```bash
ssh root@your-vps-ip
```

### Step 2: Navigate to the bot directory
```bash
cd /root/binance-trading-bot-v3
```

### Step 3: Pull the latest code
```bash
git pull origin main
```

### Step 4: Install the new WebSocket dependency
```bash
pnpm install
```

If prompted to approve builds, select all and confirm with 'y'.

### Step 5: Test the enhanced monitor (optional)
```bash
node test-enhanced-monitor.mjs
```
You should see "Passed: 24, Failed: 0"

---

## Using the Enhanced Monitor

### Option A: Run manually (for testing)
```bash
# For BTC bot
node enhanced-monitor.mjs live-btc-bot

# For ETH bot
node enhanced-monitor.mjs live-eth-bot

# For SOL bot
node enhanced-monitor.mjs live-sol-bot
```

### Option B: Create new systemd services (recommended)

Create a new service file for each bot:

```bash
sudo nano /etc/systemd/system/enhanced-btc-bot.service
```

Paste this content:
```ini
[Unit]
Description=Enhanced BTC Grid Bot Monitor
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/binance-trading-bot-v3
ExecStart=/usr/bin/node enhanced-monitor.mjs live-btc-bot
Restart=always
RestartSec=10
StandardOutput=append:/root/binance-trading-bot-v3/logs/enhanced-btc-bot.log
StandardError=append:/root/binance-trading-bot-v3/logs/enhanced-btc-bot.log

[Install]
WantedBy=multi-user.target
```

Repeat for ETH and SOL (change `btc` to `eth` or `sol` and the bot name).

Then enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable enhanced-btc-bot.service
sudo systemctl start enhanced-btc-bot.service
```

---

## Configuration Options

The enhanced monitor accepts these command-line options:

| Option | Description | Default |
|--------|-------------|---------|
| `--no-rebalance` | Disable automatic grid rebalancing | Auto-rebalance ON |
| `--no-ws` | Disable native WebSocket (use REST only) | WebSocket ON |
| `--sync-interval <ms>` | Set sync interval in milliseconds | 60000 (1 minute) |

### Examples:
```bash
# Disable auto-rebalancing
node enhanced-monitor.mjs live-btc-bot --no-rebalance

# Use REST polling only (no native WebSocket)
node enhanced-monitor.mjs live-btc-bot --no-ws

# Sync every 30 seconds
node enhanced-monitor.mjs live-btc-bot --sync-interval 30000
```

---

## Rebalancing Behavior

The smart grid rebalancing works as follows:

| Setting | Value |
|---------|-------|
| Trigger threshold | Price moves >10% outside grid range |
| Minimum interval | 5 minutes between rebalances |
| Maximum daily | 10 rebalances per day |
| Grid shift | Centers grid around current price |

When a rebalance occurs:
1. All existing orders are cancelled
2. Bot configuration is updated with new grid range
3. New grid orders are placed
4. A log entry is recorded

---

## Monitoring

### View real-time logs:
```bash
# If using systemd service
journalctl -u enhanced-btc-bot.service -f

# Or if logging to file
tail -f /root/binance-trading-bot-v3/logs/enhanced-btc-bot.log
```

### Check service status:
```bash
sudo systemctl status enhanced-btc-bot.service
```

---

## Keeping the Old Monitor

The original monitor (`grid-bot-cli-v5.mjs monitor`) still works. You can:
- Run the old monitor for some bots
- Run the enhanced monitor for others
- Switch between them as needed

**Do not run both monitors for the same bot simultaneously!**

---

## Troubleshooting

### "WebSocket connection failed"
- This is normal for Binance.US - the native WebSocket may not work
- The monitor will automatically fall back to REST polling
- You'll see: "Falling back to periodic sync only"

### "Could not locate bindings file" (better-sqlite3)
Run:
```bash
pnpm approve-builds
pnpm rebuild better-sqlite3
```

### Bot not detecting fills
1. Check the sync is running: Look for "Sync:" messages in logs
2. Verify orders exist on exchange: `node health-check.mjs`
3. Try manual sync: `node sync.mjs --repair`

---

## Files Added

| File | Purpose |
|------|---------|
| `binance-websocket.mjs` | Native WebSocket connection to Binance.US |
| `enhanced-monitor.mjs` | Main enhanced monitor with all 3 improvements |
| `test-enhanced-monitor.mjs` | Test suite (24 tests) |

---

## Version History

- **v1.0.0** (Dec 21, 2024): Initial release with 3 enhancements
