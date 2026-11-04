// Testes da conciliação de cartões (recebíveis da Cielo). Rodar com: node --test tests/
// Relatório e taxas INVENTADOS, no mesmo formato da Cielo.
const test = require("node:test");
const assert = require("node:assert/strict");
const RC = require("../sistema/js/recebiveis.js");

const CAB = "Data de pagamento;Data da venda;Valor bruto;Valor Taxa/Tarifa;Valor líquido;Forma de pagamento;Bandeira;Tipo de lançamento;Status de pagamento;NSU/DOC;Código de autorização;TxID;Número da parcela;Data prevista do pagamento;Data do lançamento;Estabelecimento;Descrição;Hora da venda;Número do cartão;Banco;Agência;Conta;Quantidade total de parcelas;Número da máquina";
const CSV = [
  "Recebíveis Detalhado - Lançamentos", "Filtros:", "Data de pagamento: 18/01/2027 à 18/01/2027",
  "Totalizador", "Quantidade de lançamentos;Valor bruto;Taxa/tarifa;Valor líquido", "7;1.422,10;-26,53;1.395,57",
  CAB,
  "18/01/2027;15/01/2027;1.000,00;-8,70;991,30;Débito à vista;Visa;Venda débito;Pago;900002;654321;;00;18/01/2027;15/01/2027;1234567890;;12:10;888888 **** 0002;001;1234;56789-0;;00011111",
  "18/01/2027;15/01/2027;30,00;-0,42;29,58;Débito à vista;Elo;Venda débito;Pago;900005;111222;;00;18/01/2027;15/01/2027;1234567890;;13:00;777777 **** 0003;001;1234;56789-0;;00011111",
  "18/01/2027;15/01/2027;100,00;-5,12;94,88;Crédito parcelado loja 01/03;Mastercard;Venda parcelada;Pago;900001;123456;;01;18/01/2027;15/01/2027;1234567890;;18:50;999999 **** 0001;001;1234;56789-0;3;00011111",
  "18/01/2027;15/01/2027;100,00;-5,12;94,88;Crédito parcelado loja 02/03;Mastercard;Venda parcelada;Pago;900001;123456;;02;18/01/2027;15/01/2027;1234567890;;18:50;999999 **** 0001;001;1234;56789-0;3;00011111",
  "18/01/2027;15/01/2027;100,00;-5,12;94,88;Crédito parcelado loja 03/03;Mastercard;Venda parcelada;Pago;900001;123456;;03;18/01/2027;15/01/2027;1234567890;;18:50;999999 **** 0001;001;1234;56789-0;3;00011111",
  "18/01/2027;14/01/2027;50,00;-1,80;48,20;Crédito à vista;Visa;Venda crédito;Pago;900009;333444;;00;15/01/2027;14/01/2027;1234567890;;09:00;666666 **** 0004;001;1234;56789-0;;00011111",
  "18/01/2027;18/01/2027;42,10;-0,25;41,85;Pix;Pix;Venda Pix;Pago;5550001;000000;CIELO202701180000000000000005550001;00;18/01/2027;18/01/2027;1234567890;;08:00;;001;1234;56789-0;;00022222",
].join("\r\n");

const TAXAS = [
  { modalidade: "pix", bandeira: "*", parcelas: 1, taxa: 59, prazo_dias_uteis: 0 },
  { modalidade: "debito", bandeira: "visa", parcelas: 1, taxa: 87, prazo_dias_uteis: 1 },
  { modalidade: "debito", bandeira: "elo", parcelas: 1, taxa: 139, prazo_dias_uteis: 1 },
  { modalidade: "credito", bandeira: "visa", parcelas: 1, taxa: 275, prazo_dias_uteis: 1 },
  { modalidade: "parcelado", bandeira: "mastercard", parcelas: 3, taxa: 512, prazo_dias_uteis: 1 },
];

