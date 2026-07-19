import { describe, expect, test } from 'bun:test';
import {
  generateLlmText,
  llmConfigFromEnv,
} from '../monitor/llm/client';

describe('provider-neutral monitoring LLM client', () => {
  test('keeps the existing Anthropic environment compatible', () => {
    expect(llmConfigFromEnv({
      ANTHROPIC_API_KEY: 'anthropic-key',
      MONITOR_TRIAGE_MODEL: 'claude-test',
    })).toEqual({
      provider: 'anthropic',
      apiKey: 'anthropic-key',
      model: 'claude-test',
      timeoutMs: 600000,
    });
  });

  test('configures any OpenAI-compatible gateway or self-hosted endpoint', () => {
    expect(llmConfigFromEnv({
      MONITOR_LLM_PROVIDER: 'openai-compatible',
      MONITOR_LLM_API_KEY: 'gateway-key',
      MONITOR_LLM_MODEL: 'creator/model',
      MONITOR_LLM_BASE_URL: 'https://gateway.example/v1/',
      MONITOR_LLM_TIMEOUT_MS: '900000',
    })).toEqual({
      provider: 'openai-compatible',
      apiKey: 'gateway-key',
      model: 'creator/model',
      baseUrl: 'https://gateway.example/v1',
      timeoutMs: 900000,
    });
  });

  test('normalizes OpenAI-compatible chat completion responses', async () => {
    const captured: { url?: string; body?: Record<string, unknown> } = {};
    const text = await generateLlmText('Return JSON.', {
      provider: 'openai-compatible',
      apiKey: 'runpod-key',
      model: 'Qwen/Qwen3-8B',
      baseUrl: 'https://api.runpod.ai/v2/example/openai/v1',
      timeoutMs: 1000,
    }, {
      fetcher: (async (url: string | URL | Request, init?: RequestInit) => {
        captured.url = String(url);
        captured.body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({
          choices: [{ message: { content: '{"ok":true}' } }],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch,
    });
    expect(text).toBe('{"ok":true}');
    expect(captured.url).toEndWith('/openai/v1/chat/completions');
    expect(captured.body?.model).toBe('Qwen/Qwen3-8B');
  });
});
