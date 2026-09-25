-- Expand the default line-up to Android phones and Windows laptops alongside the Apple family (new shops only;
-- existing shops keep whatever they already chose in Settings › Branding).
alter table tenant_settings alter column device_types set default '{iphone,macbook,ipad,imac,android,windows_laptop}';
