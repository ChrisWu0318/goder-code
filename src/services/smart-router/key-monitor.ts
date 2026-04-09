/**
 * Key Pool Health Monitor
 *
 * Monitors upstream API key health:
 * - Periodic balance checks
 * - Latency tracking
 * - Auto-detect banned/expired keys
 * - Budget alerts
 * - Automatic rotation
 */

type KeyStatus = 'healthy' | 'degraded' | 'critical' | 'dead';

interface KeyHealth {
  keyId: string;
  provider: string;
  status: KeyStatus;
  balance: number;
  latency: number;       // ms
  failCount: number;
  lastChecked: number;
  lastUsed: number;
  dailySpend: number;
  trend: 'up' | 'stable' | 'down';
}

interface Alert {
  keyId: string;
  type: 'low_balance' | 'high_fail' | 'banned' | 'high_latency' | 'budget_exceeded';
  message: string;
  severity: 'warning' | 'critical';
  timestamp: number;
}

/**
 * Core health monitoring for a pool of upstream API keys
 */
class KeyMonitor {
  private keys: Record<string, KeyHealth> = {};
  private budgetLimits: Record<string, number> = {};
  private alerts: Alert[] = [];
  private healthChecks: Array<(keyId: string) => Promise<boolean>> = [];

  /** Register an upstream API key for monitoring */
  registerKey(keyId: string, provider: string, initialBalance: number, budgetLimit: number): void {
    this.keys[keyId] = {
      keyId,
      provider,
      status: 'healthy',
      balance: initialBalance,
      latency: 0,
      failCount: 0,
      lastChecked: Date.now(),
      lastUsed: 0,
      dailySpend: 0,
      trend: 'stable',
    };
    this.budgetLimits[keyId] = budgetLimit;
  }

  /** Update balance after a successful API call */
  recordUsage(keyId: string, cost: number, latencyMs: number): void {
    const key = this.keys[keyId];
    if (!key) return;

    key.balance -= cost;
    key.dailySpend += cost;
    key.lastUsed = Date.now();
    key.latency = latencyMs;
    key.failCount = Math.max(0, key.failCount - 1);
    key.status = this.computeStatus(key);

    this.checkAlerts(key);
  }

  /** Mark a key as failed (will auto-degrade status) */
  recordFailure(keyId: string): void {
    const key = this.keys[keyId];
    if (!key) return;

    key.failCount++;
    key.lastChecked = Date.now();
    key.status = this.computeStatus(key);

    this.checkAlerts(key);
  }

  /** Restore a key (after manual verification or key rotation) */
  restoreKey(keyId: string): void {
    const key = this.keys[keyId];
    if (!key) return;

    key.failCount = 0;
    key.status = 'healthy';
    this.dismissAlerts(keyId);
  }

  /** Get all healthy keys sorted by balance (ascending - use cheapest first) */
  getHealthyKeys(statusFilter?: KeyStatus): KeyHealth[] {
    return Object.values(this.keys)
      .filter((k) => {
        if (statusFilter) return k.status === statusFilter;
        return k.status !== 'dead';
      })
      .sort((a, b) => a.balance - b.balance);
  }

  /** Get full dashboard data */
  getDashboard(): { keys: KeyHealth[]; alerts: Alert[]; summary: { total: number; healthy: number; dead: number; totalBalance: number; dailySpend: number } } {
    const values = Object.values(this.keys);
    return {
      keys: values,
      alerts: this.alerts,
      summary: {
        total: values.length,
        healthy: values.filter((k) => k.status === 'healthy').length,
        dead: values.filter((k) => k.status === 'dead').length,
        totalBalance: values.reduce((s, k) => s + k.balance, 0),
        dailySpend: values.reduce((s, k) => s + k.dailySpend, 0),
      },
    };
  }

  /** Compute status based on key metrics */
  private computeStatus(key: KeyHealth): KeyStatus {
    // Dead: banned or exhausted
    if (key.failCount >= 5 || key.balance <= 0) return 'dead';

    // Critical: very low balance or constant failures
    if (key.failCount >= 3 || key.balance < 10) return 'critical';

    // Degraded: some failures or high latency
    if (key.failCount >= 1 || key.latency > 5000) return 'degraded';

    return 'healthy';
  }

  /** Check for alert conditions */
  private checkAlerts(key: KeyHealth): void {
    const now = Date.now();

    // Low balance alert
    if (key.balance < 20 && key.status !== 'dead') {
      this.addAlert(key.keyId, 'low_balance', `Key balance $${key.balance.toFixed(2)} is critically low`, 'warning', now);
    }

    // High failure rate alert
    if (key.failCount >= 3) {
      this.addAlert(key.keyId, 'high_fail', `Key has failed ${key.failCount} times consecutively`, key.failCount >= 5 ? 'critical' : 'warning', now);
    }

    // Budget exceeded alert
    const limit = this.budgetLimits[key.keyId];
    if (limit && key.dailySpend > limit) {
      this.addAlert(key.keyId, 'budget_exceeded', `Daily spend $${key.dailySpend.toFixed(2)} exceeds limit $${limit.toFixed(2)}`, 'critical', now);
    }

    // High latency alert
    if (key.latency > 10000) {
      this.addAlert(key.keyId, 'high_latency', `Response latency ${key.latency}ms is abnormally high`, 'warning', now);
    }
  }

  private addAlert(keyId: string, type: Alert['type'], message: string, severity: Alert['severity'], timestamp: number): void {
    // Deduplicate: don't add same alert type for same key within 30 minutes
    const lastAlert = this.alerts.findLast(
      (a) => a.keyId === keyId && a.type === type && Date.now() - a.timestamp < 30 * 60 * 1000,
    );
    if (lastAlert) return;

    this.alerts.push({ keyId, type, message, severity, timestamp });
  }

  private dismissAlerts(keyId: string): void {
    this.alerts = this.alerts.filter((a) => a.keyId !== keyId);
  }

  /** Export metrics for external monitoring (Prometheus/Grafana) */
  exportMetrics(): string {
    const values = Object.values(this.keys);
    return values.map((k) => `key_health{key="${k.keyId.slice(-6)}",provider="${k.provider}"} ${k.status === 'healthy' ? 1 : k.status === 'dead' ? 0 : 0.5}`).join('\n');
  }
}

export { KeyMonitor, type KeyHealth, type KeyStatus, type Alert };
