/*
 * Extrato da conta PJ do Banco do Brasil (CSV exportado pelo BB): leitura no aparelho, data real da
 * transação (vem na descrição: o PIX de sábado é lançado na segunda), categoria e chave para não duplicar.
 * Funções puras, centavos inteiros. Saídas e saldos são ignorados. CPF/CNPJ de clientes NUNCA são guardados:
 * fica só se é pessoa física ou empresa e o nome abreviado.
 */
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica(require("./diamante.js"));
  else raiz.Banco = fabrica(raiz.Diamante);
})(typeof self !== "undefined" ? self : this, function (D) {
  "use strict";

  var CATEGORIAS = {
    repasse_cielo: "Repasse da Cielo",
    pix_maquininha: "PIX da maquininha",
    pix_terceiro: "PIX de cliente",
    outro: "Outra entrada"
  };

  function normal(t) {
    return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  // Linha de CSV separado por vírgula, com aspas (formato do BB)
  function dividir(linha) {
    var r = [], atual = "", aspas = false;
    for (var i = 0; i < linha.length; i++) {
      var c = linha[i];
      if (aspas) {
        if (c === '"' && linha[i + 1] === '"') { atual += '"'; i++; }
        else if (c === '"') aspas = false;
        else atual += c;
      } else if (c === '"') aspas = true;
      else if (c === "," || c === ";") { r.push(atual); atual = ""; }
      else atual += c;
    }
    r.push(atual);
    return r.map(function (x) { return x.trim(); });
  }

  // "6.543,21" / "-1.000,00" / "7,77" -> centavos
  function centavos(t) {
    var m = /^(-?)(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/.exec(String(t || "").trim());
    if (!m) return null;
    var v = parseInt(m[2].replace(/\./g, ""), 10) * 100 + parseInt(m[3], 10);
    return m[1] ? -v : v;
  }

  function soDigitos(t) { return String(t || "").replace(/\D/g, ""); }

  /*
   * Descrição "DD/MM HH:MM <CPF ou CNPJ> <NOME truncado>" -> { dia, mes, hora, documento, nome }.
   * O ano vem da data do lançamento (uma transação de dezembro lançada em janeiro é do ano anterior).
   */
  function lerDescricao(texto, dataLancamento) {
    var m = /^(\d{2})\/(\d{2})\s+(\d{2}:\d{2})\s*(?:(\d{14}|\d{11})(?!\d))?\s*(.*)$/.exec(String(texto || "").trim());
    if (!m) return null;
    var ano = +dataLancamento.slice(0, 4), mesLanc = +dataLancamento.slice(5, 7);
    if (+m[2] > mesLanc + 1) ano--;
    var data = ano + "-" + m[2] + "-" + m[1];
    if (data > dataLancamento) data = (ano - 1) + "-" + m[2] + "-" + m[1];
    return { data: data, hora: m[3], documento: m[4] || "", nome: m[5].replace(/\s+-\s*$/, "").trim() };
  }

  /*
   * Lê o CSV do extrato. cnpjLoja (só dígitos, opcional) separa o PIX da maquininha.
   * Devolve { lancamentos, ignorados: { saidas, saldos, outros: [{linha, motivo}] }, documentos, de, ate, erros }.
   * "documentos" = contagem por CPF/CNPJ de pagador (só em memória, para sugerir o CNPJ da loja; não é gravado).
   */
  function lerExtrato(texto, cnpjLoja) {
    var linhas = String(texto || "").replace(/\r/g, "").split("\n");
    var res = { lancamentos: [], ignorados: { saidas: 0, saldos: 0, outros: [] }, documentos: {}, de: "", ate: "", erros: [] };
    var cab = linhas.length ? dividir(linhas[0]).map(normal) : [];
    var idx = { data: cab.indexOf("data"), lanc: cab.indexOf("lancamento"), det: cab.indexOf("detalhes"),
      doc: cab.findIndex(function (c) { return /^n.? ?documento$/.test(c) || c === "numero documento"; }),
      valor: cab.indexOf("valor"), tipo: cab.indexOf("tipo lancamento") };
    if (idx.data < 0 || idx.lanc < 0 || idx.det < 0 || idx.valor < 0) {
      res.erros.push("Este arquivo não parece o extrato em CSV do Banco do Brasil (faltam as colunas Data, Lançamento, Detalhes e Valor).");
      return res;
    }
    var loja = soDigitos(cnpjLoja);
    for (var n = 1; n < linhas.length; n++) {
      if (!linhas[n].trim()) continue;
      var c = dividir(linhas[n]);
      var lanc = c[idx.lanc] || "";
      var nl = normal(lanc);
      if (/^saldo|^s a l d o/.test(nl)) { res.ignorados.saldos++; continue; }
      var dm = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(c[idx.data] || "");
      var valor = centavos(c[idx.valor]);
      if (!dm || valor == null) { res.ignorados.outros.push({ linha: n + 1, motivo: !dm ? "data inválida" : "valor inválido" }); continue; }
      var tipoLanc = idx.tipo >= 0 ? normal(c[idx.tipo]) : "";
      if (tipoLanc === "saida" || valor < 0 || /enviad|pagamento|tarifa|debito/.test(nl)) { res.ignorados.saidas++; continue; }
      if (valor === 0) { res.ignorados.outros.push({ linha: n + 1, motivo: "valor zero" }); continue; }
      var dataLanc = dm[3] + "-" + dm[2] + "-" + dm[1];
      var desc = lerDescricao(c[idx.det], dataLanc);
      var documento = desc ? desc.documento : "";
      var nome = desc ? desc.nome : String(c[idx.det] || "");
      var categoria = "outro", pagadorTipo = "";
      if (/cielo/i.test(nome)) categoria = "repasse_cielo";
      else if (loja && documento === loja) categoria = "pix_maquininha";
      else if (/pix/.test(nl) && documento) { categoria = "pix_terceiro"; pagadorTipo = documento.length === 11 ? "pf" : "pj"; }
      if (documento) res.documentos[documento] = (res.documentos[documento] || 0) + 1;
      var l = {
        data: desc ? desc.data : dataLanc,
        hora: desc ? desc.hora : null,
        data_lancamento: dataLanc,
        tipo: lanc.slice(0, 60),
        categoria: categoria,
        pagador_tipo: pagadorTipo,
        pagador: categoria === "pix_terceiro" || categoria === "outro" ? D.abreviarNome(nome).slice(0, 30) : "",
        documento: soDigitos(c[idx.doc] || "").slice(0, 30),
        valor_centavos: valor
      };
      l.chave = ["bb", l.documento, l.data_lancamento, l.valor_centavos, l.documento ? "" : l.data + " " + l.hora].join("|");
      res.lancamentos.push(l);
      if (!res.de || l.data < res.de) res.de = l.data;
      if (!res.ate || l.data > res.ate) res.ate = l.data;
    }
    return res;
  }

  /*
   * Sugere o CNPJ da loja: o CNPJ (14 dígitos) que mais aparece como pagador (o PIX da maquininha chega
   * no BB com o CNPJ da própria empresa, um por venda). Só sugere se aparecer bem mais que os outros.
   */
  function sugerirCnpjLoja(documentos) {
    var lista = Object.keys(documentos || {}).filter(function (d) { return d.length === 14; })
      .map(function (d) { return { doc: d, n: documentos[d] }; }).sort(function (a, b) { return b.n - a.n; });
    if (!lista.length || lista[0].n < 5) return null;
    if (lista[1] && lista[1].n * 3 > lista[0].n) return null;
    return lista[0].doc;
  }

  function somarPorCategoria(lancamentos, data) {
    var r = { repasse_cielo: 0, pix_maquininha: 0, pix_terceiro: 0, outro: 0, qtd: { repasse_cielo: 0, pix_maquininha: 0, pix_terceiro: 0, outro: 0 } };
    (lancamentos || []).forEach(function (l) {
      if (data && l.data !== data) return;
      r[l.categoria] += l.valor_centavos;
      r.qtd[l.categoria]++;
    });
    return r;
  }

  /*
   * PIX Delivery do dia: soma do esperado (vendas + recebimentos) dos cupons de todos os caixas
   * × PIX de clientes (pix_terceiro) no BB naquele dia. O BB não diz o caixa, por isso a conta é do dia.
   */
  function compararPixDelivery(cupons, lancamentos, data) {
    var esperado = (cupons || []).reduce(function (s, c) {
      var f = (c && c.formas && c.formas.pix_delivery) || {};
      return s + (f.vendas || 0) + (f.receb || 0);
    }, 0);
    var doDia = (lancamentos || []).filter(function (l) { return l.data === data && l.categoria === "pix_terceiro"; });
    var encontrado = doDia.reduce(function (s, l) { return s + l.valor_centavos; }, 0);
    var dif = encontrado - esperado;
    return { esperado: esperado, encontrado: encontrado, diferenca: dif, quantidade: doDia.length,
      situacao: dif === 0 ? "bateu" : dif > 0 ? "sobra" : "falta" };
  }

  // "12.345.678/0001-90" para mostrar o CNPJ escolhido na tela (não vai para o código)
  function formatarCnpj(d) {
    d = soDigitos(d);
    return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : d;
  }

  return {
    CATEGORIAS: CATEGORIAS,
    dividir: dividir,
    centavos: centavos,
    lerDescricao: lerDescricao,
    lerExtrato: lerExtrato,
    sugerirCnpjLoja: sugerirCnpjLoja,
    somarPorCategoria: somarPorCategoria,
    formatarCnpj: formatarCnpj,
    compararPixDelivery: compararPixDelivery
  };
});
