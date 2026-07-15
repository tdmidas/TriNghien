import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getLlmClient } from '@/lib/llm-client';
import type { CanonicalRecord, Evidence, ParsedEntry } from '@/lib/verification/types';

import { explainEntry } from './explain-entry';

vi.mock('@/lib/llm-client', () => ({ getLlmClient: vi.fn() }));

const mockedGetClient = vi.mocked(getLlmClient);

type FakeClient = ReturnType<typeof getLlmClient>;

function clientReturning(content: string): { client: FakeClient; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn(async () => ({ choices: [{ message: { content } }] }));
  return { client: { chat: { completions: { create } } } as unknown as FakeClient, create };
}

function clientThrowing(err: unknown): FakeClient {
  return {
    chat: {
      completions: {
        create: vi.fn(async () => {
          throw err;
        }),
      },
    },
  } as unknown as FakeClient;
}

const entry: ParsedEntry = {
  key: 'maml',
  type: 'inproceedings',
  title: 'Model-Agnostic Meta-Learning for Fast Adaptation of Deep Networks',
  authors: ['Chelsea Finn'],
  year: 2017,
  fields: {},
  raw: '',
};

const record: CanonicalRecord = {
  source: 'crossref',
  title: 'Model-Agnostic Meta-Learning for Fast Adaptation of Deep Networks',
  authors: ['Chelsea Finn'],
  year: 2017,
  doi: '10.5555/3305381.3305498',
};

const evidence: Evidence = {
  entryKey: 'maml',
  bestMatch: { record, score: { title: 1, author: 1, year: 'match' } },
  diffs: [],
  apiCalls: [],
};

beforeEach(() => {
  mockedGetClient.mockReset();
});

describe('explainEntry', () => {
  it('degrades gracefully when no key is configured', async () => {
    mockedGetClient.mockReturnValue(null);
    const r = await explainEntry(entry, evidence, 'VERIFIED');
    expect(r.explanation).toContain('no API key configured');
    expect(r.correctedEntry).toBeUndefined();
  });

  it('returns the explanation and a sanitized correction', async () => {
    const { client } = clientReturning(
      JSON.stringify({
        explanation: 'Bài báo đã được xác minh qua Crossref.',
        correctedEntry: { year: 2017, doi: '10.9999/invented.by.llm' },
      }),
    );
    mockedGetClient.mockReturnValue(client);
    const r = await explainEntry(entry, evidence, 'VERIFIED');
    expect(r.explanation).toContain('Crossref');
    // matching year survives; invented DOI is dropped by sanitizeCorrection
    expect(r.correctedEntry).toEqual({ year: 2017 });
  });

  it('accepts JSON wrapped in markdown fences', async () => {
    const { client } = clientReturning(
      '```json\n{"explanation": "Đã xác minh."}\n```',
    );
    mockedGetClient.mockReturnValue(client);
    const r = await explainEntry(entry, evidence, 'VERIFIED');
    expect(r.explanation).toBe('Đã xác minh.');
  });

  it('collapses a fully-dropped correction to undefined', async () => {
    const { client } = clientReturning(
      JSON.stringify({
        explanation: 'ok',
        correctedEntry: { doi: '10.9999/invented.by.llm' },
      }),
    );
    mockedGetClient.mockReturnValue(client);
    const r = await explainEntry(entry, evidence, 'MISMATCH');
    expect(r.correctedEntry).toBeUndefined();
  });

  it('reports an API-call failure distinctly (with status)', async () => {
    mockedGetClient.mockReturnValue(clientThrowing({ status: 429 }));
    const r = await explainEntry(entry, evidence, 'VERIFIED');
    expect(r.explanation).toContain('LLM call failed: 429');
  });

  it('reports an unparseable response distinctly', async () => {
    const { client } = clientReturning('Xin lỗi, tôi không thể trả lời dạng JSON.');
    mockedGetClient.mockReturnValue(client);
    const r = await explainEntry(entry, evidence, 'VERIFIED');
    expect(r.explanation).toContain('could not be parsed');
  });

  it('passes an 8s timeout to the SDK call', async () => {
    const { client, create } = clientReturning(JSON.stringify({ explanation: 'ok' }));
    mockedGetClient.mockReturnValue(client);
    await explainEntry(entry, evidence, 'VERIFIED');
    expect(create).toHaveBeenCalledWith(expect.anything(), { timeout: 8000 });
  });
});
