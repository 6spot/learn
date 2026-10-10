import type { NativePage, PagePlatform } from '../../lib/native-page.js';
declare const wx: PagePlatform;
declare function Page(options: object & ThisType<NativePage>): void;
// T21 owns this tab's account/record integration and the sole record-detail route.
Page({ data: {}, onChoosePaper() { wx.switchTab({ url: '/pages/templates/index' }); } });
