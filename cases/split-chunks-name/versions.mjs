import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const worktreeVersion = 'worktree-a77f';
// Resolve the checkout selected by the workspace dependency link.
export const worktreeRepository = path.resolve(realpathSync(fileURLToPath(
  new URL(`../../versions/${worktreeVersion}/node_modules/@rspack/core`, import.meta.url))), '../..');
export const versions = ['v2-1-0', 'v2', worktreeVersion];
export const publishedVersions = { 'v2-1-0': '2.1.0', v2: '2.2.3' };
