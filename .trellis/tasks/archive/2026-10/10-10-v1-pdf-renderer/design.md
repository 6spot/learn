# T09 PDF实现设计

> 2026-10-11：使用真实原字体的本地开发输出。正式许可、平台配置/限制和实印仍交最终验收。

## 边界与接口

新增独立 `packages/pdf-renderer`（源码、构建、Node测试/样张工具）。不编辑正在独立检查的core，不让PDF重排文字或获取原文。接口：`renderPdf(layout, provider, {maxBytes?}): Promise<Uint8Array>`；provider只需bundleVersion、glyphOutline及originalFontBytes，空白纸可传null。Node文件与独立命令仅在工具/测试出现，同一renderer可打包进微信模拟组合。

默认64MiB输出硬上限，服务可传更小值、不能放大；布局最多50页/100000glyph，固定已知字体原字节总量受pins约束。先校验/快照完整layout，验证版本/源字形/物理墨迹，再创建PDF。字体/内容流及最后writer的准确buffer-size分别检查限制；失败只抛安全错误，不交付半文件。

## 选型与绘制

固定 `pdf-lib@1.17.1`，使用低层PDF对象、公开操作符、纯JS pako deflate及PDFWriter；不使用它的字体layout/embedFont(文本)路径，不安装第二个fontkit。独立sfnt目录解析读取head/hhea/maxp/hmtx等必要描述符，字体资源自身按共享manifest的size/SHA校验；不修改任何表。

- FontFile2保存完整原始TTF的FlateDecode流并给出Length1；字体字节在校验前复制为本次独占快照，后续嵌入使用相同快照，不受provider共享缓存异步修改影响。CIDFontType2/Identity-H，CIDToGIDMap Identity，使用原始glyphID。W数组从hmtx取得已用glyph宽度，但每个glyph均单独Tm/Tj到core已给出的绝对基线，PDF字宽不会影响分页/位置。
- 页面210×297mm按72/25.4精确换为points。源坐标y-down，PDF基线是`(x*scale, (297-y)*scale)`；字体的y-up保持不再翻转或应用shaping offsets。
- 每条线使用完整width/gray/dash/cap/join/miter，线段独立path，不对中心线bounds裁切。解析实际描边边界和provider的精确glyph ink，与A4整页边界核对。
- 填字/描红颜色读取glyph绑定的预设style；参考字体已由core选择，renderer不选择别的字体，也不生成glyph0。

## 原字体许可与文本提取

MiSans原始协议PDF及LXGW OFL全文从assets/fonts/licenses构建为固定随包资源，按实际字体加入PDF附件，PDF元数据以固定内容注明MiSans/LXGW，不增加印刷页。FontFile2解压后必须与原文件逐字节/SHA一致；这提供明确交付模式证据，仍不代替Owner最终许可验收。

layout不含原文字符串，单个glyph无法唯一反推出所有源Unicode（别名/组合/ligature）；不伪造ToUnicode。当前保证可见字形/打印完整，复制/文本提取不保证。主会话已确认该边界；不为复制能力新增原文存储或改变API。

## 验证

1. 构建Node/miniapp共用browser-resolved bundle，VM禁用Node/Buffer/编码器/动态执行；以真实font provider渲染并比较相同bytes。
2. 检查所有四模板blank/filled/tracing/multipage与拼音全部调号；确保shape不被renderer调用、glyph计数与独立Tm位置逐项匹配；所有源layout不变。
3. 独立pdfinfo核验MediaBox/页数/元数据，pdffonts核验CID TrueType且emb=yes/sub=no，解析并解压FontFile2逐字节核验；附件保留原许可证且不增加页数。
4. T09先用pdftoppm实际渲染拼音探针并查看，生成十二份可复现四模板PDF供后续使用；完整外框/字形光栅量测、固定DPI公差和打印样张包由T10承接。样张只用明确合成输入，输出dist不入Git。
5. 超页/超glyph/低maxBytes、非finite/错bundle/字形越界/缺字/被改字体均明确拒绝；错误/日志/元数据无正文。
