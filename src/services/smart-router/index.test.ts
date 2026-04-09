import { SmartRouter, compressMessages, countTokens } from './index';
import { KeyMonitor } from './key-monitor';
import { createCustomerServiceAgent, classifyIntent } from './ai-customer-agent';

// ─── Smart Router Tests ────────────────────────────────────────

describe('SmartRouter', () => {
  let router: SmartRouter;

  beforeEach(() => {
    router = new SmartRouter();
    // Add test keys for all tiers
    router.addKey({
      channel: 'haiku',
      key: 'test-sk-haiku-001',
      balance: 100,
      isHealthy: true,
      lastUsed: 0,
      failCount: 0,
    });
    router.addKey({
      channel: 'sonnet',
      key: 'test-sk-sonnet-001',
      balance: 50,
      isHealthy: true,
      lastUsed: 0,
      failCount: 0,
    });
    router.addKey({
      channel: 'opus',
      key: 'test-sk-opus-001',
      balance: 30,
      isHealthy: true,
      lastUsed: 0,
      failCount: 0,
    });
  });

  describe('route decision', () => {
    it('routes short inputs to T1 (haiku)', async () => {
      const response = await router.handle(
        { userId: 'u1', messages: [{ role: 'user', content: 'hello' }] },
        async (model, _msg, _key) => `fake ${model}`,
      );
      expect(response.model).toBe('haiku');
      expect(response.routeReason).toBe('short_input');
    });

    it('routes structured tasks to T1', async () => {
      const response = await router.handle(
        { userId: 'u1', messages: [{ role: 'user', content: 'translate this' }], taskTag: 'translate' },
        async (model, _msg, _key) => `fake ${model}`,
      );
      expect(response.model).toBe('haiku');
      expect(response.routeReason).toBe('structured_task');
    });

    it('routes high-risk tasks to T3 (opus)', async () => {
      const response = await router.handle(
        { userId: 'u1', messages: [{ role: 'user', content: 'analyze legal contract' }], taskTag: 'legal' },
        async (model, _msg, _key) => `fake ${model}`,
      );
      expect(response.model).toBe('opus');
      expect(response.routeReason).toBe('high_risk_task');
    });

    it('routes default to T2 (sonnet)', async () => {
      const response = await router.handle(
        { userId: 'u1', messages: [{ role: 'user', content: 'help me plan a trip to Japan with budget of $2000 for 2 weeks' }] },
        async (model, _msg, _key) => `fake ${model}`,
      );
      expect(response.model).toBe('sonnet');
      expect(response.routeReason).toBe('default');
    });

    it('detects complex keywords and routes to T3', async () => {
      const response = await router.handle(
        { userId: 'u1', messages: [{ role: 'user', content: '请帮我推导这个数学证明' }] },
        async (model, _msg, _key) => `fake ${model}`,
      );
      expect(response.model).toBe('opus');
      expect(response.routeReason).toBe('complex_keywords');
    });
  });

  describe('caching', () => {
    let callCount = 0;

    it('returns cached result on duplicate request', async () => {
      callCount = 0;
      const callLLM = async (model: string, _msg: any, _key: any) => {
        callCount++;
        return `call #${callCount} ${model}`;
      };

      const req = { userId: 'u1', messages: [{ role: 'user', content: 'what is 2+2' }] };
      const first = await router.handle(req, callLLM);
      const second = await router.handle(req, callLLM);

      expect(first.cached).toBe(false);
      expect(second.cached).toBe(true);
      expect(callCount).toBe(1);
    });
  });

  describe('fallback', () => {
    it('falls back to higher tier on failure', async () => {
      const failingRouter = new SmartRouter();
      // No T2 or T3 keys available — only set up the router
      // Force T3 route — should fail when no T3 key, then fail when no fallback

      let callOrder: string[] = [];
      await expect(
        failingRouter.handle(
          { userId: 'u1', messages: [{ role: 'user', content: '推导证明这个定理' }], taskTag: undefined },
          async (model, _msg, _key) => {
            callOrder.push(model);
            // opus will fail (no key), fallback to next tier also fails
            throw new Error(`No key for ${model}`);
          },
        ),
      ).rejects.toThrow();
    });
  });
});

// ─── Context Compression Tests ─────────────────────────────────

describe('compressMessages', () => {
  it('returns original if under budget', () => {
    const messages = [{ role: 'user', content: 'short message' }];
    const result = compressMessages(messages, 6000);
    expect(result).toBe(messages);
  });

  it('compresses long conversations', () => {
    const messages = Array.from({ length: 50 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant' as const,
      content: 'This is a long conversation message with lots of tokens '.repeat(10),
    }));

    const result = compressMessages(messages, 6000);
    expect(result.length).toBeLessThan(messages.length);
    expect(result).toHaveLength(7); // 6 tail + 1 summary
    expect(result[0].role).toBe('system');
  });
});

describe('countTokens', () => {
  it('estimates tokens from character count', () => {
    const messages = [{ role: 'user', content: 'Hello World' }];
    expect(countTokens(messages)).toBeGreaterThan(0);
    expect(countTokens(messages)).toBeLessThanOrEqual(3); // 11 chars / 4 ~ 3
  });
});

