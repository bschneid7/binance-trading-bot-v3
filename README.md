# Grid Trading Bot v5.1.0

A sophisticated cryptocurrency grid trading bot for Binance.US with adaptive strategies, comprehensive risk management, and real-time monitoring.

## Features

- **Grid Trading Strategy**: Automatically places buy and sell orders across a price range to profit from market volatility
- **Adaptive Position Sizing**: Uses Kelly Criterion for optimal position sizing based on historical performance
- **Real-Time Monitoring**: 10-second price polling with WebSocket support (where available)
- **Risk Management**: Stop-loss, trailing stops, and maximum drawdown protection
- **SQLite Database**: Robust state management with transactional integrity
- **Email Notifications**: Daily health reports and critical error alerts
- **Systemd Integration**: Automatic restart and boot persistence
- **Tax Reporting**: Comprehensive tax reporting for US-based traders. See [TAX_REPORTING.md](TAX_REPORTING.md) for details.

## Quick Start

### Prerequisites

- Node.js 18.0.0 or higher
- Binance.US account with API access
- DigitalOcean VPS (Ubuntu 22.04 recommended)

### Installation

```bash
# Clone the repository
git clone https://github.com/bschneid7/binance-trading-bot-v3.git
cd binance-trading-bot-v3

# Install dependencies
npm install --legacy-peer-deps

# Configure environment
cp .env.example .env.production
nano .env.production  # Add your API keys
```

### Configuration

Edit `.env.production` with your credentials:

```env
# Binance.US API Credentials
BINANCE_API_KEY=your_api_key_here
BINANCE_API_SECRET=your_api_secret_here

# Trading Mode (set to 'true' for paper trading)
PAPER_TRADING_MODE=false

# Email Notifications (optional)
GMAIL_USER=your-email@gmail.com
GMAIL_APP_PASSWORD=your-app-password
```

### Running the Bot

```bash
# Create a new bot
node grid-bot-cli-v5.mjs create \
  --name my-btc-bot \
  --symbol BTC/USD \
  --lower 85000 \
  --upper 95000 \
  --grids 20 \
  --capital 1000

# Start the bot
node grid-bot-cli-v5.mjs start --name my-btc-bot

# Monitor the bot
node grid-bot-cli-v5.mjs monitor --name my-btc-bot
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `create` | Create a new grid trading bot |
| `list` | List all configured bots |
| `show` | Show detailed bot information |
| `start` | Start a bot and place grid orders |
| `stop` | Stop a bot and cancel all orders |
| `monitor` | Start real-time price monitoring |
| `status` | Quick status check |

### Examples

```bash
# List all bots
node grid-bot-cli-v5.mjs list

# Show bot details
node grid-bot-cli-v5.mjs show --name my-btc-bot

# Stop a bot
node grid-bot-cli-v5.mjs stop --name my-btc-bot

# Run health check
node health-check.mjs

# Send health check email
node health-check-email.mjs
```

## Production Deployment

### Setting Up Systemd Services

```bash
# Run the setup script
sudo bash setup-services.sh

# Start the bot services
sudo systemctl start grid-bot-btc.service
sudo systemctl start grid-bot-eth.service
sudo systemctl start grid-bot-sol.service

# Check status
sudo systemctl status grid-bot-btc.service
```

### Service Management

| Command | Description |
|---------|-------------|
| `sudo systemctl start grid-bot-btc.service` | Start BTC bot |
| `sudo systemctl stop grid-bot-btc.service` | Stop BTC bot |
| `sudo systemctl restart grid-bot-btc.service` | Restart BTC bot |
| `sudo systemctl status grid-bot-btc.service` | Check status |
| `journalctl -u grid-bot-btc.service -f` | View logs |

### Daily Health Check Email

The bot sends a daily health report at 8 AM UTC. To check the timer:

```bash
systemctl list-timers health-check-email.timer
```

## Architecture

```
binance-trading-bot-v3/
├── grid-bot-cli-v5.mjs    # Main CLI application
├── database.mjs           # SQLite database manager
├── websocket-feed.mjs     # Real-time price feed
├── config.mjs             # Centralized configuration
├── error-handler.mjs      # Error handling with backoff
├── health-check.mjs       # Health check utility
├── health-check-email.mjs # Email health reports
├── enhancements.mjs       # Adaptive trading enhancements
├── data/
│   └── grid-bot.db        # SQLite database
├── logs/
│   ├── live-btc-bot.log   # BTC bot logs
│   ├── live-eth-bot.log   # ETH bot logs
│   └── live-sol-bot.log   # SOL bot logs
└── systemd/
    ├── grid-bot-btc.service
    ├── grid-bot-eth.service
    ├── grid-bot-sol.service
    └── health-check-email.timer
