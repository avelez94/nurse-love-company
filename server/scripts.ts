/*
  Command line tools (run on the server, for example in the host's shell):
    npm run seed [-- reviewer@example.com]   load labeled demo content (development, or staging with DEMO_CONTENT=true)
    npm run admin:create -- you@example.com   give an existing account admin access
    npm run migrate                           apply database migrations
*/
import { boot } from './boot.js'
import { one, q } from './db/pool.js'
import { demoAllowed, deployEnv } from './env.js'
import { seedDemoContent } from './seed.js'

const [cmd, arg] = process.argv.slice(2)
const pool = await boot()
try {
  if (cmd === 'seed') {
    if (!demoAllowed()) throw new Error(`Demo content is not allowed here (DEPLOY_ENV=${deployEnv}). It needs DEPLOY_ENV=staging and DEMO_CONTENT=true.`)
    const r = await seedDemoContent({ reviewerEmail: arg ?? null, actor: { id: 'command-line', email: 'command line', name: 'Command line', role: 'admin' } })
    console.log(`Demo content loaded: ${r.productsCreated} products, ${r.ordersCreated} demo orders, ${r.reviewerOrdersCreated} reviewer orders, ${r.tutorialsCreated} tutorials added. Existing content was not duplicated.`)
  } else if (cmd === 'admin') {
    if (!arg) throw new Error('Usage: npm run admin:create -- owner@example.com (the account must already exist; sign up first)')
    const u = await one<{ id: string }>('select id from "user" where lower(email) = lower($1)', [arg])
    if (!u) throw new Error(`No account found for ${arg}. Create the account on the site first, then run this again.`)
    await q(`update "user" set role = 'admin' where id = $1`, [u.id])
    await q(`insert into audit_log (actor_email, action, entity_type, entity_id, summary) values ('command line','admin.granted','user',$1,$2)`, [u.id, `Granted admin access to ${arg} from the command line`])
    console.log(`${arg} is now an admin.`)
  } else if (cmd === 'migrate') {
    console.log('Migrations are up to date.')
  } else {
    console.log('Commands: seed [reviewer email] | admin <email> | migrate')
  }
} finally {
  await pool.end()
}
