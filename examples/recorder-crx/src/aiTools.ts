/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 */

import type { CrxRecorder, Locator, Page } from 'playwright-crx';

export type NetworkError = {
  url: string;
  method: string;
  status: number;
  failure?: string;
  timestamp: number;
};

export type ExecutionContext = {
  page: Page;
  recorder: CrxRecorder;
  popNetworkErrors?: () => NetworkError[];
};

export type ClaudeTool = {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
};

const ROLES = [
  'alert', 'alertdialog', 'application', 'article', 'banner', 'button', 'cell',
  'checkbox', 'columnheader', 'combobox', 'complementary', 'contentinfo',
  'dialog', 'document', 'figure', 'form', 'grid', 'gridcell', 'group',
  'heading', 'img', 'link', 'list', 'listbox', 'listitem', 'main', 'menu',
  'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'navigation',
  'option', 'paragraph', 'progressbar', 'radio', 'radiogroup', 'region',
  'row', 'rowheader', 'search', 'searchbox', 'separator', 'slider',
  'spinbutton', 'status', 'switch', 'tab', 'table', 'tablist', 'tabpanel',
  'textbox', 'toolbar', 'tooltip', 'tree', 'treeitem',
];

const targetSchema = {
  type: 'object',
  description: 'How to find the element. Prefer role/placeholder/label/text over css.',
  properties: {
    by: {
      type: 'string',
      enum: ['role', 'placeholder', 'label', 'text', 'testId', 'css'],
      description: 'Lookup strategy. role: ARIA role + accessible name. placeholder/label/text: visible text. testId: data-testid attribute. css: raw CSS selector (last resort).',
    },
    value: {
      type: 'string',
      description: 'For role: the role name (e.g. "textbox", "button"). For placeholder/label/text: the visible text (substring match by default). For testId: the testid value. For css: a CSS selector.',
    },
    name: {
      type: 'string',
      description: 'For role only: the accessible name (text/aria-label). Substring match unless exact=true.',
    },
    exact: {
      type: 'boolean',
      description: 'Default false (substring match). Set true to require exact text match.',
    },
    nth: {
      type: 'number',
      description: 'Optional 0-indexed match to pick. Default 0 (first).',
    },
  },
  required: ['by', 'value'],
};

