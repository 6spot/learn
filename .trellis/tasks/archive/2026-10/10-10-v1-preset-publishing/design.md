# T12 不可变预设注册与兼容查询

> 2026-10-10，本地完整机制开发；正式字体/实印/CloudBase 配置由 D-044 移交 T24，发布门槛不降低。

## 行为差距与责任

T03 提供 `TrustedPaperPreset` 验证，T13 提供可信身份；新增 cloud-service registry 模块将它们连接成真实业务 API。不修改纸张内核、字体资源或小程序文件，不建设 CMS。

## 记录和可信来源

- preset_versions：完整版本 tuple 的固定顺序 SHA-256 键，preset、通过云端字节校验的字体 descriptor、发布者和验收记录；只 create，不覆盖。
- preset_states：supported/retired/removed 与持有数；active_presets：每 template 唯一 active 指针；preset_uses：按云端 jobId 的持有/释放幂等标记。
- admin_audit_logs：发布/激活/退休/移除的安全操作审计，不含文章。

ResourceProvider 从可信部署配置提供现有 T04 清单 `{id,bytes,sha256,fontVersion}` 加 location，并提供云端原始字体字节。发布实际比较每个文件的长度和 SHA-256。字体 bundle 无远程执行代码或 metrics JS；度量算法跟随 engine 代码发布。元数据用于描述预设与字体，不含用户原文。

## API

- publishPreset(preset, acceptance?)：每次管理员鉴权；core 几何/字体分配校验；服务器已支持该 engine；校验服务器字节再 create 不可变记录。生产要求 preset 是 validated-release，并由已鉴权管理员明确 attestation(fontLicense/print/resources/evidenceId)。开发候选只在 development 服务允许。
- activatePreset(versions)：记录已存在、supported、资源仍可用，且服务端记录的客户端 engine 已发布；原子切换唯一 active 指针。不因切换而移除旧组合。
- getCompatibility({engineVersion,lockedVersions?})：返回 engineSupported、每模板当前唯一指针的 availability 以及已锁定组合 availability。状态 ready/update-required/retired/resource-unavailable/not-found；旧受支持编辑组合与当前新默认分别判断，不强迫旧编辑会话改用新预设。
- retirePreset(versions)：active 不可退休；退休后不能新持有/提交，但已有 job 持有仍可加载。removePreset 仅 retired 且 refs=0，删除预设载荷并留 tombstone/audit，不自动删除共享字体文件。

发布先于激活；云端 engine/资源支持先于发布；客户端 ready 配置先于切换新 engine 默认。客户端任何 stage/role/geometry 都不能改变这一顺序。

## 并发与在途

`retainPresetInTransaction` 与 T14 新任务同事务；校验 state=supported 并创建 job 级幂等使用标记、refs+1。`releasePresetInTransaction` 与 T15/T16 终态同事务，重复只释放一次。移除与持有共享 state 文档，因此不能与新任务竞争造成删除在用版本。资源文件保持部署方保留，registry 不提供无保护的字体物理删除接口。

## 实现文件与测试

修改 cloud-service contracts/config/service，新建 presets 模块及 registry 测试；包依赖 core 并构建其声明。T12 工件单独记录。验证不可覆盖/并发唯一 active、伪造几何/角色、资源缺失或 hash 漂移、生产验收缺失、cloud-first 顺序、旧会话、retire 和 retain/remove 竞争、重复释放与审计。
