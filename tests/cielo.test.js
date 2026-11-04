// Testes do leitor do CSV da Cielo. Rodar com: node --test tests/
// CSV INVENTADO (máquinas, valores, NSU, nomes e IDs fictícios), no mesmo formato da Cielo.
const test = require("node:test");
const assert = require("node:assert/strict");
const CI = require("../sistema/js/cielo.js");

const CAB = "Data da venda;Hora da venda;Forma de pagamento;Quantidade total de parcelas;Bandeira;Valor bruto;Status da venda;Número da máquina;NSU/DOC;Código de autorização;ID Pix;TxID;Parcelado cliente;Origem do valor;Estabelecimento;CPF/CNPJ do estabelecimento;Motivo;Canal da venda;Tipo de captura;Número do cartão;Número do pedido;TID;Nota fiscal;Documento de origem;Instituição de origem;Destino do valor;Documento de destino;Instituição de destino";
const L = (s) => s;
const CSV = [
  "Ouvidoria", "0800 000 0000 (todas as localidades)", "Informações de acesso", "Usuário: FULANO DE TESTE",
  "Estabelecimento: 1234567890", "CPF/CNPJ: 00.000.000/0001-00", "Detalhado de vendas Cielo", "Filtros:",
  "Data da venda: 15/01/2027 à 15/01/2027", "Status: Todos os status", "Visualizar vendas Pix: Sim",
  "Totalizador", "Quantidade de vendas;Valor bruto", "6;1302,25",
  CAB,
  L("15/01/2027;18:50;Crédito parcelado loja;03;Mastercard;300,00;Aprovada;00011111;900001;123456;;;Não;;1234567890;00.000.000/0001-00;;Máquina;Leitura de chip;999999 **** 0001;;;;;;;;"),
  L("15/01/2027;18:33;Pix;;Pix;42,00;Aprovada;00022222;5550001;000000;E000000002027011518330000000001;CIELO202701150000000000000005550001;Não;JOANA DE TAL DA SILVA;1234567890;00.000.000/0001-00;;Máquina;QR Code;000000 **** 0000;;;;***.111.222-**;BANCO FICTICIO;LOJA FICTICIA LTDA;00.000.000/0001-00;BANCO X"),
  L("15/01/2027;12:10;Débito à vista;;Visa;1.000,00;Aprovada;00011111;900002;654321;;;Não;;1234567890;00.000.000/0001-00;;Máquina;Contactless;888888 **** 0002;;;;;;;;"),
  L("15/01/2027;12:05;Débito à vista;;Visa;455,00;Não aprovada;00011111;900003;;;;Não;;1234567890;00.000.000/0001-00;Saldo insuficiente;Máquina;Contactless;888888 **** 0002;;;;;;;;"),
  L("15/01/2027;08:21;Pix;;Pix;5,25;Aprovada;00011111;5550002;000000;E000000002027011508210000000002;CIELO202701150000000000000005550002;Não;Pedro Exemplo;1234567890;00.000.000/0001-00;;Máquina;QR Code;000000 **** 0000;;;;***.333.444-**;BANCO FICTICIO;LOJA FICTICIA LTDA;00.000.000/0001-00;BANCO X"),
  L("15/01/2027;07:10;Crédito à vista;;Elo;0,00;Aprovada;00011111;900004;111111;;;Não;;1234567890;00.000.000/0001-00;;Máquina;Leitura de chip;777777 **** 0003;;;;;;;;"),
].join("\r\n") + "\r\n";

test("centavos", () => {
  assert.equal(CI.centavos("4321,09"), 432109);
  assert.equal(CI.centavos("1.234,56"), 123456);
  assert.equal(CI.centavos("12,5"), 1250);
  assert.equal(CI.centavos("10"), 1000);
  assert.equal(CI.centavos("abc"), null);
});

test("forma de pagamento", () => {
  assert.equal(CI.formaDe("Débito à vista"), "debito");
  assert.equal(CI.formaDe("Crédito parcelado loja"), "credito");
  assert.equal(CI.formaDe("Crédito à vista"), "credito");
  assert.equal(CI.formaDe("Pix"), "pix");
  assert.equal(CI.formaDe("Voucher alimentação"), "outro");
});

