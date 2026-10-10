# T23 云函数组合独立检查（2026-10-11）

## Findings (fixed)

- File: `cloudfunctions/learn-service/test/maintenance.test.mjs`
  - Issue: 原实际组合测试覆盖成功路径，未验证恢复提交期间的等待，以及恢复/清理失败时是否仍声称成功。
  - Fix: 复用 SDK 形状内存事务夹具，增加恢复检查点延迟和分阶段失败的2项集成测试；验证顺序、await、跳过后续阶段、已完成检查点保留及固定安全错误。生产实现无需修改。
- File: `cloudfunctions/learn-service/test/composition.test.mjs`
  - Issue: 新生产 stats/lifecycle 必填段已有缺段测试，字段级缺失/空值尚无组合层证据。
  - Fix: 增加完整 production 正例及逐字段 undefined/null 反例的1项测试，确认两级配置校验不能以空段绕过。生产实现无需修改。
- File: `cloudfunctions/learn-service/test/client-flow.test.mjs`
  - Issue: 实际大 PDF 删除流程原只检查用户/删除状态行，未直接断言对象移除和全部个人关联清除。
  - Fix: 补充正式 fileId 撤销、私有存储 NOT_FOUND、有限清理后快照无旧 userId 断言。

## Findings (not fixed)

- 未发现本次云函数组合源码缺陷；配置、RPC allowlist、可信身份及完整等待的实现与合同一致。
- 本轮按分工使用现有构建产物，未重建云函数 bundle；最终源码打包证据由 root 汇总。未接触小程序构建/全局 typecheck/release/DevTools，原生客户端和隐私 UI 由其他 reviewer 负责。
- 真实 CloudBase 权限、管理/定时调用、安全规则、历史窗口与迟到 I/O 上限、保留期限、资源/成本告警仍交最终 Owner 配置验收。

## Verification

- Lint: 未配置独立 lint 命令；涉及 MJS 的 `node --check` 和 `git diff --check` 均通过。
- TypeCheck: 本轮未新增或修改 TS，按 root 要求未运行全局 typecheck；依赖后端构建已在本任务 backend-check 的166+15检查中通过，本次直接使用该产物。
- Tests: `node --test cloudfunctions/learn-service/test/*.test.mjs` **22/22**。日志 `/tmp/learn-t23-composition-check.log`。
- 实际 >18MB PDF/原生下载/RPC 删除/有限 GC/重新建账/旧请求拒绝通过；实际维护组合使用 SDK 形状的内存元数据适配器，未访问生产平台或发送外部通知。
