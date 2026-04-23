
-- Update auto-mode-server from */3 to */5
SELECT cron.unschedule(5);
SELECT cron.schedule(
  'invoke-auto-mode-server',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url:='https://yeyctdphzrmyxgskehru.supabase.co/functions/v1/auto-mode-server',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlleWN0ZHBoenJteXhnc2tlaHJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzOTQ0MjUsImV4cCI6MjA4Nzk3MDQyNX0.xfKoBqt5dNKtO5j4fgyayv5KS3r3zv6tK_f0hZNzRNE"}'::jsonb,
    body:='{}'::jsonb
  ) AS request_id;
  $$
);

-- Update scanner-pro-server from */5 to */10
SELECT cron.unschedule(6);
SELECT cron.schedule(
  'invoke-scanner-pro-server',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url:='https://yeyctdphzrmyxgskehru.supabase.co/functions/v1/scanner-pro-server',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlleWN0ZHBoenJteXhnc2tlaHJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzOTQ0MjUsImV4cCI6MjA4Nzk3MDQyNX0.xfKoBqt5dNKtO5j4fgyayv5KS3r3zv6tK_f0hZNzRNE"}'::jsonb,
    body:='{}'::jsonb
  ) AS request_id;
  $$
);

-- Update check-signal-results from */5 to */10
SELECT cron.unschedule(3);
SELECT cron.schedule(
  'invoke-check-signal-results',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url:='https://yeyctdphzrmyxgskehru.supabase.co/functions/v1/check-signal-results',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlleWN0ZHBoenJteXhnc2tlaHJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzOTQ0MjUsImV4cCI6MjA4Nzk3MDQyNX0.xfKoBqt5dNKtO5j4fgyayv5KS3r3zv6tK_f0hZNzRNE"}'::jsonb,
    body:='{}'::jsonb
  ) AS request_id;
  $$
);
