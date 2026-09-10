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

Both cases default to 10,000 modules and five measured builds per group, using development mode with caching and configurable optimizations disabled. Run commands from the repository root. Each case documents its configuration, validation, and results.

`versions/v1`, `versions/v2`, and `versions/local` select Rspack 1.7.11, 2.2.3, and the compiled checkout at `~/rstack/rspack`. The local link assumes this repository is at `~/projects/rspack-bench`; build the JS and native artifacts in the Rspack checkout before benchmarking changes.

Generated runs go to the ignored root `results/` directory. Selected recorded results are committed under the corresponding case's `results/` directory. Shared loader helpers live in `loaders/`.
