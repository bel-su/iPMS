import { GenericContainer, Wait } from 'testcontainers';
import type { StorageConfig } from '../config.js';
import { StorageClient } from '../storage/storage.client.js';

// minio/minio was pulled from Docker Hub, Quay and GHCR in 2025 (the
// namespace no longer publishes a server image; see
// https://github.com/minio/minio/issues/21647). alpine/minio republishes the
// same upstream source under the same RELEASE.* tags and is the community's
// drop-in replacement. Pinned by digest (the manifest-list digest, so both
// amd64 and arm64 resolve) so the tag can't be silently repointed.
export const MINIO_IMAGE =
  'alpine/minio:RELEASE.2025-10-15T17-29-55Z@sha256:cf23643a6cf9ce159c57643ceb88279e431262282428c9e0bf3a7ef1a97e84b4';

/** A throwaway S3-compatible store with an empty `ipms-media-test` bucket. */
export async function startMinio(): Promise<{ storage: StorageConfig; client: StorageClient; stop(): Promise<void> }> {
  const container = await new GenericContainer(MINIO_IMAGE)
    .withEnvironment({ MINIO_ROOT_USER: 'ipms_test', MINIO_ROOT_PASSWORD: 'ipms_test_secret' })
    // The image's default /data is root-owned and unwritable by its non-root
    // `minio` user; /tmp is writable by that user, so this runs unprivileged.
    .withCommand(['server', '/tmp/data'])
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/minio/health/ready', 9000))
    .start();
  const endpoint = `http://${container.getHost()}:${container.getMappedPort(9000)}`;
  const storage: StorageConfig = {
    endpoint, publicEndpoint: endpoint, region: 'us-east-1', bucket: 'ipms-media-test',
    accessKeyId: 'ipms_test', secretAccessKey: 'ipms_test_secret', forcePathStyle: true, autoCreateBucket: true,
  };
  const client = new StorageClient(storage);
  await client.ensureBucket();
  return { storage, client, async stop() { await container.stop(); } };
}
