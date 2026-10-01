-- Content uploads: let admins see the files in the content buckets.
--
-- 20261004100100 gave admins INSERT, UPDATE and DELETE on storage.objects for the
-- content-images and content-audio buckets but no SELECT. Storage needs SELECT for an
-- upload that overwrites (upsert, which the admin picture upload uses) and for any write
-- that returns or matches existing rows, so every admin upload was refused by RLS
-- ("new row violates row-level security policy for table objects").
--
-- SELECT is granted to admins only and only in these two buckets. Everyone else reads the
-- files through the buckets' public URLs (they are public content; paths are not
-- secrets), which needs no policy and does not allow listing the buckets.
-- (Skipped where Supabase Storage is not installed, e.g. the Docker-free local stack.)
do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'content_images_admin_select'
  ) then
    execute $p$create policy content_images_admin_select on storage.objects for select to authenticated
      using (bucket_id in ('content-images', 'content-audio') and (select public.is_admin()))$p$;
  end if;
end
$$;
