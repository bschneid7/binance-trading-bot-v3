#!/bin/bash

################################################################################
# Grid Bot Monitoring Script v1.0
# Author: Bryan Schneider
# Purpose: Automated monitoring and logging for grid-bot-cli.mjs v2.0
# Usage: ./monitor-bot.sh [bot-name] [interval-minutes]
################################################################################

set -e

# Configuration
BOT_NAME="${1:-test-v2-btc}"
CHECK_INTERVAL="${2:-60}"  # Default: check every 60 minutes
LOG_DIR="$HOME/binance-trading-bot-v3/logs"
BOT_DIR="$HOME/binance-trading-bot-v3"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
DATE_FILE=$(date '+%Y-%m-%d')

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Create log directory
mkdir -p "$LOG_DIR"

# Log files
METRICS_LOG="$LOG_DIR/metrics-${BOT_NAME}.csv"
ALERTS_LOG="$LOG_DIR/alerts-${BOT_NAME}.log"
STATUS_LOG="$LOG_DIR/status-${BOT_NAME}.log"

################################################################################
# Initialize CSV header if file doesn't exist
################################################################################
initialize_metrics_log() {
    if [ ! -f "$METRICS_LOG" ]; then
        echo "timestamp,bot_name,status,btc_price,position_pct,volatility,market_regime,active_orders,total_trades,win_rate,profit_factor,total_pnl,max_drawdown,sharpe_ratio" > "$METRICS_LOG"
        echo -e "${GREEN}✅ Created metrics log: $METRICS_LOG${NC}"
    fi
}

################################################################################
# Parse bot output and extract metrics
################################################################################
parse_bot_metrics() {
    local bot_output="$1"
    
    # Extract key metrics using grep and awk
    local status=$(echo "$bot_output" | grep "Status:" | awk '{print $2}')
    local btc_price=$(echo "$bot_output" | grep "Price:" | awk '{print $2}' | tr -d '$,')
    local position=$(echo "$bot_output" | grep "Position:" | grep -oP '\d+\.\d+%' | tr -d '%')
    local volatility=$(echo "$bot_output" | grep "Volatility:" | awk '{print $3}' | tr -d '(%)')
    local market_regime=$(echo "$bot_output" | grep "Market Regime:" | awk '{print $3, $4}' | tr -d '()')
    local active_orders=$(echo "$bot_output" | grep "Active:" | head -1 | awk '{print $2}')
    local total_trades=$(echo "$bot_output" | grep "Total Trades:" | awk '{print $3}')
    local win_rate=$(echo "$bot_output" | grep "Win Rate:" | awk '{print $3}' | tr -d '%')
    local profit_factor=$(echo "$bot_output" | grep "Profit Factor:" | awk '{print $3}')
    local total_pnl=$(echo "$bot_output" | grep "Total P&L:" | awk '{print $3}' | tr -d '$,')
    local max_drawdown=$(echo "$bot_output" | grep "Max Drawdown:" | awk '{print $3}' | tr -d '%')
    local sharpe_ratio=$(echo "$bot_output" | grep "Sharpe Ratio:" | awk '{print $3}')
    
    # Handle empty values
    status="${status:-UNKNOWN}"
    btc_price="${btc_price:-0}"
    position="${position:-0}"
    volatility="${volatility:-0}"
    market_regime="${market_regime:-UNKNOWN}"
    active_orders="${active_orders:-0}"
    total_trades="${total_trades:-0}"
    win_rate="${win_rate:-0}"
    profit_factor="${profit_factor:-0}"
    total_pnl="${total_pnl:-0}"
    max_drawdown="${max_drawdown:-0}"
    sharpe_ratio="${sharpe_ratio:-0}"
    
    # Return as CSV row
    echo "$TIMESTAMP,$BOT_NAME,$status,$btc_price,$position,$volatility,$market_regime,$active_orders,$total_trades,$win_rate,$profit_factor,$total_pnl,$max_drawdown,$sharpe_ratio"
}

################################################################################
# Check for alert conditions
################################################################################
check_alerts() {
    local metrics="$1"
    
    # Parse metrics
    local status=$(echo "$metrics" | cut -d',' -f3)
    local btc_price=$(echo "$metrics" | cut -d',' -f4)
    local position=$(echo "$metrics" | cut -d',' -f5)
    local active_orders=$(echo "$metrics" | cut -d',' -f8)
    local total_trades=$(echo "$metrics" | cut -d',' -f9)
    local win_rate=$(echo "$metrics" | cut -d',' -f10)
    local max_drawdown=$(echo "$metrics" | cut -d',' -f12)
    
    # Alert: Bot stopped
    if [ "$status" != "RUNNING" ]; then
        log_alert "CRITICAL" "Bot is not running! Status: $status"
        return 1
    fi
    
    # Alert: Price outside grid (>10%)
    if (( $(echo "$position > 100" | bc -l) )) || (( $(echo "$position < -10" | bc -l) )); then
        log_alert "WARNING" "Price outside grid range: ${position}%"
    fi
    
    # Alert: No orders after 24+ hours
    if [ "$total_trades" -eq 0 ] && [ -f "$METRICS_LOG" ]; then
        local log_lines=$(wc -l < "$METRICS_LOG")
        if [ "$log_lines" -gt 24 ]; then  # 24 hourly checks
            log_alert "WARNING" "No trades executed after 24+ hours"
        fi
    fi
    
    # Alert: Win rate below 35% (after 20+ trades)
    if [ "$total_trades" -gt 20 ]; then
        if (( $(echo "$win_rate < 35" | bc -l) )); then
            log_alert "CRITICAL" "Win rate below 35%: ${win_rate}%"
        fi
    fi
    
    # Alert: Max drawdown exceeds 25%
    if (( $(echo "$max_drawdown > 25" | bc -l) )); then
        log_alert "CRITICAL" "Max drawdown exceeds 25%: ${max_drawdown}%"
    fi
    
    return 0
}

