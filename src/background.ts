// Safari does not support "world": "MAIN" declared statically in a manifest.json
// content_scripts entry (confirmed directly from `xcrun safari-web-extension-converter`'s
// own build warning against a real Safari install, not just secondhand documentation).
// content.ts must run in the page's own JS realm to patch its real window.BattleTooltips
// — an isolated-world copy would silently patch nothing Showdown's own code ever calls.
// Safari 16.4+ does support world: "MAIN" through the dynamic registerContentScripts
// API instead (developer.apple.com/forums/thread/728849), so this background service
// worker registers it that way at startup. Chrome doesn't need this: its manifest.json
// keeps the static declarative entry, which Chrome already honors correctly.

interface ScriptingApi {
  scripting: {
    registerContentScripts(scripts: ContentScriptRegistration[]): Promise<void>;
    getRegisteredContentScripts(filter?: {ids?: string[]}): Promise<Array<{id: string}>>;
  };
}

interface ContentScriptRegistration {
  id: string;
  matches: string[];
  js: string[];
  runAt?: 'document_start' | 'document_end' | 'document_idle';
  world?: 'ISOLATED' | 'MAIN';
}

declare const browser: ScriptingApi | undefined;
declare const chrome: ScriptingApi | undefined;

const api = typeof browser !== 'undefined' ? browser : chrome;
const SCRIPT_ID = 'hi-chu-main-world';

// A MV3 background service worker restarts often (Safari/Chrome both tear it down
// between events), but a registration made in an earlier run of this same script
// persists — re-registering the same id unconditionally throws "Duplicate script ID".
async function ensureMainWorldContentScript(): Promise<void> {
  if (!api) return;
  const existing = await api.scripting.getRegisteredContentScripts({ids: [SCRIPT_ID]});
  if (existing.length > 0) return;
  await api.scripting.registerContentScripts([
    {
      id: SCRIPT_ID,
      matches: ['https://play.pokemonshowdown.com/*'],
      js: ['content.js'],
      runAt: 'document_idle',
      world: 'MAIN',
    },
  ]);
}

ensureMainWorldContentScript().catch((err: unknown) => {
  console.error('[hi-chu] failed to register MAIN-world content script', err);
});
