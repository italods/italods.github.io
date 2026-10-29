/*
 * Veneza Escuta — formulário público (clientes, sem login).
 * Endereços: /q/<token da plaquinha>  ou  /escuta/?q=<token>  ou  /escuta/ (sem plaquinha).
 */
(function () {
  "use strict";

  var CFG = (window.VENEZA_CONFIG || {}).ESCUTA || {};
  var params = new URLSearchParams(location.search);
  var DEMO = params.get("demo") === "1";

  var TIPOS = {
    falta: { nome: "Faltou produto", detalhes: "Quais produtos você não encontrou?" },
    sugestao: { nome: "Sugestão", detalhes: "Conte sua sugestão" },
    reclamacao: { nome: "Reclamação", detalhes: "Conte o que aconteceu", rotulo: "O que aconteceu?" },
    elogio: { nome: "Elogio", detalhes: "Deixe seu elogio", rotulo: "O que você gostou?" }
  };
  var ICONE_PRODUTO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="m3 7.5 9 4.5 9-4.5M12 12v9"/></svg>';

  var db = null;
  var estado = novoEstado();

  function novoEstado() {
    return {
      etapa: 1,
      tipo: null,
      itens: [],
      editando: null,      // índice do item em edição, ou -1 para um novo
      editandoCatalogo: null,
      foto: null,          // Blob já reduzido
      fotoCaminho: null,   // caminho depois de enviado (para não reenviar em nova tentativa)
      envioId: null,
      inicio: Date.now(),
      token: lerToken(),
      enviando: false,
      buscaAberta: false   // busca aberta de novo pelo botão "Adicionar outro produto"
    };
  }

  function $(id) { return document.getElementById(id); }

  function escapar(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function lerToken() {
    var m = location.pathname.match(/^\/q\/([A-Za-z0-9]{8,32})\/?$/);
    var t = m ? m[1] : (params.get("q") || "");
    return /^[A-Za-z0-9]{8,32}$/.test(t) ? t.toLowerCase() : "";
  }

  function mostrarErro(msg) {
    $("erro").textContent = msg;
    $("erro").hidden = false;
    $("erro").scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function limparErro() { $("erro").hidden = true; }

  function aviso(titulo, texto) {
    $("formulario").hidden = true;
    $("tela-aviso").hidden = false;
    $("aviso-titulo").textContent = titulo;
    $("aviso-texto").textContent = texto || "";
  }

  /* ------------------------------- Etapas ------------------------------- */

  function irPara(etapa) {
    estado.etapa = etapa;
    Array.prototype.forEach.call(document.querySelectorAll("fieldset.etapa"), function (f) {
      f.hidden = +f.dataset.etapa !== etapa;
    });
    Array.prototype.forEach.call(document.querySelectorAll(".etapas li"), function (li) {
      var n = +li.dataset.etapa;
      li.classList.toggle("atual", n === etapa);
      li.classList.toggle("feita", n < etapa);
      if (n === etapa) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
    });
    $("intro").hidden = etapa !== 1;
    limparErro();
    if (etapa === 2) prepararDetalhes();
    if (etapa === 3) desenharResumo();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function escolherTipo(tipo) {
    estado.tipo = tipo;
    Array.prototype.forEach.call(document.querySelectorAll(".assunto"), function (b) {
      b.setAttribute("aria-checked", String(b.dataset.tipo === tipo));
    });
    $("ir-2").disabled = false;
  }

  function prepararDetalhes() {
    var t = estado.tipo;
    $("titulo-detalhes").textContent = TIPOS[t].detalhes;
    $("detalhes-falta").hidden = t !== "falta";
    $("detalhes-sugestao").hidden = t !== "sugestao";
    $("detalhes-texto").hidden = t !== "reclamacao" && t !== "elogio";
    if (TIPOS[t].rotulo) $("texto-rotulo").textContent = TIPOS[t].rotulo;
    if (t === "falta") desenharItens();
  }

  function validarDetalhes() {
    var t = estado.tipo;
    if (t === "falta") {
      if (estado.editando !== null) return "Toque em \"" + $("item-salvar").textContent + "\" para incluir o produto na lista.";
      if (!estado.itens.length) {
        return $("busca").value.trim()
          ? "Escolha uma sugestão ou toque em \"Adicionar\" para incluir o produto na lista."
          : "Diga pelo menos um produto que você não encontrou.";
      }
    } else if (t === "sugestao") {
      if (!$("sugestao-titulo").value.trim() && !$("sugestao-texto").value.trim()) return "Escreva a sua sugestão.";
    } else if ($("texto").value.trim().length < 3) {
      return "Escreva a sua mensagem.";
    }
    return null;
  }

  /* ----------------------------- Produtos ----------------------------- */

  var buscaTimer = null, buscaPedido = 0;

  function miniatura(url) {
    if (url && /^https:\/\//.test(url)) {
      return '<img class="miniatura" src="' + escapar(url) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML=\'<span class=&quot;miniatura&quot;>' +
        ICONE_PRODUTO.replace(/"/g, "&quot;") + '</span>\'" />';
    }
    return '<span class="miniatura">' + ICONE_PRODUTO + "</span>";
  }

  function detalheItem(it) {
    return [it.marca, it.apresentacao, it.codigo_barras ? "Cód. " + it.codigo_barras : ""].filter(Boolean).join(" · ");
  }

  function desenharItens() {
    $("itens").innerHTML = estado.itens.map(function (it, i) {
      return '<li class="item">' + miniatura(it.imagem_url) +
        '<span><span class="item-nome">' + escapar(it.nome) + "</span>" +
        (detalheItem(it) ? '<span class="item-detalhe" style="display:block">' + escapar(detalheItem(it)) + "</span>" : "") +
        "</span>" +
        '<span class="item-botoes"><button type="button" class="botao pequeno" data-editar="' + i + '">Editar</button>' +
        '<button type="button" class="botao pequeno" data-remover="' + i + '">Remover</button></span></li>';
    }).join("");
    var tem = estado.itens.length > 0;
    var editando = estado.editando !== null;
    $("busca-rotulo").textContent = tem ? "Buscar outro produto" : "Qual produto você não encontrou?";
    // Com itens na lista, a busca fica atrás do botão "Adicionar outro produto"
    $("busca-bloco").hidden = editando || (tem && !estado.buscaAberta);
    $("outro-produto").hidden = !tem || editando || estado.buscaAberta;
  }

  function buscar() {
    var termo = $("busca").value.trim();
    clearTimeout(buscaTimer);
    if (termo.length < 2) { $("sugestoes").hidden = true; return; }
    // Espera a pessoa parar de digitar antes de buscar
    buscaTimer = setTimeout(function () {
      var pedido = ++buscaPedido;
      db.buscarProdutos(termo).then(function (lista) {
        if (pedido === buscaPedido) desenharSugestoes(termo, lista || [], null);
      }, function (e) {
        if (pedido === buscaPedido) desenharSugestoes(termo, [], e);
      });
    }, 300);
  }

  var sugestoesAtuais = [];
  function desenharSugestoes(termo, lista, erro) {
    sugestoesAtuais = lista;
    var html = lista.map(function (p, i) {
      return '<li><button type="button" class="sugestao" role="option" data-sugestao="' + i + '">' + miniatura(p.imagem_url) +
        '<span><span class="item-nome" style="display:block">' + escapar(p.nome) + "</span>" +
        '<span class="item-detalhe">' + escapar(detalheItem(p)) + "</span></span></button></li>";
    }).join("");
    if (erro) html += '<li class="estado">Não foi possível buscar sugestões agora. Você pode adicionar o produto assim mesmo.</li>';
    else if (!lista.length) html += '<li class="estado">Nenhuma sugestão para "' + escapar(termo) + '".</li>';
    html += '<li><button type="button" class="sugestao manual" data-manual="1"><span class="miniatura">+</span>' +
      '<span><span class="item-nome" style="display:block">Adicionar "' + escapar(termo) + '"</span>' +
      '<span class="item-detalhe">Escrever o produto do meu jeito</span></span></button></li>';
    $("sugestoes").innerHTML = html;
    $("sugestoes").hidden = false;
    $("atribuicao").hidden = !lista.some(function (p) { return p.fonte === "openfoodfacts"; });
  }

  function fecharBusca() {
    $("busca").value = "";
    $("sugestoes").hidden = true;
    $("atribuicao").hidden = true;
    buscaPedido++;
  }

  function adicionarDoCatalogo(p) {
    estado.itens.push({
      nome: p.nome, marca: p.marca || "", apresentacao: p.apresentacao || "", codigo_barras: p.codigo_barras || "",
      catalogo_id: p.id, imagem_url: p.imagem_url || null, nomeCatalogo: p.nome
    });
    fecharBusca();
    estado.buscaAberta = false;
    desenharItens();
    limparErro();
  }

  function abrirEditor(indice, nomeInicial) {
    estado.editando = indice;
    var it = indice >= 0 ? estado.itens[indice] : { nome: nomeInicial || "" };
    $("editor-titulo").textContent = indice >= 0 ? "Editar produto" : "Novo produto";
    $("item-salvar").textContent = indice >= 0 ? "Salvar alterações" : "Adicionar à lista";
    $("item-nome").value = it.nome || "";
    $("item-marca").value = it.marca || "";
    $("item-apresentacao").value = it.apresentacao || "";
    $("item-codigo").value = it.codigo_barras || "";
    $("editor-item").hidden = false;
    fecharBusca();
    estado.buscaAberta = false;
    desenharItens();
    $("item-nome").focus();
  }

  function salvarEditor() {
    var nome = $("item-nome").value.trim();
    if (!nome) { mostrarErro("Escreva o nome do produto."); $("item-nome").focus(); return; }
    var codigo = $("item-codigo").value.replace(/\D/g, "");
    if (codigo && (codigo.length < 6 || codigo.length > 14)) {
      mostrarErro("O código de barras deve ter entre 6 e 14 números (ou deixe em branco).");
      return;
    }
    var dados = {
      nome: nome, marca: $("item-marca").value.trim(), apresentacao: $("item-apresentacao").value.trim(),
      codigo_barras: codigo
    };
    if (estado.editando >= 0) {
      var it = estado.itens[estado.editando];
      Object.assign(it, dados);
      // Mudou o nome de um produto do catálogo: deixa de usar a foto dele
      if (it.catalogo_id && nome !== it.nomeCatalogo) { it.catalogo_id = null; it.imagem_url = null; }
    } else {
      estado.itens.push(dados);
    }
    fecharEditor();
    limparErro();
  }

  function fecharEditor() {
    estado.editando = null;
    $("editor-item").hidden = true;
    estado.buscaAberta = false;
    desenharItens();
  }

  /* ------------------------------- Foto ------------------------------- */

  // Reduz a foto (no máximo 1600 px, JPEG) para enviar rápido mesmo com internet lenta
  function prepararFoto(arquivo) {
    return new Promise(function (ok, falha) {
      if (!arquivo) return falha(new Error("Nenhuma foto escolhida."));
      if (arquivo.type && !/^image\//.test(arquivo.type)) return falha(new Error("Envie uma foto (JPG, PNG ou WEBP)."));
      if (arquivo.size > 25 * 1024 * 1024) return falha(new Error("A foto é muito grande. Escolha uma foto de até 25 MB."));
      var url = URL.createObjectURL(arquivo);
      var img = new Image();
      img.onload = function () {
        var max = 1600, w = img.naturalWidth, h = img.naturalHeight;
        var escala = Math.min(1, max / Math.max(w, h));
        var canvas = document.createElement("canvas");
        canvas.width = Math.round(w * escala);
        canvas.height = Math.round(h * escala);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (blob) {
          if (!blob) return falha(new Error("Não foi possível preparar a foto. Tente outra."));
          if (blob.size > 5 * 1024 * 1024) return falha(new Error("A foto ficou grande demais. Tente outra."));
          ok(blob);
        }, "image/jpeg", 0.82);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        falha(new Error("Não conseguimos abrir esta foto. Tente uma foto em JPG ou PNG."));
      };
      img.src = url;
    });
  }

  function escolherFoto(ev) {
    var arquivo = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!arquivo) return;
    prepararFoto(arquivo).then(function (blob) {
      estado.foto = blob;
      estado.fotoCaminho = null;
      if (estado.fotoUrl) URL.revokeObjectURL(estado.fotoUrl);
      estado.fotoUrl = URL.createObjectURL(blob);
      $("foto-img").src = estado.fotoUrl;
      $("foto-previa").hidden = false;
      $("foto-escolher").hidden = true;
      limparErro();
    }, function (e) { mostrarErro(e.message); });
  }

  function removerFoto() {
    estado.foto = null;
    estado.fotoCaminho = null;
    if (estado.fotoUrl) URL.revokeObjectURL(estado.fotoUrl);
    estado.fotoUrl = null;
    $("foto-previa").hidden = true;
    $("foto-escolher").hidden = false;
  }

  /* --------------------------- Identificação --------------------------- */

  function formatarTelefone(v) {
    var d = v.replace(/\D/g, "").slice(0, 11);
    if (d.length <= 2) return d.length ? "(" + d : "";
    if (d.length <= 6) return "(" + d.slice(0, 2) + ") " + d.slice(2);
    if (d.length <= 10) return "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
    return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
  }

  function atualizarConsentimento() {
    var temContato = $("nome").value.trim() || $("telefone").value.replace(/\D/g, "");
    $("consentimento-bloco").hidden = !temContato;
    if (!temContato) $("consentimento").checked = false;
  }

  function textoPrincipal() {
    if (estado.tipo === "falta") return $("falta-info").value.trim();
    if (estado.tipo === "sugestao") return $("sugestao-texto").value.trim();
    return $("texto").value.trim();
  }

  function desenharResumo() {
    var linhas = [["Assunto", TIPOS[estado.tipo].nome]];
    if (estado.plaquinha) linhas.push(["Local", estado.plaquinha.setor + (estado.plaquinha.local ? " · " + estado.plaquinha.local : "")]);
    if (estado.tipo === "falta") {
      linhas.push(["Produtos", estado.itens.map(function (it) {
        return "• " + it.nome + (detalheItem(it) ? " (" + detalheItem(it) + ")" : "");
      }).join("\n")]);
    }
    if (estado.tipo === "sugestao" && $("sugestao-titulo").value.trim()) linhas.push(["Sugestão", $("sugestao-titulo").value.trim()]);
    if (textoPrincipal()) linhas.push([estado.tipo === "falta" ? "Observação" : "Mensagem", textoPrincipal()]);
    linhas.push(["Foto", estado.foto ? "Sim" : "Não"]);
    $("resumo").innerHTML = "<h2>Confira antes de enviar</h2><dl>" + linhas.map(function (l) {
      return "<dt>" + escapar(l[0]) + "</dt><dd>" + escapar(l[1]) + "</dd>";
    }).join("") + "</dl>";
  }

  function validarIdentificacao() {
    var tel = $("telefone").value.replace(/\D/g, "");
    if (tel && (tel.length < 10 || tel.length > 11)) return "Telefone com DDD deve ter 10 ou 11 números. Ex.: (89) 99999-9999.";
    if (($("nome").value.trim() || tel) && !$("consentimento").checked) {
      return "Para enviar com nome ou telefone, marque a autorização. Se preferir, apague os dois e envie sem identificação.";
    }
    return null;
  }

  /* ------------------------------- Envio ------------------------------- */

  function enviar(ev) {
    ev.preventDefault();
    if (estado.enviando) return;
    limparErro();
    var erro = validarDetalhes();
    if (erro) { irPara(2); mostrarErro(erro); return; }
    erro = validarIdentificacao();
    if (erro) { mostrarErro(erro); return; }

    estado.envioId = estado.envioId || db.novoId();
    var tel = $("telefone").value.replace(/\D/g, "");
    var dados = {
      id: estado.envioId,
      tipo: estado.tipo,
      token: estado.token || null,
      titulo: estado.tipo === "sugestao" ? $("sugestao-titulo").value.trim() : null,
      descricao: textoPrincipal() || null,
      nome: $("nome").value.trim() || null,
      telefone: tel || null,
      consentimento: $("consentimento").checked,
      itens: estado.tipo === "falta" ? estado.itens.map(function (it) {
        return { nome: it.nome, marca: it.marca || null, apresentacao: it.apresentacao || null,
          codigo_barras: it.codigo_barras || null, catalogo_id: it.catalogo_id || null };
      }) : [],
      tempo_ms: Date.now() - estado.inicio,
      site: $("site").value
    };

    var botao = $("enviar");
    estado.enviando = true;
    botao.disabled = true;
    botao.textContent = estado.foto && !estado.fotoCaminho ? "Enviando foto…" : "Enviando…";

    var passo = Promise.resolve();
    if (estado.foto && !estado.fotoCaminho) {
      passo = db.enviarFoto(estado.envioId, estado.foto).then(function (caminho) {
        estado.fotoCaminho = caminho;
        botao.textContent = "Enviando…";
      });
    }
    passo.then(function () {
      if (estado.fotoCaminho) dados.foto = { caminho: estado.fotoCaminho };
      return db.enviar(dados);
    }).then(function (r) {
      $("protocolo").textContent = r.protocolo;
      $("formulario").hidden = true;
      $("tela-obrigado").hidden = false;
      window.scrollTo(0, 0);
    }, function (e) {
      if (/foto/i.test(e.message)) estado.fotoCaminho = null;
      mostrarErro(e.message || "Não foi possível enviar. Tente de novo.");
    }).then(function () {
      estado.enviando = false;
      botao.disabled = false;
      botao.textContent = "Enviar";
    });
  }

  function recomecar() {
    var plaquinha = estado.plaquinha;
    removerFoto();
    estado = novoEstado();
    estado.plaquinha = plaquinha;
    $("formulario").reset();
    Array.prototype.forEach.call(document.querySelectorAll(".assunto"), function (b) { b.setAttribute("aria-checked", "false"); });
    $("ir-2").disabled = true;
    $("editor-item").hidden = true;
    fecharBusca();
    desenharItens();
    atualizarConsentimento();
    $("tela-obrigado").hidden = true;
    $("formulario").hidden = false;
    irPara(1);
  }

  /* ------------------------------- Início ------------------------------- */

  function ligarEventos() {
    document.querySelector(".assuntos").addEventListener("click", function (ev) {
      var b = ev.target.closest(".assunto");
      if (b) escolherTipo(b.dataset.tipo);
    });
    $("ir-2").addEventListener("click", function () { if (estado.tipo) irPara(2); });
    $("ir-3").addEventListener("click", function () {
      var erro = validarDetalhes();
      if (erro) { mostrarErro(erro); return; }
      irPara(3);
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-voltar]"), function (b) {
      b.addEventListener("click", function () { irPara(+b.dataset.voltar); });
    });

    $("busca").addEventListener("input", buscar);
    $("busca").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        if ($("busca").value.trim()) abrirEditor(-1, $("busca").value.trim());
      }
    });
    $("sugestoes").addEventListener("click", function (ev) {
      var b = ev.target.closest("button");
      if (!b) return;
      if (b.dataset.manual) abrirEditor(-1, $("busca").value.trim());
      else adicionarDoCatalogo(sugestoesAtuais[+b.dataset.sugestao]);
    });
    $("itens").addEventListener("click", function (ev) {
      var b = ev.target.closest("button");
      if (!b) return;
      if (b.dataset.editar) abrirEditor(+b.dataset.editar);
      if (b.dataset.remover) {
        estado.itens.splice(+b.dataset.remover, 1);
        desenharItens();
      }
    });
    $("outro-produto").addEventListener("click", function () {
      estado.buscaAberta = true;
      desenharItens();
      $("busca").focus();
    });
    $("item-salvar").addEventListener("click", salvarEditor);
    $("item-cancelar").addEventListener("click", fecharEditor);
    ["item-nome", "item-marca", "item-apresentacao", "item-codigo"].forEach(function (id) {
      $(id).addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") { ev.preventDefault(); salvarEditor(); }
      });
    });

    $("foto").addEventListener("change", escolherFoto);
    $("foto-remover").addEventListener("click", removerFoto);

    $("telefone").addEventListener("input", function () {
      $("telefone").value = formatarTelefone($("telefone").value);
      atualizarConsentimento();
    });
    $("nome").addEventListener("input", atualizarConsentimento);
    $("formulario").addEventListener("submit", enviar);
    $("nova").addEventListener("click", recomecar);
  }

  function mostrarLogo() {
    var img = $("logo");
    if (!CFG.LOGO) return;
    img.onload = function () { img.hidden = false; $("marca-texto").hidden = true; };
    img.src = CFG.LOGO;
  }

  function iniciar() {
    $("faixa-demo").hidden = !DEMO;
    mostrarLogo();
    try {
      db = window.EscutaBanco.criarPublico(DEMO);
    } catch (e) {
      aviso("Sem conexão", e.message);
      return;
    }
    if (!db) { aviso("Formulário ainda não configurado", "Tente de novo mais tarde."); return; }
    ligarEventos();

    var pronto = Promise.resolve(null);
    if (estado.token) {
      $("tela-aviso").hidden = false;
      pronto = db.plaquinha(estado.token);
    }
    pronto.then(function (p) {
      if (estado.token && !p) {
        aviso("QR code não reconhecido", "Este código não está cadastrado. Procure outra plaquinha na loja ou fale com um atendente.");
        return;
      }
      if (p && !p.ativa) {
        aviso("Este QR code foi desativado", "Ele não recebe mais mensagens. Procure outra plaquinha na loja ou fale com um atendente.");
        return;
      }
      estado.plaquinha = p;
      if (p) {
        $("origem").innerHTML = "Você está em: <strong>" + escapar(p.setor) + "</strong>" + (p.local ? " · " + escapar(p.local) : "");
        $("origem").hidden = false;
      }
      $("tela-aviso").hidden = true;
      $("formulario").hidden = false;
      irPara(1);
    }, function (e) {
      if (e.tipo === "rede") aviso("Sem conexão", "Verifique a internet e abra o QR code de novo.");
      else aviso("Não foi possível abrir o formulário", e.message);
    });
  }

  iniciar();
})();
