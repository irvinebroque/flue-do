import type { FlueContext, FlueEvent, PromptUsage } from '@flue/runtime';

type EventSubscriber = (event: FlueEvent) => void | Promise<void>;

type ObservableContext = FlueContext & {
  subscribeEvent?: (callback: EventSubscriber) => () => void;
};

type SessionRecorder = {
  readonly available: boolean;
  stop(): FlueEvent[];
};

type SessionTranscriptInput = {
  agent: string;
  instance: string;
  runId: string;
  message: string;
  events: FlueEvent[];
  outcome: unknown;
  model?: { id?: string };
  usage?: PromptUsage;
  eventsUrl: string;
  streamUrl: string;
};

const hiddenEventTypes = new Set<FlueEvent['type']>([
  'thinking_start',
  'thinking_delta',
  'thinking_end',
  'idle',
]);

export function createSessionRecorder(ctx: FlueContext): SessionRecorder {
  const events: FlueEvent[] = [];
  const subscribeEvent = (ctx as ObservableContext).subscribeEvent;
  let stopped = false;
  const unsubscribe = typeof subscribeEvent === 'function'
    ? subscribeEvent((event) => {
      if (!hiddenEventTypes.has(event.type)) events.push(event);
    })
    : undefined;

  return {
    available: Boolean(unsubscribe),
    stop() {
      if (!stopped) {
        stopped = true;
        unsubscribe?.();
      }
      return [...events];
    },
  };
}

export function runInspectionUrls(ctx: FlueContext) {
  const path = `/runs/${encodeURIComponent(ctx.runId)}`;
  const origin = ctx.req ? new URL(ctx.req.url).origin : '';

  return {
    run: `${origin}${path}`,
    events: `${origin}${path}/events?limit=1000`,
    stream: `${origin}${path}/stream`,
  };
}

export function formatSessionTranscript(input: SessionTranscriptInput) {
  const lines: string[] = [
    '# Agent Session',
    '',
    `Agent: ${input.agent}`,
    `Instance: ${input.instance}`,
    `Run: ${input.runId}`,
    `User request: ${input.message}`,
    '',
    '## Activity',
  ];

  let assistantText = '';
  let toolCount = 0;

  const flushAssistant = () => {
    const text = assistantText.trim();
    if (text.length > 0) {
      lines.push('', 'Assistant:', fenced(text, 'text'));
      assistantText = '';
    }
  };

  for (const event of input.events) {
    switch (event.type) {
      case 'text_delta':
        assistantText += event.text;
        break;
      case 'log':
        flushAssistant();
        lines.push('', `Log (${event.level}): ${event.message}`);
        if (event.attributes) lines.push(fenced(stringify(event.attributes), 'json'));
        break;
      case 'operation_start':
        flushAssistant();
        lines.push('', `Started ${event.operationKind} operation.`);
        break;
      case 'operation':
        flushAssistant();
        lines.push('', `${capitalize(event.operationKind)} operation finished in ${event.durationMs}ms${event.isError ? ' with an error' : ''}.`);
        break;
      case 'tool_start': {
        flushAssistant();
        toolCount += 1;
        lines.push('', `Tool ${toolCount}: ${event.toolName}`);
        const command = commandFromArgs(event.args);
        if (command) lines.push(fenced(command, 'bash'));
        else if (event.args !== undefined) lines.push(fenced(stringify(event.args), 'json'));
        break;
      }
      case 'tool_call': {
        flushAssistant();
        const status = event.isError ? 'failed' : 'completed';
        lines.push(`Tool result: ${status} in ${event.durationMs}ms.`);
        const resultText = toolResultText(event.result);
        if (resultText.length > 0) lines.push(fenced(resultText, 'text'));
        break;
      }
      case 'turn':
        flushAssistant();
        lines.push('', `Model turn finished in ${event.durationMs}ms${event.model ? ` on ${event.model}` : ''}${usageSuffix(event.usage)}.`);
        break;
      case 'task_start':
        flushAssistant();
        lines.push('', `Task started: ${event.taskId}`);
        lines.push(fenced(event.prompt, 'text'));
        break;
      case 'task':
        flushAssistant();
        lines.push('', `Task ${event.taskId} finished in ${event.durationMs}ms${event.isError ? ' with an error' : ''}.`);
        if (event.result !== undefined) lines.push(fenced(stringify(event.result), 'json'));
        break;
      case 'compaction_start':
        flushAssistant();
        lines.push('', `Context compaction started (${event.reason}, estimated ${event.estimatedTokens} tokens).`);
        break;
      case 'compaction':
        flushAssistant();
        lines.push('', `Context compaction finished in ${event.durationMs}ms (${event.messagesBefore} messages to ${event.messagesAfter}).`);
        break;
      case 'run_start':
      case 'run_end':
        break;
    }
  }

  flushAssistant();
  lines.push(
    '',
    '## Outcome',
    fenced(stringify(input.outcome), 'json'),
    '',
    `Model: ${input.model?.id ?? 'unknown'}${usageSuffix(input.usage)}`,
    `Durable event log: ${input.eventsUrl}`,
    `Replayable event stream: ${input.streamUrl}`,
  );

  return lines.join('\n');
}

function commandFromArgs(args: unknown) {
  if (!args || typeof args !== 'object') return undefined;
  const command = (args as { command?: unknown }).command;
  return typeof command === 'string' ? command : undefined;
}

function toolResultText(result: unknown) {
  if (typeof result === 'string') return result.trim();
  if (!result || typeof result !== 'object') return '';

  const content = (result as { content?: unknown }).content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (item && typeof item === 'object' && (item as { type?: unknown }).type === 'text') {
          const text = (item as { text?: unknown }).text;
          return typeof text === 'string' ? text : '';
        }
        return stringify(item);
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  return stringify(result);
}

function usageSuffix(usage: PromptUsage | undefined) {
  return usage ? `, ${usage.totalTokens} tokens` : '';
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function stringify(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function fenced(value: string, lang: string) {
  return `\`\`\`${lang}\n${value.trim()}\n\`\`\``;
}
