export type LlmProvider = 'anthropic' | 'openai-compatible';

export interface LlmConfig {
  provider: LlmProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
  // Native Gemini API base (…/v1beta). Google Search grounding is only available
  // on the native :generateContent endpoint, not the OpenAI-compatible shim.
  googleApiBaseUrl?: string;
  timeoutMs: number;
}

export interface GroundingCitation {
  uri: string;
  title: string;
}

export interface GroundedResult {
  text: string;
  citations: GroundingCitation[];
  searchQueries: string[];
}

const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

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
  // Attach a native Gemini base for grounded calls only when this is actually a
  // Gemini setup (explicit override, or an OpenAI-compatible base that points at
  // Google) so non-Google gateways keep a clean config. Grounded calls fall back
  // to the public Gemini endpoint when this is unset.
  const explicitGeminiBase = env.MONITOR_GEMINI_BASE_URL?.trim();
  const derivedGeminiBase = env.MONITOR_LLM_BASE_URL
    && /generativelanguage\.googleapis\.com/i.test(env.MONITOR_LLM_BASE_URL)
    ? normalizedBaseUrl(env.MONITOR_LLM_BASE_URL).replace(/\/openai$/, '')
    : '';
  if (explicitGeminiBase || derivedGeminiBase) {
    config.googleApiBaseUrl = normalizedBaseUrl(explicitGeminiBase || derivedGeminiBase);
  }
  return config;
}

async function responseError(response: Response, provider: string): Promise<Error> {
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

// Grounded generation via the native Gemini API with Google Search. This is a
// separate function (not a provider mode) because grounding is a capability of
// the native :generateContent endpoint only; the OpenAI-compatible shim cannot
// ground. Grounding is also incompatible with structured JSON output, so callers
// must request JSON in the prompt and parse it tolerantly.
export async function generateGroundedText(
  prompt: string,
  config: LlmConfig,
  { maxTokens = 4096, fetcher = fetch }: GenerateOptions = {},
): Promise<GroundedResult> {
  if (!prompt.trim()) throw new Error('LLM prompt cannot be empty');
  if (!Number.isInteger(maxTokens) || maxTokens < 1) {
    throw new Error('maxTokens must be a positive integer');
  }
  const baseUrl = normalizedBaseUrl(config.googleApiBaseUrl || DEFAULT_GEMINI_BASE_URL);
  const signal = AbortSignal.timeout(config.timeoutMs);
  const response = await fetcher(
    `${baseUrl}/models/${encodeURIComponent(config.model)}:generateContent`,
    {
      method: 'POST',
      signal,
      headers: {
        'x-goog-api-key': config.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    },
  );
  if (!response.ok) throw await responseError(response, 'gemini-grounded');
  const body = await response.json() as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      groundingMetadata?: {
        groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
        webSearchQueries?: string[];
      };
    }>;
  };
  const candidate = body.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .map(part => part.text ?? '')
    .join('')
    .trim();
  if (!text) throw new Error('Gemini grounded response did not contain text');
  const citations: GroundingCitation[] = (candidate?.groundingMetadata?.groundingChunks ?? [])
    .flatMap(chunk => (chunk.web?.uri ? [{ uri: chunk.web.uri, title: chunk.web.title ?? '' }] : []));
  const searchQueries = candidate?.groundingMetadata?.webSearchQueries ?? [];
  return { text, citations, searchQueries };
}

// Grounding citation URIs are short-lived Google redirect links, not the primary
// source. Follow one to recover the real destination host for cross-checking.
export async function resolveRedirect(
  uri: string,
  { fetcher = fetch, timeoutMs = 10_000 }: { fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<string> {
  try {
    const response = await fetcher(uri, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.url || uri;
  } catch {
    return uri;
  }
}
