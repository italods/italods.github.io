// Testes do RH completo: férias, banco de horas, custos e reserva, rescisão, avisos. Nomes, salários e dados INVENTADOS.
const test = require("node:test");
const assert = require("node:assert/strict");
const RH = require("../sistema/js/rh.js");
const RF = require("../sistema/js/rh-folha.js");

const bia = { id: "f1", nome: "Bia Inventada", funcao: "Caixa", admissao: "2025-03-10", salario_centavos: 162100, gratificacao_centavos: 20000,
  jornada_semanal_min: 2640, nascimento: "1990-11-22" };
const manha = { id: "hm", nome: "Manhã", ordem: 0, dias: { 1: { entrada: "07:00", saida: "13:00" }, 2: { entrada: "07:00", saida: "14:00", intervalo: 60 },
  3: { entrada: "07:00", saida: "13:00" }, 4: { entrada: "07:00", saida: "13:00" }, 5: { entrada: "07:00", saida: "13:00" }, 6: { entrada: "07:00", saida: "12:00" } } };
const turmas = [{ id: "t1", nome: "Turma 1", ordem: 0 }];

test("datas, CPF e encargos", () => {
  assert.equal(RF.somarMeses("2025-01-31", 1), "2025-02-28");
  assert.equal(RF.somarMeses("2024-02-29", 12), "2025-02-28");
  assert.equal(RF.somarMeses("2025-11-10", 3), "2026-02-10");
  assert.equal(RF.cpfValido("529.982.247-25"), true);
  assert.equal(RF.cpfValido("52998224724"), false);
  assert.equal(RF.cpfValido("111.111.111-11"), false);
  assert.equal(RF.formatarCPF("52998224725"), "529.982.247-25");
  assert.deepEqual(RF.lerEncargos(""), { regime: "simples", inss: 2780, multa: true, gratificacaoIntegra: true });
  assert.equal(RF.lerEncargos('{"regime":"normal","inss":2500,"multa":false}').inss, 2500);
  assert.equal(RF.lerEncargos("lixo").regime, "simples");
});

test("escala com intervalo do almoço", () => {
  assert.equal(RH.minutosDoDia({ entrada: "07:00", saida: "14:00", intervalo: 60 }), 360);
  assert.equal(RH.minutosDaSemana(manha), 6 * 360 - 60);
  const ctx = { turmas, horarios: [manha], ref: "2026-11-02", ocorrencias: [], feriados: [] };
  const d = RH.diaDoFuncionario(ctx, Object.assign({}, bia, { turma: "t1" }), "2026-11-10");
  assert.equal(d.minutos, 360);
  assert.equal(RH.textoDia(d), "07:00–14:00 (almoço 1h)");
});

test("férias e suspensão aparecem no dia e no resumo", () => {
  const f = Object.assign({}, bia, { turma: "t1" });
  const ctx = { turmas, horarios: [manha], ref: "2026-11-02", feriados: [],
    ocorrencias: [{ id: "s", funcionario: "f1", tipo: "suspensao", data: "2026-11-03", dias: 2 },
      { id: "a", funcionario: "f1", tipo: "advertencia", data: "2026-11-02", motivo: "atraso" }],
    ferias: [{ id: "v", funcionario: "f1", aquisitivo_inicio: "2025-03-10", inicio: "2026-11-16", dias: 10 }] };
  assert.equal(RH.diaDoFuncionario(ctx, f, "2026-11-04").tipo, "suspensao");
  assert.equal(RH.diaDoFuncionario(ctx, f, "2026-11-05").tipo, "trabalho");
  assert.equal(RH.diaDoFuncionario(ctx, f, "2026-11-16").tipo, "ferias");
  assert.equal(RH.diaDoFuncionario(ctx, f, "2026-11-25").tipo, "ferias");
  assert.equal(RH.diaDoFuncionario(ctx, f, "2026-11-26").tipo, "trabalho");
  const r = RH.resumoFuncionario(ctx, f, 2026, 11, []);
  assert.equal(r.diasFerias, 9, "10 dias corridos menos o domingo 22/11");
  assert.equal(r.diasSuspensao, 2);
  assert.equal(r.advertencias.length, 1);
  const txt = RH.textoResumo([r], 2026, 11);
  assert.match(txt, /Suspensão: 2 dias/);
  assert.match(txt, /Advertências: 02\/11/);
  const eq = RH.equipeDoDia(ctx, [f], "2026-11-17");
  assert.equal(eq.ferias.length, 1);
  const esc = RH.textoEscalaSemana(ctx, [f], "2026-11-16");
  assert.match(esc, /\*Segunda 16\/11\*\nBia: Férias/);
});

