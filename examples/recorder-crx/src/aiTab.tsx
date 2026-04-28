/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 */

import * as React from 'react';
import type { AgentStreamEvent } from './aiAgent';
import './aiTab.css';

type ToolItem = {
  kind: 'tool';
  id: string;
  name: string;
  input: unknown;
  result?: { ok: boolean; value?: unknown; error?: string };
};

type TextItem = {
  kind: 'text';
  text: string;
};

type Item = TextItem | ToolItem;

type Turn = {
  id: number;
  prompt: string;
  items: Item[];
  usage?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  status: 'streaming' | 'done' | 'error' | 'cancelled';
  doneReason?: string;
  errorMessage?: string;
  summary?: string;
  startedAt: number;
};

export type AiTabProps = {
  hasApiKey: boolean;
  getCurrentScript: () => string | undefined;
};

export const AiTab: React.FC<AiTabProps> = ({ hasApiKey, getCurrentScript }) => {
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [input, setInput] = React.useState('');
  const portRef = React.useRef<chrome.runtime.Port | null>(null);
  const turnIdRef = React.useRef(0);
  const activeTurnIdRef = React.useRef<number | null>(null);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  const ensurePort = React.useCallback((): chrome.runtime.Port => {
    if (portRef.current)
      return portRef.current;
    const port = chrome.runtime.connect({ name: 'ai' });
    portRef.current = port;
    port.onMessage.addListener((msg: any) => {
      if (msg?.type !== 'ai' || msg.method !== 'event')
        return;
      const event = msg.event as AgentStreamEvent;
      const turnId = activeTurnIdRef.current;
      if (turnId === null)
        return;
      setTurns(prev => prev.map(t => (t.id === turnId ? applyEvent(t, event) : t)));
      if (event.kind === 'done')
        activeTurnIdRef.current = null;
    });
    port.onDisconnect.addListener(() => {
      portRef.current = null;
      const turnId = activeTurnIdRef.current;
      if (turnId !== null) {
        setTurns(prev => prev.map(t => t.id === turnId && t.status === 'streaming' ? { ...t, status: 'cancelled', doneReason: 'disconnected' } : t));
        activeTurnIdRef.current = null;
      }
    });
    return port;
  }, []);

  React.useEffect(() => () => {
    portRef.current?.disconnect();
    portRef.current = null;
  }, []);

  React.useLayoutEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [turns]);

  const isRunning = turns.length > 0 && turns[turns.length - 1].status === 'streaming';

  const onSubmit = React.useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const prompt = input.trim();
    if (!prompt || isRunning)
      return;
    if (!hasApiKey)
      return;

    const id = ++turnIdRef.current;
    activeTurnIdRef.current = id;
    setTurns(prev => [...prev, { id, prompt, items: [], status: 'streaming', startedAt: Date.now() }]);
    setInput('');

    const port = ensurePort();
    port.postMessage({ type: 'ai', method: 'run', prompt, currentScript: getCurrentScript() });
  }, [input, isRunning, ensurePort, getCurrentScript, hasApiKey]);

  const onCancel = React.useCallback(() => {
    if (!isRunning)
      return;
    portRef.current?.postMessage({ type: 'ai', method: 'cancel' });
  }, [isRunning]);

  const onClear = React.useCallback(() => {
    if (isRunning)
      return;
    setTurns([]);
    portRef.current?.postMessage({ type: 'ai', method: 'clear' });
  }, [isRunning]);

  return (
    <div className='ai-tab'>
      {!hasApiKey && (
        <div className='ai-banner'>
          {'No Anthropic API key configured. Open '}<strong>Preferences</strong>{' and paste your key under “AI assistant (Claude)”.'}
        </div>
      )}
      <div className='ai-history'>
        {turns.length === 0 && (
          <div className='ai-empty'>
            <p>Describe what you want to test. The AI will drive the page; the recorder captures the actions live.</p>
            <ul>
              <li>{'“Go to https://example.com and click the Sign in button”'}</li>
              <li>{'“Search for ‘aiploya.com’ and verify the price shows €23,97”'}</li>
              <li>{'“Also assert that an Alternative Domains list contains aiploya.de”'}</li>
            </ul>
          </div>
        )}
        {turns.flatMap(turn => renderTurn(turn))}
        <div ref={messagesEndRef} />
      </div>
      <form className='ai-input' onSubmit={onSubmit}>
        <textarea
          value={input}
          placeholder={hasApiKey ? 'Describe what to do (Shift+Enter for newline)…' : 'Configure API key in Preferences first'}
          disabled={!hasApiKey}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSubmit(e as any);
            }
          }}
          rows={3}
        />
        <div className='ai-actions'>
          {!isRunning ? (
            <button type='submit' disabled={!hasApiKey || !input.trim()}>Send</button>
          ) : (
            <button type='button' className='cancel' onClick={onCancel}>Stop</button>
          )}
          <button type='button' className='clear' onClick={onClear} disabled={isRunning || turns.length === 0}>Clear</button>
        </div>
      </form>
    </div>
  );
};

