# T16 无正文恢复与可续接扫描设计

> 2026-10-11。D-044 自主开发；真实定时触发器、平台时限和 CloudBase 读写一致性在 T24。

## 变更边界

T15 已登记可恢复候选并保证结算/清理互斥，但没有自动扫描与超时收敛。新增 cloud-service recovery.ts、配置/公开维护类型和测试；复用 artifacts/jobs/credits 原语，不改渲染器、字体、前端或云函数组合。候选 path/id/resolve 验证抽为 artifacts 共享 helper，供执行和恢复使用。没有正文队列、后台自动重渲染或一般化调度框架。

## 维护接口

`createRecoveryService({store,storage,clock,crypto}, recoveryConfig)` 返回 `recoverJob(jobId)` 与 `runSweep()`。依赖类型没有 renderer/preparer/resources/identity；这是仅可信维护入口持有的后端能力，普通用户/管理员 RPC 都不自动获得它。主会话拥有维护云函数与触发鉴权。

显式配置 `{pageSize,maxRecordsPerRun,maxRunMs,maxCandidateBytes,maxReadBytesPerRun}`：pageSize 1..100、maxRecordsPerRun 1..1000；时间与字节是正安全整数，单次预计字节预算不得小于单候选上限。无生产默认值。`maxRunMs` 为记录边界的软预算，控制是否开始下一条记录；已经开始的单条恢复/清理继续完整 await，然后保存检查点，不取消半截结算。实际 I/O 可超过软预算，部署函数期限须额外保留单条处理与检查点余量；未知超时由下轮幂等恢复。字节预算按已登记的预期大小预留，不声称限制未知错误对象的实际返回分配。

## 单任务恢复

重新读 job，终态不反转。达到可信 deadline 时在事务重读 batch/status/deadline 后 FAILED/release；未到期的 RESERVED 或无候选 GENERATING 继续 pending。候选必须符合固定 job/batch 路径、resolveId、原 bytes/hash/pageCount 和任务关联，且为 pending，才允许在预算内 read/核验；valid 时复用 T15 settleCandidate 重新验证当前期限/批次并结算。

临时不存在、读失败、无效/不完整文件或预算不足都不作为退款依据；恢复没有证明渲染已中断的特殊能力，保守等待期限。已有完整文件仅在有效未终态批次可补成功，超时不因有 PDF 而复活。recoverJob 返回安全状态/处理结果和固定原因，无文件 ID/正文/指纹。

## 扫描与检查点

runSweep 内部分三相：generation_jobs RESERVED → GENERATING → 全部 pdf_candidates。前两相用等值索引+ID游标，候选相包含 committed/deleting/deleted，从而覆盖孤立记录和删除后迟到 put。

固定 `maintenance_cursors/recovery_v1` 保存 schemaVersion/revision/phase/afterId。每轮在记录数、时间、预期字节预算内顺序 await；按最后已处理 ID 续接。单条错误计数并继续，下一完整周期重试，不让坏记录永远阻塞后面的任务；列表/检查点整体故障明确失败，不伪造完整扫描。到末相末尾后 cycleComplete=true，游标回到起点；扫描期间插入到已过游标前的随机 ID 会在下一周期处理。

检查点最终事务比较起始 revision 后递增写入，避免并发回退与 ABA；失去比较的调用返回 checkpointSaved=false/实际游标。并发同扫或崩溃重扫允许重复核验，所有状态/账本效果由现有幂等事务保证，不新增租约依赖。

## 清理与报告

候选相先验证确定路径/关联，再复用 cleanupCandidate；成功引用和同批非终态受保护，失败/旧批/缺任务可 claim deleting 并 await remove。deleted 墓碑也反复清理，覆盖迟到 put。T16 不删除候选墓碑/成功 PDF/请求指纹；各项期限 GC 归 T23。

返回计数、startedAt/finishedAt、cycleComplete/checkpointSaved/nextCursor 与预期读取预算使用量；计数是本轮观察/尝试，不能当去重运营事件。存储删除失败、单条元数据异常均报告 retryable/error 计数，原始异常不回显。

## 验证

使用 T15 实际执行器制造无候选中断、上传已完成但结算失败、ack 丢失和 late put，再用 recovery 单独依赖恢复，断言 renderer 调用次数不增长。验证 RESERVED/GENERATING deadline、缺文件/损坏/瞬态错误不误退款、到期已有 PDF 不复活、旧批隔离、成功保护、deleted 重扫、重复/并发调度、超过100条分页、跨调用检查点、崩溃重扫、CAS竞争、三种预算和安全报告。真实多页 PDF 另接补结算集成，不以 fixture 替代全部链路。