test("faltas sem justificativa reduzem as férias (art. 130)", () => {
  assert.deepEqual([0, 5, 6, 14, 15, 23, 24, 32, 33].map(RF.diasPorFaltas), [30, 30, 24, 24, 18, 18, 12, 12, 0]);
  const faltas = [];
  for (let i = 0; i < 6; i++) faltas.push({ id: "x" + i, funcionario: "f1", tipo: "falta", data: "2025-05-0" + (i + 1), justificada: false });
  faltas.push({ id: "j", funcionario: "f1", tipo: "falta", data: "2025-06-02", justificada: true });
  const aq = RF.periodosAquisitivos(bia, [], faltas, "2026-11-15")[0];
  assert.equal(aq.faltas, 6);
  assert.equal(aq.direito, 24);
});

test("períodos aquisitivos, saldo e situação", () => {
  const ferias = [{ id: "p1", funcionario: "f1", aquisitivo_inicio: "2025-03-10", inicio: "2026-04-06", dias: 20 }];
  let aqs = RF.periodosAquisitivos(bia, ferias, [], "2026-11-15");
  assert.equal(aqs.length, 2);
  assert.deepEqual([aqs[0].inicio, aqs[0].fim, aqs[0].concessivoFim], ["2025-03-10", "2026-03-09", "2027-03-09"]);
  assert.deepEqual([aqs[0].saldo, aqs[0].gozados, aqs[0].situacao, aqs[0].limiteInicio], [10, 20, "a_programar", "2027-02-28"]);
  assert.equal(aqs[1].situacao, "em_aquisicao");
  assert.equal(RF.periodosAquisitivos(bia, ferias, [], "2027-01-10")[0].situacao, "vencendo");
  assert.equal(RF.periodosAquisitivos(bia, ferias, [], "2027-03-01")[0].situacao, "vencida");
  const todas = ferias.concat([{ id: "p2", funcionario: "f1", aquisitivo_inicio: "2025-03-10", inicio: "2026-12-07", dias: 10 }]);
  aqs = RF.periodosAquisitivos(bia, todas, [], "2026-11-15");
  assert.deepEqual([aqs[0].saldo, aqs[0].programados, aqs[0].situacao], [0, 10, "ok"]);
  assert.equal(RF.avosFerias("2026-03-10", "2026-11-15"), 8);
  assert.equal(RF.avosFerias("2026-03-10", "2026-11-24"), 9, "15 dias ou mais contam um avo");
  assert.deepEqual(RF.valorFerias(182100, 30), { base: 182100, terco: 60700, total: 242800 });
});

