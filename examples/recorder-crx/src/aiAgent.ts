/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 */

import type { CrxRecorder, Page } from 'playwright-crx';
import type { ClaudeModelId } from './settings';
import { CLAUDE_TOOLS, SYSTEM_PROMPT, executeTool } from './aiTools';

const MODEL_IDS: Record<ClaudeModelId, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-7',
};

const TOOL_HARD_TIMEOUT_MS = 60_000;
const API_OVERALL_TIMEOUT_MS = 180_000;
const STREAM_IDLE_TIMEOUT_MS = 45_000;

// eslint-disable-next-line no-console
const dbg = (...args: any[]) => console.debug('[ai]', ...args);
// eslint-disable-next-line no-console
const dbgErr = (...args: any[]) => console.error('[ai]', ...args);

function withHardTimeout<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('cancelled'));
    };
    const timer = setTimeout(() => {
      if (settled)
        return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      reject(new Error(`Tool execution timed out after ${ms}ms (the page or Playwright call did not respond).`));
    }, ms);
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    p.then(v => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(v);
    }, e => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(e);
    });
  });
}

export type AgentStreamEvent =
  | { kind: 'text'; delta: string }
  | { kind: 'tool_call'; id: string; name: string; input: unknown }
  | { kind: 'tool_result'; id: string; name: string; ok: boolean; value?: unknown; error?: string }
  | { kind: 'usage'; input: number; output: number; cacheRead?: number; cacheWrite?: number }
  | { kind: 'error'; message: string }
  | { kind: 'done'; summary?: string; reason: 'finish' | 'end_turn' | 'max_steps' | 'cancelled' | 'error' };

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown };

export type AgentMessage =
  | { role: 'user'; content: string | Array<{ type: 'text'; text: string } | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }> }
  | { role: 'assistant'; content: ContentBlock[] };

type Message = AgentMessage;

export type AgentOptions = {
  apiKey: string;
  model: ClaudeModelId;
  maxSteps: number;
  maxTokens?: number;
  prompt: string;
  currentScript?: string;
  pageUrl?: string;
  localBaseUrl?: string;
  priorMessages?: AgentMessage[];
  getPage: () => Page | undefined;
  getRecorder: () => CrxRecorder | undefined;
  popNetworkErrors?: () => Array<{ url: string; method: string; status: number; failure?: string; timestamp: number }>;
  onEvent: (e: AgentStreamEvent) => void;
  onMessages?: (messages: AgentMessage[]) => void;
  signal?: AbortSignal;
};

