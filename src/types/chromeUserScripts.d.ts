// @types/chrome 0.0.260 has no chrome.userScripts. Only the part UserScriptRunner uses is declared:
// configureWorld, getWorldConfigurations and resetWorldConfiguration with worldId (Chrome 133+), execute
// (Chrome 135+) and getScripts, the check for the Allow User Scripts toggle.

interface UserScriptsWorldProperties
{
  worldId?: string;
  csp?: string;
  messaging?: boolean;
}

interface UserScriptsInjection
{
  target: { tabId: number; frameIds?: number[]; allFrames?: boolean };
  js: Array<{ code: string } | { file: string }>;
  world?: 'USER_SCRIPT' | 'MAIN';
  worldId?: string;
  injectImmediately?: boolean;
}

interface UserScriptsInjectionResult
{
  frameId: number;
  documentId?: string;
  result?: unknown;
  error?: string;
}

interface UserScriptsApi
{
  configureWorld(properties: UserScriptsWorldProperties): Promise<void>;
  getWorldConfigurations(): Promise<UserScriptsWorldProperties[]>;
  resetWorldConfiguration(worldId?: string): Promise<void>;
  execute(injection: UserScriptsInjection): Promise<UserScriptsInjectionResult[]>;
  getScripts(filter?: { ids?: string[] }): Promise<unknown[]>;
}

declare namespace chrome
{
  /**
   * Undefined until the extension holds the optional userScripts permission and the user turns on
   * Allow User Scripts on its Details page (Developer mode before Chrome 138).
   */
  const userScripts: UserScriptsApi | undefined;
}