export const CLAUDE_TOOLS: ClaudeTool[] = [
  {
    name: 'goto',
    description: 'Navigate the active page to a URL and wait for it to load.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Fully qualified URL to navigate to.' },
        waitUntil: { type: 'string', enum: ['load', 'domcontentloaded', 'networkidle'], description: 'Optional load condition. Default: load.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'getUrl',
    description: 'Return the current URL of the active page.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'getAriaSnapshot',
    description: 'Return a YAML ARIA snapshot of the page or a subtree. Omit `target` for the full page; pass a target only when you already know the element exists (e.g. you saw it in a previous snapshot). If the target does not exist within timeoutMs, the tool automatically falls back to the body and returns `fellBack: true` plus the body snapshot — so you always get structural info back. Default timeout is 2500ms; raise it only if the page is still loading. Note: many SPAs do NOT have `role="main"` or `role="navigation"` — start with no target, then scope on the second call.',
    input_schema: {
      type: 'object',
      properties: {
        target: targetSchema,
        timeoutMs: { type: 'number', description: 'Default 2500ms. The body fallback always uses 5000ms.' },
      },
    },
  },
  {
    name: 'waitForSelector',
    description: 'Wait until the target element reaches a state on the active page.',
    input_schema: {
      type: 'object',
      properties: {
        target: targetSchema,
        timeoutMs: { type: 'number', description: 'Default 10000.' },
        state: { type: 'string', enum: ['attached', 'detached', 'visible', 'hidden'], description: 'Default: visible.' },
      },
      required: ['target'],
    },
  },
  {
    name: 'click',
    description: 'Click the target element. Use role+name for buttons/links; use placeholder/label for form fields.',
    input_schema: {
      type: 'object',
      properties: {
        target: targetSchema,
        timeoutMs: { type: 'number' },
      },
      required: ['target'],
    },
  },
  {
    name: 'fill',
    description: 'Fill an input/textarea (selected via target) with the given text. Clears existing value first. Recommended target.by: placeholder, label, or role=textbox with name.',
    input_schema: {
      type: 'object',
      properties: {
        target: targetSchema,
        value: { type: 'string' },
        timeoutMs: { type: 'number' },
      },
      required: ['target', 'value'],
    },
  },
  {
    name: 'press',
    description: 'Press a key on the page. If target is given, the key is dispatched on that element; otherwise it goes to the focused/page-level handler.',
    input_schema: {
      type: 'object',
      properties: {
        target: { ...targetSchema, description: 'Optional. If omitted, the key is pressed on the page.' },
        key: { type: 'string', description: 'Key name (e.g. "Enter", "Tab", "Escape").' },
      },
      required: ['key'],
    },
  },
  {
    name: 'assertVisible',
    description: 'Assert the target element is visible (recorded as an assertion).',
    input_schema: {
      type: 'object',
      properties: {
        target: targetSchema,
        timeoutMs: { type: 'number' },
      },
      required: ['target'],
    },
  },
  {
    name: 'assertText',
    description: 'Assert the target element contains the expected text (substring match, trimmed). Recorded as an assertion.',
    input_schema: {
      type: 'object',
      properties: {
        target: targetSchema,
        text: { type: 'string', description: 'Expected text. Substring match, case-sensitive.' },
        timeoutMs: { type: 'number' },
      },
      required: ['target', 'text'],
    },
  },
  {
    name: 'getNotifications',
    description: 'Read currently visible notification/toast/alert/status messages from the page. Use this when an action seems to silently fail or when you suspect a backend rejection (toasts often appear shortly after the action). Returns an array of texts.',
    input_schema: {
      type: 'object',
      properties: {
        waitMs: { type: 'number', description: 'How long to wait for any alert to appear, in ms. Default 800.' },
      },
    },
  },
  {
    name: 'getNetworkErrors',
    description: 'Return failed HTTP responses (status >= 400) and network failures captured since this tool was last called. Use this whenever an action seems to succeed in the UI but downstream steps fail — backend errors don\'t throw exceptions in the UI thread. The buffer is cleared on each call.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'replaceTest',
    description: 'Replace the recorder\'s test source with a clean, minimal Playwright test that captures the user\'s intent. The recorder records every page action you take during exploration, so the live script accumulates noise — you must always call replaceTest at the end (and may call it earlier to clean up between phases).',
    input_schema: {
      type: 'object',
      properties: {
        script: {
          type: 'string',
          description: 'Full Playwright test source. Must be a complete, runnable file: include imports, the test() block, idiomatic getByRole/getByPlaceholder/getByText locators, and only the meaningful steps + assertions. No comments unless they add clarity. Match the language of the user\'s currently selected target (default: playwright-test / TypeScript).',
        },
      },
      required: ['script'],
    },
  },
  {
    name: 'finish',
    description: 'Call this exactly once when the task is complete AND replaceTest has been called with the final clean script. Provide a one-line summary.',
    input_schema: {
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
    },
  },
];

export type LocatorSpec = {
  by: 'role' | 'placeholder' | 'label' | 'text' | 'testId' | 'css';
  value: string;
  name?: string;
  exact?: boolean;
  nth?: number;
};

export type ToolResult = { ok: true; value?: unknown } | { ok: false; error: string };

function resolve(page: Page, spec: LocatorSpec): Locator {
  let loc: Locator;
  switch (spec.by) {
    case 'role': {
      const role = String(spec.value) as any;
      const opts: { name?: string | RegExp; exact?: boolean } = {};
      if (spec.name)
        opts.name = spec.name;
      if (spec.exact !== undefined)
        opts.exact = spec.exact;
      loc = page.getByRole(role, opts);
      break;
    }
    case 'placeholder':
      loc = page.getByPlaceholder(spec.value, spec.exact !== undefined ? { exact: spec.exact } : undefined);
      break;
    case 'label':
      loc = page.getByLabel(spec.value, spec.exact !== undefined ? { exact: spec.exact } : undefined);
      break;
    case 'text':
      loc = page.getByText(spec.value, spec.exact !== undefined ? { exact: spec.exact } : undefined);
      break;
    case 'testId':
      loc = page.getByTestId(spec.value);
      break;
    case 'css':
      loc = page.locator(spec.value);
      break;
    default:
      throw new Error(`Unknown locator strategy: ${(spec as any).by}`);
  }
  return spec.nth !== undefined ? loc.nth(Math.max(0, Math.floor(spec.nth))) : loc.first();
}

const ALERT_SELECTOR = '[role="alert"], [role="status"], [aria-live="polite"], [aria-live="assertive"]';

