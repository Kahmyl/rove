-- Rove cloud data is restricted to portable Workflow configuration.
-- Applying this candidate migration requires prior provider, region, retention,
-- sign-in, cost, and operating authority.
create extension if not exists pgcrypto with schema extensions;
create schema if not exists rove_private;
revoke all on schema rove_private from public, anon, authenticated;
create table rove_private.deleted_owner_hashes (
  owner_hash text primary key,
  deleted_at timestamptz not null
);
create table rove_private.deleted_workflow_hashes (
  owner_id uuid not null references auth.users(id) on delete cascade,
  workflow_hash text not null,
  deleted_at timestamptz not null,
  primary key(owner_id,workflow_hash)
);
create or replace function rove_private.assert_owner(p_owner_id uuid)
returns void language plpgsql security definer set search_path = '' stable as $$
begin
  if (select auth.uid()) is null or p_owner_id is distinct from (select auth.uid()) then raise exception 'Rove Workflow owner mismatch' using errcode='42501'; end if;
  if exists (select 1 from rove_private.deleted_owner_hashes where owner_hash=encode(extensions.digest(p_owner_id::text,'sha256'),'hex')) then raise exception 'Rove account is deleted' using errcode='42501'; end if;
end $$;
revoke all on function rove_private.assert_owner(uuid) from public,anon,authenticated;

create or replace function rove_private.canonical_jsonb(p_value jsonb)
returns text language sql immutable parallel safe set search_path = '' as $$
  select case jsonb_typeof(p_value)
    when 'object' then coalesce((
      select '{'||string_agg(to_jsonb(key)::text||':'||rove_private.canonical_jsonb(value),',' order by key collate "C")||'}'
      from jsonb_each(p_value)
    ), '{}')
    when 'array' then coalesce((
      select '['||string_agg(rove_private.canonical_jsonb(value),',' order by ordinal)||']'
      from jsonb_array_elements(p_value) with ordinality as entries(value, ordinal)
    ), '[]')
    else p_value::text
  end
$$;
revoke all on function rove_private.canonical_jsonb(jsonb) from public,anon,authenticated;

create or replace function rove_private.assert_portable_text(
  p_value jsonb, p_label text, p_maximum integer, p_check_path boolean default true
) returns void language plpgsql immutable set search_path = '' as $$
declare value text;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'string' then raise exception '% must be text', p_label using errcode='22023'; end if;
  value := p_value #>> '{}';
  if value <> btrim(value) or char_length(value) < 1 or char_length(value) > p_maximum then raise exception '% has invalid length or whitespace', p_label using errcode='22023'; end if;
  if value ~* '-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer [A-Za-z0-9._~+/=-]{12,}|(password|passwd|access[_ -]?token|refresh[_ -]?token|api[_ -]?key|authorization|cookie)[[:space:]]*[:=][[:space:]]*[^[:space:]]+' then raise exception '% contains secret material',p_label using errcode='22023'; end if;
  -- Intentionally mirrors LOCAL_PATH_PATTERNS in workflows.ts. A path must
  -- begin at the start of the value or after the same punctuation boundary;
  -- ordinary prose and URL double slashes remain valid portable text.
  if p_check_path and value ~* '(^|[[:space:]"''`()\[\]{}<>=,:;])(file:///?[^[:space:]"''`]+|\\\\[^\\[:space:]"''`]+\\[^\\[:space:]"''`]+|[A-Za-z]:[\\/][^[:space:]"''`]+|~/[^[:space:]"''`]+|(\.{1,2}[\\/]|/[^/])[^[:space:]"''`]+)' then raise exception '% contains a local path',p_label using errcode='22023'; end if;
end $$;
revoke all on function rove_private.assert_portable_text(jsonb,text,integer,boolean) from public,anon,authenticated;

