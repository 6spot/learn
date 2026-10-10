/** This test-only binding uses the official automation channel in both directions.
 * Raw requests stay in memory and are never written as diagnostic evidence. */
export async function installServiceBridge(miniProgram, handler) {
  await miniProgram.exposeFunction('__learnDiagnosticRpc', async (id, request) => {
    let response;
    try { response = await handler(request); }
    catch { response = { ok: false, error: { code: 'INTERNAL_ERROR' } }; }
    try {
      await miniProgram.evaluate((requestId, result) => {
        const callback = getApp().__learnRpcCallbacks?.get(requestId);
        if (callback) { getApp().__learnRpcCallbacks.delete(requestId); callback(result); }
      }, id, response);
    } catch { /* A disconnected client cannot reverse server work. */ }
  });
  await miniProgram.evaluate(() => {
    const app = getApp(); app.__learnRpcCallbacks = new Map(); let sequence = 0;
    app.client.transport = (method, params) => new Promise(resolve => {
      const id = ++sequence; app.__learnRpcCallbacks.set(id, resolve);
      // Binding is supplied only by the official automation diagnostics host.
      __learnDiagnosticRpc(id, { method, params });
    });
  });
}
