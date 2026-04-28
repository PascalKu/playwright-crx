/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { Mode } from '@recorder/recorderTypes';
import type { CrxApplication } from 'playwright-crx';
import playwright, { crx, _debug, _setUnderTest, _isUnderTest as isUnderTest } from 'playwright-crx';
import type { CrxSettings } from './settings';
import { addSettingsChangedListener, defaultSettings, loadSettings } from './settings';
import { runAgent, type AgentMessage, type AgentStreamEvent } from './aiAgent';

type CrxMode = Mode | 'detached';

const stoppedModes: CrxMode[] = ['none', 'standby', 'detached'];
const recordingModes: CrxMode[] = ['recording', 'assertingText', 'assertingVisibility', 'assertingValue', 'assertingSnapshot'];

// we must lazy initialize it
let crxAppPromise: Promise<CrxApplication> | undefined;

const attachedTabIds = new Set<number>();
let currentMode: CrxMode | 'detached' | undefined;
let settings: CrxSettings = defaultSettings;

// if it's in sidepanel mode, we need to open it synchronously on action click,
// so we need to fetch its value asap
const settingsInitializing = loadSettings().then(s => settings = s).catch(() => {});

addSettingsChangedListener(newSettings => {
  settings = newSettings;
  setTestIdAttributeName(newSettings.testIdAttributeName);
});

let allowsIncognitoAccess = false;
chrome.extension.isAllowedIncognitoAccess().then(allowed => {
  allowsIncognitoAccess = allowed;
});

async function changeAction(tabId: number, mode?: CrxMode | 'detached') {
  if (!mode)
    mode = attachedTabIds.has(tabId) ? currentMode : 'detached';
  else if (mode !== 'detached')
    currentMode = mode;


  // detached basically implies recorder windows was closed
  if (!mode || stoppedModes.includes(mode)) {
    await Promise.all([
      chrome.action.setTitle({ title: mode === 'none' ? 'Stopped' : 'Record', tabId }),
      chrome.action.setBadgeText({ text: '', tabId }),
    ]).catch(() => {});
    return;
  }

  const { text, title, color, bgColor } = recordingModes.includes(mode) ?
    { text: 'REC', title: 'Recording', color: 'white', bgColor: 'darkred' } :
    { text: 'INS', title: 'Inspecting', color: 'white', bgColor: 'dodgerblue' };

  await Promise.all([
    chrome.action.setTitle({ title, tabId }),
    chrome.action.setBadgeText({ text, tabId }),
    chrome.action.setBadgeTextColor({ color, tabId }),
    chrome.action.setBadgeBackgroundColor({ color: bgColor, tabId }),
  ]).catch(() => {});
}

// action state per tab is reset every time a navigation occurs
// https://bugs.chromium.org/p/chromium/issues/detail?id=1450904
chrome.tabs.onUpdated.addListener(tabId => changeAction(tabId));

async function getCrxApp(incognito: boolean) {
  if (!crxAppPromise) {
    await settingsInitializing;

    crxAppPromise = crx.start({ incognito }).then(crxApp => {
      crxApp.recorder.addListener('hide', async () => {
        await crxApp.close();
        crxAppPromise = undefined;
      });
      crxApp.recorder.addListener('modechanged', async ({ mode }) => {
        await Promise.all([...attachedTabIds].map(tabId => changeAction(tabId, mode)));
      });
      crxApp.addListener('attached', async ({ tabId }) => {
        attachedTabIds.add(tabId);
        await changeAction(tabId, crxApp.recorder.mode());
      });
      crxApp.addListener('detached', async tabId => {
        attachedTabIds.delete(tabId);
        await changeAction(tabId, 'detached');
      });
      setTestIdAttributeName(settings.testIdAttributeName);
      return crxApp;
    });
  }
  return await crxAppPromise;
}

