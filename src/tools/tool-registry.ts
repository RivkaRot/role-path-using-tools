import type { ChatCompletionTool } from 'openai/resources/chat/completions/completions';
import { createCalendarEvent } from './definitions/google-calendar.tool.js';
import { createEvent } from './handlers/google-calendar.handler.js';

type ToolEntry = {
    definition: ChatCompletionTool;
    handler: (args: unknown) => unknown | Promise<unknown>;
};

export const toolRegistry: Record<string, ToolEntry> = {
    [createCalendarEvent.function.name]: {
        definition: createCalendarEvent as ChatCompletionTool,
        handler: (args) => createEvent(args as { title: string; startDateTime: string; endDateTime: string })
    }
};

export function getToolDefinitions(): ChatCompletionTool[] {
    return Object.values(toolRegistry)
        .map(tool => tool.definition);
}

export function getToolHandler(toolName: string) {
    return toolRegistry[toolName]?.handler;
}
