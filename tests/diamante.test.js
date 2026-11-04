// Testes do leitor do cupom "Fechamento de turno" do Diamante. Rodar com: node --test tests/
// Cupom INVENTADO (nomes, valores e números fictícios), no mesmo formato do Diamante.
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../sistema/js/diamante.js");

const CUPOM = `
SUPERMERCADO EXEMPLO
RUA DE TESTE , 1
===============================================
FECHAMENTO DE TURNO
TERMINAL..... : 7
DATA MOV..... : 15/01/2027
HORA ABERTURA.: 07:00:10
HORA ENC......: 19:30:00
DATA ENC......: 15/01/2027
TURNO... .... : 12 - 1
OPERADOR..... : 0 - FULANO DE TESTE
===============================================
RESUMO DE FORMAS PAGTO
FORMA PAGTO VENDAS RECBTOS
DINHEIRO 1.000,50 200,00
CARTEIRA 300,00 0,00
CARTAO CREDITO 150,25 0,00
CARTAO DEBITO 99,75 1.000,00
PIX 50,00 10,00
PIX DELIVERY 20,00 300,00
_________ _________
TOTAL : 1.620,50 1.510,00
===============================================
RESUMO DO CAIXA
VENDA BRUTA 1.620,50
FUNDO DE CAIXA 400,00
SANGRIA -1.250,00
RECEBIMENTO 1.510,00
_____________
TOTAL ENTRADAS: 3.530,50
TOTAL SAIDAS : -1.250,00
TOTAL CAIXA : 2.280,50
-----------------------------------------------
TOTAL LIQUIDO : 350,50
T.LIQ = DINHEIRO+CHEQUE+ENTRADAS-SAIDAS
===============================================
CANCELAMENTOS ÍTEM : 12,34
DESCONTO : 0,50
ACRÉSCIMOS : 0,00
-----------------------------------------------
***** RECEBIMENTOS *****
CARTAO DEBITO 1.000,00 501 - JOANA DE TAL DA SILVA
DINHEIRO 150,00 77 - PEDRO EXEMPLO (MERCADINHO)
DINHEIRO 50,00 2401 - ZEZINHO
PIX 10,00 77 - PEDRO EXEMPLO (MERCADINHO)
PIX DELIVERY 300,00 88 - ANA DOS TESTES
-----------------------------------------------
***** S A N G R I A S *****
DINHEIRO -1.000,00
DINHEIRO -250,00
-----------------------------------------------
`;

test("centavos no formato do cupom", () => {
  assert.equal(D.centavos("1.234,56"), 123456);
  assert.equal(D.centavos("-1.500,00"), -150000);
  assert.equal(D.centavos("0,05"), 5);
  assert.equal(D.centavos("12.345.678,90"), 1234567890);
  assert.equal(D.centavos("1234,56"), 123456);
  assert.equal(D.centavos("1,2"), null);
  assert.equal(D.centavos("abc"), null);
});

test("abreviar nome do cliente", () => {
  assert.equal(D.abreviarNome("JOANA DE TAL DA SILVA"), "JOANA T.");
  assert.equal(D.abreviarNome("PEDRO EXEMPLO (MERCADINHO)"), "PEDRO E.");
  assert.equal(D.abreviarNome("ZEZINHO"), "ZEZINHO");
  assert.equal(D.abreviarNome("ANA DOS TESTES"), "ANA T.");
  assert.equal(D.abreviarNome("josé da conceição"), "JOSÉ C.");
  assert.equal(D.abreviarNome("LOJA POSTO 30"), "LOJA P.");
  assert.equal(D.abreviarNome("  "), "");
});

test("lê o cabeçalho do cupom", () => {
  const { cupom, erros } = D.lerCupom(CUPOM);
  assert.deepEqual(erros, []);
  assert.equal(cupom.terminal, "7");
  assert.equal(cupom.data, "2027-01-15");
  assert.equal(cupom.turno, "12-1");
  assert.equal(cupom.operador, "FULANO DE TESTE");
  assert.equal(cupom.abertura, "07:00:10");
  assert.equal(cupom.encerramento, "19:30:00");
});

test("lê formas de pagamento e resumo do caixa", () => {
  const { cupom } = D.lerCupom(CUPOM);
  assert.deepEqual(cupom.formas.dinheiro, { vendas: 100050, receb: 20000 });
  assert.deepEqual(cupom.formas.carteira, { vendas: 30000, receb: 0 });
  assert.deepEqual(cupom.formas.credito, { vendas: 15025, receb: 0 });
  assert.deepEqual(cupom.formas.debito, { vendas: 9975, receb: 100000 });
  assert.deepEqual(cupom.formas.pix, { vendas: 5000, receb: 1000 });
  assert.deepEqual(cupom.formas.pix_delivery, { vendas: 2000, receb: 30000 });
  assert.equal(cupom.venda_bruta, 162050);
  assert.equal(cupom.fundo, 40000);
  assert.equal(cupom.sangria, 125000);
  assert.equal(cupom.recebimento, 151000);
  assert.equal(cupom.total_liquido, 35050);
  assert.equal(cupom.cancelamentos, 1234);
  assert.equal(cupom.desconto, 50);
  assert.equal(cupom.acrescimos, 0);
});

