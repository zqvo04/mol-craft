-- mol-craft 공유 구조 테이블.
-- 익명 사용자가 삽입/조회만 가능하고, 수정·삭제 정책은 만들지 않는다(= 익명은 불가).
create table if not exists public.shared_structures (
  id         text primary key,
  title      text not null default '',
  payload    text not null,               -- io.js encodeStateAsync 결과
  hidden     boolean not null default false,
  created_at timestamptz not null default now(),
  constraint id_format    check (id ~ '^[a-z0-9]{10}$'),
  constraint payload_size check (char_length(payload) between 1 and 20000),
  constraint title_size   check (char_length(title) <= 80)
);

create index if not exists shared_structures_recent_idx
  on public.shared_structures (created_at desc) where not hidden;

alter table public.shared_structures enable row level security;

-- 숨김 처리되지 않은 행은 누구나 읽는다.
create policy "anon read visible" on public.shared_structures
  for select to anon using (not hidden);

-- 누구나 삽입할 수 있다. 방어선은 위의 CHECK 제약이다.
-- hidden을 true로 넣어 갤러리를 오염시키는 것도 막는다.
create policy "anon insert" on public.shared_structures
  for insert to anon with check (not hidden);

-- update / delete 정책 없음 = 익명 사용자는 수정·삭제할 수 없다.