export async function runAgent(opts: AgentOptions) {
  const { apiKey, model, maxSteps, maxTokens, prompt, currentScript, pageUrl, localBaseUrl, priorMessages, getPage, getRecorder, onEvent, onMessages, signal } = opts;

  const messages: Message[] = sanitizeMessages(priorMessages ?? []);
  const userText = buildInitialUserText(prompt, currentScript, pageUrl, localBaseUrl, messages.length > 0);
  messages.push({ role: 'user', content: userText });
  onMessages?.(messages);

  for (let step = 0; step < maxSteps; step++) {
    if (signal?.aborted) {
      onEvent({ kind: 'done', reason: 'cancelled' });
      return;
    }

    let assistantBlocks: ContentBlock[];
    let stopReason: string | undefined;
    try {
      dbg('step', step, 'calling claude api');
      ({ assistantBlocks, stopReason } = await withHardTimeout(
          callClaudeStream({
            apiKey,
            model: MODEL_IDS[model],
            maxTokens: maxTokens ?? 8192,
            messages,
            onEvent,
            signal,
          }),
          API_OVERALL_TIMEOUT_MS,
          signal,
      ));
      dbg('step', step, 'claude responded with', assistantBlocks.length, 'blocks, stopReason=', stopReason);
    } catch (e: any) {
      dbgErr('step', step, 'api error', e);
      if (signal?.aborted) {
        onEvent({ kind: 'done', reason: 'cancelled' });
        return;
      }
      onEvent({ kind: 'error', message: e?.message ?? String(e) });
      onEvent({ kind: 'done', reason: 'error' });
      return;
    }

    messages.push({ role: 'assistant', content: assistantBlocks });
    onMessages?.(messages);

    const toolCalls = assistantBlocks.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
    if (!toolCalls.length) {
      onEvent({ kind: 'done', reason: stopReason === 'end_turn' ? 'end_turn' : 'end_turn' });
      return;
    }

    const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }> = [];
    let finishCall: { id: string; summary: string } | undefined;

    for (const call of toolCalls) {
      let result: { ok: true; value?: unknown } | { ok: false; error: string };

      if (signal?.aborted) {
        // Cancelled — record a synthetic tool_result so the assistant block stays balanced.
        result = { ok: false, error: 'cancelled by user' };
      } else if ((call.input as any)?.__truncated) {
        result = {
          ok: false,
          error: 'Your tool input JSON was cut off mid-stream — almost certainly because the response hit the max_tokens cap. Send a SHORTER value: keep the test minimal, drop comments, omit duplicate steps, or call replaceTest in two phases (a smaller skeleton first, then extend).',
        };
        onEvent({ kind: 'tool_call', id: call.id, name: call.name, input: call.input });
        onEvent({ kind: 'tool_result', id: call.id, name: call.name, ok: false, error: result.error });
      } else if (call.name === 'finish') {
        const summary = (call.input as any)?.summary;
        const summaryStr = typeof summary === 'string' ? summary : '';
        finishCall = { id: call.id, summary: summaryStr };
        result = { ok: true, value: { summary: summaryStr } };
        onEvent({ kind: 'tool_call', id: call.id, name: call.name, input: call.input });
        onEvent({ kind: 'tool_result', id: call.id, name: 'finish', ok: true, value: result.value });
      } else {
        onEvent({ kind: 'tool_call', id: call.id, name: call.name, input: call.input });
        const page = getPage();
        const recorder = getRecorder();
        if (!page) {
          result = { ok: false, error: 'No page is currently attached. Ask the user to attach a tab first.' };
        } else if (!recorder) {
          result = { ok: false, error: 'Recorder is not available.' };
        } else {
          try {
            dbg('tool start', call.name, call.input);
            result = await withHardTimeout(
                executeTool(call.name, call.input, { page, recorder, popNetworkErrors: opts.popNetworkErrors }),
                TOOL_HARD_TIMEOUT_MS,
                signal,
            );
            dbg('tool done', call.name, result);
          } catch (e: any) {
            dbgErr('tool error', call.name, e);
            result = { ok: false, error: e?.message ?? String(e) };
          }
        }
        onEvent({
          kind: 'tool_result',
          id: call.id,
          name: call.name,
          ok: result.ok,
          value: result.ok ? (result as any).value : undefined,
          error: !result.ok ? (result as any).error : undefined,
        });
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: JSON.stringify(result),
        is_error: !result.ok,
      });

      // After finish, stop processing further tools — we're done.
      if (finishCall)
        break;
    }

    // Defensive: every tool_use must have a matching tool_result.
    const recordedIds = new Set(toolResults.map(r => r.tool_use_id));
    for (const call of toolCalls) {
      if (recordedIds.has(call.id))
        continue;
      toolResults.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: JSON.stringify({ ok: false, error: 'no result recorded (interrupted)' }),
        is_error: true,
      });
    }

    messages.push({ role: 'user', content: toolResults });
    onMessages?.(messages);

    if (finishCall) {
      onEvent({ kind: 'done', reason: 'finish', summary: finishCall.summary || undefined });
      return;
    }
    if (signal?.aborted) {
      onEvent({ kind: 'done', reason: 'cancelled' });
      return;
    }
    // Otherwise the for-loop continues to the next API call.
  }

  onEvent({ kind: 'done', reason: 'max_steps' });
}

/**
 * Repair any orphan tool_use blocks in stored conversation history. The
 * Anthropic API requires every assistant tool_use block to be followed by a
 * user message containing a matching tool_result for each one, otherwise it
 * rejects the request with a 400. Our agent guarantees this going forward,
 * but conversations stored before the fix may be unbalanced — this walks the
 * array and inserts synthetic tool_result blocks for any missing IDs.
 */
function sanitizeMessages(messages: AgentMessage[]): AgentMessage[] {
  const out: AgentMessage[] = [];
  let i = 0;
  while (i < messages.length) {
    const m = messages[i];
    if (m.role !== 'assistant' || !Array.isArray(m.content)) {
      out.push(m);
      i++;
      continue;
    }
    const toolUseIds: string[] = [];
    for (const block of m.content) {
      if ((block as any).type === 'tool_use')
        toolUseIds.push((block as any).id);
    }
    out.push(m);
    if (toolUseIds.length === 0) {
      i++;
      continue;
    }
    const next = messages[i + 1];
    const existingResultIds = new Set<string>();
    let nextContent: any[] = [];
    if (next && next.role === 'user' && Array.isArray(next.content)) {
      nextContent = [...next.content];
      for (const block of nextContent) {
        if (block?.type === 'tool_result' && typeof block.tool_use_id === 'string')
          existingResultIds.add(block.tool_use_id);
      }
    }
    const synthetic = toolUseIds
        .filter(id => !existingResultIds.has(id))
        .map(id => ({
          type: 'tool_result' as const,
          tool_use_id: id,
          content: JSON.stringify({ ok: false, error: 'no result recorded (interrupted)' }),
          is_error: true,
        }));
    if (synthetic.length === 0 && next && next.role === 'user') {
      out.push(next);
      i += 2;
      continue;
    }
    if (next && next.role === 'user' && Array.isArray(next.content)) {
      out.push({ role: 'user', content: [...nextContent, ...synthetic] });
      i += 2;
    } else {
      out.push({ role: 'user', content: synthetic });
      i += 1;
    }
  }
  return out;
}