async function scanAlerts(page: Page, maxWaitMs: number): Promise<string[]> {
  // Wait briefly for any alert to appear; resolve fast if one is already present
  // and ignore timeout if none ever shows up.
  if (maxWaitMs > 0) {
    try {
      await page.locator(ALERT_SELECTOR).first().waitFor({ state: 'visible', timeout: maxWaitMs });
    } catch {
      /* no alerts visible — fine */
    }
  }
  const out = new Set<string>();
  try {
    const all = page.locator(ALERT_SELECTOR);
    const total = await all.count();
    const max = Math.min(total, 10);
    for (let i = 0; i < max; i++) {
      try {
        const el = all.nth(i);
        if (!(await el.isVisible({ timeout: 100 })))
          continue;
        const text = (await el.innerText({ timeout: 500 })).trim();
        if (text)
          out.add(text);
      } catch { /* skip individual */ }
    }
  } catch { /* skip */ }
  return Array.from(out);
}

async function attachSideEffects(page: Page, ctx: ExecutionContext, value: any): Promise<any> {
  const notifications = await scanAlerts(page, 600);
  const network = ctx.popNetworkErrors?.() ?? [];
  if (notifications.length === 0 && network.length === 0)
    return value;
  const out: any = value && typeof value === 'object' ? { ...value } : (value !== undefined ? { value } : {});
  if (notifications.length > 0)
    out.notifications = notifications;
  if (network.length > 0)
    out.networkErrors = network;
  return out;
}

function describeTarget(spec: LocatorSpec): string {
  switch (spec.by) {
    case 'role': return `role="${spec.value}"${spec.name ? ` name="${spec.name}"` : ''}`;
    case 'placeholder': return `placeholder="${spec.value}"`;
    case 'label': return `label="${spec.value}"`;
    case 'text': return `text="${spec.value}"`;
    case 'testId': return `testId="${spec.value}"`;
    case 'css': return `css="${spec.value}"`;
    default: return JSON.stringify(spec);
  }
}

function validateSpec(spec: any): LocatorSpec {
  if (!spec || typeof spec !== 'object')
    throw new Error('target must be an object: { by, value, name?, exact?, nth? }');
  if (typeof spec.by !== 'string' || !['role', 'placeholder', 'label', 'text', 'testId', 'css'].includes(spec.by))
    throw new Error('target.by must be one of role|placeholder|label|text|testId|css');
  if (typeof spec.value !== 'string' || !spec.value)
    throw new Error('target.value must be a non-empty string');
  if (spec.by === 'role' && !ROLES.includes(spec.value))
    throw new Error(`Unknown ARIA role "${spec.value}". Common roles: ${ROLES.slice(0, 12).join(', ')}, …`);
  return spec as LocatorSpec;
}

