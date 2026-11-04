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

-- ===== fechamento só com a contagem (falta o cupom)
insert into conferencias (tipo, caixa, data, hora, contagem, pendente) values ('fechamento', 'caixa7', '2027-01-20', '19:00', '{"5000": 3}', true)
returning id as pendente \gset
select pg_temp.ok((select pendente and esperado_centavos is null and diferenca_centavos is null and total_centavos = 15000
  from conferencias where id = :'pendente'), 'pendente: guarda a contagem, sem esperado nem diferença');
update conferencias set cupom = '{"data": "2027-01-20", "formas": {"dinheiro": {"vendas": 10000}}, "fundo": 5000, "sangria": 0, "total_liquido": 15000}'
  where id = :'pendente';
select pg_temp.ok((select not pendente and esperado_centavos = 15000 and diferenca_centavos = 0 from conferencias where id = :'pendente'),
  'com o cupom deixa de ser pendente e calcula a diferença');
insert into conferencias (tipo, caixa, data, hora, pendente) values ('abertura', 'caixa7', '2027-01-21', '07:00', true) returning id as ab_pend \gset
select pg_temp.ok((select not pendente from conferencias where id = :'ab_pend'), 'abertura nunca fica pendente');

-- ===== caixa aberto não abre de novo
insert into conferencias (tipo, caixa, data, hora) values ('abertura', 'caixa6', '2027-01-20', '07:00') returning id as ab1 \gset
select pg_temp.espera_erro($q$insert into conferencias (tipo, caixa, data, hora) values ('abertura', 'caixa6', '2027-01-20', '08:00')$q$,
  'já está aberto (abertura das 07:00)');
select pg_temp.espera_erro($q$insert into conferencias (tipo, caixa, data, hora) values ('abertura', 'caixa6', '2027-01-20', '06:00')$q$,
  'abertura às 07:00 sem fechamento');
insert into conferencias (tipo, caixa, data, hora, pendente) values ('fechamento', 'caixa6', '2027-01-20', '12:00', true);
insert into conferencias (tipo, caixa, data, hora) values ('abertura', 'caixa6', '2027-01-20', '13:00');
select pg_temp.ok(true, 'depois de fechar (mesmo faltando o cupom) abre de novo');
insert into conferencias (tipo, caixa, data, hora) values ('abertura', 'caixa6', '2027-01-21', '07:00');
select pg_temp.ok(true, 'abertura em outro dia não depende do dia anterior');
insert into conferencias (tipo, caixa, data, hora) values ('abertura', 'caixa5', '2027-01-20', '08:00');
select pg_temp.ok(true, 'outro caixa abre normalmente');
insert into conferencias (tipo, caixa, data, hora) values ('fechamento', 'caixa4', '2027-01-20', '19:00');
select pg_temp.ok(true, 'fechar sem abertura é permitido');
update conferencias set observacao = 'contagem conferida' where id = :'ab1';
select pg_temp.ok(true, 'editar a abertura (sem mudar hora) não esbarra nela mesma');
select pg_temp.espera_erro(format($q$update conferencias set hora = '14:00' where id = %L$q$, :'ab1'), 'já está aberto (abertura das 13:00)');

-- ===== histórico de edições
select pg_temp.ok((select count(*) = 1 and min(dados ->> 'observacao') = '' and min(operacao) = 'editado' and min(feito_por) = 'dono@x.com'
  from versoes where registro = :'ab1'), 'editar guarda como estava antes, com quem editou');
update conferencias set observacao = 'contagem conferida' where id = :'ab1';
select pg_temp.ok((select count(*) = 1 from versoes where registro = :'ab1'), 'salvar sem mudar nada não cria versão');
select pg_temp.ok((select count(*) = 0 from versoes where registro = :'sem_cupom'), 'recálculo por sangria lançada não conta como edição');
select pg_temp.ok((select count(*) = 1 from versoes where registro = :'com_cupom' and dados -> 'cupom' is not null and dados ->> 'cupom' <> 'null'),
  'tirar o cupom guardou a versão com o cupom');
