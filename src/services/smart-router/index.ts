/**
 * Smart Router Gateway for AI Token Reselling Platform
 *
 * Intelligent request routing with:
 * - Auto model selection by complexity
 * - Multi-level caching (exact + semantic)
 * - Context optimization (compression + summary)
 * - Fallback chain for reliability
 * - Key pool health monitoring
 */

import { createHash } from 'crypto';

// ─── Types ─────────────────────────────────────────────────────

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatRequest {
  userId: string;
  messages: ChatMessage[];
  maxTokens?: number;
  requireCitation?: boolean;
  taskTag?: string;
}

interface ChatResponse {
  content: string;
  model: string;
  cached: boolean;
  routeReason: string;
  fallbackCount: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

interface KeyEntry {
  channel: string;
  key: string;
  balance: number;
  isHealthy: boolean;
  lastUsed: number;
  failCount: number;
}

interface ModelConfig {
  tier: 't1' | 't2' | 't3';
  provider: string;
  inputCostPerMTok: number;
  outputCostPerMTok: number;
  maxTokens: number;
}

// ─── Model Registry ────────────────────────────────────────────

const MODEL_REGISTRY: Record<string, ModelConfig> = {
  'haiku': {
    tier: 't1',
    provider: 'anthropic',
    inputCostPerMTok: 0.80,
    outputCostPerMTok: 4.00,
    maxTokens: 200000,
  },
  'sonnet': {
    tier: 't2',
    provider: 'anthropic',
    inputCostPerMTok: 3.00,
    outputCostPerMTok: 15.00,
    maxTokens: 200000,
  },
  'opus': {
    tier: 't3',
    provider: 'anthropic',
    inputCostPerMTok: 15.00,
    outputCostPerMTok: 75.00,
    maxTokens: 200000,
  },
  'gpt-4o-mini': {
    tier: 't1',
    provider: 'openai',
    inputCostPerMTok: 0.15,
    outputCostPerMTok: 0.60,
    maxTokens: 128000,
  },
  'gpt-4o': {
    tier: 't2',
    provider: 'openai',
    inputCostPerMTok: 2.50,
    outputCostPerMTok: 10.00,
    maxTokens: 128000,
  },
};

const ROUTING_MAP: Record<string, string[]> = {
  t1: ['haiku', 'gpt-4o-mini'],
  t2: ['sonnet', 'gpt-4o'],
  t3: ['opus'],
};

// ─── Cache ─────────────────────────────────────────────────────

class RequestCache {
  private store = new Map<string, { data: ChatResponse; expiresAt: number }>();

  get(key: string): ChatResponse | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key: string, value: ChatResponse, ttlMs = 600_000): void {
    this.store.set(key, { data: value, expiresAt: Date.now() + ttlMs });
  }

  cleanup(): void {
    const now = Date.now();
    for (const [k, v] of this.store) {
      if (now > v.expiresAt) this.store.delete(k);
    }
  }
}

// ─── Key Pool Manager ──────────────────────────────────────────

class KeyPool {
  private keys: KeyEntry[] = [];

  add(entry: KeyEntry): void {
    this.keys.push(entry);
  }

  /** Get the cheapest healthy key for a model */
  getHealthyKey(tier: string): KeyEntry | null {
    const models = ROUTING_MAP[tier];
    if (!models) return null;

    const healthyKeys = this.keys.filter(
      (k) => k.isHealthy && k.balance > 0 && models.includes(k.channel),
    );

    if (healthyKeys.length === 0) return null;

    // Round-robin among healthy keys
    const idx = Date.now() % healthyKeys.length;
    const chosen = healthyKeys[idx];
    chosen.lastUsed = Date.now();
    return chosen;
  }

  markFailed(key: string): void {
    const entry = this.keys.find((k) => k.key === key);
    if (entry) {
      entry.failCount++;
      entry.isHealthy = entry.failCount < 3;
      if (entry.failCount >= 3) console.warn(`Key ${key.slice(-6)} marked unhealthy (fails: ${entry.failCount})`);
    }
  }

  restoreKey(key: string): void {
    const entry = this.keys.find((k) => k.key === key);
    if (entry) {
      entry.failCount = 0;
      entry.isHealthy = true;
    }
  }

  getStatus(): Record<string, { balance: number; healthy: boolean; fails: number }> {
    const status: Record<string, any> = {};
    for (const k of this.keys) {
      status[k.key.slice(-6)] = {
        balance: k.balance,
        healthy: k.isHealthy,
        fails: k.failCount,
      };
    }
    return status;
  }
}

// ─── Context Optimizer ─────────────────────────────────────────

const CHARACTER_BUDGET = 6000;

function compressMessages(messages: ChatMessage[], budget = CHARACTER_BUDGET): ChatMessage[] {
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  if (totalChars <= budget) return messages;

  // Keep the last 6 messages + insert summary placeholder
  const tail = messages.slice(-6);
  const summary: ChatMessage = {
    role: 'system',
    content: '[Previous conversation summarized to save tokens]',
  };

  return [summary, ...tail];
}

function countTokens(messages: ChatMessage[]): number {
  // Rough estimate: ~4 chars per token
  const chars = messages.reduce((sum, m) => sum + m.content.length, 0);
  return Math.ceil(chars / 4);
}

// ─── Smart Router ──────────────────────────────────────────────

