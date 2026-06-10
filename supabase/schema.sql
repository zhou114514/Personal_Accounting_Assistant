-- 记账助手 Supabase 数据库 schema
-- 在 Supabase Dashboard → SQL Editor 中执行此文件

-- 卡片
create table if not exists cards (
  id text primary key,
  user_id uuid references auth.users not null,
  name text not null,
  type text not null check (type in ('debit', 'credit')),
  balance numeric not null default 0,
  credit_limit numeric not null default 0,
  color text not null,
  created_at bigint not null
);

-- 交易记录
create table if not exists transactions (
  id text primary key,
  user_id uuid references auth.users not null,
  date date not null,
  type text not null check (type in ('expense', 'income', 'transfer')),
  category text not null default '',
  description text default '',
  amount numeric not null,
  card_id text default '',
  from_card_id text default '',
  to_card_id text default '',
  created_at bigint not null
);

-- 分类
create table if not exists categories (
  id text primary key,
  user_id uuid references auth.users not null,
  name text not null,
  icon text not null,
  type text not null check (type in ('expense', 'income'))
);

-- 用户设置
create table if not exists user_settings (
  user_id uuid primary key references auth.users,
  payday int not null default 10
);

-- 行级安全
alter table cards enable row level security;
alter table transactions enable row level security;
alter table categories enable row level security;
alter table user_settings enable row level security;

-- 删除旧策略（若重复执行）
drop policy if exists "cards_own" on cards;
drop policy if exists "transactions_own" on transactions;
drop policy if exists "categories_own" on categories;
drop policy if exists "settings_own" on user_settings;

create policy "cards_own" on cards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "transactions_own" on transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "categories_own" on categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "settings_own" on user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
