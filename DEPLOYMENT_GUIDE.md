# Grid Trading Bot - VPS Deployment Guide

This guide will walk you through deploying the Grid Trading Bot to your DigitalOcean VPS.

---

## Prerequisites

✅ DigitalOcean VPS (Ubuntu 24.04, 2vCPU/4GB RAM)  
✅ Docker and Docker Compose installed on VPS  
✅ Binance.US API credentials  
✅ Manus project environment variables  

---

## Step 1: Prepare Your VPS

### SSH into your VPS:
```bash
ssh root@209.38.74.84
```

### Install Docker (if not already installed):
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
```

### Install Docker Compose (if not already installed):
```bash
apt-get update
apt-get install -y docker-compose-plugin
```

### Verify installation:
```bash
docker --version
docker compose version
```

---

## Step 2: Transfer Code to VPS

### Option A: Using Git (Recommended)
```bash
# On VPS
cd ~
git clone https://github.com/YOUR_USERNAME/binance-trading-bot-v3.git
cd binance-trading-bot-v3
```

### Option B: Using SCP (from your Mac)
```bash
# On your Mac
cd /path/to/binance-trading-bot-v3
tar -czf grid-bot.tar.gz .
scp grid-bot.tar.gz root@209.38.74.84:~/

# Then on VPS
cd ~
mkdir -p binance-trading-bot-v3
tar -xzf grid-bot.tar.gz -C binance-trading-bot-v3
cd binance-trading-bot-v3
```

---

## Step 3: Configure Environment Variables

### Create .env.production file:
```bash
# On VPS
cd ~/binance-trading-bot-v3
cp .env.production.template .env.production
nano .env.production
```

### Fill in these critical values:

#### Binance.US API (Get from: https://www.binance.us/en/usercenter/settings/api-management)
```
BINANCE_API_KEY=your_actual_api_key_here
BINANCE_API_SECRET=your_actual_api_secret_here
BINANCE_TEST_MODE=true  # Keep as "true" for paper trading!
```

#### Database (TiDB from Manus - get from project settings)
```
DATABASE_URL=mysql://user:password@host:port/database?ssl={"rejectUnauthorized":true}
```

#### Manus Authentication (get from Manus project)
```
JWT_SECRET=your_jwt_secret
VITE_APP_ID=your_app_id
OWNER_OPEN_ID=your_owner_id
OWNER_NAME=Your Name
```

#### Manus APIs (get from Manus project)
```
BUILT_IN_FORGE_API_KEY=your_forge_key
VITE_FRONTEND_FORGE_API_KEY=your_frontend_key
```

**Save and exit:** Press `Ctrl+X`, then `Y`, then `Enter`

---

## Step 4: Deploy the Bot

### Run the deployment script:
```bash
cd ~/binance-trading-bot-v3
./deploy-grid-bot.sh
```

### What this does:
1. ✅ Checks for required files
2. ✅ Verifies Docker is installed
3. ✅ Stops any existing containers
4. ✅ Builds the Grid Trading Bot image
5. ✅ Starts the container
6. ✅ Verifies it's running

---

## Step 5: Verify Deployment

### Check container status:
```bash
docker ps
```

You should see:
```
CONTAINER ID   IMAGE                    STATUS         PORTS                    NAMES
xxxxx          grid-trading-bot         Up 2 minutes   0.0.0.0:3000->3000/tcp   grid-trading-bot
```

### View logs:
```bash
docker logs -f grid-trading-bot
```

Press `Ctrl+C` to exit logs.

### Access the dashboard:
Open in your browser:
```
http://209.38.74.84:3000
```

---

## Step 6: Create Your First Grid Bot

1. **Log in** to the dashboard
2. **Go to Settings** → Enter your Binance.US API credentials
3. **Go to Grid Bots** → Click "Create New Grid Bot"
4. **Configure:**
   - Symbol: BTC/USD
   - Lower Price: $90,000
   - Upper Price: $100,000
   - Grid Count: 10
   - Order Size: $100
5. **Click "Create Grid Bot"**
6. **Click "Start"** to begin paper trading

---

## Useful Commands

### View logs:
```bash
docker logs -f grid-trading-bot
```

### Stop the bot:
```bash
cd ~/binance-trading-bot-v3
docker-compose -f docker-compose.production.yml down
```

### Restart the bot:
```bash
cd ~/binance-trading-bot-v3
docker-compose -f docker-compose.production.yml restart
```

### Update the bot:
```bash
cd ~/binance-trading-bot-v3
git pull  # If using git
./deploy-grid-bot.sh
```

### Check container resource usage:
```bash
docker stats grid-trading-bot
```

---

## Troubleshooting

### Bot won't start:
```bash
# Check logs for errors
docker logs grid-trading-bot

# Check if port 3000 is already in use
netstat -tuln | grep 3000

# Restart Docker
systemctl restart docker
```

### Database connection errors:
- Verify DATABASE_URL in .env.production
- Check if TiDB allows connections from your VPS IP
- Test connection: `mysql -h HOST -u USER -p`

### API errors:
- Verify BINANCE_API_KEY and BINANCE_API_SECRET
- Check if API key has trading permissions
- Ensure IP whitelist includes your VPS IP (if enabled)

### Can't access dashboard:
- Check if port 3000 is open: `ufw allow 3000`
- Verify container is running: `docker ps`
- Check firewall rules in DigitalOcean dashboard

---

## Security Best Practices

1. ✅ **Keep BINANCE_TEST_MODE=true** until you've validated the strategy
2. ✅ **Use API key restrictions** (trading only, no withdrawals)
3. ✅ **Enable IP whitelist** on Binance.US API settings
4. ✅ **Set up firewall** to only allow necessary ports
5. ✅ **Regular backups** of your configuration
6. ✅ **Monitor logs daily** for any issues

---

## Paper Trading Validation

**IMPORTANT:** Run the bot in paper trading mode for at least 30 days before enabling live trading!

### What to monitor:
- ✅ Win rate (target: >60%)
- ✅ Average profit per trade
- ✅ Maximum drawdown
- ✅ Grid fill rate
- ✅ Bot stability (no crashes)

### After 30 days:
1. Review performance metrics
2. If profitable and stable → consider live trading with small capital ($500)
3. If not profitable → adjust parameters and test again

---

## Going Live (After Paper Trading)

### When you're ready for live trading:

1. **Update .env.production:**
```bash
nano ~/binance-trading-bot-v3/.env.production
# Change: BINANCE_TEST_MODE=false
```

2. **Restart the bot:**
```bash
cd ~/binance-trading-bot-v3
docker-compose -f docker-compose.production.yml restart
```

3. **Start with small capital:**
- First week: $500 max
- If profitable: Gradually increase

4. **Monitor closely:**
- Check dashboard 2-3 times per day
- Review all trades
- Watch for any errors

---

## Support

If you encounter issues:
1. Check logs: `docker logs grid-trading-bot`
2. Review this guide
3. Check Manus project documentation
4. Verify all environment variables are correct

---

**Good luck with your Grid Trading Bot!** 🚀

Remember: Start with paper trading, be patient, and never risk more than you can afford to lose.
