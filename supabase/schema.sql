-- =====================================================================
-- Sistema Veneza — banco de dados (Supabase / Postgres)
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em "Run".
-- Pode rodar de novo sem problema: ele não apaga dados.
-- Todos os valores em dinheiro são CENTAVOS inteiros (bigint).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Quem pode usar o sistema
-- ---------------------------------------------------------------------
create table if not exists public.usuarios_autorizados (
  email     text primary key,
  nome      text,
  criado_em timestamptz not null default now(),
  constraint email_minusculo check (email = lower(email))
);

-- E-mail do usuário logado (vem do token do Supabase Auth)
create or replace function public.email_atual()
returns text
language sql stable
set search_path = public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

-- true se o usuário logado está na lista de autorizados
create or replace function public.autorizado()
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.usuarios_autorizados u
    where u.email = public.email_atual()
  )
$$;

revoke all on function public.autorizado() from public, anon;
grant execute on function public.autorizado() to authenticated;

-- ---------------------------------------------------------------------
-- 2. Conferências de caixa (abertura e fechamento)
-- ---------------------------------------------------------------------
create table if not exists public.conferencias (
  id                             uuid primary key default gen_random_uuid(),
  tipo                           text not null check (tipo in ('abertura', 'fechamento')),
  caixa                          text not null check (length(caixa) between 1 and 40),
  operador                       text not null default '' check (length(operador) <= 80),
  data                           date not null,
  hora                           time not null,
  -- quantidade por valor, em centavos: {"200": 25, "5000": 9, "25": 37}
  contagem                       jsonb not null default '{}'::jsonb,
  -- calculados pelo banco a partir da contagem (ver gatilho abaixo)
  total_cedulas_centavos         bigint not null default 0,
  total_moedas_centavos          bigint not null default 0,
  total_centavos                 bigint not null default 0,
  -- só no fechamento: valores digitados do sistema Diamante
  fundo_centavos                 bigint check (fundo_centavos >= 0),
  vendas_dinheiro_centavos       bigint check (vendas_dinheiro_centavos >= 0),
  recebimentos_dinheiro_centavos bigint check (recebimentos_dinheiro_centavos >= 0),
  pix_centavos                   bigint check (pix_centavos >= 0),
  debito_centavos                bigint check (debito_centavos >= 0),
  credito_centavos               bigint check (credito_centavos >= 0),
  carteira_centavos              bigint check (carteira_centavos >= 0),
  troco_amanha_centavos          bigint check (troco_amanha_centavos >= 0),
  -- calculados pelo banco (somam as sangrias/suprimentos do dia e caixa)
  sangrias_centavos              bigint,
  suprimentos_centavos           bigint,
  esperado_centavos              bigint,
  diferenca_centavos             bigint,
  observacao                     text not null default '' check (length(observacao) <= 2000),
  criado_por                     text not null default public.email_atual(),
  criado_em                      timestamptz not null default now(),
  editado_por                    text,
  editado_em                     timestamptz
);

-- Conferência 2.0 (nov/2026): cupom "Fechamento de turno" do Diamante, lido do PDF ou digitado.
-- Quando existe, o banco tira dele o fundo, as vendas/recebimentos em dinheiro e as SANGRIAS.
alter table public.conferencias add column if not exists cupom jsonb;
-- Soma das sangrias lançadas no sistema (para comparar com as do cupom)
alter table public.conferencias add column if not exists sangrias_lancadas_centavos bigint;

create index if not exists conferencias_data_caixa_idx on public.conferencias (data desc, caixa);
create index if not exists conferencias_fechamento_idx on public.conferencias (caixa, data) where tipo = 'fechamento';

-- ---------------------------------------------------------------------
-- 3. Sangrias (retiradas) e suprimentos (reforço de troco)
-- ---------------------------------------------------------------------
create table if not exists public.movimentos (
  id             uuid primary key default gen_random_uuid(),
  tipo           text not null check (tipo in ('sangria', 'suprimento')),
  caixa          text not null check (length(caixa) between 1 and 40),
  data           date not null,
  hora           time not null,
  valor_centavos bigint not null check (valor_centavos > 0),
  motivo         text not null default '' check (length(motivo) <= 300),
  responsavel    text not null default '' check (length(responsavel) <= 80),
  criado_por     text not null default public.email_atual(),
  criado_em      timestamptz not null default now(),
  editado_por    text,
  editado_em     timestamptz
);

create index if not exists movimentos_data_caixa_idx on public.movimentos (data desc, caixa);

