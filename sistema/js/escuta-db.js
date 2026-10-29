/*
 * Veneza Escuta: acesso aos dados.
 * Usado pela página pública (/escuta/) e pelo painel (/sistema/).
 * Tudo passa por funções do banco (supabase/escuta.sql), que validam os dados e conferem permissões.
 * Com ?demo=1 usa um banco de mentira guardado só neste aparelho (para testar as telas).
 */
(function () {
  "use strict";

  var CFG = window.VENEZA_CONFIG || {};
  var PASTA_FOTOS = "escuta-fotos";

  var MENSAGENS = {
    ESCUTA_ROBO: "Não foi possível enviar agora. Espere alguns segundos e tente de novo.",
    ESCUTA_LIMITE: "Recebemos muitos envios desta rede em pouco tempo. Tente de novo mais tarde.",
    ESCUTA_PLAQUINHA: "Este QR code não está mais ativo. Procure outra plaquinha na loja ou fale com um atendente.",
    ESCUTA_FOTO: "A foto não chegou ao sistema. Anexe de novo ou envie sem foto.",
    ESCUTA_SEM_PERMISSAO: "Seu usuário não tem permissão para o Veneza Escuta."
  };

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  // Erro do banco/rede -> mensagem clara (sem detalhes técnicos)
  function erroAmigavel(e, acao) {
    var msg = (e && (e.message || e.error_description || e.error)) || String(e || "");
    var err = new Error();
    var codigo = (msg.match(/ESCUTA_[A-Z_]+/) || [])[0];
    if (codigo === "ESCUTA_DADOS") {
      var texto = msg.split("ESCUTA_DADOS:")[1] || "confira os dados";
      texto = texto.trim();
      err.message = texto.charAt(0).toUpperCase() + texto.slice(1) + ".";
      err.tipo = "dados";
    } else if (codigo && MENSAGENS[codigo]) {
      err.message = MENSAGENS[codigo];
      err.tipo = codigo === "ESCUTA_SEM_PERMISSAO" ? "permissao" : "envio";
    } else if ((typeof navigator !== "undefined" && navigator.onLine === false) ||
        /failed to fetch|networkerror|network request failed|load failed/i.test(msg)) {
      err.message = "Sem internet. Não foi possível " + acao + ". Nada do que você preencheu foi perdido; tente de novo quando a conexão voltar.";
      err.tipo = "rede";
    } else if ((e && e.status === 401) || /jwt|token is expired|session/i.test(msg)) {
      err.message = "Sua sessão expirou. Entre de novo para " + acao + ".";
      err.tipo = "sessao";
    } else if (/permission denied|row-level security/i.test(msg)) {
      err.message = MENSAGENS.ESCUTA_SEM_PERMISSAO;
      err.tipo = "permissao";
    } else {
      err.message = "Não foi possível " + acao + ". Tente de novo em instantes.";
      err.tipo = "outro";
    }
    err.original = e;
    return err;
  }

  /* ------------------------------ Supabase ------------------------------ */

  function criarSupabase(cliente) {
    function rpc(nome, args, acao) {
      return cliente.rpc(nome, args || {}).then(function (r) {
        if (r.error) throw erroAmigavel(r.error, acao);
        return r.data;
      }, function (e) { throw e && e.tipo ? e : erroAmigavel(e, acao); });
    }
    return {
      modo: "supabase",
      novoId: uuid,
      // ---- público
      plaquinha: function (token) { return rpc("escuta_plaquinha", { p_token: token }, "abrir o formulário"); },
      buscarProdutos: function (termo) { return rpc("escuta_buscar_produtos", { p_termo: termo }, "buscar produtos"); },
      enviarFoto: function (envioId, arquivo) {
        var ext = arquivo.type === "image/png" ? "png" : arquivo.type === "image/webp" ? "webp" : "jpg";
        var caminho = "envios/" + envioId + "/" + uuid() + "." + ext;
        return cliente.storage.from(PASTA_FOTOS).upload(caminho, arquivo, { contentType: arquivo.type, upsert: false })
          .then(function (r) {
            if (r.error && !/exists|duplicate/i.test(r.error.message || "")) throw erroAmigavel(r.error, "enviar a foto");
            return caminho;
          }, function (e) { throw erroAmigavel(e, "enviar a foto"); });
      },
      enviar: function (dados) { return rpc("escuta_enviar", { p: dados }, "enviar sua mensagem"); },
      // ---- painel
      resumo: function () { return rpc("escuta_resumo", {}, "carregar a visão geral"); },
      listar: function (f) { return rpc("escuta_listar", { f: f || {} }, "carregar as mensagens"); },
      detalhe: function (id) { return rpc("escuta_detalhe", { p_id: id }, "abrir a mensagem"); },
      mudarSituacao: function (id, s) {
        return rpc("escuta_mudar_situacao", { p_id: id, p_situacao: s }, "mudar a situação");
      },
      urlFoto: function (caminho) {
        return cliente.storage.from(PASTA_FOTOS).createSignedUrl(caminho, 600).then(function (r) {
          if (r.error) throw erroAmigavel(r.error, "abrir a foto");
          return r.data.signedUrl;
        });
      },
      plaquinhas: function () { return rpc("escuta_plaquinhas_listar", {}, "carregar as plaquinhas"); },
      salvarPlaquinha: function (p) { return rpc("escuta_salvar_plaquinha", { p: p }, "salvar a plaquinha"); },
      apagarPlaquinha: function (id) { return rpc("escuta_apagar_plaquinha", { p_id: id }, "apagar a plaquinha"); },
      catalogo: function (termo) { return rpc("escuta_catalogo_listar", { p_termo: termo || "" }, "carregar o catálogo"); },
      catalogoSalvar: function (lista) { return rpc("escuta_catalogo_salvar", { p_itens: lista }, "salvar no catálogo"); },
      catalogoApagar: function (id) { return rpc("escuta_catalogo_apagar", { p_id: id }, "apagar do catálogo"); }
    };
  }

  /* ------------------- Demonstração (só neste aparelho) ------------------- */

  function criarDemo() {
    var P = "veneza.demo.escuta.";
    function ler(n) { try { return JSON.parse(localStorage.getItem(P + n)) || []; } catch (e) { return []; } }
    function gravar(n, v) {
      try { localStorage.setItem(P + n, JSON.stringify(v)); }
      catch (e) { throw erroAmigavel({ message: "armazenamento cheio" }, "salvar (demonstração)"); }
    }
    function norm(t) {
      return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    }
    function falha(codigo) { return Promise.reject(erroAmigavel({ message: codigo }, "concluir")); }
    function token() { return uuid().replace(/-/g, "").slice(0, 16); }
    function hoje(iso) { return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "America/Fortaleza" }); }

    // Catálogo de demonstração: produtos sem foto, só para testar a busca
    if (!localStorage.getItem(P + "catalogo")) {
      gravar("catalogo", [
        { id: uuid(), nome: "Café torrado e moído (demonstração)", marca: "Marca A", apresentacao: "250 g", codigo_barras: null, imagem_url: null, fonte: "manual" },
        { id: uuid(), nome: "Café em cápsula (demonstração)", marca: "Marca D", apresentacao: "10 un", codigo_barras: null, imagem_url: null, fonte: "manual" },
        { id: uuid(), nome: "Arroz branco tipo 1 (demonstração)", marca: "Marca B", apresentacao: "5 kg", codigo_barras: null, imagem_url: null, fonte: "manual" },
        { id: uuid(), nome: "Biscoito recheado chocolate (demonstração)", marca: "Marca C", apresentacao: "130 g", codigo_barras: null, imagem_url: null, fonte: "manual" }
      ]);
    }

    function contar(envios, plaquinhaId, situacao) {
      return envios.filter(function (e) {
        return e.plaquinha_id === plaquinhaId && (!situacao || e.situacao === situacao);
      }).length;
    }
    function completo(e) {
      var p = ler("plaquinhas").filter(function (x) { return x.id === e.plaquinha_id; })[0] || {};
      return Object.assign({}, e, { plaquinha_nome: p.nome || null, setor: p.setor || null, local: p.local || null,
        fotos: (e.fotos || []).length });
    }

    return {
      modo: "demo",
      novoId: uuid,
      plaquinha: function (t) {
        var p = ler("plaquinhas").filter(function (x) { return x.token === t; })[0];
        return Promise.resolve(p ? { nome: p.nome, setor: p.setor, local: p.local, ativa: p.ativa } : null);
      },
      buscarProdutos: function (termo) {
        var partes = norm(termo).split(/\s+/).filter(Boolean);
        if (norm(termo).trim().length < 2) return Promise.resolve([]);
        return Promise.resolve(ler("catalogo").filter(function (c) {
          var b = norm([c.nome, c.marca, c.apresentacao, c.codigo_barras].join(" "));
          return partes.every(function (p) { return b.indexOf(p) >= 0; });
        }).slice(0, 8));
      },
      enviarFoto: function (envioId, arquivo) {
        return new Promise(function (ok) {
          var r = new FileReader();
          r.onload = function () {
            var caminho = "envios/" + envioId + "/" + uuid() + ".jpg";
            var fotos = ler("fotos");
            fotos.push({ caminho: caminho, dados: r.result, tipo: arquivo.type, tamanho: arquivo.size });
            gravar("fotos", fotos);
            ok(caminho);
          };
          r.readAsDataURL(arquivo);
        });
      },
      enviar: function (d) {
        var envios = ler("envios");
        var existe = envios.filter(function (e) { return e.id === d.id; })[0];
        if (existe) return Promise.resolve({ protocolo: existe.protocolo, repetido: true });
        if (d.site || (d.tempo_ms || 0) < 2500) return falha("ESCUTA_ROBO");
        var plaquinha = null;
        if (d.token) {
          plaquinha = ler("plaquinhas").filter(function (x) { return x.token === d.token; })[0];
          if (!plaquinha || !plaquinha.ativa) return falha("ESCUTA_PLAQUINHA");
        }
        var tel = String(d.telefone || "").replace(/\D/g, "") || null;
        if ((d.nome || tel) && !d.consentimento) return falha("ESCUTA_DADOS: confirme a autorização para usar seu contato");
        var agora = new Date().toISOString();
        var letras = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", cod = "";
        for (var i = 0; i < 4; i++) cod += letras[Math.floor(Math.random() * letras.length)];
        var protocolo = "VZ-" + hoje(agora).slice(2).replace(/-/g, "") + "-" + cod;
        var catalogo = ler("catalogo");
        var foto = d.foto ? ler("fotos").filter(function (f) { return f.caminho === d.foto.caminho; })[0] : null;
        envios.push({
          id: d.id, protocolo: protocolo, tipo: d.tipo, titulo: d.titulo || null, descricao: d.descricao || null,
          plaquinha_id: plaquinha ? plaquinha.id : null, nome: d.nome || null, telefone: tel,
          situacao: "novo", criado_em: agora,
          itens: (d.itens || []).map(function (it, n) {
            var cat = catalogo.filter(function (c) { return c.id === it.catalogo_id; })[0];
            return { id: uuid(), ordem: n + 1, nome: it.nome, marca: it.marca || null, apresentacao: it.apresentacao || null,
              codigo_barras: it.codigo_barras || (cat && cat.codigo_barras) || null, imagem_url: cat ? cat.imagem_url : null };
          }),
          fotos: foto ? [{ caminho: foto.caminho, tipo: foto.tipo, tamanho: foto.tamanho }] : [],
          historico: []
        });
        gravar("envios", envios);
        return Promise.resolve({ protocolo: protocolo, repetido: false });
      },
      resumo: function () {
        var e = ler("envios");
        var porTipo = {};
        e.forEach(function (x) { porTipo[x.tipo] = (porTipo[x.tipo] || 0) + 1; });
        var contagem = {};
        e.forEach(function (x) {
          (x.itens || []).forEach(function (it) {
            var k = norm(it.nome);
            contagem[k] = contagem[k] || { nome: it.nome, vezes: 0 };
            contagem[k].vezes++;
          });
        });
        return Promise.resolve({
          total: e.length,
          novo: e.filter(function (x) { return x.situacao === "novo"; }).length,
          em_analise: e.filter(function (x) { return x.situacao === "em_analise"; }).length,
          resolvido: e.filter(function (x) { return x.situacao === "resolvido"; }).length,
          plaquinhas_ativas: ler("plaquinhas").filter(function (p) { return p.ativa; }).length,
          por_tipo: porTipo,
          produtos_mais_pedidos: Object.keys(contagem).map(function (k) { return contagem[k]; })
            .filter(function (x) { return x.vezes > 1; }).sort(function (a, b) { return b.vezes - a.vezes; }).slice(0, 10)
        });
      },
      listar: function (f) {
        f = f || {};
        var produto = norm(f.produto || "");
        return Promise.resolve(ler("envios").map(completo).filter(function (e) {
          var dia = hoje(e.criado_em);
          return (!f.de || dia >= f.de) && (!f.ate || dia <= f.ate) && (!f.tipo || e.tipo === f.tipo) &&
            (!f.situacao || e.situacao === f.situacao) && (!f.plaquinha_id || e.plaquinha_id === f.plaquinha_id) &&
            (!f.setor || e.setor === f.setor) &&
            (!produto || norm([e.titulo, e.descricao].concat((e.itens || []).map(function (i) { return i.nome + " " + (i.marca || ""); })).join(" ")).indexOf(produto) >= 0);
        }).sort(function (a, b) { return a.criado_em < b.criado_em ? 1 : -1; }));
      },
      detalhe: function (id) {
        var e = ler("envios").filter(function (x) { return x.id === id; })[0];
        return Promise.resolve(e ? Object.assign(completo(e), { fotos: e.fotos || [] }) : null);
      },
      mudarSituacao: function (id, s) {
        var envios = ler("envios");
        envios.forEach(function (e) {
          if (e.id !== id || e.situacao === s) return;
          e.situacao = s;
          e.situacao_em = new Date().toISOString();
          e.resolvido_em = s === "resolvido" ? e.situacao_em : null;
          e.historico = (e.historico || []).concat([{ situacao: s, por: "demonstracao@veneza", em: e.situacao_em }]);
        });
        gravar("envios", envios);
        return this.detalhe(id);
      },
      urlFoto: function (caminho) {
        var f = ler("fotos").filter(function (x) { return x.caminho === caminho; })[0];
        return f ? Promise.resolve(f.dados) : falha("ESCUTA_FOTO");
      },
      plaquinhas: function () {
        var envios = ler("envios");
        return Promise.resolve(ler("plaquinhas").map(function (p) {
          return Object.assign({}, p, { mensagens: contar(envios, p.id), novas: contar(envios, p.id, "novo") });
        }).sort(function (a, b) {
          return (b.ativa - a.ativa) || a.setor.localeCompare(b.setor) || a.nome.localeCompare(b.nome);
        }));
      },
      salvarPlaquinha: function (p) {
        var lista = ler("plaquinhas");
        if (!String(p.nome || "").trim()) return falha("ESCUTA_DADOS: dê um nome para a plaquinha");
        if (!String(p.setor || "").trim()) return falha("ESCUTA_DADOS: informe o setor");
        var reg;
        if (p.id) {
          reg = lista.filter(function (x) { return x.id === p.id; })[0];
          Object.assign(reg, { nome: p.nome.trim(), setor: p.setor.trim(), local: (p.local || "").trim(),
            ativa: p.ativa !== false, editado_em: new Date().toISOString() });
        } else {
          reg = { id: uuid(), token: token(), nome: p.nome.trim(), setor: p.setor.trim(), local: (p.local || "").trim(),
            ativa: p.ativa !== false, criado_em: new Date().toISOString(), criado_por: "demonstracao@veneza" };
          lista.push(reg);
        }
        gravar("plaquinhas", lista);
        return Promise.resolve(reg);
      },
      apagarPlaquinha: function (id) {
        if (ler("envios").some(function (e) { return e.plaquinha_id === id; })) {
          return falha("ESCUTA_DADOS: esta plaquinha já recebeu mensagens; desative em vez de apagar");
        }
        gravar("plaquinhas", ler("plaquinhas").filter(function (x) { return x.id !== id; }));
        return Promise.resolve();
      },
      catalogo: function (termo) {
        var t = norm(termo);
        var todos = ler("catalogo");
        return Promise.resolve({ total: todos.length, itens: todos.filter(function (c) {
          return norm([c.nome, c.marca, c.apresentacao, c.codigo_barras].join(" ")).indexOf(t) >= 0;
        }).sort(function (a, b) { return a.nome.localeCompare(b.nome); }) });
      },
      catalogoSalvar: function (itens) {
        var lista = ler("catalogo"), n = 0;
        itens.forEach(function (it) {
          if (!String(it.nome || "").trim()) return;
          var cod = String(it.codigo_barras || "").replace(/\D/g, "") || null;
          var img = /^https:\/\//.test(it.imagem_url || "") ? it.imagem_url : null;
          var reg = (cod && lista.filter(function (c) { return c.codigo_barras === cod; })[0]) ||
            (it.id && lista.filter(function (c) { return c.id === it.id; })[0]);
          var dados = { nome: it.nome.trim(), marca: it.marca || null, apresentacao: it.apresentacao || null,
            codigo_barras: cod, imagem_url: img || (reg && reg.imagem_url) || null,
            fonte: it.fonte === "openfoodfacts" ? "openfoodfacts" : "manual" };
          if (reg) Object.assign(reg, dados); else lista.push(Object.assign({ id: uuid() }, dados));
          n++;
        });
        gravar("catalogo", lista);
        return Promise.resolve(n);
      },
      catalogoApagar: function (id) {
        gravar("catalogo", ler("catalogo").filter(function (c) { return c.id !== id; }));
        return Promise.resolve();
      }
    };
  }

  function criarPublico(demo) {
    if (demo) return criarDemo();
    var url = CFG.SUPABASE_URL || "", chave = CFG.SUPABASE_ANON_KEY || "";
    if (!/^https:\/\//.test(url) || /COLE_AQUI/.test(chave)) return null;
    if (!window.supabase || !window.supabase.createClient) {
      throw erroAmigavel({ message: "Failed to fetch" }, "abrir o formulário");
    }
    // Página pública: nunca guarda sessão de login
    var cliente = window.supabase.createClient(url, chave, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    return criarSupabase(cliente);
  }

  window.EscutaBanco = {
    erroAmigavel: erroAmigavel,
    // Página pública
    criarPublico: criarPublico,
    // Painel: usa o cliente Supabase já logado do sistema (ou a demonstração)
    criarPainel: function (cliente, demo) { return demo ? criarDemo() : criarSupabase(cliente); }
  };
})();
