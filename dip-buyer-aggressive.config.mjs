/**
 * DCA Dip Buyer - Aggressive Flash Crash Configuration
 * Optimized for capturing significant market dips during volatile periods
 * 
 * WARNING: This configuration uses more capital and has higher risk exposure.
 * Only use if you understand the risks and have sufficient capital reserves.
 * 
 * Created: December 24, 2025
 */

export const AGGRESSIVE_DIP_CONFIG = {
  // ═══════════════════════════════════════════════════════════════════════════
  // SYMBOLS TO MONITOR
  // ═══════════════════════════════════════════════════════════════════════════
  SYMBOLS: ['BTC/USD', 'ETH/USD', 'SOL/USD'],
  
  // ═══════════════════════════════════════════════════════════════════════════
  // DIP DETECTION - MULTI-TIER SYSTEM
  // ═══════════════════════════════════════════════════════════════════════════
  // Tier 1: Minor dip (standard accumulation)
  DIP_TIER_1: {
    THRESHOLD: -3.0,           // 3% drop triggers Tier 1
    ORDER_SIZE_USD: 100,       // $100 per buy
    LOOKBACK_MINUTES: 60,      // 1 hour lookback
  },
  
  // Tier 2: Moderate dip (increased accumulation)
  DIP_TIER_2: {
    THRESHOLD: -5.0,           // 5% drop triggers Tier 2
    ORDER_SIZE_USD: 200,       // $200 per buy (2x normal)
    LOOKBACK_MINUTES: 120,     // 2 hour lookback
  },
  
  // Tier 3: Flash crash (aggressive accumulation)
  DIP_TIER_3: {
    THRESHOLD: -8.0,           // 8% drop triggers Tier 3
    ORDER_SIZE_USD: 400,       // $400 per buy (4x normal)
    LOOKBACK_MINUTES: 240,     // 4 hour lookback
  },
  
  // Tier 4: Major crash (maximum accumulation)
  DIP_TIER_4: {
    THRESHOLD: -12.0,          // 12% drop triggers Tier 4
    ORDER_SIZE_USD: 600,       // $600 per buy (6x normal)
    LOOKBACK_MINUTES: 480,     // 8 hour lookback
  },
  
  // Legacy single-tier config (for backwards compatibility)
  DIP_THRESHOLD: -3.0,
  LOOKBACK_MINUTES: 60,
  ORDER_SIZE_USD: 100,
  
  // ═══════════════════════════════════════════════════════════════════════════
  // POSITION MANAGEMENT - AGGRESSIVE SETTINGS
  // ═══════════════════════════════════════════════════════════════════════════
  MAX_POSITION_USD: 800,       // Max $800 per symbol (up from $300)
  MAX_TOTAL_DEPLOYED: 2500,    // Max $2,500 total (up from $1,000)
  
  // Per-symbol allocation weights (prioritize SOL based on backtest performance)
  SYMBOL_WEIGHTS: {
    'BTC/USD': 0.30,           // 30% allocation to BTC
    'ETH/USD': 0.20,           // 20% allocation to ETH (reduced - worst performer)
    'SOL/USD': 0.50,           // 50% allocation to SOL (best backtest performance)
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // TAKE PROFIT / STOP LOSS - OPTIMIZED FOR FLASH CRASHES
  // ═══════════════════════════════════════════════════════════════════════════
  // Dynamic take profit based on entry tier
  TAKE_PROFIT_BY_TIER: {
    TIER_1: 2.5,               // 2.5% profit target for minor dips
    TIER_2: 4.0,               // 4% profit target for moderate dips
    TIER_3: 6.0,               // 6% profit target for flash crashes
    TIER_4: 10.0,              // 10% profit target for major crashes
  },
  
  // Legacy single take profit (for backwards compatibility)
  TAKE_PROFIT_PCT: 3.5,        // Default 3.5% (up from 2.5%)
  
  // Trailing stop loss (activates after position is in profit)
  TRAILING_STOP: {
    ENABLED: true,
    ACTIVATION_PCT: 2.0,       // Activate trailing stop after 2% profit
    TRAIL_PCT: 1.5,            // Trail 1.5% behind highest price
  },
  
  // Hard stop loss (emergency exit)
  STOP_LOSS_PCT: -8.0,         // -8% hard stop (wider than default -5%)
  
  // Time-based exit (for stuck positions)
  MAX_HOLD_HOURS: null,        // Disabled - patience pays off, no forced time-based exit
  TIME_BASED_EXIT_PCT: 0.5,    // Accept 0.5% profit after max hold time
  
  // ═══════════════════════════════════════════════════════════════════════════
  // TIMING - FASTER RESPONSE FOR FLASH CRASHES
  // ═══════════════════════════════════════════════════════════════════════════
  CHECK_INTERVAL_MS: 15000,    // Check every 15 seconds (2x faster)
  MIN_TIME_BETWEEN_BUYS: 120000, // 2 minutes between buys (down from 5 min)
  
  // Rapid-fire mode during flash crashes
  FLASH_CRASH_MODE: {
    ENABLED: true,
    TRIGGER_PCT: -5.0,         // Enable rapid-fire when 5%+ dip detected
    MIN_TIME_BETWEEN_BUYS: 60000, // 1 minute between buys in flash crash mode
    MAX_RAPID_BUYS: 5,         // Max 5 rapid buys per flash crash event
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // RESERVE PROTECTION
  // ═══════════════════════════════════════════════════════════════════════════
  MIN_USD_RESERVE: 1800,       // Keep $1,800 for grid operations (up from $1,200)
  
  // Dynamic reserve based on market conditions
  DYNAMIC_RESERVE: {
    ENABLED: true,
    HIGH_VOLATILITY_RESERVE: 2500,  // Keep more reserve during high volatility
    LOW_VOLATILITY_RESERVE: 1500,   // Use more capital during calm markets
    VOLATILITY_THRESHOLD: 5.0,      // 5% daily move = high volatility
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PRICE LEVEL TARGETS (Buy more aggressively near key support)
  // ═══════════════════════════════════════════════════════════════════════════
  SUPPORT_LEVELS: {
    'BTC/USD': [82000, 78000, 75000],   // Key BTC support levels
    'ETH/USD': [2700, 2500, 2250],      // Key ETH support levels
    'SOL/USD': [117, 110, 100],         // Key SOL support levels
  },
  
  // Bonus multiplier when price hits support levels
  SUPPORT_LEVEL_BONUS: {
    LEVEL_1: 1.5,              // 1.5x order size at first support
    LEVEL_2: 2.0,              // 2x order size at second support
    LEVEL_3: 3.0,              // 3x order size at third support (major crash)
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // NOTIFICATIONS (Optional - requires webhook setup)
  // ═══════════════════════════════════════════════════════════════════════════
  NOTIFICATIONS: {
    ENABLED: false,
    WEBHOOK_URL: '',           // Discord/Slack webhook URL
    NOTIFY_ON_DIP: true,
    NOTIFY_ON_BUY: true,
    NOTIFY_ON_SELL: true,
    NOTIFY_ON_FLASH_CRASH: true,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// COMPARISON: DEFAULT vs AGGRESSIVE SETTINGS
// ═══════════════════════════════════════════════════════════════════════════
/*
┌─────────────────────────────┬─────────────────┬─────────────────────────────┐
│ Setting                     │ Default         │ Aggressive                  │
├─────────────────────────────┼─────────────────┼─────────────────────────────┤
│ Dip Threshold               │ -3%             │ -3% to -12% (tiered)        │
│ Order Size                  │ $100            │ $100 to $600 (tiered)       │
│ Max Position/Symbol         │ $300            │ $800                        │
│ Max Total Deployed          │ $1,000          │ $2,500                      │
│ Take Profit                 │ 2.5%            │ 2.5% to 10% (tiered)        │
│ Stop Loss                   │ -5%             │ -8%                         │
│ Check Interval              │ 30 sec          │ 15 sec                      │
│ Min Time Between Buys       │ 5 min           │ 2 min (1 min in flash mode) │
│ USD Reserve                 │ $1,200          │ $1,800 (dynamic)            │
│ Trailing Stop               │ No              │ Yes (2% activation)         │
│ Support Level Targeting     │ No              │ Yes (1.5x-3x bonus)         │
└─────────────────────────────┴─────────────────┴─────────────────────────────┘
*/

export default AGGRESSIVE_DIP_CONFIG;
