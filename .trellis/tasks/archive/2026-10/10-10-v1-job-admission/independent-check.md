# T14 独立检查

日期：2026-10-11。检查范围：cloud-service 请求签名、参数快照、幂等重放、原子任务受理、状态与额度边界，以及必要的 cloud-runtime JSON 快照修复。

## Findings (fixed)

1. `packages/cloud-runtime/src/validation.ts`：数组分支检查自身字段，但未限制原型。继承的 `toJSON` 能在 `JSON.stringify` 时被执行，并将无效 body 数组替换为字符串，绕过后续原始输入类型检查。现在只接受标准数组原型，在序列化前拒绝该输入；runtime 测试证明钩子未调用、事务未写入、普通嵌套数组仍可复制，service 测试证明没有产生任务或执行。
2. `packages/cloud-service/src/requests.ts`、`jobs.ts`：分别依赖 `Object.hasOwn` 和 `String.replaceAll`，会妨碍在缺少这些 API 的微信模拟宿主中组合服务。替换为 `Object.prototype.hasOwnProperty.call` 和全局正则替换；新增禁用这两个 API 的完整受理、日活、查询及重放回归。

相应回归位于 `packages/cloud-runtime/test/runtime.test.mjs` 与 `packages/cloud-service/test/admission.test.mjs`。README、任务清单及 evidence 同步测试数量。

## Findings (not fixed)

没有遗留的本任务局部实现缺陷。以下为已明确分工的后续集成验收，不据此声称完成：

- T15：当前受理测试执行器为合成 fixture，真实 PDF 编码、候选产物持久化、大小约束和成功结算仍由 T15 接入。
- T16/T23：期限恢复、清理/墓碑及密钥退役由对应任务实现，不能用 T14 本地元数据测试代替。
- T24：CloudBase 隔离和调用生命周期、真实组件配置、真机及打印仍需最终实测。本轮未运行 DevTools 或部署组件。
- `.trellis/spec/` 的 T14 新 API/受理契约与安全快照规则由主会话在集成时同步，避免并发修改同一规范文件。

## Verification

- Lint：未配置独立 lint 命令；作用域 `git diff --check`、新文件尾空白/引用和业务源代码平台/日志扫描通过。
- TypeCheck：通过，两包测试命令包含 strict TypeScript 构建。
- Tests：`npm --prefix packages/cloud-service test` 53/53（受理 25、身份额度 17、预设 11）；`npm --prefix packages/cloud-runtime test` 26/26。
- 本轮未改动 paper-core、原生页面、PDF renderer 或其他任务文件；未提交或归档。