async function attach(tab: chrome.tabs.Tab, mode?: Mode) {
  if (!tab?.id || (attachedTabIds.has(tab.id) && !mode))
    return;

  // if the tab is incognito, chek if can be started in incognito mode.
  if (tab.incognito && !allowsIncognitoAccess)
    throw new Error('Not authorized to launch in Incognito mode.');

  const sidepanel = !isUnderTest() && settings.sidepanel;

  // we need to open sidepanel before any async call
  if (sidepanel)
    await chrome.sidePanel.open({ windowId: tab.windowId });

  // ensure one attachment at a time
  chrome.action.disable();
  if (tab.url?.startsWith('chrome://')) {
    const windowId = tab.windowId;
    tab = await new Promise(resolve => {
      // we will not be able to attach to this tab, so we need to open a new one
      chrome.tabs.create({ windowId, url: 'about:blank' }).
          then(tab => {
            resolve(tab);
          }).
          catch(() => {});
    });
  }

  const crxApp = await getCrxApp(tab.incognito);

  try {

    if (crxApp.recorder.isHidden()) {
      await crxApp.recorder.show({
        mode: mode ?? 'recording',
        language: settings.targetLanguage,
        window: { type: sidepanel ? 'sidepanel' : 'popup', url: 'index.html' },
        playInIncognito: settings.playInIncognito,
      });
    }

    await crxApp.attach(tab.id!);

    if (mode)
      await crxApp.recorder.setMode(mode);
  } finally {
    chrome.action.enable();
  }
}

async function setTestIdAttributeName(testIdAttributeName: string) {
  playwright.selectors.setTestIdAttribute(testIdAttributeName);
}

chrome.action.onClicked.addListener(attach);

chrome.contextMenus.create({
  id: 'pw-recorder',
  title: 'Attach to Playwright Recorder',
  contexts: ['all'],
});

chrome.contextMenus.onClicked.addListener(async (_, tab) => {
  if (tab)
    await attach(tab);
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (!tab.id)
    return;
  if (command === 'inspect')
    await attach(tab, 'inspecting');
  else if (command === 'record')
    await attach(tab, 'recording');
});

async function getStorageState() {
  const crxApp = await crxAppPromise;
  if (!crxApp)
    return;

  return await crxApp.context().storageState();
}

chrome.runtime.onMessage.addListener((message, _, sendResponse) => {
  if (message.event === 'storageStateRequested') {
    getStorageState().then(sendResponse).catch(() => {});
    return true;
  }
});

type AiInbound =
  | { type: 'ai'; method: 'run'; prompt: string; currentScript?: string }
  | { type: 'ai'; method: 'cancel' }
  | { type: 'ai'; method: 'clear' };

