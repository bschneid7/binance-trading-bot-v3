#!/bin/bash

# Grid Trading Bot Dashboard - Deployment Script
# This script deploys the dashboard to your VPS

set -e

echo "======================================"
echo "Grid Trading Bot Dashboard Deployment"
echo "======================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if running on VPS
if [ ! -f "/root/.env" ]; then
    echo -e "${YELLOW}Warning: /root/.env not found. You may need to configure API keys.${NC}"
fi

# Navigate to project directory
cd /root/binance-trading-bot-v3 || {
    echo -e "${RED}Error: Project directory not found at /root/binance-trading-bot-v3${NC}"
    exit 1
}

echo -e "${GREEN}✓${NC} Found project directory"

# Pull latest code from GitHub
echo ""
echo "Pulling latest code from GitHub..."
git pull origin main || {
    echo -e "${RED}Error: Failed to pull from GitHub${NC}"
    exit 1
}

echo -e "${GREEN}✓${NC} Code updated"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo ""
    echo -e "${YELLOW}Docker not found. Installing Docker...${NC}"
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
    echo -e "${GREEN}✓${NC} Docker installed"
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo ""
    echo -e "${YELLOW}Docker Compose not found. Installing Docker Compose...${NC}"
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    echo -e "${GREEN}✓${NC} Docker Compose installed"
fi

# Create .env file if it doesn't exist
if [ ! -f ".env" ]; then
    echo ""
    echo -e "${YELLOW}Creating .env file...${NC}"
    
    # Check if /root/.env exists
    if [ -f "/root/.env" ]; then
        echo "Copying API keys from /root/.env..."
        cp /root/.env .env
    else
        echo "Creating .env from template..."
        cp .env.dashboard.example .env
        echo -e "${RED}⚠ WARNING: Please edit .env and add your Binance.US API keys!${NC}"
    fi
fi

# Create data and logs directories
mkdir -p data logs
echo -e "${GREEN}✓${NC} Created data and logs directories"

# Stop existing containers
echo ""
echo "Stopping existing containers..."
docker-compose -f docker-compose.dashboard.yml down 2>/dev/null || true

# Build and start containers
echo ""
echo "Building and starting dashboard..."
docker-compose -f docker-compose.dashboard.yml up -d --build

# Wait for container to be healthy
echo ""
echo "Waiting for dashboard to start..."
sleep 5

# Check container status
if docker ps | grep -q grid-bot-dashboard; then
    echo ""
    echo -e "${GREEN}======================================"
    echo "✓ Dashboard deployed successfully!"
    echo "======================================${NC}"
    echo ""
    echo "Dashboard URL: http://$(curl -s ifconfig.me):3001"
    echo ""
    echo "Commands:"
    echo "  View logs:    docker-compose -f docker-compose.dashboard.yml logs -f"
    echo "  Stop:         docker-compose -f docker-compose.dashboard.yml down"
    echo "  Restart:      docker-compose -f docker-compose.dashboard.yml restart"
    echo "  Status:       docker-compose -f docker-compose.dashboard.yml ps"
    echo ""
    echo -e "${YELLOW}Note: Make sure port 3001 is open in your firewall!${NC}"
    echo ""
else
    echo -e "${RED}Error: Dashboard container failed to start${NC}"
    echo "Check logs with: docker-compose -f docker-compose.dashboard.yml logs"
    exit 1
fi
