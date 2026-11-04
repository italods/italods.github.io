/*
 * Cupom "Fechamento de turno" do ERP Diamante: leitura do texto (PDF ou colado), conferência das
 * somas e o esperado de cada forma de pagamento. Funções puras (navegador e Node), centavos inteiros.
 */
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica();
  else raiz.Diamante = fabrica();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Formas do cupom, na ordem em que aparecem. "chave" é o nome guardado no banco.
  var FORMAS = [
    { chave: "dinheiro", nome: "Dinheiro", curto: "Dinheiro", cupom: "DINHEIRO" },
    { chave: "carteira", nome: "Carteira (fiado)", curto: "Carteira", cupom: "CARTEIRA" },
    { chave: "credito", nome: "Cartão crédito", curto: "Crédito", cupom: "CARTAO CREDITO" },
    { chave: "debito", nome: "Cartão débito", curto: "Débito", cupom: "CARTAO DEBITO" },
    { chave: "pix", nome: "PIX (maquininha)", curto: "PIX", cupom: "PIX" },
    { chave: "pix_delivery", nome: "PIX Delivery", curto: "PIX Delivery", cupom: "PIX DELIVERY" }
  ];
  var POR_CUPOM = {};
  FORMAS.forEach(function (f) { POR_CUPOM[f.cupom] = f.chave; });
  // PIX DELIVERY antes de PIX, para o PIX não "engolir" o DELIVERY
  var RE_FORMA = "(DINHEIRO|CARTEIRA|CARTAO CREDITO|CARTAO DEBITO|PIX DELIVERY|PIX)";
  var RE_VALOR = "(-?\\d{1,3}(?:\\.\\d{3})*,\\d{2})";

  // "1.234,56" -> 123456 ; "-1.500,00" -> -150000
  function centavos(texto) {
    var m = /^(-?)(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/.exec(String(texto || "").trim());
    if (!m) return null;
    var v = parseInt(m[2].replace(/\./g, ""), 10) * 100 + parseInt(m[3], 10);
    return m[1] ? -v : v;
  }

  function semAcento(t) {
    return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  var PARTICULAS = { DA: 1, DE: 1, DI: 1, DO: 1, DU: 1, DAS: 1, DOS: 1, E: 1 };
  // "MARIA APARECIDA DE CARVALHO" -> "MARIA A." ; "IRINEU" -> "IRINEU". Sem apelidos entre parênteses.
  function abreviarNome(nome) {
    var partes = String(nome || "").replace(/\(.*?\)/g, " ").replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return "";
    var primeiro = partes[0].toUpperCase().slice(0, 20);
    var resto = partes.slice(1).filter(function (p) { return !PARTICULAS[p.toUpperCase()]; });
    return resto.length ? primeiro + " " + resto[0].charAt(0).toUpperCase() + "." : primeiro;
  }

  function cupomVazio() {
    var formas = {};
    FORMAS.forEach(function (f) { formas[f.chave] = { vendas: 0, receb: 0 }; });
    return {
      terminal: "", data: "", turno: "", operador: "", abertura: "", encerramento: "",
      formas: formas, venda_bruta: 0, fundo: 0, sangria: 0, recebimento: 0, total_liquido: 0,
      cancelamentos: 0, desconto: 0, acrescimos: 0, recebimentos: [], sangrias: [], origem: "digitado"
    };
  }

  // Junta pedaços de texto que vieram em linhas separadas e tira espaços repetidos
  function linhasDoTexto(texto) {
    return String(texto || "").replace(/\r/g, "").split("\n").map(function (l) {
      return semAcento(l).replace(/\s+/g, " ").trim().toUpperCase();
    }).filter(Boolean);
  }

  /*
   * Lê o texto do cupom. Devolve { cupom, erros: [texto] }.
   * erros vazio = leu o essencial (terminal, data e as formas de pagamento).
   */
  function lerCupom(texto) {
    var c = cupomVazio();
    c.origem = "pdf";
    var erros = [];
    var linhas = linhasDoTexto(texto);
    if (!linhas.some(function (l) { return l.indexOf("FECHAMENTO DE TURNO") >= 0; })) {
      return { cupom: null, erros: ["Este arquivo não parece um cupom de \"Fechamento de turno\" do Diamante."] };
    }
    var secao = "";
    var achouForma = {};
    var reCampo = /^([A-Z .]+?)\s*\.*\s*:\s*(.*)$/;
    var reForma = new RegExp("^" + RE_FORMA + " " + RE_VALOR + " " + RE_VALOR + "$");
    var reReceb = new RegExp("^" + RE_FORMA + " " + RE_VALOR + " (\\d{1,8}) - (.+)$");
    var reSangria = new RegExp("^" + RE_FORMA + " " + RE_VALOR + "$");
    var reResumo = new RegExp("^(VENDA BRUTA|FUNDO DE CAIXA|SANGRIA|RECEBIMENTO|TOTAL ENTRADAS|TOTAL SAIDAS|TOTAL CAIXA|TOTAL LIQUIDO|CANCELAMENTOS ITEM|DESCONTO|ACRESCIMOS)\\s*:?\\s*" + RE_VALOR + "$");
    var totais = {};
    linhas.forEach(function (l) {
      if (/RESUMO DE FORMAS/.test(l)) { secao = "formas"; return; }
      if (/RESUMO DO CAIXA/.test(l)) { secao = "caixa"; return; }
      if (/\*+ *RECEBIMENTOS/.test(l)) { secao = "receb"; return; }
      if (/\*+ *S A N G R I A S|\*+ *SANGRIAS/.test(l)) { secao = "sangrias"; return; }
      var m;
      if (secao === "receb" && (m = reReceb.exec(l))) {
        c.recebimentos.push({ forma: POR_CUPOM[m[1]], valor: centavos(m[2]), codigo: m[3], nome: abreviarNome(m[4]) });
        return;
      }
      if (secao === "sangrias" && (m = reSangria.exec(l))) {
        c.sangrias.push(Math.abs(centavos(m[2])));
        return;
      }
      if ((m = reForma.exec(l)) && secao !== "receb") {
        var ch = POR_CUPOM[m[1]];
        c.formas[ch] = { vendas: centavos(m[2]), receb: centavos(m[3]) };
        achouForma[ch] = true;
        return;
      }
      if ((m = reResumo.exec(l))) { totais[m[1]] = centavos(m[2]); return; }
      if ((m = reCampo.exec(l))) {
        var nome = m[1].replace(/\.+$/, "").replace(/\s+/g, " ").trim();
        var valor = m[2].trim();
        if (/^TERMINAL$/.test(nome)) c.terminal = valor.replace(/\D/g, "");
        else if (/^DATA MOV$/.test(nome)) {
          var d = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(valor);
          if (d) c.data = d[3] + "-" + d[2] + "-" + d[1];
        } else if (/^HORA ABERTURA$/.test(nome)) c.abertura = valor.slice(0, 8);
        else if (/^HORA ENC$/.test(nome)) c.encerramento = valor.slice(0, 8);
        else if (/^TURNO/.test(nome)) c.turno = valor.replace(/\s+/g, "");
        else if (/^OPERADOR$/.test(nome)) c.operador = valor.replace(/^\d+\s*-\s*/, "").slice(0, 80);
      }
    });
    var mapa = { "VENDA BRUTA": "venda_bruta", "FUNDO DE CAIXA": "fundo", "RECEBIMENTO": "recebimento",
      "TOTAL LIQUIDO": "total_liquido", "CANCELAMENTOS ITEM": "cancelamentos", "DESCONTO": "desconto", "ACRESCIMOS": "acrescimos" };
    Object.keys(mapa).forEach(function (k) { if (totais[k] != null) c[mapa[k]] = totais[k]; });
    if (totais.SANGRIA != null) c.sangria = Math.abs(totais.SANGRIA);
    if (!c.terminal) erros.push("Não encontrei o número do terminal.");
    if (!c.data) erros.push("Não encontrei a data do movimento.");
    var faltando = FORMAS.filter(function (f) { return !achouForma[f.chave]; }).map(function (f) { return f.nome; });
    if (faltando.length === FORMAS.length) erros.push("Não encontrei o resumo das formas de pagamento.");
    else if (faltando.length) erros.push("Faltou no cupom: " + faltando.join(", ") + ".");
    if (totais["TOTAL LIQUIDO"] == null) erros.push("Não encontrei o total líquido.");
    return { cupom: c, erros: erros };
  }

  function somaFormas(c, campo) {
    return FORMAS.reduce(function (s, f) { return s + ((c.formas[f.chave] || {})[campo] || 0); }, 0);
  }

  // Dinheiro esperado na gaveta, pela fórmula do Diamante
  function liquidoCalculado(c) {
    var d = c.formas.dinheiro || {};
    return (d.vendas || 0) + (d.receb || 0) + (c.fundo || 0) - (c.sangria || 0);
  }

  function brl(v) {
    return (v / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  /*
   * Confere as somas do cupom (pega erro de digitação ou de leitura).
   * Devolve [{ nivel: "erro" | "aviso", texto }]. Vazio = tudo bate.
   */
  function conferirCupom(c) {
    var r = [];
    function dif(nome, a, b, nivel) {
      if (a !== b) r.push({ nivel: nivel || "erro", texto: nome + ": " + brl(a) + " ≠ " + brl(b) + " (diferença " + brl(a - b) + ")." });
    }
    dif("Soma das vendas por forma × venda bruta", somaFormas(c, "vendas"), c.venda_bruta);
    dif("Soma dos recebimentos por forma × recebimento", somaFormas(c, "receb"), c.recebimento);
    dif("Total líquido calculado (dinheiro vendas + recebimentos + fundo − sangrias) × total líquido do cupom",
      liquidoCalculado(c), c.total_liquido);
    if (c.sangrias && c.sangrias.length) {
      dif("Lista de sangrias × total de sangrias", c.sangrias.reduce(function (s, v) { return s + v; }, 0), c.sangria);
    }
    if (c.recebimentos && c.recebimentos.length) {
      FORMAS.forEach(function (f) {
        var lista = c.recebimentos.filter(function (x) { return x.forma === f.chave; })
          .reduce(function (s, x) { return s + x.valor; }, 0);
        dif("Recebimentos listados em " + f.nome + " × resumo", lista, (c.formas[f.chave] || {}).receb || 0, "aviso");
      });
    }
    FORMAS.forEach(function (f) {
      var x = c.formas[f.chave] || {};
      if ((x.vendas || 0) < 0 || (x.receb || 0) < 0) r.push({ nivel: "erro", texto: f.nome + " com valor negativo." });
    });
    return r;
  }

  // Quanto deveria ter entrado em cada forma (vendas + recebimentos). Carteira é só informativo.
  function esperadoPorForma(c) {
    var e = {};
    FORMAS.forEach(function (f) {
      var x = c.formas[f.chave] || {};
      e[f.chave] = f.chave === "dinheiro" ? liquidoCalculado(c)
        : f.chave === "carteira" ? (x.vendas || 0) : (x.vendas || 0) + (x.receb || 0);
    });
    return e;
  }

  /*
   * Monta o texto do cupom a partir dos pedaços que o pdf.js devolve ({ str, transform: [.., .., .., .., x, y] }).
   * Pedaços com a mesma altura (y, tolerância de 3 pontos) formam uma linha, da esquerda para a direita.
   */
  function textoDeItensPdf(itens) {
    var pedacos = (itens || []).filter(function (i) { return i && String(i.str || "").trim(); }).map(function (i) {
      return { x: +i.transform[4], y: +i.transform[5], s: String(i.str) };
    });
    pedacos.sort(function (a, b) { return b.y - a.y || a.x - b.x; });
    var linhas = [];
    pedacos.forEach(function (p) {
      var l = null;
      for (var k = 0; k < linhas.length; k++) if (Math.abs(linhas[k].y - p.y) <= 3) { l = linhas[k]; break; }
      if (l) l.p.push(p); else linhas.push({ y: p.y, p: [p] });
    });
    return linhas.map(function (l) {
      return l.p.sort(function (a, b) { return a.x - b.x; }).map(function (p) { return p.s; }).join(" ").replace(/\s+/g, " ").trim();
    }).join("\n");
  }

  // Caixa (de config.CAIXAS) que usa o terminal do cupom
  function caixaDoTerminal(caixas, terminal) {
    return (caixas || []).filter(function (cx) { return String(cx.terminal) === String(terminal); })[0] || null;
  }

  return {
    FORMAS: FORMAS,
    centavos: centavos,
    abreviarNome: abreviarNome,
    cupomVazio: cupomVazio,
    lerCupom: lerCupom,
    somaFormas: somaFormas,
    liquidoCalculado: liquidoCalculado,
    conferirCupom: conferirCupom,
    esperadoPorForma: esperadoPorForma,
    caixaDoTerminal: caixaDoTerminal,
    textoDeItensPdf: textoDeItensPdf
  };
});
