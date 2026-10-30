/*
  Server configuration. Every secret comes from environment variables and stays
  on the server. Nothing here is ever sent to the browser except the
  integration status flags returned by integrationStatus().
*/
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

// Local convenience: read .env if present. Hosts set real environment variables instead.
if (process.env.NODE_ENV !== 'test' && existsSync('.env') && typeof process.loadEnvFile === 'function') process.loadEnvFile('.env')

const e = process.env

/** Numeric setting; an empty value (as CI systems pass for unset variables) means "use the default". */
const num = (v: string | undefined, fallback: number) => (v && v.trim() ? Number(v) : fallback)

export const isProduction = e.NODE_ENV === 'production'
export const isTest = e.NODE_ENV === 'test'
/** Running as Vercel Functions (Vercel sets VERCEL=1). No persistent disk, no long running process. */
export const onVercel = Boolean(e.VERCEL)

/**
 * Which deployment this is. Production mode (NODE_ENV=production) defaults to
 * "production"; a hosted preview must say DEPLOY_ENV=staging explicitly.
 */
export type DeployEnv = 'development' | 'staging' | 'production'
export const deployEnv: DeployEnv = (() => {
  const v = e.DEPLOY_ENV ?? (isProduction ? 'production' : 'development')
  if (v !== 'development' && v !== 'staging' && v !== 'production') throw new Error(`DEPLOY_ENV must be development, staging or production (got "${v}")`)
  if (v === 'development' && isProduction) throw new Error('DEPLOY_ENV=development cannot run with NODE_ENV=production')
  return v
})()

/** Local development keeps a generated secret in .data so sign ins survive restarts. */
function devSecret(): string {
  if (isProduction) return ''
  const file = '.data/auth-secret'
  if (existsSync(file)) return readFileSync(file, 'utf8').trim()
  const secret = randomBytes(32).toString('hex')
  mkdirSync('.data', { recursive: true })
  writeFileSync(file, secret, { mode: 0o600 })
  return secret
}

