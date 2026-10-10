# T22 后端独立检查（2026-10-11）

范围：`packages/cloud-service` 统计扫描、日期、覆盖标记、配置/类型/服务接入、下载首块活动与相关回归。本次未评审原生运营页面或 root 所有的 RPC/部署组合，没有提交或归档任务。

## Findings (fixed)

- File: `packages/cloud-service/src/admission.ts`
  - Issue: D-049 要求可信新生成受理即计日活；实现此前在 RESERVED → GENERATING 才写活动。实际重现 preparation 失败得到 FAILED=1、DAU=0；准备跨上海午夜会将活动归入执行开始日。
  - Fix: 主会话确认 D-049 口径并扩展局部所有权后，将活动写入首次新任务/预留事务，删除 GENERATING 阶段的活动写入。回滚不留活动，已受理的准备失败保留活动，跨日完成和旧请求重试不新增次日事件。
- File: `packages/cloud-service/test/stats.test.mjs`, `test/admission.test.mjs`
  - Issue: 原有测试没有覆盖准备跨日，两个既有断言固化了旧的执行开始口径。
  - Fix: 新增 3 项统计回归，涵盖准备仍在等待时已计受理日、跨午夜完成及重试、准备失败及次日重试、受理事务回滚；更新两个旧断言，并将 daily_activity 纳入已有原子回滚检查。
- File: `packages/cloud-service/README.md` 与本任务设计/执行/证据
  - Fix: 同步实际事件时点及检查后的测试数量，不更改 D-049 本身。

## Findings (not fixed)

- 本次后端代码范围内没有尚未修复的问题。
- `.trellis/spec/backend/job-admission.md` 尚需明确受理同事务的 D-049 活动事实；统计扫描、预算、coverage revision/floors/gaps 也应进入后端 spec。已交主会话同步，未越权修改其规范文件。
- 原生运营界面和 root 的 RPC/CloudClient/部署配置不在本次独立检查范围；它们仍须相应集成验证，T22 不得据此整体归档。
- PDF 验证会输出已有第三方字体 bundle 的 `axisIndex` 重复键 warning；未触及其依赖或生成代码，构建及 13 项测试均完成。真实 CloudBase 索引/权限/预算/告警、真实组件配置和实机打印继续留 T24。

## Verification

- Lint: 本包和根均无配置 lint 脚本；`node --check` 两个修改的 MJS 测试、`git diff --check` 范围检查通过。
- TypeCheck: pass；两次最终测试入口均编译 cloud-runtime、paper-core 和严格 TypeScript cloud-service。
- Tests: pass；`npm --prefix packages/cloud-service test` **139/139**，其中 T22 **20 项**；`npm --prefix packages/cloud-service run test:pdf` **13/13**。
- 复核了完整 ID 分页与一条预算探测、日期起止/统计截止、四来源独立 coverage/null、并发覆盖 revision 拒绝、结束前管理员复查/安全审计、错误不回显原始记录、PDF 后续块跨日不建活动。
- generatedAt 仍是观察截止，非跨集合数据库快照；软预算在扫描页/记录边界检查，不取消已发出的 I/O。上述限制已在接口说明中披露。

初次修复后回归出现的 2 个失败均为上述旧活动断言（实际 1、期望 0）；按已确认口径更新后全量通过。未将模拟事务/私有存储或真实字体 PDF 构建等同于正式平台验收。
