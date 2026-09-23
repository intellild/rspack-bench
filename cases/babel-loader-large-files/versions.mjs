import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const worktreeVersion = 'worktree-bec7';
// Resolve the checkout selected by the workspace dependency link.
export const worktreeRepository = path.resolve(realpathSync(fileURLToPath(
  new URL(`../../versions/${worktreeVersion}/node_modules/@rspack/core`, import.meta.url))), '../..');
export const versions = ['v2-2-6', worktreeVersion];
export const publishedVersions = { 'v2-2-6': '2.2.6' };
