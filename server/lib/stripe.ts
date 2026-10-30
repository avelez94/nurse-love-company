import Stripe from 'stripe'
import { config, paymentsState } from '../env.js'
import { HttpError } from './errors.js'

let client: Stripe | null = null

/** The Stripe client, only when test keys (or approved live keys) are configured. */
export function stripe(): Stripe {
  const state = paymentsState()
  if (state === 'not-configured') throw new HttpError(503, 'Checkout is awaiting payment configuration. Nothing has been charged.', 'payments_not_configured')
  if (state === 'live-blocked') throw new HttpError(503, 'Live payments are switched off until the store owner approves launch.', 'payments_live_blocked')
  if (!client) client = new Stripe(config.stripe.secretKey, { maxNetworkRetries: 2 })
  return client
}

export function stripeAvailable() {
  const s = paymentsState()
  return s === 'test' || s === 'live'
}

/** Verifies the Stripe-Signature header against the raw request body. */
export function verifyStripeEvent(rawBody: string, signature: string | undefined): Stripe.Event {
  if (!config.stripe.webhookSecret) throw new HttpError(503, 'Stripe webhook secret is not configured.', 'webhook_not_configured')
  if (!signature) throw new HttpError(400, 'Missing Stripe-Signature header.', 'bad_signature')
  try {
    return Stripe.webhooks.constructEvent(rawBody, signature, config.stripe.webhookSecret)
  } catch {
    throw new HttpError(400, 'Invalid Stripe signature.', 'bad_signature')
  }
}

export type { Stripe }
