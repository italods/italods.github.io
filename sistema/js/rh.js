/*
 * RH: escala rotativa, dia de cada funcionário, resumo do mês para o contador. Funções puras (navegador e Node).
 * Datas "AAAA-MM-DD", horas "HH:MM". Dias da semana: 0 = domingo (loja fechada) ... 6 = sábado.
 *
 * Escala: cada turma tem uma ordem (0, 1, ...) e cada horário também. Na semana de referência
 * (segunda-feira guardada em configuracoes.rh_semana_ref) a turma de ordem 0 faz o horário de ordem 0,
 * a de ordem 1 o de ordem 1... A cada semana elas avançam um horário (com 2: trocam manhã/tarde).
 */
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica(require("./feriados.js"));
  else raiz.RH = fabrica(raiz.Feriados);
})(typeof self !== "undefined" ? self : this, function (FE) {
  "use strict";

  var DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  var DIAS_CURTOS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  var MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro",
    "outubro", "novembro", "dezembro"];
  // ponto facultativo: no comércio é dia normal (só aparece marcado)
  var FACULTATIVOS = /Carnaval|Corpus Christi/;

  function data(t) { var p = String(t).split("-"); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function diaDaSemana(t) { return data(t).getUTCDay(); }
  function segundaDaSemana(t) {
    var d = data(t), w = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() - (w === 0 ? 6 : w - 1));
    return iso(d);
  }
  function semanasEntre(ref, t) {
    return Math.round((data(segundaDaSemana(t)) - data(segundaDaSemana(ref))) / (7 * 864e5));
  }
  function diasDoMes(ano, mes) {
    var n = new Date(Date.UTC(ano, mes, 0)).getUTCDate(), r = [];
    for (var i = 1; i <= n; i++) r.push(ano + "-" + (mes < 10 ? "0" : "") + mes + "-" + (i < 10 ? "0" : "") + i);
    return r;
  }
  function dataBR(t) { var p = String(t || "").split("-"); return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : ""; }

  // "7:00" / "07:00" / "700" -> "07:00" ; inválido -> null
  function lerHora(t) {
    var s = String(t == null ? "" : t).trim().replace(/h$/i, "");
    var m = /^(\d{1,2})(?::?(\d{2}))?$/.exec(s);
    if (!m) return null;
    var h = +m[1], mi = m[2] == null ? 0 : +m[2];
    if (h > 23 || mi > 59) return null;
    return (h < 10 ? "0" : "") + h + ":" + (mi < 10 ? "0" : "") + mi;
  }
  function minutos(h) { var p = String(h).split(":"); return +p[0] * 60 + +p[1]; }
  // Horas de um dia de trabalho ("07:00"–"13:00" -> 360 min); saída antes da entrada = passa da meia-noite
  function duracao(entrada, saida) {
    var d = minutos(saida) - minutos(entrada);
    return d <= 0 ? d + 1440 : d;
  }

  // Horário de uma turma numa data (pela rotação semanal). null = sem turma ou sem horários.
  function horarioDaTurma(turmas, horarios, ref, turmaId, t) {
    var ts = (turmas || []).slice().sort(porOrdem), hs = (horarios || []).slice().sort(porOrdem);
    var i = ts.map(function (x) { return x.id; }).indexOf(turmaId);
    if (i < 0 || !hs.length) return null;
    var k = ((i + semanasEntre(ref || t, t)) % hs.length + hs.length) % hs.length;
    return hs[k];
  }
  function porOrdem(a, b) { return (+a.ordem || 0) - (+b.ordem || 0) || String(a.nome).localeCompare(String(b.nome)); }

  // Feriado da data: { nome, facultativo } ou null. locais: [{ data, nome }]
  function feriadoDoDia(t, locais) {
    var local = (locais || []).filter(function (f) { return f.data === t; })[0];
    if (local) return { nome: local.nome, facultativo: false, local: true };
    var n = FE.nacionais(+String(t).slice(0, 4))[t];
    return n ? { nome: n, facultativo: FACULTATIVOS.test(n) } : null;
  }

  function atestadoCobre(o, t) {
    if (o.tipo !== "atestado") return false;
    var fim = FE.somarDias(o.data, Math.max(1, +o.dias || 1) - 1);
    return o.data <= t && t <= fim;
  }

  /*
   * O dia de um funcionário. ctx = { turmas, horarios, ref, ocorrencias, feriados }.
   * tipo: fora (antes da admissão / depois do desligamento), domingo, atestado, falta, folga,
   * feriado, trabalho, folga_escala (dia sem horário na escala), sem_escala (sem turma).
   */
  function diaDoFuncionario(ctx, f, t) {
    var r = { data: t, semana: diaDaSemana(t), tipo: "", feriado: feriadoDoDia(t, ctx.feriados), ocorrencia: null };
    if ((f.admissao && t < f.admissao) || (f.desligamento && t > f.desligamento)) { r.tipo = "fora"; return r; }
    if (r.semana === 0) { r.tipo = "domingo"; return r; }
    var ocs = (ctx.ocorrencias || []).filter(function (o) { return o.funcionario === f.id; });
    var at = ocs.filter(function (o) { return atestadoCobre(o, t); })[0];
    if (at) { r.tipo = "atestado"; r.ocorrencia = at; return r; }
    var doDia = ocs.filter(function (o) { return o.data === t; });
    var falta = doDia.filter(function (o) { return o.tipo === "falta"; })[0];
    if (falta) { r.tipo = "falta"; r.ocorrencia = falta; return r; }
    var folga = doDia.filter(function (o) { return o.tipo === "folga"; })[0];
    if (folga) { r.tipo = "folga"; r.ocorrencia = folga; return r; }
    var trabalhou = doDia.filter(function (o) { return o.tipo === "feriado_trabalhado"; })[0];
    if (r.feriado && !r.feriado.facultativo && !trabalhou) { r.tipo = "feriado"; return r; }
    if (trabalhou) r.ocorrencia = trabalhou;
    var h = horarioDaTurma(ctx.turmas, ctx.horarios, ctx.ref, f.turma, t);
    if (!h) { r.tipo = "sem_escala"; return r; }
    r.horario = h;
    var d = h.dias && h.dias[String(r.semana)];
    if (!d || !d.entrada || !d.saida) { r.tipo = "folga_escala"; return r; }
    r.tipo = "trabalho";
    r.entrada = d.entrada;
    r.saida = d.saida;
    return r;
  }

  function mesDoFuncionario(ctx, f, ano, mes) {
    return diasDoMes(ano, mes).map(function (t) { return diaDoFuncionario(ctx, f, t); });
  }

  // Resumo do mês de um funcionário (para o contador)
  function resumoFuncionario(ctx, f, ano, mes, holerites) {
    var dias = mesDoFuncionario(ctx, f, ano, mes);
    var r = { funcionario: f, trabalhados: 0, minutos: 0, folgas: [], faltas: [], atestados: [], diasAtestado: 0,
      feriadosTrabalhados: [], holerite: null };
    var atVistos = {};
    dias.forEach(function (d) {
      if (d.tipo === "trabalho") {
        r.trabalhados++;
        r.minutos += duracao(d.entrada, d.saida);
        if (d.ocorrencia && d.ocorrencia.tipo === "feriado_trabalhado") r.feriadosTrabalhados.push({ data: d.data, nome: d.feriado ? d.feriado.nome : "" });
      }
      if (d.tipo === "folga") r.folgas.push(d.ocorrencia);
      if (d.tipo === "falta") r.faltas.push(d.ocorrencia);
    });
    // atestado: dias corridos dentro do mês (domingo também conta)
    var ini = dias[0].data, fim = dias[dias.length - 1].data;
    (ctx.ocorrencias || []).forEach(function (o) {
      if (o.funcionario !== f.id || o.tipo !== "atestado" || atVistos[o.id]) return;
      var n = 0;
      for (var i = 0; i < Math.max(1, +o.dias || 1); i++) {
        var t = FE.somarDias(o.data, i);
        if (t >= ini && t <= fim) n++;
      }
      if (n) { atVistos[o.id] = true; r.atestados.push(o); r.diasAtestado += n; }
    });
    r.atestados.sort(function (a, b) { return a.data < b.data ? -1 : 1; });
    // feriado marcado como trabalhado sem escala naquele dia (ex.: sem turma) também conta
    (ctx.ocorrencias || []).forEach(function (o) {
      if (o.funcionario === f.id && o.tipo === "feriado_trabalhado" && o.data.slice(0, 7) === dias[0].data.slice(0, 7) &&
          !r.feriadosTrabalhados.some(function (x) { return x.data === o.data; })) {
        var fe = feriadoDoDia(o.data, ctx.feriados);
        r.feriadosTrabalhados.push({ data: o.data, nome: fe ? fe.nome : "" });
      }
    });
    r.feriadosTrabalhados.sort(function (a, b) { return a.data < b.data ? -1 : 1; });
    r.faltasJustificadas = r.faltas.filter(function (o) { return o.justificada; }).length;
    r.faltasSemJustificativa = r.faltas.length - r.faltasJustificadas;
    var ref = ano + "-" + (mes < 10 ? "0" : "") + mes + "-01";
    r.holerite = (holerites || []).filter(function (h) { return h.funcionario === f.id && h.referencia === ref; })[0] || null;
    return r;
  }

  // Funcionários que estiveram ativos em algum dia do mês
  function ativosNoMes(funcionarios, ano, mes) {
    var dias = diasDoMes(ano, mes), ini = dias[0], fim = dias[dias.length - 1];
    return (funcionarios || []).filter(function (f) {
      return (!f.admissao || f.admissao <= fim) && (!f.desligamento || f.desligamento >= ini);
    }).sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome), "pt-BR"); });
  }

  function rotuloMes(ano, mes) { return MESES[mes - 1] + " de " + ano; }
  function horas(min) { var h = Math.floor(min / 60), m = min % 60; return h + "h" + (m ? (m < 10 ? "0" : "") + m : ""); }
  function diaMes(t) { return String(t).slice(8, 10) + "/" + String(t).slice(5, 7); }

  // Texto para o WhatsApp do contador
  function textoResumo(resumos, ano, mes) {
    var l = ["*Supermercado Veneza — RH de " + rotuloMes(ano, mes) + "*"];
    if (!resumos.length) { l.push("", "Nenhum funcionário ativo no mês."); return l.join("\n"); }
    resumos.forEach(function (r) {
      var f = r.funcionario;
      l.push("", "*" + f.nome + "*" + (f.funcao ? " (" + f.funcao + ")" : ""));
      if (f.desligamento && f.desligamento.slice(0, 7) === (ano + "-" + (mes < 10 ? "0" : "") + mes)) l.push("Desligado em " + dataBR(f.desligamento));
      if (f.admissao && f.admissao.slice(0, 7) === (ano + "-" + (mes < 10 ? "0" : "") + mes)) l.push("Admitido em " + dataBR(f.admissao));
      l.push("Faltas: " + (r.faltas.length ? r.faltas.length + " (" + r.faltas.map(function (o) {
        return diaMes(o.data) + (o.justificada ? " justificada" : " sem justificativa");
      }).join(", ") + ")" : "nenhuma"));
      l.push("Atestados: " + (r.atestados.length ? r.diasAtestado + (r.diasAtestado === 1 ? " dia" : " dias") + " (" + r.atestados.map(function (o) {
        return "a partir de " + diaMes(o.data) + ", " + o.dias + (+o.dias === 1 ? " dia" : " dias");
      }).join("; ") + ")" : "nenhum"));
      l.push("Folgas: " + (r.folgas.length ? r.folgas.length + " (" + r.folgas.map(function (o) { return diaMes(o.data); }).join(", ") + ")" : "nenhuma"));
      l.push("Feriados trabalhados: " + (r.feriadosTrabalhados.length ? r.feriadosTrabalhados.map(function (x) {
        return diaMes(x.data) + (x.nome ? " " + x.nome : "");
      }).join(", ") : "nenhum"));
    });
    return l.join("\n");
  }

  // Equipe num dia: quem está na escala, quem faltou, atestado, folga (para a Visão geral)
  function equipeDoDia(ctx, funcionarios, t) {
    var r = { trabalhando: [], faltas: [], atestados: [], folgas: [], semEscala: [] };
    (funcionarios || []).forEach(function (f) {
      var d = diaDoFuncionario(ctx, f, t);
      var x = { nome: f.nome, id: f.id, entrada: d.entrada, saida: d.saida, ocorrencia: d.ocorrencia };
      if (d.tipo === "trabalho") r.trabalhando.push(x);
      else if (d.tipo === "falta") r.faltas.push(x);
      else if (d.tipo === "atestado") r.atestados.push(x);
      else if (d.tipo === "folga") r.folgas.push(x);
      else if (d.tipo === "sem_escala") r.semEscala.push(x);
    });
    return r;
  }

  return {
    DIAS: DIAS, DIAS_CURTOS: DIAS_CURTOS, MESES: MESES,
    diaDaSemana: diaDaSemana, segundaDaSemana: segundaDaSemana, semanasEntre: semanasEntre, diasDoMes: diasDoMes,
    lerHora: lerHora, duracao: duracao, horarioDaTurma: horarioDaTurma, feriadoDoDia: feriadoDoDia,
    diaDoFuncionario: diaDoFuncionario, mesDoFuncionario: mesDoFuncionario, resumoFuncionario: resumoFuncionario,
    ativosNoMes: ativosNoMes, equipeDoDia: equipeDoDia, textoResumo: textoResumo, rotuloMes: rotuloMes, horas: horas, dataBR: dataBR
  };
});
