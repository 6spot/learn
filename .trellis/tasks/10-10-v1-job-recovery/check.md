# T16 独立检查

日期：2026-10-11。范围：恢复器、候选关联校验、分页/预算/检查点和验证证据；未改动前端、渲染器或云函数组合。

## Findings (fixed)

- File: `packages/cloud-service/src/recovery.ts`、`test/recovery.test.mjs`
  - Issue: 任务读取后即保存在局部变量，状态校验失败的 catch 仍返回原始 job.status；损坏元数据中的任意字符串或对象会进入声明为安全的 RecoveryJobResult。
  - Fix: 状态输出使用固定 allowlist，不合法值返回 null；新增字符串/对象/数值/null 回归，确认原值不回显，不渲染、读取、删除或结算额度。
- File: `packages/cloud-service/src/contracts.ts`、README、任务 design/evidence 和时间预算测试
  - Issue: 说明声称每个 await 边界检查时间，实际仅在记录边界决定是否继续，单条处理可跨多个 I/O 超过 maxRunMs。
  - Fix: 主会话按 D-044 确认记录边界软预算；同步类型注释及文档，明确完整等待已开始的单条处理、部署期限保留余量、未知超时下轮恢复。测试明确断言 5 ms 预算允许已开始的 6 ms 记录完成，下一条继续保留。

## Findings (not fixed)

无遗留的本任务局部实现缺陷。实际路径核对：

- 恢复依赖没有 renderer/preparer；暂时缺失、损坏或 I/O 错误不提前释放，只有可信 deadline 或已验证候选的事务结算推进终态。
- deadline、当前批次、预留及候选状态在事务内重读；回读期间发生超时/竞争终态不会使失败任务复活。
- 候选固定 job/batch 路径、存储 resolveId 和记录主键共同校验；损坏关联不能用于删除其他私有文件。
- 三相查询按 ID 续接；107 条任务跨调用完成。字节预算不足不越过未读任务；单条故障计数并下一周期重试，列表失败不保存虚假进度。
- revision CAS 阻止并发检查点回退；已删除墓碑持续重扫迟到 put，成功引用与同批在途文件受保护。

后续边界：

- `.trellis/spec/backend/` 新恢复契约、安全状态投影和软预算规则由主会话同步，避免并发改动规范。
- 维护入口鉴权与触发器组合归主会话；真实 CloudBase 权限、定时可靠性、事务隔离及平台资源限制仍归 T24，当前测试不证明这些能力。
- 成功 PDF/记录/指纹/候选墓碑期限清理由 T23 实现；本任务不自动修复缺失任务造成的孤立预留，也不自动重渲染。
- 已有上游 Fontkit axisIndex 重复键警告仍出现但构建成功，第三方依赖不在本次修改范围。

## Verification

- Lint：未配置独立命令；作用域 diff --check、文本尾空白、本地链接/JSONL 目标与业务源码平台导入/日志扫描通过。
- TypeCheck：通过，测试命令包含 strict runtime/core/service 编译。
- Tests：`npm --prefix packages/cloud-service test` **96/96**（T16 21、T15 22、T14 25、T13 17、T12 11）。
- Integration：`npm --prefix packages/cloud-service run test:pdf` **11/11**，含真实三页 PDF 无正文恢复；165,300 字节、三页与原候选哈希一致，重试不增加渲染/上传。
- 未提交或归档。
