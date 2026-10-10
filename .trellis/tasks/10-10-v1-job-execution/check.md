# T15 独立检查

日期：2026-10-11。范围：cloud-service 执行权登记、候选文件、成功/失败原子结算、清理互斥与真实 PDF 集成。未改动 PDF/core/font、前端或 CloudBase 组合层。

## Findings (fixed)

- File: `packages/cloud-service/test/execution.test.mjs`
  - Issue: 缺少执行 claim 已提交但响应丢失的回归；候选登记和成功提交的响应丢失测试不能覆盖这一更早的故障点。
  - Fix: 注入 claim 提交后异常，确认任务保留 GENERATING/预留，重复 callback/同号请求不再次 prepare/render/upload，期限失败后只释放一次，零候选/文件。
- File: 任务 `implement.md`、`evidence.md`、JSONL 清单与 service README
  - Issue: 检查数量及“独立检查待执行”状态需要更新，awaited 执行说明有歧义。
  - Fix: 同步 service 75/T15 22、完整真实 PDF 10 项复验和检查状态，明确无响应返回后的未等待异步执行。

## Findings (not fixed)

未发现需要修改 T15 生产源码的本地缺陷。实际路径核对结果：

- 候选 job/batch/path/fileId/bytes/hash/pages 在上传前持久化；登记确认失败不会开始上传。
- 上传、读取和数据库提交的未知结果不会直接释放额度；已知 PDF 损坏或可信期限才可失败。执行器不在事务中渲染/上传，也不保存原文/layout。
- 成功事务重新核对当前任务、期限、候选绑定和 pending 预留，同时完成终态/消费/引用释放；失败或旧 batch 不能被迟到文件复活。
- 清理事务保护同批未终态与成功文件引用；候选 deleting 与成功所需 pending 互斥。删除后迟到上传会再次安全删除，墓碑必须由 T16 继续扫描。

边界与后续责任：

- `.trellis/spec/backend/` 的 T15 新执行/产物规则和索引由主会话在集成时同步，避免与其他任务并发编辑。
- T16 扫描和 T17 私有领取不属于本次实现；测试中的手动恢复调用不代表扫描器已完成。
- Fontkit 构建出现已有的重复 `axisIndex` key 警告；构建成功。第三方字体依赖不属于本检查修改范围。
- 内存事务/存储及 PDF 解析不证明真实 CloudBase 隔离、断连生命周期、权限、组件参数、字体许可、真机打开或实体打印；这些仍归 T24 最终验收。

## Verification

- Lint：未配置独立 lint 命令；作用域 `git diff --check`、新旧文件尾空白/本地引用/JSONL 目标和平台导入/日志扫描通过。
- TypeCheck：通过；`npm --prefix packages/cloud-service test` 包含 runtime/core/service strict TypeScript 构建。
- Tests：service **75/75**（T15 22 + T14 25 + T13 17 + T12 11）。
- Integration：完整 `npm --prefix packages/cloud-service run test:pdf` **10/10**，含四模板 blank/text、三页拼音和真实体积超限失败；字节数与 evidence 样例一致。
- 未提交或归档。
