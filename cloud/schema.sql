-- ============================================================
-- FKI 한경협국제경영원 인재교육사업실 — 설문 시스템 스키마
-- Supabase SQL Editor에 그대로 붙여넣고 실행한다.
-- ============================================================

create table if not exists public.surveys (
  id           text primary key,
  type         text        not null check (type in ('A', 'B')),
  title        text        not null,
  intro        text        not null default '',
  outro        text        not null default '',
  active       boolean     not null default true,
  collect_name boolean     not null default false,
  sections     jsonb       not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.responses (
  id           text primary key,
  survey_id    text        not null references public.surveys(id) on delete cascade,
  submitted_at timestamptz not null default now(),
  respondent   jsonb       not null default '{}'::jsonb,
  answers      jsonb       not null default '{}'::jsonb
);

create index if not exists responses_survey_idx
  on public.responses (survey_id, submitted_at);

-- ------------------------------------------------------------
-- 접근 제어
--
-- RLS를 켜되 정책은 하나도 만들지 않는다. anon / authenticated 키로는
-- 두 테이블에 아무것도 읽거나 쓸 수 없다. 모든 접근은 Cloudflare Worker가
-- service_role 키로만 수행한다 (service_role은 RLS를 우회한다).
-- 따라서 브라우저에는 어떤 Supabase 키도 노출되지 않는다.
-- ------------------------------------------------------------

alter table public.surveys   enable row level security;
alter table public.responses enable row level security;

revoke all on public.surveys   from anon, authenticated;
revoke all on public.responses from anon, authenticated;

-- ------------------------------------------------------------
-- 설문별 응답 수 (실시간 표시용)
-- 한 번의 호출로 전체 설문의 응답 수를 받는다.
-- ------------------------------------------------------------

create or replace function public.survey_counts()
returns table (survey_id text, n integer)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, count(r.id)::int
  from public.surveys s
  left join public.responses r on r.survey_id = s.id
  group by s.id;
$$;

revoke all on function public.survey_counts() from anon, authenticated, public;
grant execute on function public.survey_counts() to service_role;

-- ------------------------------------------------------------
-- updated_at 자동 갱신
-- ------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists surveys_touch on public.surveys;
create trigger surveys_touch
  before update on public.surveys
  for each row execute function public.touch_updated_at();