```

## Configuration Reference

### Grid Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `symbol` | Trading pair (e.g., BTC/USD) | Required |
| `lower` | Lower price bound | Required |
| `upper` | Upper price bound | Required |
| `grids` | Number of grid levels | 10 |
| `capital` | Total capital to deploy | Required |

### Risk Management

| Setting | Description | Default |
|---------|-------------|---------|
| Stop-Loss | Trigger at percentage loss | 15% |
| Trailing Stop | Trail by percentage | 5% |
| Max Drawdown | Maximum allowed drawdown | 25% |

### Monitoring

| Setting | Description | Default |
|---------|-------------|---------|
| Polling Interval | REST API fallback interval | 10 seconds |
| Stale Data Threshold | Alert if data older than | 60 seconds |

## Migration from v4.x

If you have existing data in JSON files, run the migration script:

```bash
node migrate-to-sqlite.mjs
```

This will safely migrate your data from:
- `data/grid-bots.json`
- `data/active-orders.json`
- `data/grid-trades.json`

To the new SQLite database at `data/grid-bot.db`.

## Testing

Run the test suite:

```bash
npm test
```

Or with verbose output:

```bash
npx vitest run --reporter=verbose
```

## Troubleshooting

### Bot Not Placing Orders

1. Check API credentials in `.env.production`
2. Verify sufficient balance on Binance.US
3. Check logs: `tail -f logs/live-btc-bot.log`

### Monitor Process Stops

1. Check if service is running: `sudo systemctl status grid-bot-btc.service`
2. Restart if needed: `sudo systemctl restart grid-bot-btc.service`
3. Check for errors: `journalctl -u grid-bot-btc.service -n 50`

### Rate Limit Errors

The bot uses 10-second polling intervals to stay well within Binance.US rate limits. If you see rate limit errors:

1. Reduce the number of active bots
2. Increase polling interval in `config.mjs`

### Health Check Shows Issues

Run the detailed health check:

```bash
node health-check.mjs
```

This will show:
- Database status
- Monitor process status
- Recent log activity
- Open orders on Binance

## API Rate Limits

Binance.US enforces the following limits:

| Limit Type | Value |
|------------|-------|
| Request Weight | 1,200/minute |
| Orders | 10/second |
| Orders | 200,000/day |

The bot is configured to use approximately 2-4% of available capacity with default settings.

## Security Best Practices

1. **API Keys**: Use IP-restricted API keys on Binance.US
2. **Permissions**: Only enable "Spot Trading" permission, disable withdrawals
3. **Environment**: Never commit `.env.production` to version control
4. **VPS**: Use SSH key authentication, disable password login
5. **Updates**: Regularly update dependencies with `npm audit fix`

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 5.1.0 | 2024-12-20 | Centralized config, error handling, repository cleanup |
| 5.0.5 | 2024-12-20 | Daily health check emails |
| 5.0.4 | 2024-12-20 | Systemd services for persistence |
| 5.0.3 | 2024-12-20 | Health check command |
| 5.0.2 | 2024-12-20 | 10-second polling interval |
| 5.0.1 | 2024-12-20 | Database connection fix |
| 5.0.0 | 2024-12-20 | WebSocket feed, SQLite database, test suite |
| 4.7.0 | 2024-12-18 | Auto-close and auto-restart implementation |
| 4.6.0 | 2024-12-17 | Profit-taking monitor |

## Contributing

1. Create a feature branch: `git checkout -b feature/my-feature`
2. Make your changes
3. Run tests: `npm test`
4. Commit: `git commit -m "Add my feature"`
5. Push: `git push origin feature/my-feature`
6. Create a Pull Request

## License

MIT License - See LICENSE file for details.

## Support

For issues and feature requests, please use the GitHub Issues page.

---

**Disclaimer**: This software is for educational purposes only. Cryptocurrency trading involves substantial risk of loss. Use at your own risk.
