-- Add 'image' as a valid cam embed_type for static/refreshing JPEG webcams
ALTER TABLE cams DROP CONSTRAINT IF EXISTS cams_embed_type_check;
ALTER TABLE cams ADD CONSTRAINT cams_embed_type_check
  CHECK (embed_type IN ('youtube', 'iframe', 'image', 'link'));
