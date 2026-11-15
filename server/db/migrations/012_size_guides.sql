-- Size guides: each item that ships can have its own sizing images, shown to
-- shoppers behind a "Size guide" button on the product page. They are shown
-- as uploaded (no watermark or blur), like product photos.
alter table product_images drop constraint if exists product_images_kind_check;
alter table product_images add constraint product_images_kind_check check (kind in ('gallery','sample','detail','size_guide'));
