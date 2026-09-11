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
| [Less loader overhead](cases/less-loader/README.md) | Published 2.2.3 versus worktree `0385`, with precompiled CSS versus less-loader | `pnpm bench:less-loader` |
| [splitChunks.name callback](cases/split-chunks-name/README.md) | 2.1.0, 2.2.3, and worktree `a77f`: static name versus callback and local workerFunction execution | `pnpm bench:split-chunks-name` |

All cases default to 10,000 modules and five measured builds per group, using development mode with caching and configurable optimizations disabled. Run commands from the repository root. Each case documents its configuration, validation, and results.

`versions/v1`, `versions/v2`, and `versions/local` select Rspack 1.7.11, 2.2.3, and the compiled checkout at `~/rstack/rspack`. The local link assumes this repository is at `~/projects/rspack-bench`; build the JS and native artifacts in the Rspack checkout before benchmarking changes.

Generated runs go to the ignored root `results/` directory. Selected recorded results are committed under the corresponding case's `results/` directory. Shared loader helpers live in `loaders/`.

`versions/worktree-0385` links the noop, Babel, and Less loader cases to `/data00/home/jinzhixin/.codex/worktrees/0385/rspack/packages/rspack` and uses its existing compiled JS and native artifacts.
