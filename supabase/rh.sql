-- =====================================================================
-- Sistema Veneza — RH (funcionários, escala rotativa, ocorrências, holerites)
-- Rode DEPOIS do schema.sql (usa email_atual, autorizado, marcar_autoria e configuracoes).
-- Cole no SQL Editor do Supabase e clique em "Run". Pode rodar de novo: não apaga dados.
-- Só quem está em usuarios_autorizados lê ou grava. Salário em CENTAVOS.
-- Semana de referência da escala: configuracoes.rh_semana_ref (uma segunda-feira, "AAAA-MM-DD").
-- =====================================================================

-- Horários (ex.: Manhã, Tarde): entrada, saída e intervalo (minutos) por dia ("1" = segunda ... "6" = sábado)
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
    -- intervalo (almoço) em minutos, opcional: 0 a 240
    if coalesce(x ->> 'intervalo', '0') !~ '^[0-9]{1,3}$' or (x ->> 'intervalo')::int > 240 then
      raise exception 'Intervalo inválido no horário (0 a 240 minutos).';
    end if;
    r := r || jsonb_build_object(d, jsonb_build_object('entrada', x ->> 'entrada', 'saida', x ->> 'saida')
      || case when coalesce((x ->> 'intervalo')::int, 0) > 0 then jsonb_build_object('intervalo', (x ->> 'intervalo')::int) else '{}'::jsonb end);
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

-- =====================================================================
-- RH completo (nov/2026): ficha com todos os dados, gratificação, desligamento e rescisão,
-- histórico, férias, banco de horas, exames (ASO), treinamentos e entrega de EPI/uniforme.
-- Pode rodar de novo: só acrescenta colunas e tabelas.
-- Configurações usadas: rh_encargos (JSON: {"regime": "simples"} ou {"regime": "normal", "inss": 2780}).
-- =====================================================================

-- Ficha completa (decisão do Italo em nov/2026: guardar todos os dados necessários, só no banco)
alter table public.rh_funcionarios add column if not exists nascimento date;
alter table public.rh_funcionarios add column if not exists cpf text not null default '';
alter table public.rh_funcionarios add column if not exists rg text not null default '';
alter table public.rh_funcionarios add column if not exists pis text not null default '';
alter table public.rh_funcionarios add column if not exists ctps text not null default '';
alter table public.rh_funcionarios add column if not exists endereco text not null default '';
alter table public.rh_funcionarios add column if not exists email text not null default '';
alter table public.rh_funcionarios add column if not exists estado_civil text not null default '';
alter table public.rh_funcionarios add column if not exists escolaridade text not null default '';
alter table public.rh_funcionarios add column if not exists dependentes smallint not null default 0;
alter table public.rh_funcionarios add column if not exists contato_emergencia text not null default '';
alter table public.rh_funcionarios add column if not exists pix text not null default '';
alter table public.rh_funcionarios add column if not exists uniforme text not null default '';
alter table public.rh_funcionarios add column if not exists gratificacao_centavos bigint not null default 0;
alter table public.rh_funcionarios add column if not exists jornada_semanal_min integer not null default 2640;  -- 44h
-- desligamento: tipo, aviso prévio, motivo, passo a passo (JSON {"item": true}) e saldo do FGTS (para a rescisão)
alter table public.rh_funcionarios add column if not exists desligamento_tipo text not null default '';
alter table public.rh_funcionarios add column if not exists desligamento_aviso text not null default '';
alter table public.rh_funcionarios add column if not exists desligamento_motivo text not null default '';
alter table public.rh_funcionarios add column if not exists desligamento_passos jsonb not null default '{}'::jsonb;
alter table public.rh_funcionarios add column if not exists fgts_saldo_centavos bigint;

alter table public.rh_funcionarios drop constraint if exists rh_funcionarios_dados_check;
alter table public.rh_funcionarios add constraint rh_funcionarios_dados_check check (
  cpf ~ '^([0-9]{11})?$' and pis ~ '^([0-9]{11})?$'
  and length(rg) <= 30 and length(ctps) <= 30 and length(endereco) <= 200 and length(email) <= 120
  and length(estado_civil) <= 30 and length(escolaridade) <= 60 and dependentes between 0 and 20
  and length(contato_emergencia) <= 120 and length(pix) <= 120 and length(uniforme) <= 60
  and gratificacao_centavos >= 0 and jornada_semanal_min between 60 and 2640
  and desligamento_tipo in ('', 'sem_justa_causa', 'pedido', 'justa_causa', 'acordo')
  and desligamento_aviso in ('', 'indenizado', 'trabalhado', 'dispensado', 'nao_cumprido')
  and length(desligamento_motivo) <= 300 and jsonb_typeof(desligamento_passos) = 'object'
  and (fgts_saldo_centavos is null or fgts_saldo_centavos >= 0)
);