test("conferir férias: CLT", () => {
  const base = { funcionarios: [bia, { id: "f2", nome: "Caio Teste", admissao: "2024-01-01" }], ocorrencias: [], feriados: [], hoje: "2026-11-15",
    ferias: [{ id: "c", funcionario: "f2", aquisitivo_inicio: "2025-01-01", inicio: "2027-01-04", dias: 30 }] };
  const ok = RF.conferirFerias({ funcionario: "f1", aquisitivo_inicio: "2025-03-10", inicio: "2027-01-05", dias: 30 }, base);
  assert.deepEqual(ok.erros, []);
  assert.equal(ok.pagarAte, "2027-01-03");
  assert.equal(ok.retorno, "2027-02-04");
  assert.ok(ok.avisos.some((a) => /Caio Teste também está de férias/.test(a)));
  const sexta = RF.conferirFerias({ funcionario: "f1", aquisitivo_inicio: "2025-03-10", inicio: "2026-12-18", dias: 30 }, base);
  assert.ok(sexta.avisos.some((a) => /2 dias antes de domingo/.test(a)));
  const vespera = RF.conferirFerias({ funcionario: "f1", aquisitivo_inicio: "2025-03-10", inicio: "2026-12-23", dias: 20 }, base);
  assert.ok(vespera.avisos.some((a) => /feriado/.test(a)), "23/12 é 2 dias antes do Natal");
  const cedo = RF.conferirFerias({ funcionario: "f1", aquisitivo_inicio: "2026-03-10", inicio: "2026-12-01", dias: 30 }, base);
  assert.ok(cedo.erros.some((e) => /depois de completar/.test(e)));
  const curto = RF.conferirFerias({ funcionario: "f1", aquisitivo_inicio: "2025-03-10", inicio: "2026-12-01", dias: 27 }, base);
  assert.ok(curto.erros.some((e) => /Sobrariam 3 dias/.test(e)));
  const dez = { ...base, ferias: base.ferias.concat([{ id: "d", funcionario: "f1", aquisitivo_inicio: "2025-03-10", inicio: "2026-08-03", dias: 10 }]) };
  const dividido = RF.conferirFerias({ funcionario: "f1", aquisitivo_inicio: "2025-03-10", inicio: "2026-12-01", dias: 10 }, dez);
  assert.ok(dividido.erros.some((e) => /14 dias ou mais/.test(e)));
  assert.deepEqual(RF.conferirFerias({ funcionario: "f1", aquisitivo_inicio: "2025-03-10", inicio: "2026-12-01", dias: 20 }, dez).erros, []);
  const tarde = RF.conferirFerias({ funcionario: "f1", aquisitivo_inicio: "2025-03-10", inicio: "2027-03-01", dias: 30 }, base);
  assert.ok(tarde.avisos.some((a) => /21 dias são pagos em dobro/.test(a)));
  const cruza = RF.conferirFerias({ funcionario: "f1", aquisitivo_inicio: "2025-03-10", inicio: "2026-08-10", dias: 10 }, dez);
  assert.ok(cruza.erros.some((e) => /Cruza/.test(e)));
});

test("banco de horas: lançamentos, folga do banco, feriado, vencimento em 6 meses", () => {
  const f = Object.assign({}, bia, { turma: "t1" });
  const ctx = { turmas, horarios: [manha], ref: "2026-11-02", feriados: [],
    banco: [{ id: "b1", funcionario: "f1", data: "2026-03-02", minutos: 120, motivo: "inventário" },
      { id: "b2", funcionario: "f1", data: "2026-10-05", minutos: 90 },
      { id: "b3", funcionario: "f1", data: "2026-10-06", minutos: -30, motivo: "saiu mais cedo" }],
    ocorrencias: [{ id: "o1", funcionario: "f1", tipo: "folga", data: "2026-11-03", banco: true },
      { id: "o2", funcionario: "f1", tipo: "feriado_trabalhado", data: "2026-11-02", banco: true },
      { id: "o3", funcionario: "f1", tipo: "folga", data: "2026-11-05", banco: false }] };
  const ex = RF.extratoBanco(ctx, f);
  assert.deepEqual(ex.map((x) => [x.data, x.minutos, x.origem]), [["2026-03-02", 120, "manual"], ["2026-10-05", 90, "manual"],
    ["2026-10-06", -30, "manual"], ["2026-11-02", 360, "feriado"], ["2026-11-03", -360, "folga"]]);
  const s = RF.saldoBanco(ctx, f, "2026-11-15");
  assert.equal(s.saldo, 180);
  assert.deepEqual(s.abertos.map((a) => [a.data, a.minutos]), [["2026-11-02", 180]], "os créditos mais antigos são usados primeiro");
  assert.equal(s.vencidas, 0);
  assert.equal(s.valorHora, Math.round(182100 / 220));
  const s2 = RF.saldoBanco({ ...ctx, ocorrencias: [] }, f, "2026-09-10");
  assert.equal(s2.vencidas, 120, "crédito de março venceu em setembro");
  assert.equal(RF.minutosPrevistos({ turmas: [], horarios: [], ref: "" }, { jornada_semanal_min: 2640 }, "2026-11-03"), 440, "sem escala: 44h / 6");
});

