/*
 * Conciliação de cartões: relatório "Recebíveis Detalhado - Lançamentos" da Cielo (CSV), taxas do contrato,
 * prazo de pagamento, vendas sem pagamento e repasse no Banco do Brasil. Funções puras, centavos inteiros.
 * Taxas em CENTÉSIMOS de ponto percentual (1,23% = 123): na tela sempre "1,23%".
 * Do CSV só ficam os campos necessários (sem número de cartão, banco, agência, conta ou documentos).
 */
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica(require("./cielo.js"), require("./feriados.js"));
  else raiz.Recebiveis = fabrica(raiz.Cielo, raiz.Feriados);
})(typeof self !== "undefined" ? self : this, function (CI, FER) {
  "use strict";

  function normal(t) {
    return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  }
  function dataIso(br) {
    var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(br || "").trim());
    return m ? m[3] + "-" + m[2] + "-" + m[1] : "";
  }
  function centavos(t) {
    t = String(t || "").trim();
    if (!t) return 0;
    var v = CI.centavos(t);
    return v == null ? null : v;
  }

  /* ------------------------------ Taxas ------------------------------ */

  // "1,23%" / "1,23" / "12,61 %" -> 123 ; inválido -> null
  function lerTaxa(texto) {
    var m = /^\s*(\d{1,2})(?:[,.](\d{1,2}))?\s*%?\s*$/.exec(String(texto || ""));
    if (!m) return null;
    return +m[1] * 100 + (m[2] ? +(m[2] + "0").slice(0, 2) : 0);
  }
  // 123 -> "1,23%"
  function mostrarTaxa(t) {
    if (t == null || isNaN(t)) return "—";
    var neg = t < 0; t = Math.abs(Math.round(t));
    return (neg ? "-" : "") + Math.floor(t / 100) + "," + String(t % 100).padStart(2, "0") + "%";
  }
  // Taxa efetiva (cobrada/bruto) em centésimos de %, com 2 casas a mais para mostrar: 1,234% -> "1,234%"
  function mostrarTaxaEfetiva(taxaCentavos, brutoCentavos) {
    if (!brutoCentavos) return "—";
    return (100 * taxaCentavos / brutoCentavos).toFixed(3).replace(".", ",") + "%";
  }

  function bandeiraNormal(b) {
    var n = normal(b);
    if (/master/.test(n)) return "mastercard";
    if (/visa/.test(n)) return "visa";
    if (/elo/.test(n)) return "elo";
    if (/amex|american/.test(n)) return "amex";
    if (/diners/.test(n)) return "diners";
    if (/hiper/.test(n)) return "hipercard";
    if (/pix/.test(n)) return "pix";
    return n;
  }

  /*
   * Modalidade de uma linha: { modalidade: "debito" | "credito" | "parcelado" | "pix" | "outro", parcelas }
   * "Crédito parcelado loja 01/03" -> parcelado, 3
   */
  function modalidade(formaOriginal, parcelasColuna) {
    var f = normal(formaOriginal);
    var m = /(\d{1,2})\s*\/\s*(\d{1,2})/.exec(f);
    var parcelas = m ? +m[2] : (+parcelasColuna || 1);
    if (/pix/.test(f)) return { modalidade: "pix", parcelas: 1 };
    if (/parcelad/.test(f)) return { modalidade: "parcelado", parcelas: Math.max(parcelas, 2) };
    if (/debito/.test(f)) return { modalidade: "debito", parcelas: 1 };
    if (/credito/.test(f)) return { modalidade: "credito", parcelas: 1 };
    return { modalidade: "outro", parcelas: 1 };
  }

  /*
   * Taxa contratada. taxas = [{ modalidade, bandeira ("visa", ..., "*" = todas), parcelas, taxa, prazo_dias_uteis }]
   * Devolve a linha da tabela ou null.
   */
  function taxaContratada(taxas, mod, bandeira, parcelas) {
    var b = mod === "pix" ? "pix" : bandeiraNormal(bandeira);
    var p = mod === "parcelado" ? parcelas : 1;
    var lista = (taxas || []).filter(function (t) { return t.modalidade === mod && (+t.parcelas || 1) === p; });
    return lista.filter(function (t) { return bandeiraNormal(t.bandeira) === b; })[0] ||
      lista.filter(function (t) { return t.bandeira === "*" || t.bandeira === "" || t.bandeira == null; })[0] || null;
  }

  // Taxa em centavos para um valor (a Cielo arredonda por lançamento)
  function valorTaxa(brutoCentavos, taxa) { return Math.round(brutoCentavos * taxa / 10000); }

  /* ------------------------------ Leitura ------------------------------ */

  var COLUNAS = {
    data_pagamento: { nomes: ["data de pagamento"], obrigatoria: true },
    valor_bruto: { nomes: ["valor bruto"], obrigatoria: true },
    valor_taxa: { nomes: ["valor taxa/tarifa", "taxa/tarifa"], obrigatoria: true },
    valor_liquido: { nomes: ["valor liquido"], obrigatoria: true },
    forma: { nomes: ["forma de pagamento"], obrigatoria: true },
    tipo: { nomes: ["tipo de lancamento"], obrigatoria: true },
    data_venda: { nomes: ["data da venda"] },
    bandeira: { nomes: ["bandeira"] },
    status: { nomes: ["status de pagamento"] },
    nsu: { nomes: ["nsu/doc", "nsu"] },
    autorizacao: { nomes: ["codigo de autorizacao", "codigo da autorizacao"] },
    txid: { nomes: ["txid"] },
    parcela: { nomes: ["numero da parcela"] },
    data_prevista: { nomes: ["data prevista do pagamento", "data prevista de pagamento"] },
    hora_venda: { nomes: ["hora da venda"] },
    parcelas: { nomes: ["quantidade total de parcelas"] },
    maquina: { nomes: ["numero da maquina"] },
    descricao: { nomes: ["descricao"] }
  };

  /*
   * Lê o CSV de recebíveis. Devolve { lancamentos, totalizador, ignoradas, erros, de, ate }.
   * lancamentos: { chave, data_pagamento, data_prevista, data_venda, hora_venda, tipo, forma_original, modalidade,
   *   parcela, parcelas, bandeira, valor_bruto, taxa (positiva = cobrada), valor_liquido, status, nsu, autorizacao, txid, maquina, descricao }
   */
  function lerCsv(texto) {
    var linhas = String(texto || "").replace(/\r/g, "").split("\n");
    var res = { lancamentos: [], totalizador: null, ignoradas: [], erros: [], de: "", ate: "" };
    var iCab = -1;
    for (var i = 0; i < linhas.length; i++) {
      var cel = CI.dividir(linhas[i]).map(normal);
      if (cel.indexOf("data de pagamento") >= 0 && cel.indexOf("valor bruto") >= 0) { iCab = i; break; }
      if (normal(linhas[i]) === "totalizador" && linhas[i + 2] != null) {
        var t = CI.dividir(linhas[i + 2]);
        if (/^\d+$/.test(t[0] || "") && centavos(t[1]) != null) {
          res.totalizador = { quantidade: +t[0], bruto: centavos(t[1]), taxa: -(centavos(t[2]) || 0), liquido: centavos(t[3]) };
        }
      }
    }
    if (iCab < 0) {
      res.erros.push("Não encontrei a tabela de lançamentos (linha com \"Data de pagamento\" e \"Valor bruto\"). Confira se é o relatório de Recebíveis detalhado da Cielo.");
      return res;
    }
    var cab = CI.dividir(linhas[iCab]).map(normal);
    var idx = {};
    Object.keys(COLUNAS).forEach(function (k) {
      idx[k] = -1;
      COLUNAS[k].nomes.some(function (n) { var j = cab.indexOf(n); if (j >= 0) { idx[k] = j; return true; } return false; });
    });
    var faltam = Object.keys(COLUNAS).filter(function (k) { return COLUNAS[k].obrigatoria && idx[k] < 0; });
    if (faltam.length) {
      res.erros.push("Faltam colunas no arquivo: " + faltam.map(function (k) { return COLUNAS[k].nomes[0]; }).join(", ") + ".");
      return res;
    }
    function campo(c, k) { return idx[k] >= 0 ? String(c[idx[k]] || "").trim() : ""; }
    for (var n = iCab + 1; n < linhas.length; n++) {
      if (!linhas[n].trim()) continue;
      var c = CI.dividir(linhas[n]);
      var dp = dataIso(campo(c, "data_pagamento"));
      var bruto = centavos(campo(c, "valor_bruto")), taxa = centavos(campo(c, "valor_taxa")), liq = centavos(campo(c, "valor_liquido"));
      if (!dp || bruto == null || taxa == null || liq == null) {
        res.ignoradas.push({ linha: n + 1, motivo: !dp ? "data de pagamento inválida" : "valor inválido" });
        continue;
      }
      var formaOriginal = campo(c, "forma");
      var mod = modalidade(formaOriginal, campo(c, "parcelas"));
      var l = {
        data_pagamento: dp,
        data_prevista: dataIso(campo(c, "data_prevista")) || null,
        data_venda: dataIso(campo(c, "data_venda")) || null,
        hora_venda: (/^\d{2}:\d{2}/.exec(campo(c, "hora_venda")) || [null])[0],
        tipo: campo(c, "tipo").slice(0, 60),
        forma_original: formaOriginal.slice(0, 60),
        modalidade: mod.modalidade,
        parcela: Math.max(parseInt(campo(c, "parcela"), 10) || 0, 0),
        parcelas: mod.parcelas,
        bandeira: campo(c, "bandeira").slice(0, 40),
        valor_bruto: bruto,
        taxa: -taxa,
        valor_liquido: liq,
        status: campo(c, "status").slice(0, 40),
        nsu: campo(c, "nsu").replace(/\s/g, "").slice(0, 30),
        autorizacao: campo(c, "autorizacao").replace(/\s/g, "").slice(0, 20),
        txid: campo(c, "txid").slice(0, 60),
        maquina: campo(c, "maquina").replace(/\D/g, "").slice(0, 20),
        descricao: campo(c, "descricao").slice(0, 120)
      };
      l.chave = ["rec", l.data_pagamento, l.tipo, l.txid || l.nsu, l.autorizacao, l.parcela, l.valor_bruto].join("|");
      res.lancamentos.push(l);
      if (!res.de || dp < res.de) res.de = dp;
      if (!res.ate || dp > res.ate) res.ate = dp;
    }
    return res;
  }

  function conferirTotalizador(r) {
    if (!r.totalizador) return { ok: null, texto: "O arquivo não tem o totalizador da Cielo para conferir." };
    var s = r.lancamentos.reduce(function (a, l) { a.b += l.valor_bruto; a.t += l.taxa; a.l += l.valor_liquido; return a; }, { b: 0, t: 0, l: 0 });
    var T = r.totalizador;
    var ok = r.lancamentos.length === T.quantidade && s.b === T.bruto && s.t === T.taxa && s.l === T.liquido;
    return { ok: ok, texto: ok ? "Confere com o totalizador da Cielo: " + T.quantidade + " lançamentos."
      : "Não confere com o totalizador da Cielo (lidos " + r.lancamentos.length + ", a Cielo diz " + T.quantidade + ")." };
  }

  /* ------------------------------ Conferência ------------------------------ */

  /*
   * Confere a taxa e o prazo de um lançamento.
   * Devolve { taxaContrato, taxaEsperada (centavos), diferenca (cobrada − esperada), situacao, prazoEsperado, atraso (dias úteis) }
   * situacao: "ok" | "taxa_maior" | "taxa_menor" | "sem_taxa" (taxa não cadastrada) | "outro" (não é venda: aluguel, ajuste...)
   */
  function conferirLancamento(l, taxas, extras) {
    var r = { taxaContrato: null, taxaEsperada: null, diferenca: 0, situacao: "outro", prazoEsperado: null, atraso: 0 };
    if (l.modalidade === "outro" || l.valor_bruto <= 0) return r;
    var t = taxaContratada(taxas, l.modalidade, l.bandeira, l.parcelas);
    if (!t) { r.situacao = "sem_taxa"; return r; }
    r.taxaContrato = t.taxa;
    r.taxaEsperada = valorTaxa(l.valor_bruto, t.taxa);
    r.diferenca = l.taxa - r.taxaEsperada;
    r.situacao = Math.abs(r.diferenca) <= 1 ? "ok" : r.diferenca > 0 ? "taxa_maior" : "taxa_menor";
    if (l.data_venda) {
      r.prazoEsperado = FER.diaUtil(l.data_venda, +t.prazo_dias_uteis || 0, extras);
      r.atraso = Math.max(0, FER.diasUteisEntre(r.prazoEsperado, l.data_pagamento, extras));
    }
    return r;
  }

  // Chave que liga o lançamento à venda (cielo_vendas): PIX pelo TxID, cartão por data + NSU + autorização
  function chaveVenda(x, ehVenda) {
    var pix = ehVenda ? x.forma === "pix" : x.modalidade === "pix";
    if (pix) return x.txid ? "pix|" + x.txid : null;
    var data = ehVenda ? x.data : x.data_venda;
    return data && x.nsu ? ["cartao", data, x.nsu.replace(/^0+/, ""), (x.autorizacao || "").replace(/^0+/, "")].join("|") : null;
  }

  /*
   * Vendas aprovadas da Cielo (cielo_vendas) sem pagamento nos recebíveis, cujo prazo já passou até "hoje".
   * Só cobra as vendas cujo prazo cai DENTRO do período coberto pelos recebíveis importados
   * (cobertura = { de, ate } das datas de pagamento; se não vier, usa a menor e a maior dos lançamentos).
   * Parcelado: conta as parcelas pagas. Devolve [{ venda, prazo, pagas, parcelas }]
   */
  function vendasSemPagamento(vendas, lancamentos, taxas, hoje, extras, cobertura) {
    if (!cobertura) {
      cobertura = { de: "", ate: "" };
      (lancamentos || []).forEach(function (l) {
        if (!cobertura.de || l.data_pagamento < cobertura.de) cobertura.de = l.data_pagamento;
        if (!cobertura.ate || l.data_pagamento > cobertura.ate) cobertura.ate = l.data_pagamento;
      });
    }
    if (!cobertura.de) return [];
    var pagas = {};
    (lancamentos || []).forEach(function (l) {
      var k = chaveVenda(l, false);
      if (k) pagas[k] = (pagas[k] || 0) + 1;
    });
    var r = [];
    (vendas || []).forEach(function (v) {
      if (!v.aprovada || v.forma === "outro") return;
      var mod = v.forma === "pix" ? "pix" : v.forma === "debito" ? "debito" : (v.parcelas > 1 ? "parcelado" : "credito");
      var t = taxaContratada(taxas, mod, v.bandeira, v.parcelas);
      var prazo = FER.diaUtil(v.data, t ? +t.prazo_dias_uteis || 0 : 1, extras);
      if (prazo > hoje || prazo < cobertura.de || prazo > cobertura.ate) return;
      var k = chaveVenda(v, true);
      var n = k ? pagas[k] || 0 : 0;
      var esperadas = mod === "parcelado" ? v.parcelas : 1;
      if (n < esperadas) r.push({ venda: v, prazo: prazo, pagas: n, parcelas: esperadas });
    });
    return r;
  }

  /*
   * Repasse no BB por dia de pagamento: líquido dos cartões (sem PIX, que cai um por venda) × PIX "CIELO S.A".
   * Devolve [{ data, esperado, recebido, diferenca, situacao }]
   */
  function repassePorDia(lancamentos, bancoLanc) {
    var dias = {};
    (lancamentos || []).forEach(function (l) {
      if (l.modalidade === "pix") return;
      var d = dias[l.data_pagamento] || (dias[l.data_pagamento] = { data: l.data_pagamento, esperado: 0, recebido: 0 });
      d.esperado += l.valor_liquido;
    });
    (bancoLanc || []).forEach(function (b) {
      if (b.categoria !== "repasse_cielo" || !dias[b.data]) return;
      dias[b.data].recebido += b.valor_centavos;
    });
    return Object.keys(dias).sort().map(function (k) {
      var d = dias[k];
      d.diferenca = d.recebido - d.esperado;
      d.situacao = !d.recebido ? "sem_extrato" : d.diferenca === 0 ? "bateu" : d.diferenca > 0 ? "sobra" : "falta";
      return d;
    });
  }

  // Totais (bruto, taxa, líquido, taxa esperada) por modalidade de um conjunto de lançamentos
  function resumo(lancamentos, taxas, extras) {
    var r = { total: { bruto: 0, taxa: 0, liquido: 0, esperada: 0, qtd: 0 }, por: {}, alertas: [] };
    (lancamentos || []).forEach(function (l) {
      var c = conferirLancamento(l, taxas, extras);
      var m = r.por[l.modalidade] || (r.por[l.modalidade] = { bruto: 0, taxa: 0, liquido: 0, esperada: 0, qtd: 0 });
      [m, r.total].forEach(function (x) {
        x.bruto += l.valor_bruto; x.taxa += l.taxa; x.liquido += l.valor_liquido; x.qtd++;
        x.esperada += c.taxaEsperada == null ? l.taxa : c.taxaEsperada;
      });
      if (c.situacao === "taxa_maior" || c.situacao === "sem_taxa" || c.atraso > 0 || (c.situacao === "outro" && l.valor_bruto < 0)) {
        r.alertas.push({ lancamento: l, conferencia: c });
      }
    });
    return r;
  }

  return {
    lerTaxa: lerTaxa, mostrarTaxa: mostrarTaxa, mostrarTaxaEfetiva: mostrarTaxaEfetiva, bandeiraNormal: bandeiraNormal,
    modalidade: modalidade, taxaContratada: taxaContratada, valorTaxa: valorTaxa,
    lerCsv: lerCsv, conferirTotalizador: conferirTotalizador, conferirLancamento: conferirLancamento,
    chaveVenda: chaveVenda, vendasSemPagamento: vendasSemPagamento, repassePorDia: repassePorDia, resumo: resumo
  };
});
