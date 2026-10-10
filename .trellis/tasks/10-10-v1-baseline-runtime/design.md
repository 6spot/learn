# T01 设计边界

> 状态：2026-10-10 执行前设计已核对；本轮落实阶段 A，目标设备与云环境实测交给最终 Owner 验收。

## 责任与依赖

packages/paper-core、构建配置、合成回归样例。

前置交付：无，可优先推进。

## 实现边界

1. 复跑现有测试并记录环境、依赖和结果。
2. 整理覆盖矩阵与合成回归输入；检查现有构建配置。
3. 验证运行时兼容，对缺口提出最小兼容方案并复测。

### 本轮具体方案

- 行为缺口：现有代码只能通过 paper-core 内 Node 测试运行，未提供原生宿主或两端同源构建；模块顶层创建 Intl.Segmenter 导致不支持该能力的环境连空白几何都无法载入。
- 根目录使用 TypeScript 严格检查、esbuild 固定版本打包、Node 内置 test runner。小程序编译为 ES2017/CommonJS，云侧模拟目标 Node 20/CommonJS；这只是语法/构建目标，不代表平台正式支持声明。
- 同一 `packages/paper-core/src/index.ts` 分别生成 `dist/runtime/{miniapp,cloud}/paper-core.cjs`，同一合成 smoke 模块生成两个目标报告入口。生产包不允许引入 Node 平台依赖或动态下载代码。
- `packages/runtime-smoke` 负责能力探测、公开合成输入和不含正文的检查汇总；固定模拟字宽只用于回归，不充当正式字体资源。完整布局仅供测试比较，不写日志。
- `miniprogram/pages/runtime/index` 为开发诊断页，用原生 view/text/button 展示能力、合成检查和资源尚未接入的提示；不冒充 P01～P08，不提供生成业务。
- 使用独立 Node VM 加载生成的两端 CommonJS，禁止 eval/new Function 和 WebAssembly，移除 Array.at、Intl.Segmenter 或 Unicode 属性正则能力，验证可载入、完整输出一致或明确拒绝文字。VM 是能力模拟，不替代真机。
- 核心只把 Segmenter 改为文字布局时惰性创建，缺失时明确错误；末格读取改为索引以移除 Array.at 依赖。保留已有分词/布局/物理规格，不引入不等价的降级分词。
- 预期文件：根 package/lock/tsconfig/build/project.config（可复现工程入口），runtime-smoke 源码及测试（双端证据），miniprogram 最小宿主/类型（T08/T18 接口），layout.ts 极小兼容修改（避免顶层崩溃）。不改字体文件、真实云编排及正式页面。

## 跨层约束

- 纯 TS 排版拥有文字占位、换行、分页；Canvas/PDF 仅绘制；云端编排拥有鉴权、额度和任务结算。
- 物理规格取自 PAPER_PRESETS，文字/字体取自 PAPER_ENGINE，兼容性取自 ARCHITECTURE，任务信任规则取自 DATA_AND_CREDITS；本任务不另建权威副本。
- 平台实际能力、资源版本与生成交付须有证据；Mock、配置草案和预备字体不得标为上线验收通过。

## 兼容、发布与回退

只在责任模块内推进，保留已有行为及基准。涉及排版时发布新的受支持组合，保留在途任务所需旧资源；涉及云端状态时不得以代码回退反转成功/失败终态或直接改写账本。具体部署/回退步骤随选定方案补充后再执行。

## 待验证

微信开发者工具与真机未具备时，兼容性不能标记通过。

## 依据

- [ARCHITECTURE](../../../docs/ARCHITECTURE.md)
- [PAPER_ENGINE](../../../docs/PAPER_ENGINE.md)
- [TESTING](../../../docs/TESTING.md)

## 跨任务接口归属

提供最小原生验证宿主与共享源码两端构建入口、可复现命令和缺失资源提示。正式 P01～P03 页面由 T18 负责，真实云环境部署由 T11 负责，不能把宿主误报为产品可用。 阶段输入见 [执行清单](implement.md)。
