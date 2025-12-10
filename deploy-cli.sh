#!/bin/bash

# Grid Bot CLI - Deployment Script
# This script uploads the CLI tool to your VPS

set -e

VPS_IP="209.38.74.84"
VPS_USER="root"
VPS_DIR="/root/binance-trading-bot-v3"

echo "🚀 Deploying Grid Bot CLI to VPS..."
echo "================================"
echo ""

# Check if grid-bot-cli.mjs exists
if [ ! -f "grid-bot-cli.mjs" ]; then
    echo "❌ Error: grid-bot-cli.mjs not found in current directory"
    exit 1
fi

# Upload CLI tool
echo "📤 Uploading grid-bot-cli.mjs..."
scp grid-bot-cli.mjs ${VPS_USER}@${VPS_IP}:${VPS_DIR}/

# Upload deployment guide
echo "📤 Uploading CLI-DEPLOYMENT-GUIDE.md..."
scp CLI-DEPLOYMENT-GUIDE.md ${VPS_USER}@${VPS_IP}:${VPS_DIR}/

# Make executable and create symlink
echo "🔧 Setting up CLI on VPS..."
ssh ${VPS_USER}@${VPS_IP} << 'ENDSSH'
cd /root/binance-trading-bot-v3

# Make executable
chmod +x grid-bot-cli.mjs

# Create symlink for easier access
if [ ! -L /usr/local/bin/grid-bot-cli ]; then
    ln -s /root/binance-trading-bot-v3/grid-bot-cli.mjs /usr/local/bin/grid-bot-cli
    echo "✅ Created symlink: /usr/local/bin/grid-bot-cli"
fi

# Create data directory
mkdir -p data

# Test CLI
echo ""
echo "🧪 Testing CLI..."
node grid-bot-cli.mjs help | head -20

echo ""
echo "✅ CLI deployed successfully!"
echo ""
echo "You can now use:"
echo "  grid-bot-cli <command>"
echo "  or"
echo "  node grid-bot-cli.mjs <command>"
echo ""
ENDSSH

echo ""
echo "================================"
echo "✅ Deployment complete!"
echo ""
echo "Next steps:"
echo "1. SSH into your VPS: ssh root@${VPS_IP}"
echo "2. Run: grid-bot-cli status"
echo "3. Create your first bot: grid-bot-cli create --name btc-bot --lower 90000 --upper 100000 --grids 10 --size 100"
echo ""
