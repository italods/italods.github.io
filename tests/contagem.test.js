// Testes da tela inicial do Caixa (situação, regras de abertura, falta o cupom) e do cupom importado depois.
// Dados INVENTADOS. Rodar com: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../sistema/js/calculos.js");
const F = require("../sistema/js/formatos.js");
const D = require("../sistema/js/diamante.js");

const CAIXAS = [{ id: "caixa1", curto: "Caixa 1", terminal: "1" }, { id: "caixa2", curto: "Caixa 2", terminal: "3" }];
const reg = (id, tipo, caixa, hora, extra) => Object.assign({ id, tipo, caixa, data: "2027-01-15", hora }, extra || {});

test("situação do caixa no dia pela ordem das contagens", () => {
  const confs = [
    reg("a", "abertura", "caixa1", "07:00:00"),
    reg("b", "fechamento", "caixa1", "12:00:00", { pendente: true }),
    reg("c", "abertura", "caixa1", "13:00:00"),
    reg("d", "abertura", "caixa2", "07:30:00"),
    reg("e", "fechamento", "caixa2", "19:00:00"),
    Object.assign(reg("f", "abertura", "caixa2", "20:00:00"), { data: "2027-01-14" })
  ];
  const s1 = C.situacaoDoCaixa(confs, "caixa1", "2027-01-15");
  assert.equal(s1.estado, "aberto");
  assert.equal(s1.ultima.id, "c");
  assert.equal(s1.pendentes, 1);
  assert.deepEqual(s1.registros.map((r) => r.id), ["a", "b", "c"]);
  const s2 = C.situacaoDoCaixa(confs, "caixa2", "2027-01-15");
  assert.equal(s2.estado, "fechado", "o dia anterior não conta");
  assert.equal(C.situacaoDoCaixa(confs, "caixa9", "2027-01-15").estado, "sem_registro");
  // mesma hora: vale a ordem em que foram criadas
  const empate = [reg("x", "fechamento", "caixa1", "10:00", { criado_em: "2027-01-15T13:00:02Z" }),
    reg("y", "abertura", "caixa1", "10:00", { criado_em: "2027-01-15T13:00:01Z" })];
  assert.equal(C.situacaoDoCaixa(empate, "caixa1", "2027-01-15").estado, "fechado");
});

test("caixa aberto não abre de novo; fechar sem abertura só avisa", () => {
  const aberto = C.situacaoDoCaixa([reg("a", "abertura", "caixa1", "07:00:00")], "caixa1", "2027-01-15");
  const r = C.podeRegistrar(aberto, "abertura");
  assert.equal(r.ok, false);
  assert.match(r.motivo, /já está aberto \(abertura das 07:00\)/);
  assert.deepEqual(C.podeRegistrar(aberto, "fechamento"), { ok: true });
  const vazio = C.situacaoDoCaixa([], "caixa1", "2027-01-15");
  assert.deepEqual(C.podeRegistrar(vazio, "abertura"), { ok: true });
  const f = C.podeRegistrar(vazio, "fechamento");
  assert.equal(f.ok, true);
  assert.match(f.aviso, /Não há abertura/);
  const fechado = C.situacaoDoCaixa([reg("a", "abertura", "caixa1", "07:00"), reg("b", "fechamento", "caixa1", "19:00", { pendente: true })],
    "caixa1", "2027-01-15");
  assert.deepEqual(C.podeRegistrar(fechado, "abertura"), { ok: true }, "falta o cupom já conta como fechado");
  assert.match(C.podeRegistrar(fechado, "fechamento").aviso, /já foi fechado às 19:00/);
});

test("abertura antes do fechamento (para comparar com o fundo do cupom)", () => {
  const confs = [reg("a", "abertura", "caixa1", "07:00:00", { total_centavos: 38000 }),
    reg("b", "fechamento", "caixa1", "12:00:00"), reg("c", "abertura", "caixa1", "13:00:00", { total_centavos: 20000 }),
    reg("d", "abertura", "caixa2", "07:00:00")];
  assert.equal(C.aberturaAntes(confs, { id: "z", caixa: "caixa1", data: "2027-01-15", hora: "19:00" }).id, "c");
  assert.equal(C.aberturaAntes(confs, { id: "b", caixa: "caixa1", data: "2027-01-15", hora: "12:00:00" }).id, "a");
  assert.equal(C.aberturaAntes(confs, { id: "z", caixa: "caixa1", data: "2027-01-16", hora: "19:00" }), null);
});

