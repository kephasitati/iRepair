-- An accepted counter-offer is recorded as a "discount" line on the accepted quote version. Only discount lines may be
-- negative; parts, labour and other lines stay non-negative.
alter table quote_line_items drop constraint quote_line_items_kind_check;
alter table quote_line_items drop constraint quote_line_items_unit_price_cents_check;
alter table quote_line_items add constraint quote_line_items_kind_check check (kind in ('part', 'labour', 'other', 'discount'));
alter table quote_line_items add constraint quote_line_items_price_check check (unit_price_cents >= 0 or kind = 'discount');
