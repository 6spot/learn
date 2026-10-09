# AGENTS.md

本仓库是微信小程序学习工具项目（暂称 Learn）的设计与开发仓库。

## 开发时必须遵守

1. 先读对应文档，再修改实现；不要根据 README 猜测业务规则。
2. **已确定**的决策遵循 [docs/DECISIONS.md](docs/DECISIONS.md)；**待讨论/待验证**不得擅自当成需求。
3. 不主动引入 AI/OCR、自建服务器、EdgeOne、独立 Web 管理后台、微服务框架和通用插件框架。
4. 通用业务能力与纸张工具分开；纸张排版核心不依赖微信 API、CloudBase 或具体渲染器。
5. 用户身份、管理员权限、付费/广告额度、扣次和文件访问必须由可信云端校验，不能信任客户端参数。
6. 默认不持久化用户输入的作文正文，不在日志中记录正文和敏感凭据。
7. 每次涉及纸张版式的改变，都需要更新布局基准测试，并验证打印效果；不能拿截图嵌入 DOCX 冒充可编辑 Word。
8. 目前处于设计阶段；没有经过实验的 API、库兼容性、字体授权及平台能力，标明待验证，不得写成已实现。

## 文档导航

- [PRODUCT](docs/PRODUCT.md)：使用者、用户流程、V1 范围
- [ARCHITECTURE](docs/ARCHITECTURE.md)：运行时组件、依赖与代码边界
- [PAPER_ENGINE](docs/PAPER_ENGINE.md)：文档模型、布局、渲染及技术预研
- [CLOUDBASE](docs/CLOUDBASE.md)：环境、身份、部署及安全
- [DATA_AND_CREDITS](docs/DATA_AND_CREDITS.md)：数据、额度、订单与一致性
- [TESTING](docs/TESTING.md)：验收标准和测试样本
- [DECISIONS](docs/DECISIONS.md)：确认/待定/否决的决策
- [ROADMAP](docs/ROADMAP.md)：讨论及开发先后顺序

## 文档维护规则

对应主题只维护一处权威说明，其他文档尽量使用链接。遇到新的决定，先修改 `DECISIONS.md` 的状态和理由，再更新相关规范；不要通过在旧文末尾堆“补充说明”来掩盖冲突。