-- Ocorrências novas: advertência, suspensão (até 30 dias, art. 474 da CLT) e elogio.
-- "banco": folga que desconta do banco de horas / feriado trabalhado que vira crédito no banco.
alter table public.rh_ocorrencias add column if not exists banco boolean not null default false;
alter table public.rh_ocorrencias drop constraint if exists rh_ocorrencias_tipo_check;
alter table public.rh_ocorrencias add constraint rh_ocorrencias_tipo_check
  check (tipo in ('folga', 'falta', 'atestado', 'feriado_trabalhado', 'advertencia', 'suspensao', 'elogio'));
alter table public.rh_ocorrencias drop constraint if exists rh_ocorrencias_suspensao_check;
alter table public.rh_ocorrencias add constraint rh_ocorrencias_suspensao_check check (tipo <> 'suspensao' or dias <= 30);
alter table public.rh_ocorrencias drop constraint if exists rh_ocorrencias_banco_check;
alter table public.rh_ocorrencias add constraint rh_ocorrencias_banco_check check (not banco or tipo in ('folga', 'feriado_trabalhado'));

-- Banco de horas: lançamentos à mão (+ hora a mais, − saiu mais cedo / chegou atrasado), em minutos
create table if not exists public.rh_banco_horas (
  id          uuid primary key default gen_random_uuid(),
  funcionario uuid not null references public.rh_funcionarios (id) on delete restrict,
  data        date not null,
  minutos     integer not null check (minutos <> 0 and minutos between -14400 and 14400),
  motivo      text not null default '' check (length(motivo) <= 300),
  criado_por  text not null default public.email_atual(),
  criado_em   timestamptz not null default now(),
  editado_por text,
  editado_em  timestamptz
);
create index if not exists rh_banco_horas_func_idx on public.rh_banco_horas (funcionario, data);

-- Férias: cada período tirado (ou programado), ligado ao período aquisitivo (que começa no aniversário da admissão)
create table if not exists public.rh_ferias (
  id                uuid primary key default gen_random_uuid(),
  funcionario       uuid not null references public.rh_funcionarios (id) on delete restrict,
  aquisitivo_inicio date not null,
  inicio            date not null,
  dias              smallint not null check (dias between 5 and 30),
  observacao        text not null default '' check (length(observacao) <= 300),
  criado_por        text not null default public.email_atual(),
  criado_em         timestamptz not null default now(),
  editado_por       text,
  editado_em        timestamptz,
  constraint rh_ferias_unica unique (funcionario, inicio)
);

-- Dois períodos de férias do mesmo funcionário não podem se cruzar
create or replace function public.rh_ferias_validar()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.rh_ferias f
             where f.funcionario = new.funcionario and f.id <> new.id
               and f.inicio <= new.inicio + new.dias - 1 and new.inicio <= f.inicio + f.dias - 1) then
    raise exception 'Essas férias se cruzam com outro período do mesmo funcionário.';
  end if;
  return new;
end;
$$;
drop trigger if exists rh_ferias_validar on public.rh_ferias;
create trigger rh_ferias_validar
  before insert or update on public.rh_ferias
  for each row execute function public.rh_ferias_validar();

-- Histórico da ficha: mudança de função, salário, gratificação e turma (o gatilho grava sozinho)
create table if not exists public.rh_historico (
  id          uuid primary key default gen_random_uuid(),
  funcionario uuid not null references public.rh_funcionarios (id) on delete cascade,
  data        date not null default current_date,
  campo       text not null check (campo in ('funcao', 'salario', 'gratificacao', 'turma', 'outro')),
  antes       text not null default '' check (length(antes) <= 120),
  depois      text not null default '' check (length(depois) <= 120),
  observacao  text not null default '' check (length(observacao) <= 300),
  criado_por  text not null default public.email_atual(),
  criado_em   timestamptz not null default now(),
  editado_por text,
  editado_em  timestamptz
);
create index if not exists rh_historico_func_idx on public.rh_historico (funcionario, data);