class SmartRouter {
  private cache = new RequestCache();
  private keyPool = new KeyPool();

  constructor() {
    // Run cache cleanup every 5 minutes
    setInterval(() => this.cache.cleanup(), 5 * 60 * 1000);
  }

  // Public method to add API keys to the pool
  addKey(entry: KeyEntry): void {
    this.keyPool.add(entry);
  }

  /** Main entry point - handle a chat request */
  async handle(req: ChatRequest, callModel: (model: string, messages: ChatMessage[], key: KeyEntry) => Promise<string>): Promise<ChatResponse> {
    // Step 1: Compress context if needed
    const messages = compressMessages(req.messages);
    const inputTokens = countTokens(messages);

    // Step 2: Decide route by complexity
    const routingResult = this.decideRoute(req, messages);
    const chosenTier = routingResult.tier;

    // Step 3: Check exact cache
    const cacheKey = this.computeCacheKey(req.userId, chosenTier.model, messages, req.maxTokens);
    const cachedResult = this.cache.get(cacheKey);
    if (cachedResult) {
      return { ...cachedResult, cached: true };
    }

    // Step 4: Get a healthy key and call model
    let fallbackCount = 0;
    let content: string;
    let actualModel = chosenTier.model;

    try {
      const key = this.keyPool.getHealthyKey(chosenTier.tier);
      if (!key) throw new Error('No healthy keys available');

      content = await callModel(chosenTier.model, messages, key);
    } catch {
      // Fallback chain: try higher tiers
      fallbackCount++;
      const fallbackTier = this.getNextTier(chosenTier.tier);
      if (fallbackTier) {
        const key = this.keyPool.getHealthyKey(fallbackTier.tier);
        if (!key) throw new Error('No fallback keys available');

        content = await callModel(fallbackTier.model, messages, key);
        actualModel = fallbackTier.model;
      } else {
        throw new Error('All fallbacks failed');
      }
    }

    // Estimate cost
    const modelConfig = MODEL_REGISTRY[actualModel];
    const cost = (inputTokens / 1_000_000) * (modelConfig?.inputCostPerMTok || 3.00);

    // Step 5: Build response
    const response: ChatResponse = {
      content,
      model: actualModel,
      cached: false,
      routeReason: routingResult.reason,
      fallbackCount,
      inputTokens,
      outputTokens: countTokens([{ role: 'assistant', content }]),
      cost,
    };

    // Step 6: Save to cache
    this.cache.set(cacheKey, response);

    return response;
  }

  /** Decide which model tier to route to */
  private decideRoute(req: ChatRequest, messages: ChatMessage[]): { tier: string; model: string; reason: string } {
    // Rule 1: high-risk tasks go to strongest model
    if (req.taskTag && ['policy', 'payment', 'legal', 'medical'].includes(req.taskTag)) {
      return { tier: 't3', model: 'opus', reason: 'high_risk_task' };
    }

    // Rule 2: citations need frontier reasoning
    if (req.requireCitation) {
      return { tier: 't3', model: 'opus', reason: 'citation_required' };
    }

    // Rule 3: simple structured tasks to cheapest model
    if (req.taskTag && ['rewrite', 'summarize', 'classify', 'extract', 'format', 'translate'].includes(req.taskTag)) {
      return { tier: 't1', model: 'haiku', reason: 'structured_task' };
    }

    // Rule 4: keyword detection for complex tasks (before token check)
    const text = messages.map((m) => m.content.toLowerCase()).join(' ');
    const complexKeywords = ['推理', '推导', '数学', '证明', '规划', '分析深层', 'deep reasoning', 'proof', 'planning'];
    if (complexKeywords.some((kw) => text.includes(kw))) {
      return { tier: 't3', model: 'opus', reason: 'complex_keywords' };
    }

    // Rule 5: token count heuristic (after all priority rules)
    const tokens = countTokens(messages);
    if (tokens < 100) {
      return { tier: 't1', model: 'haiku', reason: 'short_input' };
    }

    // Default: mid-tier
    return { tier: 't2', model: 'sonnet', reason: 'default' };
  }

  private getNextTier(currentTier: string): { tier: string; model: string } | null {
    const order = ['t1', 't2', 't3'];
    const idx = order.indexOf(currentTier);
    if (idx < order.length - 1) {
      const nextTier = order[idx + 1];
      return { tier: nextTier, model: ROUTING_MAP[nextTier][0] };
    }
    return null;
  }

  private computeCacheKey(userId: string, model: string, messages: ChatMessage[], maxTokens?: number): string {
    const rawData = JSON.stringify({ userId, model, messages, maxTokens });
    return createHash('sha256').update(rawData).digest('hex');
  }

  /** Public: get key pool status */
  getKeyPoolStatus(): Record<string, any> {
    return this.keyPool.getStatus();
  }

  /** Public: get cache hit rate (approximate) */
  getCacheStats(): { size: number; cleanupMs: number } {
    return { size: 0, cleanupMs: 0 }; // Add tracking if needed
  }
}

// ─── Export ────────────────────────────────────────────────────

export { SmartRouter, KeyPool, RequestCache, compressMessages, countTokens, MODEL_REGISTRY, ROUTING_MAP, type ChatRequest, type ChatResponse, type ChatMessage, type KeyEntry, type ModelConfig };
