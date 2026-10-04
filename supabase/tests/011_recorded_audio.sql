-- Phase 8.2 recorded audio: the new kinds are accepted and unknown ones rejected, a clip's
-- content key is well formed and unique per version, a letter pattern can link a
-- recording of its NAME separately from its SOUND, and anonymous visitors still cannot
-- read audio assets. Rolled back at the end.
begin;

-- ------------------------------------------------------------ data checks (as owner)
insert into public.audio_assets (id, kind, storage_path, content_key, version, locale, voice, duration_ms, status) values
  ('f8200000-0000-4000-8000-000000000001', 'letter_name', 'audio/test/letter-g.mp3', 'letter_name:g', 1, 'en-US', 'studio-a', 600, 'published'),
  ('f8200000-0000-4000-8000-000000000002', 'phoneme', 'audio/test/g.mp3', 'phoneme:G', 1, 'en-US', 'studio-a', 400, 'published'),
  ('f8200000-0000-4000-8000-000000000003', 'phoneme', 'audio/test/g-v2.mp3', 'phoneme:G', 2, 'en-US', 'studio-a', 420, 'draft');

do $$ begin
  begin
    insert into public.audio_assets (kind, storage_path) values ('ringtone', 'audio/test/x.mp3');
    raise exception 'FAIL: an unknown kind was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.audio_assets (kind, storage_path, content_key, version) values ('phoneme', 'audio/test/dup.mp3', 'phoneme:G', 1);
    raise exception 'FAIL: a second clip with the same content key and version was accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.audio_assets (kind, storage_path, content_key) values ('word', 'audio/test/bad-key.mp3', 'no colon here');
    raise exception 'FAIL: a malformed content key was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.audio_assets (kind, storage_path, version) values ('word', 'audio/test/v0.mp3', 0);
    raise exception 'FAIL: version 0 was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.audio_assets (kind, storage_path, metadata) values ('word', 'audio/test/meta.mp3', '[1]');
    raise exception 'FAIL: non-object metadata was accepted';
  exception when check_violation then null;
  end;
end $$;

-- A letter's name and its sound are different recordings on the same pattern.
update public.phonics_patterns
set letter_name_audio_asset_id = 'f8200000-0000-4000-8000-000000000001',
    audio_asset_id = 'f8200000-0000-4000-8000-000000000002'
where pattern = 'g' and pattern_type = 'letter';

do $$
declare n int;
begin
  select count(*) into n from public.phonics_patterns
  where pattern = 'g' and pattern_type = 'letter'
    and letter_name_audio_asset_id is distinct from audio_asset_id
    and letter_name_audio_asset_id is not null;
  if n <> 1 then raise exception 'FAIL: the letter-name recording was not linked separately (%)', n; end if;
end $$;

-- ------------------------------------------------------------ anonymous visitors
set local role anon;
do $$ begin
  begin
    perform 1 from public.audio_assets limit 1;
    raise exception 'FAIL: anon can read audio assets';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select '011_recorded_audio: all assertions passed';
rollback;