################################################################################
# Log alert to file
################################################################################
log_alert() {
    local severity="$1"
    local message="$2"
    local alert_line="[$TIMESTAMP] [$severity] $message"
    
    echo "$alert_line" >> "$ALERTS_LOG"
    
    # Print to console with color
    case "$severity" in
        CRITICAL)
            echo -e "${RED}🚨 $alert_line${NC}"
            ;;
        WARNING)
            echo -e "${YELLOW}⚠️  $alert_line${NC}"
            ;;
        INFO)
            echo -e "${BLUE}ℹ️  $alert_line${NC}"
            ;;
    esac
}

################################################################################
# Generate summary report
################################################################################
generate_summary() {
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}📊 Grid Bot Monitoring Summary${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "Bot Name: $BOT_NAME"
    echo "Monitoring Started: $(date)"
    echo "Check Interval: Every $CHECK_INTERVAL minutes"
    echo ""
    echo "📁 Log Files:"
    echo "   Metrics: $METRICS_LOG"
    echo "   Alerts:  $ALERTS_LOG"
    echo "   Status:  $STATUS_LOG"
    echo ""
    echo -e "${YELLOW}💡 Commands:${NC}"
    echo "   View live metrics: tail -f $METRICS_LOG"
    echo "   View alerts:       tail -f $ALERTS_LOG"
    echo "   Stop monitoring:   Ctrl+C"
    echo "   Manual check:      cd $BOT_DIR && ./grid-bot-cli.mjs show --name $BOT_NAME"
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
    echo ""
}

################################################################################
# Single check iteration
################################################################################
run_check() {
    echo -e "${BLUE}[$(date '+%H:%M:%S')] Running bot check...${NC}"
    
    # Change to bot directory
    cd "$BOT_DIR" || {
        log_alert "CRITICAL" "Cannot access bot directory: $BOT_DIR"
        exit 1
    }
    
    # Get bot status
    bot_output=$(./grid-bot-cli.mjs show --name "$BOT_NAME" 2>&1)
    
    # Check if bot exists
    if echo "$bot_output" | grep -q "not found"; then
        log_alert "CRITICAL" "Bot '$BOT_NAME' not found"
        echo "$bot_output" > "$STATUS_LOG"
        exit 1
    fi
    
    # Save full output to status log
    echo "=== Check at $TIMESTAMP ===" >> "$STATUS_LOG"
    echo "$bot_output" >> "$STATUS_LOG"
    echo "" >> "$STATUS_LOG"
    
    # Parse and log metrics
    metrics=$(parse_bot_metrics "$bot_output")
    echo "$metrics" >> "$METRICS_LOG"
    
    # Check for alerts
    if check_alerts "$metrics"; then
        echo -e "${GREEN}✅ Check complete - No issues detected${NC}"
    else
        echo -e "${RED}❌ Check complete - Alerts detected (see $ALERTS_LOG)${NC}"
    fi
    
    # Display key metrics
    echo ""
    echo "📊 Current Metrics:"
    echo "$bot_output" | grep -E "(Status|Price|Position|Volatility|Market Regime|Active|Total Trades|Win Rate|Total P&L)" | head -10
    echo ""
}

################################################################################
# Main monitoring loop
################################################################################
main() {
    # Display banner
    clear
    generate_summary
    
    # Initialize logs
    initialize_metrics_log
    
    # Log start
    log_alert "INFO" "Monitoring started for bot: $BOT_NAME"
    
    # Run initial check
    run_check
    
    # Continue monitoring loop
    echo -e "${YELLOW}⏰ Next check in $CHECK_INTERVAL minutes...${NC}"
    echo ""
    
    while true; do
        sleep $((CHECK_INTERVAL * 60))
        run_check
        echo -e "${YELLOW}⏰ Next check in $CHECK_INTERVAL minutes...${NC}"
        echo ""
    done
}

################################################################################
# Handle Ctrl+C gracefully
################################################################################
trap 'echo ""; echo "Monitoring stopped."; log_alert "INFO" "Monitoring stopped by user"; exit 0' INT

################################################################################
# Run
################################################################################

# Validate bot directory exists
if [ ! -d "$BOT_DIR" ]; then
    echo -e "${RED}❌ Error: Bot directory not found: $BOT_DIR${NC}"
    exit 1
fi

# Validate bot CLI exists
if [ ! -f "$BOT_DIR/grid-bot-cli.mjs" ]; then
    echo -e "${RED}❌ Error: grid-bot-cli.mjs not found in $BOT_DIR${NC}"
    exit 1
fi

# Show usage if requested
if [ "$1" == "--help" ] || [ "$1" == "-h" ]; then
    echo "Usage: $0 [bot-name] [interval-minutes]"
    echo ""
    echo "Arguments:"
    echo "  bot-name          Name of the bot to monitor (default: test-v2-btc)"
    echo "  interval-minutes  Check interval in minutes (default: 60)"
    echo ""
    echo "Examples:"
    echo "  $0                           # Monitor test-v2-btc every 60 minutes"
    echo "  $0 test-v2-btc 30            # Monitor test-v2-btc every 30 minutes"
    echo "  $0 live-micro-btc 15         # Monitor live-micro-btc every 15 minutes"
    echo ""
    exit 0
fi

# Run main loop
main
