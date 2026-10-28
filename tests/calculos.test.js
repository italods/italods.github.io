// Testes dos cálculos do sistema. Rodar com: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../sistema/js/calculos.js");
const F = require("../sistema/js/formatos.js");

// Números reais de 23/10/2026
const contagemCaixa1 = { 200: 25, 500: 5, 2000: 8, 5000: 9, 10000: 6, 5: 1, 10: 24, 25: 37, 50: 4, 100: 1 };
// Caixa 2 só tem o total (R$ 2.082,30); esta divisão chega no mesmo total
const contagemCaixa2 = { 10000: 20, 5000: 1, 2000: 1, 1000: 1, 200: 1, 25: 1, 5: 1 };

test("contagem do Caixa 1 em 23/10/2026", () => {
  const c = C.calcularContagem(contagemCaixa1);
  assert.equal(c.totalCedulas, 128500);
  assert.equal(c.totalMoedas, 1470);
  assert.equal(c.total, 129970);
});

test("fechamento do Caixa 1: esperado R$ 1.354,08 e falta R$ 54,38", () => {
  const f = C.calcularFechamento({
    contagem: contagemCaixa1, fundo: 30000, vendas: C.reaisParaCentavos("1.037,08"),
    recebimentos: C.reaisParaCentavos("17,00"), suprimentos: 0, sangrias: 0
  });
  assert.equal(f.contado, 129970);
  assert.equal(f.esperado, 135408);
  assert.equal(f.diferenca, -5438);
  assert.equal(f.situacao, "falta");
  assert.equal(C.formatarBRL(Math.abs(f.diferenca)), "R$ 54,38");
});

test("fechamento do Caixa 2: esperado R$ 1.218,38 e sobra R$ 863,92", () => {
  assert.equal(C.calcularContagem(contagemCaixa2).total, 208230);
  const f = C.calcularFechamento({
    contagem: contagemCaixa2, fundo: 30000, vendas: C.reaisParaCentavos("618,38"),
    recebimentos: C.reaisParaCentavos("300,00")
  });
  assert.equal(f.esperado, 121838);
  assert.equal(f.diferenca, 86392);
  assert.equal(f.situacao, "sobra");
  assert.equal(C.formatarBRL(f.diferenca), "R$ 863,92");
});

test("sangrias e suprimentos entram no esperado", () => {
  const movs = [
    { data: "2026-10-23", caixa: "caixa1", tipo: "sangria", valor_centavos: 50000 },
    { data: "2026-10-23", caixa: "caixa1", tipo: "suprimento", valor_centavos: 2000 },
    { data: "2026-10-23", caixa: "caixa2", tipo: "sangria", valor_centavos: 99900 },
    { data: "2026-10-22", caixa: "caixa1", tipo: "sangria", valor_centavos: 12300 }
  ];
  const m = C.somarMovimentos(movs, "2026-10-23", "caixa1");
  assert.deepEqual(m, { sangrias: 50000, suprimentos: 2000 });
  assert.equal(C.calcularEsperado({ fundo: 30000, vendas: 100000, recebimentos: 0, ...m }), 82000);
});

test("caixa bateu quando a diferença é zero", () => {
  assert.equal(C.classificarDiferenca(0), "bateu");
  assert.equal(F.linhaDiferenca(0), "Caixa bateu");
});

test("fundo vem da última abertura do mesmo caixa e dia, senão R$ 300,00", () => {
  const confs = [
    { tipo: "abertura", data: "2026-10-23", caixa: "caixa1", hora: "07:00", total_centavos: 25000 },
    { tipo: "abertura", data: "2026-10-23", caixa: "caixa1", hora: "07:30", total_centavos: 31000 },
    { tipo: "abertura", data: "2026-10-23", caixa: "caixa2", hora: "07:00", total_centavos: 45000 }
  ];
  assert.equal(C.fundoDoDia(confs, "2026-10-23", "caixa1"), 31000);
  assert.equal(C.fundoDoDia(confs, "2026-10-24", "caixa1"), 30000);
});

test("cofre = contado − troco de amanhã", () => {
  assert.equal(C.calcularCofre(129970, 30000), 99970);
});

test("leitura de valores digitados", () => {
  assert.equal(C.reaisParaCentavos("1.037,08"), 103708);
  assert.equal(C.reaisParaCentavos("1037,08"), 103708);
  assert.equal(C.reaisParaCentavos("1037.08"), 103708);
  assert.equal(C.reaisParaCentavos("R$ 17"), 1700);
  assert.equal(C.reaisParaCentavos("17,5"), 1750);
  assert.equal(C.reaisParaCentavos("1.000"), 100000);
  assert.equal(C.reaisParaCentavos("0,10"), 10);
  assert.equal(C.reaisParaCentavos(""), null);
  assert.equal(C.reaisParaCentavos("abc"), null);
  assert.equal(C.reaisParaCentavos("-5"), null);
  assert.equal(C.reaisParaCentavos("1,234"), null);
  // 0,1 + 0,2 em float daria 0,30000000000000004; em centavos é exato
  assert.equal(C.reaisParaCentavos("0,1") + C.reaisParaCentavos("0,2"), 30);
});

