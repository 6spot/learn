import { cloneDocument, RuntimeError } from '../../packages/cloud-runtime/dist/index.js';
import { ServiceError } from '../../packages/cloud-service/dist/index.js';

function fields(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      required.some(key => !Object.prototype.hasOwnProperty.call(value, key)) ||
      Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) throw new ServiceError('INVALID_ARGUMENT');
  return value;
}

/** Explicit RPC dispatch; user input never selects an arbitrary object method. */
export function createRpcHandler(service) {
  return async event => {
    try {
      const request = fields(cloneDocument(event), ['method', 'params']);
      const p = request.params;
      let data;
      switch (request.method) {
        case 'getAccount': fields(p, []); data = await service.getAccount(); break;
        case 'getAdminStats': fields(p, [], ['date']); data = await service.getAdminStats(p); break;
        case 'getPrivacyInfo': fields(p, []); data = await service.getPrivacyInfo(); break;
        case 'getDeletionStatus': fields(p, []); data = await service.getDeletionStatus(); break;
        case 'deleteMyData': fields(p, ['confirm']); data = await service.deleteMyData(p); break;
        case 'getSubmissionWindow': fields(p, []); data = await service.getSubmissionWindow(); break;
        case 'getCompatibility': fields(p, ['engineVersion'], ['lockedVersions']); data = await service.getCompatibility(p); break;
        case 'submitGeneration': fields(p, ['requestId', 'input', 'versions', 'layoutDigest']); data = await service.submitGeneration(p); break;
        case 'findJobByRequest': fields(p, ['requestId']); data = await service.findJobByRequest(p.requestId); break;
        case 'listJobs': fields(p, [], ['cursor', 'limit']); data = await service.listJobs(p); break;
        case 'getJob': fields(p, ['jobId']); data = await service.getJob(p.jobId); break;
        case 'getPdfInfo': fields(p, ['jobId']); data = await service.getPdfInfo(p.jobId); break;
        case 'readPdfChunk': {
          fields(p, ['jobId', 'offset']);
          const chunk = await service.readPdfChunk(p);
          data = { ...chunk, bytes: Buffer.from(chunk.bytes).toString('base64') };
          break;
        }
        case 'publishPreset': fields(p, ['preset'], ['acceptance']); data = await service.publishPreset(p.preset, p.acceptance); break;
        case 'activatePreset': fields(p, ['versions']); data = await service.activatePreset(p.versions); break;
        case 'retirePreset': fields(p, ['versions']); data = await service.retirePreset(p.versions); break;
        case 'removePreset': fields(p, ['versions']); data = await service.removePreset(p.versions); break;
        default: throw new ServiceError('INVALID_ARGUMENT');
      }
      return { ok: true, data: data === undefined ? null : data };
    } catch (error) {
      const code = error instanceof ServiceError || error instanceof RuntimeError ? error.code : 'INTERNAL_ERROR';
      return { ok: false, error: { code } };
    }
  };
}
