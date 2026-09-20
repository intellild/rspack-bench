import { realpathSync } from 'node:fs';

export const worktreeVersion = 'worktree-a77f';
export const worktreeRepository = realpathSync('/data00/home/jinzhixin/.codex/worktrees/a77f/rspack');
export const versions = ['v2-1-0', 'v2', worktreeVersion];
export const publishedVersions = { 'v2-1-0': '2.1.0', v2: '2.2.3' };
