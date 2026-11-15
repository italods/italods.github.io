-- Testes do rh.sql. Dados INVENTADOS. Rode num banco de teste depois de supabase-simulado.sql, schema.sql e rh.sql.
-- NÃO rode no Supabase de produção.
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
set role authenticated; set request.jwt.claims = '{"email":"dono@x.com"}';

-- ===== horários e turmas
insert into rh_horarios (nome, ordem, dias) values ('Manhã', 0, '{"1": {"entrada": "07:00", "saida": "13:00"}, "6": {"entrada": "07:00", "saida": "12:00"},
  "0": {"entrada": "08:00", "saida": "12:00"}, "3": null, "x": 1}') returning id as manha \gset
select pg_temp.ok((select dias = '{"1": {"entrada": "07:00", "saida": "13:00"}, "6": {"entrada": "07:00", "saida": "12:00"}}'::jsonb
  and criado_por = 'dono@x.com' from rh_horarios where id = :'manha'), 'horário guarda só segunda a sábado (domingo fechado)');
select pg_temp.espera_erro($q$insert into rh_horarios (nome, dias) values ('Ruim', '{"2": {"entrada": "25:00", "saida": "13:00"}}')$q$, 'Hora inválida');
select pg_temp.espera_erro($q$insert into rh_horarios (nome, dias) values ('Ruim', '[]')$q$, 'horário inválido');
insert into rh_horarios (nome, dias) values ('Com almoço', '{"2": {"entrada": "07:00", "saida": "19:00", "intervalo": 120}, "3": {"entrada": "07:00", "saida": "12:00", "intervalo": 0}}') returning id as almoco \gset
select pg_temp.ok((select dias = '{"2": {"entrada": "07:00", "saida": "19:00", "intervalo": 120}, "3": {"entrada": "07:00", "saida": "12:00"}}'::jsonb
  from rh_horarios where id = :'almoco'), 'horário guarda o intervalo do almoço');
select pg_temp.espera_erro($q$insert into rh_horarios (nome, dias) values ('Ruim', '{"2": {"entrada": "07:00", "saida": "19:00", "intervalo": 300}}')$q$, 'Intervalo inválido');
insert into rh_turmas (nome, ordem) values ('Turma 1', 0) returning id as t1 \gset

-- ===== funcionários
insert into rh_funcionarios (nome, funcao, admissao, telefone, salario_centavos, turma)
values ('Ana Exemplo', 'Caixa', '2026-01-10', '(89) 99999-0000', 162100, :'t1') returning id as ana \gset
select pg_temp.ok((select salario_centavos = 162100 and turma = :'t1' from rh_funcionarios where id = :'ana'), 'funcionário com salário em centavos e turma');
select pg_temp.espera_erro($q$insert into rh_funcionarios (nome, admissao, desligamento) values ('X', '2026-05-01', '2026-04-01')$q$, 'rh_desligamento_depois');
select pg_temp.espera_erro($q$insert into rh_funcionarios (nome, telefone) values ('X', 'abc')$q$, 'telefone');
select pg_temp.espera_erro($q$insert into rh_funcionarios (nome, salario_centavos) values ('X', -1)$q$, 'salario');
select pg_temp.espera_erro($q$insert into rh_funcionarios (nome) values ('  ')$q$, 'nome');

