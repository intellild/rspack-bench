import { realpathSync } from 'node:fs';

export const worktreeVersion = 'worktree-bec7';
export const worktreeRepository = realpathSync('/data00/home/jinzhixin/.codex/worktrees/bec7/rspack');
export const versions = ['v2-2-6', worktreeVersion];
export const publishedVersions = { 'v2-2-6': '2.2.6' };