function buildInitialUserText(prompt: string, currentScript?: string, pageUrl?: string, localBaseUrl?: string, isContinuation = false): string {
  const parts: string[] = [];
  if (pageUrl)
    parts.push(`Current page URL: ${pageUrl}`);
  if (localBaseUrl)
    parts.push(`User's local-dev base URL (for context only — do NOT add a BASE_URL constant; use relative paths in goto): ${localBaseUrl}`);
  if (!isContinuation && currentScript && currentScript.trim()) {
    parts.push('Current generated script (the recorder will keep this in sync as you act):');
    parts.push('```');
    parts.push(currentScript.slice(0, 6000));
    parts.push('```');
  }
  parts.push(`User instruction: ${prompt}`);
  return parts.join('\n\n');
}

async function callClaudeStream(args: {
  apiKey: string;
  model: string;
  maxTokens: number;
  messages: Message[];
  onEvent: (e: AgentStreamEvent) => void;
  signal?: AbortSignal;
}): Promise<{ assistantBlocks: ContentBlock[]; stopReason?: string }> {
  const { apiKey, model, maxTokens, messages, onEvent, signal } = args;

  const body = {
    model,
    max_tokens: maxTokens,
    stream: true,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: CLAUDE_TOOLS.map((t, i, arr) =>
      i === arr.length - 1
        ? { ...t, cache_control: { type: 'ephemeral' } }
        : t,
    ),
    messages,
  };

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok || !resp.body) {
    let errMsg = `Anthropic API ${resp.status}`;
    try {
      const text = await resp.text();
      errMsg += `: ${text}`;
    } catch {}
    throw new Error(errMsg);
  }

  const blocks: ContentBlock[] = [];
  let stopReason: string | undefined;
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // Per-index tool_use accumulators for partial JSON
  const toolPartial = new Map<number, { name: string; id: string; json: string }>();

  while (true) {
    const read = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => setTimeout(
          () => reject(new Error(`Claude stream went idle for ${STREAM_IDLE_TIMEOUT_MS}ms (no data from API).`)),
          STREAM_IDLE_TIMEOUT_MS,
      )),
    ]).catch(async err => {
      // Cancel the stream so the underlying fetch doesn't leak.
      try { await reader.cancel(); } catch {}
      throw err;
    });
    const { value, done } = read;
    if (done)
      break;
    buffer += decoder.decode(value, { stream: true });

    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:'))
        continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]')
        continue;
      let evt: any;
      try {
        evt = JSON.parse(data);
      } catch {
        continue;
      }

      switch (evt.type) {
        case 'message_start':
          if (evt.message?.usage) {
            onEvent({
              kind: 'usage',
              input: evt.message.usage.input_tokens ?? 0,
              output: evt.message.usage.output_tokens ?? 0,
              cacheRead: evt.message.usage.cache_read_input_tokens,
              cacheWrite: evt.message.usage.cache_creation_input_tokens,
            });
          }
          break;
        case 'content_block_start': {
          const idx: number = evt.index;
          const cb = evt.content_block;
          if (cb?.type === 'text') {blocks[idx] = { type: 'text', text: '' };} else if (cb?.type === 'tool_use') {
            blocks[idx] = { type: 'tool_use', id: cb.id, name: cb.name, input: {} };
            toolPartial.set(idx, { name: cb.name, id: cb.id, json: '' });
          }
          break;
        }
        case 'content_block_delta': {
          const idx: number = evt.index;
          const d = evt.delta;
          if (d?.type === 'text_delta') {
            const block = blocks[idx];
            if (block?.type === 'text') {
              block.text += d.text;
              onEvent({ kind: 'text', delta: d.text });
            }
          } else if (d?.type === 'input_json_delta') {
            const tp = toolPartial.get(idx);
            if (tp)
              tp.json += d.partial_json ?? '';
          }
          break;
        }
        case 'content_block_stop': {
          const idx: number = evt.index;
          const tp = toolPartial.get(idx);
          if (tp) {
            const block = blocks[idx];
            if (block?.type === 'tool_use') {
              if (!tp.json) {
                block.input = {};
              } else {
                try {
                  block.input = JSON.parse(tp.json);
                } catch (parseErr) {
                  // Likely caused by max_tokens cutoff truncating the JSON mid-stream.
                  dbgErr('tool input JSON parse failed (likely truncated):', tp.name, tp.json.length, 'chars');
                  block.input = {
                    __truncated: true,
                    __raw_preview: tp.json.slice(0, 400),
                  };
                }
              }
            }
            toolPartial.delete(idx);
          }
          break;
        }
        case 'message_delta':
          if (evt.delta?.stop_reason)
            stopReason = evt.delta.stop_reason;
          if (evt.usage) {
            onEvent({
              kind: 'usage',
              input: 0,
              output: evt.usage.output_tokens ?? 0,
            });
          }
          break;
        case 'error':
          throw new Error(evt.error?.message ?? 'Stream error');
      }
    }
  }

  return { assistantBlocks: blocks.filter(Boolean), stopReason };
}
