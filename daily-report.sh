#!/bin/bash

################################################################################
# Daily Performance Report Generator v1.0
# Author: Bryan Schneider
# Purpose: Generate daily summary reports from monitoring logs
# Usage: ./daily-report.sh [bot-name] [days-back]
################################################################################

set -e

# Configuration
BOT_NAME="${1:-test-v2-btc}"
DAYS_BACK="${2:-1}"
LOG_DIR="$HOME/binance-trading-bot-v3/logs"
METRICS_LOG="$LOG_DIR/metrics-${BOT_NAME}.csv"
ALERTS_LOG="$LOG_DIR/alerts-${BOT_NAME}.log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

################################################################################
# Check if log files exist
################################################################################
if [ ! -f "$METRICS_LOG" ]; then
    echo -e "${RED}❌ Error: Metrics log not found: $METRICS_LOG${NC}"
    echo "Run ./monitor-bot.sh first to start collecting data."
    exit 1
fi

################################################################################
# Calculate date range
################################################################################
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    START_DATE=$(date -v-${DAYS_BACK}d '+%Y-%m-%d')
else
    # Linux
    START_DATE=$(date -d "$DAYS_BACK days ago" '+%Y-%m-%d')
fi

CURRENT_DATE=$(date '+%Y-%m-%d')

################################################################################
# Extract metrics from CSV
################################################################################
extract_metrics() {
    # Filter logs by date range and extract last 24 hours
    tail -n 1000 "$METRICS_LOG" | awk -F',' -v start="$START_DATE" -v bot="$BOT_NAME" '
    BEGIN {
        max_price = 0; min_price = 999999
        max_drawdown = 0; total_checks = 0
        sum_win_rate = 0; sum_pnl = 0
        alerts_critical = 0; alerts_warning = 0
    }
    NR > 1 && $2 == bot && $1 >= start {
        total_checks++
        
        # BTC Price tracking
        price = $4
        if (price > max_price) max_price = price
        if (price < min_price && price > 0) min_price = price
        
        # Status tracking
        if ($3 == "RUNNING") running_checks++
        
        # Performance metrics
        sum_win_rate += $10
        sum_pnl += $11
        if ($12 > max_drawdown) max_drawdown = $12
        
        # Last values
        last_status = $3
        last_price = $4
        last_position = $5
        last_volatility = $6
        last_regime = $7
        last_orders = $8
        last_trades = $9
        last_win_rate = $10
        last_profit_factor = $11
        last_pnl = $12
        last_sharpe = $14
    }
    END {
        print total_checks "|" running_checks "|" max_price "|" min_price
        print last_status "|" last_price "|" last_position "|" last_volatility
        print last_regime "|" last_orders "|" last_trades "|" last_win_rate
        print last_profit_factor "|" last_pnl "|" max_drawdown "|" last_sharpe
        if (total_checks > 0) {
            print sum_win_rate/total_checks "|" sum_pnl "|" (running_checks/total_checks)*100
        } else {
            print "0|0|0"
        }
    }
    '
}

# Parse metrics
IFS='|' read -r total_checks running_checks max_price min_price <<< "$(extract_metrics | sed -n 1p)"
IFS='|' read -r last_status last_price last_position last_volatility <<< "$(extract_metrics | sed -n 2p)"
IFS='|' read -r last_regime last_orders last_trades last_win_rate <<< "$(extract_metrics | sed -n 3p)"
IFS='|' read -r last_profit_factor last_pnl max_drawdown last_sharpe <<< "$(extract_metrics | sed -n 4p)"
IFS='|' read -r avg_win_rate total_pnl uptime_pct <<< "$(extract_metrics | sed -n 5p)"

################################################################################
# Count alerts
################################################################################
count_alerts() {
    if [ -f "$ALERTS_LOG" ]; then
        critical=$(grep -c "CRITICAL" "$ALERTS_LOG" 2>/dev/null || echo "0")
        warning=$(grep -c "WARNING" "$ALERTS_LOG" 2>/dev/null || echo "0")
        echo "$critical|$warning"
    else
        echo "0|0"
    fi
}

