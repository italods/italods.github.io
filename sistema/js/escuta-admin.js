/*
 * Veneza Escuta — painel da administração (dentro do /sistema/, exige login).
 * Abas: Visão geral, Mensagens, Plaquinhas e Catálogo.
 * Os dados vêm de EscutaBanco (escuta-db.js); permissões são conferidas no banco.
 */
(function () {
  "use strict";

  var CFG = (window.VENEZA_CONFIG || {}).ESCUTA || {};
  var F = window.Formatos;
  var LIB_QR = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js";

  var TIPOS = { falta: "Faltou produto", sugestao: "Sugestão", reclamacao: "Reclamação", elogio: "Elogio" };
  var SITUACOES = { novo: "Novo", em_analise: "Em análise", resolvido: "Resolvido" };

  var u = null;          // utilidades do app (toast, erros, copiar...)
  var banco = null;
  var plaquinhas = [];
  var mensagens = [];
  var catalogo = [];
  var aberta = null;     // mensagem aberta na janela de detalhe
  var plaquinhaEditando = null;
  var catalogoEditando = null;
  var jaBuscou = false;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return u.escapar(s); }

  function dataHora(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    return d.toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" }) + " " +
      d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Fortaleza" });
  }
  function hojeISO() { return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Fortaleza" }); }
  function diasAtras(n) {
    var d = new Date();
    d.setDate(d.getDate() - n);
    return d.toLocaleDateString("sv-SE", { timeZone: "America/Fortaleza" });
  }
  function telefoneBR(t) {
    if (!t) return "";
    return t.length === 11 ? "(" + t.slice(0, 2) + ") " + t.slice(2, 7) + "-" + t.slice(7)
      : "(" + t.slice(0, 2) + ") " + t.slice(2, 6) + "-" + t.slice(6);
  }
  function urlPlaquinha(p) {
    return String(CFG.URL_PUBLICA || location.origin).replace(/\/+$/, "") + "/q/" + p.token;
  }
  function abrirJanela(id) {
    var d = $(id);
    if (d.showModal) { if (!d.open) d.showModal(); } else d.setAttribute("open", "");
  }
  function fecharJanela(id) {
    var d = $(id);
    if (d.close) d.close(); else d.removeAttribute("open");
  }
  // Assunto curto de uma mensagem: produtos, título da sugestão ou começo do texto
  function assunto(m) {
    if (m.tipo === "falta" && m.itens && m.itens.length) {
      return m.itens.map(function (i) { return i.nome; }).join(", ");
    }
    if (m.titulo) return m.titulo;
    var d = m.descricao || "";
    return d.length > 90 ? d.slice(0, 90) + "…" : d;
  }
  function etiquetaSituacao(s) {
    return '<span class="etiqueta sit-' + esc(s) + '">' + esc(SITUACOES[s] || s) + "</span>";
  }

  /* ============================ Visão geral ============================ */

  function carregarGeral() {
    $("esc-geral").innerHTML = '<p class="vazio">Carregando…</p>';
    banco.resumo().then(function (r) {
      var cartao = function (rotulo, valor, link) {
        return '<a class="bloco cartao-numero" href="' + link + '"><p class="rotulo">' + rotulo + '</p><p class="numero">' + valor + "</p></a>";
      };
      var tipos = Object.keys(TIPOS).map(function (t) {
        return "<tr><td>" + TIPOS[t] + "</td><td>" + ((r.por_tipo || {})[t] || 0) + "</td></tr>";
      }).join("");
      var produtos = (r.produtos_mais_pedidos || []);
      $("esc-geral").innerHTML =
        '<div class="cartoes">' +
        cartao("Mensagens recebidas", r.total, "#escuta-mensagens") +
        cartao("Novas", r.novo, "#escuta-mensagens") +
        cartao("Em análise", r.em_analise, "#escuta-mensagens") +
        cartao("Resolvidas", r.resolvido, "#escuta-mensagens") +
        "</div>" +
        '<div class="cartoes"><a class="bloco cartao-numero" href="#escuta-plaquinhas"><p class="rotulo">Plaquinhas ativas</p><p class="numero">' +
        r.plaquinhas_ativas + "</p></a></div>" +
        (r.total ? '<div class="bloco"><h2>Por assunto</h2><table><tbody>' + tipos + "</tbody></table></div>" : "") +
        '<div class="bloco"><h2>Produtos pedidos mais de uma vez</h2>' +
        (produtos.length
          ? "<table><tbody>" + produtos.map(function (p) {
            return "<tr><td>" + esc(p.nome) + "</td><td>" + p.vezes + " vezes</td></tr>";
          }).join("") + "</tbody></table>"
          : '<p class="suave">Ainda não há produto pedido por mais de um cliente.</p>') +
        "</div>" +
        '<div class="bloco"><h2>Formulário dos clientes</h2>' +
        '<p class="suave mini">Os clientes chegam pelo QR code de cada plaquinha. Para testar sem plaquinha:</p>' +
        '<p><a href="/escuta/' + (u.demo ? "?demo=1" : "") + '" target="_blank" rel="noopener">Abrir o formulário</a></p></div>';
      // Os atalhos já filtram a lista
      Array.prototype.forEach.call($("esc-geral").querySelectorAll(".cartao-numero"), function (a, i) {
        a.addEventListener("click", function () {
          var s = ["", "novo", "em_analise", "resolvido"][i];
          if (i < 4) { limparFiltros(); $("esc-situacao").value = s || ""; buscarMensagens(); }
        });
      });
    }, function (e) {
      $("esc-geral").innerHTML = '<p class="vazio">Não foi possível carregar.</p>';
      u.mostrarErro(e);
    });
  }

  /* ============================== Mensagens ============================== */

  function limparFiltros() {
    $("esc-de").value = diasAtras(90);
    $("esc-ate").value = hojeISO();
    ["esc-tipo", "esc-situacao", "esc-setor", "esc-plaquinha", "esc-produto"].forEach(function (id) { $(id).value = ""; });
  }

  function filtros() {
    return {
      de: $("esc-de").value, ate: $("esc-ate").value, tipo: $("esc-tipo").value, situacao: $("esc-situacao").value,
      setor: $("esc-setor").value, plaquinha_id: $("esc-plaquinha").value, produto: $("esc-produto").value.trim()
    };
  }

  function preencherSelecoes() {
    var setores = {};
    plaquinhas.forEach(function (p) { setores[p.setor] = true; });
    var manterSetor = $("esc-setor").value, manterPl = $("esc-plaquinha").value;
    $("esc-setor").innerHTML = '<option value="">Todos</option>' + Object.keys(setores).sort().map(function (s) {
      return '<option value="' + esc(s) + '">' + esc(s) + "</option>";
    }).join("");
    $("esc-plaquinha").innerHTML = '<option value="">Todas</option>' + plaquinhas.map(function (p) {
      return '<option value="' + esc(p.id) + '">' + esc(p.setor + " · " + p.nome) + (p.ativa ? "" : " (inativa)") + "</option>";
    }).join("");
    $("esc-setor").value = manterSetor;
    $("esc-plaquinha").value = manterPl;
    var sugestoes = (CFG.SETORES || []).slice();
    Object.keys(setores).forEach(function (s) { if (sugestoes.indexOf(s) < 0) sugestoes.push(s); });
    $("esc-setores").innerHTML = sugestoes.sort().map(function (s) { return '<option value="' + esc(s) + '"></option>'; }).join("");
  }

  function carregarPlaquinhas() {
    return banco.plaquinhas().then(function (lista) {
      plaquinhas = lista || [];
      preencherSelecoes();
      return plaquinhas;
    });
  }

  function buscarMensagens() {
    jaBuscou = true;
    u.limparErro();
    var f = filtros();
    if (f.de && f.ate && f.de > f.ate) { u.mostrarErro({ message: "A data \"De\" está depois da data \"Até\"." }); return; }
    $("esc-lista").innerHTML = '<p class="vazio">Carregando…</p>';
    $("esc-contagem").textContent = "";
    if (location.hash !== "#escuta-mensagens") location.hash = "#escuta-mensagens";
    banco.listar(f).then(function (lista) {
      mensagens = lista || [];
      desenharMensagens();
    }, function (e) {
      $("esc-lista").innerHTML = '<p class="vazio">Não foi possível carregar.</p>';
      u.mostrarErro(e);
    });
  }

  function desenharMensagens() {
    $("esc-contagem").textContent = mensagens.length === 1 ? "1 mensagem" : mensagens.length + " mensagens";
    if (!mensagens.length) {
      $("esc-lista").innerHTML = '<p class="vazio">Nenhuma mensagem com estes filtros.</p>';
      return;
    }
    $("esc-lista").innerHTML = mensagens.map(function (m) {
      var origem = m.setor ? m.setor + " · " + m.plaquinha_nome : "Sem plaquinha";
      var contato = [m.nome, telefoneBR(m.telefone)].filter(Boolean).join(" · ");
      return '<button type="button" class="registro msg" data-id="' + esc(m.id) + '">' +
        '<span class="r-titulo"><span class="etiqueta tipo-' + esc(m.tipo) + '">' + esc(TIPOS[m.tipo]) + "</span>" + etiquetaSituacao(m.situacao) + "</span>" +
        '<span class="r-sub direita">' + esc(dataHora(m.criado_em)) + "</span>" +
        '<span class="msg-assunto">' + esc(assunto(m) || "(sem texto)") + (m.fotos ? ' <span class="suave">· com foto</span>' : "") + "</span>" +
        '<span class="r-sub">' + esc(origem) + (contato ? " · " + esc(contato) : "") + "</span>" +
        '<span class="r-sub direita">' + esc(m.protocolo) + "</span></button>";
    }).join("");
  }

  function abrirMensagem(id) {
    $("esc-detalhe-corpo").innerHTML = '<p class="vazio">Carregando…</p>';
    $("esc-detalhe-titulo").textContent = "Mensagem";
    abrirJanela("esc-detalhe");
    banco.detalhe(id).then(desenharDetalhe, function (e) { fecharJanela("esc-detalhe"); u.mostrarErro(e); });
  }

  function desenharDetalhe(m) {
    if (!m) { $("esc-detalhe-corpo").innerHTML = '<p class="vazio">Mensagem não encontrada.</p>'; return; }
    aberta = m;
    $("esc-detalhe-titulo").textContent = TIPOS[m.tipo] + " · " + m.protocolo;
    var linhas = [
      ["Recebida em", dataHora(m.criado_em)],
      ["Origem", m.setor ? m.setor + " · " + m.plaquinha_nome + (m.local ? " (" + m.local + ")" : "") : "Sem plaquinha (acesso direto)"]
    ];
    if (m.titulo) linhas.push(["Sugestão", m.titulo]);
    if (m.descricao) linhas.push([m.tipo === "falta" ? "Observação" : "Mensagem", m.descricao]);
    if (m.nome || m.telefone) {
      linhas.push(["Nome", m.nome || "—"]);
      linhas.push(["Telefone", m.telefone ? telefoneBR(m.telefone) : "—"]);
      if (m.consentimento_em) linhas.push(["Autorizou contato", dataHora(m.consentimento_em)]);
    } else if (m.contato_apagado_em) {
      linhas.push(["Contato", "Apagado em " + dataHora(m.contato_apagado_em) + " (política de 12 meses)"]);
    } else {
      linhas.push(["Contato", "Anônimo"]);
    }
    var html = '<div class="alternador situacoes" role="radiogroup" aria-label="Situação">' +
      Object.keys(SITUACOES).map(function (s) {
        return '<button type="button" role="radio" data-situacao="' + s + '" aria-checked="' + (m.situacao === s) + '">' + SITUACOES[s] + "</button>";
      }).join("") + "</div>" +
      '<dl class="detalhes">' + linhas.map(function (l) {
        return "<dt>" + esc(l[0]) + "</dt><dd>" + esc(l[1]) + "</dd>";
      }).join("") + "</dl>";
    if (m.itens && m.itens.length) {
      html += '<h3 class="sub">Produtos (' + m.itens.length + ")</h3><ul class=\"lista-itens\">" + m.itens.map(function (i) {
        var det = [i.marca, i.apresentacao, i.codigo_barras ? "Cód. " + i.codigo_barras : ""].filter(Boolean).join(" · ");
        return "<li>" + (i.imagem_url ? '<img src="' + esc(i.imagem_url) + '" alt="" loading="lazy" referrerpolicy="no-referrer" />' : '<span class="sem-foto"></span>') +
          "<span><strong>" + esc(i.nome) + "</strong>" + (det ? '<br><span class="suave">' + esc(det) + "</span>" : "") + "</span></li>";
      }).join("") + "</ul>";
    }
    if (m.fotos && m.fotos.length) {
      html += '<h3 class="sub">Foto</h3><div class="fotos">' + m.fotos.map(function (f, n) {
        return '<button type="button" class="botao" data-foto="' + n + '">Ver foto ' + (m.fotos.length > 1 ? n + 1 : "") + "</button>";
      }).join("") + '</div><div id="esc-foto-area"></div>';
    }
    if (m.historico && m.historico.length) {
      html += '<h3 class="sub">Histórico</h3><ul class="historico">' + m.historico.map(function (h) {
        return "<li>" + esc(dataHora(h.em)) + " · " + esc(SITUACOES[h.situacao] || h.situacao) + " · " + esc(h.por) + "</li>";
      }).join("") + "</ul>";
    }
    $("esc-detalhe-corpo").innerHTML = html;
  }

  function mudarSituacao(s) {
    if (!aberta || aberta.situacao === s) return;
    var id = aberta.id;
    banco.mudarSituacao(id, s).then(function (m) {
      desenharDetalhe(m);
      mensagens.forEach(function (x) { if (x.id === id) x.situacao = m.situacao; });
      desenharMensagens();
      u.toast("Situação: " + SITUACOES[s]);
    }, function (e) { fecharJanela("esc-detalhe"); u.mostrarErro(e); });
  }

  function verFoto(n) {
    var f = aberta.fotos[n];
    $("esc-foto-area").innerHTML = '<p class="vazio">Abrindo foto…</p>';
    // Link temporário (10 minutos): a foto não fica pública
    banco.urlFoto(f.caminho).then(function (url) {
      $("esc-foto-area").innerHTML = '<a href="' + esc(url) + '" target="_blank" rel="noopener"><img class="foto-grande" src="' + esc(url) + '" alt="Foto enviada pelo cliente" /></a>';
    }, function (e) { $("esc-foto-area").innerHTML = '<p class="vazio">' + esc(e.message) + "</p>"; });
  }

  function exportarCSV() {
    if (!mensagens.length) { u.toast("Nada para exportar com estes filtros."); return; }
    var cab = ["Protocolo", "Data", "Hora", "Assunto", "Situação", "Setor", "Plaquinha", "Local", "Título", "Descrição",
      "Produtos", "Nome", "Telefone", "Foto"];
    var linhas = mensagens.map(function (m) {
      var dh = dataHora(m.criado_em).split(" ");
      return [m.protocolo, dh[0], dh[1], TIPOS[m.tipo], SITUACOES[m.situacao], m.setor || "", m.plaquinha_nome || "",
        m.local || "", m.titulo || "", m.descricao || "",
        (m.itens || []).map(function (i) { return [i.nome, i.marca, i.apresentacao, i.codigo_barras].filter(Boolean).join(" - "); }).join("; "),
        m.nome || "", telefoneBR(m.telefone), m.fotos ? "Sim" : "Não"];
    });
    var f = filtros();
    u.baixar("veneza-escuta_" + (f.de || "inicio") + "_a_" + (f.ate || "hoje") + ".csv", F.montarCSV(cab, linhas), "text/csv;charset=utf-8");
  }

  /* ============================== Plaquinhas ============================== */

  function desenharPlaquinhas() {
    var aviso = $("esc-aviso-dominio");
    aviso.hidden = !!CFG.DOMINIO_DEFINITIVO;
    aviso.textContent = "Endereço de teste: os QR codes apontam para " + String(CFG.URL_PUBLICA || location.origin) +
      ". As plaquinhas saem marcadas como TESTE. Só imprima as definitivas depois de configurar o domínio oficial.";
    if (!plaquinhas.length) {
      $("esc-plaquinhas").innerHTML = '<p class="vazio">Nenhuma plaquinha cadastrada ainda.</p>';
      return;
    }
    $("esc-plaquinhas").innerHTML = plaquinhas.map(function (p) {
      return '<div class="bloco plaquinha' + (p.ativa ? "" : " inativa") + '">' +
        '<div class="pl-topo"><div><strong>' + esc(p.nome) + "</strong>" +
        '<p class="suave mini">' + esc(p.setor) + (p.local ? " · " + esc(p.local) : "") + "</p></div>" +
        '<span class="etiqueta ' + (p.ativa ? "sit-resolvido" : "") + '">' + (p.ativa ? "Ativa" : "Inativa") + "</span></div>" +
        '<p class="mini">' + p.mensagens + (p.mensagens === 1 ? " mensagem" : " mensagens") +
        (p.novas ? " · <strong>" + p.novas + (p.novas === 1 ? " nova" : " novas") + "</strong>" : "") +
        ' · <span class="suave">criada em ' + esc(dataHora(p.criado_em).split(" ")[0]) + "</span></p>" +
        '<div class="pl-botoes">' +
        '<button type="button" class="botao pequeno" data-qr="' + esc(p.id) + '">QR code</button>' +
        '<button type="button" class="botao pequeno" data-ver="' + esc(p.id) + '">Mensagens</button>' +
        '<button type="button" class="botao pequeno" data-editar-pl="' + esc(p.id) + '">Editar</button>' +
        '<button type="button" class="botao pequeno" data-ativar="' + esc(p.id) + '">' + (p.ativa ? "Desativar" : "Ativar") + "</button>" +
        (p.mensagens ? "" : '<button type="button" class="botao pequeno perigo" data-apagar-pl="' + esc(p.id) + '">Apagar</button>') +
        "</div></div>";
    }).join("");
  }

  function atualizarPlaquinhas() {
    $("esc-plaquinhas").innerHTML = '<p class="vazio">Carregando…</p>';
    return carregarPlaquinhas().then(desenharPlaquinhas, function (e) {
      $("esc-plaquinhas").innerHTML = '<p class="vazio">Não foi possível carregar.</p>';
      u.mostrarErro(e);
    });
  }

  function formPlaquinha(p) {
    plaquinhaEditando = p ? p.id : null;
    $("esc-pl-titulo").textContent = p ? "Editar plaquinha" : "Nova plaquinha";
    $("esc-pl-nome").value = p ? p.nome : "";
    $("esc-pl-setor").value = p ? p.setor : "";
    $("esc-pl-local").value = p ? p.local : "";
    $("esc-pl-ativa").value = !p || p.ativa ? "1" : "0";
    $("esc-pl-salvar").textContent = p ? "Salvar alterações" : "Cadastrar plaquinha";
    $("esc-pl-cancelar").hidden = !p;
  }

  function salvarPlaquinha() {
    u.limparErro();
    var dados = {
      id: plaquinhaEditando, nome: $("esc-pl-nome").value.trim(), setor: $("esc-pl-setor").value.trim(),
      local: $("esc-pl-local").value.trim(), ativa: $("esc-pl-ativa").value === "1"
    };
    if (!dados.nome) { u.mostrarErro({ message: "Dê um nome para a plaquinha." }); return; }
    if (!dados.setor) { u.mostrarErro({ message: "Informe o setor da plaquinha." }); return; }
    var botao = $("esc-pl-salvar");
    u.ocupado(botao, true, "Salvando…");
    banco.salvarPlaquinha(dados).then(function (p) {
      u.toast(plaquinhaEditando ? "Plaquinha atualizada. O QR code continua o mesmo." : "Plaquinha cadastrada: " + p.nome);
      formPlaquinha(null);
      return atualizarPlaquinhas();
    }, u.mostrarErro).then(function () { u.ocupado(botao, false); });
  }

  function alternarAtiva(p) {
    var texto = p.ativa
      ? "Desativar \"" + p.nome + "\"? O QR code dela deixa de aceitar mensagens. O histórico continua guardado."
      : "Ativar \"" + p.nome + "\" de novo? O QR code volta a aceitar mensagens.";
    if (!confirm(texto)) return;
    banco.salvarPlaquinha({ id: p.id, nome: p.nome, setor: p.setor, local: p.local, ativa: !p.ativa }).then(function () {
      u.toast(p.ativa ? "Plaquinha desativada." : "Plaquinha ativada.");
      return atualizarPlaquinhas();
    }, u.mostrarErro);
  }

  // Desenha o QR code (biblioteca qrcode-generator, carregada só quando precisa)
  function gerarQR(texto) {
    return u.carregarScript(LIB_QR).then(function () {
      var qr = window.qrcode(0, "Q");
      qr.addData(texto);
      qr.make();
      return qr;
    });
  }
  function qrSVG(qr) {
    return qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
  }
  function qrPNG(qr, nome) {
    var n = qr.getModuleCount(), margem = 4, lado = 1200;
    var celula = Math.floor(lado / (n + margem * 2));
    var tamanho = celula * (n + margem * 2);
    var c = document.createElement("canvas");
    c.width = c.height = tamanho;
    var g = c.getContext("2d");
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, tamanho, tamanho);
    g.fillStyle = "#000000";
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        if (qr.isDark(y, x)) g.fillRect((x + margem) * celula, (y + margem) * celula, celula, celula);
      }
    }
    c.toBlob(function (b) { u.baixar(nome, b); }, "image/png");
  }
  function nomeArquivo(p) {
    return ("qr-" + p.setor + "-" + p.nome).normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() + ".png";
  }

  function abrirQR(p) {
    var url = urlPlaquinha(p);
    $("esc-qr-titulo").textContent = p.nome;
    $("esc-qr-corpo").innerHTML = '<p class="vazio">Gerando QR code…</p>';
    abrirJanela("esc-qr");
    gerarQR(url).then(function (qr) {
      $("esc-qr-corpo").innerHTML =
        '<p class="suave mini">' + esc(p.setor) + (p.local ? " · " + esc(p.local) : "") + (p.ativa ? "" : " · <strong>inativa</strong>") + "</p>" +
        '<div class="qr-caixa">' + qrSVG(qr) + "</div>" +
        '<p class="qr-url"><a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url) + "</a></p>" +
        (CFG.DOMINIO_DEFINITIVO ? "" : '<p class="mini aviso-teste">Endereço de teste. Não imprima a versão definitiva ainda.</p>') +
        '<div class="acoes quatro">' +
        '<button type="button" class="botao" id="esc-qr-png">Baixar PNG</button>' +
        '<button type="button" class="botao" id="esc-qr-copiar">Copiar link</button>' +
        '<a class="botao" href="plaquinhas.html?ids=' + encodeURIComponent(p.id) + (u.demo ? "&demo=1" : "") + '" target="_blank" rel="noopener">Imprimir plaquinha</a>' +
        '<a class="botao" href="' + esc(url) + (u.demo ? "?demo=1" : "") + '" target="_blank" rel="noopener">Testar</a>' +
        "</div>";
      $("esc-qr-png").addEventListener("click", function () { qrPNG(qr, nomeArquivo(p)); });
      $("esc-qr-copiar").addEventListener("click", function () { u.copiar(url); });
    }, function (e) { $("esc-qr-corpo").innerHTML = '<p class="vazio">' + esc(e.message) + "</p>"; });
  }

  /* =============================== Catálogo =============================== */

  var buscaCatTimer = null;
  function atualizarCatalogo() {
    var termo = $("esc-cat-busca").value.trim();
    banco.catalogo(termo).then(function (r) {
      catalogo = r.itens || [];
      $("esc-cat-total").textContent = "(" + r.total + (r.total === 1 ? " produto)" : " produtos)");
      if (!catalogo.length) {
        $("esc-catalogo").innerHTML = '<p class="vazio">' + (r.total ? "Nada encontrado." :
          "O catálogo está vazio. Importe produtos do Open Food Facts ou cadastre à mão. Enquanto estiver vazio, o cliente digita o produto livremente.") + "</p>";
        return;
      }
      $("esc-catalogo").innerHTML = '<div class="bloco">' + catalogo.map(function (c) {
        var det = [c.marca, c.apresentacao, c.codigo_barras].filter(Boolean).join(" · ");
        return '<div class="cat-item">' +
          (c.imagem_url ? '<img src="' + esc(c.imagem_url) + '" alt="" loading="lazy" referrerpolicy="no-referrer" />' : '<span class="sem-foto"></span>') +
          "<span><strong>" + esc(c.nome) + "</strong><br><span class=\"suave mini\">" + esc(det) +
          (c.fonte === "openfoodfacts" ? " · Open Food Facts" : "") + "</span></span>" +
          '<span class="cat-botoes"><button type="button" class="botao pequeno" data-editar-cat="' + esc(c.id) + '">Editar</button>' +
          '<button type="button" class="botao pequeno perigo" data-apagar-cat="' + esc(c.id) + '">Apagar</button></span></div>';
      }).join("") + "</div>";
    }, function (e) {
      $("esc-catalogo").innerHTML = '<p class="vazio">Não foi possível carregar.</p>';
      u.mostrarErro(e);
    });
  }

  function formCatalogo(c) {
    catalogoEditando = c ? c.id : null;
    $("esc-cat-form-titulo").textContent = c ? "Editar produto" : "Cadastrar produto à mão";
    $("esc-cat-nome").value = c ? c.nome : "";
    $("esc-cat-marca").value = c ? c.marca || "" : "";
    $("esc-cat-apresentacao").value = c ? c.apresentacao || "" : "";
    $("esc-cat-codigo").value = c ? c.codigo_barras || "" : "";
    $("esc-cat-imagem").value = c ? c.imagem_url || "" : "";
    $("esc-cat-cancelar").hidden = !c;
  }

  function salvarCatalogo() {
    u.limparErro();
    var nome = $("esc-cat-nome").value.trim();
    var codigo = $("esc-cat-codigo").value.replace(/\D/g, "");
    var imagem = $("esc-cat-imagem").value.trim();
    if (!nome) { u.mostrarErro({ message: "Informe o nome do produto." }); return; }
    if (codigo && (codigo.length < 6 || codigo.length > 14)) { u.mostrarErro({ message: "Código de barras deve ter de 6 a 14 números." }); return; }
    if (imagem && !/^https:\/\//.test(imagem)) { u.mostrarErro({ message: "O endereço da foto deve começar com https://" }); return; }
    banco.catalogoSalvar([{ id: catalogoEditando, nome: nome, marca: $("esc-cat-marca").value.trim(),
      apresentacao: $("esc-cat-apresentacao").value.trim(), codigo_barras: codigo, imagem_url: imagem || null,
      fonte: "manual" }]).then(function () {
      u.toast("Produto salvo no catálogo.");
      formCatalogo(null);
      atualizarCatalogo();
    }, u.mostrarErro);
  }

  // ---- Open Food Facts (consulta feita pelo administrador, nunca a cada letra do cliente)
  var OFF = "https://world.openfoodfacts.org";
  var OFF_CAMPOS = "code,product_name,product_name_pt,brands,quantity,image_front_small_url";
  var offResultado = [];
  var offEspera = 0;

  function produtoOFF(p) {
    var img = p.image_front_small_url;
    return {
      codigo_barras: String(p.code || "").replace(/\D/g, ""),
      nome: (p.product_name_pt || p.product_name || "").trim(),
      marca: String(p.brands || "").split(",")[0].trim(),
      apresentacao: String(p.quantity || "").trim(),
      imagem_url: /^https:\/\//.test(img || "") ? img : null,
      fonte: "openfoodfacts"
    };
  }

  function buscarOFF() {
    u.limparErro();
    var codigo = $("esc-off-codigo").value.replace(/\D/g, "");
    var termo = $("esc-off-termo").value.trim();
    if (!codigo && termo.length < 3) { u.mostrarErro({ message: "Digite um código de barras ou pelo menos 3 letras do nome." }); return; }
    // Respeita o limite do Open Food Facts para buscas por nome (10 por minuto)
    if (!codigo && Date.now() < offEspera) {
      u.mostrarErro({ message: "Aguarde alguns segundos entre uma busca por nome e outra (limite do Open Food Facts)." });
      return;
    }
    var url = codigo
      ? OFF + "/api/v2/product/" + codigo + ".json?fields=" + OFF_CAMPOS
      : OFF + "/cgi/search.pl?search_terms=" + encodeURIComponent(termo) +
        "&search_simple=1&action=process&json=1&page_size=40&tagtype_0=countries&tag_contains_0=contains&tag_0=brazil&fields=" + OFF_CAMPOS;
    if (!codigo) offEspera = Date.now() + 7000;
    var botao = $("esc-off-buscar");
    u.ocupado(botao, true, "Buscando…");
    $("esc-off-resultado").innerHTML = "";
    fetch(url).then(function (r) {
      if (r.status === 429) throw new Error("O Open Food Facts pediu para esperar. Tente de novo em 1 minuto.");
      if (!r.ok && r.status !== 404) throw new Error("O Open Food Facts não respondeu (erro " + r.status + "). Tente mais tarde.");
      return r.json();
    }).then(function (j) {
      var lista = codigo ? (j && j.status === 1 && j.product ? [j.product] : []) : ((j && j.products) || []);
      offResultado = lista.map(produtoOFF).filter(function (p) { return p.nome; });
      desenharOFF(codigo ? "código " + codigo : "\"" + termo + "\"");
    }).catch(function (e) {
      var msg = /fetch|network|load failed/i.test(e.message || "")
        ? "Não foi possível falar com o Open Food Facts. Confira a internet e tente de novo."
        : e.message;
      u.mostrarErro({ message: msg });
    }).then(function () { u.ocupado(botao, false); });
  }

  function desenharOFF(rotulo) {
    if (!offResultado.length) {
      $("esc-off-resultado").innerHTML = '<p class="vazio">Nada encontrado para ' + esc(rotulo) + ". Cadastre à mão abaixo.</p>";
      return;
    }
    $("esc-off-resultado").innerHTML = '<p class="mini">' + offResultado.length + " resultado(s) para " + esc(rotulo) +
      '. Marque os que quer no catálogo:</p><div class="off-lista">' + offResultado.map(function (p, i) {
        var det = [p.marca, p.apresentacao, p.codigo_barras].filter(Boolean).join(" · ");
        return '<label class="cat-item"><input type="checkbox" data-off="' + i + '" checked />' +
          (p.imagem_url ? '<img src="' + esc(p.imagem_url) + '" alt="" loading="lazy" referrerpolicy="no-referrer" />' : '<span class="sem-foto"></span>') +
          "<span><strong>" + esc(p.nome) + '</strong><br><span class="suave mini">' + esc(det) + "</span></span></label>";
      }).join("") + '</div><div class="acoes"><button type="button" class="botao primario" id="esc-off-adicionar">Adicionar marcados ao catálogo</button></div>' +
      '<p class="suave mini">Dados e imagens: Open Food Facts (ODbL / CC BY-SA).</p>';
    $("esc-off-adicionar").addEventListener("click", function () {
      var marcados = Array.prototype.filter.call($("esc-off-resultado").querySelectorAll("[data-off]"), function (c) { return c.checked; })
        .map(function (c) { return offResultado[+c.dataset.off]; });
      if (!marcados.length) { u.toast("Nenhum produto marcado."); return; }
      banco.catalogoSalvar(marcados).then(function (n) {
        u.toast(n + (n === 1 ? " produto adicionado" : " produtos adicionados") + " ao catálogo.");
        $("esc-off-resultado").innerHTML = "";
        atualizarCatalogo();
      }, u.mostrarErro);
    });
  }

  /* ================================ Início ================================ */

  function ligarEventos() {
    $("esc-buscar").addEventListener("click", buscarMensagens);
    ["esc-tipo", "esc-situacao", "esc-setor", "esc-plaquinha"].forEach(function (id) {
      $(id).addEventListener("change", buscarMensagens);
    });
    $("esc-produto").addEventListener("keydown", function (ev) { if (ev.key === "Enter") buscarMensagens(); });
    $("esc-csv").addEventListener("click", exportarCSV);
    $("esc-lista").addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-id]");
      if (b) abrirMensagem(b.dataset.id);
    });
    $("esc-detalhe-fechar").addEventListener("click", function () { fecharJanela("esc-detalhe"); });
    $("esc-detalhe-corpo").addEventListener("click", function (ev) {
      var b = ev.target.closest("button");
      if (!b) return;
      if (b.dataset.situacao) mudarSituacao(b.dataset.situacao);
      if (b.dataset.foto) verFoto(+b.dataset.foto);
    });

    $("esc-pl-salvar").addEventListener("click", salvarPlaquinha);
    $("esc-pl-cancelar").addEventListener("click", function () { formPlaquinha(null); });
    $("esc-plaquinhas").addEventListener("click", function (ev) {
      var b = ev.target.closest("button");
      if (!b) return;
      var id = b.dataset.qr || b.dataset.ver || b.dataset.editarPl || b.dataset.ativar || b.dataset.apagarPl;
      var p = plaquinhas.filter(function (x) { return x.id === id; })[0];
      if (!p) return;
      if (b.dataset.qr) abrirQR(p);
      if (b.dataset.ver) { limparFiltros(); $("esc-de").value = ""; $("esc-plaquinha").value = p.id; buscarMensagens(); }
      if (b.dataset.editarPl) { formPlaquinha(p); window.scrollTo({ top: 0, behavior: "smooth" }); $("esc-pl-nome").focus(); }
      if (b.dataset.ativar) alternarAtiva(p);
      if (b.dataset.apagarPl && confirm("Apagar a plaquinha \"" + p.nome + "\"? Ela nunca recebeu mensagens.")) {
        banco.apagarPlaquinha(p.id).then(function () { u.toast("Plaquinha apagada."); atualizarPlaquinhas(); }, u.mostrarErro);
      }
    });
    $("esc-imprimir-todas").addEventListener("click", function () {
      if (!plaquinhas.some(function (p) { return p.ativa; })) { u.toast("Nenhuma plaquinha ativa para imprimir."); return; }
      window.open("plaquinhas.html?todas=1" + (u.demo ? "&demo=1" : ""), "_blank", "noopener");
    });
    $("esc-qr-fechar").addEventListener("click", function () { fecharJanela("esc-qr"); });

    $("esc-off-buscar").addEventListener("click", buscarOFF);
    ["esc-off-codigo", "esc-off-termo"].forEach(function (id) {
      $(id).addEventListener("keydown", function (ev) { if (ev.key === "Enter") buscarOFF(); });
    });
    $("esc-cat-salvar").addEventListener("click", salvarCatalogo);
    $("esc-cat-cancelar").addEventListener("click", function () { formCatalogo(null); });
    $("esc-cat-busca").addEventListener("input", function () {
      clearTimeout(buscaCatTimer);
      buscaCatTimer = setTimeout(atualizarCatalogo, 300);
    });
    $("esc-catalogo").addEventListener("click", function (ev) {
      var b = ev.target.closest("button");
      if (!b) return;
      var c = catalogo.filter(function (x) { return x.id === (b.dataset.editarCat || b.dataset.apagarCat); })[0];
      if (!c) return;
      if (b.dataset.editarCat) { formCatalogo(c); window.scrollTo({ top: 0, behavior: "smooth" }); }
      if (b.dataset.apagarCat && confirm("Apagar \"" + c.nome + "\" do catálogo? Mensagens antigas não mudam.")) {
        banco.catalogoApagar(c.id).then(function () { u.toast("Produto apagado do catálogo."); atualizarCatalogo(); }, u.mostrarErro);
      }
    });
  }

  var iniciado = false;
  window.EscutaAdmin = {
    iniciar: function (opcoes) {
      u = opcoes;
      banco = opcoes.banco;
      if (iniciado) return;
      iniciado = true;
      limparFiltros();
      ligarEventos();
    },
    mostrar: function (aba) {
      u.limparErro();
      if (aba === "escuta") carregarGeral();
      if (aba === "escuta-mensagens") {
        carregarPlaquinhas().then(function () { if (!jaBuscou) buscarMensagens(); }, u.mostrarErro);
      }
      if (aba === "escuta-plaquinhas") atualizarPlaquinhas();
      if (aba === "escuta-catalogo") atualizarCatalogo();
    }
  };
})();
