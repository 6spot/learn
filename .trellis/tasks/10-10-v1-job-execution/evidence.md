# T15 生成执行与结算证据

2026-10-11。本任务实际实现 cloud-service 执行器与候选产物/事务结算；PDF 来自真实 T09，不是 fixture 冒充正式文件。存储和事务验证使用 T11 内存端口，尚未部署真实 CloudBase。

## 实际验证

| 命令 | 结果 |
|---|---|
| `npm --prefix packages/cloud-service test` | 75/75：T15 22，已有 T14 25/T13 17/T12 11；包含 runtime/core/service strict 构建；独立检查新增 claim 响应丢失回归后重跑 |
| `npm --prefix packages/cloud-service run test:pdf` | 独立检查完整重跑 10/10，构建实际字体/PDF/服务；真实原 TTF + shared core + PDF + 实际执行器，内存私有存储/事务 |
| 作用域 diff、新旧文本空白、Markdown 本地引用、JSONL 目标、平台导入/console 扫描 | 通过（包含未跟踪新增文件） |

字体构建提示上游 Fontkit 重复 axisIndex key 警告，构建成功；本任务不修改第三方依赖或字体实现。没有把警告隐藏或当成真机验证。

## 真实 PDF 集成

所有 PDF 在私有存储回读后比较精确 bytes/SHA-256，再使用 PDFDocument.load 解析并检查每页 210×297 mm、页数与 shared layout/任务一致；重试不增加 prepare/render，成功余额只减少一次。

| 模板/输入 | 本次文件字节 | 页数 |
|---|---:|---:|
| 作文空白 / 中文文字 | 1,607 / 5,517,403 | 各 1 |
| 田字空白 / 带标题中文描红 | 4,281 / 18,411,841 | 各 1 |
| 米字空白 / 带标题中文描红 | 6,405 / 18,413,980 | 各 1 |
| 拼音空白 / 调号、NFD 组合、描红 | 1,738 / 162,134 | 各 1 |
| 拼音 40 段 | 165,300 | 3 |

另有真实 PDF 1 MB 上限失败回归，结果 PDF_RESOURCE_LIMIT、FAILED、额度释放、零上传，无 partial bytes。此处字节为本次固定测试样例，不是产品固定大小；64 MiB 为测试显式上限，生产值由最终配置提供。

测试：[真实 PDF 集成](../../../packages/cloud-service/integration/execution-pdf.test.mjs)。

## 22 项服务故障测试

- 候选路径/resolveId/expected hash/bytes/pages 在上传前持久化；回读后一次成功/消费/引用释放，重复 callback/同号重试不再渲染。
- 渲染错误、部分字节、超限和资源不匹配安全失败；没有正文/错误原始内容落库或回显。
- bridge pre-start 失败释放，响应丢失恢复终态；未开始的重复 bridge 不取消另一个 claimant。
- 执行 claim 事务已经提交但响应丢失时，不渲染或上传；重复 callback/请求保持同一 pending 任务，云端期限失败后只释放一次。
- 候选登记失败与登记 ack 丢失均不上传；已有元数据可按期限收敛。
- 上传 ack 丢失通过确定路径核验；上传失败/临时 read 失败保留预留，不误退款；错误引用不盲删其他文件。
- 已保存 bytes 被损坏则失败/释放并清理本候选；上传后成功事务失败保留 PDF，可只凭元数据核验并成功。
- 成功事务 ack 丢失返回已知终态，不误删；非终态却已结算 reservation 明确拒绝。
- render/upload 中 deadline 到达、旧 batch、竞争失败、成功/失败双顺序竞态只允许一次终态。
- 同批有效候选和成功引用禁止清理；失败后先清理再迟到上传会重复安全删除；删除失败保留 deleting 供重试。

测试：[执行故障矩阵](../../../packages/cloud-service/test/execution.test.mjs)。合成 PDF fixture 仅用于故障调度，真实 PDF 验证独立执行。

## 剩余边界

- T16 接 metadata-only 扫描与超时收敛：必须重扫删除墓碑覆盖 late put，不调用 renderer，不保存正文供重试。
- T17 接可信归属校验和私有分块领取；当前 JobSummary 不含 fileId/URL。
- 实际 CloudBase 并发隔离、断连后调用生命周期、可靠 resolve/path 映射、存储读写一致性/权限、内存/超时以及限额配置留到 T24。
- 字体许可、真机打开与实体打印由 Owner 最终验收；本次 PDF 解析成功和模拟事务不证明这些门槛通过。
- 主会话委派的独立检查已完成，见 [check](check.md)；检查未发现需修改执行源码的缺陷，补齐 1 项故障回归；本代理未提交/归档。