IFS='|' read -r alerts_critical alerts_warning <<< "$(count_alerts)"

################################################################################
# Calculate price change
################################################################################
if (( $(echo "$min_price > 0" | bc -l) )); then
    price_change=$(echo "scale=2; (($max_price - $min_price) / $min_price) * 100" | bc)
else
    price_change="0"
fi

################################################################################
# Determine status color and icon
################################################################################
get_status_indicator() {
    case "$last_status" in
        RUNNING)
            echo -e "${GREEN}🟢 RUNNING${NC}"
            ;;
        STOPPED)
            echo -e "${RED}🔴 STOPPED${NC}"
            ;;
        PAUSED)
            echo -e "${YELLOW}⏸️  PAUSED${NC}"
            ;;
        *)
            echo -e "${RED}❓ UNKNOWN${NC}"
            ;;
    esac
}

################################################################################
# Performance grade
################################################################################
get_performance_grade() {
    local win_rate=$1
    local profit_factor=$2
    local sharpe=$3
    
    if (( $(echo "$last_trades < 10" | bc -l) )); then
        echo "📊 INSUFFICIENT DATA"
        return
    fi
    
    local score=0
    
    # Win rate scoring (40 points)
    if (( $(echo "$win_rate >= 60" | bc -l) )); then score=$((score + 40))
    elif (( $(echo "$win_rate >= 50" | bc -l) )); then score=$((score + 30))
    elif (( $(echo "$win_rate >= 40" | bc -l) )); then score=$((score + 20))
    fi
    
    # Profit factor scoring (40 points)
    if (( $(echo "$profit_factor >= 1.5" | bc -l) )); then score=$((score + 40))
    elif (( $(echo "$profit_factor >= 1.2" | bc -l) )); then score=$((score + 30))
    elif (( $(echo "$profit_factor >= 1.0" | bc -l) )); then score=$((score + 20))
    fi
    
    # Sharpe ratio scoring (20 points)
    if (( $(echo "$sharpe >= 1.0" | bc -l) )); then score=$((score + 20))
    elif (( $(echo "$sharpe >= 0.5" | bc -l) )); then score=$((score + 10))
    fi
    
    # Assign grade
    if [ $score -ge 90 ]; then echo -e "${GREEN}🏆 EXCELLENT (A)${NC}"
    elif [ $score -ge 75 ]; then echo -e "${GREEN}✅ GOOD (B)${NC}"
    elif [ $score -ge 60 ]; then echo -e "${YELLOW}⚠️  FAIR (C)${NC}"
    elif [ $score -ge 40 ]; then echo -e "${YELLOW}⚠️  POOR (D)${NC}"
    else echo -e "${RED}❌ FAILING (F)${NC}"
    fi
}

################################################################################
# Generate Report
################################################################################
clear
echo ""
echo -e "${CYAN}════════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}                    📈 GRID BOT DAILY PERFORMANCE REPORT                        ${NC}"
echo -e "${CYAN}════════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}Report Date:${NC} $(date '+%A, %B %d, %Y at %I:%M %p')"
echo -e "${BLUE}Period:${NC} Last $DAYS_BACK day(s) ($START_DATE to $CURRENT_DATE)"
echo -e "${BLUE}Bot Name:${NC} $BOT_NAME"
echo ""

echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}📊 BOT STATUS${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
printf "%-30s %s\n" "Current Status:" "$(get_status_indicator)"
printf "%-30s %.2f%%\n" "Uptime:" "$uptime_pct"
printf "%-30s %d\n" "Total Health Checks:" "$total_checks"
printf "%-30s %d 🚨  |  %d ⚠️\n" "Alerts (Critical|Warning):" "$alerts_critical" "$alerts_warning"
echo ""

echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}💰 MARKET CONDITIONS${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
printf "%-30s \$%'.2f\n" "Current BTC Price:" "$last_price"
printf "%-30s \$%'.2f\n" "24h High:" "$max_price"
printf "%-30s \$%'.2f\n" "24h Low:" "$min_price"
printf "%-30s %.2f%%\n" "24h Price Change:" "$price_change"
printf "%-30s %.2f%%\n" "Grid Position:" "$last_position"
printf "%-30s %s\n" "Volatility:" "$last_volatility"
printf "%-30s %s\n" "Market Regime:" "$last_regime"
echo ""

echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}🎯 TRADING PERFORMANCE${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
printf "%-30s %d\n" "Total Trades Executed:" "$last_trades"
printf "%-30s %d\n" "Active Orders:" "$last_orders"
printf "%-30s %.2f%%\n" "Win Rate:" "$last_win_rate"
printf "%-30s %.2f\n" "Profit Factor:" "$last_profit_factor"
printf "%-30s \$%'.2f\n" "Total P&L (Paper):" "$last_pnl"
printf "%-30s %.2f%%\n" "Max Drawdown:" "$max_drawdown"
printf "%-30s %.2f\n" "Sharpe Ratio:" "$last_sharpe"
echo ""
printf "%-30s %s\n" "Performance Grade:" "$(get_performance_grade "$last_win_rate" "$last_profit_factor" "$last_sharpe")"
echo ""

echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}🎓 RECOMMENDATIONS${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Generate recommendations
if [ "$last_status" != "RUNNING" ]; then
    echo -e "${RED}❌ CRITICAL: Bot is not running. Investigate immediately.${NC}"
    echo "   → Run: cd ~/binance-trading-bot-v3 && ./grid-bot-cli.mjs show --name $BOT_NAME"
    echo ""
fi

if [ "$alerts_critical" -gt 0 ]; then
    echo -e "${RED}🚨 $alerts_critical critical alerts detected. Review logs:${NC}"
    echo "   → Run: tail -20 $ALERTS_LOG"
    echo ""
fi

if (( $(echo "$last_trades < 10" | bc -l) )); then
    echo -e "${BLUE}ℹ️  Insufficient trade data (<10 trades). Continue monitoring.${NC}"
    echo ""
fi

if (( $(echo "$last_trades >= 20" | bc -l) )); then
    if (( $(echo "$last_win_rate < 40" | bc -l) )); then
        echo -e "${RED}⚠️  Win rate below 40%. Consider:${NC}"
        echo "   → Increasing grid spacing (reduce grids)"
        echo "   → Adjusting price range to better match market volatility"
        echo ""
    fi
    
    if (( $(echo "$last_profit_factor < 1.0" | bc -l) )); then
        echo -e "${RED}⚠️  Profit factor below 1.0 (losing money). DO NOT go live.${NC}"
        echo "   → Review grid configuration"
        echo "   → Wait for better market conditions"
        echo ""
    fi
fi

if (( $(echo "$max_drawdown > 20" | bc -l) )); then
    echo -e "${YELLOW}⚠️  Max drawdown exceeds 20%. Monitor closely.${NC}"
    echo ""
fi

if (( $(echo "$last_position > 100 || $last_position < -10" | bc -l) )); then
    echo -e "${YELLOW}⚠️  Price outside grid range. Consider rebalancing:${NC}"
    echo "   → Run: ./grid-bot-cli.mjs rebalance --name $BOT_NAME --lower <new-low> --upper <new-high>"
    echo ""
fi

if [ "$last_trades" -ge 20 ] && (( $(echo "$last_win_rate >= 50 && $last_profit_factor >= 1.2" | bc -l) )); then
    echo -e "${GREEN}✅ Performance meets criteria for live trading consideration.${NC}"
    echo "   → Ensure 30+ days of paper trading before going live"
    echo "   → Start with micro capital (\$150-200)"
    echo ""
fi

echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}📁 LOG FILES${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Metrics Log: $METRICS_LOG"
echo "Alerts Log:  $ALERTS_LOG"
echo ""
echo "View commands:"
echo "   tail -f $METRICS_LOG          # Watch live metrics"
echo "   tail -20 $ALERTS_LOG           # View recent alerts"
echo "   ./daily-report.sh $BOT_NAME 7  # 7-day report"
echo ""

echo -e "${CYAN}════════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