test("custo mensal e reserva (Simples: só FGTS)", () => {
  const c = RF.custoMensal(bia, RF.lerEncargos(""));
  assert.equal(c.remuneracao, 182100);
  assert.equal(c.fgts, 14568);
  assert.equal(c.decimo, 15175);
  assert.equal(c.ferias, 15175 + 5058);
  assert.equal(c.fgtsReserva, 2833);
  assert.equal(c.multa, 6960);
  assert.equal(c.inss, 0);
  assert.equal(c.guardar, 15175 + 20233 + 2833 + 6960);
  assert.equal(c.pagar, 182100 + 14568);
  assert.equal(c.total, c.pagar + c.guardar);
  const n = RF.custoMensal(bia, RF.lerEncargos('{"regime":"normal"}'));
  assert.equal(n.inss, Math.round(182100 * 0.278));
  const semGrat = RF.custoMensal(bia, RF.lerEncargos('{"gratificacaoIntegra":false}'));
  assert.equal(semGrat.fgts, Math.round(162100 * 0.08));
  assert.equal(semGrat.pagar, 182100 + Math.round(162100 * 0.08), "a gratificação é paga mesmo sem entrar na base");
});

test("13º: avos e plano dos meses", () => {
  assert.equal(RF.avos13({ admissao: "2026-03-10" }, 2026), 10);
  assert.equal(RF.avos13({ admissao: "2026-03-20" }, 2026), 9);
  assert.equal(RF.avos13({ admissao: "2025-01-01", desligamento: "2026-06-14" }, 2026), 5);
  const plano = RF.planoMeses({ funcionarios: [bia], ferias: [{ id: "p", funcionario: "f1", aquisitivo_inicio: "2025-03-10", inicio: "2027-01-05", dias: 30 }],
    ocorrencias: [], cfg: RF.lerEncargos(""), hoje: "2026-11-15" }, 3);
  assert.deepEqual(plano.map((m) => m.mes), ["2026-11", "2026-12", "2027-01"]);
  assert.equal(plano[0].decimo1, 91050);
  assert.equal(plano[1].decimo2, 91050);
  assert.equal(plano[1].fgtsDecimo, 14568);
  assert.deepEqual(plano[2].ferias.map((x) => x.pagarAte), ["2027-01-03"], "férias de 05/01 se pagam até 03/01");
  const jan = RF.planoMeses({ funcionarios: [bia], ferias: [{ id: "p", funcionario: "f1", aquisitivo_inicio: "2025-03-10", inicio: "2027-02-01", dias: 30 }],
    ocorrencias: [], cfg: RF.lerEncargos(""), hoje: "2027-01-10" }, 1)[0];
  assert.equal(jan.ferias[0].pagarAte, "2027-01-30");
  assert.equal(jan.feriasTotal, 242800 + 19424, "férias + 1/3 + FGTS");
  assert.equal(jan.pagar, 182100 + 14568 + 242800 + 19424);
});

test("reserva que já deveria estar guardada", () => {
  const r = RF.reservaHoje({ funcionarios: [bia], ferias: [], ocorrencias: [], cfg: RF.lerEncargos(""), hoje: "2026-11-15" });
  assert.equal(r.decimo, Math.round(182100 * 10 / 12), "13º até outubro");
  // férias: 30 dias vencidos + 8/12 do período que corre (20 dias)
  assert.equal(r.ferias, 242800 + RF.valorFerias(182100, 20).total);
  assert.equal(r.encargos, Math.round((r.decimo + r.ferias) * 0.08));
  const dez = RF.reservaHoje({ funcionarios: [bia], ferias: [], ocorrencias: [], cfg: RF.lerEncargos(""), hoje: "2026-12-10" });
  assert.equal(dez.decimo, Math.round(182100 * 11 / 12) - 91050, "a 1ª parcela já foi paga");
});