-- ===== ocorrências, feriados e holerites
insert into rh_ocorrencias (funcionario, tipo, data, dias) values (:'ana', 'atestado', '2026-11-11', 3);
insert into rh_ocorrencias (funcionario, tipo, data, justificada) values (:'ana', 'falta', '2026-11-19', true);
select pg_temp.espera_erro(format($q$insert into rh_ocorrencias (funcionario, tipo, data) values (%L, 'falta', '2026-11-19')$q$, :'ana'), 'rh_ocorrencia_unica');
select pg_temp.espera_erro(format($q$insert into rh_ocorrencias (funcionario, tipo, data) values (%L, 'ferias', '2026-11-20')$q$, :'ana'), 'tipo');
select pg_temp.espera_erro(format($q$insert into rh_ocorrencias (funcionario, tipo, data, dias) values (%L, 'atestado', '2026-11-20', 0)$q$, :'ana'), 'dias');
insert into rh_feriados (data, nome) values ('2026-11-25', 'Aniversário da cidade');
select pg_temp.espera_erro($q$insert into rh_feriados (data, nome) values ('2026-11-25', 'Outro')$q$, 'rh_feriados_data_key');
insert into rh_holerites (funcionario, referencia, recebido_em) values (:'ana', '2026-11-01', '2026-12-05');
select pg_temp.espera_erro(format($q$insert into rh_holerites (funcionario, referencia, recebido_em) values (%L, '2026-11-01', '2026-12-06')$q$, :'ana'), 'rh_holerite_unico');
select pg_temp.espera_erro(format($q$insert into rh_holerites (funcionario, referencia, recebido_em) values (%L, '2026-12-15', '2026-12-06')$q$, :'ana'), 'referencia');
-- funcionário com histórico não se apaga (desliga)
select pg_temp.espera_erro(format($q$delete from rh_funcionarios where id = %L$q$, :'ana'), 'foreign key');
update rh_funcionarios set desligamento = '2026-12-31' where id = :'ana';
select pg_temp.ok((select editado_por = 'dono@x.com' from rh_funcionarios where id = :'ana'), 'desligar marca quem editou');
-- apagar turma deixa o funcionário sem turma
delete from rh_turmas where id = :'t1';
select pg_temp.ok((select turma is null from rh_funcionarios where id = :'ana'), 'turma apagada: funcionário fica sem turma');
-- ===== RH completo: ficha, histórico, ocorrências novas, banco de horas, férias, exames, treinamentos, EPI
insert into rh_turmas (nome, ordem) values ('Turma A', 0) returning id as ta \gset
insert into rh_funcionarios (nome, funcao, admissao, salario_centavos, gratificacao_centavos, cpf, pis, turma)
values ('Bia Inventada', 'Serviços gerais', '2025-03-10', 162100, 20000, '52998224725', '12345678919', :'ta') returning id as bia \gset
select pg_temp.ok((select gratificacao_centavos = 20000 and jornada_semanal_min = 2640 and desligamento_passos = '{}'::jsonb from rh_funcionarios where id = :'bia'),
  'ficha com gratificação e jornada de 44h');
select pg_temp.espera_erro($q$insert into rh_funcionarios (nome, cpf) values ('X', '123.456.789-00')$q$, 'rh_funcionarios_dados_check');
select pg_temp.espera_erro($q$insert into rh_funcionarios (nome, desligamento_tipo) values ('X', 'mandado_embora')$q$, 'rh_funcionarios_dados_check');
select pg_temp.espera_erro($q$insert into rh_funcionarios (nome, gratificacao_centavos) values ('X', -5)$q$, 'rh_funcionarios_dados_check');
update rh_funcionarios set salario_centavos = 170000, funcao = 'Caixa', turma = null where id = :'bia';
select pg_temp.ok((select count(*) from rh_historico where funcionario = :'bia') = 3, 'histórico grava salário, função e turma');
select pg_temp.ok((select antes = '162100' and depois = '170000' and data = current_date and criado_por = 'dono@x.com'
  from rh_historico where funcionario = :'bia' and campo = 'salario'), 'histórico do salário em centavos');
select pg_temp.ok((select antes = 'Turma A' and depois = '' from rh_historico where funcionario = :'bia' and campo = 'turma'), 'histórico da turma pelo nome');
update rh_funcionarios set observacao = 'nada' where id = :'bia';
select pg_temp.ok((select count(*) from rh_historico where funcionario = :'bia') = 3, 'observação não entra no histórico');

insert into rh_ocorrencias (funcionario, tipo, data, motivo) values (:'bia', 'advertencia', '2026-11-03', 'atraso repetido');
insert into rh_ocorrencias (funcionario, tipo, data, dias) values (:'bia', 'suspensao', '2026-11-04', 2);
insert into rh_ocorrencias (funcionario, tipo, data) values (:'bia', 'elogio', '2026-11-05');
insert into rh_ocorrencias (funcionario, tipo, data, banco) values (:'bia', 'folga', '2026-11-06', true);
select pg_temp.espera_erro(format($q$insert into rh_ocorrencias (funcionario, tipo, data, dias) values (%L, 'suspensao', '2026-11-10', 31)$q$, :'bia'), 'rh_ocorrencias_suspensao_check');
select pg_temp.espera_erro(format($q$insert into rh_ocorrencias (funcionario, tipo, data, banco) values (%L, 'falta', '2026-11-10', true)$q$, :'bia'), 'rh_ocorrencias_banco_check');

insert into rh_banco_horas (funcionario, data, minutos, motivo) values (:'bia', '2026-11-07', 90, 'inventário');
insert into rh_banco_horas (funcionario, data, minutos) values (:'bia', '2026-11-09', -30);
select pg_temp.espera_erro(format($q$insert into rh_banco_horas (funcionario, data, minutos) values (%L, '2026-11-09', 0)$q$, :'bia'), 'minutos');

