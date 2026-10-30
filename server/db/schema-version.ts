/**
 * The newest migration this code expects. The health check compares it with
 * the database, so a deployment whose migrations were not run says so. A test
 * keeps it in step with the files in migrations/.
 */
export const LATEST_MIGRATION = '004_marketing.sql'
