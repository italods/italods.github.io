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
    "credito_centavos", "carteira_centavos", "troco_amanha_centavos", "observacao", "cupom", "pendente", "troco_separado"];
  var CAMPOS_MOVIMENTO = ["tipo", "caixa", "data", "hora", "valor_centavos", "motivo", "responsavel"];
  var CAMPOS_MAQUINA = ["numero", "apelido", "caixa", "ativa"];
  var CAMPOS_TROCA = ["data", "maquina", "caixa", "hora_de", "hora_ate", "observacao"];
  var CAMPOS_BANCO = ["chave", "data", "hora", "data_lancamento", "tipo", "categoria", "pagador_tipo", "pagador",
    "documento", "valor_centavos"];
  var CAMPOS_TAXA = ["modalidade", "bandeira", "parcelas", "taxa", "prazo_dias_uteis"];
  var CAMPOS_RECEBIVEL = ["chave", "data_pagamento", "data_prevista", "data_venda", "hora_venda", "tipo", "forma_original",
    "modalidade", "parcela", "parcelas", "bandeira", "valor_bruto", "taxa", "valor_liquido", "status", "nsu", "autorizacao",
    "txid", "maquina", "descricao"];
  var CAMPOS_CIELO = ["chave", "data", "hora", "forma", "forma_original", "parcelas", "bandeira", "valor_centavos",
    "aprovada", "status", "maquina", "nsu", "autorizacao", "id_pix", "txid", "pagador"];

  // RH: tabela rh_<nome> e campos que a tela pode gravar
  var CAMPOS_RH = {
    funcionarios: ["nome", "funcao", "admissao", "desligamento", "telefone", "salario_centavos", "turma", "observacao"],
    turmas: ["nome", "ordem"],
    horarios: ["nome", "ordem", "dias"],
    ocorrencias: ["funcionario", "tipo", "data", "dias", "justificada", "motivo"],
    feriados: ["data", "nome"],
    holerites: ["funcionario", "referencia", "recebido_em", "observacao"]
  };
  function camposRH(nome) {
    if (!CAMPOS_RH[nome]) throw new Error("tabela do RH desconhecida: " + nome);
    return CAMPOS_RH[nome];
  }

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
    } else if (codigo === "23505" || /duplicate key/i.test(msg)) {
      err.message = "Não foi possível " + acao + ": esse registro já existe (mesma data/tipo ou mesmo mês).";
      err.tipo = "repetido";
    } else if (codigo === "23503" || /foreign key/i.test(msg)) {
      err.message = "Não foi possível " + acao + ": há outros registros ligados a este. Para um funcionário, preencha a data de desligamento em vez de apagar.";
      err.tipo = "ligado";
    } else if (codigo === "42501" || /row-level security|permission denied/i.test(msg)) {
      err.message = "Seu usuário não tem permissão. Confira se o seu e-mail está na lista de autorizados.";
      err.tipo = "permissao";
    } else if (/rate limit|only request this after|too many/i.test(msg) || status === 429) {
      err.message = "Muitos pedidos seguidos. Espere alguns minutos e tente de novo.";
      err.tipo = "limite";
    } else if (/should be different from the old/i.test(msg)) {
      err.message = "A senha nova precisa ser diferente da atual.";
      err.tipo = "senha";
    } else if (/password should|weak password|password is known|pwned/i.test(msg)) {
      err.message = "Senha fraca. Use pelo menos 8 caracteres, misturando letras e números.";
      err.tipo = "senha";
    } else if (/email address not authorized|not authorized/i.test(msg)) {
      err.message = "O Supabase não envia e-mail para este endereço (limite do plano gratuito). Peça ao Italo para definir a senha pelo painel do Supabase.";
      err.tipo = "email";
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
      // Envia o e-mail "Esqueci minha senha". O link volta para esta mesma página.
      pedirNovaSenha: function (email) {
        var volta = location.origin + location.pathname;
        return cliente.auth.resetPasswordForEmail(email.trim(), { redirectTo: volta })
          .then(resultado("enviar o e-mail"), falhaRede("enviar o e-mail"));
      },
      // Entra com os dados que vieram no link do e-mail
      usarLinkSenha: function (tokens) {
        return cliente.auth.setSession({ access_token: tokens.access_token, refresh_token: tokens.refresh_token })
          .then(resultado("usar o link do e-mail"), falhaRede("usar o link do e-mail"));
      },
      trocarSenha: function (senha) {
        return cliente.auth.updateUser({ password: senha })
          .then(resultado("trocar a senha"), falhaRede("trocar a senha"));
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
      // Troco separado no fechamento para a próxima abertura
      salvarTroco: function (id, troco) {
        return cliente.from("conferencias").update({ troco_separado: troco }).eq("id", id).select().single()
          .then(resultado("guardar o troco separado"), falhaRede("guardar o troco separado"));
      },
      // Cupom importado depois (aba Importar): completa o fechamento que estava "falta o cupom"
      anexarCupom: function (id, cupom) {
        return cliente.from("conferencias").update({ cupom: cupom, pendente: false }).eq("id", id).select().single()
          .then(resultado("gravar o cupom no fechamento"), falhaRede("gravar o cupom no fechamento"));
      },
      // Histórico de edições: como cada registro estava antes de ser editado ou apagado
      listarVersoes: function (f) {
        f = f || {};
        var q = cliente.from("versoes").select("*").order("feito_em", { ascending: false }).limit(f.limite || 60);
        if (f.registro) q = q.eq("registro", f.registro);
        return q.then(resultado("carregar o histórico de edições"), falhaRede("carregar o histórico de edições"));
      },
      restaurarVersao: function (v) {
        var d = filtrarCampos(v.dados || {}, v.tabela === "movimentos" ? CAMPOS_MOVIMENTO : CAMPOS_CONFERENCIA);
        var t = cliente.from(v.tabela);
        var q = v.operacao === "apagado" ? t.insert(Object.assign({ id: v.registro }, d)) : t.update(d).eq("id", v.registro);
        return q.select().single().then(resultado("desfazer a alteração"), falhaRede("desfazer a alteração"));
      },
      /* ---- RH ---- */
      listarRH: function (nome) {
        camposRH(nome);
        return cliente.from("rh_" + nome).select("*").limit(5000).then(resultado("carregar o RH"), falhaRede("carregar o RH"));
      },
      salvarRH: function (nome, dados, id) {
        var d = filtrarCampos(dados, camposRH(nome));
        var t = cliente.from("rh_" + nome);
        var q = id ? t.update(d).eq("id", id) : t.insert(d);
        return q.select().single().then(resultado("salvar no RH"), falhaRede("salvar no RH"));
      },
      apagarRH: function (nome, id) {
        camposRH(nome);
        return cliente.from("rh_" + nome).delete().eq("id", id).then(resultado("apagar"), falhaRede("apagar"));
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
      },

      /* ---- Cielo: máquinas, trocas e vendas ---- */
      listarMaquinas: function () {
        return cliente.from("maquinas").select("*").order("numero")
          .then(resultado("carregar as máquinas"), falhaRede("carregar as máquinas"));
      },
      salvarMaquina: function (m) {
        var d = filtrarCampos(m, CAMPOS_MAQUINA);
        return cliente.from("maquinas").upsert(d, { onConflict: "numero" }).select().single()
          .then(resultado("salvar a máquina"), falhaRede("salvar a máquina"));
      },
      listarTrocas: function (f) {
        f = f || {};
        var q = cliente.from("maquina_trocas").select("*");
        if (f.de) q = q.gte("data", f.de);
        if (f.ate) q = q.lte("data", f.ate);
        return q.order("data", { ascending: false }).limit(1000)
          .then(resultado("carregar as trocas de máquina"), falhaRede("carregar as trocas de máquina"));
      },
      salvarTroca: function (t, id) {
        var d = filtrarCampos(t, CAMPOS_TROCA);
        var q = id ? cliente.from("maquina_trocas").update(d).eq("id", id) : cliente.from("maquina_trocas").insert(d);
        return q.select().single().then(resultado("salvar a troca"), falhaRede("salvar a troca"));
      },
      apagarTroca: function (id) {
        return cliente.from("maquina_trocas").delete().eq("id", id)
          .then(resultado("apagar a troca"), falhaRede("apagar a troca"));
      },
      // Vendas lidas do CSV. Venda que já existe (mesma chave) é ignorada. Devolve quantas entraram.
      importarCielo: function (vendas) { return importarSemDuplicar("cielo_vendas", CAMPOS_CIELO, vendas, "gravar as vendas da Cielo"); },
      listarCielo: function (f) { return listarTudo("cielo_vendas", CAMPOS_CIELO, f, "carregar as vendas da Cielo"); },
      importarBanco: function (l) { return importarSemDuplicar("banco_lancamentos", CAMPOS_BANCO, l, "gravar o extrato do banco"); },
      listarBanco: function (f) { return listarTudo("banco_lancamentos", CAMPOS_BANCO.concat(["caixa"]), f, "carregar o extrato do banco"); },
      // PIX de cliente: de qual caixa é ("fora" = não é venda; null = não sei)
      atribuirBanco: function (id, caixa) {
        return cliente.from("banco_lancamentos").update({ caixa: caixa || null }).eq("id", id)
          .then(resultado("marcar o PIX"), falhaRede("marcar o PIX"));
      },
      listarTaxas: function () {
        return cliente.from("cielo_taxas").select("*").order("modalidade").order("bandeira").order("parcelas")
          .then(resultado("carregar as taxas"), falhaRede("carregar as taxas"));
      },
      salvarTaxas: function (linhas) {
        return cliente.from("cielo_taxas").upsert(linhas.map(function (t) { return filtrarCampos(t, CAMPOS_TAXA); }),
          { onConflict: "modalidade,bandeira,parcelas" }).then(resultado("salvar as taxas"), falhaRede("salvar as taxas"));
      },
      apagarTaxa: function (id) {
        return cliente.from("cielo_taxas").delete().eq("id", id).then(resultado("apagar a taxa"), falhaRede("apagar a taxa"));
      },
      importarRecebiveis: function (l) { return importarSemDuplicar("cielo_recebiveis", CAMPOS_RECEBIVEL, l, "gravar os recebíveis"); },
      listarRecebiveis: function (f) { return listarTudo("cielo_recebiveis", CAMPOS_RECEBIVEL, f, "carregar os recebíveis", "data_pagamento", "hora_venda"); },
      obterConfiguracao: function (chave) {
        return cliente.from("configuracoes").select("valor").eq("chave", chave).maybeSingle()
          .then(resultado("carregar a configuração"), falhaRede("carregar a configuração"))
          .then(function (r) { return r ? r.valor : ""; });
      },
      salvarConfiguracao: function (chave, valor) {
        return cliente.from("configuracoes").upsert({ chave: chave, valor: valor }, { onConflict: "chave" })
          .then(resultado("salvar a configuração"), falhaRede("salvar a configuração"));
      }
    };

    function importarSemDuplicar(tabela, campos, linhas, acao) {
      var lotes = [];
      for (var i = 0; i < linhas.length; i += 500) lotes.push(linhas.slice(i, i + 500));
      var novas = 0;
      return lotes.reduce(function (p, lote) {
        return p.then(function () {
          return cliente.from(tabela)
            .upsert(lote.map(function (v) { return filtrarCampos(v, campos); }), { onConflict: "chave", ignoreDuplicates: true })
            .select("chave")
            .then(resultado(acao), falhaRede(acao))
            .then(function (r) { novas += (r || []).length; });
        });
      }, Promise.resolve()).then(function () { return { novas: novas, repetidas: linhas.length - novas }; });
    }

    // Linhas de um período (o Supabase devolve no máximo 1000 por vez: busca em páginas)
    function listarTudo(tabela, campos, f, acao, campoData, campoHora) {
      f = f || {};
      campoData = campoData || "data";
      var todas = [];
      function pagina(n) {
        var q = cliente.from(tabela).select(campos.join(",") + ",id");
        if (f.de) q = q.gte(campoData, f.de);
        if (f.ate) q = q.lte(campoData, f.ate);
        return q.order(campoData).order(campoHora || "hora").order("id").range(n * 1000, n * 1000 + 999)
          .then(resultado(acao), falhaRede(acao))
          .then(function (r) {
            todas = todas.concat(r || []);
            return r && r.length === 1000 && n < 50 ? pagina(n + 1) : todas;
          });
      }
      return pagina(0);
    }
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
        var sangrias = m.sangrias;
        c.sangrias_lancadas_centavos = m.sangrias;
        // Igual ao gatilho do banco: com cupom, fundo, dinheiro e sangrias vêm dele
        var cp = c.cupom;
        if (cp && cp.formas) {
          var vr = function (f) { return ((cp.formas[f] || {}).vendas || 0) + ((cp.formas[f] || {}).receb || 0); };
          c.fundo_centavos = cp.fundo || 0;
          c.vendas_dinheiro_centavos = (cp.formas.dinheiro || {}).vendas || 0;
          c.recebimentos_dinheiro_centavos = (cp.formas.dinheiro || {}).receb || 0;
          c.pix_centavos = vr("pix"); c.debito_centavos = vr("debito"); c.credito_centavos = vr("credito");
          c.carteira_centavos = (cp.formas.carteira || {}).vendas || 0;
          sangrias = cp.sangria || 0;
          c.pendente = false;
        } else {
          c.cupom = null;
        }
        c.pendente = !!c.pendente;
        if (c.troco_separado) {
          var t = {};
          Object.keys(c.troco_separado).forEach(function (k) {
            var q = Math.min(+c.troco_separado[k] || 0, +(c.contagem || {})[k] || 0);
            if (q > 0) t[k] = q;
          });
          c.troco_separado = t;
        }
        c.fundo_centavos = c.fundo_centavos || 0;
        c.vendas_dinheiro_centavos = c.vendas_dinheiro_centavos || 0;
        c.recebimentos_dinheiro_centavos = c.recebimentos_dinheiro_centavos || 0;
        c.sangrias_centavos = sangrias;
        c.suprimentos_centavos = m.suprimentos;
        c.esperado_centavos = C.calcularEsperado({
          fundo: c.fundo_centavos, vendas: c.vendas_dinheiro_centavos,
          recebimentos: c.recebimentos_dinheiro_centavos, sangrias: sangrias, suprimentos: m.suprimentos
        });
        c.diferenca_centavos = c.total_centavos - c.esperado_centavos;
        if (c.pendente) c.esperado_centavos = c.diferenca_centavos = null;
      } else {
        c.pendente = false;
        c.troco_separado = null;
        c.sangrias_centavos = c.suprimentos_centavos = c.esperado_centavos = c.diferenca_centavos = null;
        c.cupom = c.sangrias_lancadas_centavos = null;
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
    // Igual ao gatilho conferencia_regras: duas aberturas seguidas no mesmo caixa e dia são recusadas
    function regraAbertura(lista, c, idProprio) {
      if (c.tipo !== "abertura") return null;
      var h = function (x) { return String(x.hora || "").slice(0, 5); };
      var doDia = lista.filter(function (x) { return x.caixa === c.caixa && x.data === c.data && x.id !== idProprio; })
        .sort(function (a, b) { return h(a) < h(b) ? -1 : h(a) > h(b) ? 1 : String(a.criado_em).localeCompare(String(b.criado_em)); });
      var antes = doDia.filter(function (x) { return h(x) <= h(c); }).pop();
      if (antes && antes.tipo === "abertura") {
        return "Este caixa já está aberto (abertura das " + h(antes) + "). Feche o caixa antes de abrir de novo.";
      }
      var depois = doDia.filter(function (x) { return h(x) > h(c); })[0];
      if (depois && depois.tipo === "abertura") {
        return "Já existe uma abertura às " + h(depois) + " sem fechamento antes dela. Registre o fechamento primeiro.";
      }
      return null;
    }
    function guardarVersao(nome, antigo, operacao) {
      if (nome !== "conferencias" && nome !== "movimentos") return;
      var v = ler("versoes");
      v.unshift({ id: id(), tabela: nome, registro: antigo.id, operacao: operacao, dados: JSON.parse(JSON.stringify(antigo)),
        feito_por: EMAIL, feito_em: new Date().toISOString() });
      gravar("versoes", v.slice(0, 300));
    }
    function salvar(nome, campos, dados, idExistente, idNovo) {
      var lista = ler(nome);
      var d = filtrarCampos(dados, campos);
      var agora = new Date().toISOString();
      var reg;
      if (nome === "conferencias") {
        var atual = idExistente ? lista.filter(function (x) { return x.id === idExistente; })[0] : null;
        var regra = regraAbertura(lista, Object.assign({}, atual || {}, d), idExistente);
        var igual = atual && d.tipo === atual.tipo && d.caixa === atual.caixa && d.data === atual.data &&
          String(d.hora).slice(0, 5) === String(atual.hora).slice(0, 5);
        if (regra && !igual) return Promise.reject(erroAmigavel({ message: regra }, "salvar a conferência"));
      }
      if (idExistente) {
        reg = lista.filter(function (x) { return x.id === idExistente; })[0];
        if (!reg) return Promise.reject(erroAmigavel({ message: "registro não encontrado" }, "salvar"));
        var antes = JSON.parse(JSON.stringify(reg));
        Object.assign(reg, d);
        var mudou = Object.keys(d).some(function (k) { return JSON.stringify(antes[k]) !== JSON.stringify(reg[k]); });
        if (mudou) { guardarVersao(nome, antes, "editado"); reg.editado_por = EMAIL; reg.editado_em = agora; }
      } else {
        reg = Object.assign({ id: idNovo || id(), criado_por: EMAIL, criado_em: agora }, d);
        lista.push(reg);
      }
      gravar(nome, lista);
      recalcularTudo();
      return Promise.resolve(ler(nome).filter(function (x) { return x.id === reg.id; })[0]);
    }
    function apagar(nome, idApagar) {
      var velho = ler(nome).filter(function (x) { return x.id === idApagar; })[0];
      if (velho) guardarVersao(nome, velho, "apagado");
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
      pedirNovaSenha: function () { return Promise.resolve({}); },
      usarLinkSenha: function () { return Promise.resolve({ session: sessao }); },
      trocarSenha: function () { return Promise.resolve({ user: sessao.user }); },
      autorizado: function () { return Promise.resolve(true); },
      listarConferencias: function (f) { return Promise.resolve(filtrar(ler("conferencias"), f)); },
      salvarConferencia: function (d, i) { return salvar("conferencias", CAMPOS_CONFERENCIA, d, i); },
      apagarConferencia: function (i) { return apagar("conferencias", i); },
      listarRH: function (nome) { camposRH(nome); return Promise.resolve(ler("rh_" + nome)); },
      salvarRH: function (nome, dados, i) {
        var d = filtrarCampos(dados, camposRH(nome));
        var lista = ler("rh_" + nome).filter(function (x) { return x.id !== i; });
        var chaves = { ocorrencias: ["funcionario", "data", "tipo"], feriados: ["data"], holerites: ["funcionario", "referencia"] }[nome];
        var atual = i ? ler("rh_" + nome).filter(function (x) { return x.id === i; })[0] : {};
        var novo = Object.assign({}, atual, d);
        if (chaves && lista.some(function (x) { return chaves.every(function (k) { return String(x[k]) === String(novo[k]); }); })) {
          return Promise.reject(erroAmigavel({ code: "23505", message: "duplicate key" }, "salvar no RH"));
        }
        return salvar("rh_" + nome, camposRH(nome), d, i);
      },
      apagarRH: function (nome, i) {
        camposRH(nome);
        if (nome === "funcionarios" && (ler("rh_ocorrencias").concat(ler("rh_holerites"))).some(function (x) { return x.funcionario === i; })) {
          return Promise.reject(erroAmigavel({ code: "23503", message: "foreign key" }, "apagar"));
        }
        if (nome === "turmas") {
          gravar("rh_funcionarios", ler("rh_funcionarios").map(function (f) { if (f.turma === i) f.turma = null; return f; }));
        }
        return apagar("rh_" + nome, i);
      },
      salvarTroco: function (i, troco) { return salvar("conferencias", CAMPOS_CONFERENCIA, { troco_separado: troco }, i); },
      anexarCupom: function (i, cupom) { return salvar("conferencias", CAMPOS_CONFERENCIA, { cupom: cupom, pendente: false }, i); },
      listarVersoes: function (f) {
        f = f || {};
        return Promise.resolve(ler("versoes").filter(function (v) { return !f.registro || v.registro === f.registro; })
          .slice(0, f.limite || 60));
      },
      restaurarVersao: function (v) {
        var campos = v.tabela === "movimentos" ? CAMPOS_MOVIMENTO : CAMPOS_CONFERENCIA;
        return v.operacao === "apagado" ? salvar(v.tabela, campos, v.dados, null, v.registro)
          : salvar(v.tabela, campos, v.dados, v.registro);
      },
      listarMovimentos: function (f) { return Promise.resolve(filtrar(ler("movimentos"), f)); },
      salvarMovimento: function (d, i) { return salvar("movimentos", CAMPOS_MOVIMENTO, d, i); },
      apagarMovimento: function (i) { return apagar("movimentos", i); },
      listarMaquinas: function () {
        return Promise.resolve(ler("maquinas").sort(function (a, b) { return a.numero.localeCompare(b.numero); }));
      },
      salvarMaquina: function (m) {
        var lista = ler("maquinas"), d = filtrarCampos(m, CAMPOS_MAQUINA);
        var reg = lista.filter(function (x) { return x.numero === d.numero; })[0];
        if (reg) Object.assign(reg, d); else { reg = Object.assign({ ativa: true, apelido: "" }, d); lista.push(reg); }
        gravar("maquinas", lista);
        return Promise.resolve(reg);
      },
      listarTrocas: function (f) { return Promise.resolve(filtrar(ler("trocas"), f || {})); },
      salvarTroca: function (t, i) { return salvar("trocas", CAMPOS_TROCA, t, i); },
      apagarTroca: function (i) { return apagar("trocas", i); },
      importarBanco: function (l) { return importarDemo("banco", CAMPOS_BANCO, l); },
      atribuirBanco: function (idLanc, caixa) {
        var lista = ler("banco");
        lista.forEach(function (l) { if (l.id === idLanc) l.caixa = caixa || null; });
        gravar("banco", lista);
        return Promise.resolve(null);
      },
      listarBanco: function (f) { return listarDemo("banco", f); },
      obterConfiguracao: function (chave) { return Promise.resolve((ler("config")[0] || {})[chave] || ""); },
      salvarConfiguracao: function (chave, valor) {
        var c = ler("config")[0] || {}; c[chave] = valor; gravar("config", [c]); return Promise.resolve(null);
      },
      importarCielo: function (vendas) { return importarDemo("cielo", CAMPOS_CIELO, vendas); },
      listarTaxas: function () { return Promise.resolve(ler("taxas")); },
      salvarTaxas: function (linhas) {
        var lista = ler("taxas");
        linhas.forEach(function (t) {
          var d = filtrarCampos(t, CAMPOS_TAXA);
          var reg = lista.filter(function (x) { return x.modalidade === d.modalidade && x.bandeira === d.bandeira && +x.parcelas === +d.parcelas; })[0];
          if (reg) Object.assign(reg, d); else lista.push(Object.assign({ id: id() }, d));
        });
        gravar("taxas", lista);
        return Promise.resolve(null);
      },
      apagarTaxa: function (i) { gravar("taxas", ler("taxas").filter(function (x) { return x.id !== i; })); return Promise.resolve(null); },
      importarRecebiveis: function (l) { return importarDemo("recebiveis", CAMPOS_RECEBIVEL, l); },
      listarRecebiveis: function (f) {
        f = f || {};
        return Promise.resolve(ler("recebiveis").filter(function (v) {
          return (!f.de || v.data_pagamento >= f.de) && (!f.ate || v.data_pagamento <= f.ate);
        }));
      },
      listarCielo: function (f) { return listarDemo("cielo", f); }
    };
    function importarDemo(nome, campos, vendas) {
        var lista = ler(nome), chaves = {};
        lista.forEach(function (v) { chaves[v.chave] = true; });
        var novas = 0;
        vendas.forEach(function (v) {
          if (chaves[v.chave]) return;
          chaves[v.chave] = true;
          lista.push(Object.assign({ id: id() }, filtrarCampos(v, campos)));
          novas++;
        });
        gravar(nome, lista);
        return Promise.resolve({ novas: novas, repetidas: vendas.length - novas });
    }
    function listarDemo(nome, f) {
        f = f || {};
        return Promise.resolve(ler(nome).filter(function (v) {
          return (!f.de || v.data >= f.de) && (!f.ate || v.data <= f.ate);
        }).sort(function (a, b) { return (a.data + (a.hora || "")).localeCompare(b.data + (b.hora || "")); }));
    }
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
