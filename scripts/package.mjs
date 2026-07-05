// Build a clean release zip of the unpacked extension: `npm run package`.
// Produces hi-chu-<version>.zip from a fresh dist/ — this is the artifact users
// "Load unpacked" (unzipped) and the exact bytes a Chrome Web Store upload wants.
import {execSync} from 'node:child_process';
import {createRequire} from 'node:module';

const {version} = createRequire(import.meta.url)('../package.json');
const out = `hi-chu-${version}.zip`;

execSync('npm run build', {stdio: 'inherit'});
// Zip the CONTENTS of dist/ (so the archive has manifest.json at its root, not dist/).
execSync(`rm -f "${out}" && cd dist && zip -qr "../${out}" . -x '*.DS_Store' && cd ..`, {
  stdio: 'inherit',
  shell: '/bin/bash',
});
console.log(`packaged → ${out}`);
