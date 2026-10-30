// Vercel Function: the whole /api for the store (see vercel.json and server/serverless.ts).
import '../server/vercel-env.js'
import { createServerlessApp, restorePath } from '../server/serverless.js'

const app = createServerlessApp()
const handle = (req: Request) => app.fetch(restorePath(req))

export const GET = handle
export const HEAD = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
export const OPTIONS = handle