test("falta o cupom: fora do resumo do mês, texto e CSV sem diferença", () => {
  const confs = [reg("a", "fechamento", "caixa1", "19:00", { diferenca_centavos: -500 }),
    reg("b", "fechamento", "caixa2", "19:00", { pendente: true, diferenca_centavos: null })];
  const r = C.resumoMensal(confs, []);
  assert.equal(r.totais.fechamentos, 1);
  assert.equal(r.totais.pendentes, 1);
  assert.equal(r.totais.saldo, -500);
  const pend = Object.assign(confs[1], { contagem: { 5000: 2 }, operador: "" });
  const txt = F.textoConferencia(pend, () => "Caixa 2");
  assert.match(txt, /Falta o cupom do Diamante/);
  assert.doesNotMatch(txt, /Esperado/);
  const csv = F.csvConferencias([pend], () => "Caixa 2");
  assert.ok(csv.includes(";;;Falta o cupom;"), "esperado e diferença vazios");
  assert.equal(C.ehPendente(pend), true);
  assert.equal(C.ehPendente({ tipo: "abertura", pendente: true }), false);
});

test("cupom importado depois: acha o fechamento certo", () => {
  const cupom = { terminal: "3", data: "2027-01-15", turno: "9-1", encerramento: "19:05:00" };
  const base = [reg("a", "abertura", "caixa2", "07:00"), reg("b", "fechamento", "caixa1", "19:00", { pendente: true })];
  assert.match(D.fechamentoDoCupom(CAIXAS, base, cupom).erro, /Não há contagem de fechamento do Caixa 2 em 15\/01\/2027/);
  const confs = base.concat([reg("c", "fechamento", "caixa2", "12:00", { pendente: true }),
    reg("d", "fechamento", "caixa2", "19:10", { pendente: true })]);
  const r = D.fechamentoDoCupom(CAIXAS, confs, cupom);
  assert.equal(r.conferencia.id, "d", "o mais perto do encerramento");
  assert.equal(r.caixa.id, "caixa2");
  // já importado (mesmo turno)
  confs[3].cupom = { turno: "9-1" }; confs[3].pendente = false;
  const rep = D.fechamentoDoCupom(CAIXAS, confs, cupom);
  assert.equal(rep.repetido.id, "d");
  assert.match(rep.erro, /já está no fechamento das 19:10/);
  // outro turno vai para o que ainda falta
  assert.equal(D.fechamentoDoCupom(CAIXAS, confs, Object.assign({}, cupom, { turno: "8-1" })).conferencia.id, "c");
  confs[2].cupom = { turno: "8-1" };
  assert.match(D.fechamentoDoCupom(CAIXAS, confs, Object.assign({}, cupom, { turno: "7-1" })).erro, /já têm cupom/);
  // terminal desconhecido ou sem data
  assert.match(D.fechamentoDoCupom(CAIXAS, confs, Object.assign({}, cupom, { terminal: "9" })).erro, /terminal 9/);
  assert.match(D.fechamentoDoCupom(CAIXAS, confs, { terminal: "3" }).erro, /data do cupom/);
});

