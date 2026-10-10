# T09 PDF渲染交付证据

日期：2026-10-11。状态：实现、本地验证及独立检查完成。真机、CloudBase容量/配置、字体正式许可、全量光栅公差与实体打印不写为通过。

## 接口与实现

`renderPdf(layout, provider, {maxBytes?}): Promise<Uint8Array>` 已冻结，T15/T16已实际消费。provider只包含bundle版本、glyphOutline和originalFontBytes；空白可传null。版本、字形来源和精确墨迹先核对，所有异步工作使用校验后的本次布局快照；不接收正文、不重新shape、测宽、换行或分页。

- pdf-lib1.17.1低层PDF对象/操作符和纯JS压缩，CIDFontType2/Identity-H，原始glyphID独立绝对Tm/Tj。标准A4毫米精确换算points，已有shaping偏移不重复应用。
- FontFile2完整嵌入原始TTF，字节不改、不子集化；仅嵌入实际被用到的字体。sfnt只读解析用于字体描述/宽度，不修改表、不重排字形。
- grid stroke保留gray、width、cap、join、miter和dash；不裁掉中心线外半条墨迹。正文/描红颜色和字体来自core输出。
- MiSans原许可证PDF与LXGW OFL文本按实际字体作为附件保存，字节与原件完全一致，不增加打印页。元数据仅Learn及实际字体名称，无用户标题/正文。
- 默认/硬上限64MiB；服务可降低maxBytes但不可提高。50页/100000glyph及已固定原始字体pins限制中间工作量；字体流检查和精确writer大小检查在最终输出buffer分配前进行，失败无partial bytes。

接口及运行说明见 [package README](../../../packages/pdf-renderer/README.md)。不生成虚假ToUnicode；可见/打印内容完整，复制/文本提取不保证，主会话已确认该首版边界。

## 本轮实际验证

| 命令/检查 | 结果 |
|---|---|
| `npm --prefix packages/pdf-renderer test` | **11/11通过**，含strict编译和shared browser bundle；独立检查新增字体字节异步篡改回归 |
| 四模板blank/filled/tracing | 十二组输出；空白一页、真实文本与描红两页，与layout逐页一致 |
| FontFile2 | Node zlib独立解压，三种字体逐字节及SHA-256与原始资源完全一致；Length1准确，无子集名称 |
| 字体字节所有权 | provider返回共享可变buffer，renderPdf首个await后将该buffer清零，最终FontFile2解压字节/hash仍与原始pin一致；字体只读取一次 |
| 许可证附件 | 独立解压，hash与manifest原件一致，不增加页面 |
| Glyph/几何操作符 | 全部glyphID、绝对Tm基线与core顺序逐项一致；完整线段数量与样式均验证，无中心线裁剪 |
| 安全/边界 | 精确maxBytes±1、硬上限、51页、缺字体、错bundle、改动font字节、glyph0、NaN、实际墨迹错位/越页、provider私密异常安全拒绝 |
| 便携性 | miniapp和cloud真实bundle分别在禁用Buffer/TextEncoder/TextDecoder/Intl/crypto与动态求值的VM中完成真实拼音PDF；输出逐字节与Node相等 |
| `npm --prefix packages/pdf-renderer run samples` | **12份真实合成PDF**，pdfinfo/pdffonts独立通过，报告位于ignored `dist/pdf-evidence/t09/report.json` |
| `git diff --check` | 通过 |

独立工具pdfinfo26.10.0检查结果：595.276×841.89pt A4、正确页数、无PDF JavaScript；pdffonts显示实际字体为CID TrueType/Identity-H、emb=yes、sub=no、uni=no。完整字体哈希由测试另行证实，不能仅凭emb=yes认定未修改原字体。

早期真实拼音探针 `dist/pdf-evidence/pinyin-probe.pdf` 用pdftoppm渲染为PNG并查看，大小写声调、组合ü、升降部与完整四线格可见；这是实际PDF光栅探针，不是打印验收。更完整的四模板光栅墨迹量测与可打印样张包由T10承接。

主会话另已报告T15/T16累计11项真实PDF云业务集成通过；那些检查归相应任务，本任务不重复宣称自己运行了该批服务检查。

## 资源实测

最终renderer共享bundle **563366B**，内含pdf-lib/纯JS哈希与许可证，不内含TTF或第二个fontkit；无外部runtime imports。原字体由版本化provider提供，renderer持有校验后的本次字节快照。

十二份PDF中最大米格描红 **18,423,109B**（MiSans+LXGW完整字体），普通方格约5.53MB，拼音约165KB。Node本机样例渲染约16ms至1.8s，不是手机性能或CloudBase冷启动/内存容量承诺。服务配置小于约18.5MB会明确拒绝含两个完整字体的描红样张；已同步主会话/服务实现，不能上传半份PDF来规避上限。

## 剩余交接

- 主会话委派的独立检查已完成，见 [check](check.md)；本worker未提交或归档。
- T10：完整四模板/文字/描红光栅公差、实际墨迹量测、打印样张包；最终Owner完成实体打印和字体许可确认。
- 真实CloudBase部署包体、字体加载/缓存、内存/执行时限、私有上传交付及微信真机打开仍按[最终验收](../../../docs/FINAL_ACCEPTANCE.md)执行；本地便携性测试不冒充平台验收。
