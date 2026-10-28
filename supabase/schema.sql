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

    new.fundo_centavos                 := coalesce(new.fundo_centavos, 0);
    new.vendas_dinheiro_centavos       := coalesce(new.vendas_dinheiro_centavos, 0);
    new.recebimentos_dinheiro_centavos := coalesce(new.recebimentos_dinheiro_centavos, 0);
    new.sangrias_centavos              := v_san;
    new.suprimentos_centavos           := v_sup;
    new.esperado_centavos := new.fundo_centavos + new.vendas_dinheiro_centavos
                           + new.recebimentos_dinheiro_centavos + v_sup - v_san;
    new.diferenca_centavos := new.total_centavos - new.esperado_centavos;
  else
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
-- 6. Coloque aqui os e-mails de quem pode usar (troque pelos e-mails reais)
-- ---------------------------------------------------------------------
-- insert into public.usuarios_autorizados (email, nome) values
--   ('italo@exemplo.com', 'Italo'),
--   ('irma@exemplo.com',  'Sócia')
-- on conflict (email) do nothing;
