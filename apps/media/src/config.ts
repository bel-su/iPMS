export interface StorageConfig {
  /** Where media itself talks to storage (inside Docker: http://minio:9000). */
  endpoint: string;
  /** The host baked into presigned URLs — what a phone can reach. Same as endpoint for R2. */
  publicEndpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  /** Local MinIO only. R2 tokens cannot create buckets, and prod buckets are made by hand. */
  autoCreateBucket: boolean;
}

export interface MediaConfig {
  storage: StorageConfig;
  natsUrl: string;
  qcUrl: string;
  projectUrl: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** Read once at bootstrap; a missing storage setting stops the service rather than failing on the first upload. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): MediaConfig {
  const endpoint = required(env, 'S3_ENDPOINT');
  return {
    storage: {
      endpoint,
      publicEndpoint: env['S3_PUBLIC_ENDPOINT']?.trim() || endpoint,
      region: env['S3_REGION']?.trim() || 'auto',
      bucket: required(env, 'S3_BUCKET'),
      accessKeyId: required(env, 'S3_ACCESS_KEY_ID'),
      secretAccessKey: required(env, 'S3_SECRET_ACCESS_KEY'),
      forcePathStyle: env['S3_FORCE_PATH_STYLE'] === 'true',
      autoCreateBucket: env['S3_AUTO_CREATE_BUCKET'] === 'true',
    },
    natsUrl: required(env, 'NATS_URL'),
    qcUrl: env['QC_INTERNAL_URL']?.trim() || 'http://qc:3005',
    projectUrl: env['PROJECT_INTERNAL_URL']?.trim() || 'http://project:3004',
  };
}
