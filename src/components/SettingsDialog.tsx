import { useState, useEffect, useRef } from 'react';
import { Dialog } from './Dialog';
import { FollowActiveTabMode } from '../utils/followActiveTab';
import { AutoArchivePeriod } from '../utils/autoArchive';
import { TabAgeHighlightStyle } from '../utils/tabAgeHighlight';
import { Eye, EyeOff } from 'lucide-react';
import {
  AiRenameSettings,
  DEFAULT_AI_RENAME_SETTINGS,
  getHostPermissionPattern,
} from '../utils/aiConfig';
import { OpenAiCompatibleClient } from '../services/aiRenameService';

export type BookmarkOpenMode = 'arc' | 'newTab' | 'activeTab';
export type TabGroupDisplayOrder = 'groupsFirst' | 'groupsLast' | 'chromeOrder';

export interface SettingsValues {
  fontSize: number;
  hideOtherBookmarks: boolean;
  tabGroupDisplayOrder: TabGroupDisplayOrder;
  pinnedIconSize: number;
  bookmarkOpenMode: BookmarkOpenMode;
  arcSingleClickOpensTab: boolean;
  audioQuickJump: boolean;
  useSpaceColor: boolean;
  spaceColorAlpha: number;  // 1-100 percent
  followActiveTab: FollowActiveTabMode;
  autoArchiveAfter: AutoArchivePeriod;
  tabAgeHighlight: TabAgeHighlightStyle;
  aiSettings: AiRenameSettings;
}

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  settings: SettingsValues;
  onApply: (settings: SettingsValues) => void;
}

type SettingsTab = 'appearance' | 'behaviour' | 'ai' | 'debug';

