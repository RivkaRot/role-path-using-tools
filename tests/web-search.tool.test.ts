import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BingWebSearchTool } from '../src/tools/web-search.tool.js';

describe('BingWebSearchTool', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns only valid HTTPS search results and removes duplicates', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        webPages: {
          value: [
            { name: 'Official docs', url: 'https://example.com', snippet: 'Example' },
            { name: 'Broken protocol', url: 'http://example.com', snippet: 'Invalid' },
            { name: 'No url', url: null, snippet: 'Missing' },
            { name: 'Duplicate', url: 'https://example.com', snippet: 'Same link' },
          ],
        },
      }),
    } as never) as typeof global.fetch;

    const tool = new BingWebSearchTool('bing-key');
    const results = await tool.search({ query: 'test query', limit: 5 });

    expect(results).toEqual([
      {
        title: 'Official docs',
        url: 'https://example.com/',
        snippet: 'Example',
      },
    ]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('throws when Bing returns an error response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
    } as never) as typeof global.fetch;

    const tool = new BingWebSearchTool('bing-key');
    await expect(tool.search({ query: 'test' })).rejects.toThrow('Bing Web Search failed with status 403');
  });
});