create or replace function public.rh_funcionario_historico()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.funcao is distinct from old.funcao then
    insert into public.rh_historico (funcionario, campo, antes, depois) values (new.id, 'funcao', coalesce(old.funcao, ''), coalesce(new.funcao, ''));
  end if;
  if new.salario_centavos is distinct from old.salario_centavos then
    insert into public.rh_historico (funcionario, campo, antes, depois)
    values (new.id, 'salario', coalesce(old.salario_centavos::text, ''), coalesce(new.salario_centavos::text, ''));
  end if;
  if new.gratificacao_centavos is distinct from old.gratificacao_centavos then
    insert into public.rh_historico (funcionario, campo, antes, depois)
    values (new.id, 'gratificacao', old.gratificacao_centavos::text, new.gratificacao_centavos::text);
  end if;
  if new.turma is distinct from old.turma then
    insert into public.rh_historico (funcionario, campo, antes, depois) values (new.id, 'turma',
      coalesce((select nome from public.rh_turmas where id = old.turma), ''), coalesce((select nome from public.rh_turmas where id = new.turma), ''));
  end if;
  return null;
end;
$$;
drop trigger if exists rh_funcionarios_historico on public.rh_funcionarios;
create trigger rh_funcionarios_historico
  after update on public.rh_funcionarios
  for each row execute function public.rh_funcionario_historico();

-- Exames ocupacionais (ASO): admissional, periódico, retorno ao trabalho, mudança de função e demissional
create table if not exists public.rh_exames (
  id          uuid primary key default gen_random_uuid(),
  funcionario uuid not null references public.rh_funcionarios (id) on delete restrict,
  tipo        text not null check (tipo in ('admissional', 'periodico', 'retorno', 'mudanca', 'demissional')),
  data        date not null,
  validade    date,
  apto        boolean not null default true,
  observacao  text not null default '' check (length(observacao) <= 300),
  criado_por  text not null default public.email_atual(),
  criado_em   timestamptz not null default now(),
  editado_por text,
  editado_em  timestamptz,
  constraint rh_exame_validade check (validade is null or validade >= data)
);

-- Treinamentos (ex.: boas práticas na manipulação de alimentos)
create table if not exists public.rh_treinamentos (
  id          uuid primary key default gen_random_uuid(),
  funcionario uuid not null references public.rh_funcionarios (id) on delete restrict,
  data        date not null,
  nome        text not null check (length(btrim(nome)) between 1 and 80),
  horas       smallint check (horas between 1 and 999),
  validade    date,
  observacao  text not null default '' check (length(observacao) <= 300),
  criado_por  text not null default public.email_atual(),
  criado_em   timestamptz not null default now(),
  editado_por text,
  editado_em  timestamptz
);

-- Entrega de EPI e uniforme (CA = certificado de aprovação do EPI)
create table if not exists public.rh_entregas (
  id           uuid primary key default gen_random_uuid(),
  funcionario  uuid not null references public.rh_funcionarios (id) on delete restrict,
  data         date not null,
  item         text not null check (length(btrim(item)) between 1 and 80),
  quantidade   smallint not null default 1 check (quantidade between 1 and 99),
  ca           text not null default '' check (length(ca) <= 20),
  devolvido_em date,
  observacao   text not null default '' check (length(observacao) <= 300),
  criado_por   text not null default public.email_atual(),
  criado_em    timestamptz not null default now(),
  editado_por  text,
  editado_em   timestamptz,
  constraint rh_entrega_devolucao check (devolvido_em is null or devolvido_em >= data)
);

do $$
declare t text;
begin
  foreach t in array array['rh_banco_horas', 'rh_ferias', 'rh_historico', 'rh_exames', 'rh_treinamentos', 'rh_entregas'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_autoria', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.marcar_autoria()',
      t || '_autoria', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists "autorizados podem tudo" on public.%I', t);
    execute format('create policy "autorizados podem tudo" on public.%I for all to authenticated using (public.autorizado()) with check (public.autorizado())', t);
  end loop;
end $$;