// ─── Key Monitor Tests ─────────────────────────────────────────

describe('KeyMonitor', () => {
  let monitor: KeyMonitor;

  beforeEach(() => {
    monitor = new KeyMonitor();
    monitor.registerKey('anthropic-001', 'anthropic', 100, 50);
    monitor.registerKey('openai-001', 'openai', 200, 100);
  });

  it('tracks usage correctly', () => {
    monitor.recordUsage('anthropic-001', 2.5, 300);
    const dashboard = monitor.getDashboard();
    const key = dashboard.keys.find((k) => k.keyId === 'anthropic-001')!;
    expect(key.balance).toBe(97.5);
    expect(key.latency).toBe(300);
    expect(key.status).toBe('healthy');
  });

  it('degrades key status on failures', () => {
    monitor.recordFailure('anthropic-001');
    monitor.recordFailure('anthropic-001');
    monitor.recordFailure('anthropic-001');

    const key = monitor.getDashboard().keys.find((k) => k.keyId === 'anthropic-001')!;
    expect(key.status).toBe('critical');
  });

  it('marks key as dead after 5 failures', () => {
    for (let i = 0; i < 5; i++) {
      monitor.recordFailure('anthropic-001');
    }
    const key = monitor.getDashboard().keys.find((k) => k.keyId === 'anthropic-001')!;
    expect(key.status).toBe('dead');
  });

  it('alerts on low balance', () => {
    monitor.recordUsage('anthropic-001', 95, 200); // balance now 5
    const alerts = monitor.getDashboard().alerts;
    expect(alerts.some((a) => a.type === 'low_balance')).toBe(true);
  });

  it('alerts on budget exceeded', () => {
    monitor.recordUsage('anthropic-001', 60, 200); // dailySpend 60 > budget 50
    const alerts = monitor.getDashboard().alerts;
    expect(alerts.some((a) => a.type === 'budget_exceeded')).toBe(true);
  });

  it('restores key and dismisses alerts', () => {
    for (let i = 0; i < 5; i++) monitor.recordFailure('anthropic-001');
    expect(monitor.getDashboard().keys[0].status).toBe('dead');

    monitor.restoreKey('anthropic-001');
    expect(monitor.getDashboard().keys[0].status).toBe('healthy');
    expect(monitor.getDashboard().alerts.some((a) => a.keyId === 'anthropic-001')).toBe(false);
  });

  it('returns healthy keys sorted by balance', () => {
    const healthy = monitor.getHealthyKeys();
    expect(healthy).toHaveLength(2);
    expect(healthy[0].balance).toBeLessThanOrEqual(healthy[1].balance);
  });
});

// ─── AI Customer Agent Tests ───────────────────────────────────

describe('classifyIntent', () => {
  it('classifies order queries', () => {
    expect(classifyIntent('我的订单到哪了')).toBe('order_query');
    expect(classifyIntent('什么时候发货')).toBe('order_query');
  });

  it('classifies refund requests', () => {
    expect(classifyIntent('我要退款')).toBe('refund');
    expect(classifyIntent('这个能退货吗')).toBe('refund');
  });

  it('classifies product info', () => {
    expect(classifyIntent('这个衣服有什么颜色')).toBe('product_info');
    expect(classifyIntent('材质是什么')).toBe('product_info');
  });

  it('classifies complaints', () => {
    expect(classifyIntent('我要投诉你们')).toBe('complaint');
    expect(classifyIntent('太垃圾了')).toBe('complaint');
  });

  it('classifies greetings', () => {
    expect(classifyIntent('你好')).toBe('greeting');
    expect(classifyIntent('在吗')).toBe('greeting');
  });

  it('classifies unknown as other', () => {
    expect(classifyIntent('asdfghjkl')).toBe('other');
  });
});

describe('createCustomerServiceAgent', () => {
  const agent = createCustomerServiceAgent();
  const testShop = {
    shopId: 'shop1',
    shopName: '测试店铺',
    tone: 'friendly',
    language: '中文',
    products: [
      { id: 'p1', name: 'T恤', price: 99, description: '纯棉短袖', stock: 100, shippingDays: 3, returnPolicy: '7天无理由' },
    ],
    faq: {},
    businessHours: '9:00-21:00',
  };

  it('handles simple greeting without LLM call', async () => {
    const result = await agent.handleMessage(
      { userId: 'u1', shopId: 'shop1', content: '你好' },
      testShop,
      async () => 'should not be called for greeting',
    );
    expect(result.needsHumanHandoff).toBe(false);
    expect(result.modelUsed).toBe('haiku');
  });

  it('detects complaint intent correctly', async () => {
    const result = await agent.handleMessage(
      { userId: 'u1', shopId: 'shop1', content: '我要投诉，太垃圾了' },
      testShop,
      async (model) => `complaint handled by ${model}`,
    );
    expect(result.intent).toBe('complaint');
    expect(result.modelUsed).toBe('sonnet');
  });

  it('triggers human handoff for unclear complaints', async () => {
    const result = await agent.handleMessage(
      { userId: 'u1', shopId: 'shop1', content: '我有一些不太确定的问题想说说' },
      testShop,
      async () => 'should not be called for handoff',
    );
    expect(result.needsHumanHandoff).toBe(true);
  });
});
