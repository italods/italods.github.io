/*
 * RH: férias, banco de horas, custo da equipe e reserva (13º, férias, FGTS), estimativa de rescisão,
 * passo a passo do desligamento, textos de advertência/suspensão e avisos para a Visão geral.
 * Funções puras (navegador e Node). Dinheiro SEMPRE em centavos inteiros. Percentuais em centésimos (8% = 800).
 * Datas "AAAA-MM-DD". Tudo é ESTIMATIVA para planejar: o cálculo oficial (folha, TRCT, INSS, IR) é do contador.
 *
 * Regras usadas (CLT):
 *  - Férias: período aquisitivo de 12 meses a partir da admissão; gozo nos 12 meses seguintes (concessivo, art. 134);
 *    dias pelo nº de faltas sem justificativa no aquisitivo (art. 130); até 3 períodos, um com 14 dias ou mais e os
 *    outros com 5 ou mais (art. 134 §1); não começar nos 2 dias antes de domingo ou feriado (art. 134 §3); pagar até
 *    2 dias antes (art. 145); dias depois do fim do concessivo são pagos em dobro (art. 137); 1/3 a mais.
 *  - 13º: 1/12 por mês com 15 dias ou mais de trabalho; 1ª parcela até 30/11, 2ª até 20/12.
 *  - Banco de horas por acordo individual escrito: compensar em até 6 meses (art. 59 §5).
 *  - Aviso prévio: 30 dias + 3 por ano completo, até 90 (Lei 12.506/2011). Rescisão paga em até 10 dias (art. 477 §6).
 *  - Acordo (art. 484-A): metade do aviso indenizado e multa de 20% do FGTS.
 */
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica(require("./feriados.js"), require("./rh.js"));
  else raiz.RHFolha = fabrica(raiz.Feriados, raiz.RH);
})(typeof self !== "undefined" ? self : this, function (FE, RH) {
  "use strict";

  var PASSOS_DESLIGAMENTO = [
    { id: "comunicar", texto: "Comunicar por escrito (aviso prévio assinado ou pedido de demissão do funcionário)" },
    { id: "contador", texto: "Avisar o contador: data, tipo de desligamento e aviso prévio" },
    { id: "exame", texto: "Exame demissional (ASO): pode ser dispensado se o último exame tiver menos de 135 dias" },
    { id: "devolucao", texto: "Receber de volta uniforme, EPI, chaves e crachá" },
    { id: "pagar", texto: "Pagar a rescisão em até 10 dias depois do último dia" },
    { id: "trct", texto: "Assinar o termo de rescisão (TRCT) com o funcionário" },
    { id: "guias", texto: "Entregar as guias do FGTS e do seguro-desemprego (quando tiver direito)" },
    { id: "acessos", texto: "Tirar o acesso: cadastro de operador no Diamante, grupos e senhas" }
  ];
  var TIPOS_DESLIGAMENTO = { sem_justa_causa: "Dispensa sem justa causa", pedido: "Pedido de demissão",
    justa_causa: "Dispensa por justa causa", acordo: "Acordo (art. 484-A)" };
  var TIPOS_EXAME = { admissional: "Admissional", periodico: "Periódico", retorno: "Retorno ao trabalho",
    mudanca: "Mudança de função", demissional: "Demissional" };

  /* ------------------------------ básicos ------------------------------ */

  function pct(valor, centesimos) { return Math.round(valor * centesimos / 10000); }
  function data(t) { var p = String(t).split("-"); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function somarDias(t, n) { return FE.somarDias(t, n); }
  function diasEntre(a, b) { return Math.round((data(b) - data(a)) / 864e5); }
  function fimDoMes(ano, mes) { return new Date(Date.UTC(ano, mes, 0)).getUTCDate(); }
  // soma meses mantendo o dia (31/01 + 1 mês = 28/02)
  function somarMeses(t, n) {
    var p = String(t).split("-"), ano = +p[0], mes = +p[1] - 1 + n, dia = +p[2];
    ano += Math.floor(mes / 12); mes = ((mes % 12) + 12) % 12;
    return iso(new Date(Date.UTC(ano, mes, Math.min(dia, fimDoMes(ano, mes + 1)))));
  }
  function mesTexto(ano, mes) { return ano + "-" + (mes < 10 ? "0" : "") + mes; }
  function menor(a, b) { return a < b ? a : b; }
  function maior(a, b) { return a > b ? a : b; }
  function dataBR(t) { return RH.dataBR(t); }

  // CPF com dígitos verificadores ("529.982.247-25" ou só números). "" = não preenchido (vale).
  function soNumeros(s) { return String(s == null ? "" : s).replace(/\D/g, ""); }
  function cpfValido(s) {
    var c = soNumeros(s);
    if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
    for (var k = 9; k <= 10; k++) {
      var soma = 0;
      for (var i = 0; i < k; i++) soma += +c[i] * (k + 1 - i);
      var dv = (soma * 10) % 11 % 10;
      if (dv !== +c[k]) return false;
    }
    return true;
  }
  function formatarCPF(s) { var c = soNumeros(s); return c.length === 11 ? c.slice(0, 3) + "." + c.slice(3, 6) + "." + c.slice(6, 9) + "-" + c.slice(9) : c; }

  // Configuração dos encargos (configuracoes.rh_encargos, JSON)
  function lerEncargos(texto) {
    var c = {};
    try { c = JSON.parse(texto || "{}") || {}; } catch (e) { c = {}; }
    return {
      regime: c.regime === "normal" ? "normal" : "simples",
      inss: Math.max(0, Math.min(5000, parseInt(c.inss, 10) || 2780)),   // 20% + RAT 2% + terceiros 5,8%
      multa: c.multa !== false,                                         // guardar para a multa de 40% do FGTS
      gratificacaoIntegra: c.gratificacaoIntegra !== false
    };
  }

  // Remuneração do mês (base de 13º, férias, FGTS e rescisão)
  function remuneracao(f, cfg) {
    var s = +f.salario_centavos || 0, g = +f.gratificacao_centavos || 0;
    return s + (!cfg || cfg.gratificacaoIntegra !== false ? g : 0);
  }
  function custoBruto(f) { return (+f.salario_centavos || 0) + (+f.gratificacao_centavos || 0); }

  // Dia em que a pessoa deixa de trabalhar (ou null se ativa)
  function ativoEm(f, t) { return (!f.admissao || f.admissao <= t) && (!f.desligamento || f.desligamento >= t); }

  // dias de trabalho no mês (contrato), de 0 ao total do mês
  function diasNoMes(f, ano, mes, ate) {
    var ini = mesTexto(ano, mes) + "-01", fim = mesTexto(ano, mes) + "-" + String(fimDoMes(ano, mes)).padStart(2, "0");
    var a = maior(ini, f.admissao || ini), b = menor(fim, ate || f.desligamento || fim);
    if (f.desligamento) b = menor(b, f.desligamento);
    return b < a ? 0 : diasEntre(a, b) + 1;
  }
  // avos do 13º no ano: meses com 15 dias ou mais de contrato (até a data "ate", se dada)
  function avos13(f, ano, ate) {
    var n = 0;
    for (var m = 1; m <= 12; m++) if (diasNoMes(f, ano, m, ate) >= 15) n++;
    return n;
  }

  /* ------------------------------ férias ------------------------------ */

  // dias de férias pelo nº de faltas sem justificativa (art. 130)
  function diasPorFaltas(n) { return n <= 5 ? 30 : n <= 14 ? 24 : n <= 23 ? 18 : n <= 32 ? 12 : 0; }

  function faltasSemJustificativa(ocorrencias, fid, de, ate) {
    return (ocorrencias || []).filter(function (o) {
      return o.funcionario === fid && o.tipo === "falta" && !o.justificada && o.data >= de && o.data <= ate;
    }).length;
  }

  /*
   * Períodos aquisitivos de um funcionário até hoje (e o que está correndo).
   * Cada um: { inicio, fim, concessivoFim, completo, faltas, direito, gozados, programados, saldo, periodos,
   *            limiteInicio, situacao: em_aquisicao | ok | a_programar | vencendo | vencida, emDobro }
   * "programados" = dias em períodos que começam depois de hoje (já contam no saldo).
   */
  function periodosAquisitivos(f, ferias, ocorrencias, hoje) {
    if (!f.admissao) return [];
    var r = [], fimContrato = f.desligamento || null;
    for (var k = 0; k < 60; k++) {
      var ini = somarMeses(f.admissao, 12 * k);
      if (ini > hoje || (fimContrato && ini > fimContrato)) break;
      var fim = somarDias(somarMeses(f.admissao, 12 * (k + 1)), -1);
      var concFim = somarDias(somarMeses(f.admissao, 12 * (k + 2)), -1);
      var completo = fim < hoje && (!fimContrato || fim <= fimContrato);
      var faltas = faltasSemJustificativa(ocorrencias, f.id, ini, menor(fim, hoje));
      var direito = diasPorFaltas(faltas);
      var ps = (ferias || []).filter(function (p) { return p.funcionario === f.id && p.aquisitivo_inicio === ini; })
        .sort(function (a, b) { return a.inicio < b.inicio ? -1 : 1; });
      var usados = ps.reduce(function (s, p) { return s + (+p.dias || 0); }, 0);
      var programados = ps.filter(function (p) { return p.inicio > hoje; }).reduce(function (s, p) { return s + (+p.dias || 0); }, 0);
      var saldo = Math.max(0, direito - usados);
      var limiteInicio = somarDias(concFim, -Math.max(saldo, 1) + 1);
      // dias gozados depois do fim do concessivo (em dobro)
      var emDobro = ps.reduce(function (s, p) {
        var ultimo = somarDias(p.inicio, (+p.dias || 1) - 1);
        return s + (ultimo > concFim ? diasEntre(maior(p.inicio, somarDias(concFim, 1)), ultimo) + 1 : 0);
      }, 0);
      var sit;
      if (!completo) sit = "em_aquisicao";
      else if (saldo === 0) sit = "ok";
      else if (hoje > limiteInicio) sit = "vencida";
      else if (diasEntre(hoje, limiteInicio) <= 60) sit = "vencendo";
      else sit = "a_programar";
      r.push({ inicio: ini, fim: fim, concessivoFim: concFim, completo: completo, faltas: faltas, direito: direito,
        gozados: usados - programados, programados: programados, saldo: saldo, periodos: ps, limiteInicio: limiteInicio,
        situacao: sit, emDobro: emDobro });
    }
    return r;
  }

  // Avos de férias de um período que está correndo, até "ate" (mês fechado ou fração de 15 dias ou mais)
  function avosFerias(inicioAquisitivo, ate) {
    if (ate < inicioAquisitivo) return 0;
    var n = 0;
    while (n < 12 && somarDias(somarMeses(inicioAquisitivo, n + 1), -1) <= ate) n++;
    if (n < 12) {
      var sobra = diasEntre(somarMeses(inicioAquisitivo, n), ate) + 1;
      if (sobra >= 15) n++;
    }
    return Math.min(n, 12);
  }

  // Valor das férias: (remuneração / 30 × dias) + 1/3
  function valorFerias(R, dias) {
    var base = Math.round(R * dias / 30);
    return { base: base, terco: Math.round(base / 3), total: base + Math.round(base / 3) };
  }

  /*
   * Confere um período de férias antes de salvar.
   * p = { funcionario, aquisitivo_inicio, inicio, dias, id? }; ctx = { funcionarios, ferias, ocorrencias, feriados, hoje }
   * -> { erros: [], avisos: [], fim, pagarAte, retorno }
   */
  function conferirFerias(p, ctx) {
    var erros = [], avisos = [];
    var f = (ctx.funcionarios || []).filter(function (x) { return x.id === p.funcionario; })[0];
    var dias = +p.dias || 0;
    var fim = p.inicio ? somarDias(p.inicio, Math.max(dias, 1) - 1) : "";
    var r = { erros: erros, avisos: avisos, fim: fim, pagarAte: p.inicio ? somarDias(p.inicio, -2) : "", retorno: fim ? somarDias(fim, 1) : "" };
    if (!f) { erros.push("Escolha o funcionário."); return r; }
    if (!f.admissao) { erros.push("Preencha a data de admissão na ficha de " + f.nome + "."); return r; }
    if (!p.inicio) { erros.push("Preencha o primeiro dia das férias."); return r; }
    if (!(dias >= 5 && dias <= 30)) erros.push("Cada período de férias tem de 5 a 30 dias.");
    var outros = (ctx.ferias || []).filter(function (x) { return x.id !== p.id; });
    var aqs = periodosAquisitivos(f, outros, ctx.ocorrencias, maior(ctx.hoje, p.inicio));
    var aq = aqs.filter(function (a) { return a.inicio === p.aquisitivo_inicio; })[0];
    if (!aq) { erros.push("Período aquisitivo inválido."); return r; }
    if (p.inicio <= aq.fim) erros.push("Só pode tirar estas férias depois de completar o período aquisitivo (a partir de " + dataBR(somarDias(aq.fim, 1)) + ").");
    if (aq.direito === 0) erros.push("Com " + aq.faltas + " faltas sem justificativa nesse período, não há direito a férias (art. 130).");
    if (dias > aq.saldo && aq.direito > 0) erros.push("Restam só " + aq.saldo + " dias de férias desse período (direito: " + aq.direito + " dias).");
    var ps = aq.periodos.map(function (x) { return +x.dias; }).concat([dias]);
    if (ps.length > 3) erros.push("As férias podem ser divididas em no máximo 3 períodos.");
    var restante = aq.saldo - dias;
    if (restante > 0 && restante < 5) erros.push("Sobrariam " + restante + " dias: cada período precisa de pelo menos 5 dias.");
    if (ps.length >= 3 && restante > 0) erros.push("Esse seria o 3º período e ainda sobrariam " + restante + " dias.");
    if (ps.length > 1 && Math.max.apply(null, ps) < 14 && restante < 14) erros.push("Quando divide, um dos períodos precisa ter 14 dias ou mais.");
    // cruza com outro período do mesmo funcionário
    outros.forEach(function (x) {
      if (x.funcionario !== f.id) return;
      var xf = somarDias(x.inicio, (+x.dias || 1) - 1);
      if (x.inicio <= fim && p.inicio <= xf) erros.push("Cruza com as férias de " + dataBR(x.inicio) + " a " + dataBR(xf) + ".");
    });
    // avisos
    var feriados = ctx.feriados || [];
    for (var i = 1; i <= 2; i++) {
      var t = somarDias(p.inicio, i), fe = RH.feriadoDoDia(t, feriados);
      if (RH.diaDaSemana(t) === 0 || (fe && !fe.facultativo)) {
        avisos.push("Pela CLT as férias não podem começar nos 2 dias antes de domingo ou feriado. Prefira começar de segunda a quinta.");
        break;
      }
    }
    if (fim > aq.concessivoFim) {
      var dobro = diasEntre(maior(p.inicio, somarDias(aq.concessivoFim, 1)), fim) + 1;
      avisos.push("Passa do prazo (" + dataBR(aq.concessivoFim) + "): " + dobro + (dobro === 1 ? " dia é pago" : " dias são pagos") + " em dobro.");
    }
    if (p.inicio >= ctx.hoje && diasEntre(ctx.hoje, p.inicio) < 30) avisos.push("O aviso de férias deve ser dado por escrito 30 dias antes.");
    (ctx.funcionarios || []).forEach(function (o) {
      if (o.id === f.id) return;
      outros.forEach(function (x) {
        if (x.funcionario !== o.id) return;
        var xf = somarDias(x.inicio, (+x.dias || 1) - 1);
        if (x.inicio <= fim && p.inicio <= xf) avisos.push(o.nome + " também está de férias de " + dataBR(x.inicio) + " a " + dataBR(xf) + ".");
      });
    });
    return r;
  }

  /* --------------------------- banco de horas --------------------------- */

  // minutos que a pessoa trabalharia no dia pela escala (sem contar a ocorrência); sem escala: jornada / 6
  function minutosPrevistos(ctx, f, t) {
    var d = RH.escalaDoDia(ctx, f, t);
    if (d) return RH.minutosDoDia(d);
    if (RH.horarioDaTurma(ctx.turmas, ctx.horarios, ctx.ref, f.turma, t) || RH.sabadoDoFuncionario(ctx, f, t)) return 0;
    return Math.round((+f.jornada_semanal_min || 2640) / 6);
  }

  /*
   * Extrato do banco de horas de um funcionário: lançamentos à mão (ctx.banco), folgas marcadas "do banco"
   * (débito das horas do dia) e feriados trabalhados marcados "para o banco" (crédito).
   * -> [{ data, minutos, motivo, origem: manual|folga|feriado, id }] em ordem de data
   */
  function extratoBanco(ctx, f) {
    var l = [];
    (ctx.banco || []).forEach(function (b) {
      if (b.funcionario === f.id) l.push({ data: b.data, minutos: +b.minutos, motivo: b.motivo || "", origem: "manual", id: b.id });
    });
    // semanas da escala (horas da escala − jornada), lançadas no sábado de cada semana já passada
    if (ctx.bancoEscalaInicio) {
      RH.bancoDaEscala(ctx, f, ctx.bancoEscalaInicio, ctx.hoje || ctx.bancoEscalaInicio).forEach(function (w) {
        if (w.saldo && w.sabado <= (ctx.hoje || w.sabado)) {
          l.push({ data: w.sabado, minutos: w.saldo, origem: "escala", id: "escala-" + w.segunda,
            motivo: "Escala da semana " + dataBR(w.segunda).slice(0, 5) + " a " + dataBR(w.sabado).slice(0, 5) + " (" + RH.horas(w.minutos) + ")" });
        }
      });
    }
    (ctx.ocorrencias || []).forEach(function (o) {
      if (o.funcionario !== f.id || !o.banco) return;
      var m = minutosPrevistos(ctx, f, o.data);
      if (o.tipo === "folga") l.push({ data: o.data, minutos: -(m || Math.round((+f.jornada_semanal_min || 2640) / 6)), motivo: o.motivo || "Folga do banco de horas", origem: "folga", id: o.id });
      if (o.tipo === "feriado_trabalhado") {
        var fe = RH.feriadoDoDia(o.data, ctx.feriados);
        l.push({ data: o.data, minutos: m || Math.round((+f.jornada_semanal_min || 2640) / 6), motivo: "Feriado trabalhado" + (fe ? " (" + fe.nome + ")" : ""), origem: "feriado", id: o.id });
      }
    });
    return l.sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : b.minutos - a.minutos; });
  }

  /*
   * Saldo e horas que estão para vencer (crédito mais antigo é usado primeiro; prazo de 6 meses).
   * -> { saldo, creditos, debitos, abertos: [{ data, minutos, vence }], vencidas, vencendo (próximos 30 dias), valorHora, valorExtra }
   */
  function saldoBanco(ctx, f, hoje, cfg) {
    var ex = extratoBanco(ctx, f).filter(function (x) { return x.data <= hoje; });
    var cred = [], deb = 0, tc = 0, td = 0;
    ex.forEach(function (x) {
      if (x.minutos > 0) { cred.push({ data: x.data, minutos: x.minutos }); tc += x.minutos; }
      else td -= x.minutos;
    });
    deb = td;
    cred.forEach(function (c) { var u = Math.min(c.minutos, deb); c.minutos -= u; deb -= u; });
    var abertos = cred.filter(function (c) { return c.minutos > 0; }).map(function (c) { return { data: c.data, minutos: c.minutos, vence: somarMeses(c.data, 6) }; });
    var vencidas = abertos.filter(function (c) { return c.vence <= hoje; }).reduce(function (s, c) { return s + c.minutos; }, 0);
    var vencendo = abertos.filter(function (c) { return c.vence > hoje && diasEntre(hoje, c.vence) <= 30; }).reduce(function (s, c) { return s + c.minutos; }, 0);
    var divisor = Math.round((+f.jornada_semanal_min || 2640) * 5 / 60);   // 44h -> 220
    var valorHora = divisor ? Math.round(remuneracao(f, cfg) / divisor) : 0;
    var saldo = tc - td;
    return { saldo: saldo, creditos: tc, debitos: td, abertos: abertos, vencidas: vencidas, vencendo: vencendo,
      proximoVencimento: abertos.length ? abertos[0].vence : null, valorHora: valorHora,
      valorExtra: saldo > 0 ? Math.round(valorHora * 1.5 * saldo / 60) : 0 };
  }

  /* -------------------------- custo e reserva -------------------------- */

  /*
   * Custo de um funcionário num mês normal e quanto guardar por mês para 13º, férias e FGTS.
   * -> { salario, gratificacao, remuneracao, fgts, inss, decimo, ferias, fgtsReserva, inssReserva, multa, guardar, pagar, total }
   */
  function custoMensal(f, cfg) {
    cfg = cfg || lerEncargos("");
    var R = remuneracao(f, cfg), bruto = custoBruto(f);
    var normal = cfg.regime === "normal";
    var fgts = pct(R, 800), inss = normal ? pct(R, cfg.inss) : 0;
    var decimo = Math.round(R / 12), ferias = Math.round(R / 12) + Math.round(R / 36);
    var fgtsReserva = pct(decimo + ferias, 800), inssReserva = normal ? pct(decimo + ferias, cfg.inss) : 0;
    var multa = cfg.multa ? pct(fgts + fgtsReserva, 4000) : 0;
    var guardar = decimo + ferias + fgtsReserva + inssReserva + multa;
    var pagar = bruto + fgts + inss;
    return { salario: +f.salario_centavos || 0, gratificacao: +f.gratificacao_centavos || 0, remuneracao: R, fgts: fgts, inss: inss,
      decimo: decimo, ferias: ferias, fgtsReserva: fgtsReserva, inssReserva: inssReserva, multa: multa,
      guardar: guardar, pagar: pagar, total: pagar + guardar };
  }

  function somarCustos(lista) {
    var t = {};
    lista.forEach(function (c) { Object.keys(c).forEach(function (k) { t[k] = (t[k] || 0) + c[k]; }); });
    return t;
  }

  /*
   * Plano dos próximos meses: quanto guardar e quanto pagar em cada um.
   * ctx = { funcionarios, ferias, ocorrencias, cfg, hoje }; meses = quantidade (12)
   * -> [{ mes: "AAAA-MM", guardar, salarios, fgts, inss, decimo1, decimo2, fgtsDecimo, ferias: [{nome, inicio, dias, valor, pagarAte}],
   *       feriasTotal, pagar, extras: total do que não é todo mês }]
   */
  function planoMeses(ctx, meses) {
    var cfg = ctx.cfg || lerEncargos(""), r = [];
    var p = String(ctx.hoje).split("-"), ano = +p[0], mes = +p[1];
    for (var i = 0; i < (meses || 12); i++) {
      var a = ano + Math.floor((mes - 1 + i) / 12), m = ((mes - 1 + i) % 12) + 1, mt = mesTexto(a, m);
      var ini = mt + "-01", fim = mt + "-" + String(fimDoMes(a, m)).padStart(2, "0");
      var linha = { mes: mt, guardar: 0, salarios: 0, fgts: 0, inss: 0, decimo1: 0, decimo2: 0, fgtsDecimo: 0, ferias: [], feriasTotal: 0, pagar: 0, extras: 0 };
      (ctx.funcionarios || []).forEach(function (f) {
        if (!f.admissao || f.admissao > fim || (f.desligamento && f.desligamento < ini)) return;
        var c = custoMensal(f, cfg);
        linha.guardar += c.guardar;
        linha.salarios += custoBruto(f);
        linha.fgts += c.fgts;
        linha.inss += c.inss;
        var R = c.remuneracao;
        if (m === 11 || m === 12) {
          var total13 = Math.round(R * avos13(f, a) / 12), primeira = Math.round(total13 / 2);
          if (m === 11) linha.decimo1 += primeira;
          else {
            linha.decimo2 += total13 - primeira;
            linha.fgtsDecimo += pct(total13, 800) + (cfg.regime === "normal" ? pct(total13, cfg.inss) : 0);
          }
        }
        (ctx.ferias || []).forEach(function (x) {
          if (x.funcionario !== f.id) return;
          var pagarAte = somarDias(x.inicio, -2);
          if (pagarAte < ini || pagarAte > fim) return;
          var v = valorFerias(R, +x.dias).total;
          var enc = pct(v, 800) + (cfg.regime === "normal" ? pct(v, cfg.inss) : 0);
          linha.ferias.push({ nome: f.nome, inicio: x.inicio, dias: +x.dias, valor: v + enc, pagarAte: pagarAte });
          linha.feriasTotal += v + enc;
        });
      });
      linha.extras = linha.decimo1 + linha.decimo2 + linha.fgtsDecimo + linha.feriasTotal;
      linha.pagar = linha.salarios + linha.fgts + linha.inss + linha.extras;
      r.push(linha);
    }
    return r;
  }

  /*
   * Quanto a reserva já deveria ter hoje (13º do ano até agora + férias acumuladas + FGTS sobre eles).
   * -> { decimo, ferias, encargos, total, porFuncionario: [{ nome, decimo, ferias }] }
   */
  function reservaHoje(ctx) {
    var cfg = ctx.cfg || lerEncargos(""), hoje = ctx.hoje, ano = +hoje.slice(0, 4), mes = +hoje.slice(5, 7);
    var r = { decimo: 0, ferias: 0, encargos: 0, total: 0, porFuncionario: [] };
    (ctx.funcionarios || []).forEach(function (f) {
      if (!f.admissao || f.admissao > hoje || (f.desligamento && f.desligamento < hoje)) return;
      var R = remuneracao(f, cfg);
      // 13º: avos até o mês passado (fechados); 1ª parcela já paga sai da conta depois de 30/11, tudo depois de 20/12
      var ate = mes === 1 ? null : mesTexto(ano, mes - 1) + "-" + String(fimDoMes(ano, mes - 1)).padStart(2, "0");
      var dec = ate ? Math.round(R * avos13(f, ano, ate) / 12) : 0;
      var total13 = Math.round(R * avos13(f, ano) / 12);
      if (hoje > ano + "-11-30") dec -= Math.round(total13 / 2);
      if (hoje > ano + "-12-20") dec = 0;
      dec = Math.max(0, dec);
      // férias: saldo dos períodos completos + avos do período que corre
      var fer = 0;
      periodosAquisitivos(f, ctx.ferias, ctx.ocorrencias, hoje).forEach(function (aq) {
        if (aq.completo) fer += valorFerias(R, aq.saldo + aq.programados).total;
        else fer += valorFerias(R, Math.round(aq.direito * avosFerias(aq.inicio, hoje) / 12)).total;
      });
      var enc = pct(dec + fer, 800) + (cfg.regime === "normal" ? pct(dec + fer, cfg.inss) : 0);
      r.decimo += dec; r.ferias += fer; r.encargos += enc;
      r.porFuncionario.push({ id: f.id, nome: f.nome, decimo: dec, ferias: fer, encargos: enc });
    });
    r.total = r.decimo + r.ferias + r.encargos;
    return r;
  }

  /* ------------------------------ rescisão ------------------------------ */

  function diasAvisoPrevio(admissao, saida) {
    if (!admissao) return 30;
    var anos = 0;
    while (somarMeses(admissao, 12 * (anos + 1)) <= saida) anos++;
    return Math.min(90, 30 + 3 * anos);
  }

  /*
   * Estimativa da rescisão (valores brutos, antes de INSS e IR).
   * o = { saida: "AAAA-MM-DD" (último dia trabalhado), tipo: sem_justa_causa|pedido|justa_causa|acordo,
   *       aviso: indenizado|trabalhado|dispensado|nao_cumprido, fgtsSaldo (centavos, opcional), primeiraParcelaPaga? }
   * ctx = { ferias, ocorrencias, cfg }
   * -> { itens: [{ rotulo, valor, detalhe }], total, fgtsMes, multa, fgtsSaldo, fgtsEstimado, diasAviso, projecao, pagarAte, custoTotal, notas: [] }
   */
  function rescisao(f, o, ctx) {
    ctx = ctx || {};
    var cfg = ctx.cfg || lerEncargos("");
    var R = remuneracao(f, cfg), itens = [], notas = [];
    var saida = o.saida, tipo = o.tipo || "sem_justa_causa", aviso = o.aviso || "indenizado";
    var diasAviso = diasAvisoPrevio(f.admissao, saida);
    var justa = tipo === "justa_causa";
    // aviso
    var avisoDias = 0;
    if ((tipo === "sem_justa_causa" && aviso === "indenizado")) avisoDias = diasAviso;
    if (tipo === "acordo" && aviso === "indenizado") avisoDias = Math.floor(diasAviso / 2);
    var projecao = avisoDias ? somarDias(saida, avisoDias) : saida;
    // saldo de salário
    var dia = +saida.slice(8, 10), diasMes = Math.min(30, dia);
    if (dia === fimDoMes(+saida.slice(0, 4), +saida.slice(5, 7))) diasMes = 30;
    var adm = f.admissao && f.admissao.slice(0, 7) === saida.slice(0, 7) ? diasEntre(f.admissao, saida) + 1 : diasMes;
    var saldoSal = Math.round(R * Math.min(diasMes, adm) / 30);
    itens.push({ rotulo: "Saldo de salário", valor: saldoSal, detalhe: Math.min(diasMes, adm) + " dias de " + saida.slice(5, 7) + "/" + saida.slice(0, 4) });
    if (avisoDias) itens.push({ rotulo: "Aviso prévio indenizado", valor: Math.round(R * avisoDias / 30),
      detalhe: avisoDias + " dias" + (tipo === "acordo" ? " (metade de " + diasAviso + ", acordo)" : "") });
    if (tipo === "sem_justa_causa" && aviso === "trabalhado") notas.push("Aviso trabalhado: " + diasAviso + " dias (pode sair 2 horas mais cedo por dia ou faltar 7 dias corridos). O salário desses dias é pago normalmente.");
    if (tipo === "pedido" && aviso === "nao_cumprido") itens.push({ rotulo: "Desconto do aviso não cumprido", valor: -R, detalhe: "30 dias (o funcionário pediu e não cumpriu)" });
    // 13º proporcional
    var anoSaida = +saida.slice(0, 4), anoProj = +projecao.slice(0, 4);
    var fc = Object.assign({}, f, { desligamento: projecao });
    if (!justa) {
      for (var ano = anoSaida; ano <= anoProj; ano++) {
        var av = avos13(fc, ano), dec = Math.round(R * av / 12);
        if (av || ano === anoSaida) itens.push({ rotulo: "13º proporcional" + (anoProj > anoSaida ? " de " + ano : ""), valor: dec, detalhe: av + "/12 de " + ano });
      }
      // 1ª parcela: paga até 30/11 (quem ainda trabalhava nesse dia)
      var pagou = o.primeiraParcelaPaga != null ? !!o.primeiraParcelaPaga : saida >= anoSaida + "-11-30";
      var avAntes = avos13(Object.assign({}, f, { desligamento: null }), anoSaida);   // como no plano: metade do 13º do ano
      if (pagou && avAntes) itens.push({ rotulo: "1ª parcela do 13º já paga", valor: -Math.round(Math.round(R * avAntes / 12) / 2), detalhe: "desconta o adiantamento de novembro" });
    }
    // férias
    var aqs = periodosAquisitivos(fc, ctx.ferias, ctx.ocorrencias, projecao);
    aqs.forEach(function (aq) {
      if (aq.completo && aq.fim < projecao && aq.saldo > 0) {
        var v = valorFerias(R, aq.saldo), dobro = aq.concessivoFim < saida;
        itens.push({ rotulo: "Férias vencidas + 1/3" + (dobro ? " (em dobro)" : ""), valor: dobro ? 2 * v.total : v.total,
          detalhe: aq.saldo + " dias do período " + dataBR(aq.inicio) + " a " + dataBR(aq.fim) });
      } else if (!justa && !(aq.completo && aq.fim < projecao)) {
        var avf = avosFerias(aq.inicio, projecao);
        var dp = Math.round(aq.direito * avf / 12);
        if (dp > 0) {
          var vp = valorFerias(R, dp);
          itens.push({ rotulo: "Férias proporcionais + 1/3", valor: vp.total, detalhe: avf + "/12 (" + dp + " dias) desde " + dataBR(aq.inicio) });
        }
      }
    });
    var total = itens.reduce(function (s, x) { return s + x.valor; }, 0);
    // FGTS
    var baseFgts = itens.filter(function (x) { return /Saldo de salário|Aviso prévio|13º/.test(x.rotulo) && x.valor > 0; })
      .reduce(function (s, x) { return s + x.valor; }, 0);
    var fgtsMes = pct(baseFgts, 800);
    var fgtsEstimado = o.fgtsSaldo == null || o.fgtsSaldo === "";
    var meses = f.admissao ? Math.max(0, Math.round(diasEntre(f.admissao, saida) / 30.4375)) : 0;
    var fgtsSaldo = fgtsEstimado ? Math.round(pct(R, 800) * meses * (1 + 1 / 12 + 1 / 36)) : +o.fgtsSaldo;
    var pctMulta = tipo === "sem_justa_causa" ? 4000 : tipo === "acordo" ? 2000 : 0;
    var multa = pct(fgtsSaldo + fgtsMes, pctMulta);
    if (justa) notas.push("Justa causa: sem aviso, sem 13º proporcional, sem férias proporcionais e sem multa do FGTS. Guarde as provas (advertências, suspensões).");
    if (tipo === "pedido") notas.push("Pedido de demissão: sem multa do FGTS e sem seguro-desemprego. O funcionário não saca o FGTS.");
    if (tipo === "acordo") notas.push("Acordo: o funcionário saca 80% do FGTS e não recebe seguro-desemprego.");
    if (tipo === "sem_justa_causa") notas.push("O funcionário saca o FGTS e pode pedir o seguro-desemprego.");
    notas.push("Valores brutos, antes do INSS e do IR. O cálculo oficial (TRCT) é do contador.");
    if (fgtsEstimado) notas.push("Saldo do FGTS estimado (8% por mês desde a admissão). Para a multa certa, preencha o saldo do extrato do FGTS.");
    return { itens: itens, total: total, fgtsMes: fgtsMes, multa: multa, pctMulta: pctMulta, fgtsSaldo: fgtsSaldo, fgtsEstimado: fgtsEstimado,
      diasAviso: diasAviso, projecao: projecao, pagarAte: somarDias(saida, 10), custoTotal: total + fgtsMes + multa, notas: notas };
  }

  /* -------------------------- textos para imprimir -------------------------- */

  function dataExtenso(t) { var p = String(t).split("-"); return +p[2] + " de " + RH.MESES[+p[1] - 1] + " de " + p[0]; }

  /*
   * Texto da advertência ou suspensão para imprimir e assinar.
   * emp = { nome, cnpj, cidade }; o = ocorrência (tipo advertencia|suspensao, data, dias, motivo)
   */
  function textoMedida(emp, f, o) {
    var susp = o.tipo === "suspensao";
    var l = ["*" + (susp ? "SUSPENSÃO DISCIPLINAR" : "ADVERTÊNCIA DISCIPLINAR") + "*", ""];
    l.push(emp.nome + (emp.cnpj ? " — CNPJ " + emp.cnpj : ""));
    l.push((emp.cidade ? emp.cidade + ", " : "") + dataExtenso(o.data), "");
    l.push("Funcionário(a): " + f.nome + (f.funcao ? " — " + f.funcao : "") + (f.cpf ? " — CPF " + formatarCPF(f.cpf) : ""), "");
    if (susp) {
      var dias = +o.dias || 1, fim = somarDias(o.data, dias - 1);
      l.push("Pela presente, comunicamos que você está suspenso(a) por " + dias + (dias === 1 ? " dia" : " dias") +
        (dias === 1 ? ", em " + dataBR(o.data) : ", de " + dataBR(o.data) + " a " + dataBR(fim)) +
        ", sem remuneração, devendo retornar ao trabalho em " + dataBR(somarDias(fim, 1)) + ", pelo seguinte motivo:");
    } else {
      l.push("Pela presente, fica advertido(a) pelo seguinte motivo:");
    }
    l.push("", o.motivo ? o.motivo : "______________________________________________________________", "");
    l.push("Esclarecemos que a repetição de faltas como esta poderá levar a medidas mais severas, inclusive à dispensa por justa causa, nos termos do art. 482 da CLT.", "", "");
    l.push("______________________________________", emp.nome + " (empregador)", "", "");
    l.push("Ciente em ____/____/________", "", "______________________________________", f.nome + " (funcionário)", "", "");
    l.push("Se o funcionário se recusar a assinar, duas testemunhas assinam abaixo:", "");
    l.push("1. ___________________________________   2. ___________________________________");
    return l.join("\n");
  }

  // Aviso de férias (dar 30 dias antes, art. 135). p = { inicio, dias, aquisitivo_inicio }
  function textoAvisoFerias(emp, f, p, hoje) {
    var fim = somarDias(p.inicio, (+p.dias || 1) - 1), aqFim = somarDias(somarMeses(p.aquisitivo_inicio, 12), -1);
    var l = ["*AVISO DE FÉRIAS*", "", emp.nome + (emp.cnpj ? " — CNPJ " + emp.cnpj : ""), (emp.cidade ? emp.cidade + ", " : "") + dataExtenso(hoje), ""];
    l.push("Funcionário(a): " + f.nome + (f.funcao ? " — " + f.funcao : "") + (f.cpf ? " — CPF " + formatarCPF(f.cpf) : ""), "");
    l.push("Comunicamos que suas férias, referentes ao período aquisitivo de " + dataBR(p.aquisitivo_inicio) + " a " + dataBR(aqFim) +
      ", serão de " + p.dias + " dias, de " + dataBR(p.inicio) + " a " + dataBR(fim) + ", com retorno ao trabalho em " + dataBR(somarDias(fim, 1)) + ".");
    l.push("", "O pagamento das férias, com o adicional de 1/3, será feito até " + dataBR(somarDias(p.inicio, -2)) + ".", "", "");
    l.push("______________________________________", emp.nome + " (empregador)", "", "");
    l.push("Ciente em ____/____/________", "", "______________________________________", f.nome + " (funcionário)");
    return l.join("\n");
  }

  // Ficha de entrega de EPI e uniforme para assinar
  function textoFichaEPI(emp, f, entregas) {
    var l = ["*FICHA DE ENTREGA DE EPI E UNIFORME*", "", emp.nome + (emp.cnpj ? " — CNPJ " + emp.cnpj : ""),
      "Funcionário(a): " + f.nome + (f.funcao ? " — " + f.funcao : ""), ""];
    var es = (entregas || []).filter(function (e) { return e.funcionario === f.id; }).sort(function (a, b) { return a.data < b.data ? -1 : 1; });
    if (!es.length) l.push("Nenhuma entrega registrada.");
    es.forEach(function (e) {
      l.push(dataBR(e.data) + " — " + (+e.quantidade || 1) + " × " + e.item + (e.ca ? " (CA " + e.ca + ")" : "") +
        (e.devolvido_em ? " — devolvido em " + dataBR(e.devolvido_em) : "") + "   Assinatura: ____________________");
    });
    l.push("", "Declaro que recebi os itens acima, fui orientado(a) sobre o uso correto e me comprometo a usá-los e conservá-los (NR-6).", "", "");
    l.push("______________________________________", f.nome + " (funcionário)");
    return l.join("\n");
  }

  // "1:30", "1h30", "2h", "2", "1,5" -> minutos; inválido -> null
  function lerHoras(t) {
    var s = String(t == null ? "" : t).trim().toLowerCase().replace(/\s+/g, "");
    var m = /^(\d{1,3})(?:[:h](\d{1,2})?)?$/.exec(s);
    if (m) {
      var mi = m[2] == null ? 0 : +m[2];
      if (mi > 59) return null;
      return +m[1] * 60 + mi;
    }
    m = /^(\d{1,3})[,.](\d{1,2})$/.exec(s);
    if (m) return Math.round(parseFloat(m[1] + "." + m[2]) * 60);
    return null;
  }

  /* -------------------------------- avisos -------------------------------- */

  function aniversariantes(funcionarios, mes, hoje) {
    return (funcionarios || []).filter(function (f) {
      return f.nascimento && +f.nascimento.slice(5, 7) === mes && (!f.desligamento || f.desligamento >= hoje);
    }).map(function (f) { return { id: f.id, nome: f.nome, dia: +f.nascimento.slice(8, 10), hoje: f.nascimento.slice(5) === String(hoje).slice(5) }; })
      .sort(function (a, b) { return a.dia - b.dia; });
  }

  // Situação dos exames: último de cada um e validade. -> [{ funcionario, ultimo, vence, situacao: sem|vencido|vencendo|ok }]
  function situacaoExames(funcionarios, exames, hoje) {
    return (funcionarios || []).filter(function (f) { return ativoEm(f, hoje); }).map(function (f) {
      var es = (exames || []).filter(function (e) { return e.funcionario === f.id && e.tipo !== "demissional"; })
        .sort(function (a, b) { return a.data < b.data ? 1 : -1; });
      var u = es[0] || null;
      var vence = u ? (u.validade || somarMeses(u.data, 24)) : null;
      var sit = !u ? "sem" : vence < hoje ? "vencido" : diasEntre(hoje, vence) <= 30 ? "vencendo" : "ok";
      return { funcionario: f, ultimo: u, vence: vence, situacao: sit };
    });
  }

  /*
   * Avisos do RH para "O que precisa de atenção". ctx = { funcionarios, ferias, ocorrencias, banco, exames, treinamentos,
   * turmas, horarios, ref, feriados, cfg, hoje }. -> [{ nivel, icone, titulo, detalhe, link }]
   */
  function avisos(ctx) {
    var r = [], hoje = ctx.hoje;
    var ativos = (ctx.funcionarios || []).filter(function (f) { return ativoEm(f, hoje); });
    ativos.forEach(function (f) {
      var nome = String(f.nome).split(/\s+/)[0];
      periodosAquisitivos(f, ctx.ferias, ctx.ocorrencias, hoje).forEach(function (aq) {
        if (aq.situacao === "vencida") r.push({ nivel: "erro", icone: "pessoas", titulo: "Férias vencidas: " + f.nome,
          detalhe: aq.saldo + " dias do período até " + dataBR(aq.fim) + " passaram do prazo (" + dataBR(aq.concessivoFim) + "): são pagos em dobro.", link: "#rh-ferias" });
        if (aq.situacao === "vencendo") r.push({ nivel: "aviso", icone: "pessoas", titulo: "Férias de " + nome + " vencendo",
          detalhe: "Começar até " + dataBR(aq.limiteInicio) + " (" + aq.saldo + " dias) para não pagar em dobro.", link: "#rh-ferias" });
      });
      var b = saldoBanco(ctx, f, hoje, ctx.cfg);
      if (b.vencidas > 0 && b.saldo > 0) r.push({ nivel: "aviso", icone: "pessoas", titulo: "Banco de horas de " + nome + " passou de 6 meses",
        detalhe: RH.horas(Math.min(b.vencidas, b.saldo)) + " sem compensar: dê folga ou pague como hora extra.", link: "#rh-banco" });
      else if (b.vencendo > 0 && b.saldo > 0) r.push({ nivel: "info", icone: "pessoas", titulo: "Banco de horas de " + nome,
        detalhe: RH.horas(Math.min(b.vencendo, b.saldo)) + " completam 6 meses até " + dataBR(somarDias(hoje, 30)) + ".", link: "#rh-banco" });
    });
    situacaoExames(ativos, ctx.exames, hoje).forEach(function (x) {
      var nome = String(x.funcionario.nome).split(/\s+/)[0];
      if (x.situacao === "vencido") r.push({ nivel: "aviso", icone: "pessoas", titulo: "Exame de " + nome + " vencido",
        detalhe: "Venceu em " + dataBR(x.vence) + ". Marque o exame periódico.", link: "#rh-saude" });
      if (x.situacao === "vencendo") r.push({ nivel: "info", icone: "pessoas", titulo: "Exame de " + nome + " vence logo",
        detalhe: "Vence em " + dataBR(x.vence) + ".", link: "#rh-saude" });
    });
    var semExame = situacaoExames(ativos, ctx.exames, hoje).filter(function (x) { return x.situacao === "sem"; });
    if (semExame.length && (ctx.exames || []).length) r.push({ nivel: "info", icone: "pessoas", titulo: "Exame não registrado",
      detalhe: semExame.map(function (x) { return x.funcionario.nome; }).join(", ") + ".", link: "#rh-saude" });
    (ctx.treinamentos || []).forEach(function (t) {
      var f = ativos.filter(function (x) { return x.id === t.funcionario; })[0];
      if (!f || !t.validade) return;
      var mais = (ctx.treinamentos || []).some(function (o) { return o.funcionario === t.funcionario && o.nome === t.nome && o.data > t.data; });
      if (mais) return;
      if (t.validade < hoje || diasEntre(hoje, t.validade) <= 30) r.push({ nivel: t.validade < hoje ? "aviso" : "info", icone: "pessoas",
        titulo: "Treinamento de " + String(f.nome).split(/\s+/)[0] + (t.validade < hoje ? " vencido" : " vence logo"),
        detalhe: t.nome + ": " + dataBR(t.validade) + ".", link: "#rh-saude" });
    });
    // 13º perto do prazo
    var ano = +hoje.slice(0, 4), md = hoje.slice(5);
    if (ativos.length && md >= "11-01" && md <= "12-20") {
      var cfg = ctx.cfg || lerEncargos(""), t1 = 0, t2 = 0;
      ativos.forEach(function (f) {
        var tot = Math.round(remuneracao(f, cfg) * avos13(f, ano) / 12), p1 = Math.round(tot / 2);
        t1 += p1; t2 += tot - p1;
      });
      if (md <= "11-30") r.push({ nivel: "aviso", icone: "pessoas", titulo: "1ª parcela do 13º até 30/11",
        detalhe: "Cerca de " + brl(t1) + " (sem descontos).", link: "#rh-custos" });
      else r.push({ nivel: "aviso", icone: "pessoas", titulo: "2ª parcela do 13º até 20/12",
        detalhe: "Cerca de " + brl(t2) + " (antes do INSS e IR).", link: "#rh-custos" });
    }
    // desligamento com passos pendentes
    (ctx.funcionarios || []).forEach(function (f) {
      if (!f.desligamento || diasEntre(f.desligamento, hoje) > 30 || f.desligamento > somarDias(hoje, 30)) return;
      var feitos = f.desligamento_passos || {};
      var falta = PASSOS_DESLIGAMENTO.filter(function (p) { return !feitos[p.id]; }).length;
      if (falta) r.push({ nivel: "info", icone: "pessoas", titulo: "Desligamento de " + String(f.nome).split(/\s+/)[0],
        detalhe: falta + (falta === 1 ? " passo pendente" : " passos pendentes") + ". Pagar a rescisão até " + dataBR(somarDias(f.desligamento, 10)) + ".", link: "#rh" });
    });
    return r;
  }

  function brl(c) {
    var n = Math.abs(c), s = String(Math.floor(n / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return (c < 0 ? "-" : "") + "R$ " + s + "," + String(n % 100).padStart(2, "0");
  }

  /* -------------------------------- CSV -------------------------------- */

  function campoCSV(v) {
    var s = v == null ? "" : String(v);
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function numeroCSV(c) { return c == null || c === "" ? "" : (c < 0 ? "-" : "") + Math.floor(Math.abs(c) / 100) + "," + String(Math.abs(c) % 100).padStart(2, "0"); }
  function montarCSV(cab, linhas) {
    return "﻿" + [cab].concat(linhas).map(function (l) { return l.map(campoCSV).join(";"); }).join("\r\n") + "\r\n";
  }
  function csvFuncionarios(fs, turmas) {
    var nomeTurma = function (id) { var t = (turmas || []).filter(function (x) { return x.id === id; })[0]; return t ? t.nome : ""; };
    return montarCSV(["Nome", "Função", "Turma", "Admissão", "Desligamento", "Tipo de desligamento", "Nascimento", "CPF", "RG", "PIS", "CTPS",
      "Telefone", "E-mail", "Endereço", "Estado civil", "Escolaridade", "Dependentes", "Contato de emergência", "PIX", "Uniforme",
      "Salário", "Gratificação", "Jornada semanal (h)", "Observações"],
      (fs || []).map(function (f) {
        return [f.nome, f.funcao, nomeTurma(f.turma), dataBR(f.admissao), dataBR(f.desligamento), TIPOS_DESLIGAMENTO[f.desligamento_tipo] || "",
          dataBR(f.nascimento), f.cpf ? formatarCPF(f.cpf) : "", f.rg, f.pis, f.ctps, f.telefone, f.email, f.endereco, f.estado_civil,
          f.escolaridade, f.dependentes, f.contato_emergencia, f.pix, f.uniforme, numeroCSV(f.salario_centavos), numeroCSV(f.gratificacao_centavos),
          Math.round((+f.jornada_semanal_min || 2640) / 60), f.observacao];
      }));
  }
  var NOMES_OC = { folga: "Folga", falta: "Falta", atestado: "Atestado", feriado_trabalhado: "Feriado trabalhado",
    advertencia: "Advertência", suspensao: "Suspensão", elogio: "Elogio" };
  function csvOcorrencias(ocs, fs) {
    var nome = function (id) { var f = (fs || []).filter(function (x) { return x.id === id; })[0]; return f ? f.nome : ""; };
    return montarCSV(["Data", "Funcionário", "Tipo", "Dias", "Justificada", "Banco de horas", "Motivo"],
      (ocs || []).slice().sort(function (a, b) { return a.data < b.data ? -1 : 1; }).map(function (o) {
        return [dataBR(o.data), nome(o.funcionario), NOMES_OC[o.tipo] || o.tipo, o.dias, o.tipo === "falta" ? (o.justificada ? "sim" : "não") : "",
          o.banco ? "sim" : "", o.motivo];
      }));
  }
  function csvBanco(ctx, fs) {
    var l = [];
    (fs || []).forEach(function (f) {
      extratoBanco(ctx, f).forEach(function (x) { l.push([dataBR(x.data), f.nome, (x.minutos > 0 ? "+" : "-") + RH.horas(Math.abs(x.minutos)), x.minutos, x.motivo]); });
    });
    return montarCSV(["Data", "Funcionário", "Horas", "Minutos", "Motivo"], l);
  }

  return {
    PASSOS_DESLIGAMENTO: PASSOS_DESLIGAMENTO, TIPOS_DESLIGAMENTO: TIPOS_DESLIGAMENTO, TIPOS_EXAME: TIPOS_EXAME, NOMES_OC: NOMES_OC,
    pct: pct, somarMeses: somarMeses, diasEntre: diasEntre, cpfValido: cpfValido, formatarCPF: formatarCPF, soNumeros: soNumeros,
    lerEncargos: lerEncargos, remuneracao: remuneracao, avos13: avos13, diasPorFaltas: diasPorFaltas,
    periodosAquisitivos: periodosAquisitivos, avosFerias: avosFerias, valorFerias: valorFerias, conferirFerias: conferirFerias,
    minutosPrevistos: minutosPrevistos, extratoBanco: extratoBanco, saldoBanco: saldoBanco,
    custoMensal: custoMensal, somarCustos: somarCustos, planoMeses: planoMeses, reservaHoje: reservaHoje,
    diasAvisoPrevio: diasAvisoPrevio, rescisao: rescisao, textoMedida: textoMedida, dataExtenso: dataExtenso,
    textoAvisoFerias: textoAvisoFerias, textoFichaEPI: textoFichaEPI, lerHoras: lerHoras,
    aniversariantes: aniversariantes, situacaoExames: situacaoExames, avisos: avisos, ativoEm: ativoEm,
    csvFuncionarios: csvFuncionarios, csvOcorrencias: csvOcorrencias, csvBanco: csvBanco
  };
});
