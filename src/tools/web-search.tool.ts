type SearchArgs = {
  query: string;
  limit?: number;
};

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

type BingWebSearchResponse = {
  webPages?: {
    value?: Array<{
      name?: string | null;
      url?: string | null;
      snippet?: string | null;
    }>;
  };
};

export class BingWebSearchTool {
  public constructor(private readonly apiKey: string) {}

  public async search(args: SearchArgs): Promise<SearchResult[]> {
    const limit = args.limit ?? 5;
    const url = new URL('https://api.bing.microsoft.com/v7.0/search');
    url.searchParams.set('q', args.query);
    url.searchParams.set('count', String(limit));
    url.searchParams.set('responseFilter', 'Webpages');

    const response = await fetch(url, {
      headers: {
        'Ocp-Apim-Subscription-Key': this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Bing Web Search failed with status ${response.status}`);
    }

    const payload = (await response.json()) as BingWebSearchResponse;
    const seenUrls = new Set<string>();

    return (payload.webPages?.value ?? [])
      .flatMap((entry) => {
        if (!entry.url || !entry.name || !entry.snippet) {
          return [];
        }

        let normalizedUrl: string;
        try {
          const parsedUrl = new URL(entry.url);
          if (parsedUrl.protocol !== 'https:') {
            return [];
          }
          normalizedUrl = parsedUrl.toString();
        } catch {
          return [];
        }

        if (seenUrls.has(normalizedUrl)) {
          return [];
        }

        seenUrls.add(normalizedUrl);
        return [{
          title: entry.name,
          url: normalizedUrl,
          snippet: entry.snippet,
        }];
      });
  }
}
