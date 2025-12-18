#!/bin/bash
# Deploy Grid Bot Dashboard

set -e

echo "=========================================="
echo "Grid Bot Dashboard Deployment"
echo "=========================================="
echo ""

# Check if express is installed
echo "📦 Checking dependencies..."
if ! npm list express &>/dev/null; then
    echo "   Installing express..."
    npm install --save express
else
    echo "   ✅ express already installed"
fi
echo ""

# Make dashboard executable
echo "🔧 Setting permissions..."
chmod +x grid-bot-dashboard.mjs
echo "✅ Dashboard is executable"
echo ""

# Install systemd service
echo "📝 Installing systemd service..."
sudo cp grid-bot-dashboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable grid-bot-dashboard.service
echo "✅ Service installed"
echo ""

# Start the dashboard
echo "🚀 Starting dashboard..."
sudo systemctl start grid-bot-dashboard.service
sleep 2
echo ""

# Check status
echo "📊 Dashboard status:"
sudo systemctl status grid-bot-dashboard.service --no-pager | head -10
echo ""

echo "=========================================="
echo "✅ Dashboard Deployed Successfully!"
echo "=========================================="
echo ""
echo "🌐 Access your dashboard at:"
echo "   http://209.38.74.84:3000"
echo ""
echo "📋 Useful commands:"
echo "   sudo systemctl status grid-bot-dashboard.service   # Check status"
echo "   sudo systemctl stop grid-bot-dashboard.service     # Stop dashboard"
echo "   sudo systemctl restart grid-bot-dashboard.service  # Restart dashboard"
echo "   journalctl -u grid-bot-dashboard.service -f        # View logs"
echo ""
