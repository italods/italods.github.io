// Testes do leitor do extrato do Banco do Brasil (CSV). Rodar com: node --test tests/
// Extrato INVENTADO (CPF/CNPJ, nomes, documentos e valores fictícios), no mesmo formato do BB.
const test = require("node:test");
const assert = require("node:assert/strict");
const B = require("../sistema/js/banco.js");

const LOJA = "11222333000144";       // CNPJ fictício da "loja"
const EXTRATO = [
  '"Data","Lançamento","Detalhes","N° documento","Valor","Tipo Lançamento"',
  '"30/12/2026","Saldo Anterior","","","0,00",""',
  '"04/01/2027","Pix - Recebido","31/12 06:41 99888777000166 CIELO S.A -","310708500000001","1.500,45","Entrada"',
  '"04/01/2027","Pix - Recebido","02/01 08:11 11222333000144 LOJA FICTIC","20811200000002","7,77","Entrada"',
  '"04/01/2027","Pix - Recebido","02/01 08:16 11222333000144 LOJA FICTIC","20816200000003","33,33","Entrada"',
  '"04/01/2027","Pix - Recebido","04/01 07:44 12345678901 JOANA DE TAL DA","40744200000004","880,00","Entrada"',
  '"04/01/2027","Pix - Recebido","04/01 09:20 55666777000188 MERCADINHO EXEM","40920200000005","300,00","Entrada"',
  '"04/01/2027","Pix - Enviado","04/01 11:35 Fornecedor Exemplo","41135300000006","-500,00","Saída"',
  '"04/01/2027","Pagamento de Boleto","EMPRESA DE ENERGIA","000000000000007","-120,00","Saída"',
  '"04/01/2027","Transferência recebida","04/01 12:00 PEDRO EXEMPLO","41200000000008","25,00","Entrada"',
  '"04/01/2027","Pix - Recebido","04/01 13:00 11222333000144 LOJA FICTIC","41300200000009","12,92","Entrada"',
  '"04/01/2027","Pix - Recebido","04/01 13:05 11222333000144 LOJA FICTIC","41305200000010","6,95","Entrada"',
  '"04/01/2027","Pix - Recebido","04/01 13:09 11222333000144 LOJA FICTIC","41309200000011","5,96","Entrada"',
  '"04/01/2027","Pix - Recebido","04/01 14:00 11222333000144 LOJA FICTIC","41400200000012","3,97","Entrada"',
  '"04/01/2027","S A L D O","","","10.000,00",""',
].join("\r\n");

test("centavos e descrição", () => {
  assert.equal(B.centavos("6.543,21"), 654321);
  assert.equal(B.centavos("-1.000,00"), -100000);
  assert.equal(B.centavos("x"), null);
  assert.deepEqual(B.lerDescricao("30/10 06:59 99888777000166 CIELO S.A -", "2026-11-03"),
    { data: "2026-10-30", hora: "06:59", documento: "99888777000166", nome: "CIELO S.A" });
  assert.equal(B.lerDescricao("31/12 06:41 12345678901 X", "2027-01-04").data, "2026-12-31", "dezembro lançado em janeiro é do ano anterior");
  assert.equal(B.lerDescricao("sem padrão", "2027-01-04"), null);
});

test("lê o extrato: usa a data da descrição, ignora saídas e saldos", () => {
  const r = B.lerExtrato(EXTRATO, LOJA);
  assert.deepEqual(r.erros, []);
  assert.equal(r.lancamentos.length, 10);
  assert.equal(r.ignorados.saidas, 2);
  assert.equal(r.ignorados.saldos, 2);
  assert.equal(r.de, "2026-12-31");
  assert.equal(r.ate, "2027-01-04");
  const cielo = r.lancamentos[0];
  assert.equal(cielo.data, "2026-12-31");
  assert.equal(cielo.data_lancamento, "2027-01-04");
  assert.equal(cielo.hora, "06:41");
});

