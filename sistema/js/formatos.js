/*
 * Textos para WhatsApp e arquivos CSV. Funções puras (navegador e Node).
 */
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica(require("./calculos.js"));
  else raiz.Formatos = fabrica(raiz.Calculos);
})(typeof self !== "undefined" ? self : this, function (C) {
  "use strict";

  var TIPOS = { abertura: "Abertura", fechamento: "Fechamento" };

  function nomeTipo(t) {
    return TIPOS[t] || t;
  }

  function linhaDiferenca(dif) {
    var s = C.classificarDiferenca(dif);
    if (s === "bateu") return "Caixa bateu";
    return (s === "sobra" ? "Sobra: " : "Falta: ") + C.formatarBRL(Math.abs(dif));
  }

  /*
   * Texto de um registro de conferência, pronto para colar no WhatsApp.
   * nomeCaixa: função que transforma o id do caixa no nome curto ("Caixa 1").
   */
  function textoConferencia(r, nomeCaixa) {
    nomeCaixa = nomeCaixa || function (c) { return c; };
    var cont = C.calcularContagem(r.contagem);
    var l = [];
    l.push("*Conferência de caixa — Supermercado Veneza*");
    var cab = C.dataBR(r.data) + " às " + C.horaCurta(r.hora) + " · " + nomeTipo(r.tipo) + " · " + nomeCaixa(r.caixa);
    if (r.operador) cab += " · " + r.operador;
    l.push(cab);

    function bloco(titulo, linhas, subtotal) {
      var usadas = linhas.filter(function (x) { return x.quantidade > 0; });
      if (!usadas.length) return;
      l.push("");
      l.push("*" + titulo + "*");
      usadas.forEach(function (x) {
        l.push(C.rotuloValor(x.valor) + ": " + x.quantidade + " = " + C.formatarBRL(x.subtotal));
      });
      l.push("Subtotal: " + C.formatarBRL(subtotal));
    }
    bloco("Cédulas", cont.cedulas, cont.totalCedulas);
    bloco("Moedas", cont.moedas, cont.totalMoedas);

    l.push("");
    l.push("*Total contado: " + C.formatarBRL(cont.total) + "*");
    if (r.tipo === "fechamento" && r.pendente === true) {
      l.push("Falta o cupom do Diamante: a diferença aparece quando ele for importado.");
    } else if (r.tipo === "fechamento") {
      var esperado = r.esperado_centavos;
      var dif = r.diferenca_centavos;
      if (esperado == null) {
        var f = C.calcularFechamento({
          contagem: r.contagem, fundo: r.fundo_centavos, vendas: r.vendas_dinheiro_centavos,
          recebimentos: r.recebimentos_dinheiro_centavos, suprimentos: r.suprimentos_centavos,
          sangrias: r.sangrias_centavos
        });
        esperado = f.esperado;
        dif = f.diferenca;
      }
      l.push("Esperado: " + C.formatarBRL(esperado) + " · " + linhaDiferenca(dif));
    }
    if (r.observacao && String(r.observacao).trim()) {
      l.push("Obs.: " + String(r.observacao).trim());
    }
    return l.join("\n");
  }

  // Todos os registros de um dia, separados por uma linha em branco
  function textoDia(registros, nomeCaixa) {
    return ordenarPorHora(registros).map(function (r) {
      return textoConferencia(r, nomeCaixa);
    }).join("\n\n");
  }

  function ordenarPorHora(lista) {
    return (lista || []).slice().sort(function (a, b) {
      return (String(a.data) + String(a.hora)).localeCompare(String(b.data) + String(b.hora));
    });
  }

  /* ---------- CSV (Excel brasileiro: ponto e vírgula + BOM UTF-8) ---------- */

  var BOM = "﻿";

  function campoCSV(v) {
    if (v == null) return "";
    var s = String(v);
    if (/[";\r\n]/.test(s) || /^\s|\s$/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function montarCSV(cabecalho, linhas) {
    return BOM + [cabecalho].concat(linhas).map(function (l) {
      return l.map(campoCSV).join(";");
    }).join("\r\n") + "\r\n";
  }

  // Valor para planilha: "1299,70" (vírgula decimal, sem R$, conta inteira)
  function numeroCSV(centavos) {
    if (centavos == null || centavos === "") return "";
    var n = Math.trunc(Number(centavos));
    var sinal = n < 0 ? "-" : "";
    n = Math.abs(n);
    var cent = String(n % 100);
    return sinal + Math.floor(n / 100) + "," + (cent.length < 2 ? "0" + cent : cent);
  }

  function csvConferencias(registros, nomeCaixa) {
    nomeCaixa = nomeCaixa || function (c) { return c; };
    var valores = C.CEDULAS.concat(C.MOEDAS);
    var cab = ["Data", "Hora", "Tipo", "Caixa", "Operador"]
      .concat(valores.map(function (v) { return "Qtd " + C.rotuloValor(v); }))
      .concat(["Cédulas", "Moedas", "Total contado", "Fundo", "Vendas dinheiro", "Recebimentos dinheiro",
        "Suprimentos", "Sangrias", "Esperado", "Diferença", "Situação", "PIX", "Débito", "Crédito",
        "Carteira", "Troco amanhã", "Observação", "Criado por", "Editado por"]);
    var linhas = ordenarPorHora(registros).map(function (r) {
      var cont = C.calcularContagem(r.contagem);
      var q = cont.cedulas.concat(cont.moedas).map(function (x) { return x.quantidade; });
      var fech = r.tipo === "fechamento";
      var pend = fech && r.pendente === true;
      return [C.dataBR(r.data), C.horaCurta(r.hora), nomeTipo(r.tipo), nomeCaixa(r.caixa), r.operador || ""]
        .concat(q)
        .concat([
          numeroCSV(cont.totalCedulas), numeroCSV(cont.totalMoedas), numeroCSV(cont.total),
          fech ? numeroCSV(r.fundo_centavos) : "",
          fech ? numeroCSV(r.vendas_dinheiro_centavos) : "",
          fech ? numeroCSV(r.recebimentos_dinheiro_centavos) : "",
          fech ? numeroCSV(r.suprimentos_centavos) : "",
          fech ? numeroCSV(r.sangrias_centavos) : "",
          fech && !pend ? numeroCSV(r.esperado_centavos) : "",
          fech && !pend ? numeroCSV(r.diferenca_centavos) : "",
          pend ? "Falta o cupom" : fech ? linhaDiferenca(r.diferenca_centavos).split(":")[0] : "",
          numeroCSV(r.pix_centavos), numeroCSV(r.debito_centavos), numeroCSV(r.credito_centavos),
          numeroCSV(r.carteira_centavos), fech ? numeroCSV(r.troco_amanha_centavos) : "",
          r.observacao || "", r.criado_por || "", r.editado_por || ""
        ]);
    });
    return montarCSV(cab, linhas);
  }

  // Tabela dia a dia do relatório mensal
  function csvRelatorio(resumo, caixas, nomeCaixa) {
    nomeCaixa = nomeCaixa || function (c) { return c; };
    var cab = ["Data"].concat(caixas.map(function (c) { return "Diferença " + nomeCaixa(c); }))
      .concat(["Diferença do dia", "Vendas dinheiro", "Sangrias", "Suprimentos"]);
    var linhas = resumo.porDia.map(function (d) {
      return [C.dataBR(d.data)]
        .concat(caixas.map(function (c) { return d.caixas[c] == null ? "" : numeroCSV(d.caixas[c]); }))
        .concat([numeroCSV(d.diferenca), numeroCSV(d.vendasDinheiro), numeroCSV(d.sangrias), numeroCSV(d.suprimentos)]);
    });
    var t = resumo.totais;
    linhas.push(["Total"].concat(caixas.map(function (c) {
      var g = resumo.porCaixa.filter(function (x) { return x.nome === c; })[0];
      return g ? numeroCSV(g.saldo) : "";
    })).concat([numeroCSV(t.saldo), numeroCSV(t.vendasDinheiro), numeroCSV(t.sangrias), numeroCSV(t.suprimentos)]));
    return montarCSV(cab, linhas);
  }

  function csvMovimentos(movs, nomeCaixa) {
    nomeCaixa = nomeCaixa || function (c) { return c; };
    var cab = ["Data", "Hora", "Caixa", "Tipo", "Valor", "Motivo", "Responsável", "Criado por"];
    return montarCSV(cab, ordenarPorHora(movs).map(function (m) {
      return [C.dataBR(m.data), C.horaCurta(m.hora), nomeCaixa(m.caixa),
        m.tipo === "sangria" ? "Sangria" : "Suprimento", numeroCSV(m.valor_centavos),
        m.motivo || "", m.responsavel || "", m.criado_por || ""];
    }));
  }

  /* ------------------------------- Senha ------------------------------- */

  // Lê o endereço de volta do e-mail "Esqueci minha senha" (parte depois do #).
  // Devolve null (não é retorno de e-mail), { erro } ou { access_token, refresh_token }.
  function lerRetornoSenha(hash) {
    var h = String(hash || "").replace(/^#/, "");
    if (!/(^|&)(access_token|error|error_description)=/.test(h)) return null;
    var p = {};
    h.split("&").forEach(function (par) {
      var i = par.indexOf("=");
      if (i < 0) return;
      try { p[decodeURIComponent(par.slice(0, i))] = decodeURIComponent(par.slice(i + 1).replace(/\+/g, " ")); }
      catch (e) { /* ignora pedaço inválido */ }
    });
    if (p.error || p.error_description) {
      var expirado = p.error_code === "otp_expired" || /expired|invalid/i.test(p.error_description || "");
      return { erro: expirado
        ? "Este link já foi usado ou expirou. Peça um novo em \"Esqueci minha senha\"."
        : "Não foi possível usar o link do e-mail. Peça um novo em \"Esqueci minha senha\"." };
    }
    if (!p.access_token || !p.refresh_token) return { erro: "Link incompleto. Peça um novo em \"Esqueci minha senha\"." };
    if (p.type && p.type !== "recovery" && p.type !== "invite" && p.type !== "magiclink" && p.type !== "signup") {
      return { erro: "Link de tipo desconhecido. Peça um novo em \"Esqueci minha senha\"." };
    }
    return { access_token: p.access_token, refresh_token: p.refresh_token, tipo: p.type || "" };
  }

  // Confere a senha nova. Devolve a mensagem de erro, ou null se estiver boa.
  function validarNovaSenha(senha, repetir) {
    senha = String(senha || "");
    if (senha.length < 8) return "A senha precisa ter pelo menos 8 caracteres.";
    if (senha.length > 72) return "A senha pode ter no máximo 72 caracteres.";
    if (/^\s|\s$/.test(senha)) return "A senha não pode começar nem terminar com espaço.";
    if (senha !== String(repetir || "")) return "As duas senhas não são iguais.";
    return null;
  }

  return {
    nomeTipo: nomeTipo,
    linhaDiferenca: linhaDiferenca,
    textoConferencia: textoConferencia,
    textoDia: textoDia,
    ordenarPorHora: ordenarPorHora,
    campoCSV: campoCSV,
    montarCSV: montarCSV,
    numeroCSV: numeroCSV,
    csvConferencias: csvConferencias,
    csvRelatorio: csvRelatorio,
    csvMovimentos: csvMovimentos,
    lerRetornoSenha: lerRetornoSenha,
    validarNovaSenha: validarNovaSenha
  };
});
