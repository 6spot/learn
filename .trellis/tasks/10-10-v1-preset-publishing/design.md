# T12 设计边界

> 状态：任务拆解阶段的设计基线。具体库、接口字段或平台参数未在本文件中假定已定稿；执行前按实测补齐。

## 责任与依赖

CloudBase 预设配置、兼容查询及最小发布工具。

前置交付：[T07 实现排版版本与摘要协议](../10-10-v1-layout-versions/prd.md)、[T11 CloudBase 环境与可靠执行验证](../10-10-v1-cloudbase-feasibility/prd.md)

## 实现边界

1. 定义最小预设/支持组合记录及访问边界。
2. 实现读取、校验与受控发布，不建设 CMS。
3. 验证 active 切换、旧客户端、进行中任务和回滚场景。

## 跨层约束

- 纯 TS 排版拥有文字占位、换行、分页；Canvas/PDF 仅绘制；云端编排拥有鉴权、额度和任务结算。
- 物理规格取自 PAPER_PRESETS，文字/字体取自 PAPER_ENGINE，兼容性取自 ARCHITECTURE，任务信任规则取自 DATA_AND_CREDITS；本任务不另建权威副本。
- 平台实际能力、资源版本与生成交付须有证据；Mock、配置草案和预备字体不得标为上线验收通过。

## 兼容、发布与回退

只在责任模块内推进，保留已有行为及基准。涉及排版时发布新的受支持组合，保留在途任务所需旧资源；涉及云端状态时不得以代码回退反转成功/失败终态或直接改写账本。具体部署/回退步骤随选定方案补充后再执行。

## 待验证

可先完成机制；正式 active 发布额外依赖 T10，不形成 T10 的前置循环。

## 依据

- [CLOUDBASE](../../../docs/CLOUDBASE.md)
- [ARCHITECTURE](../../../docs/ARCHITECTURE.md)
- [PAPER_PRESETS](../../../docs/PAPER_PRESETS.md)
- [TESTING](../../../docs/TESTING.md)
