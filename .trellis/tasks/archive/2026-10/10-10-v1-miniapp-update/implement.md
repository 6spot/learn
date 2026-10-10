# T19 执行清单

- [x] 读取任务、T12/T18实现、CloudClient、权威文档及前端规范；保留他人修改。
- [x] 细化具体设计，主会话认可单一 client/session 与清理接口；调用 task start。
- [x] 实现兼容响应校验、可信预设目录、请求合并/缓存/状态及资源刷新。
- [x] UpdateManager监听一次、原生主动确认、ready/输入revision/前台三重保护。
- [x] 接唯一App.client/compatibility、集中clearUserData及共享状态组件。
- [x] 回归网络/资源/代码/账户区分、旧组合保留、输入保护、清理与迟到响应。
- [x] 类型/构建/编辑与native检查、官方模拟器和安全证据（见evidence.md；确认回调及更新事件明确模拟）。
- [x] 独立检查完成：修复JSON原型/继承hook校验，严格范围类型检查、46项相关回归及官方7组通过，见 [check.md](check.md)。
- [x] 主会话按 D-044 提交并归档本地开发交付；外部验收保留 T24。

最终验收仍待Owner：真实发布更新流程、AppID/CloudBase/字体资源配置、真机键盘/内存/重启和输入保护。开发测试不替代这些验收。
