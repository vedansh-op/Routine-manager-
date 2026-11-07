-- ONE-OS: run only after deploying expire-stale-snaps and setting its secrets.
-- In Supabase Dashboard, enable pg_cron, pg_net, and Vault (vault schema).
-- Set the same random 32+ character secret as the Edge Function secret ONEOS_CRON_SECRET.
-- Replace the three values below with your project URL, publishable key, and cron secret.
select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'oneos_project_url');
select vault.create_secret('YOUR_SUPABASE_PUBLISHABLE_KEY', 'oneos_publishable_key');
select vault.create_secret('REPLACE_WITH_THE_SAME_RANDOM_32_PLUS_CHARACTER_SECRET', 'oneos_cron_secret');

select cron.schedule(
  'oneos-expire-stale-snaps',
  '*/15 * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'oneos_project_url')
        || '/functions/v1/expire-stale-snaps',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'oneos_publishable_key'),
        'x-oneos-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'oneos_cron_secret')
      ),
      body := jsonb_build_object('source', 'pg_cron'),
      timeout_milliseconds := 15000
    ) as request_id;
  $$
);
