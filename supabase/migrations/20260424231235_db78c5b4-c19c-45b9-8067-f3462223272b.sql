-- Reduce API consumption: auto-mode 5min→6min, scanner 10min→15min
SELECT cron.unschedule('invoke-auto-mode-server');
SELECT cron.unschedule('invoke-scanner-pro-server');

SELECT cron.schedule(
  'invoke-auto-mode-server',
  '*/6 * * * *',
  $$
  SELECT net.http_post(
    url:='https://yeyctdphzrmyxgskehru.supabase.co/functions/v1/auto-mode-server',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlleWN0ZHBoenJteXhnc2tlaHJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzOTQ0MjUsImV4cCI6MjA4Nzk3MDQyNX0.xfKoBqt5dNKtO5j4fgyayv5KS3r3zv6tK_f0hZNzRNE"}'::jsonb,
    body:='{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'invoke-scanner-pro-server',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url:='https://yeyctdphzrmyxgskehru.supabase.co/functions/v1/scanner-pro-server',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlleWN0ZHBoenJteXhnc2tlaHJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzOTQ0MjUsImV4cCI6MjA4Nzk3MDQyNX0.xfKoBqt5dNKtO5j4fgyayv5KS3r3zv6tK_f0hZNzRNE"}'::jsonb,
    body:='{}'::jsonb
  );
  $$
);