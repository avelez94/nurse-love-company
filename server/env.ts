/*
  Server configuration. Every secret comes from environment variables and stays
  on the server. Nothing here is ever sent to the browser except the
  integration status flags returned by integrationStatus().
*/
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const e = process.env

export const isProduction = e.NODE_ENV === 'production'
export const isTest = e.NODE_ENV === 'test'

function required(name: string): string {
  const v = e[name]
  if (v) return v
  throw new Error(`Missing required environment variable ${name}`)
}

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
  port: Number(e.PORT ?? 8787),
  appUrl: (e.APP_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  databaseUrl: e.DATABASE_URL ?? '',
  authSecret: e.BETTER_AUTH_SECRET ?? (isProduction ? required('BETTER_AUTH_SECRET') : devSecret()),

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
    driver: (e.STORAGE_DRIVER ?? 'local') as 'local' | 's3',
    localDir: e.LOCAL_STORAGE_DIR ?? '.data/storage',
    s3: {
      endpoint: e.S3_ENDPOINT ?? '',
      bucket: e.S3_BUCKET ?? '',
      region: e.S3_REGION ?? 'auto',
      accessKeyId: e.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: e.S3_SECRET_ACCESS_KEY ?? '',
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

  limits: {
    productFileBytes: Number(e.MAX_PRODUCT_FILE_MB ?? 200) * 1024 * 1024,
    imageBytes: Number(e.MAX_IMAGE_MB ?? 10) * 1024 * 1024,
    videoBytes: Number(e.MAX_VIDEO_MB ?? 2048) * 1024 * 1024,
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
  return config.stripe.liveApproved ? 'live' : 'live-blocked'
}

/** Which services are connected. Safe to show to admins; contains no secrets. */
export function integrationStatus() {
  return {
    payments: { state: paymentsState(), webhook: Boolean(config.stripe.webhookSecret) },
    email: { configured: Boolean(config.resend.apiKey && config.resend.from), webhook: Boolean(config.resend.webhookSecret) },
    storage: { driver: config.storage.driver, configured: config.storage.driver === 'local' || Boolean(config.storage.s3.bucket && config.storage.s3.accessKeyId) },
    video: {
      provider: config.video.provider,
      configured: config.video.provider === 'local' || Boolean(config.video.mux.tokenId && config.video.mux.tokenSecret),
      webhook: Boolean(config.video.mux.webhookSecret),
      signedPreview: Boolean(config.video.mux.signingKeyId && config.video.mux.signingPrivateKey),
    },
  }
}
