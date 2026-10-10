import {
  AwaitedExecutionBridge, CloudBaseIdentityProvider, CloudBaseMetadataStore,
  CloudBasePrivateStorage, RuntimeError, SystemClock, selectCloudEnvironment,
} from '../../packages/cloud-runtime/dist/index.js';

/** This example must be bundled with the real service before a cloud deployment. */
export function createCloudRuntime(sdk, config) {
  const { env, appId } = selectCloudEnvironment(config);
  if (!/^cloud:\/\/[^/]+\/$/.test(config.fileIdPrefix) ||
      !Array.isArray(config.missingDocumentCodes) || config.missingDocumentCodes.length === 0 ||
      !config.missingDocumentCodes.every(code => typeof code === 'string' || typeof code === 'number') ||
      (config.stage === 'production' && config.platformVerified !== true)) {
    throw new RuntimeError('INVALID_ARGUMENT');
  }
  sdk.init({ env });
  return {
    identity: new CloudBaseIdentityProvider(sdk, appId),
    store: new CloudBaseMetadataStore(sdk.database(), error =>
      error !== null && typeof error === 'object' && config.missingDocumentCodes.includes(error.errCode)),
    storage: new CloudBasePrivateStorage({
      uploadFile: ({ cloudPath, fileContent }) => sdk.uploadFile({ cloudPath, fileContent: Buffer.from(fileContent) }),
      downloadFile: input => sdk.downloadFile(input),
      deleteFile: input => sdk.deleteFile(input),
    }, path => `${config.fileIdPrefix}${path}`),
    clock: new SystemClock(),
    execution: new AwaitedExecutionBridge(),
  };
}

/** No event identity is trusted, and no unawaited background work is launched. */
export function createInvocationHandler(runtime, service) {
  return async function main(event) {
    const identity = runtime.identity.current();
    return await runtime.execution.invoke(event, input => service({ input, identity, runtime }));
  };
}