test("categorias", () => {
  const r = B.lerExtrato(EXTRATO, LOJA);
  const cat = r.lancamentos.map((l) => l.categoria);
  assert.deepEqual(cat, ["repasse_cielo", "pix_maquininha", "pix_maquininha", "pix_terceiro", "pix_terceiro", "outro",
    "pix_maquininha", "pix_maquininha", "pix_maquininha", "pix_maquininha"]);
  assert.equal(r.lancamentos[3].pagador_tipo, "pf");
  assert.equal(r.lancamentos[4].pagador_tipo, "pj");
});

test("não guarda CPF/CNPJ nem nome completo", () => {
  const r = B.lerExtrato(EXTRATO, LOJA);
  const t = JSON.stringify(r.lancamentos);
  assert.ok(!t.includes("12345678901") && !t.includes("55666777000188") && !t.includes(LOJA) && !t.includes("99888777000166"));
  assert.equal(r.lancamentos[3].pagador, "JOANA T.");
  assert.equal(r.lancamentos[1].pagador, "", "PIX da maquininha sem nome");
  assert.equal(r.lancamentos[0].pagador, "", "repasse da Cielo sem nome");
  assert.ok(!("documentos" in r.lancamentos[0]));
});

test("chave não duplica e separa lançamentos diferentes", () => {
  const a = B.lerExtrato(EXTRATO, LOJA).lancamentos.map((l) => l.chave);
  assert.equal(new Set(a).size, a.length);
  assert.deepEqual(a, B.lerExtrato(EXTRATO, LOJA).lancamentos.map((l) => l.chave));
  assert.equal(a[0], "bb|310708500000001|2027-01-04|150045|");
});

test("sem o CNPJ da loja, o PIX da maquininha parece PIX de cliente; sugestão acha o CNPJ", () => {
  const r = B.lerExtrato(EXTRATO, "");
  assert.equal(r.lancamentos[1].categoria, "pix_terceiro");
  assert.equal(B.sugerirCnpjLoja(r.documentos), LOJA);
  assert.equal(B.sugerirCnpjLoja({ "11222333000144": 2 }), null, "poucos para sugerir");
  assert.equal(B.sugerirCnpjLoja({ "11222333000144": 9, "55666777000188": 8 }), null, "empate não sugere");
});

test("soma por categoria num dia", () => {
  const r = B.lerExtrato(EXTRATO, LOJA);
  const s = B.somarPorCategoria(r.lancamentos, "2027-01-04");
  assert.equal(s.pix_terceiro, 118000);
  assert.equal(s.pix_maquininha, 1292 + 695 + 596 + 397);
  assert.equal(s.qtd.pix_maquininha, 4);
  assert.equal(s.repasse_cielo, 0, "repasse foi de 31/12");
});

test("arquivo que não é extrato do BB", () => {
  assert.match(B.lerExtrato("a,b,c\n1,2,3", LOJA).erros[0], /extrato em CSV do Banco do Brasil/);
});

test("formatar CNPJ para mostrar", () => {
  assert.equal(B.formatarCnpj("11222333000144"), "11.222.333/0001-44");
  assert.equal(B.formatarCnpj("123"), "123");
});

test("PIX Delivery do dia: cupons dos caixas × PIX de clientes no BB", () => {
  const r = B.lerExtrato(EXTRATO, LOJA);
  const c1 = { formas: { pix_delivery: { vendas: 20000, receb: 88000 } } };
  const c2 = { formas: { pix_delivery: { vendas: 1000, receb: 0 } } };
  assert.deepEqual(B.compararPixDelivery([c1, c2], r.lancamentos, "2027-01-04"),
    { esperado: 109000, encontrado: 118000, diferenca: 9000, quantidade: 2, situacao: "sobra" });
  assert.equal(B.compararPixDelivery([c1], r.lancamentos, "2027-01-05").encontrado, 0, "outro dia");
  assert.equal(B.compararPixDelivery([], [], "2027-01-04").situacao, "bateu");
});
