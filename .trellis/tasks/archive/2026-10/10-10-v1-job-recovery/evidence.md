# T16 恢复与对账证据

2026-10-11。实现位于实际 cloud-service；恢复依赖只含 store/storage/clock/crypto。私有字节与账本操作使用 T11 内存端口，真实 CloudBase 调度与权限仍待最终配置。

## 本轮命令

| 命令 | 结果 |
|---|---|
| `npm --prefix packages/cloud-service test` | 96/96：T16 21（独立检查新增1项），已有 T15 22/T14 25/T13 17/T12 11；含 strict runtime/core/service 构建 |
| `npm --prefix packages/cloud-service run test:pdf` | 11/11，包含全部 T15 真实四模板/多页/体积限制，以及 T16 三页实际 PDF 恢复 |
| scope diff/new-file 空白、Markdown 文件引用/JSONL 目标与平台导入/日志扫描 | 通过；显式覆盖未跟踪的新文件 |

字体构建仍有已知上游重复 axisIndex key 警告，构建完成；本任务未修改字体依赖，也未据此声称真机能力。

## 行为覆盖

[21 项恢复测试](../../../../../packages/cloud-service/test/recovery.test.mjs) 验证：

- 已保存且未提交成功的候选，按 path/resolveId/hash/bytes/pageCount/batch 核验后原子补成功，重复扫描不增加渲染/上传/消费。
- 无候选 RESERVED/GENERATING 等期限；缺失、损坏、暂时不可读和单文件预算不足均不提前释放；已到期完整 PDF 也不复活任务。
- 读取期间到期或出现成功/失败竞争，由事务决定唯一终态；旧批、成功引用和当前批次的保护不受外部快照影响。
- 107 个任务按两种未完成状态跨多轮、7 条分页/13 条单轮限制全部收敛；新 ID 插入已过游标前会在下一周期处理。
- 记录、时间、预期字节预算分别耗尽时保存最后已处理位置，后续调用不跳过未读候选。时间软预算允许单条处理完成后超出 maxRunMs，但不再开始下一条。
- 并发扫描 revision CAS 阻止检查点回退；检查点事务失败幂等重扫、提交 ack 丢失继续已保存位置。
- 单条错误计数后继续处理其他任务，下一周期重试；列表异常不伪装扫描完成、不推进检查点。
- deleting/deleted 重扫覆盖删除后迟到 put；删除失败保留重试状态；损坏候选位置不能删除其他私有文件。
- 配置必须显式且复制冻结；未知检查点/非法任务号安全失败；报告只含安全状态/计数。独立检查修复损坏 status 字符串/对象回显，错误报告输出 status:null，额度和存储操作保持不变。

## 真实 PDF 补结算

[真实恢复集成](../../../../../packages/cloud-service/integration/recovery-pdf.test.mjs) 使用真实 MiSans Latin 原 TTF、shared core 与 T09 生成 40 段拼音，得到 **165,300 字节 / 3 个 A4 页面**。注入上传后成功事务中断，确认 GENERATING/pending 候选与原预留保留；移除故障后仅给恢复器 metadata/storage/clock/crypto，runSweep 补成功并一次消费。回读哈希相同，PDFDocument.load 页数为3，原 PDF 保留期沿用；反复恢复/同号重试均未增加 prepare/render/upload。所有持久元数据均不含正文或裸布局摘要。

## 边界与后续

- maxRunMs 是记录边界的软预算，控制是否开始下一条记录；已开始的单条处理继续完整 await，实际 I/O 可超过预算。部署期限须保留单条处理及检查点余量，未知超时下轮幂等恢复；expectedReadBytes 是登记大小预算，错误存储对象实际响应内存不是在此端口可提前截断的能力。
- 扫描计数是本次观察/操作尝试，不是 DAU/成功任务等去重统计；单条 recordErrors/retryableRecords 不被当成全部成功。
- 删除墓碑保留并重扫；T16 不删除指纹/可见记录/成功PDF，期限与墓碑 GC 由 T23 接入。
- 缺失任务但仍残留额度预留属于破坏元数据完整性的异常，恢复不凭孤立文件擅自退款；正常流程禁止删除未终态任务。应由受控数据修复处理，不能自动重渲染。
- 维护云函数/触发鉴权由主会话组合；真实触发可靠性、私有权限、运行时预算和 CloudBase 事务隔离在 T24 配置验收。真机/字体许可/实体打印不在本次通过声明内。
- 主会话委派的独立检查已完成，见 [check](check.md)；本代理未提交/归档。
