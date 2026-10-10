export interface SecureRandomPlatform {
  getRandomValues?(options: { length: number; success(value: { randomValues: ArrayBuffer }): void; fail(): void }): void;
}
export class SecureRandomError extends Error {
  readonly code = 'SECURE_RANDOM_UNAVAILABLE';
  constructor() { super('SECURE_RANDOM_UNAVAILABLE'); this.name = 'SecureRandomError'; }
}

/** Official wx.getRandomValues, never a timestamp or Math.random fallback. */
export function secureUuidV4(platform: SecureRandomPlatform): Promise<string> {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new SecureRandomError());
    try {
      if (typeof platform.getRandomValues !== 'function') { fail(); return; }
      platform.getRandomValues({ length: 16, fail, success(value) {
        try {
          const raw = value?.randomValues;
          // A native getter checks the actual buffer across API realms; a
          // spoofed toStringTag/byteLength on an array-like object is not entropy.
          const byteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')?.get;
          if (!byteLength || byteLength.call(raw) !== 16) { fail(); return; }
          const bytes = Uint8Array.from(new Uint8Array(raw));
          if (bytes.length !== 16) { fail(); return; }
          bytes[6] = (bytes[6]! & 15) | 64;
          bytes[8] = (bytes[8]! & 63) | 128;
          const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
          resolve(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`);
        } catch { fail(); }
      } });
    } catch { fail(); }
  });
}