export function SettingsDialog({
  isOpen,
  onClose,
  settings,
  onApply,
}: SettingsDialogProps) {
  // Temporary state for the dialog
  const [tempFontSize, setTempFontSize] = useState(settings.fontSize);
  const [tempHideOtherBookmarks, setTempHideOtherBookmarks] = useState(settings.hideOtherBookmarks);
  const [tempTabGroupDisplayOrder, setTempTabGroupDisplayOrder] = useState(settings.tabGroupDisplayOrder);
  const [tempPinnedIconSize, setTempPinnedIconSize] = useState(settings.pinnedIconSize);
  const [tempBookmarkOpenMode, setTempBookmarkOpenMode] = useState(settings.bookmarkOpenMode);
  const [tempArcSingleClickOpensTab, setTempArcSingleClickOpensTab] = useState(settings.arcSingleClickOpensTab);
  const [tempAudioQuickJump, setTempAudioQuickJump] = useState(settings.audioQuickJump);
  const [tempUseSpaceColor, setTempUseSpaceColor] = useState(settings.useSpaceColor);
  const [tempSpaceColorAlpha, setTempSpaceColorAlpha] = useState(settings.spaceColorAlpha);
  const [tempFollowActiveTab, setTempFollowActiveTab] = useState(settings.followActiveTab);
  const [tempAutoArchiveAfter, setTempAutoArchiveAfter] = useState(settings.autoArchiveAfter);
  const [tempTabAgeHighlight, setTempTabAgeHighlight] = useState(settings.tabAgeHighlight);
  const [tempAiSettings, setTempAiSettings] = useState(settings.aiSettings);
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  const [showApiKey, setShowApiKey] = useState(false);
  const [aiValidation, setAiValidation] = useState<{
    state: 'idle' | 'running' | 'success' | 'error';
    message: string;
  }>({ state: 'idle', message: '' });
  const [hasPageAccess, setHasPageAccess] = useState(false);

  // Track previous isOpen to detect when dialog opens
  const wasOpen = useRef(false);

  // Sync temp state when dialog opens (not on every settings change)
  // Read fresh values from localStorage for visual preferences (may be stale in parent state
  // if changed in another window). Chrome storage settings are always up-to-date via listener.
  useEffect(() => {
    // Only run when dialog opens, not when settings change while open
    if (isOpen && !wasOpen.current) {
      // Read fresh from localStorage for visual preferences
      const storedFontSize = localStorage.getItem('sidebar-font-size-px');
      const storedPinnedIconSize = localStorage.getItem('sidebar-pinned-icon-size-px');
      setTempFontSize(storedFontSize ? parseInt(storedFontSize, 10) : settings.fontSize);
      setTempPinnedIconSize(storedPinnedIconSize ? parseInt(storedPinnedIconSize, 10) : settings.pinnedIconSize);
      const storedTabGroupDisplayOrder = localStorage.getItem('sidebar-tab-group-display-order');
      setTempTabGroupDisplayOrder((storedTabGroupDisplayOrder as TabGroupDisplayOrder) || settings.tabGroupDisplayOrder);

      // These don't need fresh read - not shown in dialog or use chrome.storage.local
      setTempHideOtherBookmarks(settings.hideOtherBookmarks);
      setTempBookmarkOpenMode(settings.bookmarkOpenMode);
      setTempArcSingleClickOpensTab(settings.arcSingleClickOpensTab);
      setTempAudioQuickJump(settings.audioQuickJump);
      setTempUseSpaceColor(settings.useSpaceColor);
      setTempSpaceColorAlpha(settings.spaceColorAlpha);
      setTempFollowActiveTab(settings.followActiveTab);
      setTempAutoArchiveAfter(settings.autoArchiveAfter);
      setTempTabAgeHighlight(settings.tabAgeHighlight);
      setTempAiSettings(settings.aiSettings);
      setShowApiKey(false);
      setAiValidation({ state: 'idle', message: '' });
      setActiveTab('appearance');
      chrome.permissions.contains({ origins: ['http://*/*', 'https://*/*'] })
        .then(setHasPageAccess)
        .catch(() => setHasPageAccess(false));
    }
    wasOpen.current = isOpen;
  }, [isOpen, settings]);

  const handleApply = () => {
    onApply({
      fontSize: tempFontSize,
      hideOtherBookmarks: tempHideOtherBookmarks,
      tabGroupDisplayOrder: tempTabGroupDisplayOrder,
      pinnedIconSize: tempPinnedIconSize,
      bookmarkOpenMode: tempBookmarkOpenMode,
      arcSingleClickOpensTab: tempArcSingleClickOpensTab,
      audioQuickJump: tempAudioQuickJump,
      useSpaceColor: tempUseSpaceColor,
      spaceColorAlpha: tempSpaceColorAlpha,
      followActiveTab: tempFollowActiveTab,
      autoArchiveAfter: tempAutoArchiveAfter,
      tabAgeHighlight: tempTabAgeHighlight,
      aiSettings: tempAiSettings,
    });
  };

  /**
   * 请求用户配置的 API origin 权限并发送最小真实请求。
   */
  const handleValidateAi = async () =>
  {
    setAiValidation({ state: 'running', message: 'Validating with a real API request…' });
    try
    {
      const origin = getHostPermissionPattern(tempAiSettings.baseUrl);
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted)
      {
        throw new Error('Permission to access the API host was not granted');
      }

      const result = await new OpenAiCompatibleClient().validate(tempAiSettings);
      const protocol = result.protocol === 'responses' ? 'Responses API' : 'Chat Completions';
      setAiValidation({
        state: 'success',
        message: `Configuration works with ${protocol} (${result.latencyMs} ms)`,
      });
    }
    catch (error)
    {
      setAiValidation({
        state: 'error',
        message: error instanceof Error ? error.message : 'Validation failed',
      });
    }
  };

  /**
   * 自动命名无法在后台临时弹权限，因此在设置阶段一次性申请网页读取权限。
   */
  const handleRequestPageAccess = async () =>
  {
    try
    {
      const granted = await chrome.permissions.request({
        origins: ['http://*/*', 'https://*/*'],
      });
      setHasPageAccess(granted);
    }
    catch
    {
      setHasPageAccess(false);
    }
  };

  const handleTempFontSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newSize = parseInt(e.target.value, 10);
    if (!isNaN(newSize) && newSize > 4 && newSize < 72) {
      setTempFontSize(newSize);
    }
  };

  const handleTempPinnedIconSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newSize = parseInt(e.target.value, 10);
    if (!isNaN(newSize) && newSize >= 12 && newSize <= 48) {
      setTempPinnedIconSize(newSize);
    }
  };

  const tabClass = (tab: SettingsTab) =>
    `flex-1 px-3 py-2 text-sm font-medium transition-colors ${
      activeTab === tab
        ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
    }`;

  const footerButtons = (
    <div className="border-t border-gray-200 dark:border-gray-700 p-3 flex justify-end gap-2">
      <button
        onClick={onClose}
        className="px-3 py-1 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
      >
        Cancel
      </button>
      <button
        onClick={handleApply}
        className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
      >
        Apply
      </button>
    </div>
  );

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Settings" maxWidth="max-w-lg" footer={footerButtons}>
      {/* Tab bar - sticky so it doesn't scroll away */}
      <div className="sticky top-0 bg-white dark:bg-gray-800 flex border-b border-gray-200 dark:border-gray-700 z-10">
        <button onClick={() => setActiveTab('appearance')} className={tabClass('appearance')}>
          Appearance
        </button>
        <button onClick={() => setActiveTab('behaviour')} className={tabClass('behaviour')}>
          Behaviour
        </button>
        <button onClick={() => setActiveTab('ai')} className={tabClass('ai')}>
          AI
        </button>
        {import.meta.env.DEV && (
          <button onClick={() => setActiveTab('debug')} className={tabClass('debug')}>
            Debug
          </button>
        )}
      </div>

      <div className="p-3 space-y-3">
        {activeTab === 'appearance' && (
          <>
            {/* Font Size */}
            <div>
              <label className="block font-medium mb-1 text-gray-700 dark:text-gray-300">
                Font Size (px)
              </label>
              <input
                type="number"
                min="6"
                max="36"
                value={tempFontSize}
                onChange={handleTempFontSizeChange}
                className="w-full px-2 py-1 border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <p className="mt-1 text-gray-500 dark:text-gray-400">
                Default: 14px
              </p>
            </div>

            {/* Pinned Icon Size */}
            <div>
              <label className="block font-medium mb-1 text-gray-700 dark:text-gray-300">
                Pinned Icon Size (px)
              </label>
              <input
                type="number"
                min="12"
                max="48"
                value={tempPinnedIconSize}
                onChange={handleTempPinnedIconSizeChange}
                className="w-full px-2 py-1 border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <p className="mt-1 text-gray-500 dark:text-gray-400">
                Default: 22px
              </p>
            </div>

            {/* Use space colour as sidebar background */}
            <div>
              <label className="flex items-center gap-2 text-gray-700 dark:text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={tempUseSpaceColor}
                  onChange={(e) => setTempUseSpaceColor(e.target.checked)}
                  className="rounded border-gray-300 dark:border-gray-600"
                />
                Use space colour as sidebar background
              </label>
              <p className="mt-0.5 text-gray-500 dark:text-gray-400 ml-5">
                {tempUseSpaceColor
                  ? "Tints the sidebar with the active space's colour"
                  : "Sidebar uses the default background colour"}
              </p>
              {tempUseSpaceColor && (
                <div className="ml-5 mt-1">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-gray-700 dark:text-gray-300">
                      Intensity
                    </label>
                    <span className="text-gray-500 dark:text-gray-400">
                      {tempSpaceColorAlpha}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    value={tempSpaceColorAlpha}
                    onChange={(e) => setTempSpaceColorAlpha(parseInt(e.target.value, 10))}
                    className="w-full accent-blue-500"
                  />
                </div>
              )}
            </div>

            {/* Highlight tabs by last use */}
            <div>
              <label className="block font-medium mb-1 text-gray-700 dark:text-gray-300">
                Highlight tabs by last use
              </label>
              <select
                value={tempTabAgeHighlight}
                onChange={(e) => setTempTabAgeHighlight(e.target.value as TabAgeHighlightStyle)}
                className="w-full px-2 py-1 border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="off">Off</option>
                <option value="white">White</option>
                <option value="accent">Accent</option>
                <option value="cooling">Cooling</option>
                <option value="trail">Trail</option>
              </select>
              <p className="mt-1 text-gray-500 dark:text-gray-400">
                Recently used tabs in the Tab list get a stronger background
              </p>
            </div>
          </>
        )}

        {activeTab === 'behaviour' && (
          <>
            {/* Open bookmark mode */}
            <div>
              <label className="block text-gray-700 dark:text-gray-300 mb-1">
                Open bookmark
              </label>
              <select
                value={tempBookmarkOpenMode}
                onChange={(e) => setTempBookmarkOpenMode(e.target.value as BookmarkOpenMode)}
                className="w-full px-2 py-1 border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="arc">Arc style</option>
                <option value="newTab">In new tab</option>
                <option value="activeTab">In active tab</option>
              </select>
              <p className="mt-1 text-gray-500 dark:text-gray-400">
                {tempBookmarkOpenMode === 'arc' && 'Bookmarks act as persistent tabs in a group'}
                {tempBookmarkOpenMode === 'newTab' && 'Opens bookmark in a new background tab'}
                {tempBookmarkOpenMode === 'activeTab' && 'Replaces the current tab with the bookmark'}
              </p>
            </div>

            {/* Single click (Arc mode only) */}
            {tempBookmarkOpenMode === 'arc' && (
              <div>
                <label className="flex items-center gap-2 text-gray-700 dark:text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={tempArcSingleClickOpensTab}
                    onChange={(e) => setTempArcSingleClickOpensTab(e.target.checked)}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  Single click opens live tab
                </label>
                <p className="mt-0.5 text-gray-500 dark:text-gray-400 ml-5">
                  {tempArcSingleClickOpensTab
                    ? "Single click opens the bookmark as a live tab"
                    : "Single click selects; use the hover open button to load"}
                </p>
              </div>
            )}

            {/* Audio button */}
            <div>
              <label className="flex items-center gap-2 text-gray-700 dark:text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={tempAudioQuickJump}
                  onChange={(e) => setTempAudioQuickJump(e.target.checked)}
                  className="rounded border-gray-300 dark:border-gray-600"
                />
                Audio button: click to jump, hold to show list
              </label>
              <p className="mt-0.5 text-gray-500 dark:text-gray-400 ml-5">
                {tempAudioQuickJump
                  ? "Click jumps to the latest playing tab; hold opens the audio tabs list"
                  : "Click opens the audio tabs list"}
              </p>
            </div>

            {/* Follow active tab */}
            <div>
              <label className="block text-gray-700 dark:text-gray-300 mb-1">
                Follow active tab
              </label>
              <select
                value={tempFollowActiveTab}
                onChange={(e) => setTempFollowActiveTab(e.target.value as FollowActiveTabMode)}
                className="w-full px-2 py-1 border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="space-and-scroll">Switch space and show the tab</option>
                <option value="space">Switch to the tab's space</option>
                <option value="off">Off</option>
              </select>
              <p className="mt-0.5 text-gray-500 dark:text-gray-400 ml-5">
                {tempFollowActiveTab === 'space-and-scroll' &&
                  "Always scroll to show the active tab, switching space when needed"}
                {tempFollowActiveTab === 'space' &&
                  "Switch to the active tab's space; only scroll when the space changes"}
                {tempFollowActiveTab === 'off' &&
                  "Sidebar stays put when you switch tabs"}
              </p>
            </div>

            {/* Tab group display order */}
            <div>
              <label className="block text-gray-700 dark:text-gray-300 mb-1">
                Tab group display order
              </label>
              <select
                value={tempTabGroupDisplayOrder}
                onChange={(e) => setTempTabGroupDisplayOrder(e.target.value as TabGroupDisplayOrder)}
                className="w-full px-2 py-1 border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="groupsFirst">Groups before ungrouped tabs</option>
                <option value="groupsLast">Groups after ungrouped tabs</option>
                <option value="chromeOrder">Chrome's native order</option>
              </select>
              <p className="mt-0.5 text-gray-500 dark:text-gray-400 ml-5">
                Controls group placement when multiple groups are visible
              </p>
            </div>

            {/* Archive tabs after */}
            <div>
              <label className="block text-gray-700 dark:text-gray-300 mb-1">
                Archive tabs after
              </label>
              <select
                value={tempAutoArchiveAfter}
                onChange={(e) => setTempAutoArchiveAfter(e.target.value as AutoArchivePeriod)}
                className="w-full px-2 py-1 border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="never">Never</option>
                {import.meta.env.DEV && (
                  <option value="1m">1 minute</option>
                )}
                <option value="12h">12 hours</option>
                <option value="24h">24 hours</option>
                <option value="3d">3 days</option>
                <option value="7d">7 days</option>
                <option value="30d">30 days</option>
              </select>
              <p className="mt-0.5 text-gray-500 dark:text-gray-400 ml-5">
                {tempAutoArchiveAfter === 'never'
                  ? "Tabs and open bookmark pages stay open until you close them"
                  : "Unused tabs move to the space's Archive; unused open bookmark pages close and keep their bookmark"}
              </p>
            </div>
          </>
        )}

        {activeTab === 'ai' && (
          <>
            <div>
              <label className="block font-medium mb-1 text-gray-700 dark:text-gray-300">
                Base URL
              </label>
              <input
                type="url"
                value={tempAiSettings.baseUrl}
                onChange={(event) => setTempAiSettings({ ...tempAiSettings, baseUrl: event.target.value })}
                placeholder="https://api.openai.com/v1"
                className="w-full px-2 py-1.5 border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <p className="mt-1 text-gray-500 dark:text-gray-400">
                Accepts a service root, /v1 base, or a complete /responses or /chat/completions URL.
              </p>
            </div>

            <div>
              <label className="block font-medium mb-1 text-gray-700 dark:text-gray-300">
                API Key
              </label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={tempAiSettings.apiKey}
                  onChange={(event) => setTempAiSettings({ ...tempAiSettings, apiKey: event.target.value })}
                  autoComplete="off"
                  className="w-full px-2 py-1.5 pr-9 border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(value => !value)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-700 dark:hover:text-gray-200"
                  aria-label={showApiKey ? 'Hide API Key' : 'Show API Key'}
                >
                  {showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <p className="mt-1 text-gray-500 dark:text-gray-400">
                Stored locally by the extension. It is never sent to the page being renamed.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-medium mb-1 text-gray-700 dark:text-gray-300">
                  Model
                </label>
                <input
                  type="text"
                  value={tempAiSettings.model}
                  onChange={(event) => setTempAiSettings({ ...tempAiSettings, model: event.target.value })}
                  placeholder="gpt-5-mini"
                  className="w-full px-2 py-1.5 border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block font-medium mb-1 text-gray-700 dark:text-gray-300">
                  API protocol
                </label>
                <select
                  value={tempAiSettings.protocol}
                  onChange={(event) => setTempAiSettings({
                    ...tempAiSettings,
                    protocol: event.target.value as AiRenameSettings['protocol'],
                  })}
                  className="w-full px-2 py-1.5 border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="auto">Auto</option>
                  <option value="responses">Responses API</option>
                  <option value="chat-completions">Chat Completions</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block font-medium mb-1 text-gray-700 dark:text-gray-300">
                Reasoning effort
              </label>
              <select
                value={tempAiSettings.reasoningEffort}
                onChange={(event) => setTempAiSettings({
                  ...tempAiSettings,
                  reasoningEffort: event.target.value as AiRenameSettings['reasoningEffort'],
                })}
                className="w-full px-2 py-1.5 border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="off">None</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
              <p className="mt-1 text-gray-500 dark:text-gray-400">
                None omits the reasoning parameter for models or compatible APIs that do not support it.
              </p>
            </div>

            <div>
              <label className="block font-medium mb-1 text-gray-700 dark:text-gray-300">
                Prompt
              </label>
              <textarea
                value={tempAiSettings.prompt}
                onChange={(event) => setTempAiSettings({ ...tempAiSettings, prompt: event.target.value })}
                rows={9}
                className="w-full px-2 py-1.5 border rounded resize-y dark:bg-gray-900 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <p className="mt-1 text-gray-500 dark:text-gray-400">
                URL, title, description and page content are appended automatically.
              </p>
            </div>

            <div className="rounded border border-gray-200 dark:border-gray-700 p-2 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-gray-700 dark:text-gray-300">Read web page content</div>
                  <p className="text-gray-500 dark:text-gray-400">
                    {hasPageAccess
                      ? 'Allowed for HTTP and HTTPS pages'
                      : 'Without access, AI naming only uses the saved title and URL'}
                  </p>
                  <p className="text-gray-500 dark:text-gray-400">
                    Visible page text is sent to your configured API provider when a name is generated.
                  </p>
                </div>
                {!hasPageAccess && (
                  <button
                    type="button"
                    onClick={handleRequestPageAccess}
                    className="shrink-0 px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                  >
                    Allow
                  </button>
                )}
              </div>

              <label className="flex items-center gap-2 text-gray-700 dark:text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={tempAiSettings.autoRename}
                  onChange={(event) => setTempAiSettings({ ...tempAiSettings, autoRename: event.target.checked })}
                  className="rounded border-gray-300 dark:border-gray-600"
                />
                Automatically rename newly pinned sites and bookmarks
              </label>
              {tempAiSettings.autoRename && !hasPageAccess && (
                <p className="text-amber-600 dark:text-amber-400">
                  Automatic naming will use only the original title and URL until page access is allowed.
                </p>
              )}
            </div>

            <div>
              <button
                type="button"
                onClick={handleValidateAi}
                disabled={aiValidation.state === 'running'}
                className="w-full px-3 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
              >
                {aiValidation.state === 'running' ? 'Validating…' : 'Validate configuration'}
              </button>
              <p className="mt-1 text-gray-500 dark:text-gray-400">
                Sends a small real request and consumes a few tokens. Validation does not save the form.
              </p>
              {aiValidation.message && (
                <p className={`mt-1 ${
                  aiValidation.state === 'success'
                    ? 'text-green-600 dark:text-green-400'
                    : aiValidation.state === 'error'
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-gray-500 dark:text-gray-400'
                }`}>
                  {aiValidation.message}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => setTempAiSettings({ ...DEFAULT_AI_RENAME_SETTINGS })}
              className="text-blue-500 hover:text-blue-600"
            >
              Reset AI settings to defaults
            </button>
          </>
        )}

        {import.meta.env.DEV && activeTab === 'debug' && (
          <>
            {/* Reset Welcome */}
            <div className="flex items-center justify-between">
              <label className="text-gray-700 dark:text-gray-300">
                Reset Welcome
              </label>
              <button
                onClick={() =>
                {
                  localStorage.removeItem('sidebar-has-seen-welcome');
                  alert('Welcome dialog reset. Reload extension to see it.');
                }}
                className="px-2 py-0.5 text-xs bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 rounded hover:bg-purple-200 dark:hover:bg-purple-800"
              >
                Reset
              </button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
