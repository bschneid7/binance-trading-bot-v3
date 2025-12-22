/**
 * Time-of-Day Optimizer
 * Version: 1.0.0
 * 
 * Adjusts trading parameters based on time of day to capitalize on
 * high-volume trading periods and reduce activity during low-volume times.
 * 
 * Key trading sessions (UTC):
 * - Asian Session: 00:00-08:00 UTC (Tokyo, Hong Kong, Singapore)
 * - European Session: 07:00-16:00 UTC (London, Frankfurt)
 * - US Session: 13:00-22:00 UTC (New York)
 * - Overlap periods have highest volume
 */

export class TimeOfDayOptimizer {
  constructor(options = {}) {
    // Timezone offset from UTC (default: US Eastern = -5 or -4 DST)
    this.timezoneOffset = options.timezoneOffset || -5;
    
    // Trading session definitions (in UTC hours)
    this.sessions = {
      asian: { start: 0, end: 8, name: 'Asian', multiplier: 0.8 },
      european: { start: 7, end: 16, name: 'European', multiplier: 1.0 },
      us: { start: 13, end: 22, name: 'US', multiplier: 1.2 },
      asianEuropeanOverlap: { start: 7, end: 8, name: 'Asian-European Overlap', multiplier: 1.1 },
      europeanUsOverlap: { start: 13, end: 16, name: 'European-US Overlap', multiplier: 1.3 },
      weekend: { name: 'Weekend', multiplier: 0.7 },
      offHours: { name: 'Off Hours', multiplier: 0.6 },
    };
    
    // High-impact event hours (can be updated dynamically)
    this.highImpactHours = new Set();
    
    // Volume profile by hour (0-23 UTC) - based on typical crypto market patterns
    // Values represent relative volume (1.0 = average)
    this.hourlyVolumeProfile = [
      0.7,  // 00:00 UTC
      0.6,  // 01:00
      0.5,  // 02:00
      0.5,  // 03:00
      0.6,  // 04:00
      0.7,  // 05:00
      0.8,  // 06:00
      0.9,  // 07:00 - European open
      1.0,  // 08:00
      1.1,  // 09:00
      1.1,  // 10:00
      1.0,  // 11:00
      1.0,  // 12:00
      1.3,  // 13:00 - US pre-market
      1.5,  // 14:00 - US market open (9:30 ET)
      1.4,  // 15:00
      1.3,  // 16:00 - European close
      1.2,  // 17:00
      1.1,  // 18:00
      1.0,  // 19:00
      0.9,  // 20:00
      0.8,  // 21:00 - US market close
      0.7,  // 22:00
      0.7,  // 23:00
    ];
    
    // Day of week multipliers (0 = Sunday)
    this.dayMultipliers = [
      0.6,  // Sunday
      1.0,  // Monday
      1.1,  // Tuesday
      1.1,  // Wednesday
      1.0,  // Thursday
      0.9,  // Friday
      0.5,  // Saturday
    ];
  }

  /**
   * Get current trading session info
   * @returns {Object} Current session details
   */
  getCurrentSession() {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const utcDay = now.getUTCDay();
    
    // Check if weekend
    if (utcDay === 0 || utcDay === 6) {
      return {
        session: this.sessions.weekend,
        isWeekend: true,
        utcHour,
        utcDay,
      };
    }
    
    // Check for overlap periods first (highest priority)
    if (utcHour >= 13 && utcHour < 16) {
      return {
        session: this.sessions.europeanUsOverlap,
        isOverlap: true,
        utcHour,
        utcDay,
      };
    }
    
    if (utcHour >= 7 && utcHour < 8) {
      return {
        session: this.sessions.asianEuropeanOverlap,
        isOverlap: true,
        utcHour,
        utcDay,
      };
    }
    
    // Check individual sessions
    if (utcHour >= 13 && utcHour < 22) {
      return {
        session: this.sessions.us,
        utcHour,
        utcDay,
      };
    }
    
    if (utcHour >= 7 && utcHour < 16) {
      return {
        session: this.sessions.european,
        utcHour,
        utcDay,
      };
    }
    
    if (utcHour >= 0 && utcHour < 8) {
      return {
        session: this.sessions.asian,
        utcHour,
        utcDay,
      };
    }
    
    // Off hours
    return {
      session: this.sessions.offHours,
      utcHour,
      utcDay,
    };
  }

