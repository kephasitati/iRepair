-- Apple Watch joins the device types (the first real shop sells and repairs them). Added to the default line-up for
-- new shops alongside the rest of the Apple family; existing shops keep whatever they chose in Settings.
alter type device_type add value if not exists 'apple_watch' after 'imac';

alter table tenant_settings alter column device_types set default '{iphone,macbook,ipad,imac,apple_watch,android,windows_laptop}';
