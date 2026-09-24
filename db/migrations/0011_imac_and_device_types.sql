-- Launch line-up: iPhone, MacBook, iPad, iMac. iMac joins the device types; each shop chooses which types it accepts
-- (other white-label shops can switch on Android, Windows laptops and "other").
alter type device_type add value if not exists 'imac' after 'macbook';

alter table tenant_settings add column device_types text[] not null default '{iphone,macbook,ipad,imac}';