export async function executeTool(name: string, input: any, ctx: ExecutionContext): Promise<ToolResult> {
  const { page, recorder } = ctx;
  try {
    switch (name) {
      case 'goto': {
        await page.goto(String(input.url), { waitUntil: input.waitUntil ?? 'load' });
        return { ok: true, value: await attachSideEffects(page, ctx, { url: page.url() }) };
      }
      case 'getUrl':
        return { ok: true, value: { url: page.url() } };

      case 'getAriaSnapshot': {
        const timeout: number = input?.timeoutMs ?? 2500;
        if (!input?.target) {
          const snapshot = await page.locator('body').first().ariaSnapshot({ timeout: Math.max(timeout, 5000) });
          return { ok: true, value: { snapshot, scope: 'body' } };
        }
        const target = validateSpec(input.target);
        const scopeDesc = describeTarget(target);
        try {
          const snapshot = await resolve(page, target).ariaSnapshot({ timeout });
          return { ok: true, value: { snapshot, scope: scopeDesc } };
        } catch (e: any) {
          // Target not found — fall back to body so the agent always gets some
          // structural info back instead of an opaque timeout.
          let bodySnapshot = '';
          try {
            bodySnapshot = await page.locator('body').first().ariaSnapshot({ timeout: 5000 });
          } catch { /* ignore */ }
          return {
            ok: true,
            value: {
              scope: 'body',
              fellBack: true,
              requestedScope: scopeDesc,
              note: `Requested scope (${scopeDesc}) was not found within ${timeout}ms — returning the full body snapshot instead so you can see what's actually on the page.`,
              originalError: e?.message ?? String(e),
              snapshot: bodySnapshot,
            },
          };
        }
      }
      case 'waitForSelector': {
        const target = validateSpec(input.target);
        const timeout: number = input?.timeoutMs ?? 10000;
        const state = (input?.state ?? 'visible') as 'attached' | 'detached' | 'visible' | 'hidden';
        await resolve(page, target).waitFor({ state, timeout });
        return { ok: true, value: await attachSideEffects(page, ctx, { ok: true }) };
      }
      case 'click': {
        const target = validateSpec(input.target);
        await resolve(page, target).click({ timeout: input?.timeoutMs ?? 5000 });
        return { ok: true, value: await attachSideEffects(page, ctx, { ok: true }) };
      }
      case 'fill': {
        const target = validateSpec(input.target);
        await resolve(page, target).fill(String(input.value ?? ''), { timeout: input?.timeoutMs ?? 5000 });
        return { ok: true, value: await attachSideEffects(page, ctx, { ok: true }) };
      }
      case 'press': {
        const key = String(input.key);
        if (input?.target) {
          const target = validateSpec(input.target);
          await resolve(page, target).press(key);
        } else {
          await page.keyboard.press(key);
        }
        return { ok: true, value: await attachSideEffects(page, ctx, { ok: true }) };
      }
      case 'assertVisible': {
        const target = validateSpec(input.target);
        const loc = resolve(page, target);
        try {
          await loc.waitFor({ state: 'visible', timeout: input?.timeoutMs ?? 5000 });
          return { ok: true, value: { visible: true } };
        } catch (e: any) {
          return { ok: true, value: { visible: false, reason: e?.message ?? String(e) } };
        }
      }
      case 'assertText': {
        const target = validateSpec(input.target);
        const loc = resolve(page, target);
        try {
          await loc.waitFor({ state: 'visible', timeout: input?.timeoutMs ?? 5000 });
        } catch (e: any) {
          return { ok: true, value: { match: false, reason: e?.message ?? String(e) } };
        }
        const actual = (await loc.textContent({ timeout: input?.timeoutMs ?? 5000 }) ?? '').trim();
        const expected = String(input.text);
        const match = actual.includes(expected);
        return { ok: true, value: { match, actual: actual.slice(0, 500), expected } };
      }
      case 'getNotifications': {
        const wait = typeof input?.waitMs === 'number' ? input.waitMs : 800;
        const notifications = await scanAlerts(page, wait);
        return { ok: true, value: { notifications } };
      }
      case 'getNetworkErrors': {
        const errors = ctx.popNetworkErrors?.() ?? [];
        return { ok: true, value: { networkErrors: errors } };
      }
      case 'replaceTest': {
        const script = String(input?.script ?? '');
        if (!script.trim())
          return { ok: false, error: 'replaceTest requires a non-empty `script` argument. Note: Anthropic streaming truncates tool inputs that exceed max_tokens — if your script is large, increase max_tokens or split into smaller phases.' };
        if (!script.includes('@playwright/test') || !script.includes('test(') || !script.includes('=>'))
          return { ok: false, error: 'Script does not look like a valid Playwright test. It must start with `import { test, expect } from \'@playwright/test\';` and contain a `test(\'...\', async ({ page }) => { ... })` block.' };
        try {
          await recorder.load(script);
        } catch (e: any) {
          const raw = e?.message ?? String(e);
          // The upstream recorder's parse-error handler crashes on errors without a `loc` — surface that clearly.
          const hint = /Cannot read.*line/.test(raw)
            ? 'The script could not be parsed (Babel error without source location). The script body likely has a syntax error — check for unbalanced braces/quotes, missing semicolons, or stray text.'
            : 'The script could not be loaded into the recorder. Check it is valid Playwright TypeScript.';
          return { ok: false, error: `${hint} Original error: ${raw}` };
        }
        return { ok: true, value: { ok: true, length: script.length } };
      }
      case 'finish':
        return { ok: true, value: { summary: String(input?.summary ?? '') } };
      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (e: any) {
    let errorMsg = e?.message ?? String(e);
    // Enrich action-tool failures with the current page state so the agent
    // can self-correct on the next iteration without burning a full
    // getAriaSnapshot round-trip.
    if (page && ['click', 'fill', 'press', 'waitForSelector'].includes(name)) {
      try {
        const snap = await page.locator('body').first().ariaSnapshot({ timeout: 2000 });
        const truncated = snap.length > 1500 ? snap.slice(0, 1500) + '\n…(truncated)' : snap;
        errorMsg += `\n\nPage snapshot at time of failure (use this to pick the correct target on retry):\n${truncated}`;
      } catch { /* page may be transitioning */ }
      try {
        const notifs = await scanAlerts(page, 200);
        if (notifs.length > 0)
          errorMsg += `\n\nVisible notifications:\n${notifs.map(n => `- ${n}`).join('\n')}`;
      } catch { /* */ }
      const ne = ctx.popNetworkErrors?.() ?? [];
      if (ne.length > 0)
        errorMsg += `\n\nFailed network requests since last call:\n${ne.map(n => `- ${n.method} ${n.status} ${n.url}${n.failure ? ' (' + n.failure + ')' : ''}`).join('\n')}`;
    }
    return { ok: false, error: errorMsg };
  }
}

export const SYSTEM_PROMPT = `You are an in-browser test recording assistant. The user is running a Playwright recorder Chrome extension. You have tools to drive the *currently attached* tab AND a special tool to write the final clean test script.

CRITICAL: TWO MENTAL MODELS
You operate in two layers, do not confuse them:
1. **EXECUTION layer (live page).** click/fill/press/goto/waitForSelector/getAriaSnapshot/assertVisible/assertText drive the real browser tab. The recorder is ACTIVE while you act, so every goto/click/fill/press you perform is captured into the user's test script live (the user is watching it grow). Read-only ops (getAriaSnapshot, getUrl, waitForSelector, assertVisible, assertText) do not produce recorded steps.
2. **AUTHORING layer (final script).** You finalize the user's deliverable by calling \`replaceTest\` with the complete clean script. The live recording is your scratchpad; \`replaceTest\` is the curated deliverable.

WORKFLOW
1. Read the user's instructions and decide IMMEDIATELY whether the "Current generated script" (if any) is **relevant** to the current request:
   - **Relevant** = same page/URL or same feature, and the user's new request is a continuation/extension. → Extend it: keep the meaningful steps and add new ones.
   - **Irrelevant / stale** = different domain, different page, different feature, different selectors that no longer exist on the target page, or the user is starting a fresh scenario. → REPLACE it entirely. Do NOT carry over the old steps.
   When in doubt, replace. It is much worse to keep stale code than to rewrite a few lines.
2. Use execution tools to drive the page and discover correct locators / verify state. By default the recorder is **paused** while you work — your tool calls are NOT live-recorded into the user's test source. The user only sees what you write via \`replaceTest\`. Be efficient: avoid unnecessary clicks, do not right-click, do not navigate to URLs the user did not request, do not retry the same failing selector without first inspecting the snapshot embedded in the failure message.
3. **Call \`replaceTest\` PROGRESSIVELY, not just at the end.** As soon as you've completed a meaningful subtask — one role logged in and verified, one CRUD step confirmed, one page-flow finished — call \`replaceTest\` with the cumulative clean script *covering everything verified so far* (including any \`page.screenshot()\` calls for what you've already done). Each call fully overwrites the test source, so each call should be the complete cumulative test. This ensures progress is preserved if the user cancels mid-run; otherwise everything you did is lost. For multi-step scenarios (multi-role logins, multi-domain checks), call \`replaceTest\` after EACH role/domain/page is verified — the screenshot calls and assertions get added incrementally to the same growing test.
   The final \`replaceTest\` is just the last in the series, with all subtasks present. Curate as you go:
   - Strip any exploration noise (failed clicks, redundant goto, auto-generated \`div.filter({hasText})\` chains).
   - Use idiomatic locators: \`page.getByRole(...)\`, \`page.getByPlaceholder(...)\`, \`page.getByLabel(...)\`, \`page.getByText(...)\`, \`page.getByTestId(...)\`.
   - Add \`expect(...).toBeVisible()\` / \`.toContainText(...)\` assertions for verifications.
   - Include screenshot calls (\`page.screenshot({ path: '...', fullPage: true })\`) right after verification of the depicted state.
4. Call \`finish\` with a one-line summary AFTER your final \`replaceTest\`.

REPLACETEST RULES (this is the deliverable the user actually sees):
- Always start with \`import { test, expect } from '@playwright/test';\` followed by a single \`test('<descriptive name>', async ({ page }) => { ... })\` block. Use a meaningful descriptive name in present tense ("admin can log in", "search returns aiploya.de"), never \`'test'\`.
- Include only the steps the user asked for. NO right-clicks, NO press('Tab'), NO redundant clicks on the same element, NO goto('/') back to home unless explicitly requested.
- Use \`page.getByRole(...)\`, \`page.getByPlaceholder(...)\`, \`page.getByLabel(...)\`, \`page.getByText(...)\`, \`page.getByTestId(...)\` — never long auto-generated div locators or filter chains.
- For multi-domain checks (e.g. "also try aiploya-new.com"), reuse the same locators with \`fill\` / \`expect\` rather than reloading the page when avoidable.
- Match the language of the existing script if one is provided.

ASSERTION GUIDANCE
The recorder's internal action list only roundtrips a small subset of expect methods (toBeVisible, toContainText, toHaveText, toHaveValue, toBeEmpty, toBeChecked / not.toBeChecked, toMatchAriaSnapshot). You may use any other Playwright assertion (toHaveURL, toBeDisabled, toHaveCount, …) — they are simply not displayed as recorded actions in the recorder UI, but they ARE part of the test source and run in CI. Prefer the whitelisted forms when they cleanly express the intent (cleaner action list for the user); use richer assertions when they're meaningfully different.

Recommended idioms:
- "user landed on /dashboard" → either \`expect(page).toHaveURL(/\\/dashboard/)\` OR a destination-page heading: \`expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()\`. Both are fine.
- "button is now disabled" → prefer asserting the *new* visible label (e.g. "Im Warenkorb" replaced "In den Warenkorb"): \`expect(page.getByRole('button', { name: 'Im Warenkorb' })).toBeVisible()\`. Use \`toBeDisabled()\` if there's no label change.
- "cart count is 1" → assert the visible badge text rather than \`toHaveCount\`: \`expect(page.getByLabel('Warenkorb')).toContainText('1')\`.
- "input is empty / has value X" → \`toBeEmpty()\` / \`toHaveValue('X')\` (both whitelisted).

- **Promote success-toasts you observed into assertions.** When an action you performed produced a meaningful \`notifications\` value (e.g. "In den Warenkorb gelegt", "Speichern erfolgreich", "Anmeldung erfolgreich", "Created"), include an \`expect(page.getByRole('alert')).toContainText('<key phrase>')\` right after that action in the final script. This makes the test fail loudly if the success toast disappears in a future regression. Skip transient/dismissable notifications that aren't tied to the user's success criterion.

SCREENSHOTS
When the user asks for screenshots ("take screenshots", "screenshot each role", "make screenshots of the dashboards", "Screenshot machen"), insert \`page.screenshot()\` calls in the final test:
\`\`\`ts
await page.screenshot({ path: 'screenshots/admin-dashboard.png', fullPage: true });
\`\`\`
- Place each screenshot AFTER the verification of the state it depicts (e.g. after the dashboard heading is asserted visible) — never mid-interaction.
- Use descriptive, kebab-case filenames matching the user's named scenarios: \`admin-dashboard.png\`, \`developer-dashboard.png\`, \`customer-orders.png\`. Always under a \`screenshots/\` subdirectory.
- For multi-role / multi-scenario tests, take one screenshot per role at the meaningful "I'm logged in" state.
- \`fullPage: true\` is the default unless the user wants a viewport shot.
- Do NOT call screenshot at runtime via the execution tools; only emit \`page.screenshot()\` calls in the final \`replaceTest\` script.

PIPELINE-READY OUTPUT (CRITICAL: tests must run unchanged in CI against staging/prod, and locally against the dev server)
- **Never hardcode the host. Use relative paths only:** \`await page.goto('/login')\`, \`await page.goto('/dashboard')\`. Do **NOT** introduce a \`const BASE_URL = process.env.BASE_URL ?? '...'\` and do **NOT** concatenate (\`BASE_URL + '/login'\`) — the recorder's replay player can only parse \`goto\` with a literal string argument; concatenation makes the action invisible to the player and "Play" in the recorder will appear to do nothing. Trust that the user has \`baseURL\` configured in \`playwright.config.ts\` — typically \`use: { baseURL: process.env.BASE_URL ?? 'http://localhost:3000' }\`. With that in place, relative paths work both locally and in CI without further wiring.
- **Never hardcode credentials, API keys, or other secrets** in the test body. Pull them from \`process.env\` with the value the user mentioned as a *local-dev fallback only*, and clearly named:
  \`\`\`ts
  const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'max@itdpk.de';
  const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'demo1234';
  \`\`\`
  (Keep fallback values for things the user explicitly typed in the prompt — they're already non-secret demo values. Anything that looks like a real secret should be \`process.env.X\` with **no** fallback so the test fails loudly if missing.)
- **Assert important navigations.** After login or a form submit that redirects, prefer asserting a unique element only present on the destination page:
    \`await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();\`
  You may also use \`await expect(page).toHaveURL(/\\/dashboard/);\` — the recorder soft-skips it from its internal action list but the source is preserved and the test runs in CI.
- **Don't rely on transient state.** Use \`expect(...).toBeVisible()\` (auto-retrying) rather than reading text once. For success-toast assertions, prefer \`expect(page.getByRole('alert')).toContainText('…')\` so timing differences don't fail the test.
- Keep secrets and IDs out of the script. If the user's instruction included a value (e.g. an email/password), put it as the env-var fallback exactly as quoted — but the env var name must clearly identify what it is.

LOCATOR STRATEGY for execution tools (most failures come from wrong selectors):
All page tools take a structured "target": { by, value, name?, exact?, nth? }. NEVER use Playwright selector-engine syntax inside value.
- Form field with placeholder → \`{ "by": "placeholder", "value": "Finden Sie Ihren Domain-Crush" }\`
- Form field with label → \`{ "by": "label", "value": "Email" }\`
- Button/link/textbox by accessible name → \`{ "by": "role", "value": "button", "name": "Domain suchen" }\`
- Unique visible text → \`{ "by": "text", "value": "Bereits registriert" }\`
- data-testid → \`{ "by": "testId", "value": "submit" }\`
- CSS (last resort only) → \`{ "by": "css", "value": "..." }\`
Substring match is default; \`exact: true\` for strict. Use \`nth\` (0-indexed) only when there are multiple matches.

OPTIMIZE / IMPROVE / REFACTOR MODE
When the user asks to "optimize" / "improve" / "clean up" / "refactor" an EXISTING test, your job is to RAISE QUALITY without changing what the test verifies.

Do:
- Tighten ambiguous locators (fix strict-mode violations: scope to parents, prefer getByLabel/getByTestId/exact text).
- Add the missing assertions you can derive from the existing flow: success-toast text, post-state visual changes, redirect destination headings.
- Make URLs pipeline-portable: replace absolute hosts with relative paths (\`page.goto('/domains/search?q=…')\` instead of \`page.goto('https://…/domains/search?q=…')\`). Trust \`baseURL\` in playwright.config.ts.
- Move credentials and other env-controllable values to \`process.env.X ?? '<demo-fallback>'\` constants above the test.
- Replace stale comments with precise ones; rename misleading test titles.
- Remove ACTUAL redundancy: duplicate waits, unused vars, repeated identical assertions.

Do NOT:
- ❌ Replace UI interactions (\`.fill(...)\` + \`.click('Submit')\`) with direct URL navigation. The UI clicks are a load-bearing part of what's being tested. Only short-circuit a UI flow if the user explicitly asks for it ("just navigate directly", "skip the form, hit the URL").
- ❌ Remove steps that have side effects (clicking a "Register" button that opens a dialog, dismissing modal flows, "Skip"/"Continue" buttons). These are state transitions, not noise.
- ❌ Combine sequential interactions into a single assertion. If the original flow was \`Register → dialog → Add to cart → Skip → assert disabled\`, keep all four interactions plus the assertion. The "Im Warenkorb" disabled button is the *result* of the flow, not a trigger.
- ❌ Use \`getByRole('...', { disabled: true }).click()\` — that's contradictory: a disabled element cannot be clicked, the test will timeout. The \`disabled\` filter belongs on locators used in assertions only, e.g. \`expect(page.getByRole('button', { name: 'X' })).toBeDisabled()\` (which works because \`toBeDisabled\` doesn't require the element to be interactable).
- ❌ Drop assertions you don't recognise. They're often regression markers the user added intentionally.

A good optimized test runs the SAME user journey, with cleaner selectors, more assertions, env-driven config, and clearer intent.

LOCATOR SPECIFICITY — avoid strict-mode violations
Playwright runs in strict mode: \`page.getByRole('button', { name: 'X' })\` (or \`getByText\`, etc.) FAILS at runtime if multiple elements match. The error looks like: \`strict mode violation: ... resolved to N elements\`.

Common traps:
- A short or numeric name like \`'1'\`, \`'OK'\`, \`'Anmelden'\`, \`'Submit'\` is rarely unique. \`getByRole('button', { name: '1' })\` will match every button containing "1" anywhere in its accessible name.
- Card lists, plan selectors, repeating items often share a common role+name pattern. Don't trust visual uniqueness — there might be hidden ones too.

Disciplined patterns:
- For badges, counters and small icon-button content: scope through a unique parent landmark first.
    Cart badge: \`page.getByRole('navigation').getByText('1', { exact: true })\`
    Or: \`page.locator('button:has(svg.lucide-shopping-cart)').getByText('1', { exact: true })\`
    Or use getByLabel on the cart button if available.
- For repeated content (cards, list items): use getByText with \`exact: true\` AND scope through getByRole('list')/('table')/('region')/getByLabel to disambiguate.
- When the user asks "verify the cart shows 1", **assert the cart-related parent**, not the bare digit:
    \`expect(page.getByRole('navigation')).toContainText('1');\`
  This is robust against unrelated "1"s elsewhere on the page (price ranges, plan names, etc.).
- After a strict-mode violation, IMMEDIATELY scope tighter (parent role, getByLabel, more specific text) — do NOT add \`.first()\` unless ordering is intrinsically meaningful (rare).
- When uncertain, run getAriaSnapshot scoped to the relevant landmark (header / navigation / form) to find a stable parent before targeting the small element.

RECOVERY
- When click/fill/press/waitForSelector fails, the error message AUTOMATICALLY includes a fresh page snapshot ("Page snapshot at time of failure: ..."). READ IT and pick the correct target from there — do NOT call getAriaSnapshot again, you already have the structure. Do NOT retry the same selector that just timed out.
- If the snapshot shows a textbox without a placeholder but with a label like "E-Mail Adresse", switch from \`{ by: "placeholder" }\` to \`{ by: "label", value: "E-Mail Adresse" }\` or \`{ by: "role", value: "textbox", name: "E-Mail Adresse" }\`. The actual visible text on the page wins over what you guessed from the prompt.
- If a tool fails with "strict mode violation", scope tighter (parent role/label, exact text). Do NOT keep the same selector and add nth/first.
- After fill, only \`press('Enter')\` if the form needs it; usually you should click the submit button instead.

NOTIFICATION & NETWORK AWARENESS (very important — silent failures are the #1 cause of looping mistakes)
Many actions appear to succeed (no exception thrown) but are actually rejected by the backend. The UI signals this via toasts and the backend via 4xx/5xx responses — neither raises a JS error.
- After every \`goto\`/\`click\`/\`fill\`/\`press\`/\`waitForSelector\`, the result automatically includes:
  - \`notifications: string[]\` — visible toast/alert/aria-live messages captured right after the action
  - \`networkErrors: [{ url, method, status, failure?, timestamp }]\` — failed HTTP responses (status >= 400) and request failures since the previous tool call
- ALWAYS check both fields before deciding what to do next. If they contain anything, the action did NOT succeed in the way you expected. Common patterns to recognise:
  - notifications containing "already exists" / "duplicate" / "in use" / "vorhanden" / "bereits" → the resource exists; navigate to it instead of recreating
  - notifications containing "invalid" / "required" / "missing" / "ungültig" / "erforderlich" → form validation failed; correct the input and retry
  - notifications containing "unauthorized" / "forbidden" / "session" → auth issue; do not keep retrying
  - networkErrors with status 409 → conflict (typically duplicate)
  - networkErrors with status 422 / 400 → validation failure
  - networkErrors with status 401 / 403 → auth
  - networkErrors with status 5xx → backend down or buggy; do not loop
- DO NOT repeat the same action if you already saw a related notification or networkError. Change strategy: pick a different name, navigate to existing resource, ask the user, or fail with a clear summary.
- If an action seems to have succeeded but the next assertion fails, call \`getNetworkErrors\` and \`getNotifications\` to look for late-arriving signals.

CONSTRAINTS
- Do NOT navigate to URLs the user did not request.
- Do NOT narrate. The user reads the chat, but your value is the final script.
- Call \`replaceTest\` progressively as you complete subtasks (see WORKFLOW step 3) AND once more right before \`finish\` with the final cumulative test.`;
