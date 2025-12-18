#!/bin/bash
# Grid Bot systemd Service Installation Script
# Run this on your VPS at 209.38.74.84

set -e  # Exit on any error

echo "🚀 Installing Grid Bot systemd Services..."
echo ""

# Stop current nohup processes
echo "⏹️  Stopping existing nohup processes..."
pkill -f "grid-bot-cli.mjs monitor" || true
sleep 2

# Copy service files
echo "📋 Installing service files..."
sudo cp grid-bot-v2.service /etc/systemd/system/
sudo cp grid-bot-v3.service /etc/systemd/system/

# Set correct permissions
sudo chmod 644 /etc/systemd/system/grid-bot-v2.service
sudo chmod 644 /etc/systemd/system/grid-bot-v3.service

# Reload systemd
echo "🔄 Reloading systemd daemon..."
sudo systemctl daemon-reload

# Enable services (auto-start on boot)
echo "✅ Enabling services to start on boot..."
sudo systemctl enable grid-bot-v2.service
sudo systemctl enable grid-bot-v3.service

# Start services
echo "▶️  Starting services..."
sudo systemctl start grid-bot-v2.service
sudo systemctl start grid-bot-v3.service

# Wait for startup
sleep 3

# Check status
echo ""
echo "════════════════════════════════════════════════════════════════"
echo "📊 Service Status:"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "🤖 test-v2-btc:"
sudo systemctl status grid-bot-v2.service --no-pager | head -10
echo ""
echo "🤖 test-v3-btc:"
sudo systemctl status grid-bot-v3.service --no-pager | head -10
echo ""
echo "════════════════════════════════════════════════════════════════"
echo "✅ Installation Complete!"
echo ""
echo "📌 Useful Commands:"
echo "   sudo systemctl status grid-bot-v3.service   # Check status"
echo "   sudo systemctl stop grid-bot-v3.service     # Stop bot"
echo "   sudo systemctl start grid-bot-v3.service    # Start bot"
echo "   sudo systemctl restart grid-bot-v3.service  # Restart bot"
echo "   journalctl -u grid-bot-v3.service -f        # View live logs"
echo "   tail -f monitor-v3.log                      # View monitor logs"
echo ""
echo "🎉 Your bots will now auto-start on every server reboot!"
echo "════════════════════════════════════════════════════════════════"