-- ---------------------------------------------------------------------
-- 4. Gatilhos: o banco confere as contas e marca quem criou/editou
-- ---------------------------------------------------------------------

-- Nome do cliente abreviado: "MARIA APARECIDA DE CARVALHO" -> "MARIA A." (igual ao diamante.js)
create or replace function public.abreviar_nome(t text)
returns text
language plpgsql immutable
set search_path = public
as $$
declare
  a text[];
  i int;
begin
  a := regexp_split_to_array(btrim(regexp_replace(regexp_replace(upper(coalesce(t, '')), '\(.*?\)', ' ', 'g'),
         '[^[:alnum:][:space:]-]', ' ', 'g')), '\s+');
  if a is null or array_length(a, 1) is null or a[1] = '' then
    return '';
  end if;
  for i in 2 .. array_length(a, 1) loop
    if a[i] not in ('DA', 'DE', 'DI', 'DO', 'DU', 'DAS', 'DOS', 'E') then
      return left(a[1], 20) || ' ' || left(a[i], 1) || '.';
    end if;
  end loop;
  return left(a[1], 20);
end;
$$;

-- Valor em centavos dentro do cupom: número inteiro (null vira 0)
create or replace function public.cupom_centavos(v jsonb, nome text, pode_negativo boolean default false)
returns bigint
language plpgsql immutable
set search_path = public
as $$
declare r bigint;
begin
  if v is null or v = 'null'::jsonb then return 0; end if;
  if jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^-?[0-9]{1,13}$' then
    raise exception 'cupom inválido: % não é um valor em centavos', nome;
  end if;
  r := (v #>> '{}')::bigint;
  if r < 0 and not pode_negativo then
    raise exception 'cupom inválido: % negativo', nome;
  end if;
  return r;
end;
$$;

-- Confere o cupom e guarda só os campos conhecidos (nome do cliente sempre abreviado)
create or replace function public.cupom_normalizar(p jsonb)
returns jsonb
language plpgsql immutable
set search_path = public
as $$
declare
  formas jsonb := '{}'::jsonb;
  f text;
  receb jsonb := '[]'::jsonb;
  sang jsonb := '[]'::jsonb;
  x jsonb;
  t text;
begin
  if p is null or p = 'null'::jsonb then return null; end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'cupom inválido'; end if;
  foreach f in array array['dinheiro', 'carteira', 'credito', 'debito', 'pix', 'pix_delivery'] loop
    formas := formas || jsonb_build_object(f, jsonb_build_object(
      'vendas', public.cupom_centavos(p #> array['formas', f, 'vendas'], f || ' vendas'),
      'receb',  public.cupom_centavos(p #> array['formas', f, 'receb'], f || ' recebimentos')));
  end loop;
  if jsonb_typeof(coalesce(p -> 'recebimentos', '[]')) <> 'array'
     or jsonb_array_length(coalesce(p -> 'recebimentos', '[]')) > 300 then
    raise exception 'cupom inválido: lista de recebimentos';
  end if;
  for x in select * from jsonb_array_elements(coalesce(p -> 'recebimentos', '[]')) loop
    if coalesce(x ->> 'forma', '') not in ('dinheiro', 'carteira', 'credito', 'debito', 'pix', 'pix_delivery') then
      raise exception 'cupom inválido: forma de recebimento';
    end if;
    receb := receb || jsonb_build_array(jsonb_build_object(
      'forma', x ->> 'forma',
      'valor', public.cupom_centavos(x -> 'valor', 'recebimento'),
      'codigo', left(regexp_replace(coalesce(x ->> 'codigo', ''), '\D', '', 'g'), 10),
      'nome', public.abreviar_nome(x ->> 'nome')));
  end loop;
  if jsonb_typeof(coalesce(p -> 'sangrias', '[]')) <> 'array'
     or jsonb_array_length(coalesce(p -> 'sangrias', '[]')) > 100 then
    raise exception 'cupom inválido: lista de sangrias';
  end if;
  for x in select * from jsonb_array_elements(coalesce(p -> 'sangrias', '[]')) loop
    sang := sang || to_jsonb(public.cupom_centavos(x, 'sangria'));
  end loop;
  t := coalesce(p ->> 'data', '');
  if t <> '' and t !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'cupom inválido: data'; end if;
  return jsonb_build_object(
    'terminal', left(regexp_replace(coalesce(p ->> 'terminal', ''), '\D', '', 'g'), 10),
    'data', t,
    'turno', left(coalesce(p ->> 'turno', ''), 20),
    'operador', left(coalesce(p ->> 'operador', ''), 80),
    'abertura', left(coalesce(p ->> 'abertura', ''), 8),
    'encerramento', left(coalesce(p ->> 'encerramento', ''), 8),
    'origem', case when p ->> 'origem' in ('pdf', 'texto') then p ->> 'origem' else 'digitado' end,
    'formas', formas,
    'venda_bruta', public.cupom_centavos(p -> 'venda_bruta', 'venda bruta'),
    'fundo', public.cupom_centavos(p -> 'fundo', 'fundo'),
    'sangria', public.cupom_centavos(p -> 'sangria', 'sangria'),
    'recebimento', public.cupom_centavos(p -> 'recebimento', 'recebimento'),
    'total_liquido', public.cupom_centavos(p -> 'total_liquido', 'total líquido', true),
    'cancelamentos', public.cupom_centavos(p -> 'cancelamentos', 'cancelamentos'),
    'desconto', public.cupom_centavos(p -> 'desconto', 'desconto'),
    'acrescimos', public.cupom_centavos(p -> 'acrescimos', 'acréscimos'),
    'recebimentos', receb,
    'sangrias', sang);
end;
$$;

-- Recalcula totais, esperado e diferença de uma conferência.
-- Esperado = Fundo + Vendas dinheiro + Recebimentos dinheiro + Suprimentos − Sangrias
-- Diferença = Contado − Esperado
create or replace function public.conferencia_calcular()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_ced bigint;
  v_moe bigint;
  v_san bigint;
  v_sup bigint;
begin
  if jsonb_typeof(new.contagem) <> 'object' then
    raise exception 'contagem inválida';
  end if;

  select
    coalesce(sum(case when k::bigint >= 200 then k::bigint * greatest(v::bigint, 0) end), 0),
    coalesce(sum(case when k::bigint <  200 then k::bigint * greatest(v::bigint, 0) end), 0)
  into v_ced, v_moe
  from jsonb_each_text(new.contagem) as t(k, v);

  new.total_cedulas_centavos := v_ced;
  new.total_moedas_centavos  := v_moe;
  new.total_centavos         := v_ced + v_moe;

  if new.tipo = 'fechamento' then
    select
      coalesce(sum(valor_centavos) filter (where tipo = 'sangria'), 0),
      coalesce(sum(valor_centavos) filter (where tipo = 'suprimento'), 0)
    into v_san, v_sup
    from public.movimentos m
    where m.data = new.data and m.caixa = new.caixa;

    new.sangrias_lancadas_centavos := v_san;
    -- Com o cupom do Diamante: fundo, dinheiro, outras formas e SANGRIAS vêm dele
    if new.cupom is not null and new.cupom <> 'null'::jsonb then
      new.cupom := public.cupom_normalizar(new.cupom);
      if new.cupom ->> 'data' <> '' and (new.cupom ->> 'data')::date <> new.data then
        raise exception 'A data do cupom (%) é diferente da data do fechamento (%).',
          to_char((new.cupom ->> 'data')::date, 'DD/MM/YYYY'), to_char(new.data, 'DD/MM/YYYY');
      end if;
      new.fundo_centavos                 := (new.cupom ->> 'fundo')::bigint;
      new.vendas_dinheiro_centavos       := (new.cupom #>> '{formas,dinheiro,vendas}')::bigint;
      new.recebimentos_dinheiro_centavos := (new.cupom #>> '{formas,dinheiro,receb}')::bigint;
      new.pix_centavos      := (new.cupom #>> '{formas,pix,vendas}')::bigint + (new.cupom #>> '{formas,pix,receb}')::bigint;
      new.debito_centavos   := (new.cupom #>> '{formas,debito,vendas}')::bigint + (new.cupom #>> '{formas,debito,receb}')::bigint;
      new.credito_centavos  := (new.cupom #>> '{formas,credito,vendas}')::bigint + (new.cupom #>> '{formas,credito,receb}')::bigint;
      new.carteira_centavos := (new.cupom #>> '{formas,carteira,vendas}')::bigint;
      v_san := (new.cupom ->> 'sangria')::bigint;
    else
      new.cupom := null;
    end if;

    new.fundo_centavos                 := coalesce(new.fundo_centavos, 0);
    new.vendas_dinheiro_centavos       := coalesce(new.vendas_dinheiro_centavos, 0);
    new.recebimentos_dinheiro_centavos := coalesce(new.recebimentos_dinheiro_centavos, 0);
    new.sangrias_centavos              := v_san;
    new.suprimentos_centavos           := v_sup;
    new.esperado_centavos := new.fundo_centavos + new.vendas_dinheiro_centavos
                           + new.recebimentos_dinheiro_centavos + v_sup - v_san;
    new.diferenca_centavos := new.total_centavos - new.esperado_centavos;
  else
    new.cupom                      := null;
    new.sangrias_lancadas_centavos := null;
    new.sangrias_centavos    := null;
    new.suprimentos_centavos := null;
    new.esperado_centavos    := null;
    new.diferenca_centavos   := null;
  end if;

  return new;
end;
$$;

-- Marca autoria: no INSERT fixa quem criou; no UPDATE feito pelo usuário marca quem editou.
-- (Quando a atualização vem do gatilho de movimentos, pg_trigger_depth() > 1 e não marca.)
create or replace function public.marcar_autoria()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.criado_por  := public.email_atual();
    new.criado_em   := now();
    new.editado_por := null;
    new.editado_em  := null;
  else
    new.criado_por := old.criado_por;
    new.criado_em  := old.criado_em;
    if pg_trigger_depth() = 1 then
      new.editado_por := public.email_atual();
      new.editado_em  := now();
    else
      new.editado_por := old.editado_por;
      new.editado_em  := old.editado_em;
    end if;
  end if;
  return new;
end;
$$;

-- Quando uma sangria/suprimento muda, refaz a conta dos fechamentos daquele dia e caixa
create or replace function public.movimento_recalcular_fechamentos()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    update public.conferencias c set contagem = c.contagem
    where c.tipo = 'fechamento' and c.data = new.data and c.caixa = new.caixa;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    update public.conferencias c set contagem = c.contagem
    where c.tipo = 'fechamento' and c.data = old.data and c.caixa = old.caixa;
  end if;
  return null;
end;
$$;

drop trigger if exists conferencias_autoria on public.conferencias;
create trigger conferencias_autoria
  before insert or update on public.conferencias
  for each row execute function public.marcar_autoria();

drop trigger if exists conferencias_calcular on public.conferencias;
create trigger conferencias_calcular
  before insert or update on public.conferencias
  for each row execute function public.conferencia_calcular();

drop trigger if exists movimentos_autoria on public.movimentos;
create trigger movimentos_autoria
  before insert or update on public.movimentos
  for each row execute function public.marcar_autoria();

drop trigger if exists movimentos_recalcular on public.movimentos;
create trigger movimentos_recalcular
  after insert or update or delete on public.movimentos
  for each row execute function public.movimento_recalcular_fechamentos();

-- ---------------------------------------------------------------------
-- 5. Segurança (RLS): sem login e sem estar autorizado, nada é lido nem gravado
-- ---------------------------------------------------------------------
alter table public.usuarios_autorizados enable row level security;
alter table public.conferencias         enable row level security;
alter table public.movimentos           enable row level security;

-- Visitante sem login não tem nenhum acesso às tabelas
revoke all on public.usuarios_autorizados from anon;
revoke all on public.conferencias         from anon;
revoke all on public.movimentos           from anon;

-- A lista de autorizados só é alterada pelo painel do Supabase (SQL Editor / Table Editor).
-- Pelo site, o usuário autorizado só consegue ver a própria linha.
drop policy if exists "ver o próprio cadastro" on public.usuarios_autorizados;
create policy "ver o próprio cadastro" on public.usuarios_autorizados
  for select to authenticated
  using (email = public.email_atual());
revoke insert, update, delete on public.usuarios_autorizados from authenticated;

drop policy if exists "autorizados podem tudo" on public.conferencias;
create policy "autorizados podem tudo" on public.conferencias
  for all to authenticated
  using (public.autorizado())
  with check (public.autorizado());

drop policy if exists "autorizados podem tudo" on public.movimentos;
create policy "autorizados podem tudo" on public.movimentos
  for all to authenticated
  using (public.autorizado())
  with check (public.autorizado());

-- ---------------------------------------------------------------------
-- 7. Cielo: máquinas, troca no dia e vendas importadas do CSV (Conferência 2.0)
--    O CSV é lido no aparelho; aqui ficam só os campos necessários (sem cartão, sem CPF).
-- ---------------------------------------------------------------------
create table if not exists public.maquinas (
  numero      text primary key check (numero ~ '^[0-9]{1,20}$'),
  apelido     text not null default '' check (length(apelido) <= 40),
  caixa       text check (length(caixa) between 1 and 40),   -- caixa padrão (null = sem caixa)
  ativa       boolean not null default true,
  criado_por  text not null default public.email_atual(),
  criado_em   timestamptz not null default now(),
  editado_por text,
  editado_em  timestamptz
);

-- "Hoje a máquina X ficou no Caixa 2" (dia inteiro ou só num horário)
create table if not exists public.maquina_trocas (
  id          uuid primary key default gen_random_uuid(),
  data        date not null,
  maquina     text not null references public.maquinas (numero) on update cascade,
  caixa       text not null check (length(caixa) between 1 and 40),
  hora_de     time,
  hora_ate    time,
  observacao  text not null default '' check (length(observacao) <= 300),
  criado_por  text not null default public.email_atual(),
  criado_em   timestamptz not null default now(),
  editado_por text,
  editado_em  timestamptz,
  constraint troca_horario check (hora_de is null or hora_ate is null or hora_de <= hora_ate)
);
create index if not exists maquina_trocas_data_idx on public.maquina_trocas (data, maquina);

create table if not exists public.cielo_vendas (
  id             uuid primary key default gen_random_uuid(),
  chave          text not null unique check (length(chave) between 5 and 200),  -- não duplica ao reimportar
  data           date not null,
  hora           time not null,
  forma          text not null check (forma in ('debito', 'credito', 'pix', 'outro')),
  forma_original text not null default '' check (length(forma_original) <= 60),
  parcelas       smallint not null default 1 check (parcelas between 1 and 99),
  bandeira       text not null default '' check (length(bandeira) <= 40),
  valor_centavos bigint not null check (valor_centavos > 0),
  aprovada       boolean not null,
  status         text not null default '' check (length(status) <= 40),
  maquina        text not null check (maquina ~ '^[0-9]{1,20}$'),
  nsu            text not null default '' check (length(nsu) <= 30),
  autorizacao    text not null default '' check (length(autorizacao) <= 20),
  id_pix         text not null default '' check (length(id_pix) <= 60),
  txid           text not null default '' check (length(txid) <= 60),
  pagador        text not null default '' check (length(pagador) <= 30),  -- PIX: nome abreviado
  importado_por  text not null default public.email_atual(),
  importado_em   timestamptz not null default now()
);
create index if not exists cielo_vendas_data_idx on public.cielo_vendas (data, maquina);

-- Nome do pagador sempre abreviado, mesmo que o navegador mande inteiro
create or replace function public.cielo_venda_normalizar()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.pagador := left(public.abreviar_nome(new.pagador), 30);
  if tg_op = 'INSERT' then
    new.importado_por := public.email_atual();
    new.importado_em  := now();
  else
    new.importado_por := old.importado_por;
    new.importado_em  := old.importado_em;
  end if;
  return new;
end;
$$;

drop trigger if exists cielo_vendas_normalizar on public.cielo_vendas;
create trigger cielo_vendas_normalizar
  before insert or update on public.cielo_vendas
  for each row execute function public.cielo_venda_normalizar();

drop trigger if exists maquinas_autoria on public.maquinas;
create trigger maquinas_autoria
  before insert or update on public.maquinas
  for each row execute function public.marcar_autoria();

drop trigger if exists maquina_trocas_autoria on public.maquina_trocas;
create trigger maquina_trocas_autoria
  before insert or update on public.maquina_trocas
  for each row execute function public.marcar_autoria();

alter table public.maquinas       enable row level security;
alter table public.maquina_trocas enable row level security;
alter table public.cielo_vendas   enable row level security;
revoke all on public.maquinas, public.maquina_trocas, public.cielo_vendas from anon;

drop policy if exists "autorizados podem tudo" on public.maquinas;
create policy "autorizados podem tudo" on public.maquinas
  for all to authenticated using (public.autorizado()) with check (public.autorizado());
drop policy if exists "autorizados podem tudo" on public.maquina_trocas;
create policy "autorizados podem tudo" on public.maquina_trocas
  for all to authenticated using (public.autorizado()) with check (public.autorizado());
drop policy if exists "autorizados podem tudo" on public.cielo_vendas;
create policy "autorizados podem tudo" on public.cielo_vendas
  for all to authenticated using (public.autorizado()) with check (public.autorizado());

-- ---------------------------------------------------------------------
-- 6. Coloque aqui os e-mails de quem pode usar (troque pelos e-mails reais)
-- ---------------------------------------------------------------------
-- insert into public.usuarios_autorizados (email, nome) values
--   ('italo@exemplo.com', 'Italo'),
--   ('irma@exemplo.com',  'Sócia')
-- on conflict (email) do nothing;
