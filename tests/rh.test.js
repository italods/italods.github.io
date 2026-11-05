// Testes do RH (escala rotativa, dia do funcionário, resumo do mês). Nomes e dados INVENTADOS.
const test = require("node:test");
const assert = require("node:assert/strict");
const RH = require("../sistema/js/rh.js");

const manha = { id: "hm", nome: "Manhã", ordem: 0, dias: { 1: { entrada: "07:00", saida: "13:00" }, 2: { entrada: "07:00", saida: "13:00" },
  3: { entrada: "07:00", saida: "13:00" }, 4: { entrada: "07:00", saida: "13:00" }, 5: { entrada: "07:00", saida: "13:00" }, 6: { entrada: "07:00", saida: "12:00" } } };
const tarde = { id: "ht", nome: "Tarde", ordem: 1, dias: { 1: { entrada: "13:00", saida: "19:30" }, 2: { entrada: "13:00", saida: "19:30" },
  3: { entrada: "13:00", saida: "19:30" }, 4: { entrada: "13:00", saida: "19:30" }, 5: { entrada: "13:00", saida: "19:30" } } };
const turmas = [{ id: "t1", nome: "Turma 1", ordem: 0 }, { id: "t2", nome: "Turma 2", ordem: 1 }];
const ana = { id: "f1", nome: "Ana Exemplo", funcao: "Caixa", turma: "t1", admissao: "2026-01-10" };
const beto = { id: "f2", nome: "Beto Teste", funcao: "Serviços gerais", turma: "t2", admissao: "2026-11-11" };
const ctx = (ocorrencias, feriados) => ({ turmas, horarios: [manha, tarde], ref: "2026-11-02", ocorrencias: ocorrencias || [], feriados: feriados || [] });

test("datas: segunda da semana, semanas, dias do mês, horas", () => {
  assert.equal(RH.segundaDaSemana("2026-11-08"), "2026-11-02", "domingo pertence à semana que começou na segunda");
  assert.equal(RH.segundaDaSemana("2026-11-09"), "2026-11-09");
  assert.equal(RH.semanasEntre("2026-11-02", "2026-11-14"), 1);
  assert.equal(RH.semanasEntre("2026-11-04", "2026-10-31"), -1);
  assert.equal(RH.diasDoMes(2028, 2).length, 29);
  assert.equal(RH.lerHora("7:00"), "07:00");
  assert.equal(RH.lerHora("1330"), "13:30");
  assert.equal(RH.lerHora("7h"), "07:00");
  assert.equal(RH.lerHora("24:00"), null);
  assert.equal(RH.lerHora("abc"), null);
  assert.equal(RH.duracao("07:00", "13:00"), 360);
  assert.equal(RH.duracao("22:00", "02:00"), 240, "passa da meia-noite");
  assert.equal(RH.horas(390), "6h30");
});

test("turmas trocam manhã/tarde toda semana", () => {
  const c = ctx();
  assert.equal(RH.horarioDaTurma(turmas, c.horarios, c.ref, "t1", "2026-11-04").nome, "Manhã");
  assert.equal(RH.horarioDaTurma(turmas, c.horarios, c.ref, "t2", "2026-11-04").nome, "Tarde");
  assert.equal(RH.horarioDaTurma(turmas, c.horarios, c.ref, "t1", "2026-11-10").nome, "Tarde", "semana seguinte inverte");
  assert.equal(RH.horarioDaTurma(turmas, c.horarios, c.ref, "t2", "2026-11-10").nome, "Manhã");
  assert.equal(RH.horarioDaTurma(turmas, c.horarios, c.ref, "t1", "2026-10-28").nome, "Tarde", "semana anterior também");
  assert.equal(RH.horarioDaTurma(turmas, c.horarios, c.ref, "t1", "2026-11-18").nome, "Manhã");
  assert.equal(RH.horarioDaTurma(turmas, c.horarios, c.ref, "nenhuma", "2026-11-18"), null);
});

