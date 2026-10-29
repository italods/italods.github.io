-- =====================================================================
-- Veneza Escuta — sugestões, reclamações, elogios e produtos em falta
-- Rode DEPOIS do schema.sql (usa public.usuarios_autorizados e public.autorizado()).
-- Cole no SQL Editor do Supabase e clique em "Run". Pode rodar de novo: não apaga dados.
--
-- Segurança:
--   * Clientes (sem login, papel "anon") NÃO leem nenhuma tabela. Eles só podem:
--       - consultar uma plaquinha pelo token        -> escuta_plaquinha(token)
--       - buscar produtos no catálogo local          -> escuta_buscar_produtos(termo)
--       - registrar uma mensagem                     -> escuta_enviar(dados)
--       - subir UMA foto na pasta privada "escuta-fotos" (não conseguem ver nem apagar)
--   * Só quem está em usuarios_autorizados vê mensagens, contatos e fotos.
--   * Toda validação é feita aqui no banco; o navegador não é confiável.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Extensões e funções auxiliares
-- ---------------------------------------------------------------------
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- Administradores: a mesma lista do sistema de caixa, com a permissão de cada um
alter table public.usuarios_autorizados add column if not exists papel text not null default 'admin';

-- Texto sem acento e em minúsculas, para a busca
create or replace function public.escuta_normalizar(t text)
returns text
language sql immutable
set search_path = public
as $$
  select lower(translate(coalesce(t, ''),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'))
$$;

-- Token imprevisível da plaquinha (16 caracteres hexadecimais aleatórios)
create or replace function public.escuta_novo_token()
returns text
language sql volatile
as $$
  select substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)
$$;

-- Texto limpo: sem espaços nas pontas, vazio vira null, limite de tamanho
create or replace function public.escuta_texto(t text, maximo int)
returns text
language sql immutable
as $$
  select nullif(left(btrim(regexp_replace(coalesce(t, ''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g')), maximo), '')
$$;

-- ---------------------------------------------------------------------
-- 1. Plaquinhas (cada uma tem seu QR code)
-- ---------------------------------------------------------------------
create table if not exists public.escuta_plaquinhas (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique default public.escuta_novo_token()
              check (token ~ '^[a-z0-9]{8,32}$'),
  nome        text not null check (length(nome) between 1 and 80),
  setor       text not null check (length(setor) between 1 and 60),
  local       text not null default '' check (length(local) <= 120),
  ativa       boolean not null default true,
  criado_em   timestamptz not null default now(),
  criado_por  text not null default public.email_atual(),
  editado_em  timestamptz,
  editado_por text
);

-- ---------------------------------------------------------------------
-- 2. Envios (cada mensagem de cliente)
-- ---------------------------------------------------------------------
create table if not exists public.escuta_envios (
  id                   uuid primary key,             -- gerado no aparelho: repetir o envio não duplica
  protocolo            text not null unique,
  tipo                 text not null check (tipo in ('falta', 'sugestao', 'reclamacao', 'elogio')),
  titulo               text check (length(titulo) <= 120),
  descricao            text check (length(descricao) <= 2000),
  plaquinha_id         uuid references public.escuta_plaquinhas (id) on delete restrict,
  nome                 text check (length(nome) <= 80),
  telefone             text check (telefone ~ '^[0-9]{10,11}$'),
  consentimento_em     timestamptz,
  consentimento_versao text,
  contato_apagado_em   timestamptz,
  situacao             text not null default 'novo' check (situacao in ('novo', 'em_analise', 'resolvido')),
  situacao_em          timestamptz,
  situacao_por         text,
  resolvido_em         timestamptz,
  criado_em            timestamptz not null default now(),
  constraint contato_com_consentimento check (
    (nome is null and telefone is null) or consentimento_em is not null
  )
);

create index if not exists escuta_envios_criado_idx on public.escuta_envios (criado_em desc);
create index if not exists escuta_envios_plaquinha_idx on public.escuta_envios (plaquinha_id);
create index if not exists escuta_envios_situacao_idx on public.escuta_envios (situacao);

-- ---------------------------------------------------------------------
-- 3. Catálogo local de produtos (busca rápida com fotos)
-- ---------------------------------------------------------------------
create table if not exists public.escuta_catalogo (
  id            uuid primary key default gen_random_uuid(),
  codigo_barras text unique check (codigo_barras ~ '^[0-9]{6,14}$'),
  nome          text not null check (length(nome) between 1 and 150),
  marca         text check (length(marca) <= 80),
  apresentacao  text check (length(apresentacao) <= 60),
  imagem_url    text check (imagem_url ~ '^https://'),
  fonte         text not null default 'manual' check (fonte in ('manual', 'openfoodfacts')),
  busca         text generated always as (
                  public.escuta_normalizar(nome || ' ' || coalesce(marca, '') || ' ' ||
                  coalesce(apresentacao, '') || ' ' || coalesce(codigo_barras, ''))
                ) stored,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Índice de trigramas para a busca por partes da palavra ("caf" acha "Café")
do $$
declare v_schema text;
begin
  select n.nspname into v_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_trgm';
  execute format(
    'create index if not exists escuta_catalogo_busca_idx on public.escuta_catalogo using gin (busca %I.gin_trgm_ops)',
    v_schema);
end $$;

-- ---------------------------------------------------------------------
-- 4. Itens de um envio (vários produtos na mesma mensagem)
-- ---------------------------------------------------------------------
create table if not exists public.escuta_itens (
  id            uuid primary key default gen_random_uuid(),
  envio_id      uuid not null references public.escuta_envios (id) on delete cascade,
  ordem         int not null default 1,
  nome          text not null check (length(nome) between 1 and 150),
  marca         text check (length(marca) <= 80),
  apresentacao  text check (length(apresentacao) <= 60),
  codigo_barras text check (codigo_barras ~ '^[0-9]{6,14}$'),
  imagem_url    text check (imagem_url ~ '^https://'),
  catalogo_id   uuid references public.escuta_catalogo (id) on delete set null,
  nome_busca    text generated always as (public.escuta_normalizar(nome)) stored
);

create index if not exists escuta_itens_envio_idx on public.escuta_itens (envio_id);
create index if not exists escuta_itens_nome_idx on public.escuta_itens (nome_busca);

-- ---------------------------------------------------------------------
-- 5. Fotos anexadas (arquivo fica na pasta privada "escuta-fotos")
-- ---------------------------------------------------------------------
create table if not exists public.escuta_fotos (
  id        uuid primary key default gen_random_uuid(),
  envio_id  uuid not null references public.escuta_envios (id) on delete cascade,
  item_id   uuid references public.escuta_itens (id) on delete cascade,
  caminho   text not null unique,      -- caminho dentro da pasta "escuta-fotos"
  tipo      text not null check (tipo in ('image/jpeg', 'image/png', 'image/webp')),
  tamanho   bigint,
  criado_em timestamptz not null default now()
);

create index if not exists escuta_fotos_envio_idx on public.escuta_fotos (envio_id);

-- ---------------------------------------------------------------------
-- 6. Histórico de situação (quem mudou e quando)
-- ---------------------------------------------------------------------
create table if not exists public.escuta_situacoes (
  id       bigint generated always as identity primary key,
  envio_id uuid not null references public.escuta_envios (id) on delete cascade,
  situacao text not null,
  por      text not null,
  em       timestamptz not null default now()
);

create index if not exists escuta_situacoes_envio_idx on public.escuta_situacoes (envio_id);

-- ---------------------------------------------------------------------
-- 7. Limite de envios por aparelho/rede (contra spam)
-- ---------------------------------------------------------------------
create table if not exists public.escuta_limites (
  chave    text not null,
  janela   timestamptz not null,
  contagem int not null default 0,
  primary key (chave, janela)
);

-- ---------------------------------------------------------------------
-- 8. Segurança das tabelas (RLS)
-- ---------------------------------------------------------------------
alter table public.escuta_plaquinhas enable row level security;
alter table public.escuta_envios     enable row level security;
alter table public.escuta_catalogo   enable row level security;
alter table public.escuta_itens      enable row level security;
alter table public.escuta_fotos      enable row level security;
alter table public.escuta_situacoes  enable row level security;
alter table public.escuta_limites    enable row level security;

revoke all on public.escuta_plaquinhas, public.escuta_envios, public.escuta_catalogo, public.escuta_itens,
              public.escuta_fotos, public.escuta_situacoes, public.escuta_limites from anon;
-- Gravações só pelas funções abaixo (que validam tudo); o painel lê com a política "autorizados leem"
revoke insert, update, delete on public.escuta_plaquinhas, public.escuta_envios, public.escuta_catalogo,
              public.escuta_itens, public.escuta_fotos, public.escuta_situacoes from authenticated;
revoke all on public.escuta_limites from authenticated;

do $$
declare t text;
begin
  foreach t in array array['escuta_plaquinhas', 'escuta_envios', 'escuta_catalogo', 'escuta_itens',
                           'escuta_fotos', 'escuta_situacoes'] loop
    execute format('drop policy if exists "autorizados leem" on public.%I', t);
    execute format('create policy "autorizados leem" on public.%I for select to authenticated using (public.autorizado())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 9. Pasta privada de fotos no Supabase Storage
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Storage não encontrado: pulando a pasta de fotos';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('escuta-fotos', 'escuta-fotos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update
    set public = false, file_size_limit = 5242880,
        allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

  -- Cliente (com ou sem login) só pode CRIAR arquivo em envios/<id do envio>/<id da foto>.<ext>
  drop policy if exists "escuta: cliente envia foto" on storage.objects;
  create policy "escuta: cliente envia foto" on storage.objects
    for insert to anon, authenticated
    with check (
      bucket_id = 'escuta-fotos'
      and name ~ '^envios/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
    );

  -- Só administradores veem e apagam as fotos
  drop policy if exists "escuta: admin vê fotos" on storage.objects;
  create policy "escuta: admin vê fotos" on storage.objects
    for select to authenticated
    using (bucket_id = 'escuta-fotos' and public.autorizado());

  drop policy if exists "escuta: admin apaga fotos" on storage.objects;
  create policy "escuta: admin apaga fotos" on storage.objects
    for delete to authenticated
    using (bucket_id = 'escuta-fotos' and public.autorizado());
end $$;

-- ---------------------------------------------------------------------
-- 10. Funções PÚBLICAS (clientes, sem login)
-- ---------------------------------------------------------------------

-- Dados da plaquinha para mostrar no formulário (nada além do necessário)
create or replace function public.escuta_plaquinha(p_token text)
returns jsonb
language sql stable
security definer
set search_path = public
as $$
  select jsonb_build_object('nome', nome, 'setor', setor, 'local', local, 'ativa', ativa)
  from public.escuta_plaquinhas
  where token = lower(btrim(p_token))
$$;

-- Busca no catálogo local (sem consulta externa)
create or replace function public.escuta_buscar_produtos(p_termo text)
returns jsonb
language plpgsql stable
security definer
set search_path = public
as $$
declare
  v_termo  text := public.escuta_normalizar(left(btrim(coalesce(p_termo, '')), 60));
  v_partes text[];
begin
  if length(v_termo) < 2 then
    return '[]'::jsonb;
  end if;
  select array_agg('%' || p || '%') into v_partes
  from unnest(regexp_split_to_array(v_termo, '\s+')) as p
  where p <> '';

  return coalesce((
    select jsonb_agg(to_jsonb(r) - 'ordem')
    from (
      select id, nome, marca, apresentacao, codigo_barras, imagem_url, fonte,
             (case when busca like v_termo || '%' then 0 else 1 end) as ordem
      from public.escuta_catalogo
      where busca like all (v_partes)
      order by ordem, length(nome), nome
      limit 8
    ) r
  ), '[]'::jsonb);
end;
$$;

-- Registra uma mensagem. Recebe:
-- { id, tipo, titulo, descricao, token, nome, telefone, consentimento, foto: {caminho},
--   itens: [{nome, marca, apresentacao, codigo_barras, catalogo_id}], tempo_ms, site }
-- Devolve { protocolo, repetido }.
create or replace function public.escuta_enviar(p jsonb)
returns jsonb
language plpgsql volatile
security definer
set search_path = public
as $$
declare
  v_id         uuid;
  v_tipo       text := p ->> 'tipo';
  v_titulo     text := public.escuta_texto(p ->> 'titulo', 120);
  v_descricao  text := public.escuta_texto(p ->> 'descricao', 2000);
  v_nome       text := public.escuta_texto(p ->> 'nome', 80);
  v_telefone   text := nullif(regexp_replace(coalesce(p ->> 'telefone', ''), '\D', '', 'g'), '');
  v_plaquinha  public.escuta_plaquinhas;
  v_protocolo  text;
  v_existente  text;
  v_ip         text;
  v_chave      text;
  v_contagem   int;
  v_item       jsonb;
  v_ordem      int := 0;
  v_cat        public.escuta_catalogo;
  v_codigo     text;
  v_foto       text := p -> 'foto' ->> 'caminho';
  v_foto_tipo  text;
  v_foto_tam   bigint;
  v_alfabeto   text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i            int;
begin
  -- Identificador do envio (vem do aparelho; repetir o mesmo envio não duplica)
  begin
    v_id := (p ->> 'id')::uuid;
  exception when others then
    raise exception 'ESCUTA_DADOS: identificador inválido';
  end;
  if v_id is null then
    raise exception 'ESCUTA_DADOS: identificador inválido';
  end if;
  select protocolo into v_existente from public.escuta_envios where id = v_id;
  if v_existente is not null then
    return jsonb_build_object('protocolo', v_existente, 'repetido', true);
  end if;

  -- Contra robôs: campo escondido preenchido ou envio rápido demais
  if coalesce(p ->> 'site', '') <> '' or coalesce((p ->> 'tempo_ms')::bigint, 0) < 2500 then
    raise exception 'ESCUTA_ROBO';
  end if;

  -- Limite por rede: 8 envios a cada 10 minutos e 40 por dia
  v_ip := coalesce(
    nullif(btrim(split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1)), ''),
    'sem-ip');
  v_chave := md5('veneza-escuta:' || v_ip);
  insert into public.escuta_limites as l (chave, janela, contagem)
  values (v_chave, date_trunc('hour', now()) + floor(extract(minute from now()) / 10) * interval '10 minutes', 1)
  on conflict (chave, janela) do update set contagem = l.contagem + 1
  returning contagem into v_contagem;
  if v_contagem > 8 then
    raise exception 'ESCUTA_LIMITE';
  end if;
  insert into public.escuta_limites as l (chave, janela, contagem)
  values ('dia:' || v_chave, date_trunc('day', now()), 1)
  on conflict (chave, janela) do update set contagem = l.contagem + 1
  returning contagem into v_contagem;
  if v_contagem > 40 then
    raise exception 'ESCUTA_LIMITE';
  end if;

  -- Tipo e conteúdo
  if v_tipo is null or v_tipo not in ('falta', 'sugestao', 'reclamacao', 'elogio') then
    raise exception 'ESCUTA_DADOS: escolha o assunto';
  end if;
  if v_tipo = 'falta' then
    if jsonb_typeof(p -> 'itens') <> 'array' or jsonb_array_length(p -> 'itens') = 0 then
      raise exception 'ESCUTA_DADOS: informe pelo menos um produto';
    end if;
    if jsonb_array_length(p -> 'itens') > 20 then
      raise exception 'ESCUTA_DADOS: no máximo 20 produtos por envio';
    end if;
  elsif v_tipo = 'sugestao' then
    if v_titulo is null and v_descricao is null then
      raise exception 'ESCUTA_DADOS: escreva a sua sugestão';
    end if;
  else
    if v_descricao is null or length(v_descricao) < 3 then
      raise exception 'ESCUTA_DADOS: escreva a sua mensagem';
    end if;
  end if;

  -- Contato opcional, sempre com consentimento
  if v_telefone is not null and v_telefone !~ '^[0-9]{10,11}$' then
    raise exception 'ESCUTA_DADOS: telefone com DDD deve ter 10 ou 11 números';
  end if;
  if (v_nome is not null or v_telefone is not null) and coalesce((p ->> 'consentimento')::boolean, false) is not true then
    raise exception 'ESCUTA_DADOS: confirme a autorização para usar seu contato';
  end if;

  -- Plaquinha de origem (opcional; se veio de QR code, precisa estar ativa)
  if coalesce(p ->> 'token', '') <> '' then
    select * into v_plaquinha from public.escuta_plaquinhas where token = lower(btrim(p ->> 'token'));
    if v_plaquinha.id is null or not v_plaquinha.ativa then
      raise exception 'ESCUTA_PLAQUINHA';
    end if;
  end if;

  -- Foto: precisa ter sido enviada para a pasta deste envio
  if v_foto is not null then
    if v_foto !~ ('^envios/' || v_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
      raise exception 'ESCUTA_FOTO';
    end if;
    select o.metadata ->> 'mimetype', (o.metadata ->> 'size')::bigint
      into v_foto_tipo, v_foto_tam
    from storage.objects o
    where o.bucket_id = 'escuta-fotos' and o.name = v_foto;
    if not found then
      raise exception 'ESCUTA_FOTO';
    end if;
    v_foto_tipo := coalesce(v_foto_tipo,
      case substring(v_foto from '\.([a-z]+)$') when 'png' then 'image/png' when 'webp' then 'image/webp' else 'image/jpeg' end);
  end if;

  -- Protocolo único e fácil de ditar: VZ-261029-7KQ2
  loop
    v_protocolo := 'VZ-' || to_char(now() at time zone 'America/Fortaleza', 'YYMMDD') || '-';
    for i in 1..4 loop
      v_protocolo := v_protocolo || substr(v_alfabeto, 1 + floor(random() * length(v_alfabeto))::int, 1);
    end loop;
    exit when not exists (select 1 from public.escuta_envios where protocolo = v_protocolo);
  end loop;

  insert into public.escuta_envios (id, protocolo, tipo, titulo, descricao, plaquinha_id, nome, telefone,
                                    consentimento_em, consentimento_versao)
  values (v_id, v_protocolo, v_tipo, v_titulo, v_descricao, v_plaquinha.id, v_nome, v_telefone,
          case when v_nome is not null or v_telefone is not null then now() end,
          case when v_nome is not null or v_telefone is not null then '2026-10' end);

  if v_tipo = 'falta' then
    for v_item in select * from jsonb_array_elements(p -> 'itens') loop
      v_ordem := v_ordem + 1;
      v_cat := null;
      if coalesce(v_item ->> 'catalogo_id', '') <> '' then
        begin
          select * into v_cat from public.escuta_catalogo where id = (v_item ->> 'catalogo_id')::uuid;
        exception when others then
          v_cat := null;
        end;
      end if;
      v_codigo := nullif(regexp_replace(coalesce(v_item ->> 'codigo_barras', ''), '\D', '', 'g'), '');
      if v_codigo is not null and v_codigo !~ '^[0-9]{6,14}$' then
        v_codigo := null;
      end if;
      if public.escuta_texto(v_item ->> 'nome', 150) is null then
        raise exception 'ESCUTA_DADOS: falta o nome de um produto';
      end if;
      insert into public.escuta_itens (envio_id, ordem, nome, marca, apresentacao, codigo_barras, imagem_url, catalogo_id)
      values (v_id, v_ordem,
              public.escuta_texto(v_item ->> 'nome', 150),
              public.escuta_texto(v_item ->> 'marca', 80),
              public.escuta_texto(v_item ->> 'apresentacao', 60),
              coalesce(v_codigo, v_cat.codigo_barras),
              v_cat.imagem_url,          -- imagem só do catálogo, nunca de endereço enviado pelo navegador
              v_cat.id);
    end loop;
  end if;

  if v_foto is not null then
    insert into public.escuta_fotos (envio_id, caminho, tipo, tamanho)
    values (v_id, v_foto, v_foto_tipo, v_foto_tam);
  end if;

  -- Política de privacidade: nome e telefone são apagados 12 meses depois do envio
  update public.escuta_envios
     set nome = null, telefone = null, contato_apagado_em = now()
   where criado_em < now() - interval '12 months'
     and (nome is not null or telefone is not null);
  delete from public.escuta_limites where janela < now() - interval '2 days';

  return jsonb_build_object('protocolo', v_protocolo, 'repetido', false);
end;
$$;

-- ---------------------------------------------------------------------
-- 11. Funções do PAINEL (só administradores)
-- ---------------------------------------------------------------------
create or replace function public.escuta_exigir_admin()
returns void
language plpgsql stable
security definer
set search_path = public
as $$
begin
  if not public.autorizado() then
    raise exception 'ESCUTA_SEM_PERMISSAO';
  end if;
end;
$$;

-- Indicadores da visão geral
create or replace function public.escuta_resumo()
returns jsonb
language plpgsql stable
security definer
set search_path = public
as $$
begin
  perform public.escuta_exigir_admin();
  return jsonb_build_object(
    'total',       (select count(*) from public.escuta_envios),
    'novo',        (select count(*) from public.escuta_envios where situacao = 'novo'),
    'em_analise',  (select count(*) from public.escuta_envios where situacao = 'em_analise'),
    'resolvido',   (select count(*) from public.escuta_envios where situacao = 'resolvido'),
    'plaquinhas_ativas', (select count(*) from public.escuta_plaquinhas where ativa),
    'por_tipo', coalesce((select jsonb_object_agg(tipo, n) from
                  (select tipo, count(*) n from public.escuta_envios group by tipo) t), '{}'::jsonb),
    'produtos_mais_pedidos', coalesce((select jsonb_agg(x) from (
        select min(i.nome) as nome, count(*) as vezes
        from public.escuta_itens i
        group by i.nome_busca
        having count(*) > 1
        order by count(*) desc, min(i.nome)
        limit 10) x), '[]'::jsonb)
  );
end;
$$;

-- Lista de mensagens com filtros:
-- { de, ate (datas AAAA-MM-DD), tipo, setor, plaquinha_id, situacao, produto, limite }
create or replace function public.escuta_listar(f jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable
security definer
set search_path = public
as $$
declare
  v_produto text := '%' || public.escuta_normalizar(coalesce(f ->> 'produto', '')) || '%';
begin
  perform public.escuta_exigir_admin();
  return coalesce((
    select jsonb_agg(r order by r.criado_em desc)
    from (
      select e.id, e.protocolo, e.criado_em, e.tipo, e.titulo, e.descricao, e.situacao,
             e.nome, e.telefone, e.contato_apagado_em,
             e.plaquinha_id, p.nome as plaquinha_nome, p.setor, p.local,
             (select count(*) from public.escuta_fotos fo where fo.envio_id = e.id) as fotos,
             coalesce((select jsonb_agg(jsonb_build_object('nome', i.nome, 'marca', i.marca,
                         'apresentacao', i.apresentacao, 'codigo_barras', i.codigo_barras,
                         'imagem_url', i.imagem_url) order by i.ordem)
                       from public.escuta_itens i where i.envio_id = e.id), '[]'::jsonb) as itens
      from public.escuta_envios e
      left join public.escuta_plaquinhas p on p.id = e.plaquinha_id
      where (coalesce(f ->> 'de', '') = '' or (e.criado_em at time zone 'America/Fortaleza')::date >= (f ->> 'de')::date)
        and (coalesce(f ->> 'ate', '') = '' or (e.criado_em at time zone 'America/Fortaleza')::date <= (f ->> 'ate')::date)
        and (coalesce(f ->> 'tipo', '') = '' or e.tipo = f ->> 'tipo')
        and (coalesce(f ->> 'situacao', '') = '' or e.situacao = f ->> 'situacao')
        and (coalesce(f ->> 'plaquinha_id', '') = '' or e.plaquinha_id::text = f ->> 'plaquinha_id')
        and (coalesce(f ->> 'setor', '') = '' or p.setor = f ->> 'setor')
        and (coalesce(f ->> 'produto', '') = ''
             or exists (select 1 from public.escuta_itens i
                        where i.envio_id = e.id
                          and public.escuta_normalizar(i.nome || ' ' || coalesce(i.marca, '')) like v_produto)
             or public.escuta_normalizar(coalesce(e.titulo, '') || ' ' || coalesce(e.descricao, '')) like v_produto)
      order by e.criado_em desc
      limit least(greatest(coalesce((f ->> 'limite')::int, 300), 1), 1000)
    ) r
  ), '[]'::jsonb);
end;
$$;

-- Uma mensagem com tudo: itens, fotos e histórico
create or replace function public.escuta_detalhe(p_id uuid)
returns jsonb
language plpgsql stable
security definer
set search_path = public
as $$
declare v jsonb;
begin
  perform public.escuta_exigir_admin();
  select to_jsonb(e) || jsonb_build_object(
           'plaquinha_nome', p.nome, 'setor', p.setor, 'local', p.local,
           'itens', coalesce((select jsonb_agg(to_jsonb(i) - 'nome_busca' order by i.ordem)
                              from public.escuta_itens i where i.envio_id = e.id), '[]'::jsonb),
           'fotos', coalesce((select jsonb_agg(jsonb_build_object('caminho', fo.caminho, 'tipo', fo.tipo,
                                'tamanho', fo.tamanho, 'item_id', fo.item_id) order by fo.criado_em)
                              from public.escuta_fotos fo where fo.envio_id = e.id), '[]'::jsonb),
           'historico', coalesce((select jsonb_agg(jsonb_build_object('situacao', s.situacao, 'por', s.por, 'em', s.em)
                                    order by s.em)
                                  from public.escuta_situacoes s where s.envio_id = e.id), '[]'::jsonb))
    into v
  from public.escuta_envios e
  left join public.escuta_plaquinhas p on p.id = e.plaquinha_id
  where e.id = p_id;
  return v;
end;
$$;

-- Muda a situação (novo / em_analise / resolvido) e guarda no histórico
create or replace function public.escuta_mudar_situacao(p_id uuid, p_situacao text)
returns jsonb
language plpgsql volatile
security definer
set search_path = public
as $$
begin
  perform public.escuta_exigir_admin();
  if p_situacao not in ('novo', 'em_analise', 'resolvido') then
    raise exception 'ESCUTA_DADOS: situação inválida';
  end if;
  update public.escuta_envios
     set situacao = p_situacao, situacao_em = now(), situacao_por = public.email_atual(),
         resolvido_em = case when p_situacao = 'resolvido' then now() end
   where id = p_id and situacao <> p_situacao;
  if found then
    insert into public.escuta_situacoes (envio_id, situacao, por) values (p_id, p_situacao, public.email_atual());
  end if;
  return public.escuta_detalhe(p_id);
end;
$$;

-- Plaquinhas com a quantidade de mensagens de cada uma
create or replace function public.escuta_plaquinhas_listar()
returns jsonb
language plpgsql stable
security definer
set search_path = public
as $$
begin
  perform public.escuta_exigir_admin();
  return coalesce((
    select jsonb_agg(r order by r.ativa desc, r.setor, r.nome)
    from (
      select p.id, p.token, p.nome, p.setor, p.local, p.ativa, p.criado_em, p.criado_por,
             (select count(*) from public.escuta_envios e where e.plaquinha_id = p.id) as mensagens,
             (select count(*) from public.escuta_envios e where e.plaquinha_id = p.id and e.situacao = 'novo') as novas
      from public.escuta_plaquinhas p
    ) r
  ), '[]'::jsonb);
end;
$$;

-- Cria ou edita uma plaquinha. O token NUNCA muda: o QR code impresso continua valendo.
create or replace function public.escuta_salvar_plaquinha(p jsonb)
returns jsonb
language plpgsql volatile
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_nome  text := public.escuta_texto(p ->> 'nome', 80);
  v_setor text := public.escuta_texto(p ->> 'setor', 60);
  v_local text := coalesce(public.escuta_texto(p ->> 'local', 120), '');
  v_ativa boolean := coalesce((p ->> 'ativa')::boolean, true);
begin
  perform public.escuta_exigir_admin();
  if v_nome is null then raise exception 'ESCUTA_DADOS: dê um nome para a plaquinha'; end if;
  if v_setor is null then raise exception 'ESCUTA_DADOS: informe o setor'; end if;
  if coalesce(p ->> 'id', '') = '' then
    insert into public.escuta_plaquinhas (nome, setor, local, ativa)
    values (v_nome, v_setor, v_local, v_ativa)
    returning id into v_id;
  else
    update public.escuta_plaquinhas
       set nome = v_nome, setor = v_setor, local = v_local, ativa = v_ativa,
           editado_em = now(), editado_por = public.email_atual()
     where id = (p ->> 'id')::uuid
    returning id into v_id;
    if v_id is null then raise exception 'ESCUTA_DADOS: plaquinha não encontrada'; end if;
  end if;
  return (select to_jsonb(x) from public.escuta_plaquinhas x where x.id = v_id);
end;
$$;

-- Apaga uma plaquinha que nunca recebeu mensagem (as que receberam devem ser desativadas)
create or replace function public.escuta_apagar_plaquinha(p_id uuid)
returns void
language plpgsql volatile
security definer
set search_path = public
as $$
begin
  perform public.escuta_exigir_admin();
  if exists (select 1 from public.escuta_envios where plaquinha_id = p_id) then
    raise exception 'ESCUTA_DADOS: esta plaquinha já recebeu mensagens; desative em vez de apagar';
  end if;
  delete from public.escuta_plaquinhas where id = p_id;
end;
$$;

-- Catálogo: lista para o painel
create or replace function public.escuta_catalogo_listar(p_termo text default '')
returns jsonb
language plpgsql stable
security definer
set search_path = public
as $$
declare v_termo text := '%' || public.escuta_normalizar(coalesce(p_termo, '')) || '%';
begin
  perform public.escuta_exigir_admin();
  return jsonb_build_object(
    'total', (select count(*) from public.escuta_catalogo),
    'itens', coalesce((select jsonb_agg(to_jsonb(c) - 'busca' order by c.nome)
                       from (select * from public.escuta_catalogo where busca like v_termo
                             order by nome limit 200) c), '[]'::jsonb));
end;
$$;

-- Catálogo: inclui/atualiza produtos (cadastro manual ou importação do Open Food Facts).
-- Recebe uma lista [{codigo_barras, nome, marca, apresentacao, imagem_url, fonte}]. Devolve quantos gravou.
create or replace function public.escuta_catalogo_salvar(p_itens jsonb)
returns int
language plpgsql volatile
security definer
set search_path = public
as $$
declare
  v_item   jsonb;
  v_codigo text;
  v_nome   text;
  v_imagem text;
  v_fonte  text;
  v_n      int := 0;
begin
  perform public.escuta_exigir_admin();
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) > 500 then
    raise exception 'ESCUTA_DADOS: envie até 500 produtos por vez';
  end if;
  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_nome := public.escuta_texto(v_item ->> 'nome', 150);
    continue when v_nome is null;
    v_codigo := nullif(regexp_replace(coalesce(v_item ->> 'codigo_barras', ''), '\D', '', 'g'), '');
    if v_codigo is not null and v_codigo !~ '^[0-9]{6,14}$' then v_codigo := null; end if;
    v_imagem := v_item ->> 'imagem_url';
    if v_imagem !~ '^https://' then v_imagem := null; end if;
    v_fonte := case when v_item ->> 'fonte' = 'openfoodfacts' then 'openfoodfacts' else 'manual' end;
    if v_codigo is not null then
      insert into public.escuta_catalogo (codigo_barras, nome, marca, apresentacao, imagem_url, fonte)
      values (v_codigo, v_nome, public.escuta_texto(v_item ->> 'marca', 80),
              public.escuta_texto(v_item ->> 'apresentacao', 60), v_imagem, v_fonte)
      on conflict (codigo_barras) do update
        set nome = excluded.nome, marca = excluded.marca, apresentacao = excluded.apresentacao,
            imagem_url = coalesce(excluded.imagem_url, escuta_catalogo.imagem_url),
            fonte = excluded.fonte, atualizado_em = now();
    elsif coalesce(v_item ->> 'id', '') <> '' then
      update public.escuta_catalogo
         set nome = v_nome, marca = public.escuta_texto(v_item ->> 'marca', 80),
             apresentacao = public.escuta_texto(v_item ->> 'apresentacao', 60),
             imagem_url = v_imagem, atualizado_em = now()
       where id = (v_item ->> 'id')::uuid;
    else
      insert into public.escuta_catalogo (nome, marca, apresentacao, imagem_url, fonte)
      values (v_nome, public.escuta_texto(v_item ->> 'marca', 80),
              public.escuta_texto(v_item ->> 'apresentacao', 60), v_imagem, v_fonte);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function public.escuta_catalogo_apagar(p_id uuid)
returns void
language plpgsql volatile
security definer
set search_path = public
as $$
begin
  perform public.escuta_exigir_admin();
  delete from public.escuta_catalogo where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 12. Quem pode chamar cada função
-- ---------------------------------------------------------------------
revoke all on function public.escuta_plaquinha(text), public.escuta_buscar_produtos(text),
  public.escuta_enviar(jsonb), public.escuta_exigir_admin(), public.escuta_resumo(),
  public.escuta_listar(jsonb), public.escuta_detalhe(uuid), public.escuta_mudar_situacao(uuid, text),
  public.escuta_plaquinhas_listar(), public.escuta_salvar_plaquinha(jsonb), public.escuta_apagar_plaquinha(uuid),
  public.escuta_catalogo_listar(text), public.escuta_catalogo_salvar(jsonb), public.escuta_catalogo_apagar(uuid)
  from public, anon, authenticated;

-- Clientes (sem login) e administradores
grant execute on function public.escuta_plaquinha(text), public.escuta_buscar_produtos(text),
  public.escuta_enviar(jsonb) to anon, authenticated;

-- Só administradores (cada função também confere autorizado() por dentro)
grant execute on function public.escuta_exigir_admin(), public.escuta_resumo(), public.escuta_listar(jsonb),
  public.escuta_detalhe(uuid), public.escuta_mudar_situacao(uuid, text), public.escuta_plaquinhas_listar(),
  public.escuta_salvar_plaquinha(jsonb), public.escuta_apagar_plaquinha(uuid), public.escuta_catalogo_listar(text),
  public.escuta_catalogo_salvar(jsonb), public.escuta_catalogo_apagar(uuid) to authenticated;
