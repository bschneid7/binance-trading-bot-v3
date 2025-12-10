# Grid Trading Bot - Dashboard Deployment Guide

This guide will help you deploy the Grid Trading Bot Dashboard to your DigitalOcean VPS.

## What is the Dashboard?

The dashboard is a beautiful, modern web interface that allows you to:

- **Create and manage grid trading bots** with an intuitive form
- **Monitor bot performance** with real-time statistics
- **View trading activity** including all buy/sell orders
- **Track profits** across all your bots
- **Start/stop bots** with a single click
- **Check Binance.US connection** and account balance

The dashboard features a stunning dark theme inspired by CleanMyMac, with gradient accents and a fully responsive design that works perfectly on mobile devices.

## Prerequisites

Before deploying, ensure you have:

1. **VPS Access**: SSH access to your DigitalOcean VPS at `209.38.74.84`
2. **Binance.US API Keys**: Your API key and secret from Binance.US
3. **GitHub Access**: The code is in the `binance-trading-bot-v3` repository

## Deployment Steps

### Step 1: SSH into Your VPS

Open your terminal and connect to your VPS:

```bash
ssh root@209.38.74.84
```

### Step 2: Navigate to Project Directory

```bash
cd /root/binance-trading-bot-v3
```

If the directory doesn't exist, clone the repository:

```bash
cd /root
gh repo clone bschneid7/binance-trading-bot-v3
cd binance-trading-bot-v3
```

### Step 3: Run the Deployment Script

The deployment script will automatically:
- Pull the latest code from GitHub
- Install Docker and Docker Compose (if not already installed)
- Create necessary directories
- Build the Docker container
- Start the dashboard

```bash
./deploy-dashboard.sh
```

### Step 4: Configure API Keys

If you haven't already, edit the `.env` file to add your Binance.US API keys:

```bash
nano .env
```

Update these lines:

```
BINANCE_API_KEY=your_actual_api_key_here
BINANCE_API_SECRET=your_actual_api_secret_here
PAPER_TRADING=true
```

Press `Ctrl+X`, then `Y`, then `Enter` to save.

### Step 5: Restart the Dashboard

After updating the `.env` file, restart the dashboard:

```bash
docker-compose -f docker-compose.dashboard.yml restart
```

### Step 6: Open Firewall Port

Make sure port 3001 is open in your firewall:

```bash
ufw allow 3001/tcp
ufw reload
```

### Step 7: Access the Dashboard

Open your web browser and navigate to:

```
http://209.38.74.84:3001
```

You should see the beautiful Grid Trading Bot Dashboard!

## Dashboard Features

### Header Section

The header displays:
- **Mode Badge**: Shows "PAPER TRADING" (green) or "LIVE TRADING" (red)
- **Connection Badge**: Shows "CONNECTED" (green) or "DISCONNECTED" (red)

### Statistics Cards

Four cards showing:
1. **USD Balance**: Your available USD balance
2. **BTC Balance**: Your available BTC balance
3. **Active Bots**: Number of running bots
4. **Total Profit**: Combined profit from all bots

### Create New Bot

Click "SHOW FORM" to reveal the bot creation form:

- **Bot Name**: Give your bot a unique name (e.g., "btc-bot-1")
- **Trading Pair**: Select BTC/USD, ETH/USD, or SOL/USD
- **Lower Price**: Minimum price for grid range (e.g., 90000)
- **Upper Price**: Maximum price for grid range (e.g., 100000)
- **Grid Levels**: Number of grid levels (e.g., 10)
- **Order Size**: USD amount per order (e.g., 100)

Click "CREATE BOT" to create the bot. It will appear in the "Your Bots" section below.

### Your Bots

Each bot card displays:
- **Name and Status**: Bot name with status badge (running/stopped)
- **Symbol**: Trading pair (e.g., BTC/USD)
- **Price Range**: Lower and upper price limits
- **Grid Levels**: Number of grid levels
- **Order Size**: USD amount per order
- **Trades**: Total number of trades executed
- **Profit**: Total profit (green if positive, red if negative)

**Actions**:
- **▶ Start**: Start the bot (if stopped)
- **⏸ Stop**: Stop the bot (if running)
- **🗑 Delete**: Delete the bot permanently

