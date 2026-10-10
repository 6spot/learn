# Learn（项目代号）

面向中国大陆家长、学生与老师的微信小程序。首个工具是**学习纸张生成**：选择模板、填写或留空、预览纸张，导出可直接打印的 PDF。首版优先 PDF，DOCX 仅作为后续可选扩展。

项目**正式名称未定**；`learn` 是仓库名，并非已确定的小程序品牌名。

## 当前状态

**产品设计基线已经确认，开发持续进行中。** 已有原生模拟器诊断宿主、共享排版契约、真实字体度量、云端运行适配及可信账户/预设机制；纸张渲染与完整生成流程按 [当前检查点](docs/ROADMAP.md#当前开发检查点2026-10-11) 推进。已有模块测试与模拟器结果不等于完整产品、真实 CloudBase 或打印验收通过。

**交给开发者时，先阅读 [开发交接说明](docs/DEVELOPMENT_HANDOFF.md) 与 [AGENTS.md](AGENTS.md)**，再进入下列权威文档：

- [产品范围与交互](docs/PRODUCT.md)
- [系统架构与模块边界](docs/ARCHITECTURE.md)
- [纸张模板与排版引擎](docs/PAPER_ENGINE.md)
- [首版正式纸张规格（四种 A4 模板）](docs/PAPER_PRESETS.md)
- [CloudBase 接入与部署](docs/CLOUDBASE.md)
- [数据、生成任务与次数](docs/DATA_AND_CREDITS.md)
- [测试与验收](docs/TESTING.md)
- [已确定和待讨论决策](docs/DECISIONS.md)
- [实施计划](docs/ROADMAP.md)
- [开发交接与待验收项](docs/DEVELOPMENT_HANDOFF.md)

## 技术方向

微信原生小程序（TypeScript）＋与小程序关联的腾讯云开发 CloudBase；无自建服务器、无 EdgeOne。小程序本地预览，可信云函数处理生成任务、额度及文件交付。设计上把**通用账户/权益/统计**与**纸张工具**分开，以便将来增加其他工具，但不提前建设插件平台。

本阶段不开发 AI/OCR，不决定正式产品名、次数包定价与广告奖励额度。
