# T12 执行清单

## 启动

- [x] 阅读任务工件、CLOUDBASE/ARCHITECTURE/PAPER_PRESETS/TESTING、T11 runtime spec 与实际 T03/T04 接口。
- [x] 与主会话确认 API、旧编辑会话兼容状态、资源 manifest 与版本持有方案。
- [x] 与核心/字体责任者协调 package exports 和已有资源字段，避免另建物理/字体规则。

## 开发交付

- [x] `publishPreset`：管理员每次鉴权，core 校验几何，读取可信部署字体字节并核对 hash/长度，版本只 create。
- [x] `activatePreset`：已云端发布、服务器支持、客户端 ready 与生产验收门槛通过后原子切换唯一 active。
- [x] `getCompatibility`：当前默认和请求锁定的旧组合分别给出 availability，不静默替换版式或字体。
- [x] `retirePreset/removePreset`：退休拒绝新持有；active/在途引用保护；移除留 tombstone/audit，不删除共享字体。
- [x] 内部 retain/release 使用 jobId 幂等标记，事务内 refs 检查，供 T14～T16 正式任务集成。
- [x] 模板和字体 manifest 返回显式字段，无远程 metrics JS，生产不接受开发候选 stage。
- [x] `npm --prefix packages/cloud-service test`：依赖严格编译，26/26 通过，其中本任务新增 11 项。
- [x] 文档引用、空白、平台依赖/日志检查；完成 [evidence.md](evidence.md)。
- [x] 独立检查通过，11 项预设测试；规范已沉淀，按 D-044 完成开发交付。

## AC 与最终验收

| 原验收 | 本次开发证据 | T24 最终验证 |
|---|---|---|
| T12-AC1 | 不可覆盖、唯一 active、伪造几何/身份拒绝、事务回滚 | 真实 CloudBase 权限和并发 |
| T12-AC2 | 按完整 tuple 注册、实际字节 hash 校验、cloud-first/client-ready 门槛、旧会话和退出状态 | 真实资源位置、两端兼容/T07 摘要 |
| T12-AC3 | 生产要求 validated-release + 当前管理员三项 acceptance/evidenceId；在途持有阻止移除 | 实际字体许可/实印与正式样张证据 |

T14～T16 需使用已实现的引用原语与任务事务组合；本任务不宣称已完成生成业务。正式配置与打印仍按 D-044 留给最后验收。
