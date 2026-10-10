# T17 执行清单

## 启动与设计

- [x] 读取本任务manifest/PRD、P05/P06产品与UI记录规则、数据/云端/测试文档及runtime/admission/execution/recovery spec。
- [x] 检查并保留共享工作区其他worker修改，task.py start激活T17。
- [x] 主会话接受四个API、逆时间history索引、显式限制和单文件verified cache；接口已发前端worker。
- [x] [design](design.md) 明确授权、分页、缓存、真实存储限制与升级回填边界。

## 实现

- [x] 原子generation_history索引、HMAC用户绑定游标、可续短页与倒序详情。
- [x] 安全metadata投影、每次身份/归属/记录有效期/逻辑删除校验；不依赖生成兼容/资源。
- [x] 仅正式committed PDF可领取；256KiB固定块，完整长度/hash核验，读后事务重新授权。
- [x] 单文件有界/有期cache、同文件cold并发合并、防御复制；暖缓存不绕过删除/失效。
- [x] 实际有效块记录D049日活，metadata/失败请求不计；重复下载不消费、不重排。
- [x] 旧记录幂等索引回填原语与明确迁移要求（维护全量回填由T23组合）。

## 验收与证据

- [x] T17-AC1：逐次可信身份/归属；管理员也不越权访问他人，ID/cursor/fileId不授权。
- [x] T17-AC2：安全metadata、103条稳定分页、有效重复领取保持账本/渲染次数。
- [x] T17-AC3本地：失效/删除/候选/损坏/超限与缓存读后撤销均拒绝，成功终态不变。
- [x] `npm --prefix packages/cloud-service test`：119/119，T17共23（独立检查新增2），含strict编译。
- [x] `npm --prefix packages/cloud-service run test:pdf`：13/13，新增真实18.4MB/71块和三页拼音领取。
- [x] scoped diff、新旧文本空白、Markdown/manifest目标、平台导入/console及正文持久化检查。
- [x] 主会话委派的独立检查完成，候选关联和交错加载问题已修复，见 [check](check.md)；规范同步、提交与归档交主会话。
- [ ] T17-AC3真实存储直连权限/云函数响应上限/真机打开由T24最终配置验收。

配置、迁移和冷实例全读的实际边界见[evidence](evidence.md)，本代理不提交或归档。
