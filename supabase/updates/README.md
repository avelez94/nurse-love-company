# Database updates

`supabase/setup.sql` sets up a new, empty Supabase project in one go.

When a later release adds a migration in `server/db/migrations/`, the same change is added here as a numbered script (for example `004_something.sql`). Run each new one once, in order, in Supabase's SQL Editor (New query, paste, Run). The site's `/api/health` shows `"schema": "behind"` until it has been run.
