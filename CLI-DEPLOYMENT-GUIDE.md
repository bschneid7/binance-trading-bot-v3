# Grid Bot CLI - Deployment Guide

## What is This?

This is a **command-line interface (CLI)** tool to manage your Grid Trading Bots **without needing the web dashboard**. You can create, start, stop, and monitor bots directly from your terminal.

---

## Prerequisites

Before deploying, make sure you have:

1. ✅ SSH access to your VPS (209.38.74.84)
2. ✅ Binance.US API keys (already configured on VPS)
3. ✅ Node.js installed on VPS (already done)
4. ✅ Project files on VPS (already deployed)

---

## Step-by-Step Deployment Instructions

### Step 1: Connect to Your VPS

Open Terminal on your Mac and run:

```bash
ssh root@209.38.74.84
```

Enter your password when prompted.

---

### Step 2: Navigate to Project Directory

```bash
cd ~/binance-trading-bot-v3
```

---

### Step 3: Upload the CLI Tool

Since the CLI tool (`grid-bot-cli.mjs`) was created in this chat, you need to upload it to your VPS.

**Option A: Copy from GitHub (if you push it)**

```bash
git pull origin main
```

**Option B: Create the file manually on VPS**

I'll provide you with a command to download it directly.

---

### Step 4: Make CLI Executable

```bash
chmod +x grid-bot-cli.mjs
```

---

### Step 5: Create a Symlink (Optional - for easier access)

This allows you to run `grid-bot-cli` from anywhere:

```bash
sudo ln -s /root/binance-trading-bot-v3/grid-bot-cli.mjs /usr/local/bin/grid-bot-cli
```

Now you can run `grid-bot-cli` instead of `node grid-bot-cli.mjs`.

---

## How to Use the CLI

### 1. Check System Status

```bash
node grid-bot-cli.mjs status
```

This will show:
- Connection to Binance.US
- Account balance
- Number of bots running
- Total trades and profits

---

### 2. Create a New Grid Bot

```bash
node grid-bot-cli.mjs create \
  --name btc-bot \
  --symbol BTC/USD \
  --lower 90000 \
  --upper 100000 \
  --grids 10 \
  --size 100
```

**Parameters:**
- `--name`: Unique name for your bot
- `--symbol`: Trading pair (default: BTC/USD)
- `--lower`: Lower price boundary
- `--upper`: Upper price boundary
- `--grids`: Number of grid levels (more = tighter spacing)
- `--size`: Order size in USD per grid level

---

### 3. List All Bots

```bash
node grid-bot-cli.mjs list
```

Shows all your bots with their status, configuration, and performance.

---

### 4. Show Bot Details

```bash
node grid-bot-cli.mjs show --name btc-bot
```

Shows:
- Current market price
- Grid levels
- Recent trades
- Profit statistics

---

### 5. Start a Bot

```bash
node grid-bot-cli.mjs start --name btc-bot
```

**⚠️ Important:** This only marks the bot as "running" in the database. To actually execute trades, you need to run the bot engine (see next section).

---

### 6. Stop a Bot

```bash
node grid-bot-cli.mjs stop --name btc-bot
```

---

### 7. Delete a Bot

```bash
node grid-bot-cli.mjs delete --name btc-bot
```

Add `--force` to delete a running bot:

```bash
node grid-bot-cli.mjs delete --name btc-bot --force
```

---

## Running the Bot Continuously

The CLI tool is for **management only**. To actually execute trades 24/7, you need to:

### Option 1: Use the Existing Docker Deployment

The bot should already be running in Docker on your VPS. Check with:

```bash
docker ps
```

Look for `grid-trading-bot` container.

### Option 2: Run Bot Engine Manually (for testing)

If you want to test the bot without Docker:

```bash
cd ~/binance-trading-bot-v3
node grid-bot-engine.mjs
```

(Note: This file needs to be created separately)

---

## Data Storage

The CLI stores bot configurations and trade history in JSON files:

- **Bots:** `/root/binance-trading-bot-v3/data/grid-bots.json`
- **Trades:** `/root/binance-trading-bot-v3/data/grid-trades.json`

These files are automatically created when you first use the CLI.

---

## Troubleshooting

### "Cannot connect to Binance.US"

Check your API keys in `.env.production`:

```bash
cat ~/.binance-trading-bot-v3/.env.production
```

Make sure `BINANCE_API_KEY` and `BINANCE_API_SECRET` are set correctly.

### "Bot not found"

List all bots to see available names:

```bash
node grid-bot-cli.mjs list
```

### "Permission denied"

Make sure the CLI is executable:

```bash
chmod +x grid-bot-cli.mjs
```

---

## Safety Reminders

⚠️ **PAPER TRADING MODE**

The bot is currently in **paper trading mode** (`BINANCE_TEST_MODE=true`). This means:
- ✅ No real orders are placed
- ✅ No real money is at risk
- ✅ All trades are simulated

To switch to live trading (NOT RECOMMENDED until after 30 days of testing):

```bash
nano ~/.binance-trading-bot-v3/.env.production
# Change BINANCE_TEST_MODE=true to BINANCE_TEST_MODE=false
# Save and restart the bot
```

---

## Next Steps

1. **Create your first bot** with conservative parameters
2. **Monitor it for 24-48 hours** using `grid-bot-cli show --name <name>`
3. **Check trades and profits** regularly
4. **Adjust parameters** if needed
5. **Run for 30 days minimum** before considering live trading

---

## Quick Reference

```bash
# Check status
node grid-bot-cli.mjs status

# Create bot
node grid-bot-cli.mjs create --name <name> --lower <price> --upper <price> --grids <count> --size <amount>

# List bots
node grid-bot-cli.mjs list

# Show bot
node grid-bot-cli.mjs show --name <name>

# Start bot
node grid-bot-cli.mjs start --name <name>

# Stop bot
node grid-bot-cli.mjs stop --name <name>

# Delete bot
node grid-bot-cli.mjs delete --name <name>

# Help
node grid-bot-cli.mjs help
```

---

## Support

If you encounter any issues:

1. Check the logs: `docker logs -f grid-trading-bot`
2. Verify API connection: `node grid-bot-cli.mjs status`
3. Review bot configuration: `node grid-bot-cli.mjs show --name <name>`

---

**Document Version:** 1.0  
**Last Updated:** December 9, 2025  
**Created By:** Manus AI Assistant