delete from conferencias where id = :'ab_pend';
select pg_temp.ok((select operacao = 'apagado' and dados ->> 'caixa' = 'caixa7' from versoes where registro = :'ab_pend'), 'apagar guarda o registro apagado');
insert into conferencias select * from jsonb_populate_record(null::conferencias, (select dados from versoes where registro = :'ab_pend'));
select pg_temp.ok((select count(*) = 1 from conferencias where id = :'ab_pend'), 'registro apagado pode ser restaurado com o mesmo id');
insert into movimentos (tipo, caixa, data, hora, valor_centavos) values ('sangria', 'caixa6', '2027-01-20', '10:00', 1000) returning id as mov \gset
update movimentos set valor_centavos = 2000 where id = :'mov';
select pg_temp.ok((select (dados ->> 'valor_centavos')::int = 1000 and tabela = 'movimentos' from versoes where registro = :'mov'), 'sangria editada também guarda versão');
select pg_temp.espera_erro($q$insert into versoes (tabela, registro, operacao, dados) values ('movimentos', gen_random_uuid(), 'editado', '{}')$q$, 'permission denied');
select pg_temp.espera_erro($q$delete from versoes$q$, 'permission denied');
reset role;

-- ===== Cielo: máquinas, trocas e vendas
set role authenticated; set request.jwt.claims = '{"email":"dono@x.com"}';
insert into maquinas (numero, apelido, caixa) values ('00011111', 'Máquina A', 'caixa1'), ('00022222', 'Máquina B', 'caixa2');
select pg_temp.ok((select criado_por = 'dono@x.com' from maquinas where numero = '00011111'), 'máquina com autoria');
select pg_temp.espera_erro($q$insert into maquinas (numero) values ('12a')$q$, 'check');
insert into maquina_trocas (data, maquina, caixa, hora_de, hora_ate) values ('2027-01-15', '00011111', 'caixa2', '12:00', '13:00');
select pg_temp.espera_erro($q$insert into maquina_trocas (data, maquina, caixa, hora_de, hora_ate) values ('2027-01-15', '00011111', 'caixa2', '14:00', '13:00')$q$, 'troca_horario');
select pg_temp.espera_erro($q$insert into maquina_trocas (data, maquina, caixa) values ('2027-01-15', '99999999', 'caixa2')$q$, 'foreign key');

insert into cielo_vendas (chave, data, hora, forma, forma_original, bandeira, valor_centavos, aprovada, status, maquina, nsu, txid, pagador)
values ('pix|TX1', '2027-01-15', '18:33', 'pix', 'Pix', 'Pix', 4200, true, 'Aprovada', '00022222', '5550001', 'TX1', 'JOANA DE TAL DA SILVA'),
       ('cartao|00011111|2027-01-15|900002|654321|100000', '2027-01-15', '12:10', 'debito', 'Débito à vista', 'Visa', 100000, true, 'Aprovada', '00011111', '900002', '', '');
select pg_temp.ok((select pagador = 'JOANA T.' and importado_por = 'dono@x.com' from cielo_vendas where chave = 'pix|TX1'), 'pagador abreviado pelo banco');
-- reimportar: on conflict (chave) do nothing não duplica
insert into cielo_vendas (chave, data, hora, forma, valor_centavos, aprovada, maquina)
values ('pix|TX1', '2027-01-15', '18:33', 'pix', 4200, true, '00022222'), ('pix|TX2', '2027-01-15', '18:40', 'pix', 600, true, '00022222')
on conflict (chave) do nothing;
select pg_temp.ok((select count(*) from cielo_vendas) = 3, 'reimportar não duplica (só a venda nova entrou)');
select pg_temp.espera_erro($q$insert into cielo_vendas (chave, data, hora, forma, valor_centavos, aprovada, maquina) values ('x|1', '2027-01-15', '10:00', 'cheque', 100, true, '1')$q$, 'check');
select pg_temp.espera_erro($q$insert into cielo_vendas (chave, data, hora, forma, valor_centavos, aprovada, maquina) values ('x|2', '2027-01-15', '10:00', 'pix', 0, true, '1')$q$, 'check');
insert into cielo_vendas (chave, data, hora, forma, valor_centavos, aprovada, maquina, pagador)
values ('pix|TX3', '2027-01-15', '10:00', 'pix', 10, true, '1', 'MARIA ' || repeat('MUITO ', 10));
select pg_temp.ok((select pagador = 'MARIA M.' from cielo_vendas where chave = 'pix|TX3'), 'nome comprido é aceito e abreviado');
select pg_temp.espera_erro($q$insert into cielo_vendas (chave, data, hora, forma, valor_centavos, aprovada, maquina) values ('x', '2027-01-15', '10:00', 'pix', 10, true, '1')$q$, 'chave');
reset role;

