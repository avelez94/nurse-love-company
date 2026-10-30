/* Command line tools: npm run seed, npm run admin:create -- email@example.com */
import { boot } from './boot.js'
import { one, q } from './db/pool.js'
import { seed } from './seed.js'

const [cmd, arg] = process.argv.slice(2)
const pool = await boot()
try {
  if (cmd === 'seed') {
    if (process.env.NODE_ENV === 'production') throw new Error('Demo data cannot be seeded in production.')
    await seed()
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
    console.log('Commands: seed | admin <email> | migrate')
  }
} finally {
  await pool.end()
}
