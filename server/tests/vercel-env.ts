// Vercel + Supabase configuration for vercel.test.ts (imported after env.ts, before anything else).
export const FAKE_SUPABASE_PORT = 54398
process.env.VERCEL = '1'
process.env.DEPLOY_ENV = 'staging'
process.env.APP_URL = 'https://nurse-love-staging.example.test'
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://nurselove:nurselove-local@localhost:5432/nurselove_test'
process.env.STAGING_ACCESS_USER = 'nurselove'
process.env.STAGING_ACCESS_PASSWORD = 'test-staging-password-1234567890'
process.env.CRON_SECRET = 'test-cron-secret-0123456789abcdef'
process.env.STORAGE_DRIVER = 'supabase'
process.env.SUPABASE_URL = `http://127.0.0.1:${FAKE_SUPABASE_PORT}`
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
process.env.MAX_PRODUCT_FILE_MB = '1'