test("taxa: digitar e mostrar como 1,23%", () => {
  assert.equal(RC.lerTaxa("1,23%"), 123);
  assert.equal(RC.lerTaxa("1,23"), 123);
  assert.equal(RC.lerTaxa("12,61 %"), 1261);
  assert.equal(RC.lerTaxa("1,5"), 150);
  assert.equal(RC.lerTaxa("2"), 200);
  assert.equal(RC.lerTaxa("abc"), null);
  assert.equal(RC.lerTaxa("1,235"), null, "só duas casas");
  assert.equal(RC.mostrarTaxa(123), "1,23%");
  assert.equal(RC.mostrarTaxa(1261), "12,61%");
  assert.equal(RC.mostrarTaxa(null), "—");
  assert.equal(RC.mostrarTaxaEfetiva(873, 100000), "0,873%");
});

test("modalidade e bandeira", () => {
  assert.deepEqual(RC.modalidade("Crédito parcelado loja 02/03"), { modalidade: "parcelado", parcelas: 3 });
  assert.deepEqual(RC.modalidade("Débito pré-pago"), { modalidade: "debito", parcelas: 1 });
  assert.deepEqual(RC.modalidade("Crédito à vista"), { modalidade: "credito", parcelas: 1 });
  assert.deepEqual(RC.modalidade("Pix"), { modalidade: "pix", parcelas: 1 });
  assert.deepEqual(RC.modalidade("Aluguel de equipamento"), { modalidade: "outro", parcelas: 1 });
  assert.equal(RC.bandeiraNormal("Mastercard"), "mastercard");
  assert.equal(RC.bandeiraNormal("American Express"), "amex");
});

test("lê o relatório e não guarda cartão, banco, agência ou conta", () => {
  const r = RC.lerCsv(CSV);
  assert.deepEqual(r.erros, []);
  assert.equal(r.lancamentos.length, 7);
  assert.equal(RC.conferirTotalizador(r).ok, true);
  const t = JSON.stringify(r.lancamentos);
  assert.ok(!t.includes("****") && !t.includes("56789-0") && !t.includes("1234567890"));
  const l = r.lancamentos[2];
  assert.equal(l.modalidade, "parcelado");
  assert.equal(l.parcela, 1);
  assert.equal(l.parcelas, 3);
  assert.equal(l.taxa, 512, "taxa positiva = cobrada");
  assert.equal(l.data_venda, "2027-01-15");
  assert.equal(l.hora_venda, "18:50");
  assert.equal(new Set(r.lancamentos.map((x) => x.chave)).size, 7, "chaves únicas (as 3 parcelas também)");
});

test("confere a taxa do contrato (tolera 1 centavo de arredondamento)", () => {
  const r = RC.lerCsv(CSV);
  const c = r.lancamentos.map((l) => RC.conferirLancamento(l, TAXAS));
  assert.deepEqual(c.map((x) => x.situacao), ["ok", "ok", "ok", "ok", "ok", "taxa_maior", "ok"]);
  assert.equal(c[1].taxaEsperada, 42, "30,00 × 1,39% = 0,417 → 0,42");
  assert.equal(c[5].taxaEsperada, 138, "50,00 × 2,75% = 1,375 → 1,38");
  assert.equal(c[5].diferenca, 42, "cobrou R$ 0,42 a mais");
});

test("prazo: crédito de quinta pago na segunda = 1 dia útil de atraso", () => {
  const r = RC.lerCsv(CSV);
  const c = RC.conferirLancamento(r.lancamentos[5], TAXAS);
  assert.equal(c.prazoEsperado, "2027-01-15");
  assert.equal(c.atraso, 1);
  assert.equal(RC.conferirLancamento(r.lancamentos[0], TAXAS).atraso, 0, "venda de sexta paga na segunda: no prazo");
});

test("sem taxa cadastrada e lançamento que não é venda", () => {
  const sem = RC.conferirLancamento({ modalidade: "credito", bandeira: "Hipercard", parcelas: 1, valor_bruto: 1000, taxa: 30, data_venda: "2027-01-15", data_pagamento: "2027-01-18" }, TAXAS);
  assert.equal(sem.situacao, "sem_taxa");
  const aluguel = RC.conferirLancamento({ modalidade: "outro", valor_bruto: -8990, taxa: 0 }, TAXAS);
  assert.equal(aluguel.situacao, "outro");
});

