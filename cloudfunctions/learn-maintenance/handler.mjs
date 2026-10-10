import { createRecoveryService, createLifecycleService } from '../../packages/cloud-service/dist/index.js';
import { cloneDocument } from '../../packages/cloud-runtime/dist/index.js';
import { createCloudRuntime } from '../runtime-example/index.mjs';
import { readDeployment, DeploymentError } from '../learn-service/config.mjs';

export function readMaintenance(environment) {
  try {
    const value = cloneDocument(JSON.parse(environment.LEARN_MAINTENANCE_CONFIG));
    if (Object.keys(value).sort().join(',') !== 'clientInvocationDenied,platformVerified,recovery' ||
        value.clientInvocationDenied !== true || value.platformVerified !== true) throw new DeploymentError();
    return value;
  } catch { throw new DeploymentError(); }
}

/** Defense in depth; the actual authorization boundary is the deployed deny rule
 * plus management/timer invocation permissions. Event fields are never trusted. */
export function createMaintenanceInvocation(getTrustedContext, runSweep) {
  return async () => {
    try {
      const context = getTrustedContext();
      if (!context || context.OPENID || context.FROM_OPENID ||
          typeof context.SOURCE === 'string' && /wx_client|web|http/i.test(context.SOURCE)) {
        return { ok: false, error: { code: 'FORBIDDEN' } };
      }
      return { ok: true, data: await runSweep() };
    } catch { return { ok: false, error: { code: 'MAINTENANCE_UNAVAILABLE' } }; }
  };
}

export function createMaintenanceHandler(sdk, environment) {
  const maintenance = readMaintenance(environment);
  const { config, crypto } = readDeployment(environment);
  const runtime = createCloudRuntime(sdk, config.runtime);
  const recovery = createRecoveryService({ store: runtime.store, storage: runtime.storage, clock: runtime.clock, crypto }, maintenance.recovery);
  const lifecycle = createLifecycleService({ store: runtime.store, storage: runtime.storage, clock: runtime.clock, crypto }, config.service);
  return createMaintenanceInvocation(() => sdk.getWXContext(), async () => {
    const recoveryResult = await recovery.runSweep();
    const lifecycleResult = await lifecycle.runSweep();
    return { recovery: recoveryResult, lifecycle: lifecycleResult };
  });
}
