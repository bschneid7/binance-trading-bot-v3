#!/bin/bash

# Grid Trading Bot - VPS Deployment Script
# This script deploys the bot to your DigitalOcean VPS

set -e  # Exit on error

echo "🚀 Grid Trading Bot - Deployment Script"
echo "========================================"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if .env.production exists
if [ ! -f .env.production ]; then
    echo -e "${RED}Error: .env.production file not found!${NC}"
    echo "Please create .env.production from .env.production.template"
    exit 1
fi

echo -e "${GREEN}✓${NC} Found .env.production"

# Load environment variables
export $(cat .env.production | grep -v '^#' | xargs)

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed!${NC}"
    echo "Please install Docker first: https://docs.docker.com/engine/install/"
    exit 1
fi

echo -e "${GREEN}✓${NC} Docker is installed"

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo -e "${RED}Error: Docker Compose is not installed!${NC}"
    echo "Please install Docker Compose first"
    exit 1
fi

echo -e "${GREEN}✓${NC} Docker Compose is installed"

# Stop any existing containers
echo ""
echo "Stopping existing containers..."
docker-compose -f docker-compose.production.yml down 2>/dev/null || true

# Remove old images (optional)
read -p "Remove old Docker images? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    docker-compose -f docker-compose.production.yml down --rmi all 2>/dev/null || true
    echo -e "${GREEN}✓${NC} Removed old images"
fi

# Build and start containers
echo ""
echo "Building and starting Grid Trading Bot..."
docker-compose -f docker-compose.production.yml up -d --build

# Wait for container to be healthy
echo ""
echo "Waiting for bot to start..."
sleep 10

# Check container status
if docker ps | grep -q "grid-trading-bot"; then
    echo -e "${GREEN}✓${NC} Grid Trading Bot is running!"
    echo ""
    echo "Container status:"
    docker ps --filter "name=grid-trading-bot" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo ""
    echo -e "${GREEN}Deployment successful!${NC}"
    echo ""
    echo "📊 Access your bot at: http://$(hostname -I | awk '{print $1}'):3000"
    echo ""
    echo "📝 View logs with: docker logs -f grid-trading-bot"
    echo "🛑 Stop bot with: docker-compose -f docker-compose.production.yml down"
    echo ""
    if [ "$BINANCE_TEST_MODE" = "true" ]; then
        echo -e "${YELLOW}⚠️  Bot is in PAPER TRADING mode (no real orders)${NC}"
    else
        echo -e "${RED}⚠️  Bot is in LIVE TRADING mode (REAL MONEY!)${NC}"
    fi
else
    echo -e "${RED}✗ Failed to start Grid Trading Bot${NC}"
    echo "Check logs with: docker logs grid-trading-bot"
    exit 1
fi
