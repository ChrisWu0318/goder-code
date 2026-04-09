/**
 * AI Customer Service Agent
 *
 * Pre-packaged vertical solution: AI客服 for e-commerce
 * Productizes the smart router + prompt templates + RAG into
 * a complete customer service product.
 */

type CustomerIntent = 'order_query' | 'refund' | 'shipping' | 'product_info' | 'complaint' | 'greeting' | 'other';

interface ProductInfo {
  id: string;
  name: string;
  price: number;
  description: string;
  stock: number;
  shippingDays: number;
  returnPolicy: string;
}

interface ShopConfig {
  shopId: string;
  shopName: string;
  tone: 'friendly' | 'professional' | 'casual';
  language: string;
  products: ProductInfo[];
  faq: Record<string, string>;
  businessHours: string;
  humanHandoffPhone?: string;
}

interface CustomerMessage {
  userId: string;
  shopId: string;
  content: string;
  context?: string[];
}

interface AgentResponse {
  reply: string;
  intent: CustomerIntent;
  confidence: number;
  modelUsed: string;
  needsHumanHandoff: boolean;
  cost: number;
}

// ─── Intent Classifier (runs on T1 cheap model) ────────────────

const INTENT_KEYWORDS: Record<CustomerIntent, string[]> = {
  order_query: ['订单', '物流', '发货', '快递', '到哪了', '什么时候到', 'tracking', 'order'],
  refund: ['退款', '退货', '换货', '返款', 'refund', 'return'],
  shipping: ['运费', '包邮', '几天到', '配送', 'shipping', 'delivery'],
  product_info: ['这个能', '怎么用', '材质', '规格', '尺寸', '颜色', 'size', 'what', 'how'],
  complaint: ['差评', '投诉', '不满意', '垃圾', '投诉', 'angry', 'complaining'],
  greeting: ['你好', '在吗', '您好', 'hello', 'hi', 'hey'],
  other: [],
};

function classifyIntent(content: string): CustomerIntent {
  const text = content.toLowerCase();
  let best: CustomerIntent = 'other';
  let bestCount = 0;

  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    const count = keywords.filter((kw) => text.includes(kw)).length;
    if (count > bestCount) {
      bestCount = count;
      best = intent as CustomerIntent;
    }
  }

  return best;
}

// ─── Prompt Builder ─────────────────────────────────────────────

function buildSystemPrompt(intent: CustomerIntent, shop: ShopConfig, context: string[]): string {
  const systemPrompts: Record<CustomerIntent, string> = {
    order_query: `You are a customer service agent for ${shop.shopName}.
The customer is asking about order/tracking status.
Politely ask for their order number and explain tracking takes 1-2 business days to activate.
Tone: ${shop.tone}. Language: ${shop.language}.
Keep response under 100 characters.`,

    refund: `You are a customer service agent for ${shop.shopName}.
The customer wants a refund.
Check: 1) Is within 7 days? 2) Product unused? 3) Original packaging?
If yes, approve refund. If unsure, escalate to human.
Tone: ${shop.tone}, empathetic. Language: ${shop.language}.
Keep response under 150 characters.`,

    shipping: `You are a customer service agent for ${shop.shopName}.
The customer asks about shipping.
Shipping: ${shop.products.length > 0 ? 'Free for orders over ¥50, delivery in ' + Math.max(...shop.products.map(p => p.shippingDays)) + ' days' : 'Standard 3-5 business days'}.
Tone: ${shop.tone}. Language: ${shop.language}.`,

    product_info: `You are a customer service agent for ${shop.shopName}.
Products available:
${shop.products.map(p => `- ${p.name}: ¥${p.price}, ${p.description}, Stock: ${p.stock > 0 ? 'In stock' : 'Out of stock'}`).join('\n')}

Answer product questions factually. If unsure, say you'll check and get back.
Tone: ${shop.tone}. Language: ${shop.language}.`,

    complaint: `You are a customer service agent for ${shop.shopName}.
The customer is upset. APOLOGIZE FIRST, then try to help.
If they mention product quality -> offer refund within 7 days.
If delivery issue -> escalate to human after empathizing.
Tone: apologetic and helpful. Language: ${shop.language}.`,

    greeting: `You are a friendly customer service agent for ${shop.shopName}.
Business hours: ${shop.businessHours}.
Greet warmly and ask how you can help.
Tone: ${shop.tone}. Language: ${shop.language}.`,

    other: `You are a customer service agent for ${shop.shopName}.
The customer asked something unclear. Politely ask them to rephrase.
Be friendly and helpful. Language: ${shop.language}.`,
  };

  return systemPrompts[intent];
}

function shouldHandoff(intent: CustomerIntent, confidence: number): boolean {
  if (intent === 'complaint' && confidence < 0.6) return true;
  if (intent === 'other') return confidence < 0.4;
  return false;
}

// ─── Main Agent ────────────────────────────────────────────────

function createCustomerServiceAgent() {
  return {
    /**
     * Process a customer message and generate response.
     *
     * @param message - customer message
     * @param shop - shop configuration and product catalog
     * @param callLLM - function to call the actual model (injected for routing)
     * @returns AgentResponse with reply, intent, cost info
     */
    async handleMessage(
      message: CustomerMessage,
      shop: ShopConfig,
      callLLM: (model: string, systemPrompt: string, userMessage: string) => Promise<string>,
    ): Promise<AgentResponse> {
      // Step 1: Classify intent (could also call a T1 model here)
      const intent = classifyIntent(message.content);
      const confidence = estimateConfidence(intent, message.content);

      // Step 2: Check if human handoff needed
      if (shouldHandoff(intent, confidence)) {
        return {
          reply: `感谢您的反馈，您的问题需要人工客服进一步处理。我们将尽快联系您。${shop.businessHours ? `\n工作时间: ${shop.businessHours}` : ''}`,
          intent,
          confidence,
          modelUsed: 'handoff',
          needsHumanHandoff: true,
          cost: 0,
        };
      }

      // Step 3: Choose model by intent complexity
      const model = intent === 'complaint' || intent === 'refund' ? 'sonnet' : 'haiku';

      // Step 4: Build prompt
      const systemPrompt = buildSystemPrompt(intent, shop, message.context || []);

      // Step 5: Call model and return response
      const reply = await callLLM(model, systemPrompt, message.content);

      return {
        reply,
        intent,
        confidence,
        modelUsed: model,
        needsHumanHandoff: false,
        cost: model === 'sonnet' ? 0.003 : 0.0008, // rough per-message cost
      };
    },
  };
}

function estimateConfidence(intent: CustomerIntent, content: string): number {
  const text = content.toLowerCase();
  const keywords = INTENT_KEYWORDS[intent];
  if (keywords.length === 0) return 0.3;

  const matches = keywords.filter((kw) => text.includes(kw)).length;
  return Math.min(matches / Math.max(keywords.length, 1) * 2, 1.0);
}

export { createCustomerServiceAgent, classifyIntent, buildSystemPrompt, type CustomerIntent, type ProductInfo, type ShopConfig, type CustomerMessage, type AgentResponse };