function renderTurn(turn: Turn): React.ReactNode[] {
  const rows: React.ReactNode[] = [];
  rows.push(
      <PromptRow key={`prompt-${turn.id}`} prompt={turn.prompt} />,
  );
  for (let i = 0; i < turn.items.length; i++) {
    const it = turn.items[i];
    if (it.kind === 'text')
      rows.push(<TextRow key={`text-${turn.id}-${i}`} text={it.text} />);
    else
      rows.push(<ToolRow key={`tool-${turn.id}-${it.id}`} item={it} />);

  }
  if (turn.status === 'streaming')
    rows.push(<SpinnerRow key={`spin-${turn.id}`} startedAt={turn.startedAt} />);
  if (turn.status === 'error' && turn.errorMessage)
    rows.push(<StatusRow key={`err-${turn.id}`} status='error' iconClass='codicon-error' title='Error' detail={turn.errorMessage} defaultExpanded />);
  if (turn.status === 'done' && turn.summary)
    rows.push(<StatusRow key={`done-${turn.id}`} status='ok' iconClass='codicon-check' title='Done' detail={turn.summary} defaultExpanded />);
  if (turn.status === 'cancelled')
    rows.push(<StatusRow key={`cancel-${turn.id}`} status='cancelled' iconClass='codicon-circle-slash' title='Cancelled' />);
  if (turn.usage)
    rows.push(<UsageRow key={`usage-${turn.id}`} usage={turn.usage} />);
  return rows;
}

const PromptRow: React.FC<{ prompt: string }> = ({ prompt }) => {
  const [expanded, setExpanded] = React.useState(false);
  const multiline = prompt.includes('\n') || prompt.length > 100;
  const expandable = multiline;
  return (
    <CallRow
      status='user'
      iconClass='codicon-account'
      expandable={expandable}
      expanded={expanded}
      onToggle={() => setExpanded(v => !v)}
      header={<>
        <span className='ai-call-prefix'>You</span>
        <span className='ai-call-summary'>{firstLine(prompt, 200)}</span>
      </>}
      detail={expanded && multiline ? prompt : undefined}
    />
  );
};

const TextRow: React.FC<{ text: string }> = ({ text }) => {
  const [expanded, setExpanded] = React.useState(true);
  const trimmed = text.trim();
  if (!trimmed)
    return null;
  const multiline = trimmed.includes('\n') || trimmed.length > 200;
  return (
    <CallRow
      status='assistant'
      iconClass='codicon-comment'
      expandable={multiline}
      expanded={expanded}
      onToggle={() => setExpanded(v => !v)}
      header={<>
        <span className='ai-call-prefix'>Claude</span>
        <span className='ai-call-summary'>{firstLine(trimmed, 200)}</span>
      </>}
      detail={expanded && multiline ? trimmed : undefined}
    />
  );
};

const ToolRow: React.FC<{ item: ToolItem }> = ({ item }) => {
  const [expanded, setExpanded] = React.useState(false);
  const sev = severity(item);
  const iconClass = sev === 'in-progress' ? 'codicon-loading'
    : sev === 'error' ? 'codicon-error'
      : sev === 'warn' ? 'codicon-warning'
        : 'codicon-check';
  return (
    <CallRow
      status={sev}
      iconClass={iconClass}
      expandable={true}
      expanded={expanded}
      onToggle={() => setExpanded(v => !v)}
      header={<>
        <span className='ai-call-prefix tool'>{item.name}</span>
        <span className='ai-call-summary'>{shortInputSummary(item.input)}</span>
        <FriendlyResult name={item.name} result={item.result} />
      </>}
      detail={expanded ? <ToolDetail item={item} /> : undefined}
    />
  );
};

