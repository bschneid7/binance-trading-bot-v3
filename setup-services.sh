#!/bin/bash

# Grid Trading Bot - Systemd Service Setup Script
# This script installs and enables the bot monitor services

set -e

echo "════════════════════════════════════════════════════════════"
echo "       GRID TRADING BOT - SERVICE SETUP"
echo "════════════════════════════════════════════════════════════"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "❌ Please run as root (use: sudo bash setup-services.sh)"
  exit 1
fi

# Define paths
BOT_DIR="/root/binance-trading-bot-v3"
SYSTEMD_DIR="/etc/systemd/system"

# Create logs directory if it doesn't exist
echo "📁 Creating logs directory..."
mkdir -p "$BOT_DIR/logs"

# Copy service files
echo "📋 Installing service files..."
cp "$BOT_DIR/systemd/grid-bot-btc.service" "$SYSTEMD_DIR/"
cp "$BOT_DIR/systemd/grid-bot-eth.service" "$SYSTEMD_DIR/"
cp "$BOT_DIR/systemd/grid-bot-sol.service" "$SYSTEMD_DIR/"
cp "$BOT_DIR/systemd/health-check-email.service" "$SYSTEMD_DIR/"
cp "$BOT_DIR/systemd/health-check-email.timer" "$SYSTEMD_DIR/"

# Reload systemd
echo "🔄 Reloading systemd daemon..."
systemctl daemon-reload

# Enable services (start on boot)
echo "⚡ Enabling services to start on boot..."
systemctl enable grid-bot-btc.service
systemctl enable grid-bot-eth.service
systemctl enable grid-bot-sol.service

# Enable daily health check email timer
echo "📧 Enabling daily health check email..."
systemctl enable health-check-email.timer
systemctl start health-check-email.timer

echo ""
echo "════════════════════════════════════════════════════════════"
echo "       SETUP COMPLETE"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "Services installed:"
echo "  ✅ grid-bot-btc.service (enabled)"
echo "  ✅ grid-bot-eth.service (enabled)"
echo "  ✅ grid-bot-sol.service (enabled)"
echo "  ✅ health-check-email.timer (enabled - runs daily at 8 AM UTC)"
echo ""
echo "To start the BTC and ETH monitors now, run:"
echo "  sudo systemctl start grid-bot-btc.service"
echo "  sudo systemctl start grid-bot-eth.service"
echo ""
echo "To check status:"
echo "  sudo systemctl status grid-bot-btc.service"
echo "  sudo systemctl status grid-bot-eth.service"
echo ""
echo "To view logs:"
echo "  tail -f /root/binance-trading-bot-v3/logs/live-btc-bot.log"
echo "  tail -f /root/binance-trading-bot-v3/logs/live-eth-bot.log"
echo ""
echo "To manually send a health check email now:"
echo "  node health-check-email.mjs"
echo ""
echo "To check when the next health check email will be sent:"
echo "  systemctl list-timers health-check-email.timer"
echo ""
