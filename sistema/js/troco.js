/*
 * Troco de amanhã: depois de salvar um fechamento, "Quer separar o troco de amanhã agora?". A separação
 * (o que fica na gaveta e o que vai para o cofre) é calculada por Calculos.separarTroco e guardada no
 * fechamento (troco_separado). Na abertura seguinte do caixa, o sistema oferece usar essas quantidades
 * (ou a sugestão, se não separou) e avisa quando a contagem fica diferente.
 * Valor do troco de cada caixa: configuracoes.troco_caixas = {"caixa1": 50000, ...} (padrão C.TROCO_PADRAO).
 */
(function () {
  "use strict";
  var C = window.Calculos;
  var u = null;
  var valores = null;          // { caixa: centavos }
  var atual = null;            // { fechamento, contagem, sep, ideal }
  var referencia = null;       // { contagem, rotulo } usada na abertura
  var pedidoAbertura = 0;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return u.escapar(s); }
  function brl(c) { return u.brl(c); }

  function carregarValores() {
    if (valores) return Promise.resolve(valores);
    return u.db.obterConfiguracao("troco_caixas").then(function (t) {
      try { valores = JSON.parse(t || "{}") || {}; } catch (e) { valores = {}; }
      return valores;
    }, function () { valores = {}; return valores; });
  }
  function valorDoCaixa(caixa) { return valores && valores[caixa] > 0 ? +valores[caixa] : C.TROCO_PADRAO; }

  function abrirJanela() { var d = $("troco"); if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute("open", ""); } }
  function fecharJanela() { var d = $("troco"); if (d.close) d.close(); else d.removeAttribute("open"); }

  /* -------------------- Depois do fechamento -------------------- */

  function perguntar(fechamento) {
    atual = { fechamento: fechamento };
    $("troco-titulo").textContent = "Troco de amanhã · " + u.nomeCaixa(fechamento.caixa);
    $("troco-corpo").innerHTML = '<p>Quer separar o troco de amanhã agora?</p><p class="suave mini">O sistema diz quantas notas e moedas de cada valor ' +
      "deixar na gaveta e quanto vai para o cofre. Fica guardado para a próxima abertura deste caixa.</p>" +
      '<div class="acoes"><button type="button" class="botao" data-troco="depois">Agora não</button>' +
      '<button type="button" class="botao primario" data-troco="separar">Sim, separar</button></div>';
    abrirJanela();
  }

  function separar() {
    var f = atual.fechamento;
    $("troco-corpo").innerHTML = '<p class="vazio">Calculando…</p>';
    Promise.all([carregarValores(), u.db.listarConferencias({ de: f.data, ate: f.data, caixa: f.caixa })]).then(function (r) {
      var ab = C.aberturaAntes(r[1] || [], f);
      atual.ideal = ab ? ab.contagem : null;
      atual.alvo = valorDoCaixa(f.caixa);
      calcular();
    }, function (e) { fecharJanela(); u.mostrarErro(e); });
  }

  function calcular() {
    var f = atual.fechamento;
    atual.sep = C.separarTroco({ contagem: f.contagem, alvo: atual.alvo, ideal: atual.ideal });
    atual.deixar = Object.assign({}, atual.sep.deixar);
    desenhar();
  }

  function desenhar() {
    var f = atual.fechamento, cont = f.contagem || {};
    var vs = Object.keys(cont).map(Number).filter(function (v) { return cont[v] > 0; }).sort(function (a, b) { return b - a; });
    var tg = 0, tc = 0;
    var linhas = vs.map(function (v) {
      var g = atual.deixar[v] || 0, c = cont[v] - g;
      tg += g * v; tc += c * v;
      return '<tr><th>' + esc(C.rotuloValor(v)) + '<br><small class="suave">tem ' + cont[v] + '</small></th><td class="troco-ajuste">' +
        '<button type="button" class="botao pequeno" data-menos="' + v + '" aria-label="Menos uma de ' + esc(C.rotuloValor(v)) + '">−</button>' +
        "<strong>" + g + "</strong>" +
        '<button type="button" class="botao pequeno" data-mais="' + v + '" aria-label="Mais uma de ' + esc(C.rotuloValor(v)) + '"' + (g >= cont[v] ? " disabled" : "") + ">+</button></td>" +
        "<td>" + c + "</td></tr>";
    }).join("");
    var avisos = [];
    if (!atual.sep.exato) avisos.push("Não dá para deixar " + brl(atual.alvo) + " exatos sem notas de R$ 100/R$ 200: faltam " + brl(atual.sep.falta) + ".");
    if (tg !== atual.alvo && atual.sep.exato) avisos.push("A gaveta ficou com " + brl(tg) + " (o troco é " + brl(atual.alvo) + ").");
    $("troco-corpo").innerHTML =
      '<div class="dupla"><label class="campo"><span>Troco de amanhã</span><input type="text" inputmode="decimal" class="dinheiro" id="troco-alvo" value="' +
        esc(u.dinheiroCampo(atual.alvo)) + '" autocomplete="off" /></label>' +
      '<div class="campo"><span>&nbsp;</span><button type="button" class="botao" data-troco="padrao">Usar como padrão do ' + esc(u.nomeCaixa(f.caixa)) + "</button></div></div>" +
      '<p class="suave mini">' + (atual.ideal ? "Repõe o que havia na abertura do dia. " : "") + "Moedas ficam, 2 notas de R$ 50, R$ 100 e R$ 200 vão para o cofre. Ajuste com − e +.</p>" +
      '<div class="tabela-rolagem"><table class="tabela-troco"><thead><tr><th></th><th>Gaveta</th><th>Cofre</th></tr></thead><tbody>' + linhas +
      "</tbody></table></div>" +
      '<div class="linha-info forte"><span>Gaveta (troco de amanhã)</span><strong>' + brl(tg) + "</strong></div>" +
      '<div class="linha-info forte"><span>Cofre</span><strong>' + brl(tc) + "</strong></div>" +
      '<p class="suave mini">Contado no fechamento: ' + brl(tg + tc) + ".</p>" +
      (avisos.length ? '<p class="msg-aviso">' + esc(avisos.join(" ")) + "</p>" : "") +
      '<div class="acoes"><button type="button" class="botao" data-troco="depois">Cancelar</button>' +
      '<button type="button" class="botao primario" data-troco="confirmar">Confirmar separação</button></div>';
  }

  function confirmar() {
    var f = atual.fechamento;
    var b = document.querySelector('[data-troco="confirmar"]');
    u.ocupado(b, true, "Salvando…");
    var deixar = {};
    Object.keys(atual.deixar).forEach(function (k) { if (atual.deixar[k] > 0) deixar[k] = atual.deixar[k]; });
    u.db.salvarTroco(f.id, deixar).then(function (salvo) {
      var tg = C.calcularContagem(deixar).total;
      fecharJanela();
      u.toast("Troco separado: " + brl(tg) + " na gaveta · " + brl(C.calcularContagem(f.contagem).total - tg) + " para o cofre");
      if (u.aoSalvar) u.aoSalvar(salvo);
    }, function (e) { u.ocupado(b, false); u.mostrarErro(e); });
  }

  function salvarPadrao() {
    var c = C.reaisParaCentavos($("troco-alvo").value);
    if (!c || c <= 0) { u.mostrarErro({ message: "Valor do troco inválido." }); return; }
    var caixa = atual.fechamento.caixa;
    carregarValores().then(function () {
      var novo = Object.assign({}, valores);
      novo[caixa] = c;
      return u.db.salvarConfiguracao("troco_caixas", JSON.stringify(novo)).then(function () {
        valores = novo;
        u.toast("Troco padrão do " + u.nomeCaixa(caixa) + ": " + brl(c));
      });
    }).catch(u.mostrarErro);
  }

  /* -------------------- Na abertura seguinte -------------------- */

  // Mostra, no formulário de abertura, o troco separado (ou a sugestão) do último fechamento do caixa
  function mostrarAbertura(caixa, data, hora, editando) {
    var el = $("abertura-troco");
    referencia = null;
    el.hidden = true;
    $("abertura-troco-dif").hidden = true;
    if (editando || !caixa || !data) return;
    var meu = ++pedidoAbertura;
    var de = window.Feriados.somarDias(data, -10);
    Promise.all([carregarValores(), u.db.listarConferencias({ de: de, ate: data, caixa: caixa })]).then(function (r) {
      if (meu !== pedidoAbertura) return;
      var confs = r[1] || [];
      var f = C.ultimoFechamento(confs, caixa, data, hora);
      if (!f || !f.contagem) return;
      var quando = u.dataBR(f.data).slice(0, 5) + " às " + C.horaCurta(f.hora);
      var contagem, texto, botao;
      if (f.troco_separado && Object.keys(f.troco_separado).length) {
        contagem = f.troco_separado;
        texto = "Troco separado no fechamento de " + quando + ": <strong>" + brl(C.calcularContagem(contagem).total) + "</strong>";
        botao = "Usar essas quantidades";
      } else {
        var ab = C.aberturaAntes(confs, f);
        var s = C.separarTroco({ contagem: f.contagem, alvo: valorDoCaixa(caixa), ideal: ab ? ab.contagem : null });
        contagem = s.deixar;
        texto = "Sugestão a partir do fechamento de " + quando + ": <strong>" + brl(s.totalDeixar) + "</strong> (o troco não foi separado)";
        botao = "Usar a sugestão";
      }
      referencia = { contagem: contagem, rotulo: botao === "Usar essas quantidades" ? "o troco separado" : "a sugestão" };
      el.innerHTML = '<p class="mini">' + texto + '</p><div class="acoes"><button type="button" class="botao primario" id="abertura-usar">' + botao + "</button></div>";
      el.hidden = false;
      compararAbertura(u.lerContagem());
    }, function () { /* sem a oferta, a abertura continua normal */ });
  }

  // Aviso quando a abertura contada não bate com o troco separado (ou a sugestão)
  function compararAbertura(contagem) {
    var el = $("abertura-troco-dif");
    if (!referencia || !C.calcularContagem(contagem).total) { el.hidden = true; return; }
    var dif = C.compararContagens(referencia.contagem, contagem);
    if (!dif.length) { el.className = "msg-ok mini"; el.textContent = "A contagem bate com " + referencia.rotulo + "."; el.hidden = false; return; }
    el.className = "msg-aviso mini";
    el.textContent = "Diferente de " + referencia.rotulo + ": " + dif.map(function (x) {
      return C.rotuloValor(x.valor) + " (" + x.a + " → " + x.b + ")";
    }).join(", ") + ".";
    el.hidden = false;
  }

  function iniciar(utilidades) {
    u = utilidades;
    $("troco-fechar").addEventListener("click", fecharJanela);
    $("troco-corpo").addEventListener("click", function (ev) {
      var b = ev.target.closest("button");
      if (!b) return;
      var acao = b.dataset.troco;
      if (acao === "depois") fecharJanela();
      if (acao === "separar") separar();
      if (acao === "confirmar") confirmar();
      if (acao === "padrao") salvarPadrao();
      var cont = atual && atual.fechamento.contagem;
      if (b.dataset.menos) { var v = b.dataset.menos; atual.deixar[v] = Math.max(0, (atual.deixar[v] || 0) - 1); desenhar(); }
      if (b.dataset.mais) { var w = b.dataset.mais; atual.deixar[w] = Math.min(cont[w], (atual.deixar[w] || 0) + 1); desenhar(); }
    });
    $("troco-corpo").addEventListener("change", function (ev) {
      if (ev.target.id !== "troco-alvo") return;
      var c = C.reaisParaCentavos(ev.target.value);
      if (!c || c <= 0) { u.mostrarErro({ message: "Valor do troco inválido." }); return; }
      atual.alvo = c;
      calcular();
    });
    $("abertura-troco").addEventListener("click", function (ev) {
      if (ev.target.id !== "abertura-usar" || !referencia) return;
      if (C.calcularContagem(u.lerContagem()).total && !confirm("Trocar a contagem digitada pelas quantidades " + (referencia.rotulo === "a sugestão" ? "da sugestão" : "do troco separado") + "?")) return;
      u.preencherContagem(referencia.contagem);
    });
  }

  window.Troco = { iniciar: iniciar, perguntar: perguntar, mostrarAbertura: mostrarAbertura, compararAbertura: compararAbertura,
    valorDoCaixa: function (cx) { return carregarValores().then(function () { return valorDoCaixa(cx); }); } };
})();