create or replace function rove_private.assert_guidance_array(p_value jsonb,p_label text)
returns void language plpgsql immutable set search_path = '' as $$
declare entry jsonb; topic jsonb; ids text[] := '{}'; topics text[]; identity text;
begin
  if jsonb_typeof(p_value)<>'array' or jsonb_array_length(p_value)>64 then raise exception '% is invalid',p_label using errcode='22023'; end if;
  for entry in select value from jsonb_array_elements(p_value) loop
    if jsonb_typeof(entry)<>'object' or (select count(*) from jsonb_object_keys(entry))<>3 or not entry ?& array['id','text','appliesTo'] then raise exception '% item fields are invalid',p_label using errcode='22023'; end if;
    perform rove_private.assert_portable_text(entry->'id',p_label||' identity',120,true);
    perform rove_private.assert_portable_text(entry->'text',p_label||' text',2000,true);
    identity := entry->>'id';
    if identity=any(ids) then raise exception '% identities must be unique',p_label using errcode='22023'; end if;
    ids := array_append(ids,identity);
    if jsonb_typeof(entry->'appliesTo')<>'array' or jsonb_array_length(entry->'appliesTo')>16 then raise exception '% topics are invalid',p_label using errcode='22023'; end if;
    topics := '{}';
    for topic in select value from jsonb_array_elements(entry->'appliesTo') loop
      perform rove_private.assert_portable_text(topic,p_label||' topic',80,true);
      if lower(topic#>>'{}')=any(topics) then raise exception '% topics must be unique',p_label using errcode='22023'; end if;
      topics:=array_append(topics,lower(topic#>>'{}'));
    end loop;
  end loop;
end $$;
revoke all on function rove_private.assert_guidance_array(jsonb,text) from public,anon,authenticated;

create or replace function rove_private.assert_portable_snapshot(p_record jsonb)
returns void language plpgsql security definer set search_path = '' immutable as $$
declare configuration jsonb := p_record->'configuration'; entry jsonb; ids text[] := '{}'; base jsonb; computed text;
begin
  if p_record is null or jsonb_typeof(p_record)<>'object' or (select count(*) from jsonb_object_keys(p_record))<>8 or not p_record ?& array['schemaVersion','workflowId','configurationRevision','name','archived','configuration','digest','approvedAt'] then raise exception 'Portable Workflow snapshot fields are invalid' using errcode='22023'; end if;
  if p_record->'schemaVersion'<>'1'::jsonb or (p_record->>'workflowId')!~'^workflow_[A-Za-z0-9_-]{8,200}$' or jsonb_typeof(p_record->'configurationRevision')<>'number' or (p_record->>'configurationRevision')!~'^[1-9][0-9]*$' or (p_record->>'configurationRevision')::numeric>9007199254740991 or jsonb_typeof(p_record->'digest')<>'string' or (p_record->>'digest')!~'^[a-f0-9]{64}$' or jsonb_typeof(p_record->'archived')<>'boolean' then raise exception 'Portable Workflow snapshot is invalid' using errcode='22023'; end if;
  perform rove_private.assert_portable_text(p_record->'name','Workflow name',120,true);
  if jsonb_typeof(p_record->'approvedAt')<>'string' or (p_record->>'approvedAt')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' then raise exception 'Workflow approval timestamp is invalid' using errcode='22023'; end if;
  perform (p_record->>'approvedAt')::timestamptz;
  if jsonb_typeof(configuration)<>'object' or (select count(*) from jsonb_object_keys(configuration))<>8 or not configuration ?& array['purpose','preferences','criteria','guidance','procedures','resourceRequirements','resultConventions','approvedKnowledge'] then raise exception 'Portable Workflow configuration fields are invalid' using errcode='22023'; end if;
  if configuration->'purpose' <> '""'::jsonb then
    perform rove_private.assert_portable_text(configuration->'purpose','Workflow purpose',2000,true);
  end if;
  perform rove_private.assert_guidance_array(configuration->'preferences','Workflow preferences');
  perform rove_private.assert_guidance_array(configuration->'criteria','Workflow criteria');
  perform rove_private.assert_guidance_array(configuration->'guidance','Workflow guidance');
  perform rove_private.assert_guidance_array(configuration->'procedures','Workflow procedures');
  perform rove_private.assert_guidance_array(configuration->'resultConventions','Workflow result conventions');
  perform rove_private.assert_guidance_array(configuration->'approvedKnowledge','Workflow approved knowledge');
  if jsonb_typeof(configuration->'resourceRequirements')<>'array' or jsonb_array_length(configuration->'resourceRequirements')>32 then raise exception 'Workflow resource requirements are invalid' using errcode='22023'; end if;
  for entry in select value from jsonb_array_elements(configuration->'resourceRequirements') loop
    if jsonb_typeof(entry)<>'object' or (select count(*) from jsonb_object_keys(entry))<>3 or not entry ?& array['id','kind','label'] then raise exception 'Resource requirement fields are invalid' using errcode='22023'; end if;
    perform rove_private.assert_portable_text(entry->'id','Resource requirement identity',120,true);
    perform rove_private.assert_portable_text(entry->'label','Resource requirement label',240,true);
    if jsonb_typeof(entry->'kind')<>'string' or entry->>'kind' not in ('account','document','website','other') then raise exception 'Resource requirement kind is invalid' using errcode='22023'; end if;
    if entry->>'id'=any(ids) then raise exception 'Resource requirement identities must be unique' using errcode='22023'; end if;
    ids:=array_append(ids,entry->>'id');
  end loop;
  base := p_record - 'schemaVersion' - 'digest';
  computed := encode(extensions.digest(convert_to(rove_private.canonical_jsonb(base),'UTF8'),'sha256'),'hex');
  if computed <> p_record->>'digest' then raise exception 'Portable Workflow digest does not match its content' using errcode='22023'; end if;
end $$;
revoke all on function rove_private.assert_portable_snapshot(jsonb) from public,anon,authenticated;

create table public.rove_workflow_configurations (
  owner_id uuid not null references auth.users(id) on delete cascade,
  workflow_id text not null check (workflow_id ~ '^workflow_[A-Za-z0-9_-]{8,200}$'),
  remote_revision bigint not null check (remote_revision > 0),
  change_sequence bigint not null,
  state text not null check (state in ('active', 'deleted')),
  snapshot jsonb,
  deleted_at timestamptz,
  updated_at timestamptz not null,
  primary key (owner_id, workflow_id),
  check ((state = 'active' and snapshot is not null and deleted_at is null) or
         (state = 'deleted' and snapshot is null and deleted_at is not null))
);
create table public.rove_workflow_changes (
  sequence bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  workflow_id text not null,
  remote_revision bigint not null,
  record jsonb not null,
  changed_at timestamptz not null
);
create index rove_workflow_changes_owner_sequence on public.rove_workflow_changes(owner_id, sequence);
create table public.rove_workflow_operations (
  owner_id uuid not null references auth.users(id) on delete cascade,
  operation_id text not null,
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  result jsonb not null,
  accepted_at timestamptz not null,
  primary key (owner_id, operation_id)
);
create table public.rove_workflow_sync_floors (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  minimum_sequence bigint not null default 0,
  updated_at timestamptz not null
);

alter table public.rove_workflow_configurations enable row level security;
alter table public.rove_workflow_changes enable row level security;
alter table public.rove_workflow_operations enable row level security;
alter table public.rove_workflow_sync_floors enable row level security;
revoke all on public.rove_workflow_configurations from anon, authenticated;
revoke all on public.rove_workflow_changes from anon, authenticated;
revoke all on public.rove_workflow_operations from anon, authenticated;
revoke all on public.rove_workflow_sync_floors from anon, authenticated;
revoke all on sequence public.rove_workflow_changes_sequence_seq from anon, authenticated;
create policy rove_workflow_configurations_owner on public.rove_workflow_configurations
  for all to authenticated using ((select auth.uid()) is not null and owner_id = (select auth.uid()))
  with check ((select auth.uid()) is not null and owner_id = (select auth.uid()));
create policy rove_workflow_changes_owner on public.rove_workflow_changes
  for select to authenticated using ((select auth.uid()) is not null and owner_id = (select auth.uid()));
create policy rove_workflow_operations_owner on public.rove_workflow_operations
  for select to authenticated using ((select auth.uid()) is not null and owner_id = (select auth.uid()));
create policy rove_workflow_sync_floors_owner on public.rove_workflow_sync_floors
  for select to authenticated using ((select auth.uid()) is not null and owner_id = (select auth.uid()));

create or replace function public.rove_workflow_write(
  p_owner_id uuid, p_operation_id text, p_request_digest text,
  p_expected_remote_revision bigint, p_record jsonb, p_updated_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare existing public.rove_workflow_configurations%rowtype;
  prior public.rove_workflow_operations%rowtype; next_revision bigint; next_sequence bigint; result jsonb; applied_at timestamptz := statement_timestamp(); computed_request_digest text;
begin
  perform rove_private.assert_owner(p_owner_id);
  if p_operation_id is null or p_operation_id !~ '^sync_[A-Za-z0-9_-]{8,200}$' then raise exception 'Sync operation identity is invalid' using errcode='22023'; end if;
  if p_expected_remote_revision is not null and (p_expected_remote_revision < 1 or p_expected_remote_revision > 9007199254740991) then raise exception 'Expected Workflow revision is invalid' using errcode='22023'; end if;
  perform rove_private.assert_portable_snapshot(p_record);
  computed_request_digest := encode(extensions.digest(convert_to(rove_private.canonical_jsonb(jsonb_build_object(
    'kind','write','ownerId',p_owner_id::text,'expectedRemoteRevision',p_expected_remote_revision,
    'snapshotDigest',p_record->>'digest'
  )),'UTF8'),'sha256'),'hex');
  if p_request_digest is null or p_request_digest <> computed_request_digest then raise exception 'Rove operation request digest is invalid' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner_id::text||':'||p_operation_id,0));
  select * into prior from public.rove_workflow_operations where owner_id = p_owner_id and operation_id = p_operation_id;
  if found then
    if prior.request_digest <> p_request_digest then raise exception 'Rove operation identity was reused with different input' using errcode = '23505'; end if;
    return prior.result;
  end if;
  select * into existing from public.rove_workflow_configurations where owner_id = p_owner_id and workflow_id = p_record->>'workflowId' for update;
  if not found then
    if p_expected_remote_revision is not null then raise exception 'Rove Workflow revision conflict' using errcode = '40001'; end if;
    if exists(select 1 from rove_private.deleted_workflow_hashes where owner_id=p_owner_id and workflow_hash=encode(extensions.digest(p_record->>'workflowId','sha256'),'hex')) then raise exception 'A deleted Rove Workflow cannot be resurrected' using errcode='40001'; end if;
    next_revision := 1;
    insert into public.rove_workflow_configurations(owner_id,workflow_id,remote_revision,change_sequence,state,snapshot,deleted_at,updated_at)
      values(p_owner_id,p_record->>'workflowId',next_revision,0,'active',p_record,null,applied_at)
      on conflict(owner_id,workflow_id) do nothing;
    if not found then raise exception 'Rove Workflow revision conflict' using errcode='40001'; end if;
  else
    if existing.state = 'deleted' then raise exception 'A deleted Rove Workflow cannot be resurrected' using errcode = '40001'; end if;
    if p_expected_remote_revision is null or existing.remote_revision <> p_expected_remote_revision then raise exception 'Rove Workflow revision conflict' using errcode = '40001'; end if;
    next_revision := existing.remote_revision + 1;
  end if;
  result := jsonb_build_object('schemaVersion',1,'ownerId',p_owner_id,'workflowId',p_record->>'workflowId','remoteRevision',next_revision,'state','active','snapshot',p_record,'updatedAt',to_char(applied_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  insert into public.rove_workflow_changes(owner_id,workflow_id,remote_revision,record,changed_at) values (p_owner_id,p_record->>'workflowId',next_revision,result,applied_at) returning sequence into next_sequence;
  update public.rove_workflow_configurations set remote_revision=next_revision,change_sequence=next_sequence,state='active',snapshot=p_record,deleted_at=null,updated_at=applied_at
    where owner_id=p_owner_id and workflow_id=p_record->>'workflowId';
  insert into public.rove_workflow_operations(owner_id,operation_id,request_digest,result,accepted_at) values (p_owner_id,p_operation_id,p_request_digest,result,applied_at);
  return result;
end $$;

create or replace function public.rove_workflow_delete(
  p_owner_id uuid, p_workflow_id text, p_operation_id text, p_request_digest text,
  p_expected_remote_revision bigint, p_deleted_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare existing public.rove_workflow_configurations%rowtype;
  prior public.rove_workflow_operations%rowtype; next_sequence bigint; result jsonb; applied_at timestamptz := statement_timestamp(); computed_request_digest text;
begin
  perform rove_private.assert_owner(p_owner_id);
  if p_operation_id is null or p_operation_id !~ '^sync_[A-Za-z0-9_-]{8,200}$' then raise exception 'Sync operation identity is invalid' using errcode='22023'; end if;
  if p_workflow_id is null or p_workflow_id !~ '^workflow_[A-Za-z0-9_-]{8,200}$' then raise exception 'Workflow identity is invalid' using errcode='22023'; end if;
  if p_expected_remote_revision is null or p_expected_remote_revision < 1 or p_expected_remote_revision > 9007199254740991 then raise exception 'Expected Workflow revision is invalid' using errcode='22023'; end if;
  computed_request_digest := encode(extensions.digest(convert_to(rove_private.canonical_jsonb(jsonb_build_object(
    'kind','delete','ownerId',p_owner_id::text,'workflowId',p_workflow_id,
    'expectedRemoteRevision',p_expected_remote_revision,'snapshotDigest',null
  )),'UTF8'),'sha256'),'hex');
  if p_request_digest is null or p_request_digest <> computed_request_digest then raise exception 'Rove operation request digest is invalid' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner_id::text||':'||p_operation_id,0));
  select * into prior from public.rove_workflow_operations where owner_id=p_owner_id and operation_id=p_operation_id;
  if found then
    if prior.request_digest <> p_request_digest then raise exception 'Rove operation identity was reused with different input' using errcode = '23505'; end if;
    return prior.result;
  end if;
  select * into existing from public.rove_workflow_configurations where owner_id=p_owner_id and workflow_id=p_workflow_id for update;
  if not found or existing.remote_revision <> p_expected_remote_revision then raise exception 'Rove Workflow revision conflict' using errcode = '40001'; end if;
  result := jsonb_build_object('schemaVersion',1,'ownerId',p_owner_id,'workflowId',p_workflow_id,'remoteRevision',existing.remote_revision+1,'state','deleted','deletedAt',to_char(applied_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'updatedAt',to_char(applied_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  insert into public.rove_workflow_changes(owner_id,workflow_id,remote_revision,record,changed_at) values (p_owner_id,p_workflow_id,existing.remote_revision+1,result,applied_at) returning sequence into next_sequence;
  update public.rove_workflow_configurations set remote_revision=existing.remote_revision+1,change_sequence=next_sequence,state='deleted',snapshot=null,deleted_at=applied_at,updated_at=applied_at where owner_id=p_owner_id and workflow_id=p_workflow_id;
  insert into rove_private.deleted_workflow_hashes(owner_id,workflow_hash,deleted_at)
    values(p_owner_id,encode(extensions.digest(p_workflow_id,'sha256'),'hex'),applied_at)
    on conflict(owner_id,workflow_hash) do nothing;
  insert into public.rove_workflow_operations(owner_id,operation_id,request_digest,result,accepted_at) values (p_owner_id,p_operation_id,p_request_digest,result,applied_at);
  return result;
end $$;

create or replace function public.rove_workflow_read(p_owner_id uuid,p_workflow_id text)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
declare c public.rove_workflow_configurations%rowtype;
begin
  perform rove_private.assert_owner(p_owner_id);
  select * into c from public.rove_workflow_configurations where owner_id=p_owner_id and workflow_id=p_workflow_id;
  if not found then return null; end if;
  if c.state='active' then return jsonb_build_object('schemaVersion',1,'ownerId',c.owner_id,'workflowId',c.workflow_id,'remoteRevision',c.remote_revision,'state',c.state,'snapshot',c.snapshot,'updatedAt',to_char(c.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')); end if;
  return jsonb_build_object('schemaVersion',1,'ownerId',c.owner_id,'workflowId',c.workflow_id,'remoteRevision',c.remote_revision,'state',c.state,'deletedAt',to_char(c.deleted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'updatedAt',to_char(c.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;

create or replace function public.rove_workflow_list(p_owner_id uuid,p_limit integer,p_after_workflow_id text default null,p_since_sequence bigint default null,p_high_watermark bigint default null,p_snapshot_at timestamptz default null)
returns table(record jsonb,cursor_position bigint,workflow_id text) language plpgsql security definer set search_path = '' stable as $$
begin
  perform rove_private.assert_owner(p_owner_id);
  if p_limit is null or p_limit < 1 or p_limit > 200 then raise exception 'Invalid page size'; end if;
  if p_high_watermark is null or p_high_watermark < 0 then raise exception 'Invalid synchronization high watermark'; end if;
  if p_snapshot_at is null then raise exception 'Invalid synchronization snapshot time'; end if;
  if p_high_watermark < coalesce((select minimum_sequence from public.rove_workflow_sync_floors where owner_id=p_owner_id),0) then raise exception 'WORKFLOW_SYNC_CURSOR_EXPIRED'; end if;
  if p_since_sequence is not null and p_since_sequence < coalesce((select minimum_sequence from public.rove_workflow_sync_floors where owner_id=p_owner_id),0) then raise exception 'WORKFLOW_SYNC_CURSOR_EXPIRED'; end if;
  if p_since_sequence is null then
    return query select latest.record,0::bigint,latest.workflow_id from (
      select distinct on (ch.workflow_id) ch.workflow_id,ch.record
      from public.rove_workflow_changes ch
      where ch.owner_id=p_owner_id and ch.sequence<=p_high_watermark
      order by ch.workflow_id,ch.sequence desc
    ) latest where (p_after_workflow_id is null or latest.workflow_id>p_after_workflow_id)
      and (latest.record->>'state'<>'deleted' or (latest.record->>'deletedAt')::timestamptz>=p_snapshot_at-interval '30 days')
      order by latest.workflow_id limit p_limit;
  else
    return query select ch.record,ch.sequence,ch.workflow_id from public.rove_workflow_changes ch where ch.owner_id=p_owner_id and ch.sequence>p_since_sequence and ch.sequence<=p_high_watermark and (ch.record->>'state'<>'deleted' or (ch.record->>'deletedAt')::timestamptz>=p_snapshot_at-interval '30 days') order by ch.sequence limit p_limit;
  end if;
end $$;

create or replace function public.rove_purge_expired_workflow_tombstones()
returns integer language plpgsql security definer set search_path = '' as $$
declare removed integer; floor_sequence bigint;
  expired_ids text[];
begin
  perform rove_private.assert_owner((select auth.uid()));
  select array_agg(workflow_id),count(*) into expired_ids,removed
    from public.rove_workflow_configurations
    where owner_id=(select auth.uid()) and state='deleted' and deleted_at<statement_timestamp()-interval '30 days';
  if coalesce(removed,0)=0 then return 0; end if;
  floor_sequence := nextval('public.rove_workflow_changes_sequence_seq'::regclass);
  if floor_sequence > 0 then insert into public.rove_workflow_sync_floors(owner_id,minimum_sequence,updated_at) values((select auth.uid()),floor_sequence,now()) on conflict(owner_id) do update set minimum_sequence=greatest(public.rove_workflow_sync_floors.minimum_sequence,excluded.minimum_sequence),updated_at=excluded.updated_at; end if;
  delete from public.rove_workflow_operations where owner_id=(select auth.uid()) and result->>'workflowId'=any(expired_ids);
  delete from public.rove_workflow_changes where owner_id=(select auth.uid()) and workflow_id=any(expired_ids);
  delete from public.rove_workflow_configurations where owner_id=(select auth.uid())
    and workflow_id=any(expired_ids) and deleted_at<statement_timestamp()-interval '30 days';
  return removed;
end $$;

create or replace function public.rove_workflow_sync_position(p_owner_id uuid)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
begin
  perform rove_private.assert_owner(p_owner_id);
  return jsonb_build_object(
    'highWatermark',greatest(
      coalesce((select max(sequence) from public.rove_workflow_changes where owner_id=p_owner_id),0),
      coalesce((select minimum_sequence from public.rove_workflow_sync_floors where owner_id=p_owner_id),0)
    ),
    'snapshotAt',to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
end $$;

create or replace function public.rove_delete_account()
returns void language plpgsql security definer set search_path = '' as $$
declare owner uuid := (select auth.uid());
begin
  perform rove_private.assert_owner(owner);
  insert into rove_private.deleted_owner_hashes(owner_hash,deleted_at) values(encode(extensions.digest(owner::text,'sha256'),'hex'),now()) on conflict(owner_hash) do nothing;
  delete from auth.users where id=owner;
  if not found then raise exception 'Rove account is unavailable'; end if;
end $$;

revoke all on function public.rove_workflow_write(uuid,text,text,bigint,jsonb,timestamptz) from public,anon;
revoke all on function public.rove_workflow_delete(uuid,text,text,text,bigint,timestamptz) from public,anon;
revoke all on function public.rove_workflow_read(uuid,text) from public,anon;
revoke all on function public.rove_workflow_list(uuid,integer,text,bigint,bigint,timestamptz) from public,anon;
revoke all on function public.rove_purge_expired_workflow_tombstones() from public,anon;
revoke all on function public.rove_workflow_sync_position(uuid) from public,anon;
revoke all on function public.rove_delete_account() from public,anon;
grant execute on function public.rove_workflow_write(uuid,text,text,bigint,jsonb,timestamptz) to authenticated;
grant execute on function public.rove_workflow_delete(uuid,text,text,text,bigint,timestamptz) to authenticated;
grant execute on function public.rove_workflow_read(uuid,text) to authenticated;
grant execute on function public.rove_workflow_list(uuid,integer,text,bigint,bigint,timestamptz) to authenticated;
grant execute on function public.rove_purge_expired_workflow_tombstones() to authenticated;
grant execute on function public.rove_workflow_sync_position(uuid) to authenticated;
grant execute on function public.rove_delete_account() to authenticated;
