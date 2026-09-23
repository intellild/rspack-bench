# Rspack benchmarks

Independent benchmark cases share pinned dependencies and Rspack versions through a pnpm workspace.

Requires Node.js 22.12.0 or later and pnpm 10.12.4.

```bash
pnpm install --frozen-lockfile
```

| Case | Description | Run |
|---|---|---|
| [React / CSS Modules](cases/react-css/README.md) | Dependent React components with CSS/Less Modules; native, extraction, and mixed builtin/JS loader pipelines | `pnpm bench` |
| [NormalModule loader hook](cases/loader-hook/README.md) | Published 2.2.3 versus local, with an empty loader hook enabled/disabled and one noop JS loader | `pnpm bench:loader-hook` |
| [Noop JS loader overhead](cases/noop-loader/README.md) | Published 2.2.3 versus worktree `0385`, with no loader versus one noop JS loader | `pnpm bench:noop-loader` |
| [Babel loader overhead](cases/babel-loader/README.md) | Published 2.2.3 versus worktree `0385`, with no loader versus Babel parsing and code generation | `pnpm bench:babel-loader` |
| [Mixed JS loader chain](cases/mixed-loader-chain/README.md) | Three noop JS loaders: main/worker/main versus all main and all worker, on 2.1.0, 2.2.3 and local a77f | `pnpm bench:mixed-loader-chain` |
| [Parallel Babel + CSS extraction](cases/babel-css-extract/README.md) | 10,000 large JS files + 10,000 CSS Modules, parallel Babel and main-thread CSS extraction; native queue/bridge overhead diagnostics | `pnpm bench:babel-css-extract` |
| [Babel large files](cases/babel-loader-large-files/README.md) | 2.2.6 versus current MPMC branch; 10,000 modules × 1,200+ lines, parallel Babel with optional main controls, cold/full rebuilds | `pnpm bench:babel-loader-large-files` |
| [Babel parallel / loader cache](cases/babel-loader-parallel-cache/README.md) | 2.1.0, 2.2.3, and worktree `a77f`: parallel/cache on/off, cold builds and full rebuilds | `pnpm bench:babel-loader-parallel-cache` |
| [Less loader overhead](cases/less-loader/README.md) | Published 2.2.3 versus worktree `0385`, with precompiled CSS versus less-loader | `pnpm bench:less-loader` |
| [splitChunks.name callback](cases/split-chunks-name/README.md) | 2.1.0, 2.2.3, and worktree `a77f`: static name versus callback and local workerFunction execution | `pnpm bench:split-chunks-name` |

All cases default to 10,000 modules and five measured samples per group, using development mode with configurable optimizations disabled. The large-file Babel case generates 1,200+ lines per module. Cache-focused cases enable only the cache layer under test. Run commands from the repository root. Each case documents its configuration, validation, and results.

`versions/v1`, `versions/v2`, and `versions/local` select Rspack 1.7.11, 2.2.3, and the compiled checkout at `~/rstack/rspack`. The local link assumes this repository is at `~/projects/rspack-bench`; build the JS and native artifacts in the Rspack checkout before benchmarking changes.

Generated runs go to the ignored root `results/` directory. Selected recorded results are committed under the corresponding case's `results/` directory. Shared loader helpers live in `loaders/`.

`versions/worktree-0385` links the noop, Babel, and Less loader cases to `~/.codex/worktrees/0385/rspack/packages/rspack` and uses its existing compiled JS and native artifacts.

## Publishing results

Local runs in ignored `results/` retain paths needed by diagnostics and resume.
After copying selected results into `cases/<case>/results/`, run:

```bash
pnpm privacy:fix
pnpm privacy:check
```

These commands require Python 3 and inspect all tracked and non-ignored untracked
files, including gzip payloads and tar members/ownership metadata. Home directory
prefixes become `~`; possible credentials and unsupported binary files require
manual inspection. The check fails if any supported personal path remains.
Review other identifying information before publishing; this is a path and common
credential check, not a general personal-information detector.

Recorded hashes remain fingerprints of the original benchmark inputs/outputs.
Sanitized snapshots can differ from those original bytes and are evidence, not
runnable copies of the original machine's paths. Existing Git history is unchanged.

Worktree cases resolve their checkout through the installed `@rspack/core` link
in `versions/worktree-*`. The relative dependency links assume the same
`~/projects/rspack-bench` and `~/.codex/worktrees/<id>/rspack` layout; adjust the
links and regenerate the lockfile when using a different layout. No username or
absolute home directory is required in the manifests or benchmark scripts.
