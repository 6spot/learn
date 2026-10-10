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
8. **已进入开发阶段**：仓库中的纯 TS 格线和部分方格文字布局已有源码，但不等于全功能实现。没有经过实际验证的 API、跨端兼容性、字体授权、打印及平台能力，一律标明待验证，不得写成已通过。
9. 接手开发先读 [开发交接说明](docs/DEVELOPMENT_HANDOFF.md) 与 [ROADMAP](docs/ROADMAP.md)。对于已确认的规则不要自行新增第二套方案、任意调节选项或改变固定 A4 规格；需要新产品取舍时先提出决策，技术实现细节由开发者按验收标准推进。

## 文档导航

- [PRODUCT](docs/PRODUCT.md)：使用者、用户流程、V1 范围
- [ARCHITECTURE](docs/ARCHITECTURE.md)：运行时组件、依赖与代码边界
- [PAPER_ENGINE](docs/PAPER_ENGINE.md)：文档模型、布局、渲染及技术预研
- [PAPER_PRESETS](docs/PAPER_PRESETS.md)：首版四种已确认物理规格（格宽、行列/行带、定位、边距）；实现时不得随意更改
- [CLOUDBASE](docs/CLOUDBASE.md)：环境、身份、部署及安全
- [DATA_AND_CREDITS](docs/DATA_AND_CREDITS.md)：数据、额度、订单与一致性
- [TESTING](docs/TESTING.md)：验收标准和测试样本
- [DECISIONS](docs/DECISIONS.md)：确认/待定/否决的决策
- [ROADMAP](docs/ROADMAP.md)：当前实施进度、下一步和验收里程碑
- [DEVELOPMENT_HANDOFF](docs/DEVELOPMENT_HANDOFF.md)：新开发者的阅读顺序、冻结范围、剩余工程与验收事项

## 文档维护规则

对应主题只维护一处权威说明，其他文档尽量使用链接。遇到新的决定，先修改 `DECISIONS.md` 的状态和理由，再更新相关规范；不要通过在旧文末尾堆“补充说明”来掩盖冲突。
