/*
 * Aba "Importar" da Conferência de caixa: CSV da Cielo (prévia antes de gravar), máquinas e trocas no dia.
 * O arquivo é lido no aparelho (Cielo.lerCsv); vão para o banco só os campos de Cielo.lerCsv.
 */
(function () {
  "use strict";
  var CI = window.Cielo;
  var BB = window.Banco;
  var u = null;          // utilidades do app (db, toast, mostrarErro, ...)
  var previa = null;     // { nome, leitura, escolhas: { numero: caixa } }
  var maquinas = [];
  var trocas = [];
  var cnpjLoja = "";     // do banco (configuracoes.cnpj_loja); nunca no código
  var bbPrevia = null;   // { nome, texto, leitura, sugestao }

  function $(id) { return document.getElementById(id); }
  function brl(c) { return u.brl(c); }
  function esc(s) { return u.escapar(s); }

  function opcoesCaixa(selecionado, vazio) {
    return (vazio ? '<option value="">' + esc(vazio) + "</option>" : "") + u.caixas.map(function (c) {
      return '<option value="' + esc(c.id) + '"' + (c.id === selecionado ? " selected" : "") + ">" + esc(c.curto) + "</option>";
    }).join("");
  }
  function maquinaDb(numero) { return maquinas.filter(function (m) { return m.numero === numero; })[0] || null; }
  function rotuloMaquina(m) {
    var db = maquinaDb(m);
    return "Máquina " + CI.finalMaquina(m) + (db && db.apelido ? " (" + db.apelido + ")" : "");
  }

  /* ------------------------------ Prévia ------------------------------ */

  function lerArquivo(arquivo) {
    u.limparErro();
    if (!arquivo) return;
    if (arquivo.size > 20 * 1024 * 1024) { u.mostrarErro({ message: "Arquivo grande demais (mais de 20 MB)." }); return; }
    arquivo.arrayBuffer().then(function (buf) {
      var r = CI.lerCsv(CI.decodificar(buf));
      if (r.erros.length) throw new Error(r.erros.join(" "));
      if (!r.vendas.length) throw new Error("O arquivo não tem nenhuma venda.");
      var escolhas = {};
      CI.resumoPorMaquina(r.vendas).forEach(function (m) {
        var db = maquinaDb(m.maquina);
        escolhas[m.maquina] = db && db.caixa ? db.caixa : "";
      });
      previa = { nome: arquivo.name, leitura: r, escolhas: escolhas };
      desenharPrevia();
    }).catch(function (e) {
      previa = null;
      desenharPrevia();
      u.mostrarErro({ message: e.message || "Não consegui ler o arquivo." });
    });
  }

  function desenharPrevia() {
    var el = $("cielo-previa");
    if (!previa) { el.hidden = true; el.innerHTML = ""; return; }
    var r = previa.leitura;
    var tot = CI.conferirTotalizador(r);
    var aprovadas = r.vendas.filter(function (v) { return v.aprovada; });
    var periodo = r.de === r.ate ? u.dataBR(r.de) : u.dataBR(r.de) + " a " + u.dataBR(r.ate);
    var html = '<h3 class="mini">Prévia: ' + esc(previa.nome) + "</h3>" +
      '<p class="mini">Período: <strong>' + esc(periodo) + "</strong> · " + r.vendas.length + " vendas lidas (" +
      aprovadas.length + " aprovadas, total " + brl(aprovadas.reduce(function (s, v) { return s + v.valor_centavos; }, 0)) + ")</p>" +
      '<p class="' + (tot.ok === false ? "msg-erro" : tot.ok ? "msg-ok" : "suave mini") + '">' + esc(tot.texto) + "</p>";
    if (r.ignoradas.length) {
      html += '<p class="msg-aviso">' + r.ignoradas.length + (r.ignoradas.length === 1 ? " linha ignorada" : " linhas ignoradas") + ": " +
        esc(r.ignoradas.slice(0, 5).map(function (x) { return "linha " + x.linha + " (" + x.motivo + ")"; }).join(", ")) +
        (r.ignoradas.length > 5 ? "…" : "") + "</p>";
    }
    html += CI.resumoPorMaquina(r.vendas).map(function (m) {
      var db = maquinaDb(m.maquina);
      var caixa = previa.escolhas[m.maquina];
      return '<div class="registro maquina-previa">' +
        "<div><strong>" + esc(rotuloMaquina(m.maquina)) + "</strong>" +
        (db && db.caixa ? '<p class="mini suave">Caixa padrão: ' + esc(u.nomeCaixa(db.caixa)) + " (para outro caixa num dia, use a troca abaixo)</p>"
          : '<label class="campo mini"><span>Máquina nova: de qual caixa?</span><select data-escolha="' + esc(m.maquina) + '">' +
            opcoesCaixa(caixa, "Escolha o caixa") + "</select></label>") +
        '<p class="mini">Débito ' + brl(m.debito) + " · Crédito " + brl(m.credito) + " · PIX " + brl(m.pix) +
        (m.outro ? " · Outros " + brl(m.outro) : "") + "</p>" +
        (m.nao_aprovadas ? '<p class="mini suave">' + m.nao_aprovadas + (m.nao_aprovadas === 1 ? " venda não aprovada" : " vendas não aprovadas") +
          " (" + brl(m.valor_nao_aprovado) + ") não contam.</p>" : "") +
        "</div></div>";
    }).join("");
    html += '<div class="acoes"><button type="button" class="botao" id="cielo-cancelar">Cancelar</button>' +
      '<button type="button" class="botao primario" id="cielo-gravar">Gravar no sistema</button></div>';
    el.innerHTML = html;
    el.hidden = false;
  }

  function gravar() {
    u.limparErro();
    var faltam = Object.keys(previa.escolhas).filter(function (k) { return !previa.escolhas[k]; });
    if (faltam.length) {
      u.mostrarErro({ message: "Escolha o caixa da " + faltam.map(function (k) { return "máquina " + CI.finalMaquina(k); }).join(" e da ") + "." });
      return;
    }
    var botao = $("cielo-gravar");
    u.ocupado(botao, true, "Gravando…");
    var novas = Object.keys(previa.escolhas).filter(function (k) { return !maquinaDb(k) || !maquinaDb(k).caixa; });
    novas.reduce(function (p, k) {
      return p.then(function () {
        var db = maquinaDb(k);
        return u.db.salvarMaquina({ numero: k, caixa: previa.escolhas[k], apelido: db ? db.apelido : "", ativa: true });
      });
    }, Promise.resolve()).then(function () {
      return u.db.importarCielo(previa.leitura.vendas);
    }).then(function (r) {
      u.toast(r.novas + (r.novas === 1 ? " venda nova gravada" : " vendas novas gravadas") +
        (r.repetidas ? "; " + r.repetidas + " já estavam no sistema" : "") + ".");
      previa = null;
      desenharPrevia();
      return atualizar();
    }, function (e) {
      u.ocupado(botao, false);
      u.mostrarErro(e);
    });
  }

  /* ------------------------------ Extrato do BB ------------------------------ */

  function lerArquivoBB(arquivo) {
    u.limparErro();
    if (!arquivo) return;
    if (arquivo.size > 20 * 1024 * 1024) { u.mostrarErro({ message: "Arquivo grande demais (mais de 20 MB)." }); return; }
    arquivo.arrayBuffer().then(function (buf) {
      var texto = CI.decodificar(buf);
      var r = BB.lerExtrato(texto, cnpjLoja);
      if (r.erros.length) throw new Error(r.erros.join(" "));
      if (!r.lancamentos.length) throw new Error("O extrato não tem nenhuma entrada para importar.");
      bbPrevia = { nome: arquivo.name, texto: texto, leitura: r, sugestao: cnpjLoja ? null : BB.sugerirCnpjLoja(r.documentos) };
      desenharBB();
    }).catch(function (e) {
      bbPrevia = null;
      desenharBB();
      u.mostrarErro({ message: e.message || "Não consegui ler o extrato." });
    });
  }

  function desenharBB() {
    var el = $("bb-previa");
    if (!bbPrevia) { el.hidden = true; el.innerHTML = ""; return; }
    var r = bbPrevia.leitura;
    var periodo = r.de === r.ate ? u.dataBR(r.de) : u.dataBR(r.de) + " a " + u.dataBR(r.ate);
    var html = '<h3 class="mini">Prévia: ' + esc(bbPrevia.nome) + "</h3>" +
      '<p class="mini">Transações de <strong>' + esc(periodo) + "</strong> · " + r.lancamentos.length + " entradas lidas · " +
      r.ignorados.saidas + " saídas e " + r.ignorados.saldos + " linhas de saldo ignoradas (não vão para o banco)" +
      (r.ignorados.outros.length ? " · " + r.ignorados.outros.length + " linhas com problema ignoradas" : "") + "</p>";
    if (!cnpjLoja) {
      html += '<div class="registro maquina-previa"><div><strong>CNPJ da loja</strong>' +
        '<p class="mini">O PIX da maquininha chega no BB com o CNPJ da própria loja. Ele fica guardado só no banco do sistema (não no código).</p>' +
        (bbPrevia.sugestao ? '<p class="mini">O CNPJ que mais aparece neste extrato é <strong>' + esc(BB.formatarCnpj(bbPrevia.sugestao)) +
          "</strong> (" + r.documentos[bbPrevia.sugestao] + ' vezes). É o da loja?</p><div class="acoes"><button type="button" class="botao primario" id="bb-cnpj-sim">Sim, é o da loja</button></div>' : "") +
        '<label class="campo"><span>' + (bbPrevia.sugestao ? "Ou digite o CNPJ da loja" : "Digite o CNPJ da loja") +
        '</span><input type="text" inputmode="numeric" id="bb-cnpj" maxlength="18" placeholder="00.000.000/0000-00" /></label>' +
        '<div class="acoes"><button type="button" class="botao" id="bb-cnpj-salvar">Salvar CNPJ</button></div></div></div>';
    } else {
      var soma = BB.somarPorCategoria(r.lancamentos);
      html += '<div class="tabela-rolagem"><table class="tabela-bb"><thead><tr><th>Categoria</th><th>Qtd.</th><th>Total</th></tr></thead><tbody>' +
        Object.keys(BB.CATEGORIAS).map(function (k) {
          return "<tr><td>" + esc(BB.CATEGORIAS[k]) + "</td><td>" + soma.qtd[k] + "</td><td>" + brl(soma[k]) + "</td></tr>";
        }).join("") + "</tbody></table></div>" +
        '<p class="suave mini">CNPJ da loja: ' + esc(BB.formatarCnpj(cnpjLoja)) +
        ' · <button type="button" class="botao fantasma pequeno" id="bb-cnpj-trocar">trocar</button></p>';
    }
    html += '<div class="acoes"><button type="button" class="botao" id="bb-cancelar">Cancelar</button>' +
      '<button type="button" class="botao primario" id="bb-gravar"' + (cnpjLoja ? "" : " disabled") + ">Gravar no sistema</button></div>";
    el.innerHTML = html;
    el.hidden = false;
  }

  function definirCnpj(valor) {
    var d = String(valor || "").replace(/\D/g, "");
    if (d.length !== 14) { u.mostrarErro({ message: "O CNPJ precisa ter 14 números." }); return; }
    u.db.salvarConfiguracao("cnpj_loja", d).then(function () {
      cnpjLoja = d;
      if (bbPrevia) { bbPrevia.leitura = BB.lerExtrato(bbPrevia.texto, d); bbPrevia.sugestao = null; }
      u.toast("CNPJ da loja salvo.");
      desenharBB();
    }, u.mostrarErro);
  }

  function gravarBB() {
    u.limparErro();
    var botao = $("bb-gravar");
    u.ocupado(botao, true, "Gravando…");
    u.db.importarBanco(bbPrevia.leitura.lancamentos).then(function (r) {
      u.toast(r.novas + (r.novas === 1 ? " entrada nova gravada" : " entradas novas gravadas") +
        (r.repetidas ? "; " + r.repetidas + " já estavam no sistema" : "") + ".");
      bbPrevia = null;
      desenharBB();
      return atualizar();
    }, function (e) { u.ocupado(botao, false); u.mostrarErro(e); });
  }

  /* --------------------------- Máquinas e trocas --------------------------- */

  function desenharMaquinas() {
    $("maquinas-lista").innerHTML = maquinas.length ? maquinas.map(function (m) {
      return '<div class="registro maquina-linha"><div><strong>Máquina ' + esc(CI.finalMaquina(m.numero)) + "</strong>" +
        '<p class="mini suave">Número ' + esc(m.numero) + "</p></div>" +
        '<label class="campo"><span>Apelido</span><input type="text" maxlength="40" data-apelido="' + esc(m.numero) + '" value="' + esc(m.apelido || "") + '" /></label>' +
        '<label class="campo"><span>Caixa padrão</span><select data-caixa-maquina="' + esc(m.numero) + '">' + opcoesCaixa(m.caixa, "Sem caixa") + "</select></label></div>";
    }).join("") : '<p class="vazio">Nenhuma máquina ainda. Elas aparecem ao importar o primeiro CSV da Cielo.</p>';
    $("troca-maquina").innerHTML = maquinas.map(function (m) {
      return '<option value="' + esc(m.numero) + '">' + esc(rotuloMaquina(m.numero)) + "</option>";
    }).join("");
    $("troca-salvar").disabled = !maquinas.length;
  }

  function desenharTrocas() {
    $("trocas-lista").innerHTML = trocas.length ? "<h3 class=\"mini\">Trocas registradas</h3>" + trocas.map(function (t) {
      var hor = t.hora_de || t.hora_ate ? " · " + (u.horaCurta(t.hora_de) || "início") + " às " + (u.horaCurta(t.hora_ate) || "fim") : " · dia inteiro";
      return '<div class="registro mov"><span>' + esc(u.dataBR(t.data)) + " · " + esc(rotuloMaquina(t.maquina)) + " → " +
        esc(u.nomeCaixa(t.caixa)) + esc(hor) + '</span><button type="button" class="botao pequeno perigo" data-apagar-troca="' +
        esc(t.id) + '">Apagar</button></div>';
    }).join("") : "";
  }

  function salvarTroca() {
    u.limparErro();
    var t = {
      data: $("troca-data").value, maquina: $("troca-maquina").value, caixa: $("troca-caixa").value,
      hora_de: $("troca-de").value || null, hora_ate: $("troca-ate").value || null, observacao: ""
    };
    if (!t.data || !t.maquina || !t.caixa) { u.mostrarErro({ message: "Preencha data, máquina e caixa." }); return; }
    if (t.hora_de && t.hora_ate && t.hora_de > t.hora_ate) { u.mostrarErro({ message: "O horário \"das\" é depois do \"até\"." }); return; }
    var m = maquinaDb(t.maquina);
    if (m && m.caixa === t.caixa && !t.hora_de && !t.hora_ate) {
      u.mostrarErro({ message: "Essa máquina já é do " + u.nomeCaixa(t.caixa) + " (caixa padrão)." });
      return;
    }
    var botao = $("troca-salvar");
    u.ocupado(botao, true, "Salvando…");
    u.db.salvarTroca(t).then(function () {
      u.toast("Troca salva: " + rotuloMaquina(t.maquina) + " no " + u.nomeCaixa(t.caixa) + " em " + u.dataBR(t.data) + ".");
      $("troca-de").value = ""; $("troca-ate").value = "";
      return atualizar();
    }, u.mostrarErro).then(function () { u.ocupado(botao, false); });
  }

  function desenharImportadoBB(lanc) {
    var dias = {};
    lanc.forEach(function (l) {
      var d = dias[l.data] || (dias[l.data] = { repasse_cielo: 0, pix_maquininha: 0, pix_terceiro: 0, outro: 0 });
      d[l.categoria] += l.valor_centavos;
    });
    var datas = Object.keys(dias).sort().reverse();
    return datas.length ? '<h3 class="mini">Extrato do BB (entradas por dia da transação)</h3>' + datas.map(function (d) {
      var x = dias[d];
      return '<div class="registro mov"><span><strong>' + esc(u.dataBR(d)) + "</strong>" +
        '<br><small class="suave">PIX maquininha ' + brl(x.pix_maquininha) + " · PIX de clientes " + brl(x.pix_terceiro) +
        " · Repasse Cielo " + brl(x.repasse_cielo) + (x.outro ? " · Outras " + brl(x.outro) : "") + "</small></span></div>";
    }).join("") : "";
  }

  function desenharImportado(vendas, lancBB) {
    var dias = {};
    vendas.forEach(function (v) {
      var d = dias[v.data] || (dias[v.data] = { qtd: 0, total: 0, caixas: {}, semCaixa: 0 });
      if (!v.aprovada) return;
      d.qtd++; d.total += v.valor_centavos;
      var cx = CI.caixaDaVenda(v, maquinas, trocas);
      if (!cx) d.semCaixa += v.valor_centavos;
      else d.caixas[cx] = (d.caixas[cx] || 0) + v.valor_centavos;
    });
    var datas = Object.keys(dias).sort().reverse();
    $("cielo-importado").innerHTML = (datas.length ? '<h3 class="mini">Cielo (vendas aprovadas por dia)</h3>' + datas.map(function (d) {
      var x = dias[d];
      return '<div class="registro mov"><span><strong>' + esc(u.dataBR(d)) + "</strong> · " + x.qtd + " aprovadas · " + brl(x.total) +
        '<br><small class="suave">' + Object.keys(x.caixas).sort().map(function (c) { return esc(u.nomeCaixa(c)) + " " + brl(x.caixas[c]); }).join(" · ") +
        (x.semCaixa ? " · sem caixa " + brl(x.semCaixa) : "") + "</small></span></div>";
    }).join("") : "") + desenharImportadoBB(lancBB || []);
    if (!$("cielo-importado").innerHTML) $("cielo-importado").innerHTML = '<p class="vazio">Nada importado nos últimos 14 dias.</p>';
  }

  function atualizar() {
    var hoje = u.hojeISO();
    var de = new Date(hoje + "T12:00:00"); de.setDate(de.getDate() - 13);
    var deISO = de.toISOString().slice(0, 10);
    return Promise.all([u.db.listarMaquinas(), u.db.listarTrocas({ de: deISO }), u.db.listarCielo({ de: deISO, ate: hoje }),
      u.db.listarBanco({ de: deISO, ate: hoje }), u.db.obterConfiguracao("cnpj_loja")])
      .then(function (r) {
        maquinas = r[0] || []; trocas = r[1] || []; cnpjLoja = r[4] || "";
        desenharMaquinas(); desenharTrocas(); desenharImportado(r[2] || [], r[3] || []);
        if (previa) desenharPrevia();
        if (bbPrevia) desenharBB();
      }, function (e) {
        $("maquinas-lista").innerHTML = '<p class="vazio">Não foi possível carregar (' + esc(e.message) + ").</p>";
        $("cielo-importado").innerHTML = "";
      });
  }

  function iniciar(utilidades) {
    u = utilidades;
    $("troca-caixa").innerHTML = opcoesCaixa(u.caixas[0] && u.caixas[0].id);
    $("troca-data").value = u.hojeISO();
    $("cielo-arquivo").addEventListener("change", function (ev) {
      var a = ev.target.files && ev.target.files[0];
      ev.target.value = "";
      lerArquivo(a);
    });
    $("cielo-importar").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); $("cielo-arquivo").click(); }
    });
    $("cielo-previa").addEventListener("change", function (ev) {
      if (ev.target.dataset.escolha) previa.escolhas[ev.target.dataset.escolha] = ev.target.value;
    });
    $("cielo-previa").addEventListener("click", function (ev) {
      if (ev.target.id === "cielo-cancelar") { previa = null; desenharPrevia(); }
      if (ev.target.id === "cielo-gravar") gravar();
    });
    $("maquinas-lista").addEventListener("change", function (ev) {
      var n = ev.target.dataset.caixaMaquina || ev.target.dataset.apelido;
      if (!n) return;
      var m = maquinaDb(n);
      var d = { numero: n, apelido: m ? m.apelido : "", caixa: m ? m.caixa : null, ativa: true };
      if (ev.target.dataset.caixaMaquina) d.caixa = ev.target.value || null;
      else d.apelido = ev.target.value.trim();
      u.db.salvarMaquina(d).then(function () { u.toast("Máquina " + CI.finalMaquina(n) + " salva."); return atualizar(); }, u.mostrarErro);
    });
    $("troca-salvar").addEventListener("click", salvarTroca);
    $("bb-arquivo").addEventListener("change", function (ev) {
      var a = ev.target.files && ev.target.files[0];
      ev.target.value = "";
      lerArquivoBB(a);
    });
    $("bb-importar").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); $("bb-arquivo").click(); }
    });
    $("bb-previa").addEventListener("click", function (ev) {
      var id = ev.target.id;
      if (id === "bb-cancelar") { bbPrevia = null; desenharBB(); }
      if (id === "bb-gravar") gravarBB();
      if (id === "bb-cnpj-sim") definirCnpj(bbPrevia.sugestao);
      if (id === "bb-cnpj-salvar") definirCnpj($("bb-cnpj").value);
      if (id === "bb-cnpj-trocar" && confirm("Trocar o CNPJ da loja? O próximo extrato será separado com o novo CNPJ.")) {
        cnpjLoja = "";
        if (bbPrevia) { bbPrevia.leitura = BB.lerExtrato(bbPrevia.texto, ""); bbPrevia.sugestao = BB.sugerirCnpjLoja(bbPrevia.leitura.documentos); }
        desenharBB();
      }
    });
    $("trocas-lista").addEventListener("click", function (ev) {
      var id = ev.target.dataset.apagarTroca;
      if (!id || !confirm("Apagar esta troca de máquina?")) return;
      u.db.apagarTroca(id).then(function () { u.toast("Troca apagada."); return atualizar(); }, u.mostrarErro);
    });
  }

  window.ImportarCielo = { iniciar: iniciar, mostrar: atualizar };
})();
