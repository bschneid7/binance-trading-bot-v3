# Grid Trading Bot v5.0.0

A sophisticated cryptocurrency grid trading bot for Binance.US with real-time WebSocket price feeds, SQLite database persistence, and comprehensive risk management.

## Features

### Core Trading
- **Grid Trading Strategy**: Automated buy/sell orders across a price range
- **Geometric Grid Spacing**: Optimized for percentage-based price movements
- **Adaptive Grid Count**: Automatically adjusts based on market volatility

### Real-Time Data (v5.0.0)
- **WebSocket Price Feed**: Real-time price updates via WebSocket connection
- **Automatic Fallback**: Falls back to REST API polling if WebSocket fails
- **Health Monitoring**: Automatic reconnection with exponential backoff

### Risk Management
- **Dynamic Stop-Loss**: 15% stop-loss protection
- **Trailing Stop**: 5% trailing stop mechanism
- **Max Drawdown Limit**: 25% maximum drawdown protection
- **Kelly Criterion**: Position sizing based on historical performance

### Data Persistence (v5.0.0)
- **SQLite Database**: Robust, transactional state management
- **Migration Tool**: Easy migration from legacy JSON files
- **Automatic Metrics**: Performance tracking and calculation

### Monitoring
- **Real-Time Dashboard**: Web-based monitoring interface
- **Email Notifications**: Alerts for important events
- **Performance Metrics**: Win rate, Sharpe ratio, profit factor

## Installation

```bash
# Clone the repository
git clone https://github.com/bschneid7/binance-trading-bot-v3.git
cd binance-trading-bot-v3

# Install dependencies
npm install --legacy-peer-deps

# Configure environment
cp .env.example .env.production
# Edit .env.production with your API keys
```

## Configuration

Create a `.env.production` file with the following variables:

```env
BINANCE_API_KEY=your_api_key
BINANCE_API_SECRET=your_api_secret
PAPER_TRADING_MODE=true
```

## Usage

### Create a Bot

```bash
node grid-bot-cli-v5.mjs create \
  --name my-btc-bot \
  --symbol BTC/USD \
  --lower 90000 \
  --upper 100000 \
  --grids 10 \
  --size 100
```

### Start a Bot

```bash
node grid-bot-cli-v5.mjs start --name my-btc-bot
```

### Monitor a Bot (WebSocket)

```bash
node grid-bot-cli-v5.mjs monitor --name my-btc-bot
```

### View Bot Status

```bash
node grid-bot-cli-v5.mjs show --name my-btc-bot
```

### List All Bots

```bash
node grid-bot-cli-v5.mjs list
```

### Stop a Bot

```bash
node grid-bot-cli-v5.mjs stop --name my-btc-bot
```

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

## Project Structure

```
binance-trading-bot-v3/
├── grid-bot-cli-v5.mjs      # Main CLI (v5.0.0 with WebSocket + SQLite)
├── websocket-feed.mjs       # WebSocket price feed module
├── database.mjs             # SQLite database module
├── migrate-to-sqlite.mjs    # Migration script
├── enhancements.mjs         # Enhancement modules
├── email-reporter.mjs       # Email notification system
├── tests/
│   └── grid-bot.test.mjs    # Comprehensive test suite
├── data/
│   └── grid-bot.db          # SQLite database (created on first run)
└── server/                  # Web dashboard backend
```

## Risk Disclaimer

**Trading cryptocurrencies involves significant risk.** This bot is provided for educational purposes. Always:

1. Start with paper trading mode (`PAPER_TRADING_MODE=true`)
2. Test thoroughly before using real funds
3. Never invest more than you can afford to lose
4. Monitor your bot regularly

## Version History

- **v5.0.0** - WebSocket real-time feed, SQLite database, comprehensive test suite
- **v4.7.0** - Auto-close and auto-restart implementation
- **v4.6.0** - Profit-taking monitor
- **v4.5.0** - Enhancement modules deployment
- **v4.4.0** - Advanced optimization modules

## License

MIT License - See LICENSE file for details.
