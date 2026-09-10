# Rspack Less / CSS loader benchmark

比较 `@rspack/core@1.7.11` 与 `@rspack/core@2.2.3` 的 Less 编译、原生 CSS 和提取 CSS 路径。
固定 `zx@8.8.5`；两个版本分别安装在 `versions/v1`、`versions/v2`，各有独立的 `package-lock.json`。
补充对照统一使用 `css-loader@7.1.5` 和各版本自带的 `CssExtractRspackPlugin`。
默认生成 `.less` 文件，固定 `less-loader@13.0.0` 和 `less@4.9.1`（要求 Node >= 22.11.0）。
这两个依赖也安装在各自独立的版本目录中，实际加载路径和版本记录在每个原始 JSON 中。

```bash
npm ci
npm ci --prefix versions/v1
npm ci --prefix versions/v2
npx zx bench.mjs --modules 10000 --runs 5
# 包含全部 Less 提取和分层对照
npx zx bench.mjs --styles less --modules 10000 --runs 5 --supplement always
# 重跑原来的纯 CSS 实验
npx zx bench.mjs --styles css --modules 10000 --runs 5
```

已安装依赖后，入口不需要网络。使用同一 Node 可执行文件启动每个构建进程。
执行 `npm run smoke` 可用 24 个 Less 文件、每组一次测量，验证全部主对照、提取 CSS 和分层拓扑路径。
`npm run smoke:css` 检查原来的纯 CSS 路径。
`--supplement always` 强制执行所有补充对照，`--supplement never` 仅运行主要四组，默认 `auto`。
仅接受正整数 `--modules`、`--runs`；默认值为 10000 和 5。
`--styles less|css` 默认 `less`。每个 Less 文件包含变量、带参数的 mixin、嵌套选择器和运算，
展开后与原来的 CSS 文件具有相同的三条规则、每条三个声明。没有 `@import`、图片或字体。

```less
@base: #123456;
@hover: #654321;
@gap: 1px;
.dimensions(@size) { display: block; width: @size; height: @size; }
.bench_0 {
  color: @base; margin: 0; padding: @gap;
  &:hover { color: @hover; margin: @gap; padding: 0; }
  > span { .dimensions((5px * 2)); }
}
```

```text
bench.mjs
  生成 fixture/index.js，静态导入同一份 styles/*.less
  每个文件唯一类名，含变量、mixin、嵌套、运算
       ↓
run-build.mjs（四组各自的新 Node 进程）
  native: less-loader → 原生 CSS
  noop:   less-loader → noop → 原生 CSS
  验证 Less 编译次数、CSS 模块数及每条展开后的 CSS 声明
       ↓
各组一次预热 → 交错串行测量五轮
  正式轮次不安装逐模块计数 hooks，不修改 noop loader
       ↓
results/<session>/report.md + summary.json + raw/*.json
  Less + 原生 CSS 的 v2/v1 → 追加 noop 的成本 → 两版额外成本之差
       ↓
less-loader → css-loader → CssExtractRspackPlugin
  验证 importModule 调用，单独预热、测量、报告
       ↓
仍未达到判定时：topology/index → sections → groups → 同一份 Less
  默认 10 个 section、100 个 group，各 group 引用相同的前 100 个 Less
```

所有构建固定 development、无 devtool、无缓存、无 watch、无增量、无压缩、相同 target 和输出选项。
显式关闭全部 `optimization` 布尔开关，包括 development 默认开启的 `providedExports`、
`removeEmptyChunks`、`mergeDuplicateChunks`，以及导出使用分析、内联、改名、innerGraph、
模块合并、分包、runtime 提取、内容哈希优化、入口 IIFE 优化和 NODE_ENV 替换。
1.x 另外关闭其支持的 `removeAvailableModules`。模块和 chunk 使用基础顺序 ID（`natural`）；
ID 分配是生成可运行 bundle 所必需的步骤。构建前断言 `compiler.options.optimization` 中
除 ID 策略和空 minimizer 列表之外的所有值均为 `false`，并将实际配置写入原始 JSON 的 `effectiveConfig`。
这是关闭公开配置控制的优化；Rspack 内部没有开关的解析、构图实现仍按各版本执行。
原生两组显式 `type: "css"`，相同 generator；1.x 开启 `experiments.css`。
Less 模式的所有组都接入 `less-loader`，没有“不使用 loader 的 Less”组。
原生两组的差值仅代表在 Less 后追加 noop 的成本，不代表 less-loader 本身的成本。
提取组使用 `type: "javascript/auto"`，配置数组按右到左执行，Less 位于数组末尾。
固定 `implementation` 为版本目录内的 Less CommonJS 入口，关闭 sourceMap 和 JavaScript 求值，
保持 webpackImporter 开启。[less-loader 官方选项](https://github.com/webpack/less-loader#options)
1.x 设置 `experiments.incremental: false`、`experiments.parallelLoader: false`；
2.x 设置顶层 `incremental: false`，每个 loader 设置 `parallel: false`。
版本相关位置已对照安装包类型声明及[官方迁移文档](https://www.rspack.dev/guide/migration/rspack_1.x)。
不清空 OS 文件缓存；这是无 Rspack 缓存的新进程构建，不代表磁盘完全冷缓存。

构建总耗时用 `process.hrtime.bigint()`，从 `compiler.run()` 调用前到回调开始。
编译器创建和关闭、stats 序列化、输出哈希检查都在构建计时外。
共享 hooks 的区间为：make→finishMake、finishMake→seal、seal→afterSeal、emit→afterEmit。
其中 `finishMake` 区间包括后续模块图收尾；这些是可比较的 hooks 区间，并非 Rust 内部函数的独占耗时。
进程时间由父进程从直接 spawn Node 到子进程退出测量，包含依赖加载、编译器准备/关闭、stats 和 JSON I/O。
依赖安装、生成 fixture 和创建独立输出目录在计时前完成。

每个 session 保留所有验证、预热、正式轮次的原始 JSON、详细 stats、输出文件和日志。
`report.md` 给出主要指标的中位数、最小值、最大值及差值；`summary.json` 同时保留各指标全部样本。
`metadata.json` 保存脚本与 lockfile 哈希，`fixture.json` 保存全部输入文件的哈希。
验证轮次分别计数 less-loader 调用、Less `render` 调用和唯一被编译的文件，均必须等于 `--modules`。
同时验证变量值、mixin 展开、三个 selector 及其全部声明，确保不是把未编译的 Less 当成 CSS 输出。
正式轮次不安装这些计数包装。各版本 native/noop 的 CSS 必须字节一致，所有正式输出必须匹配验证输出。
`results/latest.txt` 指向最后一次成功完成的 session，失败运行不会更新它。

自动补充判定预先固定为：任一主组的 v2 构建中位数至少慢 10%，且 v2 最小值大于 v1 最大值，才算“明显退化”。
Less 模式的 `auto` 总会执行平铺提取组，以覆盖 `importModule` 路径；若该组未达到判定，再执行分层组。
CSS 模式的 `auto` 沿用主组未达到判定后再追加提取组的流程。
这只用于决定是否继续补充实验，不是统计显著性检验。负的 loader 差值可能来自噪声或流水线变化。
没有复现的结论仅适用于这里的 fixture、拓扑、配置和机器，不能否定真实项目中的退化。

运行会重新生成本项目的 `fixture/`，输出只写入新建的 session 目录。
`.bench-running/` 防止两个实例同时改写 fixture；若异常中断残留，先确认其 `owner.json` 对应进程已经结束，再删除该目录。
