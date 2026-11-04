/*
 * CSV "Vendas ... detalhe" da Cielo: leitura (no aparelho), conferência do totalizador, chave para não
 * duplicar e caixa de cada venda (máquina padrão + troca no dia). Funções puras, centavos inteiros.
 * Só ficam os campos necessários: número do cartão, CPF e documentos NUNCA são lidos.
 */
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica(require("./diamante.js"));
  else raiz.Cielo = fabrica(raiz.Diamante);
})(typeof self !== "undefined" ? self : this, function (D) {
  "use strict";

  function normal(t) {
    return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  // Colunas que o sistema usa (pelo nome, em qualquer ordem). obrigatória = sem ela não importa.
  var COLUNAS = {
    data: { nomes: ["data da venda"], obrigatoria: true },
    hora: { nomes: ["hora da venda"], obrigatoria: true },
    forma: { nomes: ["forma de pagamento"], obrigatoria: true },
    valor: { nomes: ["valor bruto"], obrigatoria: true },
    status: { nomes: ["status da venda"], obrigatoria: true },
    maquina: { nomes: ["numero da maquina"], obrigatoria: true },
    nsu: { nomes: ["nsu/doc", "nsu"], obrigatoria: true },
    parcelas: { nomes: ["quantidade total de parcelas"] },
    bandeira: { nomes: ["bandeira"] },
    autorizacao: { nomes: ["codigo de autorizacao", "codigo da autorizacao"] },
    id_pix: { nomes: ["id pix"] },
    txid: { nomes: ["txid"] },
    pagador: { nomes: ["origem do valor", "de (origem do valor)"] }
  };

  // Bytes do arquivo -> texto. A Cielo exporta em Windows-1252; aceita UTF-8 também.
  function decodificar(bytes) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var utf8 = new TextDecoder("utf-8", { fatal: false }).decode(u8);
    if (utf8.indexOf("�") < 0) return utf8.replace(/^﻿/, "");
    return new TextDecoder("windows-1252").decode(u8);
  }

  // Divide uma linha de CSV com ";" (aceita campos entre aspas)
  function dividir(linha) {
    var r = [], atual = "", aspas = false;
    for (var i = 0; i < linha.length; i++) {
      var c = linha[i];
      if (aspas) {
        if (c === '"' && linha[i + 1] === '"') { atual += '"'; i++; }
        else if (c === '"') aspas = false;
        else atual += c;
      } else if (c === '"') aspas = true;
      else if (c === ";") { r.push(atual); atual = ""; }
      else atual += c;
    }
    r.push(atual);
    return r.map(function (x) { return x.trim(); });
  }

  // "4321,09" / "1.234,56" -> centavos
  function centavos(t) {
    t = String(t || "").trim();
    if (/^-?\d+,\d{1,2}$/.test(t) || /^-?\d{1,3}(\.\d{3})+,\d{1,2}$/.test(t)) {
      var neg = t.charAt(0) === "-";
      var p = t.replace(/^-/, "").replace(/\./g, "").split(",");
      var v = parseInt(p[0], 10) * 100 + parseInt((p[1] + "0").slice(0, 2), 10);
      return neg ? -v : v;
    }
    if (/^-?\d+$/.test(t)) return parseInt(t, 10) * 100;
    return null;
  }

  function formaDe(texto) {
    var t = normal(texto);
    if (t.indexOf("pix") >= 0) return "pix";
    if (t.indexOf("debito") >= 0) return "debito";
    if (t.indexOf("credito") >= 0) return "credito";
    return "outro";
  }

  // Chave única da venda (não duplica ao importar de novo)
  function chaveVenda(v) {
    if (v.forma === "pix" && (v.txid || v.id_pix)) return "pix|" + (v.txid || v.id_pix);
    return ["cartao", v.maquina, v.data, v.nsu, v.autorizacao || "", v.valor_centavos].join("|");
  }

  /*
   * Lê o texto do CSV. Devolve:
   * { vendas: [...], ignoradas: [{ linha, motivo }], totalizador: { quantidade, valor } | null,
   *   erros: [texto], de, ate }
   */
  function lerCsv(texto) {
    var linhas = String(texto || "").replace(/\r/g, "").split("\n");
    var res = { vendas: [], ignoradas: [], totalizador: null, erros: [], de: "", ate: "" };
    var iCab = -1;
    for (var i = 0; i < linhas.length; i++) {
      var celulas = dividir(linhas[i]).map(normal);
      if (celulas.indexOf("data da venda") >= 0 && celulas.indexOf("valor bruto") >= 0) { iCab = i; break; }
      // "Totalizador" -> linha de títulos -> linha de valores
      if (normal(linhas[i]) === "totalizador" && linhas[i + 2] != null) {
        var t = dividir(linhas[i + 2]);
        var q = parseInt(t[0], 10), v = centavos(t[1]);
        if (!isNaN(q) && v != null) res.totalizador = { quantidade: q, valor: v };
      }
    }
    if (iCab < 0) {
      res.erros.push("Não encontrei a tabela de vendas (a linha que começa com \"Data da venda\"). Confira se é o relatório de vendas detalhado da Cielo.");
      return res;
    }
    var cab = dividir(linhas[iCab]).map(normal);
    var idx = {};
    Object.keys(COLUNAS).forEach(function (k) {
      idx[k] = -1;
      COLUNAS[k].nomes.some(function (n) { var j = cab.indexOf(n); if (j >= 0) { idx[k] = j; return true; } return false; });
    });
    var faltam = Object.keys(COLUNAS).filter(function (k) { return COLUNAS[k].obrigatoria && idx[k] < 0; });
    if (faltam.length) {
      res.erros.push("Faltam colunas no arquivo: " + faltam.map(function (k) { return COLUNAS[k].nomes[0]; }).join(", ") +
        ". Marque essas colunas ao exportar da Cielo.");
      return res;
    }
    function campo(cols, k) { return idx[k] >= 0 ? (cols[idx[k]] || "").trim() : ""; }
    for (var n = iCab + 1; n < linhas.length; n++) {
      if (!linhas[n].trim()) continue;
      var cols = dividir(linhas[n]);
      var dataBr = campo(cols, "data");
      var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dataBr);
      var hora = campo(cols, "hora");
      var valor = centavos(campo(cols, "valor"));
      var maquina = campo(cols, "maquina").replace(/\D/g, "");
      if (!m || !/^\d{2}:\d{2}(:\d{2})?$/.test(hora) || valor == null || valor <= 0 || !maquina) {
        res.ignoradas.push({ linha: n + 1, motivo: !m ? "data inválida" : valor == null || valor <= 0 ? "valor inválido" : !maquina ? "sem número da máquina" : "hora inválida" });
        continue;
      }
      var status = campo(cols, "status");
      var formaOriginal = campo(cols, "forma");
      var parc = parseInt(campo(cols, "parcelas"), 10);
      var venda = {
        data: m[3] + "-" + m[2] + "-" + m[1],
        hora: hora.slice(0, 5),
        forma: formaDe(formaOriginal),
        forma_original: formaOriginal.slice(0, 60),
        parcelas: parc > 0 && parc < 100 ? parc : 1,
        bandeira: campo(cols, "bandeira").slice(0, 40),
        valor_centavos: valor,
        aprovada: normal(status) === "aprovada",
        status: status.slice(0, 40),
        maquina: maquina.slice(0, 20),
        nsu: campo(cols, "nsu").replace(/\s/g, "").slice(0, 30),
        autorizacao: campo(cols, "autorizacao").replace(/\s/g, "").slice(0, 20),
        id_pix: campo(cols, "id_pix").slice(0, 60),
        txid: campo(cols, "txid").slice(0, 60),
        pagador: D.abreviarNome(campo(cols, "pagador"))
      };
      if (venda.forma !== "pix") venda.pagador = "";
      venda.chave = chaveVenda(venda);
      res.vendas.push(venda);
      if (!res.de || venda.data < res.de) res.de = venda.data;
      if (!res.ate || venda.data > res.ate) res.ate = venda.data;
    }
    return res;
  }

  // Confere o totalizador da Cielo (todas as vendas, de qualquer status) com o que foi lido
  function conferirTotalizador(r) {
    if (!r.totalizador) return { ok: null, texto: "O arquivo não tem o totalizador da Cielo para conferir." };
    var q = r.vendas.length, v = r.vendas.reduce(function (s, x) { return s + x.valor_centavos; }, 0);
    var ok = q === r.totalizador.quantidade && v === r.totalizador.valor;
    return {
      ok: ok, quantidade: q, valor: v,
      texto: ok ? "Confere com o totalizador da Cielo: " + q + " vendas."
        : "Não confere com o totalizador da Cielo: lidas " + q + " vendas, a Cielo diz " + r.totalizador.quantidade +
          (v !== r.totalizador.valor ? " (valores diferentes)" : "") + "."
    };
  }

  function minutos(h) {
    var m = /^(\d{1,2}):(\d{2})/.exec(String(h || ""));
    return m ? +m[1] * 60 + +m[2] : null;
  }

  /*
   * Caixa de uma venda: troca do dia (com horário, se tiver) ou o caixa padrão da máquina.
   * maquinas = [{ numero, caixa }]; trocas = [{ data, maquina, caixa, hora_de, hora_ate }]
   */
  function caixaDaVenda(venda, maquinas, trocas) {
    var hv = minutos(venda.hora);
    var t = (trocas || []).filter(function (x) {
      if (x.maquina !== venda.maquina || x.data !== venda.data) return false;
      var de = minutos(x.hora_de), ate = minutos(x.hora_ate);
      return (de == null || hv >= de) && (ate == null || hv <= ate);
    });
    // a troca com horário vale mais que a do dia inteiro
    t.sort(function (a, b) { return (b.hora_de || b.hora_ate ? 1 : 0) - (a.hora_de || a.hora_ate ? 1 : 0); });
    if (t.length) return t[0].caixa;
    var m = (maquinas || []).filter(function (x) { return x.numero === venda.maquina; })[0];
    return m && m.caixa ? m.caixa : null;
  }

  // Soma por forma (só aprovadas) das vendas de um caixa e dia
  function somarPorForma(vendas, caixa, data, maquinas, trocas) {
    var r = { debito: 0, credito: 0, pix: 0, outro: 0, quantidade: 0, nao_aprovadas: 0 };
    (vendas || []).forEach(function (v) {
      if (v.data !== data || caixaDaVenda(v, maquinas, trocas) !== caixa) return;
      if (!v.aprovada) { r.nao_aprovadas++; return; }
      r[v.forma] = (r[v.forma] || 0) + v.valor_centavos;
      r.quantidade++;
    });
    return r;
  }

  // Resumo por máquina e forma (prévia da importação)
  function resumoPorMaquina(vendas) {
    var mapa = {};
    (vendas || []).forEach(function (v) {
      var m = mapa[v.maquina] || (mapa[v.maquina] = { maquina: v.maquina, debito: 0, credito: 0, pix: 0, outro: 0, quantidade: 0, nao_aprovadas: 0, valor_nao_aprovado: 0 });
      if (!v.aprovada) { m.nao_aprovadas++; m.valor_nao_aprovado += v.valor_centavos; return; }
      m[v.forma] += v.valor_centavos;
      m.quantidade++;
    });
    return Object.keys(mapa).sort().map(function (k) { return mapa[k]; });
  }

  /*
   * Compara o esperado do cupom (vendas + recebimentos) com o que a Cielo mostra no caixa e dia.
   * Devolve linhas { forma, nome, esperado, encontrado, diferenca, situacao } com situacao
   * "bateu" | "sobra" (Cielo tem mais) | "falta" (Cielo tem menos).
   */
  function compararComCupom(cupom, soma) {
    if (!cupom || !cupom.formas) return [];
    var e = D.esperadoPorForma(cupom);
    return [["debito", "Cartão débito"], ["credito", "Cartão crédito"], ["pix", "PIX (maquininha)"]].map(function (f) {
      var encontrado = (soma && soma[f[0]]) || 0;
      var dif = encontrado - e[f[0]];
      return { forma: f[0], nome: f[1], esperado: e[f[0]], encontrado: encontrado, diferenca: dif,
        situacao: dif === 0 ? "bateu" : dif > 0 ? "sobra" : "falta" };
    });
  }

  // "00012345" -> "final 2345" (para mostrar sem expor o número inteiro)
  function finalMaquina(numero) {
    var n = String(numero || "");
    return n.length > 4 ? "final " + n.slice(-4) : n;
  }

  return {
    decodificar: decodificar,
    dividir: dividir,
    centavos: centavos,
    formaDe: formaDe,
    chaveVenda: chaveVenda,
    lerCsv: lerCsv,
    conferirTotalizador: conferirTotalizador,
    caixaDaVenda: caixaDaVenda,
    somarPorForma: somarPorForma,
    resumoPorMaquina: resumoPorMaquina,
    finalMaquina: finalMaquina,
    compararComCupom: compararComCupom
  };
});
