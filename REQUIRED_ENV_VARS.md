# Required Environment Variables for VPS Deployment

When you create `.env.production` on your VPS, you need to fill in these values:

---

## 🔑 **Critical Variables (MUST CONFIGURE)**

### **1. Binance.US API Credentials**
Get these from: https://www.binance.us/en/usercenter/settings/api-management

```bash
BINANCE_API_KEY=your_binance_api_key_here
BINANCE_API_SECRET=your_binance_api_secret_here
BINANCE_TEST_MODE=true  # Keep as "true" for paper trading!
```

**Important:** 
- Enable "Enable Trading" permission
- DO NOT enable "Enable Withdrawals"
- Consider adding IP whitelist (add your VPS IP: 209.38.74.84)

---

### **2. Database Connection (TiDB from Manus)**
You can get this from your Manus project dashboard → Database settings

```bash
DATABASE_URL=mysql://username:password@host:port/database?ssl={"rejectUnauthorized":true}
```

**Where to find it:**
1. Go to your Manus project dashboard
2. Click "Database" in the right panel
3. Click the settings icon (bottom left)
4. Copy the connection string

---

### **3. Manus Authentication Variables**
These are automatically injected in Manus, but you need them for VPS:

```bash
JWT_SECRET=<from_manus_project>
OAUTH_SERVER_URL=https://api.manus.im
VITE_APP_ID=<from_manus_project>
VITE_OAUTH_PORTAL_URL=https://auth.manus.im
OWNER_OPEN_ID=<from_manus_project>
OWNER_NAME=<your_name>
```

**How to get these:**
- These are in your Manus project's environment
- You can find them in the Manus dashboard → Settings → Secrets
- Or I can help you extract them

---

### **4. Manus Built-in API Keys**
For LLM, storage, and other Manus services:

```bash
BUILT_IN_FORGE_API_URL=https://forge-api.manus.im
BUILT_IN_FORGE_API_KEY=<from_manus_project>
VITE_FRONTEND_FORGE_API_KEY=<from_manus_project>
VITE_FRONTEND_FORGE_API_URL=https://forge-api.manus.im
```

---

### **5. Analytics (Optional)**
```bash
VITE_ANALYTICS_ENDPOINT=<from_manus_project>
VITE_ANALYTICS_WEBSITE_ID=<from_manus_project>
```

---

### **6. App Configuration**
```bash
VITE_APP_TITLE=Grid Trading Bot
VITE_APP_LOGO=https://your-logo-url.com/logo.png
PORT=3000
NODE_ENV=production
```

---

## 📋 **Quick Setup Steps**

### **Option 1: Get All Values from Manus (Easiest)**

I can help you extract all the Manus-specific values. Just ask me:
"Get all environment variables from the Manus project"

### **Option 2: Manual Setup**

1. **On VPS:**
```bash
cd ~/binance-trading-bot-v3
cp .env.production.template .env.production
nano .env.production
```

2. **Fill in Binance.US credentials** (from Binance.US website)

3. **Fill in Database URL** (from Manus dashboard → Database → Settings)

4. **Fill in Manus variables** (I can provide these)

5. **Save and exit:** `Ctrl+X`, then `Y`, then `Enter`

---

## ⚠️ **Security Notes**

1. **NEVER commit .env.production to Git** (it's in .gitignore)
2. **Keep BINANCE_TEST_MODE=true** until you've validated the bot
3. **Use API key restrictions** on Binance.US
4. **Add IP whitelist** to your Binance.US API key
5. **Backup your .env.production** file securely

---

## 🚀 **After Configuration**

Once `.env.production` is ready:

```bash
cd ~/binance-trading-bot-v3
./deploy-grid-bot.sh
```

This will build and start your Grid Trading Bot!

---

**Need help getting the Manus environment variables?** Just ask! 🙋‍♂️
