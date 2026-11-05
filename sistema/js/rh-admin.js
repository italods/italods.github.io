/*
 * Área "RH": Funcionários (#rh), Escala (#rh-escala), Ocorrências (#rh-ocorrencias) e Resumo (#rh-resumo).
 * As contas ficam em rh.js; aqui só telas. Dados dos funcionários ficam só no banco (nunca no código).
 */
(function () {
  "use strict";
  var RH = window.RH;
  var C = window.Calculos;
  var u = null;
  var d = { funcionarios: [], turmas: [], horarios: [], ocorrencias: [], feriados: [], holerites: [], ref: "" };
  var carregado = null;
  var fichaId = null;
  var semana = "";        // segunda-feira mostrada na escala
  var ocTipo = "folga";

  var NOMES_TIPO = { folga: "Folga", falta: "Falta", atestado: "Atestado", feriado_trabalhado: "Feriado trabalhado" };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return u.escapar(s); }
  function hoje() { return u.hojeISO(); }
  function mesAtual() { return hoje().slice(0, 7); }
  function anoMes(v) { var p = String(v || mesAtual()).split("-"); return { ano: +p[0], mes: +p[1] }; }
  function porNome(a, b) { return String(a.nome).localeCompare(String(b.nome), "pt-BR"); }
  function ordenar(l) { return l.slice().sort(function (a, b) { return (+a.ordem || 0) - (+b.ordem || 0) || porNome(a, b); }); }
  function ctx() { return { turmas: d.turmas, horarios: d.horarios, ref: d.ref, ocorrencias: d.ocorrencias, feriados: d.feriados }; }
  function ativos() { return d.funcionarios.filter(function (f) { return !f.desligamento || f.desligamento >= hoje(); }).sort(porNome); }
  function funcionario(id) { return d.funcionarios.filter(function (f) { return f.id === id; })[0] || null; }
  function turma(id) { return d.turmas.filter(function (t) { return t.id === id; })[0] || null; }
  function primeiroNome(n) { return String(n || "").split(/\s+/)[0]; }

  function carregar(forcar) {
    if (carregado && !forcar) return carregado;
    var nomes = ["funcionarios", "turmas", "horarios", "ocorrencias", "feriados", "holerites"];
    carregado = Promise.all(nomes.map(function (n) { return u.db.listarRH(n); }).concat([u.db.obterConfiguracao("rh_semana_ref")]))
      .then(function (r) {
        nomes.forEach(function (n, i) { d[n] = r[i] || []; });
        d.ref = r[nomes.length] || RH.segundaDaSemana(hoje());
        return d;
      }, function (e) { carregado = null; throw e; });
    return carregado;
  }

  function mostrar(aba) {
    u.limparErro();
    carregar(true).then(function () {
      if (aba === "rh") desenharFuncionarios();
      if (aba === "rh-escala") desenharEscala();
      if (aba === "rh-ocorrencias") desenharOcorrencias();
      if (aba === "rh-resumo") desenharResumo();
    }, u.mostrarErro);
  }

  /* ============================ Funcionários ============================ */

  function opcoesTurma(sel) {
    return '<option value="">Sem turma</option>' + ordenar(d.turmas).map(function (t) {
      return '<option value="' + esc(t.id) + '"' + (t.id === sel ? " selected" : "") + ">" + esc(t.nome) + "</option>";
    }).join("");
  }

  function linhaFuncionario(f) {
    var t = turma(f.turma);
    var sub = [f.funcao, t ? t.nome : "sem turma", f.admissao ? "desde " + u.dataBR(f.admissao) : ""].filter(Boolean).join(" · ");
    return '<button type="button" class="registro" data-func="' + esc(f.id) + '">' +
      '<span class="r-titulo">' + esc(f.nome) + "</span>" +
      '<span class="r-total">' + (f.desligamento ? '<span class="etiqueta">Desligado</span>' : "") + "</span>" +
      '<span class="r-sub">' + esc(sub) + "</span><span></span></button>";
  }

  function desenharFuncionarios() {
    var at = ativos();
    var desl = d.funcionarios.filter(function (f) { return at.indexOf(f) < 0; }).sort(porNome);
    $("rh-lista").innerHTML = (at.length ? at.map(linhaFuncionario).join("") : '<p class="vazio">Nenhum funcionário cadastrado ainda.</p>') +
      (desl.length ? '<details><summary>Desligados (' + desl.length + ")</summary>" + desl.map(linhaFuncionario).join("") + "</details>" : "");
    if (fichaId === null) $("rh-ficha").hidden = true;
  }

  function abrirFicha(f) {
    fichaId = f ? f.id : "";
    $("rh-ficha").hidden = false;
    $("rh-ficha-titulo").textContent = f ? f.nome : "Novo funcionário";
    $("rh-nome").value = f ? f.nome : "";
    $("rh-funcao").value = f ? f.funcao || "" : "";
    $("rh-turma").innerHTML = opcoesTurma(f ? f.turma : "");
    $("rh-admissao").value = f ? f.admissao || "" : "";
    $("rh-telefone").value = f ? f.telefone || "" : "";
    $("rh-salario").value = f && f.salario_centavos != null ? u.dinheiroCampo(f.salario_centavos) : "";
    $("rh-desligamento").value = f ? f.desligamento || "" : "";
    $("rh-observacao").value = f ? f.observacao || "" : "";
    $("rh-apagar").hidden = !f;
    desenharHolerites(f);
    $("rh-ficha").scrollIntoView({ behavior: "smooth", block: "start" });
    $("rh-nome").focus();
  }

  function fecharFicha() { fichaId = null; $("rh-ficha").hidden = true; }

  function desenharHolerites(f) {
    var el = $("rh-holerites");
    el.hidden = !f;
    if (!f) { el.innerHTML = ""; return; }
    var hs = d.holerites.filter(function (h) { return h.funcionario === f.id; })
      .sort(function (a, b) { return a.referencia < b.referencia ? 1 : -1; });
    el.innerHTML = '<h3 class="mini">Holerites recebidos do contador</h3>' + (hs.length ? '<ul class="lista-versoes">' + hs.map(function (h) {
      var am = anoMes(h.referencia.slice(0, 7));
      return "<li><div>" + esc(RH.rotuloMes(am.ano, am.mes)) + ' <small class="suave">recebido em ' + esc(u.dataBR(h.recebido_em)) + "</small></div>" +
        '<button type="button" class="botao pequeno" data-apagar-holerite="' + esc(h.id) + '" aria-label="Apagar">×</button></li>';
    }).join("") + "</ul>" : '<p class="suave mini">Nenhum registrado. Registre no Resumo do mês.</p>');
  }

  function salvarFicha() {
    u.limparErro();
    var nome = $("rh-nome").value.trim();
    if (!nome) { u.mostrarErro({ message: "Preencha o nome." }); return; }
    var sal = $("rh-salario").value.trim();
    var salario = sal ? C.reaisParaCentavos(sal) : null;
    if (sal && salario == null) { u.mostrarErro({ message: "Salário inválido. Use só números, por exemplo 1.621,00." }); return; }
    var tel = $("rh-telefone").value.trim();
    if (!/^[0-9 ()+-]{0,20}$/.test(tel)) { u.mostrarErro({ message: "Telefone inválido: use só números, espaço, parênteses e traço." }); return; }
    var adm = $("rh-admissao").value, desl = $("rh-desligamento").value;
    if (adm && desl && desl < adm) { u.mostrarErro({ message: "O desligamento está antes da admissão." }); return; }
    var dados = { nome: nome, funcao: $("rh-funcao").value.trim(), turma: $("rh-turma").value || null, admissao: adm || null,
      telefone: tel, salario_centavos: salario, desligamento: desl || null, observacao: $("rh-observacao").value.trim() };
    var b = $("rh-salvar");
    u.ocupado(b, true, "Salvando…");
    u.db.salvarRH("funcionarios", dados, fichaId || null).then(function () {
      u.toast("Salvo: " + nome);
      fecharFicha();
      return carregar(true).then(desenharFuncionarios);
    }, u.mostrarErro).then(function () { u.ocupado(b, false); });
  }

  function apagarFicha() {
    var f = funcionario(fichaId);
    if (!f || !confirm("Apagar " + f.nome + "? Se ele saiu da loja, prefira preencher a data de desligamento.")) return;
    u.db.apagarRH("funcionarios", f.id).then(function () {
      u.toast("Apagado.");
      fecharFicha();
      return carregar(true).then(desenharFuncionarios);
    }, u.mostrarErro);
  }

  /* ============================== Escala ============================== */

  function textoDia(x, curto) {
    switch (x.tipo) {
      case "trabalho": return x.entrada + "–" + x.saida + (x.ocorrencia && x.ocorrencia.tipo === "feriado_trabalhado" ? " (feriado)" : "");
      case "folga": return "Folga";
      case "folga_escala": return "Não trabalha";
      case "falta": return x.ocorrencia.justificada ? "Falta justificada" : "Falta";
      case "atestado": return "Atestado";
      case "feriado": return "Feriado";
      case "domingo": return "Fechado";
      case "sem_escala": return curto ? "Sem turma" : "Sem turma (escolha na ficha)";
      default: return "—";
    }
  }
  function classeDia(x) {
    return { trabalho: "", folga: "cor-pendente", folga_escala: "suave", falta: "cor-falta", atestado: "cor-pendente",
      feriado: "suave", domingo: "suave", sem_escala: "suave" }[x.tipo] || "suave";
  }

  function desenharEscala() {
    if (!semana) semana = RH.segundaDaSemana(hoje());
    var fim = window.Feriados.somarDias(semana, 5);
    $("esc-titulo").textContent = u.dataBR(semana).slice(0, 5) + " a " + u.dataBR(fim).slice(0, 5);
    var fs = ativos();
    var html = "";
    if (!fs.length) html = '<p class="vazio">Cadastre os funcionários na aba Funcionários.</p>';
    else if (!d.horarios.length) html = '<p class="vazio">Cadastre os horários (abaixo) para ver a escala.</p>';
    else {
      for (var i = 0; i < 6; i++) {
        var t = window.Feriados.somarDias(semana, i);
        var fer = RH.feriadoDoDia(t, d.feriados);
        html += '<div class="esc-dia' + (t === hoje() ? " hoje" : "") + '"><p class="esc-dia-cab"><strong>' + RH.DIAS[i + 1] + " " + u.dataBR(t).slice(0, 5) + "</strong>" +
          (fer ? ' <span class="etiqueta">' + esc(fer.nome) + (fer.facultativo ? " (facultativo)" : "") + "</span>" : "") + "</p><ul>" +
          fs.map(function (f) {
            var x = RH.diaDoFuncionario(ctx(), f, t);
            if (x.tipo === "fora") return "";
            return '<li><span>' + esc(primeiroNome(f.nome)) + (x.horario ? ' <small class="suave">' + esc(x.horario.nome) + "</small>" : "") +
              '</span><span class="' + classeDia(x) + '">' + esc(textoDia(x, true)) + "</span></li>";
          }).join("") + "</ul></div>";
      }
    }
    $("esc-semana").innerHTML = html;
    // mês de um funcionário
    var sel = $("esc-func"), atual = sel.value;
    sel.innerHTML = fs.map(function (f) { return '<option value="' + esc(f.id) + '">' + esc(f.nome) + "</option>"; }).join("");
    if (atual && funcionario(atual)) sel.value = atual;
    if (!$("esc-mes").value) $("esc-mes").value = mesAtual();
    desenharMesFuncionario();
    desenharHorarios();
    desenharTurmas();
  }

  function desenharMesFuncionario() {
    var f = funcionario($("esc-func").value);
    if (!f) { $("esc-mes-lista").innerHTML = ""; return; }
    var am = anoMes($("esc-mes").value);
    var dias = RH.mesDoFuncionario(ctx(), f, am.ano, am.mes);
    var r = RH.resumoFuncionario(ctx(), f, am.ano, am.mes, d.holerites);
    $("esc-mes-lista").innerHTML = '<p class="suave mini">' + r.trabalhados + " dias de trabalho na escala (" + RH.horas(r.minutos) + ").</p>" +
      '<ul class="esc-mes">' + dias.map(function (x) {
        if (x.tipo === "domingo") return "";
        return '<li class="' + (x.data === hoje() ? "hoje" : "") + '"><span>' + RH.DIAS_CURTOS[x.semana] + " " + u.dataBR(x.data).slice(0, 5) +
          (x.feriado ? ' <small class="suave">' + esc(x.feriado.nome) + "</small>" : "") + '</span><span class="' + classeDia(x) + '">' +
          esc(textoDia(x)) + "</span></li>";
      }).join("") + "</ul>";
  }

  function desenharHorarios() {
    var hs = ordenar(d.horarios);
    $("esc-horarios").innerHTML = hs.length ? hs.map(function (h) {
      return '<div class="horario" data-horario="' + esc(h.id) + '">' +
        '<div class="dupla"><label class="campo"><span>Nome</span><input type="text" class="h-nome" maxlength="40" value="' + esc(h.nome) + '" /></label>' +
        '<label class="campo"><span>Ordem</span><input type="number" class="h-ordem" min="0" max="9" value="' + esc(h.ordem) + '" /></label></div>' +
        '<table class="tabela-horario"><thead><tr><th>Dia</th><th>Entrada</th><th>Saída</th></tr></thead><tbody>' +
        [1, 2, 3, 4, 5, 6].map(function (i) {
          var x = (h.dias || {})[String(i)] || {};
          return "<tr><td>" + RH.DIAS_CURTOS[i] + '</td><td><input type="time" data-dia="' + i + '" data-campo="entrada" value="' + esc(x.entrada || "") + '" aria-label="Entrada ' + RH.DIAS[i] + '" /></td>' +
            '<td><input type="time" data-dia="' + i + '" data-campo="saida" value="' + esc(x.saida || "") + '" aria-label="Saída ' + RH.DIAS[i] + '" /></td></tr>';
        }).join("") + "</tbody></table>" +
        '<div class="acoes"><button type="button" class="botao perigo pequeno" data-apagar-horario="' + esc(h.id) + '">Apagar</button>' +
        '<button type="button" class="botao primario pequeno" data-salvar-horario="' + esc(h.id) + '">Salvar horário</button></div></div>';
    }).join("") : '<p class="vazio">Nenhum horário. Inclua, por exemplo, "Manhã" e "Tarde".</p>';
  }

  function salvarHorario(id) {
    var el = document.querySelector('[data-horario="' + id + '"]');
    var nome = el.querySelector(".h-nome").value.trim();
    if (!nome) { u.mostrarErro({ message: "Dê um nome ao horário (ex.: Manhã)." }); return; }
    var dias = {}, erro = "";
    [1, 2, 3, 4, 5, 6].forEach(function (i) {
      var e = el.querySelector('[data-dia="' + i + '"][data-campo="entrada"]').value;
      var s = el.querySelector('[data-dia="' + i + '"][data-campo="saida"]').value;
      if (!e && !s) return;
      if (!RH.lerHora(e) || !RH.lerHora(s)) { erro = "Preencha entrada e saída de " + RH.DIAS[i] + " (ou deixe as duas vazias)."; return; }
      dias[String(i)] = { entrada: RH.lerHora(e), saida: RH.lerHora(s) };
    });
    if (erro) { u.mostrarErro({ message: erro }); return; }
    u.limparErro();
    u.db.salvarRH("horarios", { nome: nome, ordem: +el.querySelector(".h-ordem").value || 0, dias: dias }, id).then(function () {
      u.toast("Horário salvo: " + nome);
      return carregar(true).then(desenharEscala);
    }, u.mostrarErro);
  }

  function desenharTurmas() {
    var ts = ordenar(d.turmas), hs = ordenar(d.horarios);
    $("esc-turmas").innerHTML = ts.length ? ts.map(function (t) {
      var agora = RH.horarioDaTurma(d.turmas, d.horarios, d.ref, t.id, hoje());
      var membros = ativos().filter(function (f) { return f.turma === t.id; }).map(function (f) { return f.nome; });
      return '<div class="turma" data-turma="' + esc(t.id) + '">' +
        '<div class="dupla"><label class="campo"><span>Nome</span><input type="text" class="t-nome" maxlength="40" value="' + esc(t.nome) + '" /></label>' +
        '<label class="campo"><span>Nesta semana faz</span><select class="t-agora">' + hs.map(function (h) {
          return '<option value="' + esc(h.id) + '"' + (agora && agora.id === h.id ? " selected" : "") + ">" + esc(h.nome) + "</option>";
        }).join("") + "</select></label></div>" +
        '<p class="suave mini">' + (membros.length ? esc(membros.join(", ")) : "Ninguém nesta turma ainda.") + "</p>" +
        '<div class="acoes"><button type="button" class="botao perigo pequeno" data-apagar-turma="' + esc(t.id) + '">Apagar</button>' +
        '<button type="button" class="botao primario pequeno" data-salvar-turma="' + esc(t.id) + '">Salvar turma</button></div></div>';
    }).join("") : '<p class="vazio">Nenhuma turma. Inclua, por exemplo, "Turma 1" e "Turma 2".</p>';
  }

  /*
   * Salvar turma: nome e o horário que ela faz nesta semana. A semana de referência é ajustada para
   * que esta turma (pela sua ordem) caia nesse horário; as outras turmas seguem a rotação.
   */
  function salvarTurma(id) {
    var el = document.querySelector('[data-turma="' + id + '"]');
    var nome = el.querySelector(".t-nome").value.trim();
    if (!nome) { u.mostrarErro({ message: "Dê um nome à turma (ex.: Turma 1)." }); return; }
    var hs = ordenar(d.horarios), ts = ordenar(d.turmas);
    var hEscolhido = el.querySelector(".t-agora").value;
    u.limparErro();
    var novaRef = d.ref;
    if (hEscolhido && hs.length) {
      var i = ts.map(function (t) { return t.id; }).indexOf(id), k = hs.map(function (h) { return h.id; }).indexOf(hEscolhido);
      // (i + w) mod H = k, w = semanas entre a referência e hoje  ->  ref = esta semana − (k − i) semanas
      var w = ((k - i) % hs.length + hs.length) % hs.length;
      novaRef = window.Feriados.somarDias(RH.segundaDaSemana(hoje()), -7 * w);
    }
    u.db.salvarRH("turmas", { nome: nome }, id).then(function () {
      return novaRef !== d.ref ? u.db.salvarConfiguracao("rh_semana_ref", novaRef) : null;
    }).then(function () {
      u.toast("Turma salva: " + nome);
      return carregar(true).then(desenharEscala);
    }, u.mostrarErro);
  }

  function novoHorario() {
    var n = d.horarios.length;
    u.db.salvarRH("horarios", { nome: n === 0 ? "Manhã" : n === 1 ? "Tarde" : "Horário " + (n + 1), ordem: n, dias: {} }).then(function () {
      return carregar(true).then(desenharEscala);
    }, u.mostrarErro);
  }
  function novaTurma() {
    var n = d.turmas.length;
    u.db.salvarRH("turmas", { nome: "Turma " + (n + 1), ordem: n }).then(function () {
      return (d.ref ? null : u.db.salvarConfiguracao("rh_semana_ref", RH.segundaDaSemana(hoje())));
    }).then(function () { return carregar(true).then(desenharEscala); }, u.mostrarErro);
  }

  /* ============================ Ocorrências ============================ */

  function desenharOcorrencias() {
    var sel = $("oc-func"), atual = sel.value;
    sel.innerHTML = ativos().map(function (f) { return '<option value="' + esc(f.id) + '">' + esc(f.nome) + "</option>"; }).join("");
    if (atual && funcionario(atual)) sel.value = atual;
    if (!$("oc-data").value) $("oc-data").value = hoje();
    if (!$("oc-mes").value) $("oc-mes").value = mesAtual();
    escolherTipo(ocTipo);
    desenharListaOcorrencias();
    desenharFeriados();
  }

  function escolherTipo(t) {
    ocTipo = t;
    u.definirAlternador($("oc-tipo"), t);
    $("oc-dias-campo").hidden = t !== "atestado";
    $("oc-justificada-campo").hidden = t !== "falta";
    $("oc-data-rotulo").textContent = t === "atestado" ? "Primeiro dia" : "Data";
    avisoOcorrencia();
  }

  function avisoOcorrencia() {
    var el = $("oc-aviso"), t = $("oc-data").value, f = funcionario($("oc-func").value);
    var msg = "";
    if (t && RH.diaDaSemana(t) === 0 && ocTipo !== "atestado") msg = "Esse dia é domingo (loja fechada).";
    if (t && ocTipo === "feriado_trabalhado") {
      var fer = RH.feriadoDoDia(t, d.feriados);
      if (!fer) msg = "Esse dia não é feriado. Se for feriado municipal, inclua em Feriados abaixo.";
      else if (fer.facultativo) msg = fer.nome + " é ponto facultativo (dia normal no comércio).";
    }
    if (t && f && (ocTipo === "folga" || ocTipo === "falta") && !msg) {
      var x = RH.diaDoFuncionario(ctx(), f, t);
      if (x.tipo === "folga_escala") msg = "Pela escala, " + primeiroNome(f.nome) + " já não trabalha nesse dia.";
      if (x.tipo === "feriado") msg = "Esse dia é feriado (" + x.feriado.nome + ").";
    }
    el.textContent = msg;
    el.hidden = !msg;
  }

  function incluirOcorrencia() {
    u.limparErro();
    var f = funcionario($("oc-func").value);
    if (!f) { u.mostrarErro({ message: "Escolha o funcionário (cadastre na aba Funcionários)." }); return; }
    var t = $("oc-data").value;
    if (!t) { u.mostrarErro({ message: "Preencha a data." }); return; }
    var dias = ocTipo === "atestado" ? parseInt($("oc-dias").value, 10) : 1;
    if (!(dias >= 1 && dias <= 365)) { u.mostrarErro({ message: "Dias do atestado: de 1 a 365." }); return; }
    var dados = { funcionario: f.id, tipo: ocTipo, data: t, dias: dias, justificada: ocTipo === "falta" && $("oc-justificada").checked,
      motivo: $("oc-motivo").value.trim() };
    var b = $("oc-incluir");
    u.ocupado(b, true, "Salvando…");
    u.db.salvarRH("ocorrencias", dados).then(function () {
      u.toast(NOMES_TIPO[ocTipo] + " registrada: " + primeiroNome(f.nome) + " · " + u.dataBR(t));
      $("oc-motivo").value = "";
      $("oc-justificada").checked = false;
      $("oc-dias").value = "1";
      $("oc-mes").value = t.slice(0, 7);
      return carregar(true).then(desenharOcorrencias);
    }, u.mostrarErro).then(function () { u.ocupado(b, false); });
  }

  function desenharListaOcorrencias() {
    var m = $("oc-mes").value || mesAtual();
    var am = anoMes(m), dias = RH.diasDoMes(am.ano, am.mes), ini = dias[0], fim = dias[dias.length - 1];
    var lista = d.ocorrencias.filter(function (o) {
      var ate = o.tipo === "atestado" ? window.Feriados.somarDias(o.data, (+o.dias || 1) - 1) : o.data;
      return o.data <= fim && ate >= ini;
    }).sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : 0; });
    $("oc-lista").innerHTML = lista.length ? '<ul class="lista-versoes">' + lista.map(function (o) {
      var f = funcionario(o.funcionario);
      var det = o.tipo === "atestado" ? " · " + o.dias + (+o.dias === 1 ? " dia" : " dias") : o.tipo === "falta" ? (o.justificada ? " · justificada" : " · sem justificativa") : "";
      return "<li><div><strong>" + esc(u.dataBR(o.data).slice(0, 5)) + " · " + esc(NOMES_TIPO[o.tipo]) + "</strong>" + esc(det) + "<br>" +
        esc(f ? f.nome : "?") + (o.motivo ? ' <small class="suave">' + esc(o.motivo) + "</small>" : "") + "</div>" +
        '<button type="button" class="botao pequeno" data-apagar-oc="' + esc(o.id) + '" aria-label="Apagar">×</button></li>';
    }).join("") + "</ul>" : '<p class="vazio">Nenhuma ocorrência em ' + esc(RH.rotuloMes(am.ano, am.mes)) + ".</p>";
  }

  function desenharFeriados() {
    var ano = +(($("oc-mes").value || mesAtual()).slice(0, 4));
    var nac = window.Feriados.nacionais(ano);
    var todos = Object.keys(nac).map(function (t) { return { data: t, nome: nac[t], nacional: true }; })
      .concat(d.feriados.filter(function (f) { return f.data.slice(0, 4) === String(ano); }))
      .sort(function (a, b) { return a.data < b.data ? -1 : 1; });
    $("fer-lista").innerHTML = '<p class="mini"><strong>' + ano + "</strong></p>" + '<ul class="lista-versoes">' + todos.map(function (f) {
      var fac = /Carnaval|Corpus Christi/.test(f.nome);
      return "<li><div>" + esc(u.dataBR(f.data).slice(0, 5)) + " " + RH.DIAS_CURTOS[RH.diaDaSemana(f.data)] + " · " + esc(f.nome) +
        ' <small class="suave">' + (f.nacional ? (fac ? "facultativo" : "nacional") : "municipal/estadual") + "</small></div>" +
        (f.nacional ? "" : '<button type="button" class="botao pequeno" data-apagar-feriado="' + esc(f.id) + '" aria-label="Apagar">×</button>') + "</li>";
    }).join("") + "</ul>";
  }

  function incluirFeriado() {
    u.limparErro();
    var t = $("fer-data").value, nome = $("fer-nome").value.trim();
    if (!t || !nome) { u.mostrarErro({ message: "Preencha a data e o nome do feriado." }); return; }
    u.db.salvarRH("feriados", { data: t, nome: nome }).then(function () {
      u.toast("Feriado incluído: " + u.dataBR(t));
      $("fer-data").value = ""; $("fer-nome").value = "";
      return carregar(true).then(desenharOcorrencias);
    }, u.mostrarErro);
  }

  /* ============================== Resumo ============================== */

  function resumos() {
    var am = anoMes($("res-mes").value);
    return RH.ativosNoMes(d.funcionarios, am.ano, am.mes).map(function (f) {
      return RH.resumoFuncionario(ctx(), f, am.ano, am.mes, d.holerites);
    });
  }

  function desenharResumo() {
    if (!$("res-mes").value) $("res-mes").value = mesAtual();
    var am = anoMes($("res-mes").value);
    var rs = resumos();
    var ref = $("res-mes").value + "-01";
    $("res-conteudo").innerHTML = '<h2 style="margin:4px 0 10px">' + esc(RH.rotuloMes(am.ano, am.mes)) + "</h2>" + (rs.length ? rs.map(function (r) {
      var f = r.funcionario;
      function item(rotulo, valor) { return '<div class="linha-info"><span>' + rotulo + "</span><strong>" + valor + "</strong></div>"; }
      return '<div class="bloco"><h2>' + esc(f.nome) + (f.funcao ? ' <small class="suave">' + esc(f.funcao) + "</small>" : "") + "</h2>" +
        item("Faltas", r.faltas.length ? r.faltas.length + " (" + r.faltasJustificadas + " justificada" + (r.faltasJustificadas === 1 ? "" : "s") + ")" : "0") +
        item("Dias de atestado", String(r.diasAtestado)) +
        item("Folgas", String(r.folgas.length)) +
        item("Feriados trabalhados", r.feriadosTrabalhados.length ? r.feriadosTrabalhados.map(function (x) { return u.dataBR(x.data).slice(0, 5); }).join(", ") : "0") +
        item("Dias na escala", r.trabalhados + " (" + RH.horas(r.minutos) + ")") +
        '<div class="linha-info"><span>Holerite</span>' + (r.holerite ? "<strong>Recebido em " + esc(u.dataBR(r.holerite.recebido_em)) + "</strong>"
          : '<span class="holerite-registrar"><input type="date" value="' + hoje() + '" aria-label="Data em que o holerite chegou" data-holerite-data="' + esc(f.id) + '" />' +
            '<button type="button" class="botao pequeno" data-holerite="' + esc(f.id) + '" data-ref="' + ref + '">Recebi</button></span>') + "</div>" +
        "</div>";
    }).join("") : '<p class="vazio">Nenhum funcionário ativo em ' + esc(RH.rotuloMes(am.ano, am.mes)) + ".</p>");
  }

  function registrarHolerite(func, ref) {
    var inp = document.querySelector('[data-holerite-data="' + func + '"]');
    var t = inp && inp.value;
    if (!t) { u.mostrarErro({ message: "Escolha a data em que o holerite chegou." }); return; }
    u.db.salvarRH("holerites", { funcionario: func, referencia: ref, recebido_em: t }).then(function () {
      u.toast("Holerite registrado.");
      return carregar(true).then(desenharResumo);
    }, u.mostrarErro);
  }

  /* ============================== Início ============================== */

  function iniciar(utilidades) {
    u = utilidades;
    $("rh-novo").addEventListener("click", function () { abrirFicha(null); });
    $("rh-cancelar").addEventListener("click", fecharFicha);
    $("rh-salvar").addEventListener("click", salvarFicha);
    $("rh-apagar").addEventListener("click", apagarFicha);
    $("rh-salario").addEventListener("blur", function () {
      var c = C.reaisParaCentavos($("rh-salario").value);
      if (c != null) $("rh-salario").value = u.dinheiroCampo(c);
    });
    $("rh-lista").addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-func]");
      if (b) abrirFicha(funcionario(b.dataset.func));
    });
    $("rh-holerites").addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-apagar-holerite]");
      if (!b || !confirm("Apagar este registro de holerite?")) return;
      u.db.apagarRH("holerites", b.dataset.apagarHolerite).then(function () {
        return carregar(true).then(function () { desenharHolerites(funcionario(fichaId)); });
      }, u.mostrarErro);
    });
    // escala
    $("esc-anterior").addEventListener("click", function () { semana = window.Feriados.somarDias(semana, -7); desenharEscala(); });
    $("esc-proxima").addEventListener("click", function () { semana = window.Feriados.somarDias(semana, 7); desenharEscala(); });
    $("esc-func").addEventListener("change", desenharMesFuncionario);
    $("esc-mes").addEventListener("change", desenharMesFuncionario);
    $("esc-novo-horario").addEventListener("click", novoHorario);
    $("esc-nova-turma").addEventListener("click", novaTurma);
    $("esc-horarios").addEventListener("click", function (ev) {
      var s = ev.target.closest("[data-salvar-horario]"), a = ev.target.closest("[data-apagar-horario]");
      if (s) salvarHorario(s.dataset.salvarHorario);
      if (a && confirm("Apagar este horário?")) {
        u.db.apagarRH("horarios", a.dataset.apagarHorario).then(function () { return carregar(true).then(desenharEscala); }, u.mostrarErro);
      }
    });
    $("esc-turmas").addEventListener("click", function (ev) {
      var s = ev.target.closest("[data-salvar-turma]"), a = ev.target.closest("[data-apagar-turma]");
      if (s) salvarTurma(s.dataset.salvarTurma);
      if (a && confirm("Apagar esta turma? Quem está nela fica sem turma.")) {
        u.db.apagarRH("turmas", a.dataset.apagarTurma).then(function () { return carregar(true).then(desenharEscala); }, u.mostrarErro);
      }
    });
    // ocorrências
    $("oc-tipo").addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-valor]");
      if (b) escolherTipo(b.dataset.valor);
    });
    ["oc-data", "oc-func"].forEach(function (id) { $(id).addEventListener("change", avisoOcorrencia); });
    $("oc-incluir").addEventListener("click", incluirOcorrencia);
    $("oc-mes").addEventListener("change", function () { desenharListaOcorrencias(); desenharFeriados(); });
    $("oc-lista").addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-apagar-oc]");
      if (!b || !confirm("Apagar esta ocorrência?")) return;
      u.db.apagarRH("ocorrencias", b.dataset.apagarOc).then(function () { return carregar(true).then(desenharOcorrencias); }, u.mostrarErro);
    });
    $("fer-incluir").addEventListener("click", incluirFeriado);
    $("fer-lista").addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-apagar-feriado]");
      if (!b || !confirm("Apagar este feriado?")) return;
      u.db.apagarRH("feriados", b.dataset.apagarFeriado).then(function () { return carregar(true).then(desenharOcorrencias); }, u.mostrarErro);
    });
    // resumo
    $("res-mes").addEventListener("change", desenharResumo);
    $("res-conteudo").addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-holerite]");
      if (b) registrarHolerite(b.dataset.holerite, b.dataset.ref);
    });
    $("res-copiar").addEventListener("click", function () {
      var am = anoMes($("res-mes").value);
      u.copiar(RH.textoResumo(resumos(), am.ano, am.mes));
    });
    $("res-pdf").addEventListener("click", function () {
      var am = anoMes($("res-mes").value);
      u.pdfTexto(RH.textoResumo(resumos(), am.ano, am.mes), "rh_" + $("res-mes").value + ".pdf");
    });
  }

  window.RHAdmin = { iniciar: iniciar, mostrar: mostrar };
})();
