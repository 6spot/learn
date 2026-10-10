import type { CloudClient } from './cloud-client.js';
import { CloudClientError } from './cloud-client.js';
import { createPdfDownloader, type PdfPlatform } from './pdf-download.js';
import { RecordAccountSession, RecordDetailSession, RecordListSession, type RecordTimers, type DetailView, type ListView } from './record-sessions.js';

/** Construct once in App launch and register clearUserData with App's central cleanup. */
export function createRecordEnvironment(client: CloudClient, platform: PdfPlatform, timers: RecordTimers, accessRevoked: () => void) {
  const downloader = createPdfDownloader(client, platform);
  let revoking = false;
  const revoked = () => { if (revoking) return; revoking = true; try { accessRevoked(); } finally { revoking = false; } };
  const account = new RecordAccountSession(client, timers, revoked);
  const sessions = new Set<RecordAccountSession | RecordListSession | RecordDetailSession>([account]);
  let foreground = true;
  return {
    account,
    createListSession(changed: (view: ListView) => void) {
      const session = new RecordListSession(client, timers, revoked, changed); session.setForeground(foreground); sessions.add(session); return session;
    },
    createDetailSession(jobId: string, changed: (view: DetailView) => void) {
      const session = new RecordDetailSession(jobId, client, downloader, timers, revoked, changed); session.setForeground(foreground); sessions.add(session); return session;
    },
    release(session: RecordListSession | RecordDetailSession) { session.setVisible(false); session.clear(); sessions.delete(session); },
    onShow() { foreground = true; for (const session of sessions) session.setForeground(true); },
    onHide() { foreground = false; for (const session of sessions) session.setForeground(false); },
    clearUserData() {
      let failed = false;
      for (const session of sessions) { try { session.clear(); } catch { failed = true; } }
      try { downloader.clearLocalFiles(); } catch { failed = true; }
      if (failed) throw new CloudClientError('LOCAL_DATA_CLEAR_FAILED');
    },
  };
}
export type RecordEnvironment = ReturnType<typeof createRecordEnvironment>;