test("rescisão sem justa causa com aviso indenizado", () => {
  const r = RF.rescisao(bia, { saida: "2026-11-30", tipo: "sem_justa_causa", aviso: "indenizado" }, { ferias: [], ocorrencias: [] });
  assert.equal(r.diasAviso, 33);
  assert.equal(r.projecao, "2027-01-02");
  assert.equal(r.pagarAte, "2026-12-10");
  const v = (rot) => r.itens.filter((x) => x.rotulo.indexOf(rot) === 0).map((x) => x.valor);
  assert.deepEqual(v("Saldo de salário"), [182100]);
  assert.deepEqual(v("Aviso prévio"), [200310]);
  assert.deepEqual(v("13º proporcional"), [182100], "2026 inteiro (o aviso projeta dezembro); 2027 sem avo não aparece");
  assert.deepEqual(v("1ª parcela"), [-91050]);
  assert.deepEqual(v("Férias vencidas"), [242800]);
  assert.deepEqual(v("Férias proporcionais"), [RF.valorFerias(182100, 25).total], "10/12 de 30 dias");
  assert.equal(r.total, r.itens.reduce((s, x) => s + x.valor, 0));
  assert.equal(r.pctMulta, 4000);
  assert.equal(r.fgtsEstimado, true);
  const informado = RF.rescisao(bia, { saida: "2026-11-30", tipo: "sem_justa_causa", aviso: "indenizado", fgtsSaldo: 300000 }, {});
  assert.equal(informado.multa, Math.round((300000 + informado.fgtsMes) * 0.4));
});

test("rescisão: pedido, justa causa e acordo", () => {
  const ped = RF.rescisao(bia, { saida: "2026-11-20", tipo: "pedido", aviso: "nao_cumprido" }, {});
  assert.equal(ped.multa, 0);
  assert.ok(ped.itens.some((x) => /Desconto do aviso/.test(x.rotulo) && x.valor === -182100));
  assert.ok(!ped.itens.some((x) => /1ª parcela/.test(x.rotulo)), "saiu antes de 30/11: não recebeu a 1ª parcela");
  assert.equal(ped.itens.filter((x) => x.rotulo === "Saldo de salário")[0].valor, Math.round(182100 * 20 / 30));
  const jc = RF.rescisao(bia, { saida: "2026-11-20", tipo: "justa_causa" }, {});
  assert.deepEqual(jc.itens.map((x) => x.rotulo), ["Saldo de salário", "Férias vencidas + 1/3"]);
  assert.equal(jc.multa, 0);
  const ac = RF.rescisao(bia, { saida: "2026-11-20", tipo: "acordo", aviso: "indenizado", fgtsSaldo: 100000 }, {});
  assert.equal(ac.itens.filter((x) => /Aviso/.test(x.rotulo))[0].valor, Math.round(182100 * 16 / 30), "metade de 33 dias");
  assert.equal(ac.pctMulta, 2000);
  const novo = RF.rescisao({ id: "n", admissao: "2026-11-03", salario_centavos: 150000 }, { saida: "2026-11-20", tipo: "sem_justa_causa", aviso: "trabalhado" }, {});
  assert.equal(novo.itens[0].valor, Math.round(150000 * 18 / 30), "saldo desde a admissão no mesmo mês");
  assert.equal(RF.diasAvisoPrevio("2010-01-01", "2026-11-20"), 78);
  assert.equal(RF.diasAvisoPrevio("2000-01-01", "2026-11-20"), 90);
});

test("advertência e suspensão para imprimir", () => {
  const emp = { nome: "Supermercado Exemplo", cnpj: "00.000.000/0001-00", cidade: "Cidade - UF" };
  const f = Object.assign({}, bia, { cpf: "52998224725" });
  const adv = RF.textoMedida(emp, f, { tipo: "advertencia", data: "2026-11-03", motivo: "Chegou atrasado três vezes." });
  assert.match(adv, /^\*ADVERTÊNCIA DISCIPLINAR\*/);
  assert.match(adv, /Cidade - UF, 3 de novembro de 2026/);
  assert.match(adv, /CPF 529\.982\.247-25/);
  assert.match(adv, /Chegou atrasado três vezes\./);
  const sus = RF.textoMedida(emp, f, { tipo: "suspensao", data: "2026-11-04", dias: 2, motivo: "x" });
  assert.match(sus, /suspenso\(a\) por 2 dias, de 04\/11\/2026 a 05\/11\/2026/);
  assert.match(sus, /retornar ao trabalho em 06\/11\/2026/);
});

