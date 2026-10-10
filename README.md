# Learn（项目代号）

面向中国大陆家长、学生与老师的微信小程序。首个工具是**学习纸张生成**：选择模板、填写或留空、预览纸张，导出可直接打印的 PDF。首版优先 PDF，DOCX 仅作为后续可选扩展。

项目**正式名称未定**；`learn` 是仓库名，并非已确定的小程序品牌名。

## 当前状态

处于设计与技术验证前阶段。仓库当前以文档沉淀为主；下列文件是开发讨论基线，未经过实际实现的内容均应视为待验证。

- [产品范围与交互](docs/PRODUCT.md)
- [系统架构与模块边界](docs/ARCHITECTURE.md)
- [纸张模板与排版引擎](docs/PAPER_ENGINE.md)
- [首版正式纸张规格（四种 A4 模板）](docs/PAPER_PRESETS.md)
- [CloudBase 接入与部署](docs/CLOUDBASE.md)
- [数据、生成任务与次数](docs/DATA_AND_CREDITS.md)
- [测试与验收](docs/TESTING.md)
- [已确定和待讨论决策](docs/DECISIONS.md)
- [讨论顺序](docs/ROADMAP.md)

## 技术方向

微信原生小程序（TypeScript）＋与小程序关联的腾讯云开发 CloudBase；无自建服务器、无 EdgeOne。小程序本地预览，可信云函数处理生成任务、额度及文件交付。设计上把**通用账户/权益/统计**与**纸张工具**分开，以便将来增加其他工具，但不提前建设插件平台。

本阶段不开发 AI/OCR，不决定正式产品名、次数包定价与广告奖励额度。