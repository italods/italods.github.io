-- Testes do schema.sql (conferência de caixa e cupom do Diamante). Dados INVENTADOS.
-- Rode num banco de teste depois de supabase-simulado.sql e schema.sql. NÃO rode no Supabase de produção.
\set ON_ERROR_STOP 1
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

insert into usuarios_autorizados(email, nome) values ('dono@x.com', 'Dono') on conflict do nothing;

-- ===== nome abreviado
select pg_temp.ok(abreviar_nome('JOANA DE TAL DA SILVA') = 'JOANA T.', 'abrevia nome com partículas');
select pg_temp.ok(abreviar_nome('PEDRO EXEMPLO (MERCADINHO)') = 'PEDRO E.', 'tira apelido entre parênteses');
select pg_temp.ok(abreviar_nome('ZEZINHO') = 'ZEZINHO', 'nome de uma palavra fica igual');
select pg_temp.ok(abreviar_nome('JOANA T.') = 'JOANA T.', 'abreviar de novo não muda');
select pg_temp.ok(abreviar_nome(null) = '', 'nome vazio');

set role authenticated; set request.jwt.claims = '{"email":"dono@x.com"}';

-- ===== fechamento antigo (sem cupom) continua igual
insert into movimentos (tipo, caixa, data, hora, valor_centavos, motivo) values
  ('sangria', 'caixa9', '2027-01-15', '12:00', 100000, 'cofre'),
  ('sangria', 'caixa9', '2027-01-15', '16:00', 20000, 'cofre');
insert into conferencias (tipo, caixa, data, hora, contagem, fundo_centavos, vendas_dinheiro_centavos, recebimentos_dinheiro_centavos)
values ('fechamento', 'caixa9', '2027-01-15', '19:00', '{"5000": 7}', 40000, 100050, 20000)
returning id as sem_cupom \gset
select pg_temp.ok((select esperado_centavos = 40000 + 100050 + 20000 - 120000 and sangrias_centavos = 120000
  and sangrias_lancadas_centavos = 120000 and cupom is null from conferencias where id = :'sem_cupom'),
  'sem cupom: sangrias lançadas entram no esperado');

-- ===== fechamento com cupom: fundo, dinheiro e sangrias vêm do cupom
insert into conferencias (tipo, caixa, data, hora, contagem, fundo_centavos, vendas_dinheiro_centavos, cupom)
values ('fechamento', 'caixa9', '2027-01-15', '19:30', '{"5000": 7}', 99999, 1, '{
  "terminal": "7", "data": "2027-01-15", "turno": "12-1", "operador": "FULANO", "origem": "pdf",
  "formas": {"dinheiro": {"vendas": 100050, "receb": 20000}, "carteira": {"vendas": 30000, "receb": 0},
             "credito": {"vendas": 15025, "receb": 0}, "debito": {"vendas": 9975, "receb": 100000},
             "pix": {"vendas": 5000, "receb": 1000}, "pix_delivery": {"vendas": 2000, "receb": 30000}},
  "venda_bruta": 162050, "fundo": 40000, "sangria": 125000, "recebimento": 151000, "total_liquido": 35050,
  "cancelamentos": 1234, "desconto": 50, "acrescimos": 0,
  "recebimentos": [{"forma": "debito", "valor": 100000, "codigo": "501", "nome": "JOANA DE TAL DA SILVA"}],
  "sangrias": [100000, 25000], "campo_estranho": "não deve ser guardado"}')
returning id as com_cupom \gset
select pg_temp.ok((select fundo_centavos = 40000 and vendas_dinheiro_centavos = 100050 and recebimentos_dinheiro_centavos = 20000
  from conferencias where id = :'com_cupom'), 'fundo e dinheiro vêm do cupom (ignora o que veio digitado)');
select pg_temp.ok((select sangrias_centavos = 125000 and sangrias_lancadas_centavos = 120000 from conferencias where id = :'com_cupom'),
  'sangrias do cupom no esperado; lançadas guardadas para comparar');
select pg_temp.ok((select esperado_centavos = 35050 and diferenca_centavos = 35000 - 35050 from conferencias where id = :'com_cupom'),
  'esperado = total líquido do cupom; diferença = contado − esperado');
select pg_temp.ok((select pix_centavos = 6000 and debito_centavos = 109975 and credito_centavos = 15025 and carteira_centavos = 30000
  from conferencias where id = :'com_cupom'), 'outras formas preenchidas pelo cupom (vendas + recebimentos)');
