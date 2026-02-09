-- Run this in your Supabase SQL Editor to set up the database

create table if not exists journal_entries (
  id uuid default gen_random_uuid() primary key,
  date date not null,
  time_of_day text not null check (time_of_day in ('morning', 'evening')),
  content text not null,
  created_at timestamptz default now(),

  -- One entry per time-of-day per date
  unique(date, time_of_day)
);

-- Index for fast calendar queries
create index if not exists idx_journal_entries_date on journal_entries(date);

-- Enable Row Level Security (optional, since single user)
-- alter table journal_entries enable row level security;