test("resumo com alertas (taxa maior, atraso, cobrança)", () => {
  const r = RC.lerCsv(CSV);
  const lanc = r.lancamentos.concat([{ modalidade: "outro", tipo: "Aluguel de equipamento", valor_bruto: -8990, taxa: 0, valor_liquido: -8990, data_pagamento: "2027-01-18" }]);
  const s = RC.resumo(lanc, TAXAS);
  assert.equal(s.total.taxa, 2653);
  assert.equal(s.total.esperada, 2653 - 42);
  assert.equal(s.alertas.length, 2, "o crédito com taxa maior e atraso + o aluguel");
  assert.equal(s.por.parcelado.qtd, 3);
});

test("liga o pagamento à venda e acha venda sem pagamento", () => {
  const r = RC.lerCsv(CSV);
  const vendas = [
    { data: "2027-01-15", hora: "12:10", forma: "debito", bandeira: "Visa", parcelas: 1, valor_centavos: 100000, aprovada: true, nsu: "900002", autorizacao: "654321" },
    { data: "2027-01-15", hora: "18:50", forma: "credito", bandeira: "Mastercard", parcelas: 3, valor_centavos: 30000, aprovada: true, nsu: "900001", autorizacao: "123456" },
    { data: "2027-01-15", hora: "19:00", forma: "debito", bandeira: "Visa", parcelas: 1, valor_centavos: 2500, aprovada: true, nsu: "900007", autorizacao: "777777" },
    { data: "2027-01-15", hora: "19:05", forma: "debito", bandeira: "Visa", parcelas: 1, valor_centavos: 9900, aprovada: false, nsu: "900008", autorizacao: "" },
    { data: "2027-01-18", hora: "08:00", forma: "pix", bandeira: "Pix", parcelas: 1, valor_centavos: 4210, aprovada: true, txid: "CIELO202701180000000000000005550001" },
    { data: "2027-01-13", hora: "08:00", forma: "pix", bandeira: "Pix", parcelas: 1, valor_centavos: 999, aprovada: true, txid: "X" },
  ];
  const sem = RC.vendasSemPagamento(vendas, r.lancamentos, TAXAS, "2027-01-20");
  assert.deepEqual(sem.map((x) => [x.venda.nsu || x.venda.txid, x.prazo, x.pagas, x.parcelas]), [["900007", "2027-01-18", 0, 1]],
    "só o débito de 19:00 (o PIX de 13/01 tem prazo fora do período do relatório; não aprovada não conta)");
  const tiraParcela = r.lancamentos.filter((l) => !(l.modalidade === "parcelado" && l.parcela === 3));
  const sem2 = RC.vendasSemPagamento(vendas, tiraParcela, TAXAS, "2027-01-20");
  assert.ok(sem2.some((x) => x.venda.nsu === "900001" && x.pagas === 2 && x.parcelas === 3), "parcelado com parcela faltando");
});

test("repasse no BB por dia (cartões; PIX cai separado)", () => {
  const r = RC.lerCsv(CSV);
  const esperado = 99130 + 2958 + 3 * 9488 + 4820;
  const sem = RC.repassePorDia(r.lancamentos, []);
  assert.deepEqual(sem, [{ data: "2027-01-18", esperado, recebido: 0, diferenca: -esperado, situacao: "sem_extrato" }]);
  const bb = [{ data: "2027-01-18", categoria: "repasse_cielo", valor_centavos: esperado }, { data: "2027-01-18", categoria: "pix_maquininha", valor_centavos: 4182 }];
  assert.equal(RC.repassePorDia(r.lancamentos, bb)[0].situacao, "bateu");
  bb[0].valor_centavos -= 100;
  assert.equal(RC.repassePorDia(r.lancamentos, bb)[0].diferenca, -100);
});

test("arquivo que não é de recebíveis", () => {
  assert.match(RC.lerCsv("a;b\n1;2").erros[0], /Recebíveis/);
});
