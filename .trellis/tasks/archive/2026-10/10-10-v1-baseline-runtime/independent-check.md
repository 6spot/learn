# T01/T02/T11 独立质量检查

日期：2026-10-10。本轮只修复运行层本地 JSON 校验及建立开发者工具自动化；没有修改纸张物理规格、核心/T03 或字体二进制，也没有提交代码。

## 修复

- `packages/cloud-runtime/src/validation.ts`：旧校验直接读取 getter，且忽略非枚举 `toJSON` 与数组额外字段，可能在校验后悄然改变或丢失持久化元数据。现在先检查属性描述符，拒绝访问器、隐藏字段和非标准数组字段；回归证明这些钩子不执行且事务无写入。
- `scripts/test-devtools.mjs` 与根 `test:devtools`：持久化实际官方自动化验证；检查合成诊断数据、原生按钮重算和应用异常，等待异步页面刷新；默认选择空闲端口以支持重复运行，保留 IDE 打开。

## 实际验证

| 命令 | 结果 |
|---|---|
| 根 `npm test` | 严格 TypeScript + core 38/38、runtime 12/12、cloud 25/25 通过；core 包含并行 T03 变更，本检查没有编辑核心 |
| `npm run test:devtools` | 见本任务 [evidence.md](evidence.md) 的实际模拟器版本与检查结果 |
| `node --check scripts/test-devtools.mjs`、`node --check cloudfunctions/runtime-example/index.mjs` | 通过 |
| `python3 -m unittest discover -s assets/fonts/tools -p 'test_*.py'` | 13/13 通过 |
| 字体 `verify --hashes-only --archives` | 7 项锁定资源大小/散列与两个 ZIP CRC 通过 |
| 固定 fontTools 完整 `verify --archives` | 按预期 exit 1，MiSans 两个字体的 `U+01F8` 缺口仍明确拒绝；生成报告与已保存 coverage 字节一致 |
| HarfBuzz shaping probe | 通过；新报告与已保存 shaping-probe 字节一致 |
| `git diff --check`（责任范围） | 通过 |

仓库没有独立 lint 命令；运行了已配置的严格类型检查、脚本语法检查与差异空白检查，没有将未配置 lint 写成已执行。

## 未修复/最终验收边界

没有发现需要越权修改的代码问题。CloudBase SDK 返回结构、真实事务冲突重试、存储最小权限及客户端断开后的生命周期仍是 T24 平台验收；合成故障夹具不替代正式 T13～T17 业务状态机。MiSans 具体分发/子集许可、字体实际跨端绘制、真机和打印仍由原任务清单承接。严格 cmap 缺口是已披露的候选资源限制，不放宽允许表或静默替换字体。

规范建议交主会话：将运行层 JSON 只允许稳定的数据属性、SDK 异常安全码、上传前候选路径登记、官方模拟器命令与真实平台证据边界写入对应 backend/frontend spec。当前 backend spec 仍是 bootstrap 占位，审查以权威 docs 和任务设计为依据。