test("lê recebimentos (nome abreviado) e sangrias", () => {
  const { cupom } = D.lerCupom(CUPOM);
  assert.equal(cupom.recebimentos.length, 5);
  assert.deepEqual(cupom.recebimentos[0], { forma: "debito", valor: 100000, codigo: "501", nome: "JOANA T." });
  assert.deepEqual(cupom.recebimentos[3], { forma: "pix", valor: 1000, codigo: "77", nome: "PEDRO E." });
  assert.equal(cupom.recebimentos[4].forma, "pix_delivery");
  assert.ok(!JSON.stringify(cupom).includes("SILVA"), "nome completo não fica guardado");
  assert.deepEqual(cupom.sangrias, [100000, 25000]);
});

test("cupom certo passa na conferência", () => {
  const { cupom } = D.lerCupom(CUPOM);
  assert.deepEqual(D.conferirCupom(cupom), []);
  assert.equal(D.liquidoCalculado(cupom), 35050);
});

test("esperado por forma = vendas + recebimentos (dinheiro pelo total líquido)", () => {
  const { cupom } = D.lerCupom(CUPOM);
  assert.deepEqual(D.esperadoPorForma(cupom), {
    dinheiro: 35050, carteira: 30000, credito: 15025, debito: 109975, pix: 6000, pix_delivery: 32000
  });
});

test("conferência acha erro de digitação", () => {
  const { cupom } = D.lerCupom(CUPOM);
  cupom.formas.debito.vendas = 9957; // trocou dois números
  const r = D.conferirCupom(cupom);
  assert.equal(r.length, 1);
  assert.equal(r[0].nivel, "erro");
  assert.match(r[0].texto, /venda bruta/);
  cupom.formas.debito.vendas = 9975;
  cupom.total_liquido = 35000;
  assert.match(D.conferirCupom(cupom)[0].texto, /Total líquido/);
});

test("recebimento listado diferente do resumo é aviso", () => {
  const { cupom } = D.lerCupom(CUPOM);
  cupom.recebimentos.pop();
  const r = D.conferirCupom(cupom);
  assert.equal(r.length, 1);
  assert.equal(r[0].nivel, "aviso");
  assert.match(r[0].texto, /PIX Delivery/);
});

test("PIX DELIVERY não é confundido com PIX", () => {
  const { cupom } = D.lerCupom(CUPOM.replace("PIX 50,00 10,00", "PIX 0,00 0,00"));
  assert.deepEqual(cupom.formas.pix, { vendas: 0, receb: 0 });
  assert.deepEqual(cupom.formas.pix_delivery, { vendas: 2000, receb: 30000 });
});

test("aceita linhas com espaços diferentes e sem acento", () => {
  const texto = CUPOM.replace(/ +/g, "   ").replace("ÍTEM", "ITEM").replace("ACRÉSCIMOS", "ACRESCIMOS");
  const { cupom, erros } = D.lerCupom(texto);
  assert.deepEqual(erros, []);
  assert.equal(cupom.cancelamentos, 1234);
});

test("texto que não é cupom", () => {
  const r = D.lerCupom("Extrato bancário\n01/01 PIX 10,00");
  assert.equal(r.cupom, null);
  assert.match(r.erros[0], /Fechamento de turno/);
});

test("cupom incompleto avisa o que faltou", () => {
  const texto = CUPOM.split("\n").filter((l) => !l.startsWith("CARTAO CREDITO") && !l.startsWith("TERMINAL")).join("\n");
  const { erros } = D.lerCupom(texto);
  assert.ok(erros.some((e) => /terminal/.test(e)));
  assert.ok(erros.some((e) => /Cartão crédito/.test(e)));
});

test("caixa pelo terminal", () => {
  const caixas = [{ id: "caixa1", terminal: "1" }, { id: "caixa2", terminal: "3" }];
  assert.equal(D.caixaDoTerminal(caixas, "3").id, "caixa2");
  assert.equal(D.caixaDoTerminal(caixas, 1).id, "caixa1");
  assert.equal(D.caixaDoTerminal(caixas, "9"), null);
});

test("monta as linhas a partir dos pedaços do PDF", () => {
  const it = (s, x, y) => ({ str: s, transform: [1, 0, 0, 1, x, y] });
  const texto = D.textoDeItensPdf([
    it("1.000,50", 120, 600.4), it("DINHEIRO", 10, 600), it("200,00", 180, 601.2),
    it("FECHAMENTO DE TURNO", 30, 700), it("   ", 5, 650), it("TERMINAL..... : 7", 10, 680),
  ]);
  assert.equal(texto, "FECHAMENTO DE TURNO\nTERMINAL..... : 7\nDINHEIRO 1.000,50 200,00");
  assert.equal(D.textoDeItensPdf([]), "");
});
