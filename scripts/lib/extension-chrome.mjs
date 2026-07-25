// Launching the REAL extension — actually installed in the browser, not injected into the
// page — which until now we believed impossible from automation.
//
// The old assumption was that "Load unpacked" can't be automated because nothing can drive
// `chrome://extensions` plus the native file picker. That was the wrong obstacle: you never
// touch that UI, you pass `--load-extension` at launch. The REAL obstacle is that Chrome
// removed that switch from the branded build as an anti-malware measure — and kept it in
// Chrome for Testing, the build meant for exactly this.
//
// Measured 2026-07-25, driving play.pokemonshowdown.com and watching for the `#hichu-style`
// element `content.ts` injects once it has patched `BattleTooltips`:
//
//   Google Chrome 150        --load-extension ignored. 0 extension targets, no style
//                            element. Same in headful, new-headless, and with
//                            --disable-features=DisableLoadExtensionCommandLineSwitch.
//   Chrome for Testing 151   loads it. Style element present in BOTH headful and headless.
//
// So this module pins the browser rather than using whatever Chrome is installed. It also
// strips puppeteer's own `--disable-extensions`, which it adds by default and which silently
// beats `--load-extension` no matter which build you launch — a second red herring.
//
// Chrome for Testing downloads on first use into the gitignored `.chrome-for-testing/`
// (~150MB, a one-time cost), the same shape as `local-server.mjs` cloning the sim server.

import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {install, computeExecutablePath, resolveBuildId, detectBrowserPlatform, Browser} from '@puppeteer/browsers';

const CACHE = fileURLToPath(new URL('../../.chrome-for-testing/', import.meta.url));

/**
 * Path to a Chrome for Testing binary, downloading it if this is the first run.
 * `CHROME_FOR_TESTING_PATH` overrides, for a machine that already has one.
 */
export async function chromeForTesting() {
  if (process.env.CHROME_FOR_TESTING_PATH) return process.env.CHROME_FOR_TESTING_PATH;

  const platform = detectBrowserPlatform();
  const buildId = await resolveBuildId(Browser.CHROME, platform, 'stable');
  const executablePath = computeExecutablePath({browser: Browser.CHROME, buildId, cacheDir: CACHE});
  if (!existsSync(executablePath)) {
    console.log(`· downloading Chrome for Testing ${buildId} (one-time, ~150MB)…`);
    await install({browser: Browser.CHROME, buildId, cacheDir: CACHE});
  }
  return executablePath;
}

/**
 * Puppeteer launch options that install `extensionDir` as a real unpacked extension.
 *
 * `--disable-extensions-except` keeps the profile otherwise clean, so anything we observe
 * came from OUR extension and not from something the browser ships with. Merge these over
 * a caller's own options; `ignoreDefaultArgs` is the load-bearing part and is easy to drop
 * by accident when spreading.
 */
export async function extensionLaunchOpts(extensionDir, {args = []} = {}) {
  return {
    executablePath: await chromeForTesting(),
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, ...args],
  };
}
