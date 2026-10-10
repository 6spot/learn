# T07 确定性布局协议

> 2026-10-11执行设计。T05/T06及真实字体可用；主会话已授权继续，旧内核代码不由新算法冒充执行。

## 边界与职责

新增core统一四模板入口、版本组合验证、布局精确序列化及同步SHA-256摘要；新增合成协议/真实字体双构建测试。只修改core与所属runtime测试，不改CloudBase账本、Canvas或页面。T12支持名单/版本引用计数仍是云端权威；T14请求HMAC指纹仍独立保护输入参数及幂等。本任务不保留正文/布局/摘要。

## API

- `layoutPaperDocument(document, metrics): PaperLayout`：核对锁定文档、可信预设、当前编译引擎及字体bundle，分派唯一方格或拼音布局。
- `validateLayoutVersions(value): LayoutVersionTuple`：只接受四个稳定JSON字段并返回不可变副本。
- `assertLayoutVersionsMatch(expected, actual): void`：完整组合比较，不能只看templateVersion。
- `assertLayoutVersionsSupported(versions, supported): void`：显式可信支持列表精确匹配，另要求当前包实际实现此engine；不能用当前代码执行旧engine并挂旧标签。旧版本部署保留其实际包，实现多引擎调度由云端组合完成，不在core建立通用插件框架。
- `serializePaperLayout(layout): string` / `createLayoutDigest(layout): string` / `validateLayoutDigest(value): string` / `assertLayoutDigestMatches(layout, expected): void`。

摘要字符串为 `learn-layout-v1:sha256:<64位小写十六进制>`；T14注入端口 `prepare(input,trustedPreset)->{layout,digest}` 可直接消费，不保存返回布局。

## 序列化

使用显式完整布局schema验证及固定序列化：对象key按ASCII词典序，数组顺序保留，所有nullable值保持，禁止未知/缺少字段、访问器、符号属性、隐藏属性、toJSON、稀疏数组、非JSON原型、NaN/Infinity/数值溢出。字段包括版本、mode、页序、整页几何/线段、行源范围/段落/断行、slot源范围/行/边界/共格、每个glyph的font/style/ID/字号/源范围/位置/advance/实际墨迹、完整文字及线条样式。

坐标仍以core提供的1e-6mm为精度；序列化不二次移动或缩放，有限数值按ECMAScript JSON最短十进制编码，-0规范为0；字号/灰度等不丢弃精度。所有允许字符串均为ASCII标识或固定枚举，因此规范串是UTF-8的ASCII子集，直接编码字节，不依赖系统TextEncoder或Node Buffer。摘要输入带独立protocol字段，未来schema/摘要规则变化必须升级协议及engine。

选用已被字体模块使用的固定 `@noble/hashes@1.8.0` SHA-256；只传Uint8Array，不调用其字符串编码/随机源。双目标产物必须在没有Node/Buffer/TextEncoder/Intl/动态求值的VM中加载并给出一致串与摘要；根构建若意外带入Node crypto，修正为共享浏览器解析依赖。

## 错误与版本

新增 `INVALID_LAYOUT`、`UNSUPPORTED_VERSION`、`LAYOUT_DIGEST_INVALID`、`LAYOUT_DIGEST_MISMATCH`；均仅固定code/field，不泄漏原文、hash、布局或原始异常。字体资源缺失/损坏沿用已有错误，和版本/摘要失配区分。引擎升级development.4：新增协议属于引擎绑定；既有候选模板样式无需为纯协议变化另升号。

## 验证

合成固定摘要向量与独立Node crypto比对；对象插入顺序/-0一致，数组页/字形顺序敏感，逐字段变更影响摘要；有限数据边界/访问器/toJSON拒绝。统一入口覆盖四模板及不支持engine、跨bundle、伪造锁定版本、active切换不改变已锁定模板（同engine不同可信templateVersion）。原始空格/CRLF/NFC/NFD不做输入变换；布局相同的空白输入可同摘要，异参判定由T14 HMAC负责。

真实双目标检验所有四模板填字/描红、多页、临界字宽、Unicode组合调号：同源miniapp/cloud构建在隔离VM中输出完全一致的规范串/摘要，字体代码使用现有浏览器解析资源。最后core/字体/root回归，独立检查由主会话安排；真机与正式发布保留最终验收。
