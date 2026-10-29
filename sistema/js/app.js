/*
 * Telas do Sistema Veneza (página única com abas).
 * As contas ficam em calculos.js; aqui só se lê a tela, chama as contas e mostra o resultado.
 */
(function () {
  "use strict";

  var C = window.Calculos;
  var F = window.Formatos;
  var CFG = window.VENEZA_CONFIG || {};
  var CAIXAS = CFG.CAIXAS || [];
  var DEMO = new URLSearchParams(location.search).get("demo") === "1";

  var LIBS = {
    jspdf: "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js",
    chart: "https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js"
  };
  var RASCUNHO_CONF = "veneza.rascunho.conferencia";
  var RASCUNHO_MOV = "veneza.rascunho.movimento";

  var db = null;
  var usuarioEmail = "";

  /* =============================== Utilidades =============================== */

  function $(id) { return document.getElementById(id); }

  function doisDigitos(n) { return (n < 10 ? "0" : "") + n; }

  function dataISO(d) {
    return d.getFullYear() + "-" + doisDigitos(d.getMonth() + 1) + "-" + doisDigitos(d.getDate());
  }
  function hojeISO() { return dataISO(new Date()); }
  function horaAgora() {
    var d = new Date();
    return doisDigitos(d.getHours()) + ":" + doisDigitos(d.getMinutes());
  }
  function somarDias(iso, dias) {
    var p = iso.split("-");
    var d = new Date(+p[0], +p[1] - 1, +p[2] + dias);
    return dataISO(d);
  }
  function diaDaSemana(iso) {
    var p = iso.split("-");
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    var s = d.toLocaleDateString("pt-BR", { weekday: "long" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function nomeCaixa(id) {
    var c = CAIXAS.filter(function (x) { return x.id === id; })[0];
    return c ? c.curto : id;
  }
  function nomeCaixaLongo(id) {
    var c = CAIXAS.filter(function (x) { return x.id === id; })[0];
    return c ? c.nome : id;
  }

  function brl(c) { return C.formatarBRL(c); }

  // Centavos -> texto para o campo ("1.037,08")
  function dinheiroCampo(c) {
    if (c == null || c === "") return "";
    return brl(c).replace(/^-?R\$\s?/, "");
  }

  // Lê um campo de dinheiro. Vazio = 0 (ou padrão); inválido = null
  function lerDinheiro(input, padrao) {
    var t = input.value.trim();
    if (t === "") { input.removeAttribute("aria-invalid"); return padrao == null ? 0 : padrao; }
    var c = C.reaisParaCentavos(t);
    if (c == null) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
    return c;
  }

  function escapar(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function lerLocal(chave) {
    try { return JSON.parse(localStorage.getItem(chave)); } catch (e) { return null; }
  }
  function gravarLocal(chave, valor) {
    try {
      if (valor == null) localStorage.removeItem(chave);
      else localStorage.setItem(chave, JSON.stringify(valor));
    } catch (e) { /* armazenamento indisponível */ }
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  function mostrarErro(e) {
    var msg = (e && e.message) || String(e);
    $("aviso-texto").textContent = msg;
    $("aviso").hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (e && e.tipo === "sessao" && !DEMO) {
      // Volta para o login sem apagar nada: os rascunhos ficam guardados no aparelho
      mostrarTela("login");
      $("login-erro").textContent = msg;
      $("login-erro").hidden = false;
    }
  }
  function limparErro() { $("aviso").hidden = true; }

  function ocupado(botao, sim, textoOcupado) {
    if (sim) {
      botao.dataset.texto = botao.textContent;
      botao.textContent = textoOcupado || "Aguarde…";
      botao.disabled = true;
    } else {
      if (botao.dataset.texto) botao.textContent = botao.dataset.texto;
      botao.disabled = false;
    }
  }

  function copiar(texto) {
    function alternativo() {
      var ta = document.createElement("textarea");
      ta.value = texto;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    }
    var p = navigator.clipboard && window.isSecureContext
      ? navigator.clipboard.writeText(texto).then(function () { return true; }, alternativo)
      : Promise.resolve(alternativo());
    return p.then(function (ok) {
      toast(ok ? "Copiado. É só colar no WhatsApp." : "Não foi possível copiar neste aparelho.");
    });
  }

  function baixar(nome, conteudo, tipo) {
    var blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  var scripts = {};
  function carregarScript(url) {
    if (!scripts[url]) {
      scripts[url] = new Promise(function (ok, falha) {
        var s = document.createElement("script");
        s.src = url;
        s.onload = ok;
        s.onerror = function () {
          delete scripts[url];
          falha(window.BancoVeneza.erroAmigavel({ message: "Failed to fetch" }, "carregar este recurso"));
        };
        document.head.appendChild(s);
      });
    }
    return scripts[url];
  }

  // Alternador de botões (Abertura/Fechamento, Caixa 1/Caixa 2…)
  function alternador(el, aoMudar) {
    el.addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-valor]");
      if (!b) return;
      definirAlternador(el, b.dataset.valor);
      if (aoMudar) aoMudar(b.dataset.valor);
    });
  }
  function definirAlternador(el, valor) {
    el.dataset.valor = valor || "";
    Array.prototype.forEach.call(el.querySelectorAll("button[data-valor]"), function (b) {
      b.setAttribute("aria-checked", String(b.dataset.valor === valor));
    });
  }
  function botoesCaixa(el) {
    el.innerHTML = CAIXAS.map(function (c) {
      var detalhe = c.nome.replace(c.curto, "").replace(/[()]/g, "").trim();
      return '<button type="button" role="radio" data-valor="' + escapar(c.id) + '">' + escapar(c.curto) +
        (detalhe ? " <small>" + escapar(detalhe) + "</small>" : "") + "</button>";
    }).join("");
  }

  /* ================================ Telas ================================ */

  function mostrarTela(qual) {
    $("tela-carregando").hidden = qual !== "carregando";
    $("tela-config").hidden = qual !== "config";
    $("tela-login").hidden = qual !== "login";
    $("app").hidden = qual !== "app";
  }

  var ABAS = ["caixa", "historico", "movimentos", "relatorio"];
  var abaAtual = null;
  function mostrarAba() {
    var aba = location.hash.replace("#", "");
    if (ABAS.indexOf(aba) < 0) aba = "caixa";
    ABAS.forEach(function (a) { $("aba-" + a).hidden = a !== aba; });
    Array.prototype.forEach.call(document.querySelectorAll(".abas a"), function (a) {
      a.classList.toggle("ativa", a.dataset.aba === aba);
      if (a.dataset.aba === aba) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    $("barra-total").hidden = aba !== "caixa";
    var mudou = abaAtual !== aba;
    abaAtual = aba;
    if (!mudou) return;
    if (aba === "caixa") atualizarContexto();
    if (aba === "historico") buscarHistorico();
    if (aba === "movimentos") listarMovimentosDoDia();
    if (aba === "relatorio" && !relatorioGerado) gerarRelatorio();
  }

  /* ========================= Módulo 1: Conferência ========================= */

  var conf = {
    editId: null,
    editRotulo: "",
    fundoManual: false,
    movimentos: { sangrias: 0, suprimentos: 0 },
    pedido: 0
  };

  function montarLinhasContagem() {
    function linhas(valores) {
      return valores.map(function (v) {
        return '<div class="linha-contagem" data-valor="' + v + '">' +
          '<span class="valor">' + escapar(C.rotuloValor(v)) + "</span>" +
          '<button type="button" class="menos" aria-label="Menos uma de ' + escapar(C.rotuloValor(v)) + '">−</button>' +
          '<input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="5" autocomplete="off" ' +
          'aria-label="Quantidade de ' + escapar(C.rotuloValor(v)) + '" value="0" />' +
          '<button type="button" class="mais" aria-label="Mais uma de ' + escapar(C.rotuloValor(v)) + '">+</button>' +
          '<span class="sub">R$ 0,00</span></div>';
      }).join("");
    }
    $("linhas-cedulas").innerHTML = linhas(C.CEDULAS);
    $("linhas-moedas").innerHTML = linhas(C.MOEDAS);

    function aoClicar(ev) {
      var b = ev.target.closest("button");
      if (!b) return;
      var linha = b.closest(".linha-contagem");
      var input = linha.querySelector("input");
      var q = parseInt(input.value, 10) || 0;
      q = b.classList.contains("mais") ? q + 1 : Math.max(0, q - 1);
      input.value = String(Math.min(q, 99999));
      atualizarConferencia();
    }
    function aoDigitar(ev) {
      if (ev.target.tagName !== "INPUT") return;
      var limpo = ev.target.value.replace(/\D/g, "").slice(0, 5);
      if (limpo !== ev.target.value) ev.target.value = limpo;
      atualizarConferencia();
    }
    function aoSair(ev) {
      if (ev.target.tagName === "INPUT" && ev.target.value === "") ev.target.value = "0";
    }
    function aoEntrar(ev) {
      if (ev.target.tagName === "INPUT") ev.target.select();
    }
    ["linhas-cedulas", "linhas-moedas"].forEach(function (id) {
      var el = $(id);
      el.addEventListener("click", aoClicar);
      el.addEventListener("input", aoDigitar);
      el.addEventListener("focusout", aoSair);
      el.addEventListener("focusin", aoEntrar);
    });
  }

  function lerContagem() {
    var cont = {};
    Array.prototype.forEach.call(document.querySelectorAll(".linha-contagem"), function (l) {
      var q = parseInt(l.querySelector("input").value, 10) || 0;
      if (q > 0) cont[l.dataset.valor] = q;
    });
    return cont;
  }

  var CAMPOS_DINHEIRO = {
    fundo: "conf-fundo", vendas: "conf-vendas", recebimentos: "conf-recebimentos", pix: "conf-pix",
    debito: "conf-debito", credito: "conf-credito", carteira: "conf-carteira", troco: "conf-troco"
  };

  // Estado do formulário como texto (para o rascunho)
  function lerFormularioConf() {
    var f = {
      tipo: $("conf-tipo").dataset.valor || "abertura",
      caixa: $("conf-caixa").dataset.valor || "",
      operador: $("conf-operador").value,
      data: $("conf-data").value,
      hora: $("conf-hora").value,
      contagem: lerContagem(),
      observacao: $("conf-observacao").value,
      editId: conf.editId,
      editRotulo: conf.editRotulo,
      fundoManual: conf.fundoManual,
      textos: {}
    };
    Object.keys(CAMPOS_DINHEIRO).forEach(function (k) { f.textos[k] = $(CAMPOS_DINHEIRO[k]).value; });
    return f;
  }

  function preencherFormularioConf(f) {
    definirAlternador($("conf-tipo"), f.tipo || "abertura");
    definirAlternador($("conf-caixa"), f.caixa || (CAIXAS[0] && CAIXAS[0].id));
    $("conf-operador").value = f.operador || "";
    $("conf-data").value = f.data || hojeISO();
    $("conf-hora").value = f.hora || horaAgora();
    $("conf-observacao").value = f.observacao || "";
    Array.prototype.forEach.call(document.querySelectorAll(".linha-contagem"), function (l) {
      var q = f.contagem && f.contagem[l.dataset.valor];
      l.querySelector("input").value = String(q > 0 ? q : 0);
    });
    var textos = f.textos || {};
    Object.keys(CAMPOS_DINHEIRO).forEach(function (k) {
      var el = $(CAMPOS_DINHEIRO[k]);
      el.value = textos[k] != null ? textos[k] : "";
      el.removeAttribute("aria-invalid");
    });
    if (!$("conf-fundo").value) $("conf-fundo").value = dinheiroCampo(C.FUNDO_PADRAO);
    if (!$("conf-troco").value) $("conf-troco").value = dinheiroCampo(C.TROCO_PADRAO);
    conf.editId = f.editId || null;
    conf.editRotulo = f.editRotulo || "";
    conf.fundoManual = !!f.fundoManual;
    $("editando").hidden = !conf.editId;
    $("editando-texto").textContent = conf.editRotulo || "Editando registro";
  }

  function formularioVazio() {
    var atual = lerLocal(RASCUNHO_CONF) || {};
    return {
      tipo: atual.tipo || "abertura",
      caixa: atual.caixa || (CAIXAS[0] && CAIXAS[0].id),
      operador: atual.operador || "",
      data: hojeISO(),
      hora: horaAgora(),
      contagem: {},
      observacao: "",
      textos: {}
    };
  }

  // Recalcula tudo e mostra na tela. Também salva o rascunho.
  function atualizarConferencia() {
    var cont = C.calcularContagem(lerContagem());
    Array.prototype.forEach.call(document.querySelectorAll(".linha-contagem"), function (l) {
      var v = +l.dataset.valor;
      var q = parseInt(l.querySelector("input").value, 10) || 0;
      l.querySelector(".sub").textContent = brl(v * q);
      l.classList.toggle("tem", q > 0);
    });
    $("sub-cedulas").textContent = brl(cont.totalCedulas);
    $("sub-moedas").textContent = brl(cont.totalMoedas);
    $("total-contado").textContent = brl(cont.total);
    $("barra-contado").textContent = brl(cont.total);

    var fechamento = $("conf-tipo").dataset.valor === "fechamento";
    $("bloco-fechamento").hidden = !fechamento;
    var barraDif = $("barra-diferenca");
    if (fechamento) {
      var fundo = lerDinheiro($("conf-fundo"), C.FUNDO_PADRAO);
      var vendas = lerDinheiro($("conf-vendas"));
      var receb = lerDinheiro($("conf-recebimentos"));
      var troco = lerDinheiro($("conf-troco"), C.TROCO_PADRAO);
      ["conf-pix", "conf-debito", "conf-credito", "conf-carteira"].forEach(function (id) { lerDinheiro($(id)); });
      $("conf-sangrias").textContent = brl(conf.movimentos.sangrias);
      $("conf-suprimentos").textContent = brl(conf.movimentos.suprimentos);
      var invalido = fundo == null || vendas == null || receb == null;
      if (invalido) {
        $("conf-esperado").textContent = "—";
        $("conf-diferenca").className = "diferenca bateu";
        $("conf-diferenca").textContent = "Confira os valores digitados";
        barraDif.hidden = true;
      } else {
        var r = C.calcularFechamento({
          contagem: lerContagem(), fundo: fundo, vendas: vendas, recebimentos: receb,
          sangrias: conf.movimentos.sangrias, suprimentos: conf.movimentos.suprimentos,
          trocoAmanha: troco == null ? C.TROCO_PADRAO : troco
        });
        $("conf-esperado").textContent = brl(r.esperado);
        var texto = F.linhaDiferenca(r.diferenca);
        $("conf-diferenca").className = "diferenca " + r.situacao;
        $("conf-diferenca").textContent = texto;
        barraDif.className = "barra-dif " + r.situacao;
        barraDif.textContent = texto;
        barraDif.hidden = false;
        if (r.cofre >= 0) {
          $("cofre-rotulo").textContent = "Guardar no cofre";
          $("conf-cofre").textContent = brl(r.cofre);
        } else {
          $("cofre-rotulo").textContent = "Falta para o troco";
          $("conf-cofre").textContent = brl(-r.cofre);
        }
      }
    } else {
      barraDif.hidden = true;
    }
    gravarLocal(RASCUNHO_CONF, lerFormularioConf());
  }

  // Busca a abertura (fundo) e as sangrias/suprimentos do dia e caixa escolhidos
  function atualizarContexto() {
    if (!db || $("conf-tipo").dataset.valor !== "fechamento") return Promise.resolve();
    var data = $("conf-data").value;
    var caixa = $("conf-caixa").dataset.valor;
    if (!data || !caixa) return Promise.resolve();
    var pedido = ++conf.pedido;
    $("movimentos-estado").textContent = "Buscando abertura, sangrias e suprimentos…";
    return Promise.all([
      db.listarConferencias({ de: data, ate: data, caixa: caixa }),
      db.listarMovimentos({ de: data, ate: data, caixa: caixa })
    ]).then(function (res) {
      if (pedido !== conf.pedido) return;
      var confs = res[0], movs = res[1];
      conf.movimentos = C.somarMovimentos(movs, data, caixa);
      var qtd = movs.length;
      $("movimentos-estado").textContent = qtd
        ? qtd + (qtd === 1 ? " lançamento" : " lançamentos") + " de sangria/suprimento neste dia e caixa."
        : "Nenhuma sangria ou suprimento neste dia e caixa.";
      var aberturas = confs.filter(function (c) { return c.tipo === "abertura"; });
      if (!conf.fundoManual) {
        $("conf-fundo").value = dinheiroCampo(C.fundoDoDia(confs, data, caixa));
        if (aberturas.length) {
          var ult = aberturas.sort(function (a, b) { return String(a.hora).localeCompare(String(b.hora)); })[aberturas.length - 1];
          $("fundo-origem").textContent = "Da abertura das " + C.horaCurta(ult.hora) + ".";
        } else {
          $("fundo-origem").textContent = "Sem abertura neste dia: usando o padrão de " + brl(C.FUNDO_PADRAO) + ".";
        }
      } else {
        $("fundo-origem").textContent = "Valor digitado.";
      }
      atualizarConferencia();
    }, function (e) {
      if (pedido !== conf.pedido) return;
      $("movimentos-estado").textContent = "Não foi possível buscar sangrias e suprimentos (" + e.message + ")";
      if (e.tipo === "sessao") mostrarErro(e);
    });
  }

  function validarConferencia() {
    var f = lerFormularioConf();
    if (!f.caixa) return "Escolha o caixa.";
    if (!f.data) return "Preencha a data.";
    if (!f.hora) return "Preencha a hora.";
    if (f.tipo === "fechamento") {
      var nomes = { fundo: "Fundo de caixa", vendas: "Vendas em dinheiro", recebimentos: "Recebimentos em dinheiro",
        pix: "PIX", debito: "Cartão débito", credito: "Cartão crédito", carteira: "Carteira", troco: "Troco para amanhã" };
      for (var k in CAMPOS_DINHEIRO) {
        if ($(CAMPOS_DINHEIRO[k]).value.trim() !== "" && C.reaisParaCentavos($(CAMPOS_DINHEIRO[k]).value) == null) {
          return "Valor inválido em \"" + nomes[k] + "\". Use só números, por exemplo 1.037,08.";
        }
      }
    }
    return null;
  }

  function dadosConferencia() {
    var tipo = $("conf-tipo").dataset.valor;
    var d = {
      tipo: tipo,
      caixa: $("conf-caixa").dataset.valor,
      operador: $("conf-operador").value.trim(),
      data: $("conf-data").value,
      hora: $("conf-hora").value,
      contagem: lerContagem(),
      observacao: $("conf-observacao").value.trim()
    };
    var fech = tipo === "fechamento";
    function opcional(id) {
      if (!fech || $(id).value.trim() === "") return null;
      return C.reaisParaCentavos($(id).value);
    }
    d.fundo_centavos = fech ? lerDinheiro($("conf-fundo"), C.FUNDO_PADRAO) : null;
    d.vendas_dinheiro_centavos = fech ? lerDinheiro($("conf-vendas")) : null;
    d.recebimentos_dinheiro_centavos = fech ? lerDinheiro($("conf-recebimentos")) : null;
    d.troco_amanha_centavos = fech ? lerDinheiro($("conf-troco"), C.TROCO_PADRAO) : null;
    d.pix_centavos = opcional("conf-pix");
    d.debito_centavos = opcional("conf-debito");
    d.credito_centavos = opcional("conf-credito");
    d.carteira_centavos = opcional("conf-carteira");
    return d;
  }

  function salvarConferencia() {
    limparErro();
    var erro = validarConferencia();
    if (erro) { mostrarErro({ message: erro }); return; }
    var d = dadosConferencia();
    if (C.calcularContagem(d.contagem).total === 0 &&
        !confirm("O total contado está em R$ 0,00. Salvar assim mesmo?")) return;
    var botao = $("conf-salvar");
    ocupado(botao, true, "Salvando…");
    db.salvarConferencia(d, conf.editId).then(function (salvo) {
      var eraEdicao = !!conf.editId;
      var msg = "Salvo: " + F.nomeTipo(salvo.tipo) + " · " + nomeCaixa(salvo.caixa) + " · " + brl(salvo.total_centavos);
      if (salvo.tipo === "fechamento") msg += " · " + F.linhaDiferenca(salvo.diferenca_centavos);
      gravarLocal(RASCUNHO_CONF, null);
      var proximo = formularioVazio();
      proximo.tipo = salvo.tipo;
      proximo.caixa = salvo.caixa;
      proximo.operador = salvo.operador;
      preencherFormularioConf(proximo);
      atualizarConferencia();
      atualizarContexto();
      relatorioGerado = false;
      toast(msg);
      if (eraEdicao) location.hash = "#historico";
    }, mostrarErro).then(function () { ocupado(botao, false); });
  }

  function limparConferencia() {
    var temAlgo = C.calcularContagem(lerContagem()).total > 0 || $("conf-vendas").value || $("conf-observacao").value;
    if (temAlgo && !confirm("Apagar tudo o que foi digitado nesta contagem?")) return;
    gravarLocal(RASCUNHO_CONF, null);
    var f = formularioVazio();
    f.tipo = $("conf-tipo").dataset.valor;
    f.caixa = $("conf-caixa").dataset.valor;
    f.operador = $("conf-operador").value;
    preencherFormularioConf(f);
    atualizarConferencia();
    atualizarContexto();
    limparErro();
  }

  function editarConferencia(r) {
    var textos = {};
    var campos = { fundo: "fundo_centavos", vendas: "vendas_dinheiro_centavos", recebimentos: "recebimentos_dinheiro_centavos",
      pix: "pix_centavos", debito: "debito_centavos", credito: "credito_centavos", carteira: "carteira_centavos",
      troco: "troco_amanha_centavos" };
    Object.keys(campos).forEach(function (k) { textos[k] = dinheiroCampo(r[campos[k]]); });
    preencherFormularioConf({
      tipo: r.tipo, caixa: r.caixa, operador: r.operador, data: r.data, hora: C.horaCurta(r.hora),
      contagem: r.contagem, observacao: r.observacao, textos: textos, editId: r.id, fundoManual: true,
      editRotulo: "Editando: " + F.nomeTipo(r.tipo) + " · " + nomeCaixa(r.caixa) + " · " + C.dataBR(r.data) + " " + C.horaCurta(r.hora)
    });
    atualizarConferencia();
    location.hash = "#caixa";
    atualizarContexto();
    window.scrollTo(0, 0);
  }

  function cancelarEdicao() {
    gravarLocal(RASCUNHO_CONF, null);
    preencherFormularioConf(formularioVazio());
    atualizarConferencia();
    atualizarContexto();
  }

  function iniciarConferencia() {
    botoesCaixa($("conf-caixa"));
    montarLinhasContagem();
    alternador($("conf-tipo"), function () { atualizarConferencia(); atualizarContexto(); });
    alternador($("conf-caixa"), function () { atualizarConferencia(); atualizarContexto(); });
    $("conf-data").addEventListener("change", function () { atualizarConferencia(); atualizarContexto(); });
    ["conf-operador", "conf-hora", "conf-observacao"].forEach(function (id) {
      $(id).addEventListener("input", atualizarConferencia);
    });
    Object.keys(CAMPOS_DINHEIRO).forEach(function (k) {
      var el = $(CAMPOS_DINHEIRO[k]);
      el.addEventListener("input", function () {
        if (k === "fundo") { conf.fundoManual = true; $("fundo-origem").textContent = "Valor digitado."; }
        atualizarConferencia();
      });
      el.addEventListener("blur", function () {
        var c = C.reaisParaCentavos(el.value);
        if (c != null) el.value = dinheiroCampo(c);
      });
    });
    $("conf-salvar").addEventListener("click", salvarConferencia);
    $("conf-limpar").addEventListener("click", limparConferencia);
    $("cancelar-edicao").addEventListener("click", cancelarEdicao);

    var rascunho = lerLocal(RASCUNHO_CONF);
    preencherFormularioConf(rascunho || formularioVazio());
    atualizarConferencia();
    if (rascunho && C.calcularContagem(rascunho.contagem).total > 0) {
      toast("Contagem não salva recuperada.");
    }
  }

  /* ========================== Histórico ========================== */

  var historico = [];
  var registroAberto = null;

  function buscarHistorico() {
    limparErro();
    var de = $("hist-de").value, ate = $("hist-ate").value;
    if (de && ate && de > ate) { mostrarErro({ message: "A data \"De\" está depois da data \"Até\"." }); return; }
    $("hist-lista").innerHTML = '<p class="vazio">Carregando…</p>';
    var botao = $("hist-buscar");
    ocupado(botao, true, "Buscando…");
    db.listarConferencias({ de: de, ate: ate, caixa: $("hist-caixa").value }).then(function (lista) {
      historico = lista;
      desenharHistorico();
    }, function (e) {
      $("hist-lista").innerHTML = '<p class="vazio">Não foi possível carregar.</p>';
      mostrarErro(e);
    }).then(function () { ocupado(botao, false); });
  }

  function registrosPorDia(lista) {
    var dias = {};
    lista.forEach(function (r) { (dias[r.data] = dias[r.data] || []).push(r); });
    return Object.keys(dias).sort().reverse().map(function (d) {
      return { data: d, registros: F.ordenarPorHora(dias[d]) };
    });
  }

  function desenharHistorico() {
    var dias = registrosPorDia(historico);
    if (!dias.length) {
      $("hist-lista").innerHTML = '<p class="vazio">Nenhum registro neste período.</p>';
      return;
    }
    $("hist-lista").innerHTML = dias.map(function (dia) {
      return '<section class="dia">' +
        '<div class="dia-topo"><h2>' + escapar(diaDaSemana(dia.data)) + ", " + C.dataBR(dia.data) + "</h2>" +
        '<div class="acoes"><button type="button" class="botao pequeno" data-copiar-dia="' + dia.data + '">Copiar o dia</button>' +
        '<button type="button" class="botao pequeno" data-pdf-dia="' + dia.data + '">PDF do dia</button></div></div>' +
        dia.registros.map(function (r) {
          var dif = "";
          if (r.tipo === "fechamento") {
            var s = C.classificarDiferenca(r.diferenca_centavos);
            dif = '<span class="r-dif cor-' + s + '">' + escapar(F.linhaDiferenca(r.diferenca_centavos)) + "</span>";
          } else {
            dif = '<span class="r-dif"></span>';
          }
          return '<button type="button" class="registro" data-id="' + escapar(r.id) + '">' +
            '<span class="r-titulo"><span class="etiqueta">' + escapar(F.nomeTipo(r.tipo)) + "</span>" + escapar(nomeCaixa(r.caixa)) + "</span>" +
            '<span class="r-total">' + brl(r.total_centavos) + "</span>" +
            '<span class="r-sub">' + C.horaCurta(r.hora) + (r.operador ? " · " + escapar(r.operador) : "") + "</span>" +
            dif + "</button>";
        }).join("") + "</section>";
    }).join("");
  }

  function registrosDoDia(data) {
    return historico.filter(function (r) { return r.data === data; });
  }

  function abrirDetalhe(r) {
    registroAberto = r;
    $("detalhe-titulo").textContent = F.nomeTipo(r.tipo) + " · " + nomeCaixa(r.caixa);
    $("detalhe-texto").textContent = F.textoConferencia(r, nomeCaixa).replace(/\*/g, "");
    $("detalhe-autoria").textContent = autoria(r);
    var dlg = $("detalhe");
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
  }
  function fecharDetalhe() {
    var dlg = $("detalhe");
    if (dlg.close) dlg.close(); else dlg.removeAttribute("open");
  }

  function dataHoraBR(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    return d.toLocaleDateString("pt-BR") + " " + doisDigitos(d.getHours()) + ":" + doisDigitos(d.getMinutes());
  }
  function autoria(r) {
    var t = "Criado por " + (r.criado_por || "?") + " em " + dataHoraBR(r.criado_em);
    if (r.editado_por) t += " · editado por " + r.editado_por + " em " + dataHoraBR(r.editado_em);
    return t;
  }

  function apagarRegistroAberto() {
    var r = registroAberto;
    if (!r) return;
    var desc = F.nomeTipo(r.tipo) + " do " + nomeCaixa(r.caixa) + " de " + C.dataBR(r.data) + " às " + C.horaCurta(r.hora);
    if (!confirm("Apagar " + desc + "? Isso não pode ser desfeito.")) return;
    db.apagarConferencia(r.id).then(function () {
      fecharDetalhe();
      historico = historico.filter(function (x) { return x.id !== r.id; });
      desenharHistorico();
      relatorioGerado = false;
      if (conf.editId === r.id) cancelarEdicao();
      toast("Registro apagado.");
    }, function (e) { fecharDetalhe(); mostrarErro(e); });
  }

  function exportarHistoricoCSV() {
    if (!historico.length) { toast("Nada para exportar neste período."); return; }
    var nome = "conferencias_" + ($("hist-de").value || "inicio") + "_a_" + ($("hist-ate").value || "hoje") + ".csv";
    baixar(nome, F.csvConferencias(historico, nomeCaixa), "text/csv;charset=utf-8");
  }

  function iniciarHistorico() {
    var sel = $("hist-caixa");
    sel.innerHTML = '<option value="">Todos os caixas</option>' + CAIXAS.map(function (c) {
      return '<option value="' + escapar(c.id) + '">' + escapar(c.nome) + "</option>";
    }).join("");
    $("hist-ate").value = hojeISO();
    $("hist-de").value = somarDias(hojeISO(), -30);
    $("hist-buscar").addEventListener("click", buscarHistorico);
    $("hist-caixa").addEventListener("change", buscarHistorico);
    $("hist-csv").addEventListener("click", exportarHistoricoCSV);
    $("hist-lista").addEventListener("click", function (ev) {
      var b = ev.target.closest("button");
      if (!b) return;
      if (b.dataset.copiarDia) copiar(F.textoDia(registrosDoDia(b.dataset.copiarDia), nomeCaixa));
      else if (b.dataset.pdfDia) pdfRegistros(registrosDoDia(b.dataset.pdfDia), "conferencia_" + b.dataset.pdfDia + ".pdf");
      else if (b.dataset.id) {
        var r = historico.filter(function (x) { return x.id === b.dataset.id; })[0];
        if (r) abrirDetalhe(r);
      }
    });
    $("detalhe-fechar").addEventListener("click", fecharDetalhe);
    $("detalhe-copiar").addEventListener("click", function () { copiar(F.textoConferencia(registroAberto, nomeCaixa)); });
    $("detalhe-pdf").addEventListener("click", function () {
      var r = registroAberto;
      pdfRegistros([r], "conferencia_" + r.data + "_" + r.caixa + "_" + r.tipo + ".pdf");
    });
    $("detalhe-editar").addEventListener("click", function () { fecharDetalhe(); editarConferencia(registroAberto); });
    $("detalhe-apagar").addEventListener("click", apagarRegistroAberto);
  }

  /* ================================ PDF ================================ */

  function textoPDF(s) {
    return String(s).replace(/—/g, "-").replace(/−/g, "-").replace(/ /g, " ");
  }

  function pdfRegistros(registros, nomeArquivo) {
    if (!registros || !registros.length) return;
    toast("Gerando PDF…");
    carregarScript(LIBS.jspdf).then(function () {
      var doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
      var margem = 18, y = margem, alturaLinha = 6, limite = 297 - margem;
      function linha(texto, negrito, tamanho) {
        doc.setFont("helvetica", negrito ? "bold" : "normal");
        doc.setFontSize(tamanho || 11);
        var partes = doc.splitTextToSize(textoPDF(texto), 210 - 2 * margem);
        partes.forEach(function (p) {
          if (y > limite) { doc.addPage(); y = margem; }
          doc.text(p, margem, y);
          y += alturaLinha * ((tamanho || 11) / 11);
        });
      }
      F.ordenarPorHora(registros).forEach(function (r, i) {
        if (i > 0) {
          y += 4;
          if (y > limite - 40) { doc.addPage(); y = margem; }
          doc.setDrawColor(180);
          doc.line(margem, y - 3, 210 - margem, y - 3);
          y += 3;
        }
        F.textoConferencia(r, nomeCaixa).split("\n").forEach(function (l, n) {
          if (l === "") { y += 2; return; }
          var negrito = /^\*.*\*$/.test(l);
          linha(l.replace(/\*/g, ""), negrito, n === 0 ? 14 : 11);
        });
        linha(autoria(r), false, 8);
      });
      doc.save(nomeArquivo);
    }).catch(mostrarErro);
  }

  /* ===================== Módulo 2: Sangria e suprimento ===================== */

  var mov = { editId: null, lista: [] };

  function lerFormularioMov() {
    return {
      tipo: $("mov-tipo").dataset.valor,
      caixa: $("mov-caixa").dataset.valor,
      data: $("mov-data").value,
      hora: $("mov-hora").value,
      valor: $("mov-valor").value,
      motivo: $("mov-motivo").value,
      responsavel: $("mov-responsavel").value,
      editId: mov.editId
    };
  }
  function preencherFormularioMov(f) {
    definirAlternador($("mov-tipo"), f.tipo || "sangria");
    definirAlternador($("mov-caixa"), f.caixa || (CAIXAS[0] && CAIXAS[0].id));
    $("mov-data").value = f.data || hojeISO();
    $("mov-hora").value = f.hora || horaAgora();
    $("mov-valor").value = f.valor || "";
    $("mov-valor").removeAttribute("aria-invalid");
    $("mov-motivo").value = f.motivo || "";
    $("mov-responsavel").value = f.responsavel || "";
    mov.editId = f.editId || null;
    $("mov-editando").hidden = !mov.editId;
  }
  function rascunhoMov() { gravarLocal(RASCUNHO_MOV, lerFormularioMov()); }

  function novoFormularioMov(base) {
    preencherFormularioMov({
      tipo: base && base.tipo, caixa: base && base.caixa, responsavel: base && base.responsavel
    });
    gravarLocal(RASCUNHO_MOV, null);
  }

  function salvarMovimento() {
    limparErro();
    var f = lerFormularioMov();
    var valor = C.reaisParaCentavos(f.valor);
    if (!f.caixa) { mostrarErro({ message: "Escolha o caixa." }); return; }
    if (!f.data || !f.hora) { mostrarErro({ message: "Preencha a data e a hora." }); return; }
    if (valor == null || valor <= 0) {
      $("mov-valor").setAttribute("aria-invalid", "true");
      mostrarErro({ message: "Digite um valor maior que zero, por exemplo 150,00." });
      return;
    }
    var botao = $("mov-salvar");
    ocupado(botao, true, "Salvando…");
    db.salvarMovimento({
      tipo: f.tipo, caixa: f.caixa, data: f.data, hora: f.hora, valor_centavos: valor,
      motivo: f.motivo.trim(), responsavel: f.responsavel.trim()
    }, mov.editId).then(function (salvo) {
      toast((salvo.tipo === "sangria" ? "Sangria" : "Suprimento") + " de " + brl(salvo.valor_centavos) + " salvo.");
      novoFormularioMov({ tipo: salvo.tipo, caixa: salvo.caixa, responsavel: salvo.responsavel });
      $("mov-dia").value = salvo.data;
      listarMovimentosDoDia();
      aposMudarMovimento();
    }, mostrarErro).then(function () { ocupado(botao, false); });
  }

  function aposMudarMovimento() {
    relatorioGerado = false;
    atualizarContexto();
  }

  function listarMovimentosDoDia() {
    var dia = $("mov-dia").value || hojeISO();
    $("mov-lista").innerHTML = '<p class="vazio">Carregando…</p>';
    db.listarMovimentos({ de: dia, ate: dia }).then(function (lista) {
      mov.lista = lista;
      desenharMovimentos(dia);
    }, function (e) {
      $("mov-lista").innerHTML = '<p class="vazio">Não foi possível carregar.</p>';
      mostrarErro(e);
    });
  }

  function desenharMovimentos(dia) {
    if (!mov.lista.length) {
      $("mov-lista").innerHTML = '<p class="vazio">Nenhum lançamento em ' + C.dataBR(dia) + ".</p>";
      return;
    }
    var ids = CAIXAS.map(function (c) { return c.id; });
    mov.lista.forEach(function (m) { if (ids.indexOf(m.caixa) < 0) ids.push(m.caixa); });
    $("mov-lista").innerHTML = ids.map(function (caixa) {
      var itens = F.ordenarPorHora(mov.lista.filter(function (m) { return m.caixa === caixa; }));
      if (!itens.length) return "";
      var t = C.somarMovimentos(itens);
      return '<div class="grupo-caixa"><h3>' + escapar(nomeCaixaLongo(caixa)) + "</h3>" +
        '<div class="totais-caixa"><span>Sangrias: <strong class="cor-falta">' + brl(t.sangrias) + "</strong></span>" +
        '<span>Suprimentos: <strong class="cor-sobra">' + brl(t.suprimentos) + "</strong></span></div>" +
        itens.map(function (m) {
          var sangria = m.tipo === "sangria";
          return '<div class="mov">' +
            '<span><span class="etiqueta">' + (sangria ? "Sangria" : "Suprimento") + "</span>" + C.horaCurta(m.hora) + "</span>" +
            '<span class="m-valor ' + (sangria ? "cor-falta" : "cor-sobra") + '">' + (sangria ? "− " : "+ ") + brl(m.valor_centavos) + "</span>" +
            '<span class="m-info" style="grid-column:1/-1">' + escapar(m.motivo || "Sem motivo") +
            (m.responsavel ? " · " + escapar(m.responsavel) : "") + "</span>" +
            '<span class="m-botoes"><button type="button" class="botao pequeno" data-editar="' + escapar(m.id) + '">Editar</button>' +
            '<button type="button" class="botao pequeno perigo" data-apagar="' + escapar(m.id) + '">Apagar</button></span></div>';
        }).join("") + "</div>";
    }).join("");
  }

  function iniciarMovimentos() {
    botoesCaixa($("mov-caixa"));
    alternador($("mov-tipo"), rascunhoMov);
    alternador($("mov-caixa"), rascunhoMov);
    ["mov-data", "mov-hora", "mov-valor", "mov-motivo", "mov-responsavel"].forEach(function (id) {
      $(id).addEventListener("input", rascunhoMov);
    });
    $("mov-valor").addEventListener("blur", function () {
      var c = C.reaisParaCentavos($("mov-valor").value);
      if (c != null) { $("mov-valor").value = dinheiroCampo(c); $("mov-valor").removeAttribute("aria-invalid"); }
    });
    $("mov-salvar").addEventListener("click", salvarMovimento);
    $("mov-cancelar").addEventListener("click", function () { novoFormularioMov(lerFormularioMov()); });
    $("mov-dia").value = hojeISO();
    $("mov-dia").addEventListener("change", listarMovimentosDoDia);
    $("mov-lista").addEventListener("click", function (ev) {
      var b = ev.target.closest("button");
      if (!b) return;
      var id = b.dataset.editar || b.dataset.apagar;
      var m = mov.lista.filter(function (x) { return x.id === id; })[0];
      if (!m) return;
      if (b.dataset.editar) {
        preencherFormularioMov({
          tipo: m.tipo, caixa: m.caixa, data: m.data, hora: C.horaCurta(m.hora), valor: dinheiroCampo(m.valor_centavos),
          motivo: m.motivo, responsavel: m.responsavel, editId: m.id
        });
        rascunhoMov();
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        var desc = (m.tipo === "sangria" ? "a sangria" : "o suprimento") + " de " + brl(m.valor_centavos) +
          " (" + nomeCaixa(m.caixa) + ", " + C.horaCurta(m.hora) + ")";
        if (!confirm("Apagar " + desc + "?")) return;
        db.apagarMovimento(m.id).then(function () {
          toast("Lançamento apagado.");
          if (mov.editId === m.id) novoFormularioMov(m);
          listarMovimentosDoDia();
          aposMudarMovimento();
        }, mostrarErro);
      }
    });
    var r = lerLocal(RASCUNHO_MOV);
    preencherFormularioMov(r || {});
  }

  /* ========================= Módulo 3: Relatório ========================= */

  var MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro",
    "Outubro", "Novembro", "Dezembro"];
  var relatorioGerado = false;
  var relatorio = null;
  var grafico = null;

  function periodoMes() {
    var ano = +$("rel-ano").value, mes = +$("rel-mes").value;
    var ultimo = new Date(ano, mes, 0).getDate();
    return {
      de: ano + "-" + doisDigitos(mes) + "-01",
      ate: ano + "-" + doisDigitos(mes) + "-" + doisDigitos(ultimo),
      rotulo: MESES[mes - 1] + " de " + ano,
      arquivo: ano + "-" + doisDigitos(mes)
    };
  }

  function gerarRelatorio() {
    limparErro();
    var p = periodoMes();
    var botao = $("rel-gerar");
    ocupado(botao, true, "Gerando…");
    $("rel-conteudo").innerHTML = '<p class="vazio">Carregando…</p>';
    Promise.all([
      db.listarConferencias({ de: p.de, ate: p.ate }),
      db.listarMovimentos({ de: p.de, ate: p.ate })
    ]).then(function (res) {
      relatorio = { periodo: p, resumo: C.resumoMensal(res[0], res[1]) };
      relatorioGerado = true;
      desenharRelatorio();
    }, function (e) {
      $("rel-conteudo").innerHTML = '<p class="vazio">Não foi possível gerar o relatório.</p>';
      mostrarErro(e);
    }).then(function () { ocupado(botao, false); });
  }

  function caixasDoRelatorio(resumo) {
    var ids = CAIXAS.map(function (c) { return c.id; });
    resumo.porCaixa.forEach(function (g) { if (ids.indexOf(g.nome) < 0) ids.push(g.nome); });
    return ids;
  }

  function corDif(v) {
    var s = C.classificarDiferenca(v);
    return s === "bateu" ? "" : ' class="cor-' + s + '"';
  }

  function tabelaGrupos(titulo, grupos, nomear) {
    if (!grupos.length) return "";
    return '<div class="bloco"><h2>' + titulo + '</h2><div class="tabela-rolagem"><table><thead><tr>' +
      "<th></th><th>Fech.</th><th>Sobras</th><th>Faltas</th><th>Saldo</th><th>Maior falta</th><th>Maior sobra</th>" +
      "</tr></thead><tbody>" + grupos.map(function (g) {
        return "<tr><td>" + escapar(nomear(g.nome)) + "</td><td>" + g.fechamentos + "</td>" +
          '<td class="cor-sobra">' + brl(g.sobras) + '</td><td class="cor-falta">' + brl(g.faltas) + "</td>" +
          "<td" + corDif(g.saldo) + "><strong>" + brl(g.saldo) + "</strong></td>" +
          "<td>" + brl(g.maiorFalta) + "</td><td>" + brl(g.maiorSobra) + "</td></tr>";
      }).join("") + "</tbody></table></div></div>";
  }

  function desenharRelatorio() {
    var r = relatorio.resumo, p = relatorio.periodo;
    var caixas = caixasDoRelatorio(r);
    var t = r.totais;
    if (!r.porDia.length) {
      $("rel-conteudo").innerHTML = '<p class="vazio">Nenhum registro em ' + escapar(p.rotulo) + ".</p>";
      return;
    }
    var html = '<h2 style="margin:4px 0 10px">' + escapar(p.rotulo) + "</h2>" +
      '<div class="cartoes">' +
      '<div class="bloco"><p class="rotulo">Saldo do mês</p><p class="numero' + (t.saldo > 0 ? " cor-sobra" : t.saldo < 0 ? " cor-falta" : "") + '">' + brl(t.saldo) + "</p></div>" +
      '<div class="bloco"><p class="rotulo">Vendas em dinheiro</p><p class="numero">' + brl(t.vendasDinheiro) + "</p></div>" +
      '<div class="bloco"><p class="rotulo">Sangrias</p><p class="numero">' + brl(t.sangrias) + "</p></div>" +
      '<div class="bloco"><p class="rotulo">Suprimentos</p><p class="numero">' + brl(t.suprimentos) + "</p></div>" +
      "</div>" +
      tabelaGrupos("Por caixa", r.porCaixa, nomeCaixa) +
      tabelaGrupos("Por operador", r.porOperador, function (n) { return n; }) +
      '<div class="bloco"><h2>Diferença por dia</h2><div class="grafico"><canvas id="rel-grafico" aria-label="Gráfico da diferença de cada dia por caixa"></canvas></div>' +
      '<p class="suave mini">Verde = sobra · Vermelho = falta. Cor mais clara = ' + escapar(caixas.slice(1).map(nomeCaixa).join(", ") || "—") + ".</p></div>" +
      '<div class="bloco"><h2>Dia a dia</h2><div class="tabela-rolagem"><table><thead><tr><th>Dia</th>' +
      caixas.map(function (c) { return "<th>" + escapar(nomeCaixa(c)) + "</th>"; }).join("") +
      "<th>Total</th><th>Vendas din.</th><th>Sangrias</th><th>Suprim.</th></tr></thead><tbody>" +
      r.porDia.map(function (d) {
        return "<tr><td>" + C.dataBR(d.data).slice(0, 5) + "</td>" +
          caixas.map(function (c) {
            return d.caixas[c] == null ? '<td class="suave">—</td>' : "<td" + corDif(d.caixas[c]) + ">" + brl(d.caixas[c]) + "</td>";
          }).join("") +
          "<td" + corDif(d.diferenca) + "><strong>" + brl(d.diferenca) + "</strong></td>" +
          "<td>" + brl(d.vendasDinheiro) + "</td><td>" + brl(d.sangrias) + "</td><td>" + brl(d.suprimentos) + "</td></tr>";
      }).join("") + "</tbody></table></div></div>";
    $("rel-conteudo").innerHTML = html;
    desenharGrafico(r, caixas);
  }

  function desenharGrafico(r, caixas) {
    carregarScript(LIBS.chart).then(function () {
      var canvas = $("rel-grafico");
      if (!canvas) return;
      var estilo = getComputedStyle(document.documentElement);
      var verde = estilo.getPropertyValue("--sobra").trim();
      var vermelho = estilo.getPropertyValue("--falta").trim();
      var textoCor = estilo.getPropertyValue("--suave").trim();
      var grade = estilo.getPropertyValue("--superficie-2").trim();
      var dias = r.porDia.filter(function (d) { return Object.keys(d.caixas).length; });
      if (grafico) grafico.destroy();
      grafico = new window.Chart(canvas, {
        type: "bar",
        data: {
          labels: dias.map(function (d) { return C.dataBR(d.data).slice(0, 5); }),
          datasets: caixas.map(function (c, i) {
            var valores = dias.map(function (d) { return d.caixas[c] == null ? null : d.caixas[c] / 100; });
            return {
              label: nomeCaixa(c),
              data: valores,
              backgroundColor: valores.map(function (v) {
                var cor = v < 0 ? vermelho : verde;
                return i === 0 ? cor : cor + "88";
              }),
              borderColor: valores.map(function (v) { return v < 0 ? vermelho : verde; }),
              borderWidth: i === 0 ? 0 : 1
            };
          })
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function (ctx) {
                  var v = Math.round(ctx.raw * 100);
                  return ctx.dataset.label + ": " + F.linhaDiferenca(v);
                }
              }
            }
          },
          scales: {
            x: { ticks: { color: textoCor }, grid: { display: false } },
            y: {
              ticks: { color: textoCor, callback: function (v) { return "R$ " + v; } },
              grid: { color: grade }
            }
          }
        }
      });
    }).catch(function (e) {
      var canvas = $("rel-grafico");
      if (canvas) canvas.parentNode.innerHTML = '<p class="vazio">' + escapar(e.message) + "</p>";
    });
  }

  function exportarRelatorioCSV() {
    if (!relatorio) { toast("Gere o relatório primeiro."); return; }
    var caixas = caixasDoRelatorio(relatorio.resumo);
    baixar("relatorio_" + relatorio.periodo.arquivo + ".csv",
      F.csvRelatorio(relatorio.resumo, caixas, nomeCaixa), "text/csv;charset=utf-8");
  }

  function iniciarRelatorio() {
    var hoje = new Date();
    $("rel-mes").innerHTML = MESES.map(function (m, i) {
      return '<option value="' + (i + 1) + '"' + (i === hoje.getMonth() ? " selected" : "") + ">" + m + "</option>";
    }).join("");
    var anos = [];
    for (var a = hoje.getFullYear(); a >= 2025; a--) anos.push(a);
    $("rel-ano").innerHTML = anos.map(function (a) { return '<option value="' + a + '">' + a + "</option>"; }).join("");
    $("rel-gerar").addEventListener("click", gerarRelatorio);
    $("rel-mes").addEventListener("change", gerarRelatorio);
    $("rel-ano").addEventListener("change", gerarRelatorio);
    $("rel-csv").addEventListener("click", exportarRelatorioCSV);
  }

  /* =========================== Login e início =========================== */

  var appIniciado = false;

  function iniciarApp() {
    if (appIniciado) return;
    appIniciado = true;
    $("lista-operadores").innerHTML = (CFG.OPERADORES || []).map(function (n) {
      return '<option value="' + escapar(n) + '"></option>';
    }).join("");
    $("lista-motivos").innerHTML = (CFG.MOTIVOS || []).map(function (n) {
      return '<option value="' + escapar(n) + '"></option>';
    }).join("");
    iniciarConferencia();
    iniciarHistorico();
    iniciarMovimentos();
    iniciarRelatorio();
    $("aviso-fechar").addEventListener("click", limparErro);
    window.addEventListener("hashchange", mostrarAba);
    window.addEventListener("offline", function () {
      mostrarErro({ message: "Sem internet. Você pode continuar contando: a contagem fica guardada neste aparelho até salvar." });
    });
    window.addEventListener("online", function () { limparErro(); toast("Internet de volta."); });
  }

  function entrarNoApp(sessao) {
    usuarioEmail = (sessao && sessao.user && sessao.user.email) || "";
    $("usuario-email").textContent = usuarioEmail;
    var iniciar = function () {
      iniciarApp();
      mostrarTela("app");
      $("login-erro").hidden = true;
      // Ao voltar de uma sessão expirada, recarrega a aba atual
      abaAtual = null;
      mostrarAba();
    };
    return db.autorizado().then(function (ok) {
      if (ok) { iniciar(); return; }
      return db.sair().then(function () {
        mostrarTela("login");
        $("login-erro").textContent = "O e-mail " + usuarioEmail + " não está na lista de usuários autorizados.";
        $("login-erro").hidden = false;
      });
    }, function (e) {
      // Sem internet: deixa entrar para contar; salvar mostrará o erro
      if (e.tipo === "rede") { iniciar(); mostrarErro(e); return; }
      mostrarTela("login");
      $("login-erro").textContent = e.message;
      $("login-erro").hidden = false;
    });
  }

  function iniciarLogin() {
    $("form-login").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var email = $("login-email").value.trim();
      var senha = $("login-senha").value;
      var erro = $("login-erro");
      erro.hidden = true;
      if (!email || !senha) {
        erro.textContent = "Preencha e-mail e senha.";
        erro.hidden = false;
        return;
      }
      var botao = $("login-botao");
      ocupado(botao, true, "Entrando…");
      db.entrar(email, senha).then(function (r) {
        $("login-senha").value = "";
        return entrarNoApp(r.session);
      }, function (e) {
        erro.textContent = e.message;
        erro.hidden = false;
      }).then(function () { ocupado(botao, false); });
    });
    $("botao-sair").addEventListener("click", function () {
      if (!confirm("Sair do sistema neste aparelho?")) return;
      db.sair().then(function () {
        if (DEMO) { location.href = location.pathname; return; }
        mostrarTela("login");
      });
    });
  }

  function iniciar() {
    $("faixa-demo").hidden = !DEMO;
    try {
      db = window.BancoVeneza.criar(DEMO);
    } catch (e) {
      mostrarTela("config");
      document.querySelector("#tela-config h1").textContent = "Não foi possível carregar o sistema";
      document.querySelector("#tela-config .cartao p").textContent = e.message;
      return;
    }
    if (!db) { mostrarTela("config"); return; }
    iniciarLogin();
    db.aoMudarSessao(function (evento) {
      if (evento === "SIGNED_OUT") mostrarTela("login");
    });
    db.sessao().then(function (s) {
      if (s) return entrarNoApp(s);
      mostrarTela("login");
    }, function () { mostrarTela("login"); });
  }

  iniciar();
})();
