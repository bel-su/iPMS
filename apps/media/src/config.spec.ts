import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const base = {
  S3_ENDPOINT: 'https://acc.r2.cloudflarestorage.com', S3_BUCKET: 'ipms-media-prod',
  S3_ACCESS_KEY_ID: 'key', S3_SECRET_ACCESS_KEY: 'secret', NATS_URL: 'nats://nats:4222',
};

describe('loadConfig', () => {
  it('defaults region, public endpoint, path style and service URLs', () => {
    const config = loadConfig(base);
    expect(config.storage).toMatchObject({
      region: 'auto', publicEndpoint: 'https://acc.r2.cloudflarestorage.com', forcePathStyle: false, autoCreateBucket: false,
    });
    expect(config.qcUrl).toBe('http://qc:3005');
    expect(config.projectUrl).toBe('http://project:3004');
  });

  it('reads the MinIO overrides', () => {
    const config = loadConfig({ ...base, S3_PUBLIC_ENDPOINT: 'http://localhost:9000', S3_FORCE_PATH_STYLE: 'true', S3_AUTO_CREATE_BUCKET: 'true' });
    expect(config.storage).toMatchObject({ publicEndpoint: 'http://localhost:9000', forcePathStyle: true, autoCreateBucket: true });
  });

  it.each(['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'NATS_URL'])('refuses to start without %s', (name) => {
    expect(() => loadConfig({ ...base, [name]: '' })).toThrow(`${name} is not set`);
  });
});