Click on any bot card to view detailed information including:
- Configuration details
- Statistics (buy/sell counts, average profit)
- Grid levels
- Recent trades

## Managing the Dashboard

### View Logs

To see what the dashboard is doing:

```bash
docker-compose -f docker-compose.dashboard.yml logs -f
```

Press `Ctrl+C` to stop viewing logs.

### Stop the Dashboard

```bash
docker-compose -f docker-compose.dashboard.yml down
```

### Start the Dashboard

```bash
docker-compose -f docker-compose.dashboard.yml up -d
```

### Restart the Dashboard

```bash
docker-compose -f docker-compose.dashboard.yml restart
```

### Check Dashboard Status

```bash
docker-compose -f docker-compose.dashboard.yml ps
```

### Update Dashboard

To get the latest version:

```bash
git pull origin main
docker-compose -f docker-compose.dashboard.yml up -d --build
```

## Troubleshooting

### Dashboard Won't Start

1. Check if Docker is running:
   ```bash
   systemctl status docker
   ```

2. View container logs:
   ```bash
   docker-compose -f docker-compose.dashboard.yml logs
   ```

3. Check if port 3001 is already in use:
   ```bash
   netstat -tulpn | grep 3001
   ```

### Can't Access Dashboard

1. Verify the container is running:
   ```bash
   docker ps | grep grid-bot-dashboard
   ```

2. Check firewall:
   ```bash
   ufw status
   ```

3. Test locally on VPS:
   ```bash
   curl http://localhost:3001/api/status
   ```

### API Connection Failed

1. Verify API keys are correct in `.env`
2. Check Binance.US API key permissions (need "Enable Reading" and "Enable Spot & Margin Trading")
3. Restart the dashboard after changing `.env`

### Bot Not Trading

1. Verify `PAPER_TRADING=true` in `.env` (for testing)
2. Check bot status in dashboard
3. View logs for errors
4. Ensure price range includes current market price

## Security Recommendations

1. **Use HTTPS**: Set up a reverse proxy with SSL (nginx + Let's Encrypt)
2. **Restrict Access**: Use firewall rules to limit dashboard access to your IP
3. **Strong API Keys**: Use read-only API keys for testing
4. **Regular Backups**: Backup the `data` directory regularly
5. **Monitor Logs**: Check logs daily for suspicious activity

## Mobile Access

The dashboard is fully responsive and works great on mobile devices:

- **Portrait Mode**: Optimized for phone screens
- **Landscape Mode**: Better view of statistics and bot cards
- **Touch-Friendly**: Large buttons and touch targets
- **Fast Loading**: Lightweight and optimized

Simply open the dashboard URL on your phone's browser!

## Data Storage

All bot data is stored in the `data` directory:

- `data/grid-bots.json`: Bot configurations and state
- `logs/`: Application logs

To backup your data:

```bash
tar -czf grid-bot-backup-$(date +%Y%m%d).tar.gz data/
```

To restore from backup:

```bash
tar -xzf grid-bot-backup-YYYYMMDD.tar.gz
```

## Next Steps

1. **Test with Paper Trading**: Create a bot with conservative parameters
2. **Monitor for 24-48 Hours**: Verify the bot works correctly
3. **Analyze Performance**: Check profit/loss and win rate
4. **Adjust Parameters**: Fine-tune grid range and order size
5. **Run for 30 Days**: Validate strategy before live trading
6. **Consider Live Trading**: Only after successful paper trading validation

## Support

If you encounter any issues:

1. Check the logs first
2. Review this guide
3. Verify your configuration
4. Test with a simple bot first

## Important Reminders

⚠️ **PAPER TRADING MODE**
- No real orders are placed
- No real money at risk
- All trades are simulated
- Perfect for testing and learning

⚠️ **LIVE TRADING WARNING**
- Only enable after 30+ days of successful paper trading
- Start with small amounts
- Monitor closely
- Understand the risks
- Never invest more than you can afford to lose

## Conclusion

You now have a beautiful, functional dashboard for managing your Grid Trading Bots! The interface is intuitive, mobile-friendly, and packed with features to help you trade successfully.

Happy trading! 🚀
