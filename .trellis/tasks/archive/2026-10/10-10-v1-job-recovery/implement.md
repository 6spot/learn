# T16 执行清单

## 启动与设计

- [x] 已读 PRD、权威文档、T11/T14/T15 spec 及实际实现，检查并保留其他 worker 修改。
- [x] `task.py start .trellis/tasks/10-10-v1-job-recovery` 激活独立任务。
- [x] 细化 [design](design.md)：无 renderer 维护端口、关联核验、可信超时、三相分页、检查点 CAS、预算及安全报告；主会话接受接口。
- [x] 使用已独立检查并归档的 T15 执行/候选/账本原语，未新增 runtime/SDK 功能。

## 开发交付

- [x] `createRecoveryService`、安全 `recoverJob`、内部持续 `runSweep` 与五项显式配置。
- [x] 已有候选完整性/路径/批次核验；有效期限补成功；缺失/损坏/瞬态 read 与预算不足不误退款。
- [x] RESERVED/GENERATING 可信 deadline 事务释放；终态不反转。
- [x] 三相分页、revision 检查点与失败续接；107 条任务跨轮遍历、游标之前新 ID 下一轮处理。
- [x] deleting/deleted 重扫，旧批/孤立产物清理；成功引用和同批在途保护，损坏关联拒绝删除。
- [x] 真实三页 PDF 在上传后结算中断，恢复器无输入/字体/渲染器能力仍补成功，调用次数不增长。

## 验收与验证

- [x] T16-AC1：恢复依赖无 preparer/renderer，只有 metadata/storage/clock/crypto；不保存/提取正文重做。
- [x] T16-AC2：有效候选可补成功；期限/批次/终态事务复核；缺失/损坏/超预算不提前释放。
- [x] T16-AC3：重复/并发恢复幂等；成功和清理互斥；删除响应失败/迟到 put 通过重扫收敛。
- [x] `npm --prefix packages/cloud-service test`：96/96，恢复21项（独立检查新增1项），包含 strict 编译。
- [x] `npm --prefix packages/cloud-service run test:pdf`：11/11，新增真实三页恢复1项，包含字体/PDF/core/service 构建。
- [x] 检查作用域差异/新文件尾空白、Markdown/manifest 引用与源码平台导入/日志；README/evidence 同步。
- [x] 主会话委派的独立检查完成，修复损坏状态回显并冻结记录边界软预算，见 [check](check.md)；规范同步、完成/提交/归档由主会话处理。

## 最终外部验收

实际定时器连续触发、客户端 invoke 禁止、CloudBase 并发/存储一致性、触发超时及参数设置归 T24；已验证开发任务不等待这些配置，但未将其写成通过。成功 PDF/记录/请求期限清理和墓碑 GC 归 T23。
