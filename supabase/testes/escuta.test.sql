-- Testes do escuta.sql. Rode num banco de teste depois de supabase-simulado.sql, schema.sql e escuta.sql.
-- NÃO rode isto no Supabase de produção.
\set ON_ERROR_STOP 1
-- helpers de teste
create or replace function pg_temp.espera_erro(sql text, trecho text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if position(trecho in sqlerrm) = 0 then raise exception 'erro errado: esperava "%" e veio "%"', trecho, sqlerrm; end if;
    return;
  end;
  raise exception 'esperava erro "%" mas funcionou: %', trecho, sql;
end $$;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FALHOU: %', msg; end if; raise notice 'ok: %', msg; end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;

insert into usuarios_autorizados(email,nome) values ('italo@x.com','Italo'),('irma@x.com','Irmã') on conflict do nothing;

-- ===== admin cria plaquinhas
set role authenticated; set request.jwt.claims = '{"email":"italo@x.com"}';
select (escuta_salvar_plaquinha('{"nome":"Perfumaria 01","setor":"Perfumaria","local":"Gôndola 1, início"}')->>'token') as t1 \gset
select (escuta_salvar_plaquinha('{"nome":"Açougue","setor":"Açougue","local":"Balcão"}')->>'id') as p2id \gset
select (select token from escuta_plaquinhas where id = :'p2id') as t2 \gset
select pg_temp.ok(length(:'t1') = 16 and :'t1' ~ '^[0-9a-f]+$', 'token tem 16 caracteres aleatórios');
-- editar não muda token
select pg_temp.ok((escuta_salvar_plaquinha(jsonb_build_object('id', :'p2id', 'nome','Açougue balcão','setor','Açougue','local','Balcão de atendimento','ativa',true))->>'token') = :'t2', 'editar não muda o token');
select escuta_catalogo_salvar('[{"codigo_barras":"7891000100103","nome":"Café Pilão Tradicional","marca":"Pilão","apresentacao":"500 g","imagem_url":"https://images.openfoodfacts.org/x.jpg","fonte":"openfoodfacts"},{"nome":"Arroz Branco Tipo 1","marca":"Camil","apresentacao":"5 kg"},{"nome":"x","imagem_url":"javascript:alert(1)"}]') as gravados;
select pg_temp.ok((select imagem_url from escuta_catalogo where nome='x') is null, 'catálogo recusa imagem que não é https');
reset role;

-- ===== anon (cliente)
set role anon; set request.jwt.claims = '{}';
select pg_temp.espera_erro('select * from escuta_envios', 'permission denied');
select pg_temp.espera_erro('select * from escuta_plaquinhas', 'permission denied');
select pg_temp.espera_erro('select * from usuarios_autorizados', 'permission denied');
select pg_temp.espera_erro('select escuta_listar()', 'permission denied');
select pg_temp.espera_erro('select escuta_resumo()', 'permission denied');
select pg_temp.espera_erro($q$select escuta_salvar_plaquinha('{"nome":"a","setor":"b"}')$q$, 'permission denied');
select pg_temp.ok((escuta_plaquinha(:'t1')->>'setor') = 'Perfumaria', 'cliente vê setor da plaquinha pelo token');
select pg_temp.ok(escuta_plaquinha('naoexiste') is null, 'token inexistente devolve nada');
select pg_temp.ok(jsonb_array_length(escuta_buscar_produtos('cafe')) = 1, 'busca "cafe" acha Café (sem acento)');
select pg_temp.ok(jsonb_array_length(escuta_buscar_produtos('arroz camil')) = 1, 'busca com duas palavras');
select pg_temp.ok(jsonb_array_length(escuta_buscar_produtos('c')) = 0, 'busca com 1 letra não consulta');
select pg_temp.ok(escuta_buscar_produtos('cafe')->0 ? 'imagem_url', 'busca devolve foto');

-- envio com vários produtos, anônimo, de uma plaquinha
select escuta_enviar(jsonb_build_object('id','11111111-1111-4111-8111-111111111111','tipo','falta','token',:'t1','tempo_ms',8000,
  'descricao','Procurei ontem',
  'itens', jsonb_build_array(
     jsonb_build_object('nome','Café Pilão Tradicional','catalogo_id',(select null::text),'marca','Pilão','apresentacao','500 g','codigo_barras','7891000100103'),
     jsonb_build_object('nome','Arroz marca B','marca','B','apresentacao','5 kg','imagem_url','https://malicioso.com/x.jpg'),
     jsonb_build_object('nome','Biscoito C','apresentacao','chocolate')))) ->> 'protocolo' as prot1 \gset
select pg_temp.ok(:'prot1' ~ '^VZ-[0-9]{6}-[A-Z2-9]{4}$', 'protocolo no formato VZ-AAMMDD-XXXX: ' || :'prot1');
-- repetir o mesmo envio não duplica
select pg_temp.ok((escuta_enviar(jsonb_build_object('id','11111111-1111-4111-8111-111111111111','tipo','falta','tempo_ms',8000,'itens','[{"nome":"z"}]'))->>'protocolo') = :'prot1', 'reenvio devolve o mesmo protocolo');
-- validações
select pg_temp.espera_erro($q$select escuta_enviar('{"id":"22222222-2222-4222-8222-222222222222","tipo":"elogio","descricao":"Ótimo","tempo_ms":500}')$q$, 'ESCUTA_ROBO');
select pg_temp.espera_erro($q$select escuta_enviar('{"id":"22222222-2222-4222-8222-222222222222","tipo":"elogio","descricao":"Ótimo","tempo_ms":5000,"site":"http://spam"}')$q$, 'ESCUTA_ROBO');
select pg_temp.espera_erro($q$select escuta_enviar('{"id":"22222222-2222-4222-8222-222222222222","tipo":"xx","descricao":"Ótimo","tempo_ms":5000}')$q$, 'escolha o assunto');
select pg_temp.espera_erro($q$select escuta_enviar('{"id":"22222222-2222-4222-8222-222222222222","tipo":"falta","tempo_ms":5000,"itens":[]}')$q$, 'pelo menos um produto');
select pg_temp.espera_erro($q$select escuta_enviar('{"id":"22222222-2222-4222-8222-222222222222","tipo":"reclamacao","tempo_ms":5000,"descricao":"  "}')$q$, 'escreva a sua mensagem');
select pg_temp.espera_erro($q$select escuta_enviar('{"id":"22222222-2222-4222-8222-222222222222","tipo":"elogio","descricao":"Ótimo","tempo_ms":5000,"telefone":"(89) 99999-0000"}')$q$, 'autorização');
select pg_temp.espera_erro($q$select escuta_enviar('{"id":"22222222-2222-4222-8222-222222222222","tipo":"elogio","descricao":"Ótimo","tempo_ms":5000,"telefone":"9999","consentimento":true}')$q$, '10 ou 11');
select pg_temp.espera_erro($q$select escuta_enviar('{"id":"nao-e-uuid","tipo":"elogio","descricao":"Ótimo","tempo_ms":5000}')$q$, 'identificador');
select pg_temp.espera_erro($q$select escuta_enviar('{"id":"22222222-2222-4222-8222-222222222222","tipo":"elogio","descricao":"Ótimo","tempo_ms":5000,"foto":{"caminho":"envios/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.jpg"}}')$q$, 'ESCUTA_FOTO');
select pg_temp.espera_erro($q$select escuta_enviar('{"id":"22222222-2222-4222-8222-222222222222","tipo":"elogio","descricao":"Ótimo","tempo_ms":5000,"foto":{"caminho":"../outro/arquivo.jpg"}}')$q$, 'ESCUTA_FOTO');
-- foto: cliente sobe arquivo na pasta permitida, mas não consegue ler nem subir em outro lugar
insert into storage.objects (bucket_id, name, metadata) values ('escuta-fotos','envios/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.jpg','{"mimetype":"image/jpeg","size":123456}');
select pg_temp.espera_erro($q$insert into storage.objects (bucket_id, name) values ('escuta-fotos','qualquer/coisa.jpg')$q$, 'row-level security');
select pg_temp.espera_erro($q$insert into storage.objects (bucket_id, name) values ('escuta-fotos','envios/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.exe')$q$, 'row-level security');
select pg_temp.ok((select count(*) from storage.objects) = 0, 'cliente não enxerga nenhuma foto');
-- elogio com contato, consentimento e foto; telefone formatado é limpo
select escuta_enviar('{"id":"22222222-2222-4222-8222-222222222222","tipo":"elogio","descricao":"Atendimento ótimo da Cida","tempo_ms":5000,"nome":"Maria","telefone":"(89) 99999-0000","consentimento":true,"foto":{"caminho":"envios/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.jpg"}}') ->> 'protocolo' as prot2 \gset
-- plaquinha inativa
reset role; set role authenticated; set request.jwt.claims = '{"email":"irma@x.com"}';
select escuta_salvar_plaquinha(jsonb_build_object('id', :'p2id', 'nome','Açougue balcão','setor','Açougue','local','Balcão de atendimento','ativa',false)) is not null as desativou;
reset role; set role anon; set request.jwt.claims = '{}';
select pg_temp.ok((escuta_plaquinha(:'t2')->>'ativa')::boolean = false, 'plaquinha desativada aparece como inativa');
select pg_temp.espera_erro(format($q$select escuta_enviar('{"id":"44444444-4444-4444-8444-444444444444","tipo":"elogio","descricao":"Bom","tempo_ms":5000,"token":"%s"}')$q$, :'t2'), 'ESCUTA_PLAQUINHA');
-- limite: 8 por 10 minutos (já foram 2 válidos)
do $$ declare i int; begin
  for i in 1..6 loop perform escuta_enviar(jsonb_build_object('id', gen_random_uuid(), 'tipo','sugestao','titulo','Ideia '||i,'tempo_ms',5000)); end loop;
end $$;
select pg_temp.espera_erro($q$select escuta_enviar(jsonb_build_object('id', gen_random_uuid(), 'tipo','sugestao','titulo','Ideia 9','tempo_ms',5000))$q$, 'ESCUTA_LIMITE');
reset role;

-- ===== logado mas NÃO autorizado
set role authenticated; set request.jwt.claims = '{"email":"intruso@x.com"}';
select pg_temp.ok((select count(*) from escuta_envios) = 0, 'intruso logado não vê mensagens');
select pg_temp.ok((select count(*) from storage.objects) = 0, 'intruso não vê fotos');
select pg_temp.espera_erro('select escuta_listar()', 'ESCUTA_SEM_PERMISSAO');
select pg_temp.espera_erro($q$select escuta_mudar_situacao('11111111-1111-4111-8111-111111111111','resolvido')$q$, 'ESCUTA_SEM_PERMISSAO');
select pg_temp.espera_erro($q$update escuta_envios set situacao='resolvido'$q$, 'permission denied');
reset role;

-- ===== admin
set role authenticated; set request.jwt.claims = '{"email":"italo@x.com"}';
select pg_temp.ok((escuta_resumo()->>'total')::int = 8 and (escuta_resumo()->>'plaquinhas_ativas')::int = 1, 'resumo: 8 mensagens e 1 plaquinha ativa');
select pg_temp.ok(jsonb_array_length(escuta_listar()) = 8, 'lista todas');
select pg_temp.ok(jsonb_array_length(escuta_listar('{"tipo":"falta"}')) = 1, 'filtro por tipo');
select pg_temp.ok(jsonb_array_length(escuta_listar('{"setor":"Perfumaria"}')) = 1, 'filtro por setor');
select pg_temp.ok(jsonb_array_length(escuta_listar('{"produto":"biscoito"}')) = 1, 'filtro por produto');
select pg_temp.ok(jsonb_array_length(escuta_listar(jsonb_build_object('de', to_char(now() + interval '2 day','YYYY-MM-DD')))) = 0, 'filtro por período');
select pg_temp.ok(jsonb_array_length((escuta_detalhe('11111111-1111-4111-8111-111111111111'))->'itens') = 3, 'detalhe mostra os 3 produtos');
select pg_temp.ok(((escuta_detalhe('11111111-1111-4111-8111-111111111111'))->'itens'->1->>'imagem_url') is null, 'imagem enviada pelo navegador é ignorada');
select pg_temp.ok((select telefone from escuta_envios where protocolo = :'prot2') = '89999990000', 'telefone guardado só com números');
select pg_temp.ok(jsonb_array_length((escuta_detalhe('22222222-2222-4222-8222-222222222222'))->'fotos') = 1, 'foto vinculada ao envio');
select pg_temp.ok((select count(*) from storage.objects) = 1, 'admin vê a foto');
select escuta_mudar_situacao('11111111-1111-4111-8111-111111111111','em_analise') is not null;
select escuta_mudar_situacao('11111111-1111-4111-8111-111111111111','resolvido') is not null;
select pg_temp.ok((select situacao from escuta_envios where id='11111111-1111-4111-8111-111111111111') = 'resolvido', 'situação persiste');
select pg_temp.ok(jsonb_array_length((escuta_detalhe('11111111-1111-4111-8111-111111111111'))->'historico') = 2, 'histórico guarda as mudanças');
select pg_temp.ok((select (r->>'mensagens')::int from jsonb_array_elements(escuta_plaquinhas_listar()) r where r->>'token' = :'t1') = 1, 'contagem por plaquinha');
select pg_temp.espera_erro(format($q$select escuta_apagar_plaquinha('%s')$q$, (select id from escuta_plaquinhas where token = :'t1')), 'desative');
select pg_temp.ok((escuta_catalogo_listar('cafe')->>'total')::int = 3, 'catálogo lista para o admin');
reset role;
-- retenção de contato: envio antigo perde nome/telefone no próximo envio
update escuta_envios set criado_em = now() - interval '13 months' where protocolo = :'prot2';
delete from escuta_limites;
set role anon;
select escuta_enviar(jsonb_build_object('id', gen_random_uuid(), 'tipo','elogio','descricao','Muito bom','tempo_ms',5000)) is not null;
reset role;
select pg_temp.ok((select nome is null and telefone is null and contato_apagado_em is not null from escuta_envios where protocolo = :'prot2'), 'contato apagado após 12 meses');
\echo TODOS_OS_TESTES_PASSARAM
