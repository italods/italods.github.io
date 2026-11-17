/*
 * Área "RH": Funcionários (#rh), Escala (#rh-escala), Ocorrências (#rh-ocorrencias) e Resumo (#rh-resumo).
 * Banco de horas, Férias, Custos e Saúde ficam em rh-gestao.js (usa os mesmos dados, por RHAdmin.base).
 * As contas ficam em rh.js e rh-folha.js; aqui só telas. Dados dos funcionários ficam só no banco (nunca no código).
 */
(function () {
  "use strict";
  var RH = window.RH;
  var RF = window.RHFolha;
  var C = window.Calculos;
  var u = null;
  // tabelas do RH (rh_<nome>); as de NOVAS podem faltar se o rh.sql ainda não foi colado no Supabase
  var TABELAS = ["funcionarios", "turmas", "horarios", "ocorrencias", "feriados", "holerites"];
  var NOVAS = ["banco_horas", "ferias", "historico", "exames", "treinamentos", "entregas", "sabado"];
  var d = { funcionarios: [], turmas: [], horarios: [], ocorrencias: [], feriados: [], holerites: [], banco_horas: [], ferias: [],
    historico: [], exames: [], treinamentos: [], entregas: [], ref: "", cfg: RF.lerEncargos(""), cnpj: "", faltaSQL: false };
  var carregado = null;
  var fichaId = null;
  var semana = "";        // segunda-feira mostrada na escala
  var ocTipo = "folga";

  var NOMES_TIPO = RF.NOMES_OC;
  var CAMPOS_HIST = { funcao: "Função", salario: "Salário", gratificacao: "Gratificação", turma: "Turma", outro: "Outro" };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return u.escapar(s); }
  function hoje() { return u.hojeISO(); }
  function mesAtual() { return hoje().slice(0, 7); }
  function anoMes(v) { var p = String(v || mesAtual()).split("-"); return { ano: +p[0], mes: +p[1] }; }
  function porNome(a, b) { return String(a.nome).localeCompare(String(b.nome), "pt-BR"); }
  function ordenar(l) { return l.slice().sort(function (a, b) { return (+a.ordem || 0) - (+b.ordem || 0) || porNome(a, b); }); }
  function ctx() {
    return { turmas: d.turmas, horarios: d.horarios, ref: d.ref, ocorrencias: d.ocorrencias, feriados: d.feriados, ferias: d.ferias,
      banco: d.banco_horas, exames: d.exames, treinamentos: d.treinamentos, funcionarios: d.funcionarios, cfg: d.cfg, hoje: hoje(),
      sabado: RH.lerSabado(d.sabado, d.sabadoCfg), bancoEscalaInicio: d.bancoEscalaInicio || "" };
  }
  function ativos() { return d.funcionarios.filter(function (f) { return !f.desligamento || f.desligamento >= hoje(); }).sort(porNome); }
  function funcionario(id) { return d.funcionarios.filter(function (f) { return f.id === id; })[0] || null; }
  function turma(id) { return d.turmas.filter(function (t) { return t.id === id; })[0] || null; }
  function primeiroNome(n) { return String(n || "").split(/\s+/)[0]; }
  function lerDinheiro(id, rotulo) {
    var v = $(id).value.trim();
    if (!v) return { valor: null };
    var c = C.reaisParaCentavos(v);
    return c == null ? { erro: rotulo + " inválido. Use só números, por exemplo 1.621,00." } : { valor: c };
  }
  function opcoesFuncionarios(lista, sel) {
    return lista.map(function (f) { return '<option value="' + esc(f.id) + '"' + (f.id === sel ? " selected" : "") + ">" + esc(f.nome) + "</option>"; }).join("");
  }
  function empresa() { return { nome: u.empresa.nome || "Supermercado", cidade: u.empresa.cidade || "", cnpj: formatarCNPJ(d.cnpj) }; }
  function formatarCNPJ(s) {
    var c = String(s || "").replace(/\D/g, "");
    return c.length === 14 ? c.slice(0, 2) + "." + c.slice(2, 5) + "." + c.slice(5, 8) + "/" + c.slice(8, 12) + "-" + c.slice(12) : "";
  }

  function carregar(forcar) {
    if (carregado && !forcar) return carregado;
    var faltou = false;
    var novas = NOVAS.map(function (n) {
      return u.db.listarRH(n).then(null, function (e) {
        var m = String((e && (e.message || (e.original && e.original.message))) || "");
        if (/does not exist|schema cache|not find the table|relation/i.test(m)) { faltou = true; return []; }
        throw e;
      });
    });
    carregado = Promise.all(TABELAS.map(function (n) { return u.db.listarRH(n); }).concat(novas, [
      u.db.obterConfiguracao("rh_semana_ref"), u.db.obterConfiguracao("rh_encargos").then(null, function () { return ""; }),
      u.db.obterConfiguracao("cnpj_loja").then(null, function () { return ""; }),
      u.db.obterConfiguracao("rh_sabado").then(null, function () { return ""; }),
      u.db.obterConfiguracao("rh_banco_escala_inicio").then(null, function () { return ""; })]))
      .then(function (r) {
        TABELAS.concat(NOVAS).forEach(function (n, i) { d[n] = r[i] || []; });
        var k = TABELAS.length + NOVAS.length;
        d.ref = r[k] || RH.segundaDaSemana(hoje());
        d.cfg = RF.lerEncargos(r[k + 1]);
        d.cnpj = r[k + 2] || "";
        d.sabadoCfg = r[k + 3] || "";
        d.bancoEscalaInicio = r[k + 4] || "";
        d.faltaSQL = faltou;
        return d;
      }, function (e) { carregado = null; throw e; });
    return carregado;
  }

  function mostrar(aba) {
    u.limparErro();
    carregar(true).then(function () {
      $("rh-falta-sql").hidden = !d.faltaSQL;
      if (aba === "rh") desenharFuncionarios();
      if (aba === "rh-escala") desenharEscala();
      if (aba === "rh-ocorrencias") desenharOcorrencias();
      if (aba === "rh-resumo") desenharResumo();
      if (window.RHGestao) window.RHGestao.mostrar(aba);
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
    var dia = RH.diaDoFuncionario(ctx(), f, hoje());
    var hojeTxt = { ferias: "De férias", folga: "De folga", atestado: "Atestado", falta: "Faltou hoje", suspensao: "Suspenso" }[dia.tipo];
    var sub = [f.funcao, t ? t.nome : "sem turma", f.admissao ? "desde " + u.dataBR(f.admissao) : ""].filter(Boolean).join(" · ");
    return '<button type="button" class="registro" data-func="' + esc(f.id) + '">' +
      '<span class="r-titulo">' + esc(f.nome) + "</span>" +
      '<span class="r-total">' + (f.desligamento && f.desligamento < hoje() ? '<span class="etiqueta">Desligado</span>' :
        f.desligamento ? '<span class="etiqueta sit-pendente">Sai em ' + esc(u.dataBR(f.desligamento).slice(0, 5)) + "</span>" :
        hojeTxt ? '<span class="etiqueta">' + esc(hojeTxt) + "</span>" : "") + "</span>" +
      '<span class="r-sub">' + esc(sub) + "</span><span></span></button>";
  }

  function desenharFuncionarios() {
    var at = ativos();
    var desl = d.funcionarios.filter(function (f) { return at.indexOf(f) < 0; }).sort(porNome);
    $("rh-lista").innerHTML = (at.length ? at.map(linhaFuncionario).join("") : '<p class="vazio">Nenhum funcionário cadastrado ainda.</p>') +
      (desl.length ? '<details><summary>Desligados (' + desl.length + ")</summary>" + desl.map(linhaFuncionario).join("") + "</details>" : "");
    if (fichaId === null) $("rh-ficha").hidden = true;
  }

  var CAMPOS_TEXTO = [["rh-nome", "nome"], ["rh-funcao", "funcao"], ["rh-telefone", "telefone"], ["rh-observacao", "observacao"],
    ["rh-rg", "rg"], ["rh-ctps", "ctps"], ["rh-endereco", "endereco"], ["rh-email", "email"], ["rh-pix", "pix"],
    ["rh-estado-civil", "estado_civil"], ["rh-escolaridade", "escolaridade"], ["rh-uniforme", "uniforme"], ["rh-emergencia", "contato_emergencia"],
    ["rh-desl-motivo", "desligamento_motivo"]];
  var passos = {};

  function abrirFicha(f) {
    fichaId = f ? f.id : "";
    $("rh-ficha").hidden = false;
    $("rh-ficha-titulo").textContent = f ? f.nome : "Novo funcionário";
    CAMPOS_TEXTO.forEach(function (c) { $(c[0]).value = f ? f[c[1]] || "" : ""; });
    $("rh-turma").innerHTML = opcoesTurma(f ? f.turma : "");
    $("rh-admissao").value = f ? f.admissao || "" : "";
    $("rh-nascimento").value = f ? f.nascimento || "" : "";
    $("rh-salario").value = f && f.salario_centavos != null ? u.dinheiroCampo(f.salario_centavos) : "";
    $("rh-gratificacao").value = f && +f.gratificacao_centavos ? u.dinheiroCampo(f.gratificacao_centavos) : "";
    $("rh-jornada").value = f ? Math.round((+f.jornada_semanal_min || 2640) / 60) : 44;
    $("rh-cpf").value = f && f.cpf ? RF.formatarCPF(f.cpf) : "";
    $("rh-pis").value = f ? f.pis || "" : "";
    $("rh-dependentes").value = f ? +f.dependentes || 0 : 0;
    $("rh-desligamento").value = f ? f.desligamento || "" : "";
    $("rh-desl-tipo").value = f ? f.desligamento_tipo || "" : "";
    $("rh-desl-aviso").value = f && f.desligamento_aviso ? f.desligamento_aviso : "indenizado";
    $("rh-fgts").value = f && f.fgts_saldo_centavos != null ? u.dinheiroCampo(f.fgts_saldo_centavos) : "";
    $("rh-desligamento-parte").open = !!(f && f.desligamento);
    $("rh-desligamento-parte").hidden = !f;
    passos = Object.assign({}, f && f.desligamento_passos || {});
    desenharPassos();
    $("rh-rescisao").innerHTML = "";
    $("rh-apagar").hidden = !f;
    desenharHistorico(f);
    desenharHolerites(f);
    $("rh-ficha").scrollIntoView({ behavior: "smooth", block: "start" });
    $("rh-nome").focus();
  }

  function fecharFicha() { fichaId = null; $("rh-ficha").hidden = true; }

  function desenharPassos() {
    var t = $("rh-desligamento").value;
    $("rh-passos").innerHTML = RF.PASSOS_DESLIGAMENTO.map(function (p) {
      var texto = p.texto + (p.id === "pagar" && t ? " (até " + u.dataBR(window.Feriados.somarDias(t, 10)) + ")" : "");
      return '<label class="marcar"><input type="checkbox" data-passo="' + p.id + '"' + (passos[p.id] ? " checked" : "") + " /> " + esc(texto) + "</label>";
    }).join("");
  }

  function desenharHistorico(f) {
    var el = $("rh-historico");
    var hs = f ? d.historico.filter(function (h) { return h.funcionario === f.id; }).sort(function (a, b) {
      return a.data < b.data ? 1 : a.data > b.data ? -1 : String(b.criado_em).localeCompare(String(a.criado_em));
    }) : [];
    el.hidden = !f;
    if (!f) { el.innerHTML = ""; return; }
    function valor(h, v) {
      if ((h.campo === "salario" || h.campo === "gratificacao") && /^\d+$/.test(v)) return u.brl(+v);
      return v || "—";
    }
    el.innerHTML = '<h3 class="mini">Histórico</h3>' + (hs.length ? '<ul class="lista-versoes">' + hs.map(function (h) {
      return "<li><div><strong>" + esc(u.dataBR(h.data)) + " · " + esc(CAMPOS_HIST[h.campo] || h.campo) + "</strong><br>" +
        esc(valor(h, h.antes)) + " → " + esc(valor(h, h.depois)) + (h.observacao ? ' <small class="suave">' + esc(h.observacao) + "</small>" : "") + "</div></li>";
    }).join("") + "</ul>" : '<p class="suave mini">Mudanças de função, salário, gratificação e turma aparecem aqui sozinhas.</p>');
  }

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

  function lerFicha() {
    var nome = $("rh-nome").value.trim();
    if (!nome) return { erro: "Preencha o nome." };
    var sal = lerDinheiro("rh-salario", "Salário"); if (sal.erro) return sal;
    var gra = lerDinheiro("rh-gratificacao", "Gratificação"); if (gra.erro) return gra;
    var fg = lerDinheiro("rh-fgts", "Saldo do FGTS"); if (fg.erro) return fg;
    var tel = $("rh-telefone").value.trim();
    if (!/^[0-9 ()+-]{0,20}$/.test(tel)) return { erro: "Telefone inválido: use só números, espaço, parênteses e traço." };
    var cpf = RF.soNumeros($("rh-cpf").value);
    if (cpf && !RF.cpfValido(cpf)) return { erro: "CPF inválido. Confira os números." };
    var pis = RF.soNumeros($("rh-pis").value);
    if (pis && pis.length !== 11) return { erro: "PIS/NIS tem 11 números." };
    var jor = parseInt($("rh-jornada").value, 10);
    if (!(jor >= 1 && jor <= 44)) return { erro: "Jornada: de 1 a 44 horas por semana." };
    var dep = parseInt($("rh-dependentes").value, 10) || 0;
    if (dep < 0 || dep > 20) return { erro: "Dependentes: de 0 a 20." };
    var adm = $("rh-admissao").value, desl = $("rh-desligamento").value;
    if (adm && desl && desl < adm) return { erro: "O desligamento está antes da admissão." };
    var dados = { turma: $("rh-turma").value || null, admissao: adm || null, nascimento: $("rh-nascimento").value || null,
      salario_centavos: sal.valor, gratificacao_centavos: gra.valor || 0, fgts_saldo_centavos: fg.valor, jornada_semanal_min: jor * 60,
      cpf: cpf, pis: pis, dependentes: dep, desligamento: desl || null,
      desligamento_tipo: desl ? $("rh-desl-tipo").value : "", desligamento_aviso: desl ? $("rh-desl-aviso").value : "",
      desligamento_passos: passos };
    CAMPOS_TEXTO.forEach(function (c) { dados[c[1]] = $(c[0]).value.trim(); });
    dados.telefone = tel;
    if (!desl) dados.desligamento_motivo = "";
    if (desl && !dados.desligamento_tipo) return { erro: "Escolha o tipo de desligamento." };
    return { dados: dados };
  }

  function salvarFicha() {
    u.limparErro();
    var r = lerFicha();
    if (r.erro) { u.mostrarErro({ message: r.erro }); return; }
    var b = $("rh-salvar");
    u.ocupado(b, true, "Salvando…");
    u.db.salvarRH("funcionarios", r.dados, fichaId || null).then(function () {
      u.toast("Salvo: " + r.dados.nome);
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

  // Estimativa da rescisão com o que está na tela (não grava nada)
  function calcularRescisao() {
    u.limparErro();
    var f0 = funcionario(fichaId);
    var r = lerFicha();
    if (r.erro) { u.mostrarErro({ message: r.erro }); return; }
    var f = Object.assign({}, f0 || {}, r.dados, { desligamento: null, id: fichaId });
    var saida = $("rh-desligamento").value;
    if (!saida) { u.mostrarErro({ message: "Preencha o último dia de trabalho (pode ser uma data para simular)." }); return; }
    if (!f.admissao) { u.mostrarErro({ message: "Preencha a admissão." }); return; }
    if (!f.salario_centavos) { u.mostrarErro({ message: "Preencha o salário." }); return; }
    var tipo = $("rh-desl-tipo").value || "sem_justa_causa";
    var res = RF.rescisao(f, { saida: saida, tipo: tipo, aviso: $("rh-desl-aviso").value, fgtsSaldo: r.dados.fgts_saldo_centavos },
      { ferias: d.ferias, ocorrencias: d.ocorrencias, cfg: d.cfg });
    function linha(rot, v, det, forte) {
      return '<div class="linha-info' + (forte ? " forte" : "") + '"><span>' + esc(rot) + (det ? ' <small class="suave">' + esc(det) + "</small>" : "") +
        "</span><strong>" + esc(u.brl(v)) + "</strong></div>";
    }
    $("rh-rescisao").innerHTML = '<div class="rescisao">' +
      '<p class="mini"><strong>' + esc(RF.TIPOS_DESLIGAMENTO[tipo]) + "</strong> · aviso prévio de " + res.diasAviso + " dias" +
      (res.projecao !== saida ? " (contrato vai até " + esc(u.dataBR(res.projecao)) + ")" : "") + "</p>" +
      res.itens.map(function (x) { return linha(x.rotulo, x.valor, x.detalhe); }).join("") +
      linha("Total para o funcionário", res.total, "", true) +
      linha("FGTS do mês da rescisão", res.fgtsMes, "8%, na guia") +
      (res.pctMulta ? linha("Multa do FGTS (" + res.pctMulta / 100 + "%)", res.multa, (res.fgtsEstimado ? "saldo estimado: " : "saldo: ") + u.brl(res.fgtsSaldo)) : "") +
      linha("Custo total para a loja", res.custoTotal, "", true) +
      '<p class="mini">Pagar até <strong>' + esc(u.dataBR(res.pagarAte)) + "</strong> (10 dias depois do último dia).</p>" +
      '<ul class="mini suave">' + res.notas.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") + "</ul></div>";
  }

  /* ============================== Escala ============================== */

  function classeDia(x) {
    return { trabalho: "", folga: "cor-pendente", folga_escala: "suave", falta: "cor-falta", atestado: "cor-pendente", ferias: "cor-sobra",
      suspensao: "cor-falta", feriado: "suave", domingo: "suave", sem_escala: "suave" }[x.tipo] || "suave";
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
              '</span><span class="' + classeDia(x) + '">' + esc(RH.textoDia(x)) + "</span></li>";
          }).join("") + "</ul></div>";
      }
    }
    $("esc-semana").innerHTML = html;
    // mês de um funcionário
    var sel = $("esc-func"), atual = sel.value;
    sel.innerHTML = opcoesFuncionarios(fs, atual);
    if (!$("esc-mes").value) $("esc-mes").value = mesAtual();
    desenharMesFuncionario();
    desenharHorarios();
    desenharTurmas();
    desenharSabado();
    desenharBancoEscala();
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
          esc(x.tipo === "sem_escala" ? "Sem turma (escolha na ficha)" : RH.textoDia(x)) + "</span></li>";
      }).join("") + "</ul>";
  }

  function desenharHorarios() {
    var hs = ordenar(d.horarios);
    $("esc-horarios").innerHTML = hs.length ? hs.map(function (h) {
      var sem = RH.minutosDaSemana(h), maisDe10 = [1, 2, 3, 4, 5, 6].filter(function (i) { return RH.minutosDoDia((h.dias || {})[String(i)]) > 600; });
      var aviso = sem > 2640 ? "Passa de 44h por semana: as horas a mais são hora extra (ou banco de horas)." :
        maisDe10.length ? "Dia com mais de 10 horas de trabalho (" + maisDe10.map(function (i) { return RH.DIAS_CURTOS[i]; }).join(", ") + "): a CLT permite no máximo 2h a mais por dia." : "";
      return '<div class="horario" data-horario="' + esc(h.id) + '">' +
        '<div class="dupla"><label class="campo"><span>Nome</span><input type="text" class="h-nome" maxlength="40" value="' + esc(h.nome) + '" /></label>' +
        '<label class="campo"><span>Ordem</span><input type="number" class="h-ordem" min="0" max="9" value="' + esc(h.ordem) + '" /></label></div>' +
        '<div class="tabela-rolagem"><table class="tabela-horario"><thead><tr><th>Dia</th><th>Entrada</th><th>Saída</th><th>Almoço às</th><th>Almoço <small>(min)</small></th></tr></thead><tbody>' +
        [1, 2, 3, 4, 5, 6].map(function (i) {
          var x = (h.dias || {})[String(i)] || {};
          return "<tr><td>" + RH.DIAS_CURTOS[i] + '</td><td><input type="time" data-dia="' + i + '" data-campo="entrada" value="' + esc(x.entrada || "") + '" aria-label="Entrada ' + RH.DIAS[i] + '" /></td>' +
            '<td><input type="time" data-dia="' + i + '" data-campo="saida" value="' + esc(x.saida || "") + '" aria-label="Saída ' + RH.DIAS[i] + '" /></td>' +
            '<td><input type="time" data-dia="' + i + '" data-campo="almoco" value="' + esc(x.almoco || "") + '" aria-label="Hora do almoço ' + RH.DIAS[i] + '" /></td>' +
            '<td><input type="number" class="h-intervalo" min="0" max="240" step="5" data-dia="' + i + '" data-campo="intervalo" value="' + esc(x.intervalo || "") + '" aria-label="Almoço ' + RH.DIAS[i] + ' em minutos" /></td></tr>';
        }).join("") + "</tbody></table></div>" +
        '<p class="mini">Total: <strong>' + RH.horas(sem) + "</strong> por semana</p>" + (aviso ? '<p class="msg-aviso mini">' + esc(aviso) + "</p>" : "") +
        '<div class="acoes"><button type="button" class="botao perigo pequeno" data-apagar-horario="' + esc(h.id) + '">Apagar</button>' +
        '<button type="button" class="botao primario pequeno" data-salvar-horario="' + esc(h.id) + '">Salvar horário</button></div></div>';
    }).join("") : '<p class="vazio">Nenhum horário. Inclua, por exemplo, "Manhã" e "Tarde".</p>';
  }

  /* ---------------- Sábado por pessoa (rodízio) ---------------- */

  var FUNCOES = [["", "—"], ["abertura", "Abertura"], ["fechamento", "Fechamento"], ["folga", "Folga"]];
  var sabadoSemanas = null;   // edição na tela: [{ funcionario: funcao }]

  function cfgSabado() {
    try { return JSON.parse(d.sabadoCfg || "null") || null; } catch (e) { return null; }
  }
  function semanasSabado() {
    if (sabadoSemanas) return sabadoSemanas;
    var n = (d.sabado || []).reduce(function (m, e) { return Math.max(m, +e.semana + 1); }, 0), l = [];
    for (var i = 0; i < n; i++) l.push({});
    (d.sabado || []).forEach(function (e) { l[+e.semana][e.funcionario] = e.funcao; });
    return (sabadoSemanas = l);
  }
  function campoHorarioSabado(qual, h) {
    h = h || {};
    var rot = qual === "abertura" ? "Abertura" : "Fechamento";
    return '<fieldset class="sab-horario" data-sab="' + qual + '"><legend>' + rot + "</legend>" +
      '<div class="dupla"><label class="campo"><span>Entrada</span><input type="time" data-c="entrada" value="' + esc(h.entrada || "") + '" /></label>' +
      '<label class="campo"><span>Saída</span><input type="time" data-c="saida" value="' + esc(h.saida || "") + '" /></label></div>' +
      '<div class="dupla"><label class="campo"><span>Almoço às</span><input type="time" data-c="almoco" value="' + esc(h.almoco || "") + '" /></label>' +
      '<label class="campo"><span>Almoço (min)</span><input type="number" min="0" max="240" step="5" data-c="intervalo" value="' + esc(h.intervalo || "") + '" /></label></div></fieldset>';
  }
  function desenharSabado() {
    var cfg = cfgSabado() || {}, sem = semanasSabado(), fs = ativos();
    var ref = cfg.ref || RH.segundaDaSemana(hoje()), hs = cfg.horarios || {};
    var semanaAtual = sem.length ? ((RH.semanasEntre(ref, hoje()) % sem.length) + sem.length) % sem.length : -1;
    var proximo = function (k) {   // próximo sábado em que vale a semana k do rodízio
      var seg = RH.segundaDaSemana(hoje());
      for (var i = 0; i < 12; i++) {
        var s = window.Feriados.somarDias(seg, 7 * i);
        if ((((RH.semanasEntre(ref, s) % sem.length) + sem.length) % sem.length) === k) return window.Feriados.somarDias(s, 5);
      }
      return "";
    };
    var html = '<label class="campo"><span>A semana 1 do rodízio começa na segunda-feira</span><input type="date" id="sab-ref" value="' + esc(ref) + '" /></label>' +
      '<div class="sab-horarios">' + campoHorarioSabado("abertura", hs.abertura) + campoHorarioSabado("fechamento", hs.fechamento) + "</div>";
    if (!fs.length) html += '<p class="vazio">Cadastre os funcionários primeiro.</p>';
    else if (!sem.length) html += '<p class="vazio">Nenhuma semana no rodízio. Toque em "+ Semana".</p>';
    else {
      html += '<div class="tabela-rolagem"><table class="tabela-sabado"><thead><tr><th>Semana</th>' +
        fs.map(function (f) { return "<th>" + esc(primeiroNome(f.nome)) + "</th>"; }).join("") + "</tr></thead><tbody>" +
        sem.map(function (linha, k) {
          var conta = { abertura: 0, fechamento: 0, folga: 0 };
          fs.forEach(function (f) { if (linha[f.id]) conta[linha[f.id]]++; });
          return '<tr class="' + (k === semanaAtual ? "hoje" : "") + '"><th>' + (k + 1) + '<br><small class="suave">' + esc(u.dataBR(proximo(k)).slice(0, 5)) +
            "</small><br><small class=\"suave\">" + conta.abertura + "A · " + conta.fechamento + "F · " + conta.folga + " folga</small></th>" +
            fs.map(function (f) {
              return '<td><select data-sab-semana="' + k + '" data-sab-func="' + esc(f.id) + '" aria-label="Semana ' + (k + 1) + ", " + esc(f.nome) + '">' +
                FUNCOES.map(function (o) { return '<option value="' + o[0] + '"' + ((linha[f.id] || "") === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") +
                "</select></td>";
            }).join("") + "</tr>";
        }).join("") + "</tbody></table></div>" +
        '<p class="suave mini">A data em cada semana é o próximo sábado em que ela vale. A linha destacada é a desta semana.</p>';
    }
    html += '<div class="acoes"><button type="button" class="botao pequeno" id="sab-menos"' + (sem.length ? "" : " disabled") + '>− Semana</button>' +
      '<button type="button" class="botao pequeno" id="sab-mais"' + (sem.length >= 12 ? " disabled" : "") + '>+ Semana</button></div>' +
      '<div class="acoes"><button type="button" class="botao primario" id="sab-salvar">Salvar rodízio de sábado</button></div>';
    $("esc-sabado").innerHTML = html;
  }
  function lerHorarioSabado(qual) {
    var el = document.querySelector('[data-sab="' + qual + '"]'), v = function (c) { return el.querySelector('[data-c="' + c + '"]').value; };
    var h = { entrada: RH.lerHora(v("entrada")), saida: RH.lerHora(v("saida")) };
    if (!h.entrada || !h.saida) return null;
    var n = parseInt(v("intervalo"), 10);
    if (n > 0) h.intervalo = n;
    if (n > 0 && RH.lerHora(v("almoco"))) h.almoco = RH.lerHora(v("almoco"));
    return h;
  }
  function salvarSabado() {
    u.limparErro();
    var ref = $("sab-ref").value;
    if (!ref) { u.mostrarErro({ message: "Escolha a segunda-feira em que começa a semana 1." }); return; }
    ref = RH.segundaDaSemana(ref);
    var horarios = { abertura: lerHorarioSabado("abertura"), fechamento: lerHorarioSabado("fechamento") };
    var sem = semanasSabado(), linhas = [];
    sem.forEach(function (l, k) { Object.keys(l).forEach(function (f) { if (l[f]) linhas.push({ semana: k, funcionario: f, funcao: l[f] }); }); });
    var usa = {};
    linhas.forEach(function (x) { usa[x.funcao] = true; });
    if (usa.abertura && !horarios.abertura) { u.mostrarErro({ message: "Preencha entrada e saída da abertura do sábado." }); return; }
    if (usa.fechamento && !horarios.fechamento) { u.mostrarErro({ message: "Preencha entrada e saída do fechamento do sábado." }); return; }
    var cfg = JSON.stringify({ ref: ref, horarios: horarios });
    var b = $("sab-salvar");
    u.ocupado(b, true, "Salvando…");
    // troca as linhas antigas pelas novas
    (d.sabado || []).reduce(function (p, x) { return p.then(function () { return u.db.apagarRH("sabado", x.id); }); }, Promise.resolve())
      .then(function () {
        return linhas.reduce(function (p, x) { return p.then(function () { return u.db.salvarRH("sabado", x); }); }, Promise.resolve());
      })
      .then(function () { return u.db.salvarConfiguracao("rh_sabado", cfg); })
      .then(function () {
        sabadoSemanas = null;
        u.toast("Rodízio de sábado salvo (" + sem.length + (sem.length === 1 ? " semana" : " semanas") + ").");
        return carregar(true).then(desenharEscala);
      }, u.mostrarErro)
      .then(function () { u.ocupado(b, false); });
  }

  /* ---------------- Banco de horas pela escala ---------------- */

  function desenharBancoEscala() {
    var inicio = d.bancoEscalaInicio, fs = ativos(), c = ctx();
    var html = '<div class="dupla"><label class="campo"><span>Contar a partir da semana de</span><input type="date" id="bh-inicio" value="' + esc(inicio || "") + '" /></label>' +
      '<div class="campo"><span>&nbsp;</span><button type="button" class="botao" id="bh-salvar">' + (inicio ? "Mudar o início" : "Começar a contar") + "</button></div></div>";
    if (!inicio) {
      html += '<p class="vazio">Ainda não está contando. Escolha a semana de início.</p>';
    } else if (fs.length) {
      var ate = window.Feriados.somarDias(RH.segundaDaSemana(hoje()), 7 * 4 + 5);
      var porF = fs.map(function (f) { return RH.bancoDaEscala(c, f, inicio, ate); });
      var semanas = [];
      porF.forEach(function (l) { l.forEach(function (w) { if (semanas.indexOf(w.segunda) < 0) semanas.push(w.segunda); }); });
      semanas.sort();
      var sinal = function (m) { return (m > 0 ? "+" : m < 0 ? "−" : "") + RH.horas(Math.abs(m)); };
      html += '<div class="tabela-rolagem"><table class="tabela-banco-escala"><thead><tr><th>Semana</th>' +
        fs.map(function (f) { return "<th>" + esc(primeiroNome(f.nome)) + "</th>"; }).join("") + "</tr></thead><tbody>" +
        semanas.map(function (seg) {
          var futura = window.Feriados.somarDias(seg, 5) > hoje();
          return '<tr class="' + (futura ? "futura" : "") + '"><th>' + esc(u.dataBR(seg).slice(0, 5)) + "–" + esc(u.dataBR(window.Feriados.somarDias(seg, 5)).slice(0, 5)) +
            (futura ? '<br><small class="suave">prevista</small>' : "") + "</th>" +
            porF.map(function (l) {
              var w = l.filter(function (x) { return x.segunda === seg; })[0];
              if (!w) return '<td class="suave">—</td>';
              return '<td><strong class="' + (w.saldo > 0 ? "cor-sobra" : w.saldo < 0 ? "cor-falta" : "") + '">' + sinal(w.saldo) + "</strong>" +
                '<br><small class="suave">' + RH.horas(w.minutos) + " · total " + sinal(w.acumulado) + "</small></td>";
            }).join("") + "</tr>";
        }).join("") + "</tbody></table></div>" +
        '<p class="suave mini">Semanas "previstas" ainda não entraram no banco: entram no sábado de cada uma. O saldo completo (com lançamentos à mão e folgas do banco) fica em RH &gt; Banco de horas.</p>';
    }
    $("esc-banco").innerHTML = html;
  }
  function salvarInicioBanco() {
    var v = $("bh-inicio").value;
    if (!v) { u.mostrarErro({ message: "Escolha a semana em que o banco de horas pela escala começa." }); return; }
    v = RH.segundaDaSemana(v);
    if (d.bancoEscalaInicio && !confirm("Mudar o início do banco de horas pela escala para a semana de " + u.dataBR(v) + "? O saldo de todos é recalculado.")) return;
    u.db.salvarConfiguracao("rh_banco_escala_inicio", v).then(function () {
      u.toast("Banco de horas pela escala a partir de " + u.dataBR(v) + ".");
      return carregar(true).then(desenharEscala);
    }, u.mostrarErro);
  }

  function salvarHorario(id) {
    var el = document.querySelector('[data-horario="' + id + '"]');
    var nome = el.querySelector(".h-nome").value.trim();
    if (!nome) { u.mostrarErro({ message: "Dê um nome ao horário (ex.: Manhã)." }); return; }
    var dias = {}, erro = "";
    [1, 2, 3, 4, 5, 6].forEach(function (i) {
      var e = el.querySelector('[data-dia="' + i + '"][data-campo="entrada"]').value;
      var s = el.querySelector('[data-dia="' + i + '"][data-campo="saida"]').value;
      var iv = el.querySelector('[data-dia="' + i + '"][data-campo="intervalo"]').value;
      var alm = el.querySelector('[data-dia="' + i + '"][data-campo="almoco"]').value;
      if (!e && !s) return;
      if (!RH.lerHora(e) || !RH.lerHora(s)) { erro = "Preencha entrada e saída de " + RH.DIAS[i] + " (ou deixe as duas vazias)."; return; }
      var n = iv === "" ? 0 : parseInt(iv, 10);
      if (!(n >= 0 && n <= 240)) { erro = "Almoço de " + RH.DIAS[i] + ": de 0 a 240 minutos."; return; }
      dias[String(i)] = { entrada: RH.lerHora(e), saida: RH.lerHora(s) };
      if (n) dias[String(i)].intervalo = n;
      if (alm && n) dias[String(i)].almoco = RH.lerHora(alm);
      if (RH.minutosDoDia(dias[String(i)]) <= 0) erro = "Em " + RH.DIAS[i] + " o almoço é maior que o dia de trabalho.";
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

  function textoPDF(s) { return String(s).replace(/[—–]/g, "-").replace(/−/g, "-").replace(/ | /g, " "); }

  // Escala da semana em A4 deitado: funcionários × dias
  function pdfEscala() {
    var fs = ativos();
    if (!fs.length) { u.mostrarErro({ message: "Cadastre os funcionários primeiro." }); return; }
    u.toast("Gerando PDF…");
    u.jspdf().then(function (lib) {
      var doc = new lib.jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
      var m = 12, larg = 297 - 2 * m, col0 = 48, colW = (larg - col0) / 6, y = 18;
      doc.setFont("helvetica", "bold"); doc.setFontSize(16);
      doc.text(textoPDF("Escala - " + (u.empresa.nome || "Supermercado")), m, y);
      doc.setFont("helvetica", "normal"); doc.setFontSize(11);
      doc.text("Semana de " + u.dataBR(semana) + " a " + u.dataBR(window.Feriados.somarDias(semana, 5)), m, y + 7);
      y += 16;
      doc.setDrawColor(150); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
      for (var i = 0; i < 6; i++) {
        var t = window.Feriados.somarDias(semana, i), fer = RH.feriadoDoDia(t, d.feriados);
        doc.text(textoPDF(RH.DIAS[i + 1] + " " + u.dataBR(t).slice(0, 5)), m + col0 + i * colW + 2, y);
        if (fer) { doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.text(textoPDF(doc.splitTextToSize(fer.nome, colW - 4)[0]), m + col0 + i * colW + 2, y + 4); doc.setFont("helvetica", "bold"); doc.setFontSize(10); }
      }
      y += 7;
      var alt = Math.min(22, (210 - y - 14) / fs.length);
      fs.forEach(function (f) {
        doc.line(m, y, m + larg, y);
        doc.setFont("helvetica", "bold"); doc.setFontSize(11);
        doc.text(textoPDF(doc.splitTextToSize(f.nome, col0 - 4)[0]), m + 1, y + 6);
        doc.setFont("helvetica", "normal"); doc.setFontSize(10);
        for (var i = 0; i < 6; i++) {
          var x = RH.diaDoFuncionario(ctx(), f, window.Feriados.somarDias(semana, i));
          var txt = x.tipo === "fora" ? "" : x.tipo === "trabalho" ? x.entrada + " - " + x.saida + (x.intervalo ? "\nAlmoço " + RH.horas(x.intervalo) : "") : RH.textoDia(x);
          doc.text(textoPDF(txt).split("\n"), m + col0 + i * colW + 2, y + 6);
        }
        y += alt;
      });
      doc.line(m, y, m + larg, y);
      doc.save("escala_" + semana + ".pdf");
    }, u.mostrarErro);
  }

  /* ============================ Ocorrências ============================ */

  function desenharOcorrencias() {
    var sel = $("oc-func"), atual = sel.value;
    sel.innerHTML = opcoesFuncionarios(ativos(), atual);
    if (!$("oc-data").value) $("oc-data").value = hoje();
    if (!$("oc-mes").value) $("oc-mes").value = mesAtual();
    escolherTipo(ocTipo);
    desenharListaOcorrencias();
    desenharFeriados();
  }

  function escolherTipo(t) {
    ocTipo = t;
    var segunda = ["advertencia", "suspensao", "elogio"].indexOf(t) >= 0;
    u.definirAlternador($("oc-tipo"), segunda ? "" : t);
    u.definirAlternador($("oc-tipo2"), segunda ? t : "");
    $("oc-dias-campo").hidden = t !== "atestado" && t !== "suspensao";
    $("oc-dias").max = t === "suspensao" ? "30" : "365";
    $("oc-justificada-campo").hidden = t !== "falta";
    $("oc-banco-campo").hidden = t !== "folga" && t !== "feriado_trabalhado";
    $("oc-banco-rotulo").textContent = t === "folga" ? "Folga do banco de horas (desconta as horas do dia)" : "Vai para o banco de horas (em vez de pagar)";
    $("oc-data-rotulo").textContent = t === "atestado" || t === "suspensao" ? "Primeiro dia" : "Data";
    $("oc-motivo-rotulo").textContent = t === "advertencia" || t === "suspensao" ? "Motivo (vai no documento para assinar)" : t === "elogio" ? "Elogio (o que fez)" : "Motivo / observação";
    avisoOcorrencia();
  }

  function avisoOcorrencia() {
    var el = $("oc-aviso"), t = $("oc-data").value, f = funcionario($("oc-func").value);
    var msg = "";
    if (t && RH.diaDaSemana(t) === 0 && ["atestado", "advertencia", "elogio"].indexOf(ocTipo) < 0) msg = "Esse dia é domingo (loja fechada).";
    if (t && ocTipo === "feriado_trabalhado") {
      var fer = RH.feriadoDoDia(t, d.feriados);
      if (!fer) msg = "Esse dia não é feriado. Se for feriado municipal, inclua em Feriados abaixo.";
      else if (fer.facultativo) msg = fer.nome + " é ponto facultativo (dia normal no comércio).";
    }
    if (t && f && (ocTipo === "folga" || ocTipo === "falta") && !msg) {
      var x = RH.diaDoFuncionario(ctx(), f, t);
      if (x.tipo === "folga_escala") msg = "Pela escala, " + primeiroNome(f.nome) + " já não trabalha nesse dia.";
      if (x.tipo === "feriado") msg = "Esse dia é feriado (" + x.feriado.nome + ").";
      if (x.tipo === "ferias") msg = primeiroNome(f.nome) + " está de férias nesse dia.";
      if (ocTipo === "folga" && $("oc-banco").checked && x.tipo === "trabalho") msg = "Vai descontar " + RH.horas(x.minutos) + " do banco de horas.";
    }
    if (ocTipo === "suspensao" && !msg) msg = "A suspensão é de no máximo 30 dias e os dias não são pagos. Antes, em geral, vêm advertências.";
    el.textContent = msg;
    el.hidden = !msg;
  }

  function incluirOcorrencia() {
    u.limparErro();
    var f = funcionario($("oc-func").value);
    if (!f) { u.mostrarErro({ message: "Escolha o funcionário (cadastre na aba Funcionários)." }); return; }
    var t = $("oc-data").value;
    if (!t) { u.mostrarErro({ message: "Preencha a data." }); return; }
    var comDias = ocTipo === "atestado" || ocTipo === "suspensao";
    var dias = comDias ? parseInt($("oc-dias").value, 10) : 1;
    var max = ocTipo === "suspensao" ? 30 : 365;
    if (!(dias >= 1 && dias <= max)) { u.mostrarErro({ message: "Dias: de 1 a " + max + "." }); return; }
    var motivo = $("oc-motivo").value.trim();
    if ((ocTipo === "advertencia" || ocTipo === "suspensao") && !motivo) { u.mostrarErro({ message: "Escreva o motivo: ele vai no documento que o funcionário assina." }); return; }
    var dados = { funcionario: f.id, tipo: ocTipo, data: t, dias: dias, justificada: ocTipo === "falta" && $("oc-justificada").checked,
      banco: (ocTipo === "folga" || ocTipo === "feriado_trabalhado") && $("oc-banco").checked, motivo: motivo };
    var b = $("oc-incluir");
    u.ocupado(b, true, "Salvando…");
    u.db.salvarRH("ocorrencias", dados).then(function (salvo) {
      u.toast(NOMES_TIPO[ocTipo] + " registrada: " + primeiroNome(f.nome) + " · " + u.dataBR(t));
      $("oc-motivo").value = "";
      $("oc-justificada").checked = false;
      $("oc-banco").checked = false;
      $("oc-dias").value = "1";
      $("oc-mes").value = t.slice(0, 7);
      if ((ocTipo === "advertencia" || ocTipo === "suspensao") && confirm("Gerar o documento para imprimir e assinar?")) imprimirMedida(salvo || dados);
      return carregar(true).then(desenharOcorrencias);
    }, u.mostrarErro).then(function () { u.ocupado(b, false); });
  }

  function imprimirMedida(o) {
    var f = funcionario(o.funcionario);
    if (!f) return;
    u.pdfTexto(RF.textoMedida(empresa(), f, o), o.tipo + "_" + primeiroNome(f.nome).toLowerCase() + "_" + o.data + ".pdf");
  }

  function desenharListaOcorrencias() {
    var m = $("oc-mes").value || mesAtual();
    var am = anoMes(m), dias = RH.diasDoMes(am.ano, am.mes), ini = dias[0], fim = dias[dias.length - 1];
    var lista = d.ocorrencias.filter(function (o) {
      var ate = o.tipo === "atestado" || o.tipo === "suspensao" ? window.Feriados.somarDias(o.data, (+o.dias || 1) - 1) : o.data;
      return o.data <= fim && ate >= ini;
    }).sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : 0; });
    $("oc-lista").innerHTML = lista.length ? '<ul class="lista-versoes">' + lista.map(function (o) {
      var f = funcionario(o.funcionario);
      var det = o.tipo === "atestado" || o.tipo === "suspensao" ? " · " + o.dias + (+o.dias === 1 ? " dia" : " dias") :
        o.tipo === "falta" ? (o.justificada ? " · justificada" : " · sem justificativa") : o.banco ? " · banco de horas" : "";
      var imprimir = o.tipo === "advertencia" || o.tipo === "suspensao";
      return "<li><div><strong>" + esc(u.dataBR(o.data).slice(0, 5)) + " · " + esc(NOMES_TIPO[o.tipo]) + "</strong>" + esc(det) + "<br>" +
        esc(f ? f.nome : "?") + (o.motivo ? ' <small class="suave">' + esc(o.motivo) + "</small>" : "") + "</div>" +
        '<span class="lista-botoes">' + (imprimir ? '<button type="button" class="botao pequeno" data-imprimir-oc="' + esc(o.id) + '">Imprimir</button>' : "") +
        '<button type="button" class="botao pequeno" data-apagar-oc="' + esc(o.id) + '" aria-label="Apagar">×</button></span></li>';
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
    var fimMes = RH.diasDoMes(am.ano, am.mes).pop();
    $("res-conteudo").innerHTML = '<h2 style="margin:4px 0 10px">' + esc(RH.rotuloMes(am.ano, am.mes)) + "</h2>" + (rs.length ? rs.map(function (r) {
      var f = r.funcionario;
      var bh = RF.saldoBanco(ctx(), f, fimMes < hoje() ? fimMes : hoje(), d.cfg);
      function item(rotulo, valor) { return '<div class="linha-info"><span>' + rotulo + "</span><strong>" + valor + "</strong></div>"; }
      return '<div class="bloco"><h2>' + esc(f.nome) + (f.funcao ? ' <small class="suave">' + esc(f.funcao) + "</small>" : "") + "</h2>" +
        item("Faltas", r.faltas.length ? r.faltas.length + " (" + r.faltasJustificadas + " justificada" + (r.faltasJustificadas === 1 ? "" : "s") + ")" : "0") +
        item("Dias de atestado", String(r.diasAtestado)) +
        item("Folgas", String(r.folgas.length)) +
        item("Feriados trabalhados", r.feriadosTrabalhados.length ? r.feriadosTrabalhados.map(function (x) { return u.dataBR(x.data).slice(0, 5); }).join(", ") : "0") +
        (r.diasFerias ? item("Dias de férias", String(r.diasFerias)) : "") +
        (r.suspensoes.length ? item("Dias de suspensão", String(r.diasSuspensao)) : "") +
        (r.advertencias.length ? item("Advertências", String(r.advertencias.length)) : "") +
        (r.elogios.length ? item("Elogios", String(r.elogios.length)) : "") +
        item("Banco de horas (saldo)", esc(sinalHoras(bh.saldo))) +
        item("Dias na escala", r.trabalhados + " (" + RH.horas(r.minutos) + ")") +
        '<div class="linha-info"><span>Holerite</span>' + (r.holerite ? "<strong>Recebido em " + esc(u.dataBR(r.holerite.recebido_em)) + "</strong>"
          : '<span class="holerite-registrar"><input type="date" value="' + hoje() + '" aria-label="Data em que o holerite chegou" data-holerite-data="' + esc(f.id) + '" />' +
            '<button type="button" class="botao pequeno" data-holerite="' + esc(f.id) + '" data-ref="' + ref + '">Recebi</button></span>') + "</div>" +
        "</div>";
    }).join("") : '<p class="vazio">Nenhum funcionário ativo em ' + esc(RH.rotuloMes(am.ano, am.mes)) + ".</p>");
  }

  function sinalHoras(min) { return min === 0 ? "0h" : (min > 0 ? "+" : "−") + RH.horas(Math.abs(min)); }

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
    $("rh-calcular-rescisao").addEventListener("click", calcularRescisao);
    $("rh-desligamento").addEventListener("change", desenharPassos);
    $("rh-passos").addEventListener("change", function (ev) {
      var c = ev.target.closest("[data-passo]");
      if (c) passos[c.dataset.passo] = c.checked;
    });
    ["rh-salario", "rh-gratificacao", "rh-fgts"].forEach(function (id) {
      $(id).addEventListener("blur", function () {
        var c = C.reaisParaCentavos($(id).value);
        if (c != null && $(id).value.trim()) $(id).value = u.dinheiroCampo(c);
      });
    });
    $("rh-cpf").addEventListener("blur", function () {
      var c = RF.soNumeros($("rh-cpf").value);
      if (c.length === 11) $("rh-cpf").value = RF.formatarCPF(c);
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
    // exportar
    $("rh-csv-func").addEventListener("click", function () {
      u.baixar("funcionarios_" + hoje() + ".csv", RF.csvFuncionarios(d.funcionarios.slice().sort(porNome), d.turmas), "text/csv;charset=utf-8");
    });
    $("rh-csv-oc").addEventListener("click", function () {
      u.baixar("ocorrencias_" + hoje() + ".csv", RF.csvOcorrencias(d.ocorrencias, d.funcionarios), "text/csv;charset=utf-8");
    });
    $("rh-csv-banco").addEventListener("click", function () {
      u.baixar("banco_de_horas_" + hoje() + ".csv", RF.csvBanco(ctx(), d.funcionarios.slice().sort(porNome)), "text/csv;charset=utf-8");
    });
    // escala
    $("esc-anterior").addEventListener("click", function () { semana = window.Feriados.somarDias(semana, -7); desenharEscala(); });
    $("esc-proxima").addEventListener("click", function () { semana = window.Feriados.somarDias(semana, 7); desenharEscala(); });
    $("esc-copiar").addEventListener("click", function () { u.copiar(RH.textoEscalaSemana(ctx(), ativos(), semana)); });
    $("esc-pdf").addEventListener("click", pdfEscala);
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
    $("esc-sabado").addEventListener("change", function (ev) {
      var s = ev.target.closest("[data-sab-semana]");
      if (!s) return;
      semanasSabado()[+s.dataset.sabSemana][s.dataset.sabFunc] = s.value;
      desenharSabado();
    });
    $("esc-sabado").addEventListener("click", function (ev) {
      var b = ev.target.closest("button");
      if (!b) return;
      if (b.id === "sab-mais") { semanasSabado().push({}); desenharSabado(); }
      if (b.id === "sab-menos") { semanasSabado().pop(); desenharSabado(); }
      if (b.id === "sab-salvar") salvarSabado();
    });
    $("esc-banco").addEventListener("click", function (ev) {
      if (ev.target.id === "bh-salvar") salvarInicioBanco();
    });
    $("esc-turmas").addEventListener("click", function (ev) {
      var s = ev.target.closest("[data-salvar-turma]"), a = ev.target.closest("[data-apagar-turma]");
      if (s) salvarTurma(s.dataset.salvarTurma);
      if (a && confirm("Apagar esta turma? Quem está nela fica sem turma.")) {
        u.db.apagarRH("turmas", a.dataset.apagarTurma).then(function () { return carregar(true).then(desenharEscala); }, u.mostrarErro);
      }
    });
    // ocorrências
    ["oc-tipo", "oc-tipo2"].forEach(function (id) {
      $(id).addEventListener("click", function (ev) {
        var b = ev.target.closest("button[data-valor]");
        if (b) escolherTipo(b.dataset.valor);
      });
    });
    ["oc-data", "oc-func", "oc-banco"].forEach(function (id) { $(id).addEventListener("change", avisoOcorrencia); });
    $("oc-incluir").addEventListener("click", incluirOcorrencia);
    $("oc-mes").addEventListener("change", function () { desenharListaOcorrencias(); desenharFeriados(); });
    $("oc-lista").addEventListener("click", function (ev) {
      var p = ev.target.closest("[data-imprimir-oc]");
      if (p) { imprimirMedida(d.ocorrencias.filter(function (o) { return o.id === p.dataset.imprimirOc; })[0]); return; }
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
    if (window.RHGestao) window.RHGestao.iniciar(base);
  }

  // o que rh-gestao.js usa
  var base = {
    d: d, u: function () { return u; }, carregar: carregar, ctx: ctx, ativos: ativos, funcionario: funcionario, primeiroNome: primeiroNome,
    porNome: porNome, opcoesFuncionarios: opcoesFuncionarios, empresa: empresa, sinalHoras: sinalHoras, hoje: hoje, esc: function (s) { return esc(s); }
  };

  window.RHAdmin = { iniciar: iniciar, mostrar: mostrar, base: base };
})();
