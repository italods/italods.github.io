// Escala com duplas que trocam de turno e sábado por pessoa (rodízio de 4 semanas) + banco de horas pela escala.
// Mesma estrutura da escala real de nov/2026, com nomes INVENTADOS (Ana, Bia, Caio, Davi).
const test = require("node:test");
const assert = require("node:assert/strict");
const RH = require("../sistema/js/rh.js");
const RF = require("../sistema/js/rh-folha.js");

const dia = (entrada, saida, intervalo, almoco) => ({ entrada, saida, intervalo, almoco });
const manha = { id: "hm", nome: "Manhã", ordem: 0, dias: { 1: dia("07:00", "16:00", 60, "12:00"), 2: dia("07:00", "17:00", 120, "12:00"),
  3: dia("07:00", "17:00", 120, "12:00"), 4: dia("07:00", "17:00", 120, "12:00"), 5: dia("07:00", "17:00", 120, "12:00") } };
const tarde = { id: "ht", nome: "Tarde", ordem: 1, dias: { 1: dia("09:30", "18:30", 60, "13:00"), 2: dia("09:00", "19:00", 120, "12:00"),
  3: dia("09:00", "19:00", 120, "12:00"), 4: dia("09:00", "19:00", 120, "12:00"), 5: dia("09:00", "19:00", 120, "12:00") } };
const turmas = [{ id: "d1", nome: "Dupla 1", ordem: 0 }, { id: "d2", nome: "Dupla 2", ordem: 1 }];
const ana = { id: "a", nome: "Ana", turma: "d1" }, bia = { id: "b", nome: "Bia", turma: "d1" };
const caio = { id: "c", nome: "Caio", turma: "d2" }, davi = { id: "d", nome: "Davi", turma: "d2" };
// semana 0 = 16/11: abertura Caio, fechamento Davi e Bia, folga Ana (e assim por diante, como na escala)
const tabela = [["c", "d", "b", "a"], ["a", "c", "d", "b"], ["d", "a", "b", "c"], ["b", "a", "c", "d"]];
const escala = [];
tabela.forEach(([ab, f1, f2, fo], semana) => {
  escala.push({ semana, funcionario: ab, funcao: "abertura" }, { semana, funcionario: f1, funcao: "fechamento" },
    { semana, funcionario: f2, funcao: "fechamento" }, { semana, funcionario: fo, funcao: "folga" });
});
const ctx = {
  turmas, horarios: [manha, tarde], ref: "2026-11-09",   // na semana de 16/11 a Dupla 2 faz a manhã
  ocorrencias: [], feriados: [], ferias: [],
  sabado: { ref: "2026-11-16", horarios: { abertura: dia("07:00", "17:00", 120, "12:00"), fechamento: dia("08:30", "18:30", 120, "12:00") }, escala }
};

test("duplas trocam de turno e a segunda tem almoço em horários diferentes", () => {
  const c = RH.diaDoFuncionario(ctx, caio, "2026-11-16"), a = RH.diaDoFuncionario(ctx, ana, "2026-11-16");
  assert.equal(RH.textoDia(c), "07:00–16:00 (almoço 12:00–13:00)");
  assert.equal(RH.textoDia(a), "09:30–18:30 (almoço 13:00–14:00)", "a loja nunca fica sem ninguém no almoço da segunda");
  assert.equal(c.minutos, 480, "8h");
  assert.equal(RH.textoDia(RH.diaDoFuncionario(ctx, ana, "2026-11-17")), "09:00–19:00 (almoço 12:00–14:00)");
  assert.equal(RH.diaDoFuncionario(ctx, ana, "2026-11-23").entrada, "07:00", "semana seguinte a Dupla 1 faz a manhã");
  assert.equal(RH.diaDoFuncionario(ctx, caio, "2026-11-23").entrada, "09:30");
});

test("sábado por pessoa: 1 abre, 2 fecham, 1 folga, rodízio de 4 semanas", () => {
  const sab = (f, t) => RH.textoDia(RH.diaDoFuncionario(ctx, f, t));
  assert.equal(sab(caio, "2026-11-21"), "Abertura 07:00–17:00 (almoço 12:00–14:00)");
  assert.equal(sab(davi, "2026-11-21"), "Fechamento 08:30–18:30 (almoço 12:00–14:00)");
  assert.equal(sab(bia, "2026-11-21"), "Fechamento 08:30–18:30 (almoço 12:00–14:00)");
  assert.equal(sab(ana, "2026-11-21"), "Folga do sábado");
  // folga: Ana → Bia → Caio → Davi → (repete)
  assert.deepEqual(["2026-11-21", "2026-11-28", "2026-12-05", "2026-12-12", "2026-12-19"].map((t) =>
    [ana, bia, caio, davi].filter((f) => RH.diaDoFuncionario(ctx, f, t).funcaoSabado === "folga")[0].nome), ["Ana", "Bia", "Caio", "Davi", "Ana"]);
  assert.equal(RH.sabadoDoFuncionario(ctx, ana, "2026-11-20"), null, "só no sábado");
  assert.equal(RH.textoDia(RH.diaDoFuncionario(ctx, ana, "2026-11-22")), "Fechado", "domingo fechado");
});

test("banco de horas pela escala: +4h com sábado, −4h na folga, acumulado", () => {
  const w = RH.bancoDaEscala(ctx, ana, "2026-11-16", "2026-12-12");
  assert.deepEqual(w.map((x) => [x.segunda, x.minutos / 60, x.saldo / 60, x.acumulado / 60]),
    [["2026-11-16", 40, -4, -4], ["2026-11-23", 48, 4, 0], ["2026-11-30", 48, 4, 4], ["2026-12-07", 48, 4, 8]]);
  const c = RH.bancoDaEscala(ctx, caio, "2026-11-16", "2026-12-12").map((x) => x.saldo / 60);
  assert.deepEqual(c, [4, 4, -4, 4], "Caio folga na 3ª semana");
  // férias na semana: não conta
  const comFerias = Object.assign({}, ctx, { ferias: [{ funcionario: "a", inicio: "2026-11-23", dias: 7 }] });
  assert.deepEqual(RH.bancoDaEscala(comFerias, ana, "2026-11-16", "2026-11-28").map((x) => x.segunda), ["2026-11-16"]);
});

test("extrato do banco de horas inclui as semanas da escala já passadas", () => {
  const c2 = Object.assign({}, ctx, { banco: [], bancoEscalaInicio: "2026-11-16", hoje: "2026-11-30" });
  const ex = RF.extratoBanco(c2, ana).filter((x) => x.origem === "escala");
  assert.deepEqual(ex.map((x) => [x.data, x.minutos]), [["2026-11-21", -240], ["2026-11-28", 240]], "só as semanas cujo sábado já passou");
  assert.match(ex[0].motivo, /Escala da semana 16\/11 a 21\/11 \(40h\)/);
  assert.equal(RF.minutosPrevistos(c2, ana, "2026-11-21"), 0, "sábado de folga: nada previsto");
  assert.equal(RF.minutosPrevistos(c2, caio, "2026-11-21"), 480);
});