type AiOutbound =
  | { type: 'ai'; method: 'event'; event: AgentStreamEvent };

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'ai')
    return;

  let abort: AbortController | undefined;
  let conversation: AgentMessage[] = [];

  const send = (event: AgentStreamEvent) => {
    try {
      const msg: AiOutbound = { type: 'ai', method: 'event', event };
      port.postMessage(msg);
    } catch {
      // port disconnected
    }
  };

  port.onDisconnect.addListener(() => {
    abort?.abort();
    conversation = [];
  });

  port.onMessage.addListener(async (raw: AiInbound) => {
    if (!raw || raw.type !== 'ai')
      return;

    if (raw.method === 'cancel') {
      abort?.abort();
      return;
    }

    if (raw.method === 'clear') {
      abort?.abort();
      conversation = [];
      return;
    }

    if (raw.method !== 'run')
      return;

    if (abort)
      abort.abort();

    abort = new AbortController();

    try {
      const settings = await loadSettings();
      const apiKey = (settings.claudeApiKey ?? '').trim();
      if (!apiKey) {
        send({ kind: 'error', message: 'No Anthropic API key configured. Set it in Preferences.' });
        send({ kind: 'done', reason: 'error' });
        return;
      }

      const crxApp = await crxAppPromise;
      const page = crxApp?.pages()[0];
      const pageUrl = page?.url();

      // Track HTTP failures + request failures during this agent run so the
      // agent can pop them via the getNetworkErrors tool / auto-attached
      // result side effects.
      type NetErr = { url: string; method: string; status: number; failure?: string; timestamp: number };
      const networkErrors: NetErr[] = [];
      const onResponse = (response: any) => {
        try {
          const status = response.status();
          if (status < 400)
            return;
          networkErrors.push({
            url: response.url(),
            method: response.request().method(),
            status,
            timestamp: Date.now(),
          });
          if (networkErrors.length > 200)
            networkErrors.shift();
        } catch { /* ignore */ }
      };
      const onRequestFailed = (request: any) => {
        try {
          networkErrors.push({
            url: request.url(),
            method: request.method(),
            status: 0,
            failure: request.failure()?.errorText ?? 'request failed',
            timestamp: Date.now(),
          });
          if (networkErrors.length > 200)
            networkErrors.shift();
        } catch { /* ignore */ }
      };
      const attached: any[] = [];
      for (const p of crxApp?.pages() ?? []) {
        try {
          (p as any).on('response', onResponse);
          (p as any).on('requestfailed', onRequestFailed);
          attached.push(p);
        } catch { /* ignore */ }
      }
      const onPageOpened = (p: any) => {
        try {
          p.on('response', onResponse);
          p.on('requestfailed', onRequestFailed);
          attached.push(p);
        } catch { /* ignore */ }
      };
      try { (crxApp as any)?.context().on('page', onPageOpened); } catch { /* ignore */ }

      // Optionally pause the recorder while the AI is working so its scratch
      // clicks/fills don't pollute the recorder source. The agent then writes
      // the test exclusively via replaceTest. Toggle in Preferences.
      const recorder = crxApp?.recorder;
      const previousMode = recorder?.mode();
      const shouldPauseRecorder = settings.aiPauseRecorder !== false
        && !!recorder
        && previousMode !== 'standby'
        && previousMode !== 'none';
      if (recorder && shouldPauseRecorder)
        await recorder.setMode('standby').catch(() => {});

      try {
        await runAgent({
          apiKey,
          model: settings.claudeModel ?? 'haiku',
          maxSteps: settings.aiMaxSteps ?? 25,
          maxTokens: settings.aiMaxTokens ?? 8192,
          prompt: raw.prompt,
          currentScript: raw.currentScript,
          pageUrl,
          localBaseUrl: settings.localBaseUrl,
          priorMessages: conversation,
          getPage: () => crxApp?.pages()[0],
          getRecorder: () => crxApp?.recorder,
          popNetworkErrors: () => networkErrors.splice(0),
          onEvent: send,
          onMessages: msgs => { conversation = msgs; },
          signal: abort.signal,
        });
      } finally {
        for (const p of attached) {
          try { (p as any).off('response', onResponse); } catch { /* ignore */ }
          try { (p as any).off('requestfailed', onRequestFailed); } catch { /* ignore */ }
        }
        try { (crxApp as any)?.context().off('page', onPageOpened); } catch { /* ignore */ }
        if (recorder && shouldPauseRecorder && previousMode)
          await recorder.setMode(previousMode).catch(() => {});
      }
    } catch (e: any) {
      send({ kind: 'error', message: e?.message ?? String(e) });
      send({ kind: 'done', reason: 'error' });
    }
  });
});


chrome.runtime.onInstalled.addListener(details => {
  if ((globalThis as any).__crxTest)
    return;
  if ([chrome.runtime.OnInstalledReason.INSTALL, chrome.runtime.OnInstalledReason.UPDATE].includes(details.reason))
    chrome.tabs.create({ url: `https://github.com/ruifigueira/playwright-crx/releases/tag/v${chrome.runtime.getManifest().version}` }).catch(() => {});
});

// for testing
Object.assign(self, { attach, setTestIdAttributeName, getCrxApp, _debug, _setUnderTest });
