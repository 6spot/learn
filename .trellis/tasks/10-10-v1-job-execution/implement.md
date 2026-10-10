# T15 执行清单

## 设计与依赖

- [x] 读取 PRD/design、T11/T12/T13/T14 spec、权威文档及工作区状态；保留其他 worker 改动。
- [x] 细化执行 claim、候选登记/核验、成功事务、清理互斥及故障矩阵；主会话收到设计后实施。
- [x] 与 T09 明确真实 `renderPdf(layout,provider,{maxBytes})`，云端端口以 maxOutputBytes 传入。
- [x] 复用 T14 真实 shared preparer、T11 awaited bridge/private storage、T13 ledger、T12 引用计数。

## 实现

- [x] 实际 GenerationExecutor：每任务/批次一次持久 claim、等待渲染、候选登记、上传及完整回读核验。
- [x] 候选 job/batch/path/resolveId/expected hash/bytes/pages 上传前落库；正文和 layout 仅本次内存。
- [x] 文件可交付 + 有效 batch/deadline/pending reservation 同事务成功/消费/引用释放；失败原子释放。
- [x] 删除 claim 与成功结算互斥；成功引用保护；迟到上传重复清理和删除失败重试状态。
- [x] 真实 T04/core/T09 四模板空白/文字、三页拼音与真实超限失败接入同一服务。

## 验收映射

- [x] T15-AC1：沿用 T14 云端共享复算和实际摘要复核，真实 PDF 集成页数保持一致；超限失败不消费。
- [x] T15-AC2 本地：awaited bridge/执行器全程等待；不存在响应返回后的未等待异步执行；pre-start/响应丢失与重复 callback 通过。
- [x] T15-AC3：22 项故障/终态测试覆盖原子成功/失败、执行 claim/上传后提交失败、提交 ack 丢失、期限/旧 batch、清理竞争；真实 PDF 可解析并与回读字节一致。
- [ ] T15-AC2 平台最终验收：实际 CloudBase invocation/disconnect、组件配置、内存/超时按 D-044 留到 T24，不以模拟器代替。

## 本轮验证

- [x] `npm --prefix packages/cloud-service test`：75/75，含 strict TypeScript 构建；T15 22（独立检查新增 1）。
- [x] `npm --prefix packages/cloud-service run test:pdf`：独立检查完整重跑通过 10/10，含三页拼音与真实字体/PDF 构建。
- [x] scoped diff/new-file 空白、Markdown 本地引用/manifest 检查；源码无平台导入/console/raw error 日志。
- [x] 包 README 与 evidence 写清真实 PDF、模拟存储/事务及最终平台边界。
- [x] 主会话委派的独立检查已完成，见 [check](check.md)；状态、规范同步、提交与归档由主会话处理。

恢复扫描/期限收敛由 T16 接内部产物原语，私有领取由 T17 接；未实现项目未伪装成通过。
