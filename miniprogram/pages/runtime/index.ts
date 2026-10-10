import { runRuntimeSmoke } from '../../../packages/runtime-smoke/src/index.js';

// Source import is bundled into the released app; no downloaded code is evaluated.
function reportData() {
  const report = runRuntimeSmoke();
  return {
    capabilities: [
      { name: 'Intl.Segmenter（内核使用固定分词库）', supported: report.capabilities.intlSegmenter },
      { name: 'Unicode 属性正则', supported: report.capabilities.unicodePropertyEscapes },
      { name: 'Array.at（内核不依赖）', supported: report.capabilities.arrayAt },
    ],
    checks: report.checks,
    summary: report.checks.some(check => check.status === 'failed') ? '合成检查失败' :
      report.checks.some(check => check.status === 'skipped') ? '空白格线可用；当前环境缺少文字排版能力' : '合成检查通过',
  };
}

Page({
  data: reportData(),
  onLoad() { this.setData(reportData()); },
  onRun() { this.setData(reportData()); },
});
