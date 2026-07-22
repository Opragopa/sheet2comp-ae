-- PostgreSQL target schema for the conference content plan model.
-- Old TSV-like entities map as:
-- plates -> badges + session_people
-- all_people -> people + person_positions
-- sessions -> sessions + topics
-- cards -> cards

create extension if not exists pgcrypto;

create table if not exists venues (
  id text primary key,
  source_column text not null unique,
  name text not null,
  color text not null,
  created_at timestamptz not null default now()
);

insert into venues (id, source_column, name, color) values
  ('amphitheater', 'B', 'Амфитеатр', 'red'),
  ('ural_1', 'C', 'Урал 1', 'blue'),
  ('ural_2', 'D', 'Урал 2', 'red')
on conflict (id) do update set
  source_column = excluded.source_column,
  name = excluded.name,
  color = excluded.color;

create table if not exists topics (
  id uuid primary key default gen_random_uuid(),
  normalized_title text not null unique,
  title text not null,
  description text,
  source_cell text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists people (
  id uuid primary key default gen_random_uuid(),
  normalized_name text not null unique,
  display_name text not null,
  first_name text,
  last_name text,
  photo_url text,
  photo_local_path text,
  source_cells text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists person_positions (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  position text not null,
  normalized_position text not null,
  unique (person_id, normalized_position)
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  day text not null,
  date text,
  time_label text,
  time_start text,
  time_end text,
  venue_id text not null references venues(id),
  topic_id uuid references topics(id),
  format_name text,
  graphic_type text not null default 'badge',
  source_cell text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (day, date, time_start, time_end, venue_id, topic_id)
);

create table if not exists session_people (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  role text not null default 'speaker',
  position_at_event text,
  badge_needed boolean not null default true,
  card_needed boolean not null default false,
  source_cell text,
  unique (session_id, person_id, role)
);

create table if not exists badges (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null unique references people(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists cards (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null unique references people(id) on delete cascade,
  display_name text not null,
  position text,
  photo_url text,
  photo_local_path text,
  status text not null check (status in ('ready', 'missing_photo', 'missing_position', 'draft')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Optional legacy staging tables for one-time migration from old TSV exports.
create table if not exists legacy_plates (
  day text,
  date text,
  time text,
  venue text,
  type text,
  speaker_name text,
  position text,
  photo text,
  topic text,
  source_cell text
);

create table if not exists legacy_sessions (
  day text,
  date text,
  time text,
  venue text,
  topic text,
  description text,
  type text,
  source_cell text
);

create table if not exists legacy_all_people (
  speaker_name text,
  position text,
  photo text,
  source_cell text
);

create table if not exists legacy_cards (
  day text,
  date text,
  time text,
  venue text,
  type text,
  speaker_name text,
  position text,
  photo text,
  topic text,
  source_cell text
);

-- After application-level normalized import succeeds, archive old staging:
-- alter table legacy_plates rename to archived_legacy_plates;
-- alter table legacy_sessions rename to archived_legacy_sessions;
-- alter table legacy_all_people rename to archived_legacy_all_people;
-- alter table legacy_cards rename to archived_legacy_cards;
