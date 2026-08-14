-- Mol-Craft 분자 카탈로그 및 로그인 사용자 즐겨찾기.
-- GitHub Pages 앱은 카탈로그를 공개 읽기만 하고, 즐겨찾기는 auth.uid()와 일치하는 사용자만 읽고 쓸 수 있다.
create table if not exists public.molecule_catalog (
  id bigint generated always as identity primary key,
  slug text not null unique,
  name text not null,
  common_name text,
  pubchem_cid integer unique,
  cas_number text,
  molecular_formula text,
  molecular_weight double precision,
  canonical_smiles text,
  isomeric_smiles text,
  category text not null check (category in ('inorganic', 'organic', 'solvent', 'biochemical', 'drug', 'polymer')),
  xlogp double precision,
  h_bond_donor_count integer,
  h_bond_acceptor_count integer,
  rotatable_bond_count integer,
  exact_mass double precision,
  topological_polar_surface_area double precision,
  complexity double precision,
  charge integer,
  boiling_point text,
  melting_point text,
  density text,
  solubility text,
  appearance text,
  source text not null default 'PubChem',
  source_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists molecule_catalog_name_idx on public.molecule_catalog (name);
create index if not exists molecule_catalog_common_name_idx on public.molecule_catalog (common_name);
create index if not exists molecule_catalog_formula_idx on public.molecule_catalog (molecular_formula);
create index if not exists molecule_catalog_cas_idx on public.molecule_catalog (cas_number);
create index if not exists molecule_catalog_category_idx on public.molecule_catalog (category);

alter table public.molecule_catalog enable row level security;
drop policy if exists "public read molecule catalog" on public.molecule_catalog;
create policy "public read molecule catalog" on public.molecule_catalog for select using (true);

create table if not exists public.molecule_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  molecule_id bigint not null references public.molecule_catalog(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, molecule_id)
);

create index if not exists molecule_favorites_user_idx on public.molecule_favorites (user_id, created_at desc);
alter table public.molecule_favorites enable row level security;
drop policy if exists "users manage own molecule favorites" on public.molecule_favorites;
create policy "users manage own molecule favorites" on public.molecule_favorites
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