test("lê as vendas e ignora a linha com valor zero", () => {
  const r = CI.lerCsv(CSV);
  assert.deepEqual(r.erros, []);
  assert.equal(r.vendas.length, 5);
  assert.deepEqual(r.ignoradas, [{ linha: 21, motivo: "valor inválido" }]);
  assert.deepEqual(r.totalizador, { quantidade: 6, valor: 130225 });
  assert.equal(r.de, "2027-01-15");
  assert.equal(r.ate, "2027-01-15");
});

test("campos de uma venda de cartão (sem número do cartão)", () => {
  const v = CI.lerCsv(CSV).vendas[0];
  assert.deepEqual(v, {
    data: "2027-01-15", hora: "18:50", forma: "credito", forma_original: "Crédito parcelado loja", parcelas: 3,
    bandeira: "Mastercard", valor_centavos: 30000, aprovada: true, status: "Aprovada", maquina: "00011111",
    nsu: "900001", autorizacao: "123456", id_pix: "", txid: "", pagador: "",
    chave: "cartao|00011111|2027-01-15|900001|123456|30000",
  });
  assert.ok(!JSON.stringify(v).includes("****"), "não guarda número do cartão");
});

test("PIX: pagador abreviado, chave pelo TxID, sem CPF", () => {
  const v = CI.lerCsv(CSV).vendas[1];
  assert.equal(v.forma, "pix");
  assert.equal(v.pagador, "JOANA T.");
  assert.equal(v.chave, "pix|CIELO202701150000000000000005550001");
  const tudo = JSON.stringify(CI.lerCsv(CSV));
  assert.ok(!tudo.includes("111.222") && !tudo.includes("SILVA") && !tudo.includes("0001-00"), "sem CPF/CNPJ nem nome completo");
});

test("venda não aprovada é lida mas marcada", () => {
  const v = CI.lerCsv(CSV).vendas.find((x) => x.nsu === "900003");
  assert.equal(v.aprovada, false);
  assert.equal(v.status, "Não aprovada");
});

test("totalizador: confere e acusa diferença", () => {
  const r = CI.lerCsv(CSV);
  const t = CI.conferirTotalizador(r);
  assert.equal(t.ok, false, "a linha com valor zero conta no totalizador da Cielo");
  assert.match(t.texto, /lidas 5 vendas, a Cielo diz 6/);
  const r2 = CI.lerCsv(CSV.replace("6;1302,25", "5;1802,25"));
  assert.equal(CI.conferirTotalizador(r2).ok, true);
  assert.equal(CI.conferirTotalizador({ vendas: [], totalizador: null }).ok, null);
});

test("colunas em outra ordem e arquivo em Windows-1252", () => {
  const cols = CAB.split(";");
  const ordem = cols.map((_, i) => i).reverse();
  const reordenar = (l) => { const c = l.split(";"); return ordem.map((i) => c[i] ?? "").join(";"); };
  const linhas = CSV.split("\r\n");
  const i = linhas.indexOf(CAB);
  const novo = linhas.map((l, n) => (n >= i && l ? reordenar(l) : l)).join("\r\n");
  const bytes = Buffer.from(novo, "latin1"); // "Número" vira 0xFA como na Cielo
  const r = CI.lerCsv(CI.decodificar(bytes));
  assert.deepEqual(r.erros, []);
  assert.equal(r.vendas.length, 5);
  assert.equal(r.vendas[0].maquina, "00011111");
  assert.equal(CI.decodificar(Buffer.from("﻿Data da venda", "utf8")), "Data da venda");
});

test("arquivo sem colunas obrigatórias ou que não é da Cielo", () => {
  assert.match(CI.lerCsv("qualquer;coisa\n1;2").erros[0], /Data da venda/);
  const semMaquina = CSV.replace("Número da máquina", "Outra coisa");
  assert.match(CI.lerCsv(semMaquina).erros[0], /numero da maquina/);
});

test("reimportar não duplica: mesma chave", () => {
  const a = CI.lerCsv(CSV).vendas.map((v) => v.chave);
  const b = CI.lerCsv(CSV).vendas.map((v) => v.chave);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length, "chaves diferentes para vendas diferentes");
});