select pg_temp.ok((select cupom #>> '{recebimentos,0,nome}' = 'JOANA T.' and not (cupom ? 'campo_estranho')
  from conferencias where id = :'com_cupom'), 'banco abrevia o nome e descarta campos desconhecidos');
select pg_temp.ok((select (cupom #>> '{formas,pix_delivery,receb}')::int = 30000 and cupom ->> 'origem' = 'pdf'
  from conferencias where id = :'com_cupom'), 'cupom guardado com todas as formas');

-- nova sangria lançada recalcula só as lançadas (o esperado continua pelo cupom)
insert into movimentos (tipo, caixa, data, hora, valor_centavos) values ('sangria', 'caixa9', '2027-01-15', '18:00', 5000);
select pg_temp.ok((select sangrias_centavos = 125000 and sangrias_lancadas_centavos = 125000 and esperado_centavos = 35050
  from conferencias where id = :'com_cupom'), 'lançar sangria atualiza a comparação, não o esperado do cupom');
select pg_temp.ok((select sangrias_centavos = 125000 and esperado_centavos = 40000 + 100050 + 20000 - 125000
  from conferencias where id = :'sem_cupom'), 'fechamento sem cupom continua usando as lançadas');

-- tirar o cupom volta a usar as lançadas
update conferencias set cupom = null where id = :'com_cupom';
select pg_temp.ok((select sangrias_centavos = 125000 and cupom is null from conferencias where id = :'com_cupom'), 'sem cupom de novo');

-- ===== validações
select pg_temp.espera_erro($q$insert into conferencias (tipo, caixa, data, hora, cupom) values ('fechamento', 'caixa9', '2027-01-16', '19:00',
  '{"data": "2027-01-15", "formas": {}}')$q$, 'data do cupom');
select pg_temp.espera_erro($q$insert into conferencias (tipo, caixa, data, hora, cupom) values ('fechamento', 'caixa9', '2027-01-15', '19:00',
  '{"formas": {"debito": {"vendas": -5}}}')$q$, 'negativo');
select pg_temp.espera_erro($q$insert into conferencias (tipo, caixa, data, hora, cupom) values ('fechamento', 'caixa9', '2027-01-15', '19:00',
  '{"formas": {"pix": {"vendas": 10.5}}}')$q$, 'centavos');
select pg_temp.espera_erro($q$insert into conferencias (tipo, caixa, data, hora, cupom) values ('fechamento', 'caixa9', '2027-01-15', '19:00',
  '{"formas": {}, "recebimentos": [{"forma": "cheque", "valor": 1}]}')$q$, 'forma de recebimento');
select pg_temp.espera_erro($q$insert into conferencias (tipo, caixa, data, hora, cupom) values ('fechamento', 'caixa9', '2027-01-15', '19:00',
  '"texto"')$q$, 'cupom inválido');
-- total líquido pode ser negativo (sangria maior que o dinheiro)
insert into conferencias (tipo, caixa, data, hora, cupom) values ('fechamento', 'caixa8', '2027-01-15', '19:00',
  '{"formas": {"dinheiro": {"vendas": 100, "receb": 0}}, "fundo": 0, "sangria": 500, "total_liquido": -400}');
select pg_temp.ok((select esperado_centavos = -400 from conferencias where caixa = 'caixa8'), 'total líquido negativo é aceito');

-- abertura nunca guarda cupom
insert into conferencias (tipo, caixa, data, hora, contagem, cupom) values ('abertura', 'caixa9', '2027-01-16', '07:00', '{"5000": 6}', '{"formas": {}}')
returning id as abertura \gset
select pg_temp.ok((select cupom is null and sangrias_lancadas_centavos is null from conferencias where id = :'abertura'), 'abertura sem cupom');
reset role;

-- ===== segurança
set role anon; set request.jwt.claims = '{}';
select pg_temp.espera_erro('select cupom from conferencias', 'permission denied');
reset role;
set role authenticated; set request.jwt.claims = '{"email":"intruso@x.com"}';
select pg_temp.ok((select count(*) from conferencias) = 0, 'logado mas não autorizado não vê conferências');
select pg_temp.espera_erro($q$insert into conferencias (tipo, caixa, data, hora) values ('abertura', 'caixa9', '2027-01-15', '07:00')$q$, 'row-level security');
reset role;
\echo TODOS_OS_TESTES_PASSARAM
