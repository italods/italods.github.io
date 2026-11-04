// Testes de "Investigar diferença". Rodar com: node --test tests/
// Dados INVENTADOS.
const test = require("node:test");
const assert = require("node:assert/strict");
const I = require("../sistema/js/investigar.js");

const V = (hora, forma, valor, extra) => Object.assign({ data: "2027-01-15", hora, forma, valor_centavos: valor, aprovada: true }, extra);

test("combinações que somam o alvo", () => {
  const itens = [V("10:00", "debito", 500), V("10:01", "debito", 700), V("10:02", "debito", 1200), V("10:03", "debito", 300)];
  const r = I.combinacoes(itens, 1200, 3, 10).map((c) => c.map((x) => x.valor_centavos));
  assert.deepEqual(r, [[1200], [500, 700]], "primeiro a venda única, depois o par");
  assert.deepEqual(I.combinacoes(itens, 1500, 3, 10).map((c) => c.map((x) => x.valor_centavos)), [[1200, 300], [500, 700, 300]]);
  assert.deepEqual(I.combinacoes(itens, 0, 3, 10), []);
  assert.equal(I.combinacoes(itens, 99999, 3, 10).length, 0);
});

test("Cielo tem a mais: acha a venda com o valor exato", () => {
  const vendas = [V("12:00", "debito", 5000), V("17:52", "debito", 1340, { bandeira: "Visa" })];
  const r = I.explicarDiferenca({ forma: "debito", diferenca: 1340, vendas, difs: { debito: 1340, credito: 0, pix: 0 } });
  assert.equal(r[0].tipo, "venda_exata");
  assert.match(r[0].texto, /R\$\s?13,40 às 17:52 \(Visa\)/);
  assert.equal(r[0].itens[0].hora, "17:52");
});

test("débito a mais e crédito a menos: venda registrada na forma errada", () => {
  const vendas = [V("15:00", "debito", 4500)];
  const r = I.explicarDiferenca({ forma: "debito", diferenca: 4500, vendas, difs: { debito: 4500, credito: -4500, pix: 0 } });
  assert.equal(r[0].tipo, "forma_trocada");
  assert.match(r[0].texto, /passou no débito na Cielo, mas foi registrada como crédito/);
});

test("o outro caixa tem a diferença oposta: máquina do outro caixa", () => {
  const r = I.explicarDiferenca({ forma: "credito", diferenca: -3000, vendas: [], difs: { credito: -3000 }, difsOutroCaixa: { credito: 3000 } });
  assert.equal(r[0].tipo, "outro_caixa");
  assert.match(r[0].texto, /máquina do outro caixa/);
});

test("Diamante tem a mais: venda não aprovada com o mesmo valor", () => {
  const nao = [V("10:40", "debito", 17500, { aprovada: false })];
  const r = I.explicarDiferenca({ forma: "debito", diferenca: -17500, vendas: [], naoAprovadas: nao, difs: { debito: -17500 } });
  assert.equal(r[0].tipo, "nao_aprovada");
  assert.match(r[0].texto, /NÃO APROVADA de R\$\s?175,00 às 10:40/);
});

test("PIX da maquininha a menos: PIX de cliente que caiu direto na conta", () => {
  const bb = [{ data: "2027-01-15", hora: "13:37", valor_centavos: 2650, pagador: "ANA T." }, { data: "2027-01-15", hora: "16:00", valor_centavos: 1000 }];
  const r = I.explicarDiferenca({ forma: "pix", diferenca: -2650, vendas: [], difs: { pix: -2650 }, bbTerceiros: bb });
  assert.equal(r[0].tipo, "pix_chave");
  assert.match(r[0].texto, /R\$\s?26,50 às 13:37 de ANA T\./);
  const r2 = I.explicarDiferenca({ forma: "pix", diferenca: -3650, vendas: [], difs: { pix: -3650 }, bbTerceiros: bb });
  assert.equal(r2[0].tipo, "pix_chave");
  assert.equal(r2[0].itens.length, 2, "combinação de dois PIX");
});

test("venda repetida em poucos minutos", () => {
  const vendas = [V("10:00", "credito", 8000), V("10:02", "credito", 8000)];
  const r = I.explicarDiferenca({ forma: "credito", diferenca: 8000, vendas, difs: { credito: 8000 } });
  assert.ok(r.some((x) => x.tipo === "repetida"));
});

test("sem explicação: diz que não achou (não inventa)", () => {
  const r = I.explicarDiferenca({ forma: "pix", diferenca: -5317, vendas: [V("10:00", "pix", 500)], difs: { pix: -5317 }, bbTerceiros: [] });
  assert.equal(r.length, 1);
  assert.equal(r[0].tipo, "nada");
  assert.deepEqual(I.explicarDiferenca({ forma: "pix", diferenca: 0 }), []);
});

test("PIX da maquininha × BB: taxa, atraso e o que caiu atrasado", () => {
  const cielo = [V("09:14", "pix", 730), V("16:12", "pix", 4800), V("15:40", "pix", 2900), V("19:00", "pix", 1000)];
  const bb = [
    { data: "2027-01-15", hora: "16:17", valor_centavos: 4768 },
    { data: "2027-01-15", hora: "15:44", valor_centavos: 2881 },
    { data: "2027-01-15", hora: "22:47", valor_centavos: 725 },
    { data: "2027-01-15", hora: "10:00", valor_centavos: 9999 },
  ];
  const r = I.casarPixMaquininha(cielo, bb);
  assert.equal(r.pares.length, 3);
  assert.deepEqual(r.pares.filter((p) => p.atrasado).map((p) => p.cielo.hora), ["09:14"]);
  assert.deepEqual(r.soCielo.map((v) => v.hora), ["19:00"], "PIX que não chegou");
  assert.deepEqual(r.soBB.map((l) => l.valor_centavos), [9999], "PIX com o CNPJ da loja sem venda na Cielo");
  assert.ok(r.taxaMedia > 0.005 && r.taxaMedia < 0.008);
});

test("PIX Delivery: casa exato e próximo; sobra o resto", () => {
  const rec = [{ forma: "pix_delivery", valor: 61000 }, { forma: "pix_delivery", valor: 98731 }, { forma: "dinheiro", valor: 100 }, { forma: "pix_delivery", valor: 777 }];
  const bb = [
    { hora: "08:05", valor_centavos: 61000 }, { hora: "17:40", valor_centavos: 98700 }, { hora: "12:00", valor_centavos: 30000 },
  ];
  const r = I.casarPixDelivery(rec, bb);
  assert.deepEqual(r.exatos.map((x) => x.cupom.valor), [61000]);
  assert.deepEqual(r.proximos.map((x) => [x.cupom.valor, x.bb.valor_centavos, x.diferenca]), [[98731, 98700, -31]]);
  assert.deepEqual(r.soCupom.map((x) => x.valor), [777]);
  assert.deepEqual(r.soBB.map((x) => x.valor_centavos), [30000]);
});
