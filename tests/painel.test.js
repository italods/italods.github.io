// Testes da Visão geral (indicadores e "O que precisa de atenção"). Dados INVENTADOS.
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../sistema/js/painel.js");
const RH = require("../sistema/js/rh.js");

const CAIXAS = [{ id: "caixa1", curto: "Caixa 1" }, { id: "caixa2", curto: "Caixa 2" }];
const HOJE = "2027-01-15";
const c = (id, tipo, caixa, data, hora, extra) => Object.assign({ id, tipo, caixa, data, hora }, extra || {});
const confs = [
  c("a", "abertura", "caixa1", HOJE, "07:00"),                                            // aberto hoje
  c("b", "abertura", "caixa2", "2027-01-14", "07:00"),
  c("d", "fechamento", "caixa2", "2027-01-14", "19:00", { diferenca_centavos: -1240, cupom: { formas: {} }, operador: "FULANO" }),
  c("e", "abertura", "caixa1", "2027-01-14", "07:00"),                                    // ficou aberto ontem
  c("f", "fechamento", "caixa1", "2027-01-13", "19:00", { pendente: true, diferenca_centavos: null }),
  c("g", "fechamento", "caixa2", "2027-01-13", "19:00", { diferenca_centavos: 300, cupom: { formas: {} } }),
  c("h", "fechamento", "caixa2", "2027-01-05", "19:00", { diferenca_centavos: 5000, cupom: { formas: {} } }) // antigo: fora dos 3 dias
];

test("diferença do dinheiro por dia", () => {
  const d = P.diferencasPorDia(confs, "2027-01-13", HOJE);
  assert.deepEqual(d.map((x) => x.diferenca), [300, -1240, null]);
  assert.equal(d[0].pendentes, 1);
  assert.equal(P.diasEntre("2027-01-30", "2027-02-02").length, 4);
});

test("indicadores do dia", () => {
  const equipe = { trabalhando: [{}, {}, {}], faltas: [{}], atestados: [], folgas: [] };
  const i = P.indicadores({ hoje: HOJE, caixas: CAIXAS, conferencias: confs, escutaNovas: 2, equipe });
  assert.deepEqual(i.caixas, { total: 2, fechados: 0, abertos: 1 });
  assert.equal(i.ultimoDia.data, "2027-01-14");
  assert.equal(i.ultimoDia.diferenca, -1240);
  assert.equal(i.escutaNovas, 2);
  assert.deepEqual(i.equipe, { naEscala: 3, ausentes: 1, folgas: 0 });
  assert.equal(P.indicadores({ hoje: HOJE, caixas: CAIXAS, conferencias: [] }).ultimoDia, null, "sem dados: nada inventado");
});

test("o que precisa de atenção", () => {
  const quadro = { temCielo: true, dia: { debito: 0, credito: 0, pix: 1577 }, pixDelivery: { diferenca: -483 } };
  const a = P.atencao({
    hoje: HOJE, caixas: CAIXAS, conferencias: confs,
    cielo: { "2027-01-14": 30 }, banco: {},
    quadros: [{ data: "2027-01-14", quadro }], escutaNovas: 3,
    equipe: { trabalhando: [], faltas: [{ nome: "Ana Exemplo" }], atestados: [{ nome: "Beto Teste" }], folgas: [] },
    holerites: { rotulo: "dezembro", faltando: ["Ana Exemplo", "Beto Teste"] }
  });
  const t = a.map((x) => x.titulo.replace(/\s/g, " "));
  assert.equal(a[0].nivel, "erro", "falta de dinheiro vem primeiro");
  assert.equal(t[0], "Caixa 2 fechou com falta de R$ 12,40");
  assert.ok(t.includes("Caixa 1 aberto desde 07:00"));
  assert.ok(t.includes("Caixa 1 ficou aberto em 14/01"));
  assert.ok(t.includes("1 fechamento sem o cupom do Diamante"));
  assert.ok(t.includes("Caixa 2 fechou com sobra de R$ 3,00"));
  assert.ok(!t.some((x) => x.includes("R$ 50,00")), "diferença antiga (mais de 3 dias) não aparece");
  const cielo = a.find((x) => x.titulo === "Vendas da Cielo não importadas");
  assert.ok(cielo && cielo.detalhe.includes("13/01") && !cielo.detalhe.includes("14/01"), "só o dia sem Cielo (13/01)");
  assert.ok(t.includes("Extrato do Banco do Brasil não importado"));
  const pix = a.find((x) => x.titulo === "Cartões e PIX de 14/01 com diferença");
  assert.match(pix.detalhe, /PIX maquininha: Cielo R\$\s15,77 a mais; PIX Delivery: BB R\$\s4,83 a menos/);
  assert.equal(pix.data, "2027-01-14");
  assert.ok(t.includes("3 mensagens novas no Veneza Escuta"));
  assert.ok(t.includes("1 falta hoje"));
  assert.ok(t.includes("Atestado hoje"));
  assert.ok(t.includes("Holerite de dezembro não registrado"));
  // nada para mostrar
  assert.deepEqual(P.atencao({ hoje: HOJE, caixas: CAIXAS, conferencias: [] }), []);
});

test("equipe do dia (RH)", () => {
  const ctx = { turmas: [{ id: "t1", ordem: 0 }], horarios: [{ id: "h", ordem: 0, dias: { 5: { entrada: "07:00", saida: "13:00" } } }],
    ref: "2027-01-11", ocorrencias: [{ id: "o", funcionario: "f2", tipo: "falta", data: HOJE }], feriados: [] };
  const fs = [{ id: "f1", nome: "Ana", turma: "t1" }, { id: "f2", nome: "Beto", turma: "t1" }, { id: "f3", nome: "Caio" }];
  const e = RH.equipeDoDia(ctx, fs, HOJE);
  assert.deepEqual(e.trabalhando.map((x) => x.nome), ["Ana"]);
  assert.deepEqual(e.faltas.map((x) => x.nome), ["Beto"]);
  assert.deepEqual(e.semEscala.map((x) => x.nome), ["Caio"]);
});
