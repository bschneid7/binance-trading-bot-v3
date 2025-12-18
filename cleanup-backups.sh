#!/bin/bash
echo "🗑️  Cleaning up old backup files..."

# Create archive directory
mkdir -p archive/backups-$(date +%Y%m%d)

# Move old backups
mv grid-bot-cli-v*.backup.mjs archive/backups-$(date +%Y%m%d)/ 2>/dev/null
mv grid-bot-cli*.backup archive/backups-$(date +%Y%m%d)/ 2>/dev/null
mv data/*.backup* archive/backups-$(date +%Y%m%d)/ 2>/dev/null

echo "✅ Backups archived to archive/backups-$(date +%Y%m%d)/"
ls -lh archive/backups-$(date +%Y%m%d)/
