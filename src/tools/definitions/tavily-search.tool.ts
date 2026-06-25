export const tavilySearch = {
    type: "function" as const,
    function: {
      name: "search_internet",
      description: "Search the internet for up-to-date information",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query"
          }
        },
        required: ["query"]
      }
    }
};