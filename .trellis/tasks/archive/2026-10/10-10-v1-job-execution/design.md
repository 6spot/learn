# T15 PDF 执行与事务结算设计

> 2026-10-11，D-044 自主开发；CloudBase 实际生命周期和组件配置在 T24 验收。

## 最小变更与所有权

T14 已完成共享内核复算、摘要比较及 GENERATING 交接，但只有注入执行器契约。新增 cloud-service execution/artifacts 模块及执行/真实 PDF 集成测试，扩展内部任务/候选记录和必要失败码。复用 T11 私有存储/awaited bridge、T13 结算、T12 引用释放；不修改 PDF/core/font/frontend 实现，不新增 SDK 组合（由主会话持有）。

## 接口与单次执行

`createGenerationExecutor({store,clock,crypto,storage,bridge,renderer},serviceConfig)` 返回 T14 的 GenerationExecutor。受控 renderer 接收 execution 与 `{maxOutputBytes}` 并返回完整 Uint8Array；组合层映射到 T09 的 `renderPdf(layout,provider,{maxBytes})`。PDF 只消费已有布局，不重新 shape/wrap。所有参数显式，renderer 自身硬上限与服务 maxPdfBytes 同时适用。

await bridge.invoke(execution,run)。run 首先事务核对可信 job/user/batch/registry/versions/pageCount/期限，使用持久 executionClaimed 标识只允许一个执行者渲染。重复回调不再次渲染或上传。bridge 明确 EXECUTION_NOT_STARTED 可失败释放；其他不确定异常不推断退款。

## 候选产物与核验

渲染在事务外；检查 Uint8Array、体积和 PDF 头尾基础信封。PDF 结构正确性来自可信 T09 renderer，服务不以头尾检查声称完整解析。渲染完计算预期 SHA-256，并在上传前事务写入唯一 job/batch 候选记录与 job.candidatePath：确定服务端路径、resolve(path) 文件号、bytes/hash/pageCount、createdAt 和状态 pending。只存元数据，不持久化正文/layout/布局摘要。

候选登记提交成功后才 await put。put ack 丢失仍用登记 fileId read 核对既有完整字节；read 失败/暂时不存在都不作为失败依据，保留状态。确定返回错误文件引用时保留可对账状态，运行适配层负责其已知异常上传清理。read 实际 bytes/hash 与登记值必须一致，且通过同一信封检查，才进入成功事务。

## 原子终态

成功事务重读 job/candidate，核对 GENERATING、当前 batch、未到 deadline、预留 pending、候选 pending 与 path/id/hash/bytes/pageCount 绑定；同时 SUCCEEDED、正式 file 引用/expiry、consume ledger、释放 preset 引用，并将 candidate 标记 committed。到期转 FAILED/释放；已终态保持原样，旧 batch 不得结算。成功事务异常保留产物，未知 commit ack 由 T14 重新读取终态；禁止无依据删除或退款。

已知渲染失败、无效/超限 PDF 及已核实上传内容损坏，事务失败/释放。renderer/upload 不在事务内。late upload 不能反转终态或重新扣次。

## 清理互斥与后续恢复

候选状态 pending/committed/deleting/deleted。内部 cleanupCandidate 先事务核对任务：成功正在引用此文件则禁止删除；同批非终态也禁止删除。仅失败、旧批或任务已不存在可 claim deleting。成功提交只接受 pending，故清理 claim 与成功事务互斥；存储删除后再标 deleted。删除响应丢失保持 deleting，可幂等重试。

late upload 完成后再次执行安全 cleanup，包括已经 deleted 的候选，防止先删后迟到上传残留。候选墓碑不能马上丢弃；T16 扫描需再次检查 deleting/deleted 记录，覆盖上传中进程终止窗口。T15 不新增自动重渲染或定时扫描；T16 仅凭候选元数据读取/验证/结算或超时释放。

## 验证

可控 renderer/storage/transaction/bridge 验证：双回调、渲染失败/超限、登记前失败不上传、上传 ack 丢失、read 失败保留、内容损坏、成功提交失败、提交 ack 丢失、deadline/旧批/失败竞争、清理与成功互斥、迟到上传二次清理、删除失败可重试、隐私与守恒。再接真实 T04+core+T09 四模板（含中文描红与拼音），核对私有 bytes、PDF 页数/A4、账本消费及重试不复算。
