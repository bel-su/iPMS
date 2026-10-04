import { DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageClient } from './storage.client.js';

// MinIO never returns a per-key error inside a DeleteObjects response in
// practice (deleting a missing key just isn't an error), so this branch is
// covered here against a stubbed S3Client instead of a real store.
describe('StorageClient.delete (stubbed S3Client)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws naming the keys and codes S3 reports as failed', async () => {
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command: unknown) => {
      if (command instanceof DeleteObjectsCommand) {
        return {
          $metadata: {},
          Errors: [{ Key: 'projects/x/evidence/bad.jpg', Code: 'AccessDenied', Message: 'denied' }],
        };
      }
      throw new Error(`Unexpected command sent to the stub: ${(command as { constructor: { name: string } }).constructor.name}`);
    });

    const client = new StorageClient({
      endpoint: 'http://localhost:9000',
      publicEndpoint: 'http://localhost:9000',
      region: 'us-east-1',
      bucket: 'ipms-media-test',
      accessKeyId: 'ipms_test',
      secretAccessKey: 'ipms_test_secret',
      forcePathStyle: true,
      autoCreateBucket: false,
    });

    await expect(client.delete(['projects/x/evidence/bad.jpg'])).rejects.toThrow(/projects\/x\/evidence\/bad\.jpg/);
    await expect(client.delete(['projects/x/evidence/bad.jpg'])).rejects.toThrow(/AccessDenied/);
  });
});