-- ===== Banco do Brasil e configurações
set role authenticated; set request.jwt.claims = '{"email":"dono@x.com"}';
insert into configuracoes (chave, valor) values ('cnpj_loja', '11222333000144');
select pg_temp.ok((select criado_por = 'dono@x.com' from configuracoes where chave = 'cnpj_loja'), 'configuração com autoria');
select pg_temp.espera_erro($q$insert into configuracoes (chave, valor) values ('Chave Errada', 'x')$q$, 'check');
insert into banco_lancamentos (chave, data, hora, data_lancamento, tipo, categoria, pagador_tipo, pagador, documento, valor_centavos)
values ('bb|40744200000004|2027-01-04|95000|', '2027-01-04', '07:44', '2027-01-04', 'Pix - Recebido', 'pix_terceiro', 'pf', 'JOANA DE TAL DA SILVA', '40744200000004', 95000),
       ('bb|310708500000001|2027-01-04|150045|', '2026-12-31', '07:08', '2027-01-04', 'Pix - Recebido', 'repasse_cielo', '', '', '310708500000001', 150045);
select pg_temp.ok((select pagador = 'JOANA T.' and importado_por = 'dono@x.com' from banco_lancamentos where valor_centavos = 95000), 'pagador do BB abreviado pelo banco');
insert into banco_lancamentos (chave, data, data_lancamento, categoria, valor_centavos)
values ('bb|40744200000004|2027-01-04|95000|', '2027-01-04', '2027-01-04', 'pix_terceiro', 95000) on conflict (chave) do nothing;
select pg_temp.ok((select count(*) from banco_lancamentos) = 2, 'reimportar o extrato não duplica');
select pg_temp.espera_erro($q$insert into banco_lancamentos (chave, data, data_lancamento, categoria, valor_centavos) values ('bb|x|1|2', '2027-01-04', '2027-01-04', 'saida', 100)$q$, 'check');
select pg_temp.espera_erro($q$insert into banco_lancamentos (chave, data, data_lancamento, categoria, valor_centavos) values ('bb|x|1|3', '2027-01-04', '2027-01-04', 'outro', -100)$q$, 'check');
select pg_temp.espera_erro($q$insert into banco_lancamentos (chave, data, data_lancamento, categoria, valor_centavos, documento) values ('bb|x|1|4', '2027-01-04', '2027-01-04', 'outro', 100, '123.456.789-01')$q$, 'check');
update banco_lancamentos set caixa = 'caixa1' where valor_centavos = 95000;
select pg_temp.ok((select caixa = 'caixa1' and pagador = 'JOANA T.' from banco_lancamentos where valor_centavos = 95000), 'atribuir PIX a um caixa');
reset role;

-- ===== Conciliação: taxas e recebíveis
set role authenticated; set request.jwt.claims = '{"email":"dono@x.com"}';
insert into cielo_taxas (modalidade, bandeira, parcelas, taxa, prazo_dias_uteis) values
  ('debito', 'visa', 1, 87, 1), ('parcelado', 'mastercard', 3, 512, 1), ('pix', '*', 1, 59, 0);
