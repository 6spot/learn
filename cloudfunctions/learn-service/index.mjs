import cloud from 'wx-server-sdk';
import { createProductionService } from './service.mjs';
import { createRpcHandler } from './rpc.mjs';

let handler;
export async function main(event) {
  try {
    if (!handler) handler = createRpcHandler(createProductionService(cloud, process.env).service);
    return await handler(event);
  } catch {
    // No event, key, raw provider error or private document is logged.
    return { ok: false, error: { code: 'SERVICE_UNAVAILABLE' } };
  }
}
