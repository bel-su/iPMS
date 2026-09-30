import type { Readable } from 'node:stream';
import {
  AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateBucketCommand, CreateMultipartUploadCommand,
  DeleteObjectsCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, ListPartsCommand, PutObjectCommand,
  S3Client, S3ServiceException, UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { SignedGet, SignedPut } from '@ipms/contracts';
import type { StorageConfig } from '../config.js';

// NoSuchBucket is deliberately excluded: a missing bucket is a configuration
// error, not "the object/upload isn't there", and callers must see it as a
// thrown error rather than the same null a caller would get for their own
// stale key or upload id.
const isMissing = (err: unknown): boolean =>
  err instanceof S3ServiceException && (err.name === 'NotFound' || err.name === 'NoSuchKey' || err.name === 'NoSuchUpload');

const hexToBase64 = (hex: string): string => Buffer.from(hex, 'hex').toString('base64');
const expiresAt = (ttlSeconds: number): string => new Date(Date.now() + ttlSeconds * 1000).toISOString();

/**
 * Every call media makes to object storage. R2 and MinIO both speak S3.
 *
 * Two SDK clients: one for media's own calls (the Docker-internal endpoint)
 * and one whose only job is signing URLs with the host a phone can reach.
 * Checksum defaults are pinned to WHEN_REQUIRED: newer SDKs otherwise add
 * CRC32 checksums to every request, which R2 and presigned URLs mishandle.
 */
export class StorageClient {
  private readonly internal: S3Client;
  private readonly signer: S3Client;

  constructor(private readonly config: StorageConfig) {
    const base = {
      region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      forcePathStyle: config.forcePathStyle,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    } as const;
    this.internal = new S3Client({ ...base, endpoint: config.endpoint });
    this.signer = new S3Client({ ...base, endpoint: config.publicEndpoint });
  }

  private get bucket(): string { return this.config.bucket; }

  async isHealthy(): Promise<boolean> {
    try {
      await this.internal.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }

  async ensureBucket(): Promise<void> {
    if (await this.isHealthy()) return;
    await this.internal.send(new CreateBucketCommand({ Bucket: this.bucket }));
  }

  /**
   * A PUT URL bound to the declared size, type and SHA-256 when given, so
   * storage itself refuses any other bytes. The phone must send `headers`
   * exactly as returned.
   */
  async presignPut(key: string, o: { contentType: string; sizeBytes?: number; sha256Hex?: string }, ttlSeconds: number): Promise<SignedPut> {
    const command = new PutObjectCommand({
      Bucket: this.bucket, Key: key, ContentType: o.contentType,
      ...(o.sizeBytes === undefined ? {} : { ContentLength: o.sizeBytes }),
      ...(o.sha256Hex === undefined ? {} : { ChecksumSHA256: hexToBase64(o.sha256Hex) }),
    });
    const signable = new Set(['content-type']);
    if (o.sizeBytes !== undefined) signable.add('content-length');
    if (o.sha256Hex !== undefined) signable.add('x-amz-checksum-sha256');
    const signedUrl = await getSignedUrl(this.signer, command, {
      expiresIn: ttlSeconds, signableHeaders: signable, unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
    });
    const headers: Record<string, string> = { 'content-type': o.contentType };
    if (o.sha256Hex !== undefined) headers['x-amz-checksum-sha256'] = hexToBase64(o.sha256Hex);
    return { signedUrl, headers, expiresAt: expiresAt(ttlSeconds) };
  }

  async createMultipart(key: string, contentType: string): Promise<string> {
    const out = await this.internal.send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }));
    if (!out.UploadId) throw new Error('Storage returned no multipart upload id');
    return out.UploadId;
  }

  /**
   * Bound to the exact byte count this part must be (PART_SIZE_BYTES for
   * every part but the last, the remainder for the last), so storage itself
   * refuses a part whose body is a different length — the same defense
   * `presignPut` gives a single-shot upload.
   */
  presignPart(key: string, uploadId: string, partNumber: number, contentLength: number, ttlSeconds: number): Promise<string> {
    const command = new UploadPartCommand({
      Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber, ContentLength: contentLength,
    });
    return getSignedUrl(this.signer, command, { expiresIn: ttlSeconds, signableHeaders: new Set(['content-length']) });
  }

  async listParts(key: string, uploadId: string): Promise<{ partNumber: number; etag: string }[] | null> {
    try {
      const out = await this.internal.send(new ListPartsCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, MaxParts: 1000 }));
      return (out.Parts ?? []).map((p) => ({ partNumber: p.PartNumber!, etag: p.ETag! }));
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  /**
   * 'upload_gone' and 'invalid_parts' are not errors: a repeat completion
   * after a crash (the object already exists) or a stale part list are both
   * routine for a phone retrying over a bad connection. The caller decides
   * what each one means; only an unrecognized failure is rethrown.
   */
  async completeMultipart(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<'completed' | 'upload_gone' | 'invalid_parts'> {
    try {
      await this.internal.send(new CompleteMultipartUploadCommand({
        Bucket: this.bucket, Key: key, UploadId: uploadId,
        MultipartUpload: { Parts: [...parts].sort((a, b) => a.partNumber - b.partNumber).map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
      }));
      return 'completed';
    } catch (err) {
      if (err instanceof S3ServiceException && err.name === 'NoSuchUpload') return 'upload_gone';
      if (err instanceof S3ServiceException && ['InvalidPart', 'InvalidPartOrder', 'EntityTooSmall'].includes(err.name)) return 'invalid_parts';
      throw err;
    }
  }

  async abortMultipart(key: string, uploadId: string): Promise<void> {
    try {
      await this.internal.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }));
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
  }

  async head(key: string): Promise<{ sizeBytes: number } | null> {
    try {
      const out = await this.internal.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { sizeBytes: out.ContentLength ?? 0 };
    } catch (err) {
      if (!isMissing(err)) throw err;
      // HeadObject reports a bare 404 named 'NotFound' for both a missing
      // key and a missing bucket. Confirm the bucket itself is reachable
      // before treating this as "the object isn't there".
      if (!(await this.isHealthy())) {
        throw new Error(`Bucket "${this.bucket}" does not exist or is unreachable`, { cause: err });
      }
      return null;
    }
  }

  async getStream(key: string): Promise<Readable> {
    const out = await this.internal.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return out.Body as Readable;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.internal.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  /** S3's DeleteObjects accepts at most 1000 keys per request. */
  private static readonly DELETE_BATCH_SIZE = 1000;

  async delete(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const failures: { key: string; code: string }[] = [];
    for (let i = 0; i < keys.length; i += StorageClient.DELETE_BATCH_SIZE) {
      const batch = keys.slice(i, i + StorageClient.DELETE_BATCH_SIZE);
      const out = await this.internal.send(new DeleteObjectsCommand({
        Bucket: this.bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }));
      for (const error of out.Errors ?? []) {
        failures.push({ key: error.Key ?? '(unknown key)', code: error.Code ?? 'Unknown' });
      }
    }
    if (failures.length > 0) {
      throw new Error(`Failed to delete ${failures.length} object(s): ${failures.map((f) => `${f.key} (${f.code})`).join(', ')}`);
    }
  }

  async presignGet(key: string, ttlSeconds: number, downloadName: string, disposition: 'inline' | 'attachment' = 'inline'): Promise<SignedGet> {
    const safe = downloadName.replace(/[^A-Za-z0-9._-]/g, '_');
    const signedUrl = await getSignedUrl(this.signer, new GetObjectCommand({
      Bucket: this.bucket, Key: key, ResponseContentDisposition: `${disposition}; filename="${safe}"`,
    }), { expiresIn: ttlSeconds });
    return { signedUrl, expiresAt: expiresAt(ttlSeconds) };
  }
}
