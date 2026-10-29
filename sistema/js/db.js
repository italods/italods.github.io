/*
 * Acesso aos dados. Usa o Supabase; com ?demo=1 na URL usa um banco de mentira
 * guardado só neste aparelho (para testar as telas sem configurar nada).
 */
(function () {
  "use strict";
  var C = window.Calculos;
  var CFG = window.VENEZA_CONFIG || {};

  var CAMPOS_CONFERENCIA = ["tipo", "caixa", "operador", "data", "hora", "contagem", "fundo_centavos",
    "vendas_dinheiro_centavos", "recebimentos_dinheiro_centavos", "pix_centavos", "debito_centavos",
    "credito_centavos", "carteira_centavos", "troco_amanha_centavos", "observacao"];
  var CAMPOS_MOVIMENTO = ["tipo", "caixa", "data", "hora", "valor_centavos", "motivo", "responsavel"];

  function filtrarCampos(obj, campos) {
    var r = {};
    campos.forEach(function (c) { if (obj[c] !== undefined) r[c] = obj[c]; });
    return r;
  }

  // Transforma qualquer erro em uma mensagem clara em português
  function erroAmigavel(e, acao) {
    acao = acao || "concluir a operação";
    var msg = (e && (e.message || e.error_description || e.msg)) || String(e || "");
    var codigo = e && e.code;
    var status = e && e.status;
    var err = new Error();
    if ((typeof navigator !== "undefined" && navigator.onLine === false) ||
        /failed to fetch|networkerror|network request failed|load failed/i.test(msg)) {
      err.message = "Sem internet. Não foi possível " + acao + ". O que você digitou continua aqui; tente de novo quando a conexão voltar.";
      err.tipo = "rede";
    } else if (status === 401 || codigo === "PGRST301" || codigo === "PGRST303" || /jwt|token|session/i.test(msg)) {
      err.message = "Sua sessão expirou. Entre de novo para " + acao + ". O que você digitou não foi perdido.";
      err.tipo = "sessao";
    } else if (codigo === "42501" || /row-level security|permission denied/i.test(msg)) {
      err.message = "Seu usuário não tem permissão. Confira se o seu e-mail está na lista de autorizados.";
      err.tipo = "permissao";
    } else if (/invalid login credentials/i.test(msg)) {
      err.message = "E-mail ou senha incorretos.";
      err.tipo = "login";
    } else if (/email not confirmed/i.test(msg)) {
      err.message = "Este e-mail ainda não foi confirmado no Supabase.";
      err.tipo = "login";
    } else {
      err.message = "Não foi possível " + acao + ". Detalhe: " + msg;
      err.tipo = "outro";
    }
    err.original = e;
    return err;
  }

  /* ------------------------------ Supabase ------------------------------ */

  function criarSupabase() {
    var cliente = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "veneza-auth" }
    });

    function resultado(acao) {
      return function (r) {
        if (r.error) throw erroAmigavel(r.error, acao);
        return r.data;
      };
    }
    function falhaRede(acao) {
      return function (e) {
        if (e && e.tipo) throw e;
        throw erroAmigavel(e, acao);
      };
    }
    function consulta(tabela, f, ordem) {
      var q = cliente.from(tabela).select("*");
      if (f.de) q = q.gte("data", f.de);
      if (f.ate) q = q.lte("data", f.ate);
      if (f.caixa) q = q.eq("caixa", f.caixa);
      if (f.tipo) q = q.eq("tipo", f.tipo);
      return q.order("data", { ascending: false }).order("hora", { ascending: true }).limit(5000);
    }

    return {
      modo: "supabase",
      cliente: cliente,
      sessao: function () {
        return cliente.auth.getSession().then(function (r) { return r.data && r.data.session; });
      },
      aoMudarSessao: function (cb) {
        cliente.auth.onAuthStateChange(function (evento, sessao) { cb(evento, sessao); });
      },
      entrar: function (email, senha) {
        return cliente.auth.signInWithPassword({ email: email.trim(), password: senha })
          .then(resultado("entrar"), falhaRede("entrar"));
      },
      sair: function () {
        return cliente.auth.signOut().catch(function () {});
      },
      autorizado: function () {
        return cliente.rpc("autorizado").then(resultado("verificar seu acesso"), falhaRede("verificar seu acesso"));
      },
      listarConferencias: function (f) {
        return consulta("conferencias", f || {}).then(resultado("carregar o histórico"), falhaRede("carregar o histórico"));
      },
      salvarConferencia: function (dados, id) {
        var d = filtrarCampos(dados, CAMPOS_CONFERENCIA);
        var q = id ? cliente.from("conferencias").update(d).eq("id", id) : cliente.from("conferencias").insert(d);
        return q.select().single().then(resultado("salvar a conferência"), falhaRede("salvar a conferência"));
      },
      apagarConferencia: function (id) {
        return cliente.from("conferencias").delete().eq("id", id)
          .then(resultado("apagar a conferência"), falhaRede("apagar a conferência"));
      },
      listarMovimentos: function (f) {
        return consulta("movimentos", f || {}).then(resultado("carregar sangrias e suprimentos"), falhaRede("carregar sangrias e suprimentos"));
      },
      salvarMovimento: function (dados, id) {
        var d = filtrarCampos(dados, CAMPOS_MOVIMENTO);
        var q = id ? cliente.from("movimentos").update(d).eq("id", id) : cliente.from("movimentos").insert(d);
        return q.select().single().then(resultado("salvar o lançamento"), falhaRede("salvar o lançamento"));
      },
      apagarMovimento: function (id) {
        return cliente.from("movimentos").delete().eq("id", id)
          .then(resultado("apagar o lançamento"), falhaRede("apagar o lançamento"));
      }
    };
  }

  /* ------------------- Demonstração (só neste aparelho) ------------------- */

  function criarDemo() {
    var EMAIL = "demonstracao@veneza";
    function ler(nome) {
      try { return JSON.parse(localStorage.getItem("veneza.demo." + nome)) || []; } catch (e) { return []; }
    }
    function gravar(nome, lista) {
      try { localStorage.setItem("veneza.demo." + nome, JSON.stringify(lista)); } catch (e) { /* sem espaço */ }
    }
    function id() {
      return "demo-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }
    // Faz as mesmas contas que o gatilho do banco
    function calcular(c, movs) {
      var cont = C.calcularContagem(c.contagem);
      c.total_cedulas_centavos = cont.totalCedulas;
      c.total_moedas_centavos = cont.totalMoedas;
      c.total_centavos = cont.total;
      if (c.tipo === "fechamento") {
        var m = C.somarMovimentos(movs, c.data, c.caixa);
        c.fundo_centavos = c.fundo_centavos || 0;
        c.vendas_dinheiro_centavos = c.vendas_dinheiro_centavos || 0;
        c.recebimentos_dinheiro_centavos = c.recebimentos_dinheiro_centavos || 0;
        c.sangrias_centavos = m.sangrias;
        c.suprimentos_centavos = m.suprimentos;
        c.esperado_centavos = C.calcularEsperado({
          fundo: c.fundo_centavos, vendas: c.vendas_dinheiro_centavos,
          recebimentos: c.recebimentos_dinheiro_centavos, sangrias: m.sangrias, suprimentos: m.suprimentos
        });
        c.diferenca_centavos = c.total_centavos - c.esperado_centavos;
      } else {
        c.sangrias_centavos = c.suprimentos_centavos = c.esperado_centavos = c.diferenca_centavos = null;
      }
      return c;
    }
    function recalcularTudo() {
      var movs = ler("movimentos");
      gravar("conferencias", ler("conferencias").map(function (c) { return calcular(c, movs); }));
    }
    function filtrar(lista, f) {
      f = f || {};
      return lista.filter(function (x) {
        return (!f.de || x.data >= f.de) && (!f.ate || x.data <= f.ate) &&
          (!f.caixa || x.caixa === f.caixa) && (!f.tipo || x.tipo === f.tipo);
      }).sort(function (a, b) {
        return a.data === b.data ? String(a.hora).localeCompare(String(b.hora)) : (a.data < b.data ? 1 : -1);
      });
    }
    function salvar(nome, campos, dados, idExistente) {
      var lista = ler(nome);
      var d = filtrarCampos(dados, campos);
      var agora = new Date().toISOString();
      var reg;
      if (idExistente) {
        reg = lista.filter(function (x) { return x.id === idExistente; })[0];
        if (!reg) return Promise.reject(erroAmigavel({ message: "registro não encontrado" }, "salvar"));
        Object.assign(reg, d, { editado_por: EMAIL, editado_em: agora });
      } else {
        reg = Object.assign({ id: id(), criado_por: EMAIL, criado_em: agora }, d);
        lista.push(reg);
      }
      gravar(nome, lista);
      recalcularTudo();
      return Promise.resolve(ler(nome).filter(function (x) { return x.id === reg.id; })[0]);
    }
    function apagar(nome, idApagar) {
      gravar(nome, ler(nome).filter(function (x) { return x.id !== idApagar; }));
      recalcularTudo();
      return Promise.resolve(null);
    }
    var sessao = { user: { email: EMAIL } };
    return {
      modo: "demo",
      sessao: function () { return Promise.resolve(sessao); },
      aoMudarSessao: function () {},
      entrar: function () { return Promise.resolve(sessao); },
      sair: function () { return Promise.resolve(); },
      autorizado: function () { return Promise.resolve(true); },
      listarConferencias: function (f) { return Promise.resolve(filtrar(ler("conferencias"), f)); },
      salvarConferencia: function (d, i) { return salvar("conferencias", CAMPOS_CONFERENCIA, d, i); },
      apagarConferencia: function (i) { return apagar("conferencias", i); },
      listarMovimentos: function (f) { return Promise.resolve(filtrar(ler("movimentos"), f)); },
      salvarMovimento: function (d, i) { return salvar("movimentos", CAMPOS_MOVIMENTO, d, i); },
      apagarMovimento: function (i) { return apagar("movimentos", i); }
    };
  }

  function configurado() {
    return /^https:\/\//.test(CFG.SUPABASE_URL || "") && (CFG.SUPABASE_ANON_KEY || "").length > 20 &&
      !/COLE_AQUI/.test(CFG.SUPABASE_ANON_KEY);
  }

  window.BancoVeneza = {
    erroAmigavel: erroAmigavel,
    configurado: configurado,
    criar: function (demo) {
      if (demo) return criarDemo();
      if (!configurado()) return null;
      if (!window.supabase || !window.supabase.createClient) {
        throw erroAmigavel({ message: "Failed to fetch" }, "carregar o sistema");
      }
      return criarSupabase();
    }
  };
})();
