-- Click-to-chat WhatsApp support (wa.me links, no API or paid service). Falls back to the shop's contact phone.
alter table tenant_settings add column whatsapp_phone text check (whatsapp_phone is null or whatsapp_phone ~ '^\+254[17]\d{8}$');
-- Optional short "about" text used on the landing page, in structured data and in /llms.txt.
alter table tenant_branding add column about text;
