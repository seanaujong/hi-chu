// A throwaway, self-hosted Pokémon Showdown server for `player-check`/`screenshots` to
// battle against, instead of hitting the real play.pokemonshowdown.com with real accounts.
//
// `noguestsecurity` (config/config-example.js) lets a client claim any name with a bare
// `/trn NAME` — no login server, no password, no per-IP login throttle. It's the mechanism
// server/README.md itself points to for exactly this kind of local/automated use, and it's
// what `showdown.mjs` logs both sides in with. The server is otherwise the real, unmodified
// simulator (same random-battle set generation, same protocol) — only auth is relaxed.
//
// The checkout lives in `.ps-server/` (gitignored), cloned and `npm install`ed once; each
// call here starts a fresh server process (no state persists between runs, so there's never
// a stale battle room to clean up).

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {execSync, spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const REPO_URL = 'https://github.com/smogon/pokemon-showdown.git';
const DIR = fileURLToPath(new URL('../../.ps-server/', import.meta.url));
const PORT = Number(process.env.PS_LOCAL_PORT ?? 8000);

function ensureCloned() {
  if (existsSync(`${DIR}/pokemon-showdown`)) return;
  console.log('· cloning smogon/pokemon-showdown for the local test server (one-time)…');
  mkdirSync(DIR, {recursive: true});
  execSync(`git clone --depth 1 ${REPO_URL} .`, {cwd: DIR, stdio: 'inherit'});
}

function ensureConfigured() {
  const configPath = `${DIR}/config/config.js`;
  if (existsSync(configPath)) return;
  const config = readFileSync(`${DIR}/config/config-example.js`, 'utf8')
    .replace('exports.noguestsecurity = false;', 'exports.noguestsecurity = true;')
    // The repl sockets are unix domain sockets under a path we don't control the length of,
    // and we have no use for interactive repl access on a throwaway test server anyway.
    .replace('exports.repl = true;', 'exports.repl = false;');
  writeFileSync(configPath, config);
}

function ensureInstalled() {
  if (existsSync(`${DIR}/node_modules`)) return;
  console.log('· npm install for the local test server (one-time)…');
  execSync('npm install --no-audit --no-fund', {cwd: DIR, stdio: 'inherit'});
}

/** Starts the server, resolving once it's actually accepting connections on `PORT`. */
export async function startLocalServer() {
  ensureCloned();
  ensureConfigured();
  ensureInstalled();

  const child = spawn('node', ['pokemon-showdown', 'start', String(PORT)], {
    cwd: DIR,
    detached: true, // its own process group, so `stop()` can kill the workers it forks too
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.pipe(process.stderr);

  await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => {
      child.stdout.off('data', onData);
      // It never printed ready, but it may well still be alive (a slow first-time build,
      // say) — killing it here is what keeps a timed-out attempt from squatting on the
      // port and turning every later run into a confusing EADDRINUSE failure.
      try {
        process.kill(-child.pid);
      } catch {}
      reject(new Error(`local Showdown server never became ready within 60s:\n${out}`));
    }, 60_000);
    const onExit = (code) => {
      clearTimeout(timer);
      reject(new Error(`local Showdown server exited early (code ${code}):\n${out}`));
    };
    const onData = (chunk) => {
      out += chunk;
      if (out.includes('Test your server at')) {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        child.off('exit', onExit);
        child.stdout.resume(); // keep draining so the pipe never backs up; we don't need the rest
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.once('exit', onExit);
  });

  console.log(`✓ local Showdown server ready on :${PORT}`);
  return {
    port: PORT,
    stop() {
      try {
        process.kill(-child.pid);
      } catch {} // already dead
    },
  };
}