select pg_temp.ok((select taxa = 87 and criado_por = 'dono@x.com' from cielo_taxas where modalidade = 'debito'), 'taxa com autoria');
select pg_temp.espera_erro($q$insert into cielo_taxas (modalidade, bandeira, parcelas, taxa) values ('debito', 'visa', 1, 100)$q$, 'cielo_taxas_unica');
select pg_temp.espera_erro($q$insert into cielo_taxas (modalidade, bandeira, parcelas, taxa) values ('credito', 'visa', 3, 100)$q$, 'cielo_taxas_parcelas');
select pg_temp.espera_erro($q$insert into cielo_taxas (modalidade, bandeira, parcelas, taxa) values ('debito', 'Visa X', 1, 100)$q$, 'check');
select pg_temp.espera_erro($q$insert into cielo_taxas (modalidade, bandeira, parcelas, taxa) values ('credito', 'visa', 1, 10000)$q$, 'check');
insert into cielo_recebiveis (chave, data_pagamento, data_venda, modalidade, bandeira, valor_bruto, taxa, valor_liquido, nsu, autorizacao)
values ('rec|2027-01-18|Venda débito|900002|654321|0|100000', '2027-01-18', '2027-01-15', 'debito', 'Visa', 100000, 940, 99060, '900002', '654321'),
       ('rec|2027-01-18|Aluguel|||0|-8990', '2027-01-18', null, 'outro', '', -8990, 0, -8990, '', '');
insert into cielo_recebiveis (chave, data_pagamento, modalidade, valor_bruto, valor_liquido)
values ('rec|2027-01-18|Venda débito|900002|654321|0|100000', '2027-01-18', 'debito', 100000, 99060) on conflict (chave) do nothing;
select pg_temp.ok((select count(*) from cielo_recebiveis) = 2 and (select importado_por from cielo_recebiveis limit 1) = 'dono@x.com',
  'recebíveis: reimportar não duplica; cobrança negativa aceita; autoria');
select pg_temp.espera_erro($q$insert into cielo_recebiveis (chave, data_pagamento, modalidade, valor_bruto, valor_liquido) values ('rec|x|1', '2027-01-18', 'cheque', 1, 1)$q$, 'check');
reset role;

-- ===== segurança
set role anon; set request.jwt.claims = '{}';
select pg_temp.espera_erro('select * from cielo_taxas', 'permission denied');
select pg_temp.espera_erro('select * from cielo_recebiveis', 'permission denied');
select pg_temp.espera_erro('select * from banco_lancamentos', 'permission denied');
select pg_temp.espera_erro('select * from configuracoes', 'permission denied');
select pg_temp.espera_erro('select cupom from conferencias', 'permission denied');
select pg_temp.espera_erro('select * from cielo_vendas', 'permission denied');
select pg_temp.espera_erro('select * from maquinas', 'permission denied');
select pg_temp.espera_erro('select * from maquina_trocas', 'permission denied');
select pg_temp.espera_erro('select * from versoes', 'permission denied');
reset role;
set role authenticated; set request.jwt.claims = '{"email":"intruso@x.com"}';
select pg_temp.ok((select count(*) from conferencias) = 0, 'logado mas não autorizado não vê conferências');
select pg_temp.ok((select count(*) from cielo_vendas) = 0 and (select count(*) from maquinas) = 0, 'não autorizado não vê Cielo nem máquinas');
select pg_temp.ok((select count(*) from banco_lancamentos) = 0 and (select count(*) from configuracoes) = 0, 'não autorizado não vê BB nem configurações');
select pg_temp.ok((select count(*) from cielo_taxas) = 0 and (select count(*) from cielo_recebiveis) = 0, 'não autorizado não vê taxas nem recebíveis');
select pg_temp.ok((select count(*) from versoes) = 0, 'não autorizado não vê o histórico de edições');
select pg_temp.espera_erro($q$insert into maquinas (numero) values ('123')$q$, 'row-level security');
select pg_temp.espera_erro($q$insert into conferencias (tipo, caixa, data, hora) values ('abertura', 'caixa9', '2027-01-15', '07:00')$q$, 'row-level security');
reset role;
\echo TODOS_OS_TESTES_PASSARAM
