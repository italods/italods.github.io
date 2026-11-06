/*
 * Aba "Conferir" (Conferência de caixa): os caixas do dia lado a lado — dinheiro (contado × esperado) e,
 * por forma, Diamante × Cielo; PIX Delivery do dia × BB. Cada diferença tem "Investigar" (só sugere).
 * As contas ficam em investigar.js (quadroDoDia, explicarDiferenca, casarPix...).
 */
(function () {
  "use strict";
  var IV = window.Investigar, CI = window.Cielo, BB = window.Banco, C = window.Calculos;
  var u = null;
  var K = null;          // { vendas, maquinas, trocas, banco, confs } do dia
  var quadro = null;
  var pedido = 0;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return u.escapar(s); }
  function brl(c) { return u.brl(c); }
  function data() { return $("cf-data").value || u.hojeISO(); }

  function carregar() {
    var d = data();
    $("cf-data").value = d;
    $("cf-titulo").textContent = (d === u.hojeISO() ? "Hoje" : u.diaDaSemana(d)) + ", " + C.dataBR(d);
    $("cf-conteudo").innerHTML = '<p class="vazio">Carregando…</p>';
    var meu = ++pedido;
    Promise.all([u.db.listarCielo({ de: d, ate: d }), u.db.listarMaquinas(), u.db.listarTrocas({ de: d, ate: d }),
      u.db.listarBanco({ de: d, ate: d }), u.db.listarConferencias({ de: d, ate: d })]).then(function (r) {
      if (meu !== pedido) return;
      K = { vendas: r[0] || [], maquinas: r[1] || [], trocas: r[2] || [], banco: r[3] || [], confs: r[4] || [], data: d };
      desenhar();
    }, function (e) {
      if (meu !== pedido) return;
      $("cf-conteudo").innerHTML = '<p class="vazio">Não foi possível carregar.</p>';
      u.mostrarErro(e);
    });
  }

  function calcular() {
    quadro = IV.quadroDoDia({ caixas: u.caixas, conferencias: K.confs, vendas: K.vendas, maquinas: K.maquinas, trocas: K.trocas,
      banco: K.banco, data: K.data, cielo: CI, bancoBB: BB });
  }

  // Célula com o valor da diferença (positivo = Cielo/BB tem a mais; no dinheiro, sobra)
  function celula(v, forma, caixa) {
    if (v == null) return '<td class="suave">—</td>';
    var cls = v === 0 ? "cor-bateu" : v > 0 ? "cor-sobra" : "cor-falta";
    var texto = v === 0 ? "0,00 ✓" : (v > 0 ? "+" : "−") + brl(Math.abs(v)).replace(/^-?R\$\s?/, "");
    if (!v || !forma) return '<td class="' + cls + '">' + texto + "</td>";
    return '<td><button type="button" class="celula-inv ' + cls + '" data-investigar="' + forma + '" data-caixa="' + esc(caixa || "") +
      '" aria-label="Investigar">' + texto + "</button></td>";
  }

  function desenhar() {
    calcular();
    var q = quadro, html = "";
    var algum = q.caixas.some(function (c) { return c.fechamentos; });
    if (!algum) {
      $("cf-conteudo").innerHTML = '<p class="vazio">Nenhum fechamento neste dia.</p>';
      return;
    }
    var cab = "<tr><th></th>" + q.caixas.map(function (c) { return "<th>" + esc(c.curto) + "</th>"; }).join("") + "<th>Dia</th></tr>";
    function linha(nome, f, forma) {
      return "<tr><th>" + nome + "</th>" + q.caixas.map(function (c) {
        if (forma && c.fechamentos && !c.cupom) return '<td class="suave mini">sem cupom</td>';
        return celula(f(c), forma, c.id);
      }).join("") + celula(forma ? q.dia[forma] : q.dia.dinheiro) + "</tr>";
    }
    html += '<div class="tabela-rolagem"><table class="tabela-conferir"><thead>' + cab + "</thead><tbody>" +
      "<tr><th>Dinheiro</th>" + q.caixas.map(function (c) {
        if (!c.fechamentos) return '<td class="suave">—</td>';
        if (c.dinheiro == null) return '<td class="cor-pendente mini">falta o cupom</td>';
        return celula(c.dinheiro);
      }).join("") + celula(q.dia.dinheiro) + "</tr>" +
      linha("Débito", function (c) { return c.formas ? c.formas.debito.diferenca : null; }, "debito") +
      linha("Crédito", function (c) { return c.formas ? c.formas.credito.diferenca : null; }, "credito") +
      linha("PIX maquininha", function (c) { return c.formas ? c.formas.pix.diferenca : null; }, "pix") +
      "</tbody></table></div>";
    html += '<p class="suave mini">Dinheiro: + sobra, − falta. Cartões e PIX: Cielo − Diamante (+ a Cielo tem a mais). Toque num valor para investigar.</p>';
    if (!q.temCielo) html += '<p class="msg-aviso">As vendas da Cielo deste dia ainda não foram importadas. <a href="#importar">Importar o CSV da Cielo</a></p>';
    if (q.semCaixa) html += '<p class="msg-aviso">' + q.semCaixa + " vendas da Cielo são de máquina sem caixa. <a href=\"#importar\">Ligar a máquina ao caixa</a></p>";
    if (q.naoAprovadas) html += '<p class="suave mini">' + q.naoAprovadas + (q.naoAprovadas === 1 ? " venda não aprovada" : " vendas não aprovadas") + " na Cielo (não contam).</p>";
    if (q.notas.length) html += '<ul class="explicacoes">' + q.notas.map(function (n) { return '<li class="exp-' + n.tipo + '">' + esc(n.texto) + "</li>"; }).join("") + "</ul>";
    // PIX Delivery: o BB não diz o caixa, então é do dia
    html += '<h3 class="mini">PIX Delivery (dia inteiro) × Banco do Brasil</h3>';
    if (!q.temBanco) html += '<p class="msg-aviso">O extrato do BB deste dia ainda não foi importado. <a href="#importar">Importar o extrato do BB</a></p>';
    else if (!q.pixDelivery) html += '<p class="suave mini">Precisa de pelo menos um cupom do dia.</p>';
    else {
      var r = q.pixDelivery;
      var t = r.situacao === "bateu" ? "Bateu" : "BB tem " + brl(Math.abs(r.diferenca)) + (r.situacao === "sobra" ? " a mais" : " a menos");
      html += '<div class="linha-info"><span>Diamante ' + brl(r.esperado) + " · BB " + brl(r.encontrado) + '</span><strong class="diferenca-texto ' + r.situacao + '">' +
        esc(t) + "</strong></div>" +
        '<div class="acoes"><button type="button" class="botao" data-investigar="pix_delivery">' + (r.diferenca ? "Investigar o PIX Delivery" : "Ver os PIX de clientes") + "</button></div>" +
        '<p class="suave mini">' + r.quantidade + " PIX de clientes no BB neste dia." +
        (q.semCupom.length ? " Atenção: sem cupom do " + esc(q.semCupom.join(" e do ")) + ", então o Diamante está incompleto." : "") + "</p>";
    }
    $("cf-conteudo").innerHTML = html;
  }

  /* ========================= Investigar diferença ========================= */

  function cuponsDoDia() {
    var porCaixa = {};
    quadro.caixas.forEach(function (c) { if (c.cupom) porCaixa[c.id] = c.cupom; });
    return porCaixa;
  }

  function linhaVenda(v, destaque) {
    var extra = v.forma === "pix" ? (v.pagador || "") : (v.bandeira || "") + (v.parcelas > 1 ? " " + v.parcelas + "x" : "");
    return "<tr" + (destaque ? ' class="destaque"' : "") + "><td>" + esc(C.horaCurta(v.hora)) + "</td><td>" + brl(v.valor_centavos) +
      "</td><td>" + esc(extra) + "</td><td>" + (v.aprovada === false ? '<span class="msg-erro">não aprovada</span>' : "") + "</td></tr>";
  }
  function tabela(cab, linhas) {
    return linhas.length ? '<div class="tabela-rolagem"><table class="tabela-inv"><thead><tr>' + cab.map(function (h) { return "<th>" + h + "</th>"; }).join("") +
      "</tr></thead><tbody>" + linhas.join("") + "</tbody></table></div>" : '<p class="suave mini">Nada.</p>';
  }

  function abrirInvestigar(forma, caixa) {
    if (!K || !quadro) return;
    var d = K.data;
    var cupons = cuponsDoDia();
    var c = cupons[caixa];
    if (forma !== "pix_delivery" && !c) return;
    var doCaixa = function (cx) { return K.vendas.filter(function (v) { return v.data === d && CI.caixaDaVenda(v, K.maquinas, K.trocas) === cx; }); };
    var difsDe = function (cup, cx) {
      var o = {};
      CI.compararComCupom(cup, CI.somarPorForma(K.vendas, cx, d, K.maquinas, K.trocas)).forEach(function (l) { o[l.forma] = l.diferenca; });
      return o;
    };
    var banco = (K.banco || []).filter(function (l) { return l.data === d; });
    var recebTodos = [];
    Object.keys(cupons).forEach(function (k) { recebTodos = recebTodos.concat(cupons[k].recebimentos || []); });
    var terceiros = banco.filter(function (l) { return l.categoria === "pix_terceiro" && l.caixa !== "fora"; });
    var delivery = IV.casarPixDelivery(recebTodos, terceiros);
    var html = "";
    var titulo = { debito: "Cartão débito", credito: "Cartão crédito", pix: "PIX da maquininha", pix_delivery: "PIX Delivery (dia inteiro)" }[forma];
    $("investigar-titulo").textContent = titulo + (forma === "pix_delivery" ? "" : " · " + u.nomeCaixa(caixa)) + " · " + C.dataBR(d);

    if (forma !== "pix_delivery") {
      var vendas = doCaixa(caixa);
      var aprovadas = vendas.filter(function (v) { return v.aprovada; });
      var difs = difsDe(c, caixa);
      var linha = CI.compararComCupom(c, CI.somarPorForma(K.vendas, caixa, d, K.maquinas, K.trocas)).filter(function (l) { return l.forma === forma; })[0];
      var outro = null;
      Object.keys(cupons).forEach(function (k) {
        if (k === caixa) return;
        var x = difsDe(cupons[k], k);
        if (!outro || x[forma] === -linha.diferenca) outro = x;
      });
      var exp = IV.explicarDiferenca({ forma: forma, diferenca: linha.diferenca, vendas: aprovadas,
        naoAprovadas: vendas.filter(function (v) { return !v.aprovada; }), difs: difs, difsOutroCaixa: outro, bbTerceiros: delivery.soBB });
      var marcados = [];
      exp.forEach(function (x) { marcados = marcados.concat(x.itens || []); });
      html += '<p>Diamante <strong>' + brl(linha.esperado) + "</strong> · Cielo <strong>" + brl(linha.encontrado) + '</strong> · <span class="diferenca-texto ' +
        linha.situacao + '">' + (linha.diferenca ? "Cielo tem " + brl(Math.abs(linha.diferenca)) + (linha.diferenca > 0 ? " a mais" : " a menos") : "bateu") + "</span></p>";
      html += '<h3 class="mini">O que pode explicar</h3><ul class="explicacoes">' + exp.map(function (x) {
        return '<li class="exp-' + x.tipo + '">' + esc(x.texto) + "</li>";
      }).join("") + "</ul>";
      if (forma === "pix") {
        var todosPix = K.vendas.filter(function (v) { return v.data === d && v.forma === "pix" && v.aprovada; });
        var pm = IV.casarPixMaquininha(todosPix, banco.filter(function (l) { return l.categoria === "pix_maquininha"; }));
        var meus = function (v) { return CI.caixaDaVenda(v, K.maquinas, K.trocas) === caixa; };
        var deste = pm.pares.filter(function (p) { return meus(p.cielo); });
        var naoChegou = pm.soCielo.filter(meus);
        html += '<h3 class="mini">PIX da maquininha × Banco do Brasil</h3><p class="mini">' + deste.length + " de " + (deste.length + naoChegou.length) +
          " PIX deste caixa caíram no BB (taxa média do dia " + (pm.taxaMedia * 100).toFixed(2).replace(".", ",") + "%)." +
          (banco.length ? "" : " O extrato do BB deste dia não foi importado.") + "</p>";
        var atrasados = deste.filter(function (p) { return p.atrasado; });
        if (atrasados.length) html += '<p class="mini">Caíram bem depois: ' + atrasados.map(function (p) {
          return esc(brl(p.cielo.valor_centavos) + " das " + C.horaCurta(p.cielo.hora) + " só às " + C.horaCurta(p.bb.hora));
        }).join("; ") + ".</p>";
        if (naoChegou.length) html += '<p class="msg-aviso">Não acharam no BB: ' + naoChegou.map(function (v) { return esc(brl(v.valor_centavos) + " às " + C.horaCurta(v.hora)); }).join("; ") + ".</p>";
      }
      var daForma = vendas.filter(function (v) { return v.forma === forma; });
      html += '<h3 class="mini">Vendas da Cielo neste caixa (' + esc(titulo.toLowerCase()) + ")</h3>" +
        tabela(["Hora", "Valor", forma === "pix" ? "Pagador" : "Bandeira", ""], daForma.map(function (v) { return linhaVenda(v, marcados.indexOf(v) >= 0); }));
    } else {
      var vendasDelivery = Object.keys(cupons).reduce(function (s, k) { return s + cupons[k].formas.pix_delivery.vendas; }, 0);
      var sobraBB = delivery.soBB.reduce(function (s, l) { return s + l.valor_centavos; }, 0);
      html += '<p class="mini">O BB não diz de qual caixa veio o PIX. Os <strong>recebimentos</strong> do cupom (fiado pago por PIX) são casados pelo valor; ' +
        "o que sobra no BB deveria somar as <strong>vendas</strong> em PIX Delivery dos cupons (" + brl(vendasDelivery) + ").</p>";
      if (quadro.semCupom.length) html += '<p class="msg-aviso">Sem cupom do ' + esc(quadro.semCupom.join(" e do ")) + " neste dia: a conta está incompleta.</p>";
      var celCupom = function (r) { return "<td>" + brl(r.valor) + '<br><small class="suave">' + esc(r.nome || "") + "</small></td>"; };
      var celBB = function (l) { return "<td>" + brl(l.valor_centavos) + '<br><small class="suave">' + esc(C.horaCurta(l.hora)) + "</small></td>"; };
      html += '<h3 class="mini">Recebimentos do cupom × BB</h3>' + tabela(["Cupom", "BB", ""],
        delivery.exatos.map(function (x) { return "<tr>" + celCupom(x.cupom) + celBB(x.bb) + '<td class="msg-ok">igual</td></tr>'; })
          .concat(delivery.proximos.map(function (x) { return '<tr class="destaque">' + celCupom(x.cupom) + celBB(x.bb) +
            '<td class="msg-aviso">' + brl(x.diferenca) + "</td></tr>"; }))
          .concat(delivery.soCupom.map(function (x) { return '<tr class="destaque">' + celCupom(x) + '<td>—</td><td class="msg-erro">não está no BB</td></tr>'; })));
      html += '<h3 class="mini">PIX de clientes no BB sem recebimento no cupom</h3><p class="mini">Somam ' + brl(sobraBB) + " (vendas em PIX Delivery dos cupons: " + brl(vendasDelivery) +
        "; diferença " + brl(sobraBB - vendasDelivery) + "). Marque o que não é venda para tirar da conta.</p>" +
        tabela(["PIX", "Pagador", "É do"], delivery.soBB.map(function (l) {
          return "<tr>" + celBB(l) + "<td>" + esc(l.pagador || (l.pagador_tipo === "pj" ? "empresa" : "")) +
            '</td><td><select data-atribuir="' + esc(l.id) + '" aria-label="De qual caixa"><option value="">Não sei</option>' +
            u.caixas.map(function (cx) { return '<option value="' + esc(cx.id) + '"' + (l.caixa === cx.id ? " selected" : "") + ">" + esc(cx.curto) + "</option>"; }).join("") +
            '<option value="fora">Não é venda</option></select></td></tr>';
        }));
      var fora = banco.filter(function (l) { return l.categoria === "pix_terceiro" && l.caixa === "fora"; });
      if (fora.length) html += '<p class="suave mini">Fora da conta (não é venda): ' + fora.map(function (l) {
        return esc(brl(l.valor_centavos) + " às " + C.horaCurta(l.hora)) + ' <button type="button" class="botao fantasma pequeno" data-desfazer="' + esc(l.id) + '">voltar</button>';
      }).join(" · ") + "</p>";
    }
    $("investigar-corpo").innerHTML = html;
    var dlg = $("investigar");
    dlg.dataset.forma = forma;
    dlg.dataset.caixa = caixa || "";
    if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", ""); }
  }

  function marcar(id, valor) {
    u.db.atribuirBanco(id, valor).then(function () {
      (K.banco || []).forEach(function (l) { if (l.id === id) l.caixa = valor || null; });
      u.toast(valor === "fora" ? "Marcado: não é venda." : valor ? "Marcado como do " + u.nomeCaixa(valor) + "." : "Desmarcado.");
      desenhar();
      abrirInvestigar($("investigar").dataset.forma, $("investigar").dataset.caixa);
    }, u.mostrarErro);
  }

  function irPara(d) { $("cf-data").value = d; location.hash = "#conferir"; }

  function iniciar(utilidades) {
    u = utilidades;
    $("cf-data").value = u.hojeISO();
    $("cf-data").addEventListener("change", carregar);
    $("cf-anterior").addEventListener("click", function () { $("cf-data").value = window.Feriados.somarDias(data(), -1); carregar(); });
    $("cf-proximo").addEventListener("click", function () { $("cf-data").value = window.Feriados.somarDias(data(), 1); carregar(); });
    $("cf-conteudo").addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-investigar]");
      if (b) abrirInvestigar(b.dataset.investigar, b.dataset.caixa);
    });
    $("investigar-fechar").addEventListener("click", function () {
      var dlg = $("investigar");
      if (dlg.close) dlg.close(); else dlg.removeAttribute("open");
    });
    $("investigar-corpo").addEventListener("change", function (ev) {
      if (ev.target.dataset.atribuir) marcar(ev.target.dataset.atribuir, ev.target.value);
    });
    $("investigar-corpo").addEventListener("click", function (ev) {
      if (ev.target.dataset.desfazer) marcar(ev.target.dataset.desfazer, "");
    });
  }

  window.Conferir = { iniciar: iniciar, mostrar: carregar, irPara: irPara };
})();