  /**
   * Get volume multiplier for current time
   * @returns {number} Volume multiplier (0.5-1.5)
   */
  getVolumeMultiplier() {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const utcDay = now.getUTCDay();
    
    const hourlyMultiplier = this.hourlyVolumeProfile[utcHour];
    const dayMultiplier = this.dayMultipliers[utcDay];
    
    // Combine multipliers
    let combined = hourlyMultiplier * dayMultiplier;
    
    // Check for high-impact events
    if (this.highImpactHours.has(utcHour)) {
      combined *= 1.5;
    }
    
    // Clamp to reasonable range
    return Math.max(0.5, Math.min(1.5, combined));
  }

  /**
   * Get recommended grid density adjustment
   * Higher during high-volume periods, lower during low-volume
   * @returns {Object} Grid adjustment recommendations
   */
  getGridAdjustment() {
    const sessionInfo = this.getCurrentSession();
    const volumeMultiplier = this.getVolumeMultiplier();
    
    // Grid density multiplier (affects number of active grid levels)
    // > 1.0 = more grid levels (tighter spacing)
    // < 1.0 = fewer grid levels (wider spacing)
    let gridDensityMultiplier = volumeMultiplier;
    
    // Order size multiplier
    // Higher volume = can use larger orders
    let orderSizeMultiplier = Math.sqrt(volumeMultiplier);  // Dampened effect
    
    // Spread tolerance
    // Higher volume = tighter spreads expected, can be more aggressive
    let spreadTolerance = 1.0 / volumeMultiplier;
    
    return {
      session: sessionInfo.session.name,
      sessionMultiplier: sessionInfo.session.multiplier,
      volumeMultiplier,
      gridDensityMultiplier,
      orderSizeMultiplier,
      spreadTolerance,
      isHighVolume: volumeMultiplier > 1.1,
      isLowVolume: volumeMultiplier < 0.8,
      recommendation: this.getRecommendation(volumeMultiplier, sessionInfo),
    };
  }

  /**
   * Get human-readable recommendation
   */
  getRecommendation(volumeMultiplier, sessionInfo) {
    if (sessionInfo.isWeekend) {
      return 'Weekend - reduced activity recommended, wider grids';
    }
    
    if (sessionInfo.isOverlap) {
      return `${sessionInfo.session.name} - peak volume, tighter grids and larger orders`;
    }
    
    if (volumeMultiplier > 1.2) {
      return 'High volume period - optimal for active trading';
    }
    
    if (volumeMultiplier > 1.0) {
      return 'Normal volume - standard grid parameters';
    }
    
    if (volumeMultiplier > 0.7) {
      return 'Below average volume - consider wider grids';
    }
    
    return 'Low volume period - minimal activity recommended';
  }

  /**
   * Check if current time is optimal for trading
   * @returns {boolean}
   */
  isOptimalTradingTime() {
    const volumeMultiplier = this.getVolumeMultiplier();
    return volumeMultiplier >= 1.0;
  }

  /**
   * Get time until next high-volume period
   * @returns {Object} Time until next optimal period
   */
  getTimeUntilHighVolume() {
    const now = new Date();
    const utcHour = now.getUTCHours();
    
    // Find next hour with volume > 1.0
    for (let i = 1; i <= 24; i++) {
      const checkHour = (utcHour + i) % 24;
      if (this.hourlyVolumeProfile[checkHour] >= 1.0) {
        return {
          hoursUntil: i,
          nextHighVolumeHour: checkHour,
          expectedVolume: this.hourlyVolumeProfile[checkHour],
        };
      }
    }
    
    return { hoursUntil: 0, nextHighVolumeHour: utcHour, expectedVolume: 1.0 };
  }

  /**
   * Add high-impact event hour (e.g., FOMC announcement)
   * @param {number} utcHour - Hour in UTC (0-23)
   */
  addHighImpactHour(utcHour) {
    this.highImpactHours.add(utcHour);
  }

  /**
   * Clear high-impact hours
   */
  clearHighImpactHours() {
    this.highImpactHours.clear();
  }

  /**
   * Get full time analysis
   * @returns {Object} Complete time-based analysis
   */
  getAnalysis() {
    const sessionInfo = this.getCurrentSession();
    const adjustment = this.getGridAdjustment();
    const timeUntilHigh = this.getTimeUntilHighVolume();
    
    return {
      currentTime: new Date().toISOString(),
      utcHour: sessionInfo.utcHour,
      utcDay: sessionInfo.utcDay,
      session: sessionInfo.session.name,
      isWeekend: sessionInfo.isWeekend || false,
      isOverlap: sessionInfo.isOverlap || false,
      ...adjustment,
      timeUntilHighVolume: timeUntilHigh,
      isOptimal: this.isOptimalTradingTime(),
    };
  }
}

export default TimeOfDayOptimizer;
