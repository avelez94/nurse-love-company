// Starts the API server (with a local database) and the Vite site together.
import { spawn } from 'node:child_process'

const procs = [
  spawn('npm', ['run', 'dev:api'], { stdio: 'inherit', env: process.env }),
  spawn('npm', ['run', 'dev:web'], { stdio: 'inherit', env: process.env }),
]
const stop = () => {
  for (const p of procs) p.kill('SIGINT')
  setTimeout(() => process.exit(0), 1500)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
for (const p of procs) p.on('exit', (code) => code && code !== 0 && console.error(`A process exited with code ${code}`))
