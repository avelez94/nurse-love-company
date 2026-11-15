-- Delete forever (replaces Archive).
--
-- Released product files stay unchangeable, as before. The only new
-- exception: the store's own "Delete forever" for a product may remove that
-- product's file versions. It marks its transaction with
-- nlc.deleting_product = <product id>, and it already refuses any product
-- someone bought or claimed (their downloads also point at these rows, so
-- the database would refuse it too).
create or replace function product_versions_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('nlc.deleting_product', true) = old.product_id::text then
    return old;
  end if;
  raise exception '% rows are immutable', tg_table_name;
end $$;

drop trigger if exists product_versions_immutable on product_versions;
create trigger product_versions_immutable before update or delete on product_versions
  for each row execute function product_versions_guard();