export const config = {
  port: num(e.PORT, 8787),
  appUrl: (e.APP_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  databaseUrl: e.DATABASE_URL ?? '',
  database: {
    /** Optional CA certificate (PEM) for verified TLS, for example Supabase's downloadable certificate. */
    sslCa: (e.DATABASE_SSL_CA ?? '').replace(/\\n/g, '\n'),
    /** Connections per instance. Serverless instances keep this small and use Supabase's pooler. */
    poolMax: num(e.DB_POOL_MAX, onVercel ? 3 : 10),
  },
  /** Vercel Cron sends this as a Bearer token. Protects the scheduled maintenance endpoint. */
  cronSecret: e.CRON_SECRET ?? '',
  // Hosted deployments must set this; deploymentProblems() stops the server if not.
  authSecret: e.BETTER_AUTH_SECRET ?? (isProduction ? '' : devSecret()),

  stripe: {
    secretKey: e.STRIPE_SECRET_KEY ?? '',
    webhookSecret: e.STRIPE_WEBHOOK_SECRET ?? '',
    /** Live keys are refused until the owner gives an explicit launch instruction. */
    liveApproved: e.LIVE_PAYMENTS_APPROVED === 'true',
  },

  resend: {
    apiKey: e.RESEND_API_KEY ?? '',
    from: e.RESEND_FROM ?? '',
    webhookSecret: e.RESEND_WEBHOOK_SECRET ?? '',
  },

  storage: {
    driver: (e.STORAGE_DRIVER ?? 'local') as 'local' | 's3' | 'supabase',
    localDir: e.LOCAL_STORAGE_DIR ?? '.data/storage',
    s3: {
      endpoint: e.S3_ENDPOINT ?? '',
      bucket: e.S3_BUCKET ?? '',
      region: e.S3_REGION ?? 'auto',
      accessKeyId: e.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: e.S3_SECRET_ACCESS_KEY ?? '',
    },
    /** Supabase Storage. The service role key never leaves the server. */
    supabase: {
      url: (e.SUPABASE_URL ?? '').replace(/\/$/, ''),
      serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY ?? '',
      /** Private bucket for purchasable files. The server never signs URLs for it. */
      filesBucket: e.SUPABASE_FILES_BUCKET ?? 'product-files',
      /** Private bucket for photos, samples and tutorial media, shown through short lived signed links when allowed. */
      mediaBucket: e.SUPABASE_MEDIA_BUCKET ?? 'media',
    },
  },

  video: {
    provider: (e.VIDEO_PROVIDER ?? 'local') as 'local' | 'mux',
    mux: {
      tokenId: e.MUX_TOKEN_ID ?? '',
      tokenSecret: e.MUX_TOKEN_SECRET ?? '',
      webhookSecret: e.MUX_WEBHOOK_SECRET ?? '',
      signingKeyId: e.MUX_SIGNING_KEY_ID ?? '',
      signingPrivateKey: e.MUX_SIGNING_PRIVATE_KEY ?? '',
    },
  },

  staging: {
    /** HTTP Basic Auth gate in front of the whole staging site (except webhooks and health). */
    accessUser: e.STAGING_ACCESS_USER ?? 'nurselove',
    accessPassword: e.STAGING_ACCESS_PASSWORD ?? '',
  },

  /** Labeled demo content. Off unless DEMO_CONTENT=true on staging (always on locally). */
  demoContent: e.DEMO_CONTENT === 'true',

  /** One time token that lets the first signed in account become admin. */
  adminBootstrapToken: e.ADMIN_BOOTSTRAP_TOKEN ?? '',

  // Supabase's free plan caps every stored file at 50 MB, so those are the defaults there.
  limits: {
    productFileBytes: num(e.MAX_PRODUCT_FILE_MB, e.STORAGE_DRIVER === 'supabase' ? 50 : 200) * 1024 * 1024,
    imageBytes: num(e.MAX_IMAGE_MB, 10) * 1024 * 1024,
    videoBytes: num(e.MAX_VIDEO_MB, e.STORAGE_DRIVER === 'supabase' ? 50 : 2048) * 1024 * 1024,
    captionBytes: 512 * 1024,
  },

  downloads: {
    tokenTtlSeconds: 120,
  },
}

export type PaymentsState = 'test' | 'live' | 'live-blocked' | 'not-configured'

export function paymentsState(): PaymentsState {
  const k = config.stripe.secretKey
  if (!k) return 'not-configured'
  if (k.startsWith('sk_test_') || k.startsWith('rk_test_')) return 'test'
  // Staging and development never take real payments, whatever else is set.
  if (deployEnv !== 'production') return 'live-blocked'
  return config.stripe.liveApproved ? 'live' : 'live-blocked'
}

/** Demo content may only exist locally, or on staging when deliberately switched on. */
export function demoAllowed() {
  return deployEnv === 'development' || (deployEnv === 'staging' && config.demoContent)
}

/**
 * Checks a hosted deployment's settings before the server starts. Problems that
 * would lose data, expose the site or take real payments stop the server with
 * a clear message instead of failing later.
 */
export function deploymentProblems(): string[] {
  const p: string[] = []
  if (deployEnv === 'development') return p
  if (!config.databaseUrl) p.push('DATABASE_URL is required.')
  if (!e.BETTER_AUTH_SECRET || e.BETTER_AUTH_SECRET.length < 32) p.push('BETTER_AUTH_SECRET must be set to a random value of at least 32 characters.')
  if (!/^https:\/\//.test(config.appUrl)) p.push('APP_URL must be the https address of this deployment.')
  if (onVercel) {
    // Vercel has no persistent disk and caps request bodies, so files must go straight to Supabase Storage.
    if (config.storage.driver !== 'supabase') p.push('STORAGE_DRIVER must be supabase on Vercel. Its local disk is temporary and request bodies are too small for uploads through the server.')
    if (config.cronSecret.length < 16) p.push('CRON_SECRET must be set (at least 16 random characters) so the scheduled email retry job can run.')
  } else if (config.storage.driver === 'local' && !(e.LOCAL_STORAGE_DIR && e.LOCAL_STORAGE_DIR.startsWith('/'))) {
    p.push('Uploaded files would be lost on restart. Use STORAGE_DRIVER=supabase, or STORAGE_DRIVER=local with LOCAL_STORAGE_DIR set to an absolute path on a persistent disk.')
  }
  if (config.storage.driver === 's3') {
    for (const k of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) if (!e[k]) p.push(`${k} is required when STORAGE_DRIVER=s3.`)
  }
  if (config.storage.driver === 'supabase') {
    // The automated tests use a local stand in for Supabase on plain http; real deployments need https.
    const testStandIn = isTest && /^http:\/\/127\.0\.0\.1:\d+$/.test(config.storage.supabase.url)
    if (!/^https:\/\//.test(config.storage.supabase.url) && !testStandIn) p.push('SUPABASE_URL must be your Supabase project address (https://YOUR-PROJECT.supabase.co).')
    if (!config.storage.supabase.serviceRoleKey) p.push('SUPABASE_SERVICE_ROLE_KEY is required when STORAGE_DRIVER=supabase.')
  }
  if (deployEnv === 'staging' && config.staging.accessPassword.length < 16) p.push('STAGING_ACCESS_PASSWORD must be set (at least 16 characters) so the staging site is not open to the public.')
  if (deployEnv === 'production' && config.demoContent) p.push('DEMO_CONTENT=true is only allowed on staging. Remove it from production.')
  if (config.adminBootstrapToken && config.adminBootstrapToken.length < 24) p.push('ADMIN_BOOTSTRAP_TOKEN must be at least 24 characters, or removed.')
  return p
}

/** Which services are connected. Safe to show to admins; contains no secrets. */
export function integrationStatus() {
  return {
    environment: deployEnv,
    demoContent: demoAllowed(),
    payments: { state: paymentsState(), webhook: Boolean(config.stripe.webhookSecret) },
    email: { configured: Boolean(config.resend.apiKey && config.resend.from), webhook: Boolean(config.resend.webhookSecret) },
    storage: {
      driver: config.storage.driver,
      configured:
        config.storage.driver === 'local' ||
        (config.storage.driver === 's3' ? Boolean(config.storage.s3.bucket && config.storage.s3.accessKeyId) : Boolean(config.storage.supabase.url && config.storage.supabase.serviceRoleKey)),
    },
    scheduledJobs: Boolean(config.cronSecret),
    video: {
      provider: config.video.provider,
      configured: config.video.provider === 'local' || Boolean(config.video.mux.tokenId && config.video.mux.tokenSecret),
      webhook: Boolean(config.video.mux.webhookSecret),
      signedPreview: Boolean(config.video.mux.signingKeyId && config.video.mux.signingPrivateKey),
    },
  }
}
