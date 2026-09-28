-- 0020's check used {10,300}; Postgres regexes cap a bound at 255, so every non-null value raised
-- "invalid repetition count". Place IDs are well under 255 characters.
alter table tenant_branding drop constraint if exists tenant_branding_google_place_id_check;
alter table tenant_branding add constraint tenant_branding_google_place_id_check
  check (google_place_id is null or google_place_id ~ '^[A-Za-z0-9_-]{10,255}$');
