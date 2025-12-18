#!/bin/bash
# Setup Email Reporting for Grid Trading Bot
# This script configures Gmail integration for automated email reports

echo "════════════════════════════════════════════════════════════"
echo "  Email Reporting Setup"
echo "════════════════════════════════════════════════════════════"
echo ""

cd ~/binance-trading-bot-v3

# Check if email-reporter.mjs exists
if [ ! -f email-reporter.mjs ]; then
    echo "❌ Error: email-reporter.mjs not found"
    exit 1
fi

echo "📧 Email Reporter Configuration"
echo ""
echo "This script will set up:"
echo "  • Gmail integration for email alerts"
echo "  • Daily summary reports (8:00 PM EST)"
echo "  • Real-time fill notifications"
echo ""
echo "Reports will be sent to: bschneid7@gmail.com"
echo ""

# Check if nodemailer is installed
echo "📦 Checking dependencies..."
if ! npm list nodemailer &>/dev/null; then
    echo "Installing nodemailer..."
    npm install nodemailer
fi

echo "✅ Dependencies installed"
echo ""

# Check Gmail credentials
echo "🔑 Checking Gmail credentials..."
if ! grep -q "GMAIL_USER=" .env.production 2>/dev/null; then
    echo ""
    echo "⚠️  Gmail credentials not found in .env.production"
    echo ""
    echo "To enable email reports, you need to:"
    echo "  1. Enable 2-factor authentication on your Gmail account"
    echo "  2. Generate an App Password: https://myaccount.google.com/apppasswords"
    echo "  3. Add credentials to .env.production:"
    echo ""
    echo "     GMAIL_USER=your-email@gmail.com"
    echo "     GMAIL_APP_PASSWORD=your-16-digit-app-password"
    echo ""
    read -p "Press Enter to continue after adding credentials, or Ctrl+C to exit..."
fi

# Verify credentials are set
source .env.production
if [ -z "$GMAIL_USER" ] || [ -z "$GMAIL_APP_PASSWORD" ]; then
    echo "❌ Gmail credentials not found. Please add them to .env.production"
    exit 1
fi

echo "✅ Gmail credentials found"
echo ""

# Test email
echo "📨 Sending test email..."
./email-reporter.mjs test-fill

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Test email sent successfully!"
    echo "   Check bschneid7@gmail.com for the test fill alert"
    echo ""
else
    echo ""
    echo "❌ Failed to send test email. Check credentials and try again."
    exit 1
fi

# Install systemd services for daily reports
echo "🔧 Installing systemd timer for daily reports..."

# Copy service files
sudo cp systemd/email-reporter.service /etc/systemd/system/
sudo cp systemd/email-reporter.timer /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable and start timer
sudo systemctl enable email-reporter.timer
sudo systemctl start email-reporter.timer

echo "✅ Daily email reports enabled"
echo ""

# Show timer status
echo "📅 Daily Report Schedule:"
sudo systemctl status email-reporter.timer --no-pager | grep -A2 "Trigger"
echo ""

echo "════════════════════════════════════════════════════════════"
echo "  Email Reporting Setup Complete!"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "📧 Configured Reports:"
echo "   • Daily Summary: 8:00 PM EST (automatic)"
echo "   • Fill Alerts: Real-time (via bot integration)"
echo "   • Error Notifications: As needed"
echo ""
echo "📬 All reports will be sent to: bschneid7@gmail.com"
echo ""
echo "🧪 Test Commands:"
echo "   ./email-reporter.mjs test-fill       # Send test fill alert"
echo "   ./email-reporter.mjs test-summary    # Send test daily summary"
echo "   sudo systemctl status email-reporter.timer    # Check schedule"
echo ""
echo "✅ Setup complete!"
