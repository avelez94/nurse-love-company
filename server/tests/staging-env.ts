// Staging configuration for staging.test.ts (imported after env.ts, before anything else).
process.env.DEPLOY_ENV = 'staging'
process.env.STAGING_ACCESS_USER = 'nurselove'
process.env.STAGING_ACCESS_PASSWORD = 'test-staging-password-1234567890'
process.env.DEMO_CONTENT = 'true'
process.env.ADMIN_BOOTSTRAP_TOKEN = 'test-bootstrap-token-abcdefghijklmnop'
// Even live keys with "approved" set must stay blocked on staging.
process.env.STRIPE_SECRET_KEY = 'sk_live_this_is_not_a_real_key'
process.env.LIVE_PAYMENTS_APPROVED = 'true'
