# T23 后端独立检查（2026-10-11）

## Findings (fixed)

- File: `packages/cloud-service/src/admission.ts`
  - Issue: 查询尚未提交的有效请求号时，只在入口验证账户。若读取请求或验签期间用户删除账户，原实现仍返回 null，与删除后立即撤销查询能力的合同不一致。
  - Fix: 空结果也在最终只读事务复查账户/删除状态及窗口到期；窗口、既有任务和空查询复用同一内部状态检查。新增竞态测试先复现 Missing expected rejection，再通过；不建任务或预留。
- File: `packages/cloud-service/src/lifecycle-records.ts`
  - Issue: 终态任务的历史索引已缺失时，deletedRecords 仍固定计算该索引，实际删除2条却报告3条。
  - Fix: 同一清理事务先读取历史索引，只统计存在的任务、索引及预设引用。新增失败任务/缺失索引回归先复现3≠2，再验证删除2条且再次清理为空结果。

## Findings (not fixed)

- 本次后端范围内未留下已复现的代码缺陷。
- 原生删除页、本地清空、RPC/维护组合由 root 另行集成验证。本次未改前端、root scripts、cloudfunctions 或主文档。
- 生产期限、历史最大签窗、迟到 I/O 上限、CloudBase 定时器/权限/成本告警、手机本地文件清理、字体许可和实体打印仍为最终外部验收，不以模拟测试替代。

## Verification

- Lint: 包未配置独立 lint 命令；`git diff --check -- packages/cloud-service .trellis/tasks/10-10-v1-privacy-retention` 与两份新增 MJS 的 `node --check` 均通过。
- TypeCheck: pass；两套测试命令包含严格 TypeScript 构建，覆盖 cloud-runtime/paper-core/cloud-service，真实 PDF 套件另构建 font-metrics/pdf-renderer。
- Tests: `npm --prefix packages/cloud-service test` **166/166**；`npm --prefix packages/cloud-service run test:pdf` **15/15**。服务日志 `/tmp/learn-t23-backend-check.log`，PDF 日志 `/tmp/learn-t23-backend-pdf-check.log`。
- 已沿实际事务核对立即撤销、迟到写入围栏、已受理任务结算、保留预留/桶、未知删除重试、有限候选墓碑、重新建账与旧请求拒绝、个人依赖最终清理、coverage 同事务及安全遥测。真实字体/PDF 生成与私有测试存储删除通过；未运行真实 CloudBase 或真机。
- root 已补充 `.trellis/spec/backend/privacy-lifecycle.md` 及索引；已核对专题描述与本次实际代码路径一致。