test("dia do funcionário: escala, domingo, sábado sem horário, feriado, ocorrências", () => {
  const ocs = [
    { id: "o1", funcionario: "f1", tipo: "folga", data: "2026-11-05", motivo: "aniversário" },
    { id: "o2", funcionario: "f1", tipo: "atestado", data: "2026-11-11", dias: 3 },
    { id: "o3", funcionario: "f1", tipo: "falta", data: "2026-11-19", justificada: false },
    { id: "o4", funcionario: "f1", tipo: "feriado_trabalhado", data: "2026-11-20" }
  ];
  const c = ctx(ocs);
  const d = (t, f) => RH.diaDoFuncionario(c, f || ana, t);
  assert.deepEqual([d("2026-11-04").tipo, d("2026-11-04").entrada, d("2026-11-04").saida], ["trabalho", "07:00", "13:00"]);
  assert.equal(d("2026-11-08").tipo, "domingo");
  assert.equal(d("2026-11-05").tipo, "folga");
  assert.equal(d("2026-11-07").saida, "12:00", "sábado da manhã sai mais cedo");
  assert.equal(d("2026-11-14").tipo, "folga_escala", "tarde não tem sábado");
  assert.equal(d("2026-11-11").tipo, "atestado");
  assert.equal(d("2026-11-13").tipo, "atestado", "atestado de 3 dias cobre até 13/11");
  assert.equal(d("2026-11-16").tipo, "trabalho");
  assert.equal(d("2026-11-19").tipo, "falta");
  assert.equal(d("2026-11-15").tipo, "domingo", "domingo antes do feriado");
  // 20/11 (Consciência Negra): Ana trabalhou, Beto não
  assert.equal(d("2026-11-20").tipo, "trabalho");
  assert.equal(d("2026-11-20").feriado.nome, "Dia da Consciência Negra");
  assert.equal(d("2026-11-20", beto).tipo, "feriado");
  assert.equal(d("2026-11-10", beto).tipo, "fora", "antes da admissão");
  // ponto facultativo é dia normal; feriado local entra
  assert.equal(RH.diaDoFuncionario(ctx(), ana, "2027-02-08").tipo, "trabalho", "Carnaval: dia normal");
  assert.equal(RH.diaDoFuncionario(ctx(), ana, "2027-02-08").feriado.facultativo, true);
  assert.equal(RH.diaDoFuncionario(ctx([], [{ data: "2026-11-25", nome: "Aniversário da cidade" }]), ana, "2026-11-25").tipo, "feriado");
  assert.equal(RH.diaDoFuncionario(ctx(), { id: "f3", nome: "Sem turma" }, "2026-11-25").tipo, "sem_escala");
  assert.equal(RH.diaDoFuncionario(ctx(), Object.assign({}, ana, { desligamento: "2026-11-20" }), "2026-11-23").tipo, "fora");
});

test("resumo do mês para o contador", () => {
  const ocs = [
    { id: "o1", funcionario: "f1", tipo: "folga", data: "2026-11-05" },
    { id: "o2", funcionario: "f1", tipo: "atestado", data: "2026-11-28", dias: 5 },
    { id: "o3", funcionario: "f1", tipo: "falta", data: "2026-11-19", justificada: false },
    { id: "o5", funcionario: "f1", tipo: "falta", data: "2026-11-03", justificada: true },
    { id: "o4", funcionario: "f1", tipo: "feriado_trabalhado", data: "2026-11-20" },
    { id: "o6", funcionario: "f2", tipo: "feriado_trabalhado", data: "2026-11-15" }
  ];
  const c = ctx(ocs);
  const holerites = [{ funcionario: "f1", referencia: "2026-11-01", recebido_em: "2026-12-05" }];
  const r = RH.resumoFuncionario(c, ana, 2026, 11, holerites);
  assert.equal(r.faltas.length, 2);
  assert.equal(r.faltasJustificadas, 1);
  assert.equal(r.faltasSemJustificativa, 1);
  assert.equal(r.folgas.length, 1);
  assert.equal(r.atestados.length, 1);
  assert.equal(r.diasAtestado, 3, "atestado de 28/11 por 5 dias: 28, 29 e 30 no mês (dias corridos); o resto em dezembro");
  assert.equal(RH.resumoFuncionario(c, ana, 2026, 12, holerites).diasAtestado, 2, "1 e 2/12 no mês seguinte");
  assert.deepEqual(r.feriadosTrabalhados, [{ data: "2026-11-20", nome: "Dia da Consciência Negra" }]);
  assert.equal(r.holerite.recebido_em, "2026-12-05");
  const rb = RH.resumoFuncionario(c, beto, 2026, 11, holerites);
  assert.deepEqual(rb.feriadosTrabalhados, [{ data: "2026-11-15", nome: "Proclamação da República" }], "feriado no domingo marcado também conta");
  assert.equal(rb.holerite, null);
  const ativos = RH.ativosNoMes([beto, ana, Object.assign({}, ana, { id: "f9", nome: "Carlos Antigo", desligamento: "2026-10-31" })], 2026, 11);
  assert.deepEqual(ativos.map((f) => f.nome), ["Ana Exemplo", "Beto Teste"]);
  const txt = RH.textoResumo([r, rb], 2026, 11);
  assert.match(txt, /RH de novembro de 2026/);
  assert.match(txt, /\*Ana Exemplo\* \(Caixa\)/);
  assert.match(txt, /Faltas: 2 \(03\/11 justificada, 19\/11 sem justificativa\)/);
  assert.match(txt, /Atestados: 3 dias \(a partir de 28\/11, 5 dias\)/);
  assert.match(txt, /Folgas: 1 \(05\/11\)/);
  assert.match(txt, /Feriados trabalhados: 20\/11 Dia da Consciência Negra/);
  assert.match(txt, /Admitido em 11\/11\/2026/);
  assert.doesNotMatch(txt, /salário|R\$/i, "resumo não leva salário");
});
