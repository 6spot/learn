# T17 记录与私有分块交付证据

2026-10-11。实现位于实际 cloud-service，使用真实T09 PDF与T11内存存储/事务；未部署真实CloudBase权限或完成真机打开。

## 本轮命令

| 命令 | 结果 |
|---|---|
| `npm --prefix packages/cloud-service test` | 119/119：T17共23（独立检查新增2），已有T16 21/T15 22/T14 25/T13 17/T12 11；含strict runtime/core/service编译 |
| `npm --prefix packages/cloud-service run test:pdf` | 13/13：全部真实四模板/多页/恢复，加T17大中文描红与多页拼音分块领取 |
| `node --test packages/cloud-service/integration/records-pdf.test.mjs` | 最后授权边界调整后再跑2/2，实际71块/三页完整领取通过 |
| scoped diff、新旧文件空白/Markdown/JSONL目标、源码平台/console扫描 | 通过，包含未跟踪新增文件 |

字体构建仍提示既有Fontkit重复axisIndex key，构建完成。本任务未修改renderer、字体、runtime或主会话云函数组合。

## 23项行为覆盖

[records.test.mjs](../../../packages/cloud-service/test/records.test.mjs) 验证：

- history索引与请求/额度在同一事务，失败全部回滚；时间倒序、同毫秒稳定排序、103条多页无重复/遗漏。
- 过期/墓碑过滤后有界短页和nextCursor续查；旧记录缺索引须明确幂等回填，不隐藏在无界全表扫描里。
- 只返回允许的JobDetail/PdfInfo字段，metadata/轮询不新增活跃事实；异常status/error/template不回显原始字符串。
- 跨用户任务号、绑定其他用户的cursor、原始fileId和管理员身份均不能越权；缺可信身份、disabled/deleted拒绝。
- 字节固定256KiB、offset对齐/安全整数/界限检查、未知授权/长度字段和getters拒绝，参数在await前快照。
- 完整字节长度/SHA-256一致，重复读取/重组不消费或重排；有效PDF读取的日活与同日生成去重。
- 冷读完整核验，同文件并发合并，单文件容量/TTL/替换/冷实例行为可验证；调用者修改返回块不损坏cache。跨用户A/B/A交错读取只进行两次完整read，越权A访问在读前拒绝，返回字节不串。
- 候选未提交、文件/记录过期、逻辑删除、缺失/损坏/引用错配/超上限拒绝；成功终态保持不变。把另一合法候选复制到当前任务查询键，即使正式引用同时错配，仍因候选主键/job/batch不匹配而在存储read前拒绝。
- 字节读取期间用户删除、墓碑、expiry或正式引用改变，最终事务复查拒绝；缓存不绕过撤销。
- 不依赖当前生成registry/engine/resources/executor也能读取已成功历史。

## 真实完整文件领取

[records-pdf.test.mjs](../../../packages/cloud-service/integration/records-pdf.test.mjs)：

| 输入 | 完整字节 | 分块 | PDF解析 |
|---|---:|---:|---|
| 带标题田字中文描红，真实MiSans+LXGW完整TTF | 18,411,605 | 71 | 1个A4页 |
| 40段拼音，真实MiSans Latin | 165,148 | 1 | 3个A4页 |

逐块按offset拼接，核对总长/完整SHA-256、与后端原字节精确一致，再PDFDocument.load检查A4/页数。每个暖实例均只增加一次整文件read，prepare/render次数不变，余额仅生成成功时减1。测试使用真实PDF，没有用合成字节冒充解析证据。

## 交付与后续

- ServiceDependencies新增storage、ServiceConfig新增fileAccess四项显式参数；组合层将Uint8Array转base64。前端收到稳定API/nextCursor短页语义。
- generation_history仅含userId/jobId/createdAt。T17之前的数据需一次可信indexJobInTransaction回填；生产首次部署无旧数据，已有开发/升级环境不得未回填就宣称完整历史。T23负责全量维护入口与索引GC。
- T23必须先逻辑撤销授权再物理删除；每块检查账户、binding.deleted及有效期，cache不会延长访问。缓存TTL是复用上限，在后续访问惰性丢弃。
- 当前存储端口只有整文件read。冷实例仍需读取/核验整份PDF；暖实例仅缓存一份有TTL的文件，在途promise按包含userId的key合并、完成即删除。不同文件并发临时内存仍受平台并发/内存配置约束，CloudBase实际函数内存、响应限制、延时/费用留最终实测。
- 真实存储禁止客户端直连、函数权限、域名/配置及微信打开/保存/分享归T24，模拟权限失败不等于真实平台规则通过。
- 主会话委派的独立检查已完成，见 [check](check.md)；本代理未提交/归档。
