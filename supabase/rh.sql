-- =====================================================================
-- Sistema Veneza — RH (funcionários, escala rotativa, ocorrências, holerites)
-- Rode DEPOIS do schema.sql (usa email_atual, autorizado, marcar_autoria e configuracoes).
-- Cole no SQL Editor do Supabase e clique em "Run". Pode rodar de novo: não apaga dados.
-- Só quem está em usuarios_autorizados lê ou grava. Salário em CENTAVOS.
-- Semana de referência da escala: configuracoes.rh_semana_ref (uma segunda-feira, "AAAA-MM-DD").
-- =====================================================================

-- Horários (ex.: Manhã, Tarde): entrada e saída por dia da semana ("1" = segunda ... "6" = sábado)
create table if not exists public.rh_horarios (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null check (length(btrim(nome)) between 1 and 40),
  ordem       smallint not null default 0 check (ordem between 0 and 9),
  dias        jsonb not null default '{}'::jsonb,
  criado_por  text not null default public.email_atual(),
  criado_em   timestamptz not null default now(),
  editado_por text,
  editado_em  timestamptz
);

-- Turmas: revezam os horários a cada semana (ordem 0 faz o horário 0 na semana de referência)
create table if not exists public.rh_turmas (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null check (length(btrim(nome)) between 1 and 40),
  ordem       smallint not null default 0 check (ordem between 0 and 9),
  criado_por  text not null default public.email_atual(),
  criado_em   timestamptz not null default now(),
  editado_por text,
  editado_em  timestamptz
);

create table if not exists public.rh_funcionarios (
  id               uuid primary key default gen_random_uuid(),
  nome             text not null check (length(btrim(nome)) between 1 and 80),
  funcao           text not null default '' check (length(funcao) <= 60),
  admissao         date,
  desligamento     date,               -- preenchido = desligado
  telefone         text not null default '' check (telefone ~ '^[0-9 ()+-]{0,20}$'),
  salario_centavos bigint check (salario_centavos >= 0),
  turma            uuid references public.rh_turmas (id) on delete set null,
  observacao       text not null default '' check (length(observacao) <= 2000),
  criado_por       text not null default public.email_atual(),
  criado_em        timestamptz not null default now(),
  editado_por      text,
  editado_em       timestamptz,
  constraint rh_desligamento_depois check (desligamento is null or admissao is null or desligamento >= admissao)
);

-- Folga, falta (justificada ou não), atestado (dias corridos a partir da data) e feriado trabalhado
create table if not exists public.rh_ocorrencias (
  id          uuid primary key default gen_random_uuid(),
  funcionario uuid not null references public.rh_funcionarios (id) on delete restrict,
  tipo        text not null check (tipo in ('folga', 'falta', 'atestado', 'feriado_trabalhado')),
  data        date not null,
  dias        smallint not null default 1 check (dias between 1 and 365),
  justificada boolean not null default false,
  motivo      text not null default '' check (length(motivo) <= 300),
  criado_por  text not null default public.email_atual(),
  criado_em   timestamptz not null default now(),
  editado_por text,
  editado_em  timestamptz,
  constraint rh_ocorrencia_unica unique (funcionario, data, tipo)
);
create index if not exists rh_ocorrencias_data_idx on public.rh_ocorrencias (data);

-- Feriados municipais/estaduais (os nacionais o sistema já sabe)
create table if not exists public.rh_feriados (
  id          uuid primary key default gen_random_uuid(),
  data        date not null unique,
  nome        text not null check (length(btrim(nome)) between 1 and 60),
  criado_por  text not null default public.email_atual(),
  criado_em   timestamptz not null default now(),
  editado_por text,
  editado_em  timestamptz
);

-- Holerite: só o registro de que chegou do contador (o arquivo não é guardado)
create table if not exists public.rh_holerites (
  id          uuid primary key default gen_random_uuid(),
  funcionario uuid not null references public.rh_funcionarios (id) on delete restrict,
  referencia  date not null check (extract(day from referencia) = 1),   -- mês: dia 1
  recebido_em date not null,
  observacao  text not null default '' check (length(observacao) <= 300),
  criado_por  text not null default public.email_atual(),
  criado_em   timestamptz not null default now(),
  editado_por text,
  editado_em  timestamptz,
  constraint rh_holerite_unico unique (funcionario, referencia)
);

-- Horários: guarda só segunda a sábado, com entrada e saída "HH:MM" válidas
create or replace function public.rh_horario_normalizar()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  d text;
  x jsonb;
  r jsonb := '{}'::jsonb;
begin
  if new.dias is null or jsonb_typeof(new.dias) <> 'object' then
    raise exception 'horário inválido';
  end if;
  foreach d in array array['1', '2', '3', '4', '5', '6'] loop
    x := new.dias -> d;
    if x is null or x = 'null'::jsonb then continue; end if;
    if coalesce(x ->> 'entrada', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or coalesce(x ->> 'saida', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'Hora inválida no horário (use HH:MM).';
    end if;
    r := r || jsonb_build_object(d, jsonb_build_object('entrada', x ->> 'entrada', 'saida', x ->> 'saida'));
  end loop;
  new.dias := r;
  return new;
end;
$$;

drop trigger if exists rh_horarios_normalizar on public.rh_horarios;
create trigger rh_horarios_normalizar
  before insert or update on public.rh_horarios
  for each row execute function public.rh_horario_normalizar();

-- Autoria (quem criou/editou) em todas as tabelas do RH
do $$
declare t text;
begin
  foreach t in array array['rh_horarios', 'rh_turmas', 'rh_funcionarios', 'rh_ocorrencias', 'rh_feriados', 'rh_holerites'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_autoria', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.marcar_autoria()',
      t || '_autoria', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists "autorizados podem tudo" on public.%I', t);
    execute format('create policy "autorizados podem tudo" on public.%I for all to authenticated using (public.autorizado()) with check (public.autorizado())', t);
  end loop;
end $$;
