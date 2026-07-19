export type LlmProvider = 'anthropic' | 'openai-compatible';

export interface LlmConfig {
  provider: LlmProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs: number;
}

interface Environment {
  [key: string]: string | undefined;
}

interface GenerateOptions {
  maxTokens?: number;
  fetcher?: typeof fetch;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizedBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function llmConfigFromEnv(env: Environment = process.env): LlmConfig | null {
  const requestedProvider = env.MONITOR_LLM_PROVIDER?.trim().toLowerCase();
  const provider: LlmProvider = requestedProvider === 'openai-compatible'
    ? 'openai-compatible'
    : requestedProvider === 'anthropic'
      ? 'anthropic'
      : env.MONITOR_LLM_BASE_URL
        ? 'openai-compatible'
        : 'anthropic';
  if (requestedProvider && !['anthropic', 'openai-compatible'].includes(requestedProvider)) {
    throw new Error(
      'MONITOR_LLM_PROVIDER must be "anthropic" or "openai-compatible"',
    );
  }

  const apiKey = (
    env.MONITOR_LLM_API_KEY ||
    (provider === 'openai-compatible'
      ? env.AI_GATEWAY_API_KEY || env.RUNPOD_API_KEY
      : env.ANTHROPIC_API_KEY) ||
    ''
  ).trim();
  const model = (
    env.MONITOR_LLM_MODEL ||
    env.MONITOR_TRIAGE_MODEL ||
    env.ANTHROPIC_MODEL ||
    ''
  ).trim();
  if (!apiKey && !model && !env.MONITOR_LLM_BASE_URL) return null;
  if (!apiKey) throw new Error('MONITOR_LLM_API_KEY is not configured');
  if (!model) throw new Error('MONITOR_LLM_MODEL is not configured');

  const config: LlmConfig = {
    provider,
    apiKey,
    model,
    timeoutMs: positiveInteger(env.MONITOR_LLM_TIMEOUT_MS, 600_000),
  };
  if (provider === 'openai-compatible') {
    const baseUrl = normalizedBaseUrl(env.MONITOR_LLM_BASE_URL || '');
    if (!baseUrl) {
      throw new Error('MONITOR_LLM_BASE_URL is required for openai-compatible providers');
    }
    config.baseUrl = baseUrl;
  }
  return config;
}

async function responseError(response: Response, provider: LlmProvider): Promise<Error> {
  const body = (await response.text()).slice(0, 1000);
  return new Error(
    `${provider} LLM request failed (${response.status})${body ? `: ${body}` : ''}`,
  );
}

export async function generateLlmText(
  prompt: string,
  config: LlmConfig,
  {
    maxTokens = 4096,
    fetcher = fetch,
  }: GenerateOptions = {},
): Promise<string> {
  if (!prompt.trim()) throw new Error('LLM prompt cannot be empty');
  if (!Number.isInteger(maxTokens) || maxTokens < 1) {
    throw new Error('maxTokens must be a positive integer');
  }

  const signal = AbortSignal.timeout(config.timeoutMs);
  if (config.provider === 'anthropic') {
    const response = await fetcher('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) throw await responseError(response, config.provider);
    const body = await response.json() as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = body.content?.find(part => part.type === 'text')?.text;
    if (!text) throw new Error('Anthropic response did not contain text');
    return text;
  }

  const response = await fetcher(`${normalizedBaseUrl(config.baseUrl || '')}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      stream: false,
    }),
  });
  if (!response.ok) throw await responseError(response, config.provider);
  const body = await response.json() as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const text = body.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenAI-compatible response did not contain text');
  return text;
}
