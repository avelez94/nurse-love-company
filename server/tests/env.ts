// Imported first by every test file so configuration is set before modules load.
process.env.NODE_ENV = 'test'
process.env.APP_URL = 'http://localhost:5173'
process.env.BETTER_AUTH_SECRET = 'test-secret-test-secret-test-secret-1234'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret_for_signed_events'
process.env.RESEND_WEBHOOK_SECRET = 'whsec_' + Buffer.from('resend-test-secret-32-bytes-long!').toString('base64')
process.env.LOCAL_STORAGE_DIR = '.data/test-storage'
process.env.VIDEO_PROVIDER = 'local'
process.env.STRIPE_SECRET_KEY = ''
process.env.RESEND_API_KEY = ''
process.env.DELIVERY_WEBHOOK_SECRET = 'delivery-test-secret-0123456789'
