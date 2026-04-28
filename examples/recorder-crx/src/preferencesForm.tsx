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
import React from 'react';
import type { CrxSettings } from './settings';
import { defaultSettings, loadSettings, storeSettings } from './settings';

export const PreferencesForm: React.FC = ({}) => {
  const [initialSettings, setInitialSettings] = React.useState<CrxSettings>(defaultSettings);
  const [settings, setSettings] = React.useState<CrxSettings>(defaultSettings);
  const [isAllowedIncognitoAccess, setIsAllowedIncognitoAccess] = React.useState<boolean>(false);

  React.useEffect(() => {
    loadSettings()
        .then(settings => {
          setInitialSettings(settings);
          setSettings(settings);
        });
    chrome.extension.isAllowedIncognitoAccess().then(setIsAllowedIncognitoAccess);
  }, []);

  const canSave = React.useMemo(() => {
    return initialSettings.sidepanel !== settings.sidepanel ||
      initialSettings.targetLanguage !== settings.targetLanguage ||
      initialSettings.testIdAttributeName !== settings.testIdAttributeName ||
      initialSettings.playInIncognito !== settings.playInIncognito ||
      initialSettings.experimental !== settings.experimental ||
      initialSettings.claudeApiKey !== settings.claudeApiKey ||
      initialSettings.claudeModel !== settings.claudeModel ||
      initialSettings.aiMaxSteps !== settings.aiMaxSteps ||
      initialSettings.aiMaxTokens !== settings.aiMaxTokens ||
      initialSettings.aiPauseRecorder !== settings.aiPauseRecorder ||
      initialSettings.localBaseUrl !== settings.localBaseUrl;
  }, [settings, initialSettings]);

  const saveSettings = React.useCallback((e: React.FormEvent<HTMLFormElement>) => {
    if (!e.currentTarget.reportValidity())
      return;

    e.preventDefault();
    storeSettings(settings)
        .then(() => setInitialSettings(settings))
        .catch(() => {});
  }, [settings]);

  return <form id='preferences-form' onSubmit={saveSettings}>
    <label htmlFor='target-language'>Default language:</label>
    <select id='target-language' name='target-language' value={settings.targetLanguage} onChange={e => setSettings({ ...settings, targetLanguage: e.target.selectedOptions[0].value })}>
      <optgroup label='Node.js'>
        <option value='javascript'>Library</option>
        <option value='playwright-test'>Test Runner</option>
      </optgroup>
      <optgroup label='Java'>
        <option value='java-junit'>JUnit</option>
        <option value='java'>Library</option>
      </optgroup>
      <optgroup label='Python'>
        <option value='python-pytest'>Pytest</option>
        <option value='python'>Library</option>
        <option value='python-async'>Library Async</option>
      </optgroup>
      <optgroup label='.NET C#'>
        <option value='csharp-mstest'>MSTest</option>
        <option value='csharp-nunit'>NUnit</option>
        <option value='csharp'>Library</option>
      </optgroup>
    </select>
    <label htmlFor='test-id'>TestID Attribute Name:</label>
    <input
      type='text'
      id='test-id'
      name='test-id'
      placeholder='Enter Attribute Name'
      pattern='[a-zA-Z][\w\-]*'
      title='Must be a valid attribute name'
      value={settings.testIdAttributeName}
      onChange={e => setSettings({ ...settings, testIdAttributeName: e.target.value })}
    />
    <div>
      <label htmlFor='sidepanel' className='row'>Open in Side Panel:</label>
      <input
        type='checkbox'
        id='sidepanel'
        name='sidepanel'
        checked={settings.sidepanel}
        onChange={e => setSettings({ ...settings, sidepanel: e.target.checked })}
      />
    </div>
    <div>
      <label htmlFor='playInIncognito' className='row'>Play in incognito:</label>
      <input
        disabled={!isAllowedIncognitoAccess}
        type='checkbox'
        id='playInIncognito'
        name='playInIncognito'
        checked={settings.playInIncognito}
        onChange={e => setSettings({ ...settings, playInIncognito: e.target.checked })}
      />
      {!isAllowedIncognitoAccess && <div className='note error'>This feature requires the extension to be allowed to run in incognito mode.</div>}
    </div>
    <div>
      <label htmlFor='experimental' className='row'>Allow experimental features:</label>
      <input
        type='checkbox'
        id='experimental'
        name='experimental'
        checked={settings.experimental}
        onChange={e => setSettings({ ...settings, experimental: e.target.checked })}
      />
    </div>
    <fieldset className='ai-section'>
      <legend>AI assistant (Claude)</legend>
      <label htmlFor='claudeApiKey'>Anthropic API key:</label>
      <input
        type='password'
        id='claudeApiKey'
        name='claudeApiKey'
        autoComplete='off'
        spellCheck={false}
        placeholder='sk-ant-...'
        value={settings.claudeApiKey ?? ''}
        onChange={e => setSettings({ ...settings, claudeApiKey: e.target.value })}
      />
      <div className='note'>Stored in <code>chrome.storage.sync</code>. Used only to call <code>api.anthropic.com</code> from this extension.</div>
      <label htmlFor='claudeModel'>Model:</label>
      <select
        id='claudeModel'
        name='claudeModel'
        value={settings.claudeModel ?? 'haiku'}
        onChange={e => setSettings({ ...settings, claudeModel: e.target.value as 'haiku' | 'sonnet' | 'opus' })}
      >
        <option value='haiku'>Haiku 4.5 (fast, cheap)</option>
        <option value='sonnet'>Sonnet 4.6 (balanced)</option>
        <option value='opus'>Opus 4.7 (best quality)</option>
      </select>
      <label htmlFor='aiMaxSteps'>Max tool steps per turn:</label>
      <input
        type='number'
        id='aiMaxSteps'
        name='aiMaxSteps'
        min={1}
        max={100}
        value={settings.aiMaxSteps ?? 25}
        onChange={e => setSettings({ ...settings, aiMaxSteps: Math.max(1, Math.min(100, Number(e.target.value) || 25)) })}
      />
      <label htmlFor='aiMaxTokens'>Max output tokens per response:</label>
      <input
        type='number'
        id='aiMaxTokens'
        name='aiMaxTokens'
        min={1024}
        max={32000}
        step={1024}
        value={settings.aiMaxTokens ?? 8192}
        onChange={e => setSettings({ ...settings, aiMaxTokens: Math.max(1024, Math.min(32000, Number(e.target.value) || 8192)) })}
      />
      <div className='note'>Bigger = the AI can write longer test scripts in one shot, but more wall-clock time per response. 8192 is fine for most tests; raise to 16384+ if your tests are very long.</div>
      <div>
        <label htmlFor='aiPauseRecorder' className='row'>Pause recorder while AI is working:</label>
        <input
          type='checkbox'
          id='aiPauseRecorder'
          name='aiPauseRecorder'
          checked={settings.aiPauseRecorder !== false}
          onChange={e => setSettings({ ...settings, aiPauseRecorder: e.target.checked })}
        />
      </div>
      <div className='note'>{`On (default): the AI's clicks/fills don't pollute the recorder source. The script in the Locator tab only changes when the AI calls `}<code>replaceTest</code>{`. Off: every AI action is captured live (more visual feedback, more noise).`}</div>
      <label htmlFor='localBaseUrl'>Local base URL (used as fallback in generated tests):</label>
      <input
        type='text'
        id='localBaseUrl'
        name='localBaseUrl'
        placeholder='http://localhost:3000'
        value={settings.localBaseUrl ?? ''}
        onChange={e => setSettings({ ...settings, localBaseUrl: e.target.value })}
      />
      <div className='note'>{`The AI will write tests as `}<code>{`page.goto('/path')`}</code>{` with `}<code>{`process.env.BASE_URL ?? '`}<em>this value</em>{`'`}</code>{` as the local fallback. Override `}<code>BASE_URL</code>{` in your CI to target staging/prod.`}</div>
    </fieldset>
    <button id='submit' type='submit' disabled={!canSave}>{canSave ? 'Save' : 'Saved'}</button>
  </form>;
};