test("troco de amanhã: valor exato, moedas ficam, 2 de R$ 50, R$ 100 no cofre", () => {
  const soma = (c) => Object.keys(c).reduce((s, k) => s + +k * c[k], 0);
  // fechamento inventado: R$ 27,50 em moedas e cédulas de todos os valores
  const contagem = { 5: 10, 10: 20, 25: 20, 50: 10, 100: 15, 200: 30, 500: 20, 1000: 15, 2000: 20, 5000: 6, 10000: 5 };
  const ideal = { 200: 20, 500: 10, 1000: 10, 2000: 5, 5000: 2 }; // abertura do dia
  const r = C.separarTroco({ contagem, alvo: 50000, ideal });
  assert.equal(r.exato, true);
  assert.equal(r.totalDeixar, 50000);
  assert.equal(soma(r.deixar), 50000);
  assert.equal(r.totalDeixar + r.totalCofre, soma(contagem), "nada some: gaveta + cofre = contado");
  assert.equal(r.deixar[5000], 2, "2 notas de R$ 50");
  assert.equal(r.deixar[10000], undefined, "R$ 100 sempre no cofre");
  const moedasFicam = [5, 10, 25, 50, 100].reduce((s, v) => s + v * (r.deixar[v] || 0), 0);
  assert.ok(moedasFicam >= 2700 && moedasFicam <= 2750, "moedas ficam (só saem os centavos): " + moedasFicam);
  assert.equal(moedasFicam % 100, 0, "moedas fecham em reais redondos");
  for (const v of [200, 500, 1000, 2000]) assert.ok(r.deixar[v] <= contagem[v], "não deixa mais do que tem");
  // perto do que havia na abertura (cada cédula pequena no mínimo o que tinha)
  for (const v of [200, 500, 1000, 2000]) assert.ok(r.deixar[v] >= ideal[v] - 1, "perto da abertura de " + v + ": " + r.deixar[v]);
  for (const v of Object.keys(r.cofre)) assert.equal(r.cofre[v], contagem[v] - (r.deixar[v] || 0));

  // sem abertura (sem ideal): ficam as menores e saem primeiro as maiores
  const s2 = C.separarTroco({ contagem: { 100: 30, 200: 40, 500: 20, 1000: 10, 2000: 10, 5000: 3 }, alvo: 50000 });
  assert.equal(s2.totalDeixar, 50000);
  assert.equal(s2.deixar[200], 40, "notas de R$ 2 ficam");
  assert.equal(s2.deixar[100], 30, "moedas de R$ 1 ficam");
  assert.ok((s2.deixar[2000] || 0) < 10, "tira as de R$ 20 antes das pequenas");

  // não tem o suficiente (sem contar R$ 100): deixa tudo o que pode e diz quanto falta
  const s3 = C.separarTroco({ contagem: { 100: 10, 2000: 5, 10000: 3 }, alvo: 50000 });
  assert.equal(s3.exato, false);
  assert.equal(s3.totalDeixar, 11000);
  assert.equal(s3.falta, 39000);
  assert.equal(s3.deixar[10000], undefined);
  assert.equal(s3.cofre[10000], 3);

  // moedas demais: passa do alvo, então saem moedas
  const s4 = C.separarTroco({ contagem: { 100: 600 }, alvo: 50000 });
  assert.equal(s4.totalDeixar, 50000);
  assert.equal(s4.cofre[100], 100);
});

test("troco separado × abertura contada; último fechamento do caixa", () => {
  assert.deepEqual(C.compararContagens({ 200: 20, 5000: 2 }, { 200: 18, 5000: 2, 100: 1 }),
    [{ valor: 200, a: 20, b: 18 }, { valor: 100, a: 0, b: 1 }]);
  assert.deepEqual(C.compararContagens({ 200: 20 }, { 200: 20 }), []);
  const confs = [
    { id: "a", tipo: "fechamento", caixa: "caixa1", data: "2027-01-14", hora: "19:00" },
    { id: "b", tipo: "fechamento", caixa: "caixa1", data: "2027-01-15", hora: "12:00" },
    { id: "c", tipo: "fechamento", caixa: "caixa2", data: "2027-01-15", hora: "19:00" },
    { id: "d", tipo: "abertura", caixa: "caixa1", data: "2027-01-15", hora: "13:00" }
  ];
  assert.equal(C.ultimoFechamento(confs, "caixa1", "2027-01-15", "07:00").id, "a", "abertura de manhã: fechamento do dia anterior");
  assert.equal(C.ultimoFechamento(confs, "caixa1", "2027-01-15", "13:00").id, "b", "segundo turno: fechamento do primeiro");
  assert.equal(C.ultimoFechamento(confs, "caixa3", "2027-01-15", "13:00"), null);
});
