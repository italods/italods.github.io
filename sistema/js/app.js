/*
 * Telas do Sistema Veneza (página única com abas).
 * As contas ficam em calculos.js; aqui só se lê a tela, chama as contas e mostra o resultado.
 */
(function () {
  "use strict";

  var C = window.Calculos;
  var F = window.Formatos;
  var Dm = window.Diamante;
  var CFG = window.VENEZA_CONFIG || {};
  var CAIXAS = CFG.CAIXAS || [];
  var DEMO = new URLSearchParams(location.search).get("demo") === "1";

  var LIBS = {
    jspdf: "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js",
    chart: "https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js",
    pdfjs: "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.min.mjs",
    pdfjsWorker: "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.worker.min.mjs"
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
    $("tela-esqueci").hidden = qual !== "esqueci";
    $("tela-nova-senha").hidden = qual !== "nova-senha";
    $("app").hidden = qual !== "app";
  }

  var ABAS_CAIXA = ["caixa", "historico", "movimentos", "relatorio", "importar"];
  var ABAS_ESCUTA = ["escuta", "escuta-mensagens", "escuta-plaquinhas", "escuta-catalogo"];
  var ABAS_CARTOES = ["cartoes", "cartoes-taxas"];
  var ABAS = ABAS_CAIXA.concat(ABAS_ESCUTA, ABAS_CARTOES);
  var abaAtual = null;
  function mostrarAba() {
    var aba = location.hash.replace("#", "");
    if (ABAS.indexOf(aba) < 0) aba = "caixa";
    var modulo = ABAS_ESCUTA.indexOf(aba) >= 0 ? "escuta" : ABAS_CARTOES.indexOf(aba) >= 0 ? "cartoes" : "caixa";
    ABAS.forEach(function (a) { $("aba-" + a).hidden = a !== aba; });
    Array.prototype.forEach.call(document.querySelectorAll(".abas a"), function (a) {
      a.classList.toggle("ativa", a.dataset.aba === aba);
      if (a.dataset.aba === aba) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    // Área do sistema: Conferência de caixa ou Veneza Escuta (cada uma lembra a última aba aberta)
    Array.prototype.forEach.call(document.querySelectorAll(".modulos a"), function (a) {
      a.classList.toggle("ativa", a.dataset.modulo === modulo);
      if (a.dataset.modulo === modulo) a.setAttribute("href", "#" + aba);
    });
    Array.prototype.forEach.call(document.querySelectorAll("nav.abas"), function (n) {
      n.hidden = n.dataset.modulo !== modulo;
    });
    $("barra-total").hidden = aba !== "caixa" || conf.vista !== "form";
    var mudou = abaAtual !== aba;
    abaAtual = aba;
    if (!mudou) return;
    if (modulo === "escuta") { window.EscutaAdmin.mostrar(aba); return; }
    if (modulo === "cartoes") { window.Cartoes.mostrar(aba); return; }
    if (aba === "caixa") { if (conf.vista === "form") atualizarContexto(); else carregarInicio(); }
    if (aba === "historico") buscarHistorico();
    if (aba === "movimentos") listarMovimentosDoDia();
    if (aba === "relatorio" && !relatorioGerado) gerarRelatorio();
    if (aba === "importar") window.ImportarCielo.mostrar();
  }

  /* ========================= Módulo 1: Conferência ========================= */

  var conf = {
    editId: null,
    editRotulo: "",
    fundoManual: false,
    movimentos: { sangrias: 0, suprimentos: 0 },
    cupom: null,
    legado: false,       // fechamento antigo, digitado sem cupom (não fica "falta o cupom")
    vista: "inicio",     // inicio | escolha | form
    confsDoDia: [],
    cielo: null,
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
      cupom: conf.cupom,
      legado: conf.legado,
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
    conf.cupom = f.cupom && f.cupom.formas ? f.cupom : null;
    conf.legado = !!f.legado;
    desenharCupom();
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
    $("form-titulo").textContent = F.nomeTipo($("conf-tipo").dataset.valor || "abertura") + " · " +
      nomeCaixa($("conf-caixa").dataset.valor) + " · " + C.dataBR($("conf-data").value);
    $("bloco-fechamento").hidden = !fechamento;
    var pendente = fechamento && !conf.cupom && !conf.legado;
    $("bloco-pendente").hidden = !pendente;
    $("bloco-comparacao").hidden = pendente;
    var barraDif = $("barra-diferenca");
    if (fechamento) {
      aplicarCupomNosCampos();
      desenharConferenciaCupom();
      desenharFormas();
      var fundo = lerDinheiro($("conf-fundo"), C.FUNDO_PADRAO);
      var vendas = lerDinheiro($("conf-vendas"));
      var receb = lerDinheiro($("conf-recebimentos"));
      var troco = lerDinheiro($("conf-troco"), C.TROCO_PADRAO);
      ["conf-pix", "conf-debito", "conf-credito", "conf-carteira"].forEach(function (id) { lerDinheiro($(id)); });
      var sangrias = conf.cupom ? conf.cupom.sangria : conf.movimentos.sangrias;
      $("conf-sangrias").textContent = brl(sangrias);
      if (conf.cupom) {
        var lanc = conf.movimentos.sangrias;
        $("movimentos-estado").textContent = "Sangrias do cupom do Diamante." + (lanc
          ? (lanc === sangrias ? " As lançadas no sistema (" + brl(lanc) + ") batem." :
            " Atenção: lançadas no sistema somam " + brl(lanc) + " (diferença " + brl(lanc - sangrias) + ").")
          : "");
      }
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
          sangrias: sangrias, suprimentos: conf.movimentos.suprimentos,
          trocoAmanha: troco == null ? C.TROCO_PADRAO : troco
        });
        $("conf-esperado").textContent = brl(r.esperado);
        var texto = F.linhaDiferenca(r.diferenca);
        $("conf-diferenca").className = "diferenca " + r.situacao;
        $("conf-diferenca").textContent = texto;
        barraDif.className = "barra-dif " + r.situacao;
        barraDif.textContent = texto;
        barraDif.hidden = pendente;
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
  // Aviso no alto do formulário: caixa já aberto (bloqueia) ou fechamento sem abertura (só avisa)
  var avisoPedido = 0;
  function atualizarAvisoForm() {
    var el = $("form-aviso");
    var data = $("conf-data").value, caixa = $("conf-caixa").dataset.valor, tipo = $("conf-tipo").dataset.valor;
    if (!db || !data || !caixa) { el.hidden = true; return; }
    var pedido = ++avisoPedido;
    db.listarConferencias({ de: data, ate: data, caixa: caixa }).then(function (confs) {
      if (pedido !== avisoPedido) return;
      var outras = confs.filter(function (c) { return c.id !== conf.editId; });
      if (conf.editId) {
        // editando: só interessa se a mudança criaria duas aberturas seguidas
        var hora = $("conf-hora").value;
        outras = outras.filter(function (c) { return C.horaCurta(c.hora) <= hora; });
      }
      var r = C.podeRegistrar(C.situacaoDoCaixa(outras, caixa, data), tipo);
      var texto = !r.ok ? r.motivo : (!conf.editId && r.aviso) || "";
      el.textContent = texto;
      el.className = !r.ok ? "msg-erro" : "msg-aviso";
      el.hidden = !texto;
    }, function () { if (pedido === avisoPedido) el.hidden = true; });
  }

  function atualizarContexto() {
    atualizarAvisoForm();
    if (!db || $("conf-tipo").dataset.valor !== "fechamento") return Promise.resolve();
    var data = $("conf-data").value;
    var caixa = $("conf-caixa").dataset.valor;
    if (!data || !caixa) return Promise.resolve();
    var pedido = ++conf.pedido;
    $("movimentos-estado").textContent = "Buscando abertura, sangrias e suprimentos…";
    conf.cielo = null;
    desenharFormas();
    // Vendas da Cielo do dia (separado: se falhar, o resto do fechamento continua)
    Promise.all([db.listarCielo({ de: data, ate: data }), db.listarMaquinas(), db.listarTrocas({ de: data, ate: data }),
      db.listarBanco({ de: data, ate: data }), db.listarConferencias({ de: data, ate: data })])
      .then(function (r) {
        if (pedido !== conf.pedido) return;
        conf.cielo = { vendas: r[0] || [], maquinas: r[1] || [], trocas: r[2] || [], banco: r[3] || [], confsTodas: r[4] || [] };
        desenharFormas();
      }, function (e) {
        if (pedido !== conf.pedido) return;
        conf.cielo = { erro: e.message };
        desenharFormas();
      });
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
      conf.confsDoDia = confs;
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
    if (f.tipo === "fechamento" && conf.cupom) {
      if (document.querySelector("#bloco-cupom [aria-invalid=true]")) return "Há um valor inválido no cupom do Diamante.";
      var probCaixa = Dm.problemaCaixaDoCupom(CAIXAS, conf.cupom, f.caixa);
      if (probCaixa) return probCaixa;
      if (conf.cupom.data && conf.cupom.data !== f.data) {
        return "O cupom é do dia " + C.dataBR(conf.cupom.data) + ", mas o fechamento está em " + C.dataBR(f.data) + ".";
      }
    }
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
    d.cupom = fech ? conf.cupom : null;
    d.pendente = fech && !conf.cupom && !conf.legado;
    return d;
  }

  function salvarConferencia() {
    limparErro();
    var erro = validarConferencia();
    if (erro) { mostrarErro({ message: erro }); return; }
    var d = dadosConferencia();
    if (d.cupom && Dm.cupomRepetido(conf.confsDoDia, d.cupom, d.caixa, d.data, conf.editId) &&
        !confirm("Já existe um fechamento salvo com o cupom deste caixa, dia e turno. Salvar outro mesmo assim?")) return;
    if (d.cupom && Dm.conferirCupom(d.cupom).some(function (x) { return x.nivel === "erro"; }) &&
        !confirm("As somas do cupom do Diamante não batem (veja os avisos em vermelho). Salvar assim mesmo?")) return;
    if (C.calcularContagem(d.contagem).total === 0 &&
        !confirm("O total contado está em R$ 0,00. Salvar assim mesmo?")) return;
    var botao = $("conf-salvar");
    ocupado(botao, true, "Salvando…");
    db.salvarConferencia(d, conf.editId).then(function (salvo) {
      var eraEdicao = !!conf.editId;
      var msg = "Salvo: " + F.nomeTipo(salvo.tipo) + " · " + nomeCaixa(salvo.caixa) + " · " + brl(salvo.total_centavos);
      if (salvo.tipo === "fechamento") msg += " · " + (C.ehPendente(salvo) ? "falta o cupom" : F.linhaDiferenca(salvo.diferenca_centavos));
      gravarLocal(RASCUNHO_CONF, null);
      var proximo = formularioVazio();
      proximo.tipo = salvo.tipo;
      proximo.caixa = salvo.caixa;
      proximo.operador = salvo.operador;
      preencherFormularioConf(proximo);
      atualizarConferencia();
      relatorioGerado = false;
      toast(msg);
      mostrarVista("inicio");
      if (eraEdicao && voltarAoHistorico) location.hash = "#historico";
      else { $("inicio-data").value = salvo.data; carregarInicio(); }
      voltarAoHistorico = false;
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
      contagem: r.contagem, observacao: r.observacao, textos: textos, editId: r.id, fundoManual: true, cupom: r.cupom,
      legado: r.tipo === "fechamento" && !r.cupom && !r.pendente,
      editRotulo: "Editando: " + F.nomeTipo(r.tipo) + " · " + nomeCaixa(r.caixa) + " · " + C.dataBR(r.data) + " " + C.horaCurta(r.hora)
    });
    atualizarConferencia();
    voltarAoHistorico = abaAtual === "historico";
    mostrarVista("form");
    location.hash = "#caixa";
    atualizarContexto();
    window.scrollTo(0, 0);
  }

  function cancelarEdicao() {
    gravarLocal(RASCUNHO_CONF, null);
    preencherFormularioConf(formularioVazio());
    atualizarConferencia();
    mostrarVista("inicio");
    carregarInicio();
  }

  /* ---------------- Tela inicial do Caixa e escolha da contagem ---------------- */

  var voltarAoHistorico = false;
  var inicio = { data: "", confs: [], pedido: 0 };
  var escolha = { modo: "nova", data: "", caixa: "", tipo: "", confs: [] };

  function mostrarVista(v) {
    conf.vista = v;
    $("caixa-inicio").hidden = v !== "inicio";
    $("caixa-escolha").hidden = v !== "escolha";
    $("caixa-form").hidden = v !== "form";
    $("barra-total").hidden = v !== "form" || abaAtual !== "caixa";
  }

  function rascunhoComConteudo() {
    var r = lerLocal(RASCUNHO_CONF);
    if (!r) return null;
    var total = C.calcularContagem(r.contagem).total;
    return total > 0 || r.editId || (r.cupom && r.cupom.formas) ? { r: r, total: total } : null;
  }

  function descricaoSituacao(sit) {
    if (sit.estado === "sem_registro") return { texto: "Não aberto", classe: "sit-fechado" };
    var u = sit.ultima;
    if (sit.estado === "aberto") return { texto: "Aberto às " + C.horaCurta(u.hora), classe: "sit-aberto" };
    return { texto: "Fechado às " + C.horaCurta(u.hora) + (C.ehPendente(u) ? " · falta o cupom" : ""),
      classe: C.ehPendente(u) ? "sit-pendente" : "sit-fechado" };
  }

  function linhaRegistro(r) {
    var dif = "";
    if (r.tipo === "fechamento") {
      dif = C.ehPendente(r) ? '<span class="r-dif cor-pendente">Falta o cupom</span>'
        : '<span class="r-dif cor-' + C.classificarDiferenca(r.diferenca_centavos) + '">' + escapar(F.linhaDiferenca(r.diferenca_centavos)) + "</span>";
    } else {
      dif = '<span class="r-dif"></span>';
    }
    return '<button type="button" class="registro" data-id="' + escapar(r.id) + '">' +
      '<span class="r-titulo"><span class="etiqueta">' + escapar(F.nomeTipo(r.tipo)) + "</span>" + C.horaCurta(r.hora) + "</span>" +
      '<span class="r-total">' + brl(r.total_centavos) + "</span>" +
      '<span class="r-sub">' + (r.operador ? escapar(r.operador) : "&nbsp;") + "</span>" + dif + "</button>";
  }

  function carregarInicio() {
    var data = $("inicio-data").value || hojeISO();
    $("inicio-data").value = data;
    $("inicio-titulo").textContent = (data === hojeISO() ? "Hoje" : diaDaSemana(data)) + ", " + C.dataBR(data);
    desenharRascunhoInicio();
    if (!db) return;
    var pedido = ++inicio.pedido;
    db.listarConferencias({ de: data, ate: data }).then(function (confs) {
      if (pedido !== inicio.pedido) return;
      inicio.data = data;
      inicio.confs = confs;
      desenharInicio();
    }, function (e) {
      if (pedido !== inicio.pedido) return;
      $("inicio-caixas").innerHTML = '<p class="vazio">Não foi possível carregar.</p>';
      mostrarErro(e);
    });
  }

  function desenharInicio() {
    $("inicio-caixas").innerHTML = CAIXAS.map(function (cx) {
      var sit = C.situacaoDoCaixa(inicio.confs, cx.id, inicio.data);
      var d = descricaoSituacao(sit);
      return '<div class="caixa-cartao">' +
        '<div class="caixa-cab"><strong>' + escapar(cx.curto) + '</strong><span class="etiqueta ' + d.classe + '">' + escapar(d.texto) + "</span></div>" +
        (sit.registros.length ? sit.registros.map(linhaRegistro).join("") : '<p class="suave mini">Nenhuma contagem neste dia.</p>') +
        "</div>";
    }).join("");
  }

  function desenharRascunhoInicio() {
    var x = rascunhoComConteudo();
    $("inicio-rascunho").hidden = !x;
    if (!x) return;
    var r = x.r;
    $("inicio-rascunho-texto").textContent = (r.editId ? "(edição) " : "") + F.nomeTipo(r.tipo || "abertura") + " · " +
      nomeCaixa(r.caixa) + " · " + C.dataBR(r.data) + " · " + brl(x.total);
  }

  function abrirEscolha(modo) {
    escolha.modo = modo;
    if (modo === "trocar") {
      escolha.data = $("conf-data").value || hojeISO();
      escolha.caixa = $("conf-caixa").dataset.valor;
      escolha.tipo = $("conf-tipo").dataset.valor;
    } else {
      escolha.data = $("inicio-data").value || hojeISO();
      escolha.caixa = "";
      escolha.tipo = "";
    }
    escolha.confs = escolha.data === inicio.data ? inicio.confs : [];
    mostrarVista("escolha");
    desenharEscolha();
    window.scrollTo(0, 0);
    if (!db) return;
    db.listarConferencias({ de: escolha.data, ate: escolha.data }).then(function (confs) {
      escolha.confs = confs;
      desenharEscolha();
    }, mostrarErro);
  }

  function situacaoNaEscolha(caixa) {
    var outras = escolha.confs.filter(function (c) { return !(escolha.modo === "trocar" && c.id === conf.editId); });
    return C.situacaoDoCaixa(outras, caixa, escolha.data);
  }

  function desenharEscolha() {
    $("escolha-caixa").innerHTML = CAIXAS.map(function (cx) {
      return '<button type="button" role="radio" data-valor="' + escapar(cx.id) + '">' + escapar(cx.curto) +
        " <small>" + escapar(descricaoSituacao(situacaoNaEscolha(cx.id)).texto) + "</small></button>";
    }).join("");
    definirAlternador($("escolha-caixa"), escolha.caixa);
    if (escolha.caixa && !escolha.tipo) {
      escolha.tipo = situacaoNaEscolha(escolha.caixa).estado === "aberto" ? "fechamento" : "abertura";
    }
    definirAlternador($("escolha-tipo"), escolha.tipo);
    var el = $("escolha-aviso");
    var ok = !!escolha.caixa && !!escolha.tipo;
    el.hidden = true;
    if (ok) {
      var r = C.podeRegistrar(situacaoNaEscolha(escolha.caixa), escolha.tipo);
      if (!r.ok) { el.textContent = r.motivo; el.className = "msg-erro"; el.hidden = false; ok = false; }
      else if (r.aviso) { el.textContent = r.aviso; el.className = "msg-aviso"; el.hidden = false; }
    } else if (!escolha.caixa) {
      el.textContent = "Escolha o caixa."; el.className = "suave mini"; el.hidden = false;
    }
    $("escolha-ok").disabled = !ok;
  }

  function confirmarEscolha() {
    if (!escolha.caixa || !escolha.tipo) return;
    if (escolha.modo === "trocar") {
      definirAlternador($("conf-tipo"), escolha.tipo);
      definirAlternador($("conf-caixa"), escolha.caixa);
    } else {
      var f = formularioVazio();
      f.tipo = escolha.tipo;
      f.caixa = escolha.caixa;
      f.data = escolha.data;
      preencherFormularioConf(f);
    }
    mostrarVista("form");
    atualizarConferencia();
    atualizarContexto();
    window.scrollTo(0, 0);
  }

  function iniciarInicio() {
    $("inicio-data").value = hojeISO();
    $("inicio-data").addEventListener("change", carregarInicio);
    $("nova-contagem").addEventListener("click", function () {
      var x = rascunhoComConteudo();
      if (x && !confirm("Há uma contagem em andamento que não foi salva (" + $("inicio-rascunho-texto").textContent +
          "). Descartar e começar outra?")) return;
      if (x) { gravarLocal(RASCUNHO_CONF, null); preencherFormularioConf(formularioVazio()); desenharRascunhoInicio(); }
      abrirEscolha("nova");
    });
    $("rascunho-continuar").addEventListener("click", function () {
      var x = rascunhoComConteudo();
      if (!x) return;
      preencherFormularioConf(x.r);
      mostrarVista("form");
      atualizarConferencia();
      atualizarContexto();
      window.scrollTo(0, 0);
    });
    $("rascunho-descartar").addEventListener("click", function () {
      if (!confirm("Descartar a contagem em andamento? O que foi digitado será apagado.")) return;
      gravarLocal(RASCUNHO_CONF, null);
      preencherFormularioConf(formularioVazio());
      atualizarConferencia();
      gravarLocal(RASCUNHO_CONF, null);
      desenharRascunhoInicio();
    });
    $("inicio-caixas").addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-id]");
      if (!b) return;
      var r = inicio.confs.filter(function (x) { return x.id === b.dataset.id; })[0];
      if (r) abrirDetalhe(r);
    });
    $("escolha-caixa").addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-valor]");
      if (!b) return;
      if (escolha.caixa !== b.dataset.valor && escolha.modo === "nova") escolha.tipo = "";
      escolha.caixa = b.dataset.valor;
      desenharEscolha();
    });
    $("escolha-tipo").addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-valor]");
      if (!b) return;
      escolha.tipo = b.dataset.valor;
      desenharEscolha();
    });
    $("escolha-ok").addEventListener("click", confirmarEscolha);
    $("escolha-voltar").addEventListener("click", function () {
      if (escolha.modo === "trocar") mostrarVista("form");
      else { mostrarVista("inicio"); carregarInicio(); }
    });
    $("form-trocar").addEventListener("click", function () { abrirEscolha("trocar"); });
    $("form-voltar").addEventListener("click", function () { mostrarVista("inicio"); carregarInicio(); window.scrollTo(0, 0); });
  }

  /* ===================== Conferência por forma (Cielo) ===================== */

  function desenharFormas() {
    var el = $("formas-conteudo");
    var c = conf.cupom;
    var fech = $("conf-tipo").dataset.valor === "fechamento";
    $("bloco-formas").hidden = !(fech && c);
    if (!fech || !c) return;
    if (!conf.cielo) { el.innerHTML = '<p class="suave mini">Buscando as vendas da Cielo deste dia…</p>'; return; }
    if (conf.cielo.erro) { el.innerHTML = '<p class="msg-erro">Não foi possível buscar a Cielo (' + escapar(conf.cielo.erro) + ").</p>"; return; }
    var caixa = $("conf-caixa").dataset.valor, data = $("conf-data").value;
    var vendas = conf.cielo.vendas.filter(function (v) { return v.data === data; });
    var html = "";
    if (!vendas.length) {
      html = '<p class="msg-aviso">As vendas da Cielo deste dia ainda não foram importadas. <a href="#importar">Importar o CSV da Cielo</a></p>';
    } else {
      var soma = window.Cielo.somarPorForma(vendas, caixa, data, conf.cielo.maquinas, conf.cielo.trocas);
      var semCaixa = vendas.filter(function (v) { return v.aprovada && !window.Cielo.caixaDaVenda(v, conf.cielo.maquinas, conf.cielo.trocas); });
      html = '<div class="formas-tabela"><div class="forma-linha"><span class="cupom-cab">Forma</span><span class="cupom-cab">Diamante</span><span class="cupom-cab">Cielo</span></div>' +
        window.Cielo.compararComCupom(c, soma).map(function (l) {
          var t = l.situacao === "bateu" ? "Bateu" : (l.situacao === "sobra" ? "Cielo tem " : "Cielo tem ") + brl(Math.abs(l.diferenca)) + (l.situacao === "sobra" ? " a mais" : " a menos");
          return '<div class="forma-linha" data-forma="' + l.forma + '"><span class="cupom-forma">' + escapar(l.nome) + "</span><span>" + brl(l.esperado) +
            "</span><span>" + brl(l.encontrado) + "</span>" + '<span class="forma-dif diferenca ' + l.situacao + '">' + escapar(t) +
            (l.diferenca ? ' <button type="button" class="botao pequeno" data-investigar="' + l.forma + '">Investigar</button>' : "") + "</span></div>";
        }).join("") + "</div>";
      if (soma.nao_aprovadas) html += '<p class="suave mini">' + soma.nao_aprovadas + (soma.nao_aprovadas === 1 ? " venda não aprovada" : " vendas não aprovadas") + " na Cielo (não contam).</p>";
      if (semCaixa.length) html += '<p class="msg-aviso">' + semCaixa.length + " vendas da Cielo deste dia são de máquina sem caixa. <a href=\"#importar\">Ligar a máquina ao caixa</a></p>";
    }
    html += linhaPixDelivery(c, caixa, data);
    html += '<p class="suave mini">Carteira (fiado vendido, ' + brl(c.formas.carteira.vendas) + ") é só informativo. Dinheiro: veja a contagem abaixo.</p>";
    el.innerHTML = html;
  }

  // PIX Delivery: o BB não diz o caixa, então a conta é do DIA (cupons de todos os caixas)
  function linhaPixDelivery(c, caixa, data) {
    var banco = (conf.cielo.banco || []).filter(function (l) { return l.data === data; });
    var titulo = '<h3 class="mini">PIX Delivery (dia inteiro, todos os caixas)</h3>';
    if (!banco.length) {
      return titulo + '<p class="msg-aviso">O extrato do BB deste dia ainda não foi importado. <a href="#importar">Importar o extrato do BB</a></p>';
    }
    // cupom deste caixa (o da tela) + o último fechamento com cupom de cada outro caixa
    var porCaixa = {};
    porCaixa[caixa] = c;
    (conf.cielo.confsTodas || []).filter(function (r) { return r.tipo === "fechamento" && r.cupom && r.caixa !== caixa; })
      .sort(function (a, b) { return String(a.hora).localeCompare(String(b.hora)); })
      .forEach(function (r) { porCaixa[r.caixa] = r.cupom; });
    var faltam = CAIXAS.filter(function (cx) { return !porCaixa[cx.id]; }).map(function (cx) { return cx.curto; });
    var cupons = Object.keys(porCaixa).map(function (k) { return porCaixa[k]; });
    var r = window.Banco.compararPixDelivery(cupons, banco, data);
    var t = r.situacao === "bateu" ? "Bateu" : "BB tem " + brl(Math.abs(r.diferenca)) + (r.situacao === "sobra" ? " a mais" : " a menos");
    return titulo + '<div class="formas-tabela"><div class="forma-linha"><span class="cupom-cab">Forma</span><span class="cupom-cab">Diamante</span>' +
      '<span class="cupom-cab">BB</span></div><div class="forma-linha" data-forma="pix_delivery"><span class="cupom-forma">PIX de clientes</span><span>' +
      brl(r.esperado) + "</span><span>" + brl(r.encontrado) + '</span><span class="forma-dif diferenca ' + r.situacao + '">' + escapar(t) +
      ' <button type="button" class="botao pequeno" data-investigar="pix_delivery">' + (r.diferenca ? "Investigar" : "Ver PIX") + "</button></span></div></div>" +
      '<p class="suave mini">' + r.quantidade + " PIX de clientes no BB neste dia." +
      (faltam.length ? " Atenção: ainda falta o cupom do " + escapar(faltam.join(" e do ")) + " deste dia, então o Diamante está incompleto." : "") + "</p>";
  }

  /* ========================= Investigar diferença ========================= */

  // Cupom mais recente de cada caixa no dia (o deste caixa é o da tela, mesmo sem salvar)
  function cuponsDoDia(caixa, c) {
    var porCaixa = {};
    porCaixa[caixa] = c;
    (conf.cielo.confsTodas || []).filter(function (r) { return r.tipo === "fechamento" && r.cupom && r.caixa !== caixa; })
      .sort(function (a, b) { return String(a.hora).localeCompare(String(b.hora)); })
      .forEach(function (r) { porCaixa[r.caixa] = r.cupom; });
    return porCaixa;
  }

  function linhaVenda(v, destaque) {
    var extra = v.forma === "pix" ? (v.pagador || "") : (v.bandeira || "") + (v.parcelas > 1 ? " " + v.parcelas + "x" : "");
    return "<tr" + (destaque ? ' class="destaque"' : "") + "><td>" + escapar(C.horaCurta(v.hora)) + "</td><td>" + brl(v.valor_centavos) +
      "</td><td>" + escapar(extra) + "</td><td>" + (v.aprovada === false ? '<span class="msg-erro">não aprovada</span>' : "") + "</td></tr>";
  }
  function tabela(cab, linhas) {
    return linhas.length ? '<div class="tabela-rolagem"><table class="tabela-inv"><thead><tr>' + cab.map(function (h) { return "<th>" + h + "</th>"; }).join("") +
      "</tr></thead><tbody>" + linhas.join("") + "</tbody></table></div>" : '<p class="suave mini">Nada.</p>';
  }

  function abrirInvestigar(forma) {
    var c = conf.cupom, caixa = $("conf-caixa").dataset.valor, data = $("conf-data").value;
    if (!c || !conf.cielo || conf.cielo.erro) return;
    var CI = window.Cielo, IV = window.Investigar, K = conf.cielo;
    var doCaixa = function (cx) { return K.vendas.filter(function (v) { return v.data === data && CI.caixaDaVenda(v, K.maquinas, K.trocas) === cx; }); };
    var vendas = doCaixa(caixa);
    var aprovadas = vendas.filter(function (v) { return v.aprovada; });
    var difsDe = function (cup, cx) {
      var o = {};
      CI.compararComCupom(cup, CI.somarPorForma(K.vendas, cx, data, K.maquinas, K.trocas)).forEach(function (l) { o[l.forma] = l.diferenca; });
      return o;
    };
    var cupons = cuponsDoDia(caixa, c);
    var difs = difsDe(c, caixa);
    var banco = (K.banco || []).filter(function (l) { return l.data === data; });
    var recebTodos = [];
    Object.keys(cupons).forEach(function (k) { recebTodos = recebTodos.concat(cupons[k].recebimentos || []); });
    var terceiros = banco.filter(function (l) { return l.categoria === "pix_terceiro" && l.caixa !== "fora"; });
    var delivery = IV.casarPixDelivery(recebTodos, terceiros);
    var html = "";
    var titulo = { debito: "Cartão débito", credito: "Cartão crédito", pix: "PIX da maquininha", pix_delivery: "PIX Delivery (dia inteiro)" }[forma];
    $("investigar-titulo").textContent = titulo + " · " + nomeCaixa(caixa) + " · " + C.dataBR(data);

    if (forma !== "pix_delivery") {
      var linha = CI.compararComCupom(c, CI.somarPorForma(K.vendas, caixa, data, K.maquinas, K.trocas)).filter(function (l) { return l.forma === forma; })[0];
      var outro = null;
      Object.keys(cupons).forEach(function (k) {
        if (k === caixa) return;
        var d = difsDe(cupons[k], k);
        if (!outro || d[forma] === -linha.diferenca) outro = d;
      });
      var exp = IV.explicarDiferenca({ forma: forma, diferenca: linha.diferenca, vendas: aprovadas,
        naoAprovadas: vendas.filter(function (v) { return !v.aprovada; }), difs: difs, difsOutroCaixa: outro, bbTerceiros: delivery.soBB });
      var marcados = [];
      exp.forEach(function (x) { marcados = marcados.concat(x.itens || []); });
      html += '<p>Diamante <strong>' + brl(linha.esperado) + "</strong> · Cielo <strong>" + brl(linha.encontrado) + '</strong> · <span class="diferenca-texto ' +
        linha.situacao + '">' + (linha.diferenca ? (linha.diferenca > 0 ? "Cielo tem " : "Cielo tem ") + brl(Math.abs(linha.diferenca)) + (linha.diferenca > 0 ? " a mais" : " a menos") : "bateu") + "</span></p>";
      html += '<h3 class="mini">O que pode explicar</h3><ul class="explicacoes">' + exp.map(function (x) {
        return '<li class="exp-' + x.tipo + '">' + escapar(x.texto) + "</li>";
      }).join("") + "</ul>";
      if (forma === "pix") {
        var todosPix = K.vendas.filter(function (v) { return v.data === data && v.forma === "pix" && v.aprovada; });
        var pm = IV.casarPixMaquininha(todosPix, banco.filter(function (l) { return l.categoria === "pix_maquininha"; }));
        var meus = function (v) { return CI.caixaDaVenda(v, K.maquinas, K.trocas) === caixa; };
        var deste = pm.pares.filter(function (p) { return meus(p.cielo); });
        var naoChegou = pm.soCielo.filter(meus);
        html += '<h3 class="mini">PIX da maquininha × Banco do Brasil</h3><p class="mini">' + deste.length + " de " + (deste.length + naoChegou.length) +
          " PIX deste caixa caíram no BB (taxa média do dia " + (pm.taxaMedia * 100).toFixed(2).replace(".", ",") + "%)." +
          (banco.length ? "" : " O extrato do BB deste dia não foi importado.") + "</p>";
        var atrasados = deste.filter(function (p) { return p.atrasado; });
        if (atrasados.length) html += '<p class="mini">Caíram bem depois: ' + atrasados.map(function (p) {
          return escapar(brl(p.cielo.valor_centavos) + " das " + C.horaCurta(p.cielo.hora) + " só às " + C.horaCurta(p.bb.hora));
        }).join("; ") + ".</p>";
        if (naoChegou.length) html += '<p class="msg-aviso">Não acharam no BB: ' + naoChegou.map(function (v) { return escapar(brl(v.valor_centavos) + " às " + C.horaCurta(v.hora)); }).join("; ") + ".</p>";
      }
      var daForma = vendas.filter(function (v) { return v.forma === forma; });
      html += '<h3 class="mini">Vendas da Cielo neste caixa (' + escapar(titulo.toLowerCase()) + ")</h3>" +
        tabela(["Hora", "Valor", forma === "pix" ? "Pagador" : "Bandeira", ""], daForma.map(function (v) { return linhaVenda(v, marcados.indexOf(v) >= 0); }));
    } else {
      var e = 0;
      Object.keys(cupons).forEach(function (k) { e += cupons[k].formas.pix_delivery.vendas + cupons[k].formas.pix_delivery.receb; });
      var vendasDelivery = Object.keys(cupons).reduce(function (s, k) { return s + cupons[k].formas.pix_delivery.vendas; }, 0);
      var sobraBB = delivery.soBB.reduce(function (s, l) { return s + l.valor_centavos; }, 0);
      var faltam = CAIXAS.filter(function (cx) { return !cupons[cx.id]; }).map(function (cx) { return cx.curto; });
      html += '<p class="mini">O BB não diz de qual caixa veio o PIX. Os <strong>recebimentos</strong> do cupom (fiado pago por PIX) são casados pelo valor; ' +
        "o que sobra no BB deveria somar as <strong>vendas</strong> em PIX Delivery dos cupons (" + brl(vendasDelivery) + ").</p>";
      if (faltam.length) html += '<p class="msg-aviso">Falta o cupom do ' + escapar(faltam.join(" e do ")) + " deste dia: a conta está incompleta.</p>";
      var celCupom = function (r) { return "<td>" + brl(r.valor) + '<br><small class="suave">' + escapar(r.nome || "") + "</small></td>"; };
      var celBB = function (l) { return "<td>" + brl(l.valor_centavos) + '<br><small class="suave">' + escapar(C.horaCurta(l.hora)) + "</small></td>"; };
      html += '<h3 class="mini">Recebimentos do cupom × BB</h3>' + tabela(["Cupom", "BB", ""],
        delivery.exatos.map(function (x) { return "<tr>" + celCupom(x.cupom) + celBB(x.bb) + '<td class="msg-ok">igual</td></tr>'; })
          .concat(delivery.proximos.map(function (x) { return '<tr class="destaque">' + celCupom(x.cupom) + celBB(x.bb) +
            '<td class="msg-aviso">' + brl(x.diferenca) + "</td></tr>"; }))
          .concat(delivery.soCupom.map(function (x) { return '<tr class="destaque">' + celCupom(x) + '<td>—</td><td class="msg-erro">não está no BB</td></tr>'; })));
      html += '<h3 class="mini">PIX de clientes no BB sem recebimento no cupom</h3><p class="mini">Somam ' + brl(sobraBB) + " (vendas em PIX Delivery dos cupons: " + brl(vendasDelivery) +
        "; diferença " + brl(sobraBB - vendasDelivery) + "). Marque o que não é venda para tirar da conta.</p>" +
        tabela(["PIX", "Pagador", "É do"], delivery.soBB.map(function (l) {
          return "<tr>" + celBB(l) + "<td>" + escapar(l.pagador || (l.pagador_tipo === "pj" ? "empresa" : "")) +
            '</td><td><select data-atribuir="' + escapar(l.id) + '" aria-label="De qual caixa"><option value="">Não sei</option>' +
            CAIXAS.map(function (cx) { return '<option value="' + escapar(cx.id) + '"' + (l.caixa === cx.id ? " selected" : "") + ">" + escapar(cx.curto) + "</option>"; }).join("") +
            '<option value="fora">Não é venda</option></select></td></tr>';
        }));
      var fora = banco.filter(function (l) { return l.categoria === "pix_terceiro" && l.caixa === "fora"; });
      if (fora.length) html += '<p class="suave mini">Fora da conta (não é venda): ' + fora.map(function (l) {
        return escapar(brl(l.valor_centavos) + " às " + C.horaCurta(l.hora)) + ' <button type="button" class="botao fantasma pequeno" data-desfazer="' + escapar(l.id) + '">voltar</button>';
      }).join(" · ") + "</p>";
    }
    $("investigar-corpo").innerHTML = html;
    var dlg = $("investigar");
    dlg.dataset.forma = forma;
    if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", ""); }
  }

  function iniciarInvestigar() {
    $("formas-conteudo").addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-investigar]");
      if (b) abrirInvestigar(b.dataset.investigar);
    });
    $("investigar-fechar").addEventListener("click", function () {
      var dlg = $("investigar");
      if (dlg.close) dlg.close(); else dlg.removeAttribute("open");
    });
    function marcar(id, valor) {
      db.atribuirBanco(id, valor).then(function () {
        (conf.cielo.banco || []).forEach(function (l) { if (l.id === id) l.caixa = valor || null; });
        toast(valor === "fora" ? "Marcado: não é venda." : valor ? "Marcado como do " + nomeCaixa(valor) + "." : "Desmarcado.");
        abrirInvestigar($("investigar").dataset.forma);
        desenharFormas();
      }, mostrarErro);
    }
    $("investigar-corpo").addEventListener("change", function (ev) {
      if (ev.target.dataset.atribuir) marcar(ev.target.dataset.atribuir, ev.target.value);
    });
    $("investigar-corpo").addEventListener("click", function (ev) {
      if (ev.target.dataset.desfazer) marcar(ev.target.dataset.desfazer, "");
    });
  }

  /* ========================== Cupom do Diamante ========================== */

  // Campos do resumo do caixa, na ordem do cupom
  var CUPOM_RESUMO = [
    ["venda_bruta", "Venda bruta"], ["fundo", "Fundo de caixa"], ["sangria", "Sangria"],
    ["recebimento", "Recebimento"], ["total_liquido", "Total líquido"],
    ["cancelamentos", "Cancelamentos"], ["desconto", "Desconto"]
  ];

  function campoCupom(rotulo, extra, modo) {
    return '<input type="text" inputmode="' + (modo || "decimal") + '" class="dinheiro" autocomplete="off" placeholder="0,00" ' +
      extra + ' aria-label="' + escapar(rotulo) + '" />';
  }

  function montarCamposCupom() {
    $("cupom-formas").innerHTML = Dm.FORMAS.map(function (f) {
      return '<span class="cupom-forma" title="' + escapar(f.nome) + '">' + escapar(f.curto) + "</span>" +
        campoCupom(f.nome + " vendas", 'data-forma="' + f.chave + '" data-campo="vendas"') +
        campoCupom(f.nome + " recebimentos", 'data-forma="' + f.chave + '" data-campo="receb"');
    }).join("");
    $("cupom-resumo").innerHTML = CUPOM_RESUMO.map(function (r) {
      return '<label class="campo"><span>' + escapar(r[1]) + "</span>" +
        campoCupom(r[1], 'data-resumo="' + r[0] + '"', r[0] === "total_liquido" ? "text" : "decimal") + "</label>";
    }).join("");
  }

  // Texto do campo -> centavos (aceita negativo só no total líquido). Inválido = null
  function lerCampoCupom(el) {
    var t = el.value.trim();
    var neg = el.dataset.resumo === "total_liquido" && /^-/.test(t);
    if (neg) t = t.replace(/^-\s*/, "");
    var c = t === "" ? 0 : C.reaisParaCentavos(t);
    if (c == null) { el.setAttribute("aria-invalid", "true"); return null; }
    el.removeAttribute("aria-invalid");
    return neg ? -c : c;
  }
  function textoCampoCupom(c) {
    return c < 0 ? "-" + dinheiroCampo(-c) : dinheiroCampo(c || 0);
  }

  function preencherCamposCupom(c) {
    Array.prototype.forEach.call(document.querySelectorAll("#cupom-formas input"), function (el) {
      el.value = textoCampoCupom((c.formas[el.dataset.forma] || {})[el.dataset.campo]);
      el.removeAttribute("aria-invalid");
    });
    Array.prototype.forEach.call(document.querySelectorAll("#cupom-resumo input"), function (el) {
      el.value = textoCampoCupom(c[el.dataset.resumo]);
      el.removeAttribute("aria-invalid");
    });
  }

  function lerCamposCupom() {
    var c = conf.cupom;
    if (!c) return;
    Array.prototype.forEach.call(document.querySelectorAll("#cupom-formas input"), function (el) {
      var v = lerCampoCupom(el);
      if (v != null) c.formas[el.dataset.forma][el.dataset.campo] = v;
    });
    Array.prototype.forEach.call(document.querySelectorAll("#cupom-resumo input"), function (el) {
      var v = lerCampoCupom(el);
      if (v != null) c[el.dataset.resumo] = v;
    });
  }

  function desenharConferenciaCupom() {
    var c = conf.cupom;
    if (!c) return;
    var r = [];
    var probCaixa = Dm.problemaCaixaDoCupom(CAIXAS, c, $("conf-caixa").dataset.valor);
    if (probCaixa) r.push({ nivel: "erro", texto: probCaixa });
    var rep = Dm.cupomRepetido(conf.confsDoDia, c, $("conf-caixa").dataset.valor, $("conf-data").value, conf.editId);
    if (rep) r.push({ nivel: "aviso", texto: "Já existe um fechamento salvo com o cupom deste caixa, dia e turno (" +
      C.horaCurta(rep.hora) + "). Para corrigir, edite aquele no Histórico." });
    r = r.concat(Dm.conferirCupom(c));
    // A abertura contada deveria ser o fundo do cupom
    var ab = C.aberturaAntes(conf.confsDoDia, { id: conf.editId, caixa: $("conf-caixa").dataset.valor,
      data: $("conf-data").value, hora: $("conf-hora").value });
    var avisoFundo = $("cupom-fundo-aviso");
    if (ab && ab.total_centavos !== c.fundo) {
      avisoFundo.textContent = "Atenção: a abertura das " + C.horaCurta(ab.hora) + " contou " + brl(ab.total_centavos) +
        ", mas o fundo no cupom é " + brl(c.fundo) + " (diferença de " + brl(Math.abs(ab.total_centavos - c.fundo)) +
        "). Confira se a abertura foi registrada no caixa e no dia certos.";
      avisoFundo.hidden = false;
    } else {
      avisoFundo.hidden = true;
    }
    $("cupom-conferencia").innerHTML = r.length ? '<ul class="cupom-avisos">' + r.map(function (x) {
      return '<li class="' + (x.nivel === "erro" ? "msg-erro" : "msg-aviso") + '">' + escapar(x.texto) + "</li>";
    }).join("") + "</ul>" : '<p class="msg-ok">As somas do cupom batem.</p>';
  }

  function desenharCupom() {
    var c = conf.cupom;
    $("cupom-detalhe").hidden = !c;
    $("cupom-digitar").hidden = !!c;
    $("conf-outros").hidden = !!c || !conf.legado;
    $("cupom-importar").textContent = c ? "Importar outro PDF" : "Importar PDF do cupom";
    ["conf-fundo", "conf-vendas", "conf-recebimentos"].forEach(function (id) { $(id).readOnly = !!c; });
    if (!c) {
      $("cupom-estado").innerHTML = conf.legado ? "Fechamento salvo sem cupom (valores digitados). Se quiser, importe o PDF do cupom."
        : 'Sem o cupom, a contagem fica salva como <strong>"Falta o cupom"</strong> e a diferença aparece quando você importar o PDF em ' +
          "<strong>Importar &gt; Cupons do Diamante</strong>. O PDF é lido neste aparelho e não é enviado.";
      $("cupom-fundo-aviso").hidden = true;
      return;
    }
    var partes = [];
    if (c.terminal) partes.push("Terminal " + c.terminal);
    if (c.turno) partes.push("Turno " + c.turno);
    if (c.data) partes.push(C.dataBR(c.data));
    if (c.abertura || c.encerramento) partes.push((C.horaCurta(c.abertura) || "?") + " às " + (C.horaCurta(c.encerramento) || "?"));
    if (c.operador) partes.push("Operador: " + c.operador);
    $("cupom-cabecalho").textContent = partes.join(" · ");
    $("cupom-estado").textContent = c.origem === "pdf" ? "Lido do PDF. Confira e, se precisar, corrija um valor." : "Digitado. Siga a ordem do cupom.";
    var nr = (c.recebimentos || []).length, ns = (c.sangrias || []).length;
    $("cupom-listas").textContent = c.origem === "pdf"
      ? nr + (nr === 1 ? " recebimento" : " recebimentos") + " (nome do cliente abreviado) e " + ns + (ns === 1 ? " sangria" : " sangrias") + " lidos do cupom."
      : "Cupom digitado: sem a lista de recebimentos um a um.";
    preencherCamposCupom(c);
    desenharConferenciaCupom();
  }

  // Com cupom, o fundo e o dinheiro do fechamento vêm dele
  function aplicarCupomNosCampos() {
    var c = conf.cupom;
    if (!c) return;
    $("conf-fundo").value = dinheiroCampo(c.fundo);
    $("conf-vendas").value = dinheiroCampo(c.formas.dinheiro.vendas);
    $("conf-recebimentos").value = dinheiroCampo(c.formas.dinheiro.receb);
    $("fundo-origem").textContent = "Do cupom do Diamante.";
  }

  // Lê o texto de todas as páginas do PDF (no aparelho; o arquivo não é enviado)
  var importarModulo = null;
  function lerTextoPdf(arquivo) {
    if (!importarModulo) {
      try { importarModulo = new Function("u", "return import(u)"); } catch (e) { importarModulo = null; }
    }
    if (!importarModulo) return Promise.reject(new Error("Este navegador não consegue ler PDF. Atualize o navegador ou digite o cupom."));
    return importarModulo(LIBS.pdfjs).catch(function () {
      throw new Error("Não foi possível carregar o leitor de PDF. Confira a internet e tente de novo.");
    }).then(function (pdfjs) {
      pdfjs.GlobalWorkerOptions.workerSrc = LIBS.pdfjsWorker;
      return arquivo.arrayBuffer().then(function (buf) {
        return pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
      }).catch(function () { throw new Error("Não consegui abrir este PDF. Confira se é o PDF do cupom."); });
    }).then(function (doc) {
      var paginas = [];
      for (var i = 1; i <= Math.min(doc.numPages, 6); i++) {
        paginas.push(doc.getPage(i).then(function (pg) { return pg.getTextContent(); })
          .then(function (tc) { return Dm.textoDeItensPdf(tc.items); }));
      }
      return Promise.all(paginas).then(function (t) { return t.join("\n"); });
    });
  }

  function usarCupom(c) {
    var notas = [];
    var cx = Dm.caixaDoTerminal(CAIXAS, c.terminal);
    if (conf.editId && cx && cx.id !== $("conf-caixa").dataset.valor) {
      throw new Error("Este cupom é do Terminal " + c.terminal + " (" + cx.curto + "), mas o registro que você está editando é do " +
        nomeCaixa($("conf-caixa").dataset.valor) + ". Nada foi mudado.");
    }
    if (conf.editId && c.data && c.data !== $("conf-data").value) {
      throw new Error("Este cupom é do dia " + C.dataBR(c.data) + ", mas o registro que você está editando é de " +
        C.dataBR($("conf-data").value) + ". Nada foi mudado.");
    }
    if (cx && cx.id !== $("conf-caixa").dataset.valor) {
      definirAlternador($("conf-caixa"), cx.id);
      notas.push("caixa trocado para " + cx.curto + " (terminal " + c.terminal + ")");
    } else if (!cx && c.terminal) {
      notas.push("o terminal " + c.terminal + " não está ligado a nenhum caixa (confira o caixa escolhido)");
    }
    if (c.data && c.data !== $("conf-data").value) {
      $("conf-data").value = c.data;
      notas.push("data trocada para " + C.dataBR(c.data));
    }
    if (!$("conf-operador").value.trim() && c.operador) $("conf-operador").value = c.operador;
    conf.cupom = c;
    desenharCupom();
    atualizarConferencia();
    atualizarContexto();
    return notas;
  }

  function importarCupom(arquivo) {
    limparErro();
    if (!arquivo) return;
    if (!/\.pdf$/i.test(arquivo.name || "") && arquivo.type !== "application/pdf") {
      mostrarErro({ message: "Escolha o arquivo PDF do cupom de \"Fechamento de turno\"." });
      return;
    }
    if (arquivo.size > 10 * 1024 * 1024) { mostrarErro({ message: "Arquivo grande demais para um cupom (mais de 10 MB)." }); return; }
    var rotulo = $("cupom-importar");
    rotulo.classList.add("ocupado");
    $("cupom-estado").textContent = "Lendo o PDF…";
    lerTextoPdf(arquivo).then(function (texto) {
      var r = Dm.lerCupom(texto);
      if (!r.cupom || r.erros.some(function (e) { return /resumo das formas|Fechamento de turno/.test(e); })) {
        throw new Error(r.erros[0] || "Não consegui ler o cupom.");
      }
      var notas = usarCupom(r.cupom);
      if (r.erros.length) mostrarErro({ message: "Cupom lido, mas: " + r.erros.join(" ") + " Confira os valores." });
      toast("Cupom lido" + (notas.length ? ": " + notas.join("; ") : "") + ".");
    }).catch(function (e) {
      desenharCupom();
      mostrarErro({ message: e.message || "Não consegui ler o PDF." });
    }).then(function () { rotulo.classList.remove("ocupado"); });
  }

  function iniciarCupom() {
    montarCamposCupom();
    $("cupom-arquivo").addEventListener("change", function (ev) {
      var arq = ev.target.files && ev.target.files[0];
      ev.target.value = "";
      importarCupom(arq);
    });
    $("cupom-importar").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); $("cupom-arquivo").click(); }
    });
    $("cupom-digitar").addEventListener("click", function () {
      var c = Dm.cupomVazio();
      var cx = CAIXAS.filter(function (x) { return x.id === $("conf-caixa").dataset.valor; })[0];
      c.terminal = (cx && cx.terminal) || "";
      c.data = $("conf-data").value;
      c.fundo = lerDinheiro($("conf-fundo"), C.FUNDO_PADRAO) || 0;
      conf.cupom = c;
      desenharCupom();
      atualizarConferencia();
      var primeiro = document.querySelector("#cupom-formas input");
      if (primeiro) primeiro.focus();
    });
    $("cupom-remover").addEventListener("click", function () {
      if (!confirm("Remover o cupom deste fechamento? Ele volta a ficar \"Falta o cupom\".")) return;
      conf.cupom = null;
      conf.fundoManual = false;
      desenharCupom();
      atualizarConferencia();
      atualizarContexto();
    });
    $("bloco-cupom").addEventListener("input", function (ev) {
      if (!ev.target.matches("#cupom-formas input, #cupom-resumo input")) return;
      lerCamposCupom();
      desenharConferenciaCupom();
      atualizarConferencia();
    });
    $("bloco-cupom").addEventListener("focusout", function (ev) {
      if (!ev.target.matches("#cupom-formas input, #cupom-resumo input")) return;
      var v = lerCampoCupom(ev.target);
      if (v != null) ev.target.value = textoCampoCupom(v);
    });
  }

  function iniciarConferencia() {
    iniciarCupom();
    iniciarInvestigar();
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
    iniciarInicio();
    mostrarVista("inicio");
    desenharRascunhoInicio();
  }

  /* ========================== Histórico ========================== */

  var historico = [];
  var registroAberto = null;

  /* ---------------- Histórico de edições (desfazer) ---------------- */

  var versoes = [];
  function carregarVersoes() {
    if (!db || !db.listarVersoes) return;
    db.listarVersoes({ limite: 40 }).then(function (lista) {
      versoes = lista || [];
      desenharVersoes();
    }, function (e) {
      $("hist-versoes").innerHTML = '<p class="vazio">Não foi possível carregar as alterações.</p>';
      if (e.tipo === "sessao") mostrarErro(e);
    });
  }

  function descreverVersao(v) {
    var d = v.dados || {};
    var o = d.tipo === "sangria" ? "Sangria" : d.tipo === "suprimento" ? "Suprimento" : F.nomeTipo(d.tipo);
    var valor = v.tabela === "movimentos" ? d.valor_centavos : d.total_centavos;
    return o + " · " + nomeCaixa(d.caixa) + " · " + C.dataBR(d.data) + " " + C.horaCurta(d.hora) + " · antes: " + brl(valor);
  }

  function desenharVersoes() {
    if (!versoes.length) {
      $("hist-versoes").innerHTML = '<p class="vazio">Nenhuma alteração ainda.</p>';
      return;
    }
    $("hist-versoes").innerHTML = '<ul class="lista-versoes">' + versoes.map(function (v) {
      var quem = String(v.feito_por || "?").split("@")[0];
      return '<li><div><strong>' + escapar(v.operacao === "apagado" ? "Apagado" : "Editado") + "</strong> " +
        escapar(descreverVersao(v)) + '<br><small class="suave">' + escapar(quem + " em " + dataHoraBR(v.feito_em)) + "</small></div>" +
        '<button type="button" class="botao pequeno" data-versao="' + escapar(String(v.id)) + '">Desfazer</button></li>';
    }).join("") + "</ul>";
  }

  function desfazerVersao(v) {
    var pergunta = v.operacao === "apagado"
      ? "Trazer de volta o registro apagado (" + descreverVersao(v) + ")?"
      : "Voltar o registro para como estava antes desta alteração (" + descreverVersao(v) + ")?";
    if (!confirm(pergunta)) return;
    db.restaurarVersao(v).then(function () {
      toast("Desfeito.");
      relatorioGerado = false;
      buscarHistorico();
    }, mostrarErro);
  }

  function buscarHistorico() {
    carregarVersoes();
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
          if (C.ehPendente(r)) {
            dif = '<span class="r-dif cor-pendente">Falta o cupom</span>';
          } else if (r.tipo === "fechamento") {
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
    if (!confirm("Apagar " + desc + "?")) return;
    db.apagarConferencia(r.id).then(function () {
      fecharDetalhe();
      historico = historico.filter(function (x) { return x.id !== r.id; });
      desenharHistorico();
      relatorioGerado = false;
      if (conf.editId === r.id) cancelarEdicao();
      if (abaAtual === "caixa" && conf.vista === "inicio") carregarInicio();
      if (abaAtual === "historico") carregarVersoes();
      toast("Registro apagado. Dá para desfazer em Histórico > Últimas alterações.");
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
    $("hist-versoes").addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-versao]");
      if (!b) return;
      var v = versoes.filter(function (x) { return String(x.id) === b.dataset.versao; })[0];
      if (v) desfazerVersao(v);
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
    var avisoPendentes = t.pendentes ? '<p class="msg-aviso">' + t.pendentes + (t.pendentes === 1 ? " fechamento ainda está" : " fechamentos ainda estão") +
      ' com "Falta o cupom" e não entra' + (t.pendentes === 1 ? "" : "m") + " nas contas. Importe em Importar &gt; Cupons do Diamante.</p>" : "";
    if (!r.porDia.length) {
      $("rel-conteudo").innerHTML = avisoPendentes + '<p class="vazio">Nenhum fechamento completo em ' + escapar(p.rotulo) + ".</p>";
      if (!t.pendentes) $("rel-conteudo").innerHTML = '<p class="vazio">Nenhum registro em ' + escapar(p.rotulo) + ".</p>";
      return;
    }
    var html = '<h2 style="margin:4px 0 10px">' + escapar(p.rotulo) + "</h2>" +
      '<div class="cartoes">' +
      '<div class="bloco"><p class="rotulo">Saldo do mês</p><p class="numero' + (t.saldo > 0 ? " cor-sobra" : t.saldo < 0 ? " cor-falta" : "") + '">' + brl(t.saldo) + "</p></div>" +
      '<div class="bloco"><p class="rotulo">Vendas em dinheiro</p><p class="numero">' + brl(t.vendasDinheiro) + "</p></div>" +
      '<div class="bloco"><p class="rotulo">Sangrias</p><p class="numero">' + brl(t.sangrias) + "</p></div>" +
      '<div class="bloco"><p class="rotulo">Suprimentos</p><p class="numero">' + brl(t.suprimentos) + "</p></div>" +
      "</div>" +
      avisoPendentes +
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
    window.Cartoes.iniciar({
      db: db, toast: toast, mostrarErro: mostrarErro, limparErro: limparErro, ocupado: ocupado, escapar: escapar,
      brl: brl, dataBR: C.dataBR, horaCurta: C.horaCurta, hojeISO: hojeISO
    });
    window.CuponsDiamante.iniciar({
      db: db, toast: toast, mostrarErro: mostrarErro, limparErro: limparErro, ocupado: ocupado, escapar: escapar,
      brl: brl, caixas: CAIXAS, nomeCaixa: nomeCaixa, dataBR: C.dataBR, horaCurta: C.horaCurta, lerTextoPdf: lerTextoPdf,
      aoGravar: function () { relatorioGerado = false; }
    });
    window.ImportarCielo.iniciar({
      db: db, toast: toast, mostrarErro: mostrarErro, limparErro: limparErro, ocupado: ocupado, escapar: escapar,
      brl: brl, caixas: CAIXAS, nomeCaixa: nomeCaixa, dataBR: C.dataBR, horaCurta: C.horaCurta, hojeISO: hojeISO
    });
    window.EscutaAdmin.iniciar({
      banco: window.EscutaBanco.criarPainel(db.cliente, DEMO),
      demo: DEMO,
      toast: toast, mostrarErro: mostrarErro, limparErro: limparErro, copiar: copiar, baixar: baixar,
      carregarScript: carregarScript, ocupado: ocupado, escapar: escapar
    });
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

  /* ========================= Esqueci / trocar senha ========================= */

  function erroLogin(msg) {
    mostrarTela("login");
    $("login-erro").textContent = msg;
    $("login-erro").hidden = false;
  }

  // modo "link": veio do e-mail (sem volta, depois entra no sistema); "trocar": já estava logado
  var modoSenha = "trocar";
  function abrirNovaSenha(modo, email) {
    modoSenha = modo;
    $("nova-senha-titulo").textContent = modo === "link" ? "Criar senha nova" : "Trocar senha";
    $("nova-senha-email").textContent = email || "";
    $("nova-senha-usuario").value = email || "";
    $("nova-senha-1").value = "";
    $("nova-senha-2").value = "";
    $("nova-senha-erro").hidden = true;
    $("nova-senha-cancelar").hidden = modo === "link";
    mostrarTela("nova-senha");
    $("nova-senha-1").focus();
  }

  function iniciarSenha() {
    $("login-esqueci").addEventListener("click", function () {
      $("esqueci-email").value = $("login-email").value.trim();
      $("esqueci-erro").hidden = true;
      $("esqueci-ok").hidden = true;
      mostrarTela("esqueci");
      $("esqueci-email").focus();
    });
    $("esqueci-voltar").addEventListener("click", function () {
      $("login-erro").hidden = true;
      mostrarTela("login");
    });
    $("form-esqueci").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var email = $("esqueci-email").value.trim();
      var erro = $("esqueci-erro"), ok = $("esqueci-ok"), botao = $("esqueci-botao");
      erro.hidden = true; ok.hidden = true;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        erro.textContent = "Digite um e-mail válido.";
        erro.hidden = false;
        return;
      }
      ocupado(botao, true, "Enviando…");
      db.pedirNovaSenha(email).then(function () {
        ok.textContent = "Pronto. Se este e-mail tiver acesso ao sistema, o link chega em alguns minutos. " +
          "Confira também a caixa de spam. Abra o link neste mesmo aparelho.";
        ok.hidden = false;
        ocupado(botao, false);
        // Evita pedidos repetidos (o Supabase limita os envios)
        botao.disabled = true;
        setTimeout(function () { botao.disabled = false; }, 60000);
      }, function (e) {
        erro.textContent = e.message;
        erro.hidden = false;
        ocupado(botao, false);
      });
    });
    $("botao-senha").addEventListener("click", function () { abrirNovaSenha("trocar", usuarioEmail); });
    $("nova-senha-cancelar").addEventListener("click", function () { mostrarTela("app"); });
    $("form-nova-senha").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var s1 = $("nova-senha-1").value, s2 = $("nova-senha-2").value;
      var erro = $("nova-senha-erro"), botao = $("nova-senha-botao");
      erro.hidden = true;
      var problema = F.validarNovaSenha(s1, s2);
      if (problema) { erro.textContent = problema; erro.hidden = false; return; }
      ocupado(botao, true, "Salvando…");
      db.trocarSenha(s1).then(function () {
        $("nova-senha-1").value = "";
        $("nova-senha-2").value = "";
        ocupado(botao, false);
        toast("Senha salva. Use a senha nova da próxima vez que entrar.");
        if (modoSenha === "link") {
          return db.sessao().then(function (s) { return s ? entrarNoApp(s) : erroLogin("Entre com a senha nova."); });
        }
        mostrarTela("app");
      }, function (e) {
        ocupado(botao, false);
        if (e.tipo === "sessao") { erroLogin("O link do e-mail expirou. Peça um novo em \"Esqueci minha senha\"."); return; }
        erro.textContent = e.message;
        erro.hidden = false;
      });
    });
  }

  // Veio do link do e-mail? (#access_token=...&type=recovery ou #error=...)
  function tratarRetornoSenha() {
    var retorno = F.lerRetornoSenha(location.hash);
    if (!retorno) return null;
    // Tira os dados do link da barra de endereço (e do histórico)
    history.replaceState(null, "", location.pathname + location.search);
    if (retorno.erro) { erroLogin(retorno.erro); return Promise.resolve(); }
    return db.usarLinkSenha(retorno).then(function (r) {
      var email = (r && r.user && r.user.email) || (r && r.session && r.session.user && r.session.user.email) || "";
      abrirNovaSenha("link", email);
    }, function (e) {
      erroLogin(e.tipo === "sessao" ? "Este link já foi usado ou expirou. Peça um novo em \"Esqueci minha senha\"." : e.message);
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
    iniciarSenha();
    db.aoMudarSessao(function (evento) {
      if (evento === "SIGNED_OUT") mostrarTela("login");
    });
    if (tratarRetornoSenha()) return;
    db.sessao().then(function (s) {
      if (s) return entrarNoApp(s);
      mostrarTela("login");
    }, function () { mostrarTela("login"); });
  }

  iniciar();
})();
