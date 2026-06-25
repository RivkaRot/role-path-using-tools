import { tavily } from "@tavily/core";

const tvly = tavily({
    apiKey : process.env.TAVILY_API_KEY!
})

export interface SearchResult {
    title: string;
    url: string;
    content: string;
}

export interface SerchResponse {
    answer?: string;
    results: SearchResult[];
}

export async function SearchInternet(
    query: string
): Promise<SerchResponse> {
    const response = await tvly.search(query, {
        searchDepth: "advanced",
        maxResults: 5,
        includeAnswer: true,
    });

    return {
        answer: response.answer,
        results: response.results.map(result => ({
            title: result.title,
            url: result.url,
            content: result.content
        }))
    };
}

