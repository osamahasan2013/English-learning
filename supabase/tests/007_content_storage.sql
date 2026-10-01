-- Content storage: only admins write to (and see) the content-images and content-audio
-- buckets; parents and anonymous visitors cannot. Admin writes that return or match rows
-- need the SELECT policy (20261005100100). Skipped where Supabase Storage is not
-- installed (the Docker-free local stack). Rolled back at the end.
begin;

do $$
declare
  admin_id constant uuid := 'c7000000-0000-4000-8000-000000000001';
  parent_id constant uuid := 'a7000000-0000-4000-8000-000000000002';
  object_id uuid;
  n integer;
begin
  if to_regclass('storage.objects') is null then
    raise notice '007_content_storage: no Supabase Storage here, skipped';
    return;
  end if;

  insert into auth.users (id, email, aud, role, instance_id) values
    (admin_id, 'storage-admin@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (parent_id, 'storage-parent@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  update public.profiles set role = 'admin' where id = admin_id;

  -- An admin uploads, sees the upload and overwrites it.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into storage.objects (bucket_id, name, owner_id)
  values ('content-images', 'words/test-storage-1.png', admin_id::text)
  returning id into object_id;
  assert object_id is not null, 'an admin upload returns the stored object';
  assert (select count(*) from storage.objects where bucket_id = 'content-images' and name = 'words/test-storage-1.png') = 1,
    'an admin sees the uploaded object';
  update storage.objects set metadata = '{"mimetype":"image/png"}'::jsonb
  where bucket_id = 'content-images' and name = 'words/test-storage-1.png';
  get diagnostics n = row_count;
  assert n = 1, 'an admin can overwrite an uploaded object';

  -- A parent can neither upload, see nor change content files.
  perform set_config('request.jwt.claims', json_build_object('sub', parent_id, 'role', 'authenticated')::text, true);
  begin
    insert into storage.objects (bucket_id, name, owner_id) values ('content-images', 'words/test-parent.png', parent_id::text);
    raise exception 'parents must not upload content pictures';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from storage.objects where bucket_id in ('content-images', 'content-audio')) = 0,
    'parents cannot list the content buckets';
  update storage.objects set metadata = '{}'::jsonb where bucket_id = 'content-images';
  get diagnostics n = row_count;
  assert n = 0, 'parents cannot change content files';
  delete from storage.objects where bucket_id = 'content-images';
  get diagnostics n = row_count;
  assert n = 0, 'parents cannot delete content files';

  -- Anonymous visitors cannot upload.
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
  begin
    insert into storage.objects (bucket_id, name) values ('content-audio', 'words/test-anon.mp3');
    raise exception 'anonymous visitors must not upload content files';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'postgres', true);
end
$$;

rollback;
\echo '007_content_storage: all assertions passed (skipped where Supabase Storage is not installed)'
