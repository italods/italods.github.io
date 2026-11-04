/*
 * Área "Cartões": conciliação dos recebíveis da Cielo (taxa, prazo, vendas sem pagamento, repasse no BB)
 * e cadastro das taxas do contrato. As taxas ficam só no banco (nunca no código); na tela "1,23%".
 */
(function () {
  "use strict";
  var RC = window.Recebiveis, CI = window.Cielo;
  var u = null;
  var taxas = [];
  var previa = null;

  var MODALIDADES = { debito: "Débito", credito: "Crédito à vista", parcelado: "Crédito parcelado", pix: "PIX", outro: "Outros lançamentos" };
  var BANDEIRAS = ["visa", "mastercard", "elo", "amex", "diners", "hipercard"];
  var NOME_BANDEIRA = { visa: "Visa", mastercard: "Mastercard", elo: "Elo", amex: "Amex", diners: "Diners", hipercard: "Hipercard", "*": "Todas" };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return u.escapar(s); }
  function brl(c) { return u.brl(c); }

  /* ------------------------------ Importar ------------------------------ */

  function lerArquivo(arquivo) {
    u.limparErro();
    if (!arquivo) return;
    arquivo.arrayBuffer().then(function (buf) {
      var r = RC.lerCsv(CI.decodificar(buf));
      if (r.erros.length) throw new Error(r.erros.join(" "));
      if (!r.lancamentos.length) throw new Error("O relatório não tem nenhum lançamento.");
      previa = { nome: arquivo.name, leitura: r };
      desenharPrevia();
    }).catch(function (e) { previa = null; desenharPrevia(); u.mostrarErro({ message: e.message || "Não consegui ler o relatório." }); });
  }

  function desenharPrevia() {
    var el = $("rec-previa");
    if (!previa) { el.hidden = true; el.innerHTML = ""; return; }
    var r = previa.leitura, tot = RC.conferirTotalizador(r), s = RC.resumo(r.lancamentos, taxas);
    var periodo = r.de === r.ate ? u.dataBR(r.de) : u.dataBR(r.de) + " a " + u.dataBR(r.ate);
    el.innerHTML = '<h3 class="mini">Prévia: ' + esc(previa.nome) + "</h3>" +
      '<p class="mini">Pagamentos de <strong>' + esc(periodo) + "</strong> · " + r.lancamentos.length + " lançamentos · bruto " +
      brl(s.total.bruto) + " · taxas " + brl(s.total.taxa) + " · líquido " + brl(s.total.liquido) + "</p>" +
      '<p class="' + (tot.ok === false ? "msg-erro" : tot.ok ? "msg-ok" : "suave mini") + '">' + esc(tot.texto) + "</p>" +
      (taxas.length ? "" : '<p class="msg-aviso">Nenhuma taxa cadastrada ainda: cadastre na aba Taxas para conferir.</p>') +
      '<div class="acoes"><button type="button" class="botao" id="rec-cancelar">Cancelar</button>' +
      '<button type="button" class="botao primario" id="rec-gravar">Gravar no sistema</button></div>';
    el.hidden = false;
  }

  function gravar() {
    var b = $("rec-gravar");
    u.ocupado(b, true, "Gravando…");
    u.db.importarRecebiveis(previa.leitura.lancamentos).then(function (r) {
      u.toast(r.novas + (r.novas === 1 ? " lançamento novo gravado" : " lançamentos novos gravados") +
        (r.repetidas ? "; " + r.repetidas + " já estavam no sistema" : "") + ".");
      var de = previa.leitura.de, ate = previa.leitura.ate;
      previa = null; desenharPrevia();
      // mostra o período importado
      if (de < $("rec-de").value) $("rec-de").value = de;
      if (ate > $("rec-ate").value) $("rec-ate").value = ate;
      return conciliar();
    }, function (e) { u.ocupado(b, false); u.mostrarErro(e); });
  }

  /* ------------------------------ Conciliação ------------------------------ */

  function tabela(cab, linhas, classe) {
    return linhas.length ? '<div class="tabela-rolagem"><table class="tabela-inv ' + (classe || "") + '"><thead><tr>' +
      cab.map(function (h) { return "<th>" + h + "</th>"; }).join("") + "</tr></thead><tbody>" + linhas.join("") + "</tbody></table></div>"
      : '<p class="suave mini">Nada.</p>';
  }

  function conciliar() {
    var de = $("rec-de").value, ate = $("rec-ate").value, el = $("rec-conteudo");
    if (!de || !ate || de > ate) { el.innerHTML = '<p class="msg-erro">Escolha um período válido.</p>'; return Promise.resolve(); }
    el.innerHTML = '<p class="suave mini">Carregando…</p>';
    // vendas de até 40 dias antes (o pagamento pode ser de venda antiga)
    var antes = window.Feriados.somarDias(de, -40);
    return Promise.all([u.db.listarRecebiveis({ de: de, ate: ate }), u.db.listarTaxas(),
      u.db.listarBanco({ de: de, ate: ate }), u.db.listarCielo({ de: antes, ate: ate })]).then(function (r) {
      taxas = r[1] || [];
      desenhar(r[0] || [], r[2] || [], r[3] || [], de, ate);
    }, function (e) { el.innerHTML = '<p class="msg-erro">Não foi possível carregar (' + esc(e.message) + ").</p>"; });
  }

  function desenhar(lanc, banco, vendas, de, ate) {
    var el = $("rec-conteudo");
    if (!lanc.length) { el.innerHTML = '<p class="vazio">Ainda não há recebíveis importados neste período.</p>'; return; }
    var s = RC.resumo(lanc, taxas);
    var difTaxa = s.total.taxa - s.total.esperada;
    var html = '<div class="cartoes">' +
      '<div class="bloco cartao-numero"><p class="mini suave">Bruto</p><p class="total-linha">' + brl(s.total.bruto) + "</p></div>" +
      '<div class="bloco cartao-numero"><p class="mini suave">Líquido</p><p class="total-linha">' + brl(s.total.liquido) + "</p></div>" +
      '<div class="bloco cartao-numero"><p class="mini suave">Taxas cobradas</p><p class="total-linha">' + brl(s.total.taxa) +
        '</p><p class="mini">' + RC.mostrarTaxaEfetiva(s.total.taxa, s.total.bruto) + " do bruto</p></div>" +
      '<div class="bloco cartao-numero"><p class="mini suave">Pelo contrato</p><p class="total-linha">' + brl(s.total.esperada) +
        '</p><p class="mini ' + (difTaxa > 0 ? "msg-erro" : "msg-ok") + '">' + (difTaxa === 0 ? "igual ao cobrado" :
        difTaxa > 0 ? "cobraram " + brl(difTaxa) + " a mais" : "cobraram " + brl(-difTaxa) + " a menos") + "</p></div></div>";

    html += '<h3 class="mini">Por forma</h3>' + tabela(["Forma", "Bruto", "Taxa", "Efetiva"],
      Object.keys(MODALIDADES).filter(function (k) { return s.por[k]; }).map(function (k) {
        var m = s.por[k], dif = m.taxa - m.esperada;
        return "<tr><td>" + esc(MODALIDADES[k]) + '<br><small class="suave">' + m.qtd + (m.qtd === 1 ? " lançamento" : " lançamentos") + "</small></td><td>" +
          brl(m.bruto) + "</td><td>" + brl(m.taxa) + (k !== "outro" && dif ? '<br><small class="msg-erro">contrato ' + brl(m.esperada) + "</small>" : "") +
          "</td><td>" + (k === "outro" ? "—" : RC.mostrarTaxaEfetiva(m.taxa, m.bruto)) + "</td></tr>";
      }), "tabela-numeros");

    var rep = RC.repassePorDia(lanc, banco);
    html += '<h3 class="mini">Repasse no Banco do Brasil (cartões)</h3>' + tabela(["Dia", "Cielo pagou", "Caiu no BB", ""],
      rep.map(function (d) {
        var t = d.situacao === "sem_extrato" ? '<span class="suave">extrato do BB não importado</span>'
          : d.situacao === "bateu" ? '<span class="msg-ok">bateu</span>'
          : '<span class="msg-erro">' + (d.diferenca > 0 ? "BB " + brl(d.diferenca) + " a mais" : "faltou " + brl(-d.diferenca)) + "</span>";
        return "<tr><td>" + esc(u.dataBR(d.data)) + "</td><td>" + brl(d.esperado) + "</td><td>" + (d.recebido ? brl(d.recebido) : "—") + "</td><td>" + t + "</td></tr>";
      }), "tabela-numeros");

    var alertas = s.alertas;
    html += '<h3 class="mini">Alertas</h3>' + (alertas.length ? tabela(["Pagamento", "Lançamento", "O que houve"], alertas.map(function (a) {
      var l = a.lancamento, c = a.conferencia, txt = [];
      if (c.situacao === "taxa_maior") txt.push("taxa " + brl(l.taxa) + ", o contrato dá " + brl(c.taxaEsperada) + " (" + RC.mostrarTaxa(c.taxaContrato) + ")");
      if (c.situacao === "sem_taxa") txt.push("sem taxa cadastrada para " + (MODALIDADES[l.modalidade] || l.modalidade) + " " + (l.bandeira || ""));
      if (c.atraso > 0) txt.push("pago " + c.atraso + (c.atraso === 1 ? " dia útil" : " dias úteis") + " depois do prazo (" + u.dataBR(c.prazoEsperado) + ")");
      if (c.situacao === "outro") txt.push("cobrança: " + (l.tipo || l.descricao || "lançamento") + " " + brl(l.valor_bruto));
      return "<tr><td>" + esc(u.dataBR(l.data_pagamento)) + "</td><td>" + esc((MODALIDADES[l.modalidade] || l.modalidade) + " " + (l.bandeira || "") +
        (l.data_venda ? " · venda " + u.dataBR(l.data_venda) + (l.hora_venda ? " " + u.horaCurta(l.hora_venda) : "") : "") + " · " + brl(l.valor_bruto)) +
        "</td><td>" + esc(txt.join("; ")) + "</td></tr>";
    })) : '<p class="msg-ok">Nenhum alerta: taxas iguais às do contrato e pagamentos no prazo.</p>');

    // só o trecho coberto pelos recebíveis importados (senão acusaria venda paga fora do arquivo)
    var cob = { de: lanc.reduce(function (m, l) { return !m || l.data_pagamento < m ? l.data_pagamento : m; }, ""),
      ate: lanc.reduce(function (m, l) { return l.data_pagamento > m ? l.data_pagamento : m; }, "") };
    var sem = RC.vendasSemPagamento(vendas, lanc, taxas, u.hojeISO(), null, cob);
    html += '<h3 class="mini">Vendas sem pagamento</h3><p class="suave mini">Vendas aprovadas na Cielo cujo pagamento deveria ter caído entre ' +
      esc(u.dataBR(cob.de)) + " e " + esc(u.dataBR(cob.ate)) + " (período dos recebíveis importados) e não aparecem nos recebíveis.</p>" +
      (vendas.length ? (sem.length ? tabela(["Venda", "Valor", "Deveria pagar", "Pagas"], sem.map(function (x) {
        var v = x.venda;
        return "<tr><td>" + esc(u.dataBR(v.data) + " " + u.horaCurta(v.hora) + " · " + (MODALIDADES[v.forma] || v.forma) + " " + (v.bandeira || "")) + "</td><td>" +
          brl(v.valor_centavos) + "</td><td>" + esc(u.dataBR(x.prazo)) + "</td><td>" + x.pagas + "/" + x.parcelas + "</td></tr>";
      })) : '<p class="msg-ok">Todas as vendas do período foram pagas.</p>') : '<p class="suave mini">Importe as vendas da Cielo (aba Importar) para conferir.</p>');
    el.innerHTML = html;
  }

  /* ------------------------------ Taxas ------------------------------ */

  function ordenarTaxas(lista) {
    var ordem = { debito: 1, credito: 2, parcelado: 3, pix: 4 };
    return lista.slice().sort(function (a, b) {
      return (ordem[a.modalidade] - ordem[b.modalidade]) || String(a.bandeira).localeCompare(String(b.bandeira)) || (a.parcelas - b.parcelas);
    });
  }

  function desenharTaxas() {
    var el = $("taxas-lista");
    if (!taxas.length) {
      el.innerHTML = '<p class="vazio">Nenhuma taxa cadastrada. Inclua abaixo (as taxas ficam só no banco do sistema).</p>';
      return;
    }
    el.innerHTML = tabela(["Forma", "Taxa", "Prazo", ""], ordenarTaxas(taxas).map(function (t) {
      return '<tr data-id="' + esc(t.id) + '"><td>' + esc(MODALIDADES[t.modalidade]) + '<br><small class="suave">' + esc(NOME_BANDEIRA[t.bandeira] || t.bandeira) +
        (t.modalidade === "parcelado" ? " · " + t.parcelas + "x" : "") + '</small></td><td><input type="text" inputmode="decimal" class="taxa-campo" data-taxa="' + esc(t.id) +
        '" value="' + esc(RC.mostrarTaxa(t.taxa)) + '" aria-label="Taxa" /></td><td><input type="number" min="0" max="60" class="prazo-campo" data-prazo="' + esc(t.id) +
        '" value="' + t.prazo_dias_uteis + '" aria-label="Prazo em dias úteis" /></td><td><button type="button" class="botao pequeno perigo" data-apagar-taxa="' + esc(t.id) +
        '" aria-label="Apagar taxa">×</button></td></tr>';
    }), "tabela-taxas");
  }

  function carregarTaxas() {
    return u.db.listarTaxas().then(function (r) { taxas = r || []; desenharTaxas(); }, function (e) {
      $("taxas-lista").innerHTML = '<p class="msg-erro">Não foi possível carregar (' + esc(e.message) + ").</p>";
    });
  }

  function salvarTaxaLinha(id) {
    var t = taxas.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    var inp = document.querySelector('[data-taxa="' + id + '"]'), pr = document.querySelector('[data-prazo="' + id + '"]');
    var v = RC.lerTaxa(inp.value), p = parseInt(pr.value, 10);
    if (v == null) { inp.setAttribute("aria-invalid", "true"); u.mostrarErro({ message: "Taxa inválida. Use, por exemplo, 1,23%." }); return; }
    if (!(p >= 0 && p <= 60)) { u.mostrarErro({ message: "Prazo inválido (0 a 60 dias úteis)." }); return; }
    inp.removeAttribute("aria-invalid");
    u.db.salvarTaxas([{ modalidade: t.modalidade, bandeira: t.bandeira, parcelas: t.parcelas, taxa: v, prazo_dias_uteis: p }]).then(function () {
      u.toast("Taxa salva: " + MODALIDADES[t.modalidade] + " " + (NOME_BANDEIRA[t.bandeira] || t.bandeira) + (t.modalidade === "parcelado" ? " " + t.parcelas + "x" : "") + " " + RC.mostrarTaxa(v));
      return carregarTaxas();
    }, u.mostrarErro);
  }

  function incluirTaxa() {
    u.limparErro();
    var mod = $("taxa-modalidade").value, band = mod === "pix" ? "*" : $("taxa-bandeira").value;
    var parc = mod === "parcelado" ? parseInt($("taxa-parcelas").value, 10) : 1;
    var v = RC.lerTaxa($("taxa-valor").value), p = parseInt($("taxa-prazo").value, 10);
    if (v == null) { u.mostrarErro({ message: "Taxa inválida. Use, por exemplo, 1,23%." }); return; }
    if (mod === "parcelado" && !(parc >= 2 && parc <= 24)) { u.mostrarErro({ message: "Parcelas de 2 a 24." }); return; }
    if (!(p >= 0 && p <= 60)) { u.mostrarErro({ message: "Prazo inválido (0 a 60 dias úteis)." }); return; }
    u.db.salvarTaxas([{ modalidade: mod, bandeira: band, parcelas: parc, taxa: v, prazo_dias_uteis: p }]).then(function () {
      u.toast("Taxa incluída.");
      $("taxa-valor").value = "";
      return carregarTaxas();
    }, u.mostrarErro);
  }

  function ajustarFormTaxa() {
    var mod = $("taxa-modalidade").value;
    $("taxa-bandeira-campo").hidden = mod === "pix";
    $("taxa-parcelas-campo").hidden = mod !== "parcelado";
    if (mod === "pix") $("taxa-prazo").value = "0";
  }

  /* ------------------------------ Início ------------------------------ */

  function mostrar(aba) {
    if (aba === "cartoes-taxas") return carregarTaxas();
    return conciliar();
  }

  function iniciar(utilidades) {
    u = utilidades;
    var hoje = u.hojeISO();
    $("rec-de").value = hoje.slice(0, 8) + "01";
    $("rec-ate").value = hoje;
    $("taxa-bandeira").innerHTML = BANDEIRAS.map(function (b) { return '<option value="' + b + '">' + NOME_BANDEIRA[b] + "</option>"; }).join("") +
      '<option value="*">Todas as bandeiras</option>';
    $("rec-arquivo").addEventListener("change", function (ev) { var a = ev.target.files && ev.target.files[0]; ev.target.value = ""; lerArquivo(a); });
    $("rec-importar").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); $("rec-arquivo").click(); }
    });
    $("rec-previa").addEventListener("click", function (ev) {
      if (ev.target.id === "rec-cancelar") { previa = null; desenharPrevia(); }
      if (ev.target.id === "rec-gravar") gravar();
    });
    $("rec-de").addEventListener("change", conciliar);
    $("rec-ate").addEventListener("change", conciliar);
    $("taxas-lista").addEventListener("change", function (ev) {
      var id = ev.target.dataset.taxa || ev.target.dataset.prazo;
      if (id) salvarTaxaLinha(id);
    });
    $("taxas-lista").addEventListener("click", function (ev) {
      var id = ev.target.dataset.apagarTaxa;
      if (!id || !confirm("Apagar esta taxa?")) return;
      u.db.apagarTaxa(id).then(function () { u.toast("Taxa apagada."); return carregarTaxas(); }, u.mostrarErro);
    });
    $("taxa-modalidade").addEventListener("change", ajustarFormTaxa);
    $("taxa-incluir").addEventListener("click", incluirTaxa);
    ajustarFormTaxa();
  }

  window.Cartoes = { iniciar: iniciar, mostrar: mostrar };
})();