test("aniversariantes, exames e avisos", () => {
  const caio = { id: "f2", nome: "Caio Teste", admissao: "2026-01-05", nascimento: "2000-11-15", salario_centavos: 162100 };
  assert.deepEqual(RF.aniversariantes([bia, caio], 11, "2026-11-15").map((a) => [a.nome, a.dia, a.hoje]), [["Caio Teste", 15, true], ["Bia Inventada", 22, false]]);
  const ex = RF.situacaoExames([bia, caio], [{ funcionario: "f1", tipo: "admissional", data: "2024-11-20" }], "2026-11-15");
  assert.deepEqual(ex.map((x) => [x.situacao, x.vence]), [["vencendo", "2026-11-20"], ["sem", null]]);
  const av = RF.avisos({ funcionarios: [bia, caio], ferias: [], ocorrencias: [], banco: [], hoje: "2026-11-15",
    exames: [{ funcionario: "f1", tipo: "admissional", data: "2024-11-20" }], treinamentos: [], turmas: [], horarios: [], feriados: [] });
  const titulos = av.map((a) => a.titulo);
  assert.ok(titulos.includes("Exame de Bia vence logo"));
  assert.ok(titulos.includes("Exame não registrado"));
  assert.ok(titulos.includes("1ª parcela do 13º até 30/11"));
  const p13 = av.filter((a) => /13º/.test(a.titulo))[0];
  assert.match(p13.detalhe, /R\$ 1\.721,00/, "Bia 91.050 + Caio (12 avos) 81.050");
  const venc = RF.avisos({ funcionarios: [bia], ferias: [], ocorrencias: [], hoje: "2027-03-05" });
  assert.ok(venc.some((a) => a.nivel === "erro" && /Férias vencidas/.test(a.titulo)));
  const desl = RF.avisos({ funcionarios: [Object.assign({}, bia, { desligamento: "2026-11-10", desligamento_passos: { contador: true } })], hoje: "2026-11-15" });
  assert.ok(desl.some((a) => /7 passos pendentes/.test(a.detalhe) && /20\/11\/2026/.test(a.detalhe)));
});

test("CSV", () => {
  const csv = RF.csvFuncionarios([Object.assign({}, bia, { cpf: "52998224725", observacao: 'tem "apelido"; ok' })], []);
  assert.ok(csv.startsWith("﻿Nome;Função"));
  assert.match(csv, /Bia Inventada;Caixa;;10\/03\/2025/);
  assert.match(csv, /1621,00;200,00;44;"tem ""apelido""; ok"/);
  const b = RF.csvBanco({ banco: [{ funcionario: "f1", data: "2026-11-02", minutos: -90 }], ocorrencias: [] }, [bia]);
  assert.match(b, /02\/11\/2026;Bia Inventada;-1h30;-90;/);
});

test("aviso de férias, ficha de EPI e leitura de horas", () => {
  const emp = { nome: "Supermercado Exemplo", cidade: "Cidade - UF" };
  const av = RF.textoAvisoFerias(emp, bia, { inicio: "2027-01-05", dias: 30, aquisitivo_inicio: "2025-03-10" }, "2026-11-15");
  assert.match(av, /período aquisitivo de 10\/03\/2025 a 09\/03\/2026, serão de 30 dias, de 05\/01\/2027 a 03\/02\/2027, com retorno ao trabalho em 04\/02\/2027/);
  assert.match(av, /até 03\/01\/2027/);
  const epi = RF.textoFichaEPI(emp, bia, [{ funcionario: "f1", data: "2025-03-10", item: "Bota de borracha", quantidade: 1, ca: "123" },
    { funcionario: "f2", data: "2025-03-10", item: "Luva" }]);
  assert.match(epi, /10\/03\/2025 — 1 × Bota de borracha \(CA 123\)/);
  assert.doesNotMatch(epi, /Luva/);
  assert.deepEqual(["1:30", "1h30", "2h", "2", "1,5", "0:45", "1:75", "abc", ""].map(RF.lerHoras), [90, 90, 120, 120, 90, 45, null, null, null]);
});
