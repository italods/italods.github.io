/*
 * Área "RH" (parte 2): Banco de horas (#rh-banco), Férias (#rh-ferias), Custos (#rh-custos) e Saúde (#rh-saude).
 * Usa os dados carregados por rh-admin.js (RHAdmin.base) e as contas de rh-folha.js.
 */
(function () {
  "use strict";
  var RH = window.RH, RF = window.RHFolha, FE = window.Feriados, C = window.Calculos;
  var b = null, u = null, d = null;
  var bhTipo = "mais";
  var feEditando = null;     // id das férias em edição
  var feAno = 0;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return u.escapar(s); }
  function hoje() { return u.hojeISO(); }
  function nome1(f) { return b.primeiroNome(f.nome); }
  function recarregar(fn) { return b.carregar(true).then(fn); }
  function kpi(rotulo, valor, sub, classe, link) {
    return '<a class="kpi" href="' + (link || "#") + '"><span class="kpi-rotulo">' + esc(rotulo) + '</span><span class="kpi-valor' + (classe ? " kpi-" + classe : "") + '">' +
      esc(valor) + '</span><span class="kpi-sub">' + esc(sub || "") + "</span></a>";
  }
  function preencherSelect(id, lista) {
    var el = $(id), atual = el.value;
    el.innerHTML = b.opcoesFuncionarios(lista, atual);
    if (!el.value && lista[0]) el.value = lista[0].id;
  }

  function mostrar(aba) {
    if (aba === "rh-banco") desenharBanco();
    if (aba === "rh-ferias") desenharFerias();
    if (aba === "rh-custos") desenharCustos();
    if (aba === "rh-saude") desenharSaude();
  }

  /* =========================== Banco de horas =========================== */

  function desenharBanco() {
    var fs = b.ativos(), c = b.ctx();
    $("bh-saldos").innerHTML = fs.length ? fs.map(function (f) {
      var s = RF.saldoBanco(c, f, hoje(), d.cfg);
      var sub = s.saldo > 0 ? (s.vencidas ? RH.horas(Math.min(s.vencidas, s.saldo)) + " passaram de 6 meses" :
        s.proximoVencimento ? "Compensar até " + u.dataBR(s.proximoVencimento) : "") :
        s.saldo < 0 ? "Deve horas para a loja" : "Sem horas guardadas";
      if (s.saldo > 0 && s.valorExtra) sub += " · como hora extra: " + u.brl(s.valorExtra);
      return kpi(f.nome, b.sinalHoras(s.saldo), sub, s.saldo > 0 && s.vencidas ? "erro" : s.saldo < 0 ? "aviso" : s.saldo > 0 ? "ok" : "", "#rh-banco");
    }).join("") : '<p class="vazio">Cadastre os funcionários na aba Funcionários.</p>';
    preencherSelect("bh-func", fs);
    preencherSelect("bh-extrato-func", fs);
    if (!$("bh-data").value) $("bh-data").value = hoje();
    escolherTipoBanco(bhTipo);
    desenharExtrato();
  }

  function escolherTipoBanco(t) {
    bhTipo = t;
    u.definirAlternador($("bh-tipo"), t);
    $("bh-horas-campo").hidden = t === "folga";
    $("bh-explica").textContent = t === "mais" ? "Ficou depois do horário ou veio num dia de folga: as horas somam no banco." :
      t === "menos" ? "Saiu mais cedo ou chegou atrasado (e não vai virar falta): as horas descontam do banco." :
      "Folga dada para compensar as horas guardadas: desconta as horas que ele trabalharia nesse dia pela escala.";
    avisoBanco();
  }

  function avisoBanco() {
    var f = b.funcionario($("bh-func").value), t = $("bh-data").value, el = $("bh-aviso"), msg = "";
    if (f && t && bhTipo === "folga") {
      var x = RH.diaDoFuncionario(b.ctx(), f, t);
      if (x.tipo === "trabalho") msg = "Vai descontar " + RH.horas(x.minutos) + " (" + x.entrada + "–" + x.saida + ").";
      else if (x.tipo === "domingo") msg = "Domingo a loja é fechada.";
      else if (x.tipo === "folga_escala") msg = "Pela escala, " + nome1(f) + " já não trabalha nesse dia.";
      else if (x.tipo === "sem_escala") msg = "Sem turma na ficha: desconta " + RH.horas(RF.minutosPrevistos(b.ctx(), f, t)) + " (jornada ÷ 6).";
      else msg = "Nesse dia: " + RH.textoDia(x) + ".";
    }
    el.textContent = msg;
    el.hidden = !msg;
  }

  function lancarBanco() {
    u.limparErro();
    var f = b.funcionario($("bh-func").value), t = $("bh-data").value, motivo = $("bh-motivo").value.trim();
    if (!f) { u.mostrarErro({ message: "Escolha o funcionário." }); return; }
    if (!t) { u.mostrarErro({ message: "Preencha a data." }); return; }
    var p;
    if (bhTipo === "folga") {
      p = u.db.salvarRH("ocorrencias", { funcionario: f.id, tipo: "folga", data: t, dias: 1, banco: true, motivo: motivo || "Folga do banco de horas" });
    } else {
      var m = RF.lerHoras($("bh-horas").value);
      if (!m) { u.mostrarErro({ message: "Horas inválidas. Escreva, por exemplo, 1:30 ou 2h." }); return; }
      if (m > 14400) { u.mostrarErro({ message: "No máximo 240 horas por lançamento." }); return; }
      p = u.db.salvarRH("banco_horas", { funcionario: f.id, data: t, minutos: bhTipo === "mais" ? m : -m, motivo: motivo });
    }
    var bt = $("bh-incluir");
    u.ocupado(bt, true, "Salvando…");
    p.then(function () {
      u.toast("Lançado no banco de horas: " + nome1(f));
      $("bh-horas").value = ""; $("bh-motivo").value = "";
      $("bh-extrato-func").value = f.id;
      return recarregar(desenharBanco);
    }, u.mostrarErro).then(function () { u.ocupado(bt, false); });
  }

  function desenharExtrato() {
    var f = b.funcionario($("bh-extrato-func").value);
    if (!f) { $("bh-extrato").innerHTML = ""; return; }
    var ex = RF.extratoBanco(b.ctx(), f).reverse(), saldo = RF.saldoBanco(b.ctx(), f, hoje(), d.cfg);
    $("bh-extrato").innerHTML = '<div class="linha-info forte"><span>Saldo hoje</span><strong>' + esc(b.sinalHoras(saldo.saldo)) + "</strong></div>" +
      (saldo.abertos.length && saldo.saldo > 0 ? '<p class="suave mini">Horas a compensar: ' + saldo.abertos.map(function (a) {
        return RH.horas(a.minutos) + " até " + u.dataBR(a.vence);
      }).map(esc).join("; ") + ".</p>" : "") +
      (ex.length ? '<ul class="lista-versoes">' + ex.map(function (x) {
        var apagar = x.origem === "escala" ? '<span class="etiqueta">pela escala</span>' :
          x.origem === "manual" ? '<button type="button" class="botao pequeno" data-apagar-bh="' + esc(x.id) + '" aria-label="Apagar">×</button>' :
          '<button type="button" class="botao pequeno" data-apagar-bh-oc="' + esc(x.id) + '" aria-label="Apagar">×</button>';
        return "<li><div><strong>" + esc(u.dataBR(x.data)) + ' · <span class="' + (x.minutos > 0 ? "cor-sobra" : "cor-falta") + '">' + esc(b.sinalHoras(x.minutos)) + "</span></strong>" +
          (x.data > hoje() ? ' <small class="suave">(futuro)</small>' : "") + "<br>" +
          '<small class="suave">' + esc(x.motivo || (x.minutos > 0 ? "Horas a mais" : "Horas a menos")) + "</small></div>" + apagar + "</li>";
      }).join("") + "</ul>" : '<p class="vazio">Nenhum lançamento ainda.</p>');
  }

  /* =============================== Férias =============================== */

  var NOMES_SIT = { em_aquisicao: "Em andamento", ok: "Tirou tudo", a_programar: "A tirar", vencendo: "Vencendo", vencida: "Vencida (em dobro)" };
  var CLASSE_SIT = { em_aquisicao: "", ok: "sit-resolvido", a_programar: "sit-em_analise", vencendo: "sit-pendente", vencida: "tipo-reclamacao" };

  function desenharFerias() {
    var fs = b.ativos();
    if (!feAno) feAno = +hoje().slice(0, 4);
    $("fe-situacao").innerHTML = fs.length ? fs.map(function (f) {
      if (!f.admissao) return '<div class="fe-func"><h3>' + esc(f.nome) + '</h3><p class="suave mini">Preencha a admissão na ficha.</p></div>';
      var aqs = RF.periodosAquisitivos(f, d.ferias, d.ocorrencias, hoje());
      var mostrar = aqs.filter(function (a) { return a.situacao !== "ok"; }).slice(-3);
      if (!mostrar.length) mostrar = aqs.slice(-1);
      return '<div class="fe-func"><h3>' + esc(f.nome) + "</h3>" + mostrar.map(function (a) {
        var det;
        if (a.situacao === "em_aquisicao") {
          var avos = RF.avosFerias(a.inicio, hoje());
          det = "Completa 12 meses em " + u.dataBR(a.fim) + " (" + avos + "/12 até agora). Tirar entre " + u.dataBR(FE.somarDias(a.fim, 1)) + " e " + u.dataBR(a.concessivoFim) + ".";
        } else if (a.situacao === "ok") det = "Férias desse período já tiradas ou programadas.";
        else det = "Restam " + a.saldo + " de " + a.direito + " dias" + (a.faltas > 5 ? " (" + a.faltas + " faltas sem justificativa)" : "") +
          (a.situacao === "vencida" ? ". Prazo acabou em " + u.dataBR(a.concessivoFim) + ": pagar em dobro." : ". Começar até " + u.dataBR(a.limiteInicio) + ".");
        if (a.programados) det += " Programado: " + a.programados + " dias.";
        return '<div class="linha-info"><span>' + esc(u.dataBR(a.inicio) + " a " + u.dataBR(a.fim)) + '<br><small class="suave">' + esc(det) + "</small></span>" +
          '<span class="etiqueta ' + CLASSE_SIT[a.situacao] + '">' + esc(NOMES_SIT[a.situacao]) + "</span></div>";
      }).join("") + "</div>";
    }).join("") : '<p class="vazio">Cadastre os funcionários na aba Funcionários.</p>';
    preencherSelect("fe-func", fs);
    preencherAquisitivos();
    conferirForm();
    desenharPlano();
    desenharListaFerias();
  }

  function preencherAquisitivos(sel) {
    var f = b.funcionario($("fe-func").value), el = $("fe-aquisitivo");
    if (!f || !f.admissao) { el.innerHTML = ""; return; }
    var outros = d.ferias.filter(function (x) { return x.id !== feEditando; });
    var aqs = RF.periodosAquisitivos(f, outros, d.ocorrencias, FE.somarDias(hoje(), 400));
    var atual = sel || el.value;
    el.innerHTML = aqs.map(function (a) {
      return '<option value="' + a.inicio + '">' + esc(u.dataBR(a.inicio) + " a " + u.dataBR(a.fim) + " · " +
        (a.saldo ? "restam " + a.saldo + " dias" : "sem saldo")) + "</option>";
    }).join("");
    var padrao = aqs.filter(function (a) { return a.saldo > 0; })[0];
    if (atual && aqs.some(function (a) { return a.inicio === atual; })) el.value = atual;
    else if (padrao) el.value = padrao.inicio;
  }

  function dadosForm() {
    return { id: feEditando, funcionario: $("fe-func").value, aquisitivo_inicio: $("fe-aquisitivo").value, inicio: $("fe-inicio").value,
      dias: parseInt($("fe-dias").value, 10) || 0, observacao: $("fe-obs").value.trim() };
  }

  function conferirForm() {
    var p = dadosForm(), el = $("fe-conferencia");
    if (!p.funcionario || !p.inicio) { el.innerHTML = ""; return null; }
    var r = RF.conferirFerias(p, { funcionarios: b.ativos(), ferias: d.ferias, ocorrencias: d.ocorrencias, feriados: d.feriados, hoje: hoje() });
    var f = b.funcionario(p.funcionario);
    var valor = f && f.salario_centavos ? RF.valorFerias(RF.remuneracao(f, d.cfg), p.dias).total : 0;
    el.innerHTML = (r.erros.length ? '<div class="cx-resultado res-erro"><div>' + r.erros.map(function (x) { return "<strong>" + esc(x) + "</strong>"; }).join("") + "</div></div>" : "") +
      (r.avisos.length ? '<div class="cx-resultado res-aviso"><div>' + r.avisos.map(function (x) { return "<span>" + esc(x) + "</span>"; }).join("<br>") + "</div></div>" : "") +
      (!r.erros.length ? '<div class="cx-resultado res-ok"><div><strong>De ' + esc(u.dataBR(p.inicio)) + " a " + esc(u.dataBR(r.fim)) + ", volta em " + esc(u.dataBR(r.retorno)) + "</strong>" +
        "<span>Pagar até " + esc(u.dataBR(r.pagarAte)) + (valor ? ": cerca de " + esc(u.brl(valor)) + " (férias + 1/3, antes dos descontos)" : "") + ".</span></div></div>" : "");
    return r;
  }

  function salvarFerias() {
    u.limparErro();
    var p = dadosForm(), r = conferirForm();
    if (!p.funcionario) { u.mostrarErro({ message: "Escolha o funcionário." }); return; }
    if (!p.inicio) { u.mostrarErro({ message: "Preencha o primeiro dia." }); return; }
    if (r && r.erros.length) { u.mostrarErro({ message: r.erros[0] }); return; }
    var bt = $("fe-salvar");
    u.ocupado(bt, true, "Salvando…");
    var dados = { funcionario: p.funcionario, aquisitivo_inicio: p.aquisitivo_inicio, inicio: p.inicio, dias: p.dias, observacao: p.observacao };
    u.db.salvarRH("ferias", dados, feEditando || null).then(function (salvo) {
      var f = b.funcionario(p.funcionario);
      u.toast("Férias salvas: " + nome1(f));
      if (!feEditando && p.inicio > hoje() && confirm("Gerar o aviso de férias para " + nome1(f) + " assinar?")) avisoFerias(salvo || dados);
      cancelarEdicao();
      return recarregar(desenharFerias);
    }, u.mostrarErro).then(function () { u.ocupado(bt, false); });
  }

  function editarFerias(x) {
    feEditando = x.id;
    $("fe-form-titulo").textContent = "Editar férias";
    $("fe-cancelar").hidden = false;
    $("fe-func").value = x.funcionario;
    preencherAquisitivos(x.aquisitivo_inicio);
    $("fe-inicio").value = x.inicio;
    $("fe-dias").value = x.dias;
    $("fe-obs").value = x.observacao || "";
    conferirForm();
    $("fe-form").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function cancelarEdicao() {
    feEditando = null;
    $("fe-form-titulo").textContent = "Programar férias";
    $("fe-cancelar").hidden = true;
    $("fe-inicio").value = ""; $("fe-dias").value = "30"; $("fe-obs").value = "";
    $("fe-conferencia").innerHTML = "";
  }

  function avisoFerias(x) {
    var f = b.funcionario(x.funcionario);
    if (f) u.pdfTexto(RF.textoAvisoFerias(b.empresa(), f, x, hoje()), "aviso_ferias_" + nome1(f).toLowerCase() + "_" + x.inicio + ".pdf");
  }

  function desenharPlano() {
    $("fe-ano-titulo").textContent = "Planejamento de " + feAno;
    var fs = d.funcionarios.filter(function (f) { return RF.ativoEm(f, feAno + "-12-31") || RF.ativoEm(f, feAno + "-01-01") ||
      (f.admissao && f.admissao.slice(0, 4) === String(feAno)); }).sort(b.porNome);
    if (!fs.length) { $("fe-plano").innerHTML = '<p class="vazio">Ninguém trabalhando em ' + feAno + ".</p>"; return; }
    // dias de férias de cada funcionário em cada mês; limite (concessivo) que cai no mês
    function diasNoMes(f, m) {
      var ini = feAno + "-" + String(m).padStart(2, "0") + "-01", fim = feAno + "-" + String(m).padStart(2, "0") + "-" + new Date(Date.UTC(feAno, m, 0)).getUTCDate();
      var n = 0;
      d.ferias.forEach(function (x) {
        if (x.funcionario !== f.id) return;
        var xf = FE.somarDias(x.inicio, (+x.dias || 1) - 1);
        if (x.inicio > fim || xf < ini) return;
        var a = x.inicio > ini ? x.inicio : ini, z = xf < fim ? xf : fim;
        n += RF.diasEntre(a, z) + 1;
      });
      return n;
    }
    var limites = {};
    fs.forEach(function (f) {
      RF.periodosAquisitivos(f, d.ferias, d.ocorrencias, feAno + "-12-31").forEach(function (a) {
        if (a.saldo > 0 && a.situacao !== "em_aquisicao" && a.limiteInicio.slice(0, 4) === String(feAno)) limites[f.id + "-" + (+a.limiteInicio.slice(5, 7))] = a.limiteInicio;
      });
    });
    var mat = fs.map(function (f) { var l = []; for (var m = 1; m <= 12; m++) l.push(diasNoMes(f, m)); return l; });
    var html = '<table class="fe-tabela"><thead><tr><th></th>' + RH.MESES.map(function (m) { return "<th>" + esc(m.slice(0, 3)) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      fs.map(function (f, i) {
        return "<tr><th>" + esc(nome1(f)) + "</th>" + mat[i].map(function (n, k) {
          var junto = n && mat.some(function (l, j) { return j !== i && l[k] && fs[j].funcao === f.funcao; });
          var lim = limites[f.id + "-" + (k + 1)];
          return '<td class="' + (n ? (junto ? "fe-junto" : "fe-tem") : "") + (lim ? " fe-limite" : "") + '" title="' + esc(n ? n + " dias de férias" : lim ? "Prazo: começar até " + u.dataBR(lim) : "") + '">' +
            (n ? n : lim ? "!" : "") + "</td>";
        }).join("") + "</tr>";
      }).join("") + "</tbody></table>";
    $("fe-plano").innerHTML = '<div class="tabela-rolagem">' + html + "</div>" +
      '<p class="suave mini">Número = dias de férias no mês. <span class="fe-legenda fe-junto">&nbsp;</span> duas pessoas da mesma função no mesmo mês. ' +
      '<span class="fe-legenda fe-limite">!</span> mês limite para começar as férias que faltam.</p>';
  }

  function desenharListaFerias() {
    var l = d.ferias.slice().sort(function (a, b2) { return a.inicio < b2.inicio ? 1 : -1; });
    $("fe-lista").innerHTML = l.length ? '<ul class="lista-versoes">' + l.map(function (x) {
      var f = b.funcionario(x.funcionario), fim = FE.somarDias(x.inicio, (+x.dias || 1) - 1);
      var sit = fim < hoje() ? "tiradas" : x.inicio <= hoje() ? "em andamento" : "programadas";
      return "<li><div><strong>" + esc(f ? f.nome : "?") + "</strong> · " + esc(x.dias + " dias") + "<br>" +
        '<small class="suave">' + esc(u.dataBR(x.inicio) + " a " + u.dataBR(fim) + " (" + sit + ")" + (x.observacao ? " · " + x.observacao : "")) + "</small></div>" +
        '<span class="lista-botoes"><button type="button" class="botao pequeno" data-aviso-fe="' + esc(x.id) + '">Aviso</button>' +
        '<button type="button" class="botao pequeno" data-editar-fe="' + esc(x.id) + '">Editar</button>' +
        '<button type="button" class="botao pequeno" data-apagar-fe="' + esc(x.id) + '" aria-label="Apagar">×</button></span></li>';
    }).join("") + "</ul>" : '<p class="vazio">Nenhuma férias registrada. Registre também as que já foram tiradas, para o saldo ficar certo.</p>';
  }

  /* =============================== Custos =============================== */

  function desenharCustos() {
    var fs = b.ativos().filter(function (f) { return f.admissao; });
    var cfg = d.cfg;
    u.definirAlternador($("cu-regime"), cfg.regime);
    $("cu-inss-campo").hidden = cfg.regime !== "normal";
    $("cu-inss").value = (cfg.inss / 100).toFixed(2).replace(".", ",");
    $("cu-multa").checked = cfg.multa;
    $("cu-grat").checked = cfg.gratificacaoIntegra;
    var semSalario = fs.filter(function (f) { return !f.salario_centavos; });
    if (!fs.length) {
      $("cu-kpis").innerHTML = "";
      $("cu-plano").innerHTML = "";
      $("cu-funcionarios").innerHTML = '<p class="vazio">Ainda não há dados: cadastre os funcionários com admissão e salário.</p>';
      return;
    }
    var custos = fs.map(function (f) { return RF.custoMensal(f, cfg); }), tot = RF.somarCustos(custos);
    var c = Object.assign(b.ctx(), { funcionarios: fs });
    var plano = RF.planoMeses(c, 12), reserva = RF.reservaHoje(c);
    var grande = plano.filter(function (m) { return m.extras > 0; })[0];
    $("cu-kpis").innerHTML =
      kpi("Custo real por mês", u.brl(tot.total), "Salários, FGTS e o que guardar", "", "#rh-custos") +
      kpi("Guardar todo mês", u.brl(tot.guardar), "13º, férias e FGTS", "ok", "#rh-custos") +
      kpi("Reserva que já devia ter", u.brl(reserva.total), "13º " + u.brl(reserva.decimo) + " · férias " + u.brl(reserva.ferias), "aviso", "#rh-custos") +
      (grande ? kpi("Próximo pagamento extra", u.brl(grande.extras), rotuloMes(grande.mes) + ": " + extrasTexto(grande).join(", "), "", "#rh-custos")
        : kpi("Próximo pagamento extra", "—", "Nada de 13º ou férias nos próximos 12 meses", "", "#rh-custos"));
    $("cu-plano").innerHTML = "<thead><tr><th>Mês</th><th>Guardar</th><th>Salários e FGTS</th><th>13º e férias</th><th>Total a pagar</th></tr></thead><tbody>" +
      plano.map(function (m) {
        var ex = extrasTexto(m);
        return "<tr><td>" + esc(rotuloMes(m.mes)) + (ex.length ? '<br><small class="suave">' + esc(ex.join("; ")) + "</small>" : "") + "</td>" +
          "<td>" + esc(u.brl(m.guardar)) + "</td><td>" + esc(u.brl(m.salarios + m.fgts + m.inss)) + "</td><td>" + (m.extras ? "<strong>" + esc(u.brl(m.extras)) + "</strong>" : "—") + "</td>" +
          "<td>" + esc(u.brl(m.pagar)) + "</td></tr>";
      }).join("") + "</tbody>";
    var normal = cfg.regime === "normal";
    function linha(rot, v, forte) { return '<div class="linha-info' + (forte ? " forte" : "") + '"><span>' + esc(rot) + "</span><strong>" + esc(u.brl(v)) + "</strong></div>"; }
    $("cu-funcionarios").innerHTML = (semSalario.length ? '<p class="msg-aviso mini">Sem salário na ficha: ' + esc(semSalario.map(function (f) { return f.nome; }).join(", ")) + ".</p>" : "") +
      '<div class="cu-grade">' + fs.map(function (f, i) {
        var x = custos[i];
        return '<div class="cu-func"><h3>' + esc(f.nome) + "</h3>" +
          linha("Salário", x.salario) + (x.gratificacao ? linha("Gratificação", x.gratificacao) : "") + linha("FGTS (8%)", x.fgts) +
          (normal ? linha("INSS da loja", x.inss) : "") + linha("Pago no mês", x.pagar, true) +
          linha("Guardar: 13º (1/12)", x.decimo) + linha("Guardar: férias + 1/3 (1/12)", x.ferias) +
          linha("Guardar: FGTS" + (normal ? " e INSS" : "") + " do 13º e férias", x.fgtsReserva + x.inssReserva) +
          (x.multa ? linha("Guardar: multa de 40% do FGTS", x.multa) : "") + linha("Custo real por mês", x.total, true) + "</div>";
      }).join("") + "</div>";
  }

  function rotuloMes(mt) { var p = mt.split("-"); return RH.MESES[+p[1] - 1].slice(0, 1).toUpperCase() + RH.MESES[+p[1] - 1].slice(1) + "/" + p[0].slice(2); }
  function extrasTexto(m) {
    var l = [];
    if (m.decimo1) l.push("1ª parcela do 13º até 30/11");
    if (m.decimo2) l.push("2ª parcela do 13º até 20/12");
    m.ferias.forEach(function (x) { l.push("férias de " + b.primeiroNome(x.nome) + " (pagar até " + u.dataBR(x.pagarAte).slice(0, 5) + ")"); });
    return l;
  }

  function salvarEncargos() {
    u.limparErro();
    var regime = $("cu-regime").dataset.valor === "normal" ? "normal" : "simples";
    var inss = Math.round(parseFloat(String($("cu-inss").value).replace(",", ".")) * 100);
    if (regime === "normal" && !(inss >= 0 && inss <= 5000)) { u.mostrarErro({ message: "INSS da loja: de 0 a 50%." }); return; }
    var cfg = { regime: regime, inss: regime === "normal" ? inss : d.cfg.inss, multa: $("cu-multa").checked, gratificacaoIntegra: $("cu-grat").checked };
    u.db.salvarConfiguracao("rh_encargos", JSON.stringify(cfg)).then(function () {
      u.toast("Encargos salvos.");
      return recarregar(desenharCustos);
    }, u.mostrarErro);
  }

  /* =============================== Saúde =============================== */

  var SIT_EXAME = { sem: ["Sem exame", "tipo-reclamacao"], vencido: ["Vencido", "tipo-reclamacao"], vencendo: ["Vence logo", "sit-pendente"], ok: ["Em dia", "sit-resolvido"] };

  function desenharSaude() {
    var fs = b.ativos();
    ["sa-ex-func", "sa-ep-func", "sa-tr-func"].forEach(function (id) { preencherSelect(id, fs); });
    ["sa-ex-data", "sa-ep-data", "sa-tr-data"].forEach(function (id) { if (!$(id).value) $(id).value = hoje(); });
    if (!$("sa-ex-validade").value) sugerirValidade();
    var sit = RF.situacaoExames(fs, d.exames, hoje());
    $("sa-exames-situacao").innerHTML = sit.length ? sit.map(function (x) {
      var s = SIT_EXAME[x.situacao], doF = d.exames.filter(function (e) { return e.funcionario === x.funcionario.id; }).sort(function (a, c) { return a.data < c.data ? 1 : -1; });
      return '<details class="sa-func"><summary><span>' + esc(x.funcionario.nome) + '<br><small class="suave">' +
        esc(x.ultimo ? RF.TIPOS_EXAME[x.ultimo.tipo] + " em " + u.dataBR(x.ultimo.data) + " · próximo até " + u.dataBR(x.vence) : "Nenhum exame registrado") +
        '</small></span><span class="etiqueta ' + s[1] + '">' + s[0] + "</span></summary>" +
        (doF.length ? '<ul class="lista-versoes">' + doF.map(function (e) {
          return "<li><div>" + esc(u.dataBR(e.data) + " · " + RF.TIPOS_EXAME[e.tipo]) + (e.apto === false ? ' <strong class="cor-falta">inapto</strong>' : "") +
            (e.observacao ? ' <small class="suave">' + esc(e.observacao) + "</small>" : "") + "</div>" +
            '<button type="button" class="botao pequeno" data-apagar-ex="' + esc(e.id) + '" aria-label="Apagar">×</button></li>';
        }).join("") + "</ul>" : "") + "</details>";
    }).join("") : '<p class="vazio">Cadastre os funcionários na aba Funcionários.</p>';
    // EPI e uniforme por funcionário
    var porF = fs.map(function (f) { return { f: f, l: d.entregas.filter(function (e) { return e.funcionario === f.id; }).sort(function (a, c) { return a.data < c.data ? 1 : -1; }) }; })
      .filter(function (x) { return x.l.length; });
    $("sa-entregas").innerHTML = porF.length ? porF.map(function (x) {
      return '<div class="sa-grupo"><div class="sa-grupo-cab"><h3>' + esc(x.f.nome) + '</h3><button type="button" class="botao pequeno" data-ficha-epi="' + esc(x.f.id) + '">Ficha para assinar</button></div>' +
        '<ul class="lista-versoes">' + x.l.map(function (e) {
          return "<li><div>" + esc(u.dataBR(e.data) + " · " + (+e.quantidade || 1) + " × " + e.item) + (e.ca ? ' <small class="suave">CA ' + esc(e.ca) + "</small>" : "") +
            (e.devolvido_em ? '<br><small class="suave">devolvido em ' + esc(u.dataBR(e.devolvido_em)) + "</small>" : "") + "</div>" +
            '<span class="lista-botoes">' + (e.devolvido_em ? "" : '<button type="button" class="botao pequeno" data-devolver="' + esc(e.id) + '">Devolveu</button>') +
            '<button type="button" class="botao pequeno" data-apagar-ep="' + esc(e.id) + '" aria-label="Apagar">×</button></span></li>';
        }).join("") + "</ul></div>";
    }).join("") : '<p class="suave mini">Nenhuma entrega registrada.</p>';
    var trs = d.treinamentos.slice().sort(function (a, c) { return a.data < c.data ? 1 : -1; });
    $("sa-treinamentos").innerHTML = trs.length ? '<ul class="lista-versoes">' + trs.map(function (t) {
      var f = b.funcionario(t.funcionario);
      var venc = t.validade ? (t.validade < hoje() ? ' <strong class="cor-falta">vencido em ' + esc(u.dataBR(t.validade)) + "</strong>" : ' <small class="suave">vale até ' + esc(u.dataBR(t.validade)) + "</small>") : "";
      return "<li><div><strong>" + esc(t.nome) + "</strong>" + (t.horas ? " · " + esc(t.horas + "h") : "") + "<br>" +
        esc((f ? f.nome : "?") + " · " + u.dataBR(t.data)) + venc + "</div>" +
        '<button type="button" class="botao pequeno" data-apagar-tr="' + esc(t.id) + '" aria-label="Apagar">×</button></li>';
    }).join("") + "</ul>" : '<p class="suave mini">Nenhum treinamento registrado.</p>';
  }

  function sugerirValidade() {
    var t = $("sa-ex-data").value, tipo = $("sa-ex-tipo").value;
    $("sa-ex-validade").value = t && tipo !== "demissional" ? RF.somarMeses(t, 24) : "";
  }

  function salvarSaude(tabela, dados, botao, limpar) {
    u.limparErro();
    u.ocupado(botao, true, "Salvando…");
    u.db.salvarRH(tabela, dados).then(function () {
      u.toast("Registrado.");
      limpar();
      return recarregar(desenharSaude);
    }, u.mostrarErro).then(function () { u.ocupado(botao, false); });
  }

  function apagar(tabela, id, pergunta, depois) {
    if (!confirm(pergunta)) return;
    u.db.apagarRH(tabela, id).then(function () { return recarregar(depois); }, u.mostrarErro);
  }

  /* ============================== Início ============================== */

  function iniciar(base) {
    b = base; u = base.u(); d = base.d;
    // banco de horas
    $("bh-tipo").addEventListener("click", function (ev) { var x = ev.target.closest("button[data-valor]"); if (x) escolherTipoBanco(x.dataset.valor); });
    ["bh-func", "bh-data"].forEach(function (id) { $(id).addEventListener("change", avisoBanco); });
    $("bh-incluir").addEventListener("click", lancarBanco);
    $("bh-extrato-func").addEventListener("change", desenharExtrato);
    $("bh-extrato").addEventListener("click", function (ev) {
      var a = ev.target.closest("[data-apagar-bh]"), o = ev.target.closest("[data-apagar-bh-oc]");
      if (a) apagar("banco_horas", a.dataset.apagarBh, "Apagar este lançamento?", desenharBanco);
      if (o) apagar("ocorrencias", o.dataset.apagarBhOc, "Apagar esta ocorrência (folga/feriado) do banco de horas?", desenharBanco);
    });
    // férias
    $("fe-func").addEventListener("change", function () { preencherAquisitivos(); conferirForm(); });
    ["fe-aquisitivo", "fe-inicio", "fe-dias"].forEach(function (id) { $(id).addEventListener("change", conferirForm); });
    $("fe-dias").addEventListener("input", conferirForm);
    $("fe-salvar").addEventListener("click", salvarFerias);
    $("fe-cancelar").addEventListener("click", function () { cancelarEdicao(); preencherAquisitivos(); });
    $("fe-ano-anterior").addEventListener("click", function () { feAno--; desenharPlano(); });
    $("fe-ano-proximo").addEventListener("click", function () { feAno++; desenharPlano(); });
    $("fe-lista").addEventListener("click", function (ev) {
      var id = function (k) { var el = ev.target.closest("[data-" + k + "]"); return el && el.getAttribute("data-" + k); };
      var x = function (i) { return d.ferias.filter(function (f) { return f.id === i; })[0]; };
      if (id("aviso-fe")) avisoFerias(x(id("aviso-fe")));
      if (id("editar-fe")) editarFerias(x(id("editar-fe")));
      if (id("apagar-fe")) apagar("ferias", id("apagar-fe"), "Apagar este período de férias?", desenharFerias);
    });
    // custos
    $("cu-regime").addEventListener("click", function (ev) {
      var x = ev.target.closest("button[data-valor]");
      if (!x) return;
      u.definirAlternador($("cu-regime"), x.dataset.valor);
      $("cu-inss-campo").hidden = x.dataset.valor !== "normal";
    });
    $("cu-salvar").addEventListener("click", salvarEncargos);
    // saúde
    $("sa-ex-data").addEventListener("change", sugerirValidade);
    $("sa-ex-tipo").addEventListener("change", sugerirValidade);
    $("sa-ex-salvar").addEventListener("click", function () {
      var f = $("sa-ex-func").value, t = $("sa-ex-data").value, v = $("sa-ex-validade").value;
      if (!f || !t) { u.mostrarErro({ message: "Escolha o funcionário e a data do exame." }); return; }
      if (v && v < t) { u.mostrarErro({ message: "O próximo exame não pode ser antes deste." }); return; }
      salvarSaude("exames", { funcionario: f, tipo: $("sa-ex-tipo").value, data: t, validade: v || null, apto: $("sa-ex-apto").value === "1",
        observacao: $("sa-ex-obs").value.trim() }, $("sa-ex-salvar"), function () { $("sa-ex-obs").value = ""; });
    });
    $("sa-ep-salvar").addEventListener("click", function () {
      var f = $("sa-ep-func").value, t = $("sa-ep-data").value, item = $("sa-ep-item").value.trim(), q = parseInt($("sa-ep-qtd").value, 10);
      if (!f || !t || !item) { u.mostrarErro({ message: "Preencha funcionário, data e item." }); return; }
      if (!(q >= 1 && q <= 99)) { u.mostrarErro({ message: "Quantidade: de 1 a 99." }); return; }
      salvarSaude("entregas", { funcionario: f, data: t, item: item, quantidade: q, ca: $("sa-ep-ca").value.trim() }, $("sa-ep-salvar"),
        function () { $("sa-ep-item").value = ""; $("sa-ep-ca").value = ""; $("sa-ep-qtd").value = "1"; });
    });
    $("sa-tr-salvar").addEventListener("click", function () {
      var f = $("sa-tr-func").value, t = $("sa-tr-data").value, nome = $("sa-tr-nome").value.trim(), h = $("sa-tr-horas").value, v = $("sa-tr-validade").value;
      if (!f || !t || !nome) { u.mostrarErro({ message: "Preencha funcionário, data e treinamento." }); return; }
      if (h && !(+h >= 1 && +h <= 999)) { u.mostrarErro({ message: "Horas: de 1 a 999." }); return; }
      salvarSaude("treinamentos", { funcionario: f, data: t, nome: nome, horas: h ? +h : null, validade: v || null }, $("sa-tr-salvar"),
        function () { $("sa-tr-nome").value = ""; $("sa-tr-horas").value = ""; $("sa-tr-validade").value = ""; });
    });
    $("aba-rh-saude").addEventListener("click", function (ev) {
      var el;
      if ((el = ev.target.closest("[data-apagar-ex]"))) apagar("exames", el.dataset.apagarEx, "Apagar este exame?", desenharSaude);
      if ((el = ev.target.closest("[data-apagar-ep]"))) apagar("entregas", el.dataset.apagarEp, "Apagar esta entrega?", desenharSaude);
      if ((el = ev.target.closest("[data-apagar-tr]"))) apagar("treinamentos", el.dataset.apagarTr, "Apagar este treinamento?", desenharSaude);
      if ((el = ev.target.closest("[data-devolver]"))) {
        u.db.salvarRH("entregas", { devolvido_em: hoje() }, el.dataset.devolver).then(function () { u.toast("Devolução registrada."); return recarregar(desenharSaude); }, u.mostrarErro);
      }
      if ((el = ev.target.closest("[data-ficha-epi]"))) {
        var f = b.funcionario(el.dataset.fichaEpi);
        if (f) u.pdfTexto(RF.textoFichaEPI(b.empresa(), f, d.entregas), "ficha_epi_" + nome1(f).toLowerCase() + ".pdf");
      }
    });
  }

  window.RHGestao = { iniciar: iniciar, mostrar: mostrar };
})();
