# T17 记录与私有分块交付设计

> 2026-10-11；D-044 自主开发，正式存储权限/真机打开/参数配置留 T24。

## 边界与 API

新增 cloud-service records/history 模块，扩展 CloudService 四个方法及显式 fileAccess 配置；复用可信身份/任务/候选/存储端口，不新增未经验证 Range API，不改前端/组合/核心。已读 UI_DESIGN P05：按提交时间倒序且不展示私人标题/正文。

- listJobs({cursor?,limit?}) → {items:JobDetail[],nextCursor,serverTime}，limit 默认20/最多50。
- getJob(jobId) → JobDetail = JobSummary + delivery: not-ready|ready|expired|unavailable。
- getPdfInfo(jobId) → {jobId,bytes,sha256,pageCount,expiresAt,chunkBytes:262144}。
- readPdfChunk({jobId,offset}) → {jobId,offset,nextOffset,totalBytes,sha256,expiresAt,bytes:Uint8Array}。offset 从0开始且为256KiB倍数，小于总长；末块 nextOffset=null。组合层转base64，客户端组装后核对总长/hash。

## 列表索引与安全投影

runtime 当前仅有 ID 升序等值查询。admission 原事务新增 generation_history，ID 由固定宽度逆时间 + jobId 组成，值仅 {userId,jobId,createdAt}；时间相同按jobId稳定排序。列表按可信user过滤，游标域分隔 HMAC 绑定user和索引位置；cursor不替代授权。过滤过期/删除记录时有maxListScanRecords上限，短页仍返回nextCursor以明确续查，不冒充全量历史。

新任务索引原子创建；旧未部署开发数据需要一次可信回填（T23维护复用内部index原语），部署文档明确迁移要求，不默认为旧全量记录已有索引。每个历史项都重新读取真实job/请求binding，索引不能替代归属、可见期或逻辑删除校验。

JobSummary 增加实际安全枚举/时间/标识验证，防损坏metadata在状态或错误字段泄漏字符串；只输出原允许字段。终态记录到期隐藏；未完成任务保持可见。用户disabled/deleted拒绝，删除binding墓碑撤销访问。

## 文件授权与缓存

每次调用先取可信身份。只有SUCCEEDED、有效visible记录、未过fileExpiresAt、正式file引用与committed候选完全绑定时允许领取；候选文件不可访问。绑定显式核对候选主键/jobId/batchId/userId及路径/文件号/hash/大小/页数，不能仅因按正确数据库键读取便相信其内容属于当前任务。文件号、路径、fingerprint从不返回客户端。元数据查询不需要当前engine/resources受支持，也不增加消费。

fileAccess显式配置 {maxFileBytes,maxCacheBytes,cacheTtlMs,maxListScanRecords}，maxCacheBytes可0禁用。单个CloudService实例保存一个已完整核验的私有PDF副本，key绑定userId/job/batch/fileId/hash/bytes，TTL不越过fileExpiresAt，大小不超过maxCacheBytes；同文件并发冷读取合并。加载期间按key保留promise，不同文件交错不覆盖其他在途加载；finally检查同一promise再移除。新文件替换唯一缓存，不扩展为永久多文件缓存；并发不同文件的临时内存由最终平台并发/内存配置约束。缓存不是授权，T23先逻辑删除再物理清理可立即阻止后续块。

当前storage.read只有整文件能力，冷读取整份并核对exact length/SHA-256/PDF信封，再缓存。暖块不重复整文件读/哈希，返回防御复制的256KiB子数组。冷实例仍有完整文件I/O/内存开销，最终平台验证记录该限制，不声称Range已验证。

每块读/哈希之后事务再次校验active user、job归属/终态/逻辑删除/期限以及同一正式候选绑定，才返回字节。失效/删除/更换引用或未知存储错误安全拒绝，不改变已成功状态或退款。实际有效块领取在同一授权事务记录D049日活去重；metadata/轮询/无效块不计，重复领取不消费、不重渲染。

## 验证

列表倒序、同毫秒稳定分页、超过100记录、过滤短页、跨用户cursor/ID/文件标识、disabled/deleted、response metadata投影与malformed值。领取覆盖未知字段/accessor/异步修改、负数/NaN/浮点/非对齐/越界offset、跨用户、候选未提交、文件/记录过期、读期间撤销、完整hash/缺失/损坏、缓存TTL/大小/替换/同文件并发/防御复制与冷实例。真实大中文描红PDF全部块重组解析A4/页数/hash，确认下载不消费、不重排；存储直接访问权限属于T24真实配置门槛。
