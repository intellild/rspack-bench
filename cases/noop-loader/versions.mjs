import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const worktreeVersion = 'worktree-0385';
// Resolve the checkout selected by the workspace dependency link.
export const worktreeRepository = path.resolve(realpathSync(fileURLToPath(
  new URL(`../../versions/${worktreeVersion}/node_modules/@rspack/core`, import.meta.url))), '../..');