const FriendlyResult: React.FC<{ name: string; result?: { ok: boolean; value?: unknown; error?: string } }> = ({ name, result }) => {
  if (!result)
    return null;
  if (!result.ok)
    return <span className='ai-call-result error'>— {firstLine(result.error ?? 'failed', 80)}</span>;
  const v = result.value;
  if (name === 'goto' || name === 'getUrl') {
    const url = (v as any)?.url;
    if (typeof url === 'string')
      return <span className='ai-call-result'>— <span className='ai-call-url'>{url}</span></span>;
  }
  if (name === 'assertVisible') {
    const visible = (v as any)?.visible;
    if (visible === true)
      return <span className='ai-call-result'>— visible</span>;
    if (visible === false)
      return <span className='ai-call-result warn'>— not visible</span>;
  }
  if (name === 'assertText') {
    const match = (v as any)?.match;
    const expected = (v as any)?.expected;
    if (match === true)
      return <span className='ai-call-result'>{`— contains "${firstLine(String(expected ?? ''), 40)}"`}</span>;
    if (match === false)
      return <span className='ai-call-result warn'>— mismatch</span>;
  }
  if (name === 'getAriaSnapshot') {
    const snap = (v as any)?.snapshot;
    if (typeof snap === 'string')
      return <span className='ai-call-result'>— {snap.split('\n').length} lines · {snap.length} chars</span>;
  }
  if (name === 'replaceTest') {
    const len = (v as any)?.length;
    if (typeof len === 'number')
      return <span className='ai-call-result'>— {len} chars written</span>;
  }
  if (name === 'finish') {
    const summary = (v as any)?.summary;
    if (summary)
      return <span className='ai-call-result'>— {firstLine(String(summary), 80)}</span>;
  }
  return null;
};

const ToolDetail: React.FC<{ item: ToolItem }> = ({ item }) => {
  return (
    <>
      <div className='ai-call-section'>input</div>
      <pre className='ai-call-code'>{prettyJson(item.input)}</pre>
      {item.result && (
        <>
          <div className='ai-call-section'>{item.result.ok ? 'result' : 'error'}</div>
          <pre className={`ai-call-code${item.result.ok ? '' : ' err'}`}>
            {prettyJson(item.result.ok ? item.result.value : item.result.error)}
          </pre>
        </>
      )}
    </>
  );
};

const SpinnerRow: React.FC<{ startedAt: number }> = ({ startedAt }) => {
  const [, force] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => {
    const interval = setInterval(force, 1000);
    return () => clearInterval(interval);
  }, []);
  const elapsed = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  return (
    <CallRow
      status={elapsed >= 30 ? 'warn' : 'in-progress'}
      iconClass='codicon-loading codicon-modifier-spin'
      header={<span className='ai-call-summary'>working… {elapsed}s</span>}
    />
  );
};

const StatusRow: React.FC<{
  status: 'ok' | 'error' | 'cancelled' | 'warn';
  iconClass: string;
  title: string;
  detail?: string;
  defaultExpanded?: boolean;
}> = ({ status, iconClass, title, detail, defaultExpanded }) => {
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
  const expandable = !!detail;
  return (
    <CallRow
      status={status}
      iconClass={iconClass}
      expandable={expandable}
      expanded={expanded}
      onToggle={() => setExpanded(v => !v)}
      header={<>
        <span className='ai-call-prefix'>{title}</span>
        {detail && <span className='ai-call-summary'>{firstLine(detail, 200)}</span>}
      </>}
      detail={expandable && expanded ? detail : undefined}
    />
  );
};

const UsageRow: React.FC<{ usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number } }> = ({ usage }) => {
  const text = `tokens: in ${usage.input}, out ${usage.output}`
    + (usage.cacheRead !== undefined ? `, cache read ${usage.cacheRead}` : '')
    + (usage.cacheWrite !== undefined ? `, cache write ${usage.cacheWrite}` : '');
  return (
    <CallRow
      status='usage'
      iconClass='codicon-info'
      header={<span className='ai-call-summary'>{text}</span>}
    />
  );
};

