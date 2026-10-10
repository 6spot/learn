import cloud from 'wx-server-sdk';
import { createMaintenanceHandler } from './handler.mjs';
let handler;
export async function main() {
  try {
    if (!handler) handler = createMaintenanceHandler(cloud, process.env);
    return await handler();
  } catch { return { ok: false, error: { code: 'MAINTENANCE_UNAVAILABLE' } }; }
}
