import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const availableVersions = ['v1', 'v2', 'local'];
export const publishedVersions = { v1: '1.7.11', v2: '2.2.3' };
export const localRepository = () => realpathSync(path.join(os.homedir(), 'rstack/rspack'));

export function validateCore(version, req) {
  assert(availableVersions.includes(version), `Unknown Rspack version: ${version}`);
  const manifest = req('@rspack/core/package.json');
  if (version === 'local') {
    assert.equal(realpathSync(req.resolve('@rspack/core')),
      realpathSync(path.join(localRepository(), 'packages/rspack/dist/index.js')),
      'Local group must load the compiled core from ~/rstack/rspack');
  } else {
    assert.equal(manifest.version, publishedVersions[version]);
  }
  return manifest.version;
}