const CallRow: React.FC<{
  status: 'ok' | 'error' | 'warn' | 'in-progress' | 'cancelled' | 'user' | 'assistant' | 'usage';
  iconClass: string;
  header: React.ReactNode;
  detail?: React.ReactNode;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}> = ({ status, iconClass, header, detail, expandable, expanded, onToggle }) => {
  return (
    <div className={`ai-call ${status}`}>
      <div className='ai-call-header'>
        {expandable ? (
          <span
            className={`codicon codicon-chevron-${expanded ? 'down' : 'right'} ai-call-toggle`}
            onClick={onToggle}
          />
        ) : (
          <span className='ai-call-toggle empty' />
        )}
        <span className={`codicon ${iconClass} ai-call-icon`} />
        {header}
      </div>
      {expandable && expanded && detail !== undefined && detail !== null && (
        <div className='ai-call-message'>{detail}</div>
      )}
    </div>
  );
};

function severity(item: ToolItem): 'ok' | 'error' | 'warn' | 'in-progress' {
  if (!item.result)
    return 'in-progress';
  if (!item.result.ok)
    return 'error';
  const v = item.result.value as any;
  if (v && typeof v === 'object') {
    if (v.match === false || v.visible === false)
      return 'warn';
  }
  return 'ok';
}

function applyEvent(turn: Turn, e: AgentStreamEvent): Turn {
  switch (e.kind) {
    case 'text': {
      const items = turn.items.slice();
      const last = items[items.length - 1];
      if (last && last.kind === 'text')
        items[items.length - 1] = { kind: 'text', text: last.text + e.delta };
      else
        items.push({ kind: 'text', text: e.delta });
      return { ...turn, items };
    }
    case 'tool_call':
      return { ...turn, items: [...turn.items, { kind: 'tool', id: e.id, name: e.name, input: e.input }] };
    case 'tool_result': {
      const items = turn.items.map(item =>
        item.kind === 'tool' && item.id === e.id
          ? { ...item, result: { ok: e.ok, value: e.value, error: e.error } }
          : item,
      );
      return { ...turn, items };
    }
    case 'usage': {
      const prev = turn.usage ?? { input: 0, output: 0 };
      return {
        ...turn,
        usage: {
          input: prev.input + (e.input ?? 0),
          output: prev.output + (e.output ?? 0),
          cacheRead: e.cacheRead ?? prev.cacheRead,
          cacheWrite: e.cacheWrite ?? prev.cacheWrite,
        },
      };
    }
    case 'error':
      return { ...turn, status: 'error', errorMessage: e.message };
    case 'done': {
      if (turn.status === 'error')
        return { ...turn, doneReason: e.reason };
      return {
        ...turn,
        status: e.reason === 'cancelled' ? 'cancelled' : 'done',
        doneReason: e.reason,
        summary: e.summary ?? turn.summary,
      };
    }
  }
}

function firstLine(s: string, maxLen: number): string {
  const trimmed = s.trim();
  const nl = trimmed.indexOf('\n');
  const line = nl >= 0 ? trimmed.slice(0, nl) : trimmed;
  return line.length > maxLen ? line.slice(0, maxLen - 1) + '…' : line;
}

function shortInputSummary(input: unknown): string {
  try {
    if (input === null || input === undefined)
      return '';
    if (typeof input === 'string')
      return input.length > 80 ? input.slice(0, 79) + '…' : input;
    if (typeof input !== 'object')
      return String(input);
    const obj = input as Record<string, unknown>;
    if (typeof obj.url === 'string')
      return obj.url as string;
    if (typeof obj.script === 'string')
      return `${(obj.script as string).split('\n').length} lines`;
    if (typeof obj.summary === 'string')
      return obj.summary as string;
    if (obj.target && typeof obj.target === 'object') {
      const t = obj.target as Record<string, unknown>;
      const parts: string[] = [];
      if (t.by)
        parts.push(String(t.by));
      if (t.value)
        parts.push(`"${t.value}"`);
      if (t.name)
        parts.push(`name="${t.name}"`);
      if (typeof obj.value === 'string')
        parts.push(`= "${(obj.value as string).slice(0, 40)}${(obj.value as string).length > 40 ? '…' : ''}"`);
      if (typeof obj.text === 'string')
        parts.push(`text="${obj.text}"`);
      if (typeof obj.key === 'string')
        parts.push(`key="${obj.key}"`);
      return parts.join(' ');
    }
    if (typeof obj.key === 'string')
      return `key="${obj.key}"`;
    return JSON.stringify(input).slice(0, 80);
  } catch {
    return '';
  }
}

function prettyJson(input: unknown): string {
  try {
    if (input === undefined || input === null)
      return '';
    if (typeof input === 'string')
      return input;
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input ?? '');
  }
}