test("quantidades inválidas viram zero", () => {
  assert.equal(C.calcularContagem({ 200: -3, 500: "abc", 1000: "2" }).total, 2000);
});

test("texto do WhatsApp no formato combinado", () => {
  const r = {
    tipo: "fechamento", caixa: "caixa1", operador: "Italo", data: "2026-10-23", hora: "19:18:00",
    contagem: contagemCaixa1, esperado_centavos: 135408, diferenca_centavos: -5438
  };
  const txt = F.textoConferencia(r, () => "Caixa 1");
  assert.equal(txt, [
    "*Conferência de caixa — Supermercado Veneza*",
    "23/10/2026 às 19:18 · Fechamento · Caixa 1 · Italo",
    "",
    "*Cédulas*",
    "R$ 2: 25 = R$ 50,00",
    "R$ 5: 5 = R$ 25,00",
    "R$ 20: 8 = R$ 160,00",
    "R$ 50: 9 = R$ 450,00",
    "R$ 100: 6 = R$ 600,00",
    "Subtotal: R$ 1.285,00",
    "",
    "*Moedas*",
    "R$ 0,05: 1 = R$ 0,05",
    "R$ 0,10: 24 = R$ 2,40",
    "R$ 0,25: 37 = R$ 9,25",
    "R$ 0,50: 4 = R$ 2,00",
    "R$ 1,00: 1 = R$ 1,00",
    "Subtotal: R$ 14,70",
    "",
    "*Total contado: R$ 1.299,70*",
    "Esperado: R$ 1.354,08 · Falta: R$ 54,38"
  ].join("\n"));
});

test("CSV com BOM, ponto e vírgula e aspas quando precisa", () => {
  assert.equal(F.campoCSV('tem "aspas"; e ponto e vírgula'), '"tem ""aspas""; e ponto e vírgula"');
  assert.equal(F.numeroCSV(-5438), "-54,38");
  assert.equal(F.numeroCSV(5), "0,05");
  const csv = F.csvConferencias([{
    tipo: "fechamento", caixa: "caixa1", operador: "Italo", data: "2026-10-23", hora: "19:18",
    contagem: contagemCaixa1, fundo_centavos: 30000, vendas_dinheiro_centavos: 103708,
    recebimentos_dinheiro_centavos: 1700, suprimentos_centavos: 0, sangrias_centavos: 0,
    esperado_centavos: 135408, diferenca_centavos: -5438, observacao: "linha 1\nlinha 2"
  }]);
  assert.ok(csv.startsWith("﻿Data;Hora;Tipo;Caixa;Operador;"));
  assert.ok(csv.includes(";1299,70;"));
  assert.ok(csv.includes(";-54,38;Falta;"));
  assert.ok(csv.includes('"linha 1\nlinha 2"'));
});

test("resumo mensal por caixa e por operador", () => {
  const confs = [
    { tipo: "fechamento", data: "2026-10-23", caixa: "caixa1", operador: "Italo", diferenca_centavos: -5438, vendas_dinheiro_centavos: 103708 },
    { tipo: "fechamento", data: "2026-10-23", caixa: "caixa2", operador: "Cida", diferenca_centavos: 86392, vendas_dinheiro_centavos: 61838 },
    { tipo: "fechamento", data: "2026-10-24", caixa: "caixa1", operador: "Italo", diferenca_centavos: 1000, vendas_dinheiro_centavos: 50000 },
    { tipo: "abertura", data: "2026-10-24", caixa: "caixa1", operador: "Italo", total_centavos: 30000 }
  ];
  const movs = [{ data: "2026-10-24", caixa: "caixa1", tipo: "sangria", valor_centavos: 20000 }];
  const r = C.resumoMensal(confs, movs);
  const c1 = r.porCaixa.find((g) => g.nome === "caixa1");
  assert.deepEqual(c1, { nome: "caixa1", fechamentos: 2, sobras: 1000, faltas: 5438, saldo: -4438, maiorFalta: 5438, maiorSobra: 1000 });
  assert.equal(r.porOperador.find((g) => g.nome === "Cida").saldo, 86392);
  assert.equal(r.totais.vendasDinheiro, 215546);
  assert.equal(r.totais.sangrias, 20000);
  assert.equal(r.porDia.length, 2);
  assert.equal(r.porDia[0].diferenca, 80954);
  const csv = F.csvRelatorio(r, ["caixa1", "caixa2"]);
  assert.ok(csv.includes("23/10/2026;-54,38;863,92;809,54;1655,46;0,00;0,00"));
});