insert into rh_ferias (funcionario, aquisitivo_inicio, inicio, dias) values (:'bia', '2025-03-10', '2026-04-06', 20);
insert into rh_ferias (funcionario, aquisitivo_inicio, inicio, dias) values (:'bia', '2025-03-10', '2026-07-06', 10);
select pg_temp.espera_erro(format($q$insert into rh_ferias (funcionario, aquisitivo_inicio, inicio, dias) values (%L, '2025-03-10', '2026-04-20', 5)$q$, :'bia'), 'se cruzam');
select pg_temp.espera_erro(format($q$insert into rh_ferias (funcionario, aquisitivo_inicio, inicio, dias) values (%L, '2025-03-10', '2026-09-01', 4)$q$, :'bia'), 'dias');
update rh_ferias set observacao = 'ok' where funcionario = :'bia' and inicio = '2026-04-06';
select pg_temp.ok(true, 'editar férias não acusa cruzamento consigo mesma');

insert into rh_exames (funcionario, tipo, data, validade) values (:'bia', 'admissional', '2025-03-05', '2027-03-05');
select pg_temp.espera_erro(format($q$insert into rh_exames (funcionario, tipo, data) values (%L, 'checkup', '2025-03-05')$q$, :'bia'), 'tipo');
select pg_temp.espera_erro(format($q$insert into rh_exames (funcionario, tipo, data, validade) values (%L, 'periodico', '2025-03-05', '2024-01-01')$q$, :'bia'), 'rh_exame_validade');
insert into rh_treinamentos (funcionario, data, nome, horas) values (:'bia', '2025-04-01', 'Boas práticas', 8);
insert into rh_entregas (funcionario, data, item, quantidade, ca) values (:'bia', '2025-03-10', 'Bota de borracha', 1, '12345');
select pg_temp.espera_erro(format($q$insert into rh_entregas (funcionario, data, item, devolvido_em) values (%L, '2025-03-10', 'Avental', '2025-01-01')$q$, :'bia'), 'rh_entrega_devolucao');
select pg_temp.espera_erro(format($q$delete from rh_funcionarios where id = %L$q$, :'bia'), 'foreign key');
update rh_funcionarios set desligamento = '2026-11-30', desligamento_tipo = 'sem_justa_causa', desligamento_aviso = 'indenizado',
  desligamento_passos = '{"contador": true}' where id = :'bia';
select pg_temp.ok((select desligamento_passos ->> 'contador' = 'true' from rh_funcionarios where id = :'bia'), 'desligamento com passo a passo');

-- semana de referência da escala
insert into configuracoes (chave, valor) values ('rh_semana_ref', '2026-11-02') on conflict (chave) do update set valor = excluded.valor;
reset role;

-- ===== segurança
set role anon; set request.jwt.claims = '{}';
select pg_temp.espera_erro('select * from rh_funcionarios', 'permission denied');
select pg_temp.espera_erro('select * from rh_ocorrencias', 'permission denied');
select pg_temp.espera_erro('select * from rh_horarios', 'permission denied');
select pg_temp.espera_erro('select * from rh_turmas', 'permission denied');
select pg_temp.espera_erro('select * from rh_feriados', 'permission denied');
select pg_temp.espera_erro('select * from rh_holerites', 'permission denied');
select pg_temp.espera_erro('select * from rh_banco_horas', 'permission denied');
select pg_temp.espera_erro('select * from rh_ferias', 'permission denied');
select pg_temp.espera_erro('select * from rh_historico', 'permission denied');
select pg_temp.espera_erro('select * from rh_exames', 'permission denied');
select pg_temp.espera_erro('select * from rh_treinamentos', 'permission denied');
select pg_temp.espera_erro('select * from rh_entregas', 'permission denied');
reset role;
set role authenticated; set request.jwt.claims = '{"email":"intruso@x.com"}';
select pg_temp.ok((select count(*) from rh_funcionarios) = 0 and (select count(*) from rh_ocorrencias) = 0
  and (select count(*) from rh_holerites) = 0 and (select count(*) from rh_horarios) = 0
  and (select count(*) from rh_banco_horas) = 0 and (select count(*) from rh_ferias) = 0 and (select count(*) from rh_historico) = 0
  and (select count(*) from rh_exames) = 0 and (select count(*) from rh_treinamentos) = 0 and (select count(*) from rh_entregas) = 0,
  'logado mas não autorizado não vê o RH');
select pg_temp.espera_erro(format($q$insert into rh_banco_horas (funcionario, data, minutos) values (%L, '2026-11-09', 60)$q$, :'bia'), 'row-level security');
select pg_temp.espera_erro($q$insert into rh_funcionarios (nome) values ('Intruso')$q$, 'row-level security');
select pg_temp.espera_erro($q$insert into rh_feriados (data, nome) values ('2026-12-01', 'x')$q$, 'row-level security');
reset role;
\echo TODOS_OS_TESTES_PASSARAM