test("caixa da venda: padrão da máquina e troca no dia", () => {
  const maquinas = [{ numero: "00011111", caixa: "caixa1" }, { numero: "00022222", caixa: "caixa2" }];
  const v = { maquina: "00011111", data: "2027-01-15", hora: "12:10" };
  assert.equal(CI.caixaDaVenda(v, maquinas, []), "caixa1");
  assert.equal(CI.caixaDaVenda({ ...v, maquina: "999" }, maquinas, []), null, "máquina desconhecida");
  const trocaDia = [{ data: "2027-01-15", maquina: "00011111", caixa: "caixa2" }];
  assert.equal(CI.caixaDaVenda(v, maquinas, trocaDia), "caixa2");
  assert.equal(CI.caixaDaVenda({ ...v, data: "2027-01-16" }, maquinas, trocaDia), "caixa1", "troca só vale no dia");
  const trocaHora = [{ data: "2027-01-15", maquina: "00011111", caixa: "caixa2", hora_de: "12:00", hora_ate: "13:00" }];
  assert.equal(CI.caixaDaVenda(v, maquinas, trocaHora), "caixa2");
  assert.equal(CI.caixaDaVenda({ ...v, hora: "13:01" }, maquinas, trocaHora), "caixa1", "fora do horário volta ao padrão");
  const ambas = [{ data: "2027-01-15", maquina: "00011111", caixa: "caixa2" }, { data: "2027-01-15", maquina: "00011111", caixa: "caixa3", hora_de: "12:00" }];
  assert.equal(CI.caixaDaVenda(v, maquinas, ambas), "caixa3", "troca com horário vale mais");
});

test("soma por forma de um caixa (só aprovadas)", () => {
  const r = CI.lerCsv(CSV);
  const maquinas = [{ numero: "00011111", caixa: "caixa1" }, { numero: "00022222", caixa: "caixa2" }];
  assert.deepEqual(CI.somarPorForma(r.vendas, "caixa1", "2027-01-15", maquinas, []),
    { debito: 100000, credito: 30000, pix: 525, outro: 0, quantidade: 3, nao_aprovadas: 1 });
  assert.deepEqual(CI.somarPorForma(r.vendas, "caixa2", "2027-01-15", maquinas, []),
    { debito: 0, credito: 0, pix: 4200, outro: 0, quantidade: 1, nao_aprovadas: 0 });
});

test("resumo por máquina e final do número", () => {
  const res = CI.resumoPorMaquina(CI.lerCsv(CSV).vendas);
  assert.equal(res.length, 2);
  assert.deepEqual(res[0], { maquina: "00011111", debito: 100000, credito: 30000, pix: 525, outro: 0, quantidade: 3, nao_aprovadas: 1, valor_nao_aprovado: 45500 });
  assert.equal(CI.finalMaquina("00011111"), "final 1111");
  assert.equal(CI.finalMaquina("123"), "123");
});

test("dividir linha com aspas", () => {
  assert.deepEqual(CI.dividir('a;"b;c";"d ""e"""'), ["a", "b;c", 'd "e"']);
});

test("compara o cupom com a Cielo por forma", () => {
  const D = require("../sistema/js/diamante.js");
  const cupom = D.cupomVazio();
  cupom.formas.debito = { vendas: 9975, receb: 100000 };
  cupom.formas.credito = { vendas: 30000, receb: 0 };
  cupom.formas.pix = { vendas: 500, receb: 100 };
  const r = CI.compararComCupom(cupom, { debito: 109975, credito: 31220, pix: 525 });
  assert.deepEqual(r.map((x) => [x.forma, x.esperado, x.encontrado, x.diferenca, x.situacao]), [
    ["debito", 109975, 109975, 0, "bateu"],
    ["credito", 30000, 31220, 1220, "sobra"],
    ["pix", 600, 525, -75, "falta"],
  ]);
  assert.deepEqual(CI.compararComCupom(null, {}), []);
  assert.equal(CI.compararComCupom(cupom, null)[0].encontrado, 0, "sem Cielo importada, encontrado = 0");
});
