/*
 * Visão geral (#visao): indicadores do dia, "O que precisa de atenção" e a diferença do dinheiro por dia.
 * As contas ficam em painel.js; aqui só busca os dados e desenha. Sem dado, não inventa número.
 */
(function () {
  "use strict";
  var P = window.Painel, C = window.Calculos, RH = window.RH, IV = window.Investigar;
  var u = null;
  var pedido = 0;
  var itensAtencao = [];

  var ICONES = {
    alerta: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.5"/>',
    relogio: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    caixa: '<rect x="3" y="11" width="18" height="9" rx="2"/><path d="M7 11V5h10v6"/>',
    cartao: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/>',
    banco: '<path d="M3 9.5 12 4l9 5.5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>',
    mensagem: '<path d="M4 5h16v11H9l-5 4z"/>',
    pessoas: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/>',
    ok: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    seta: '<path d="m9 5 7 7-7 7"/>'
  };
  function icone(n) { return '<svg class="icone" viewBox="0 0 24 24" aria-hidden="true">' + (ICONES[n] || "") + "</svg>"; }
  function esc(s) { return u.escapar(s); }
  function brl(c) { return C.formatarBRL(c); }

  function seguro(promessa, padrao) { return promessa.then(function (x) { return x; }, function () { return padrao; }); }

  function carregar() {
    var hoje = u.hojeISO(), de14 = P.somarDias(hoje, -14), de7 = P.somarDias(hoje, -7);
    var meu = ++pedido;
    var el = $("visao-conteudo");
    if (!el.dataset.pronto) el.innerHTML = '<p class="vazio">Carregando…</p>';
    var rhNomes = ["funcionarios", "turmas", "horarios", "ocorrencias", "feriados", "holerites"];
    Promise.all([
      u.db.listarConferencias({ de: de14, ate: hoje }),
      seguro(u.db.listarCielo({ de: de7, ate: hoje }), null),
      seguro(u.db.listarBanco({ de: de7, ate: hoje }), null),
      seguro(u.db.listarMaquinas(), []),
      seguro(u.db.listarTrocas({ de: de7, ate: hoje }), []),
      seguro(u.escuta ? u.escuta.resumo() : Promise.reject(), null),
      seguro(Promise.all(rhNomes.map(function (n) { return u.db.listarRH(n); }).concat([u.db.obterConfiguracao("rh_semana_ref")])), null)
    ]).then(function (r) {
      if (meu !== pedido) return;
      desenhar(hoje, { confs: r[0] || [], cielo: r[1], banco: r[2], maquinas: r[3] || [], trocas: r[4] || [],
        escuta: r[5], rh: r[6] ? (function () { var o = {}; rhNomes.forEach(function (n, i) { o[n] = r[6][i] || []; }); o.ref = r[6][rhNomes.length]; return o; })() : null });
    }, function (e) {
      if (meu !== pedido) return;
      el.innerHTML = '<p class="vazio">Não foi possível carregar a visão geral.</p>';
      u.mostrarErro(e);
    });
  }
  function $(id) { return document.getElementById(id); }

  function contarPorDia(lista) {
    if (!lista) return null;
    var o = {};
    lista.forEach(function (x) { o[x.data] = (o[x.data] || 0) + 1; });
    return o;
  }

  function desenhar(hoje, d) {
    // RH: equipe de hoje e holerites do mês passado
    var equipe = null, holerites = null;
    if (d.rh && d.rh.funcionarios.length) {
      var ctx = { turmas: d.rh.turmas, horarios: d.rh.horarios, ref: d.rh.ref || RH.segundaDaSemana(hoje),
        ocorrencias: d.rh.ocorrencias, feriados: d.rh.feriados };
      var ativos = d.rh.funcionarios.filter(function (f) { return !f.desligamento || f.desligamento >= hoje; });
      equipe = RH.equipeDoDia(ctx, ativos, hoje);
      var p = hoje.split("-"), ano = +p[0], mes = +p[1] - 1;
      if (mes === 0) { mes = 12; ano--; }
      if (+p[2] >= 5) {
        var ref = ano + "-" + (mes < 10 ? "0" : "") + mes + "-01";
        holerites = { rotulo: RH.MESES[mes - 1], faltando: RH.ativosNoMes(d.rh.funcionarios, ano, mes).filter(function (f) {
          return !d.rh.holerites.some(function (h) { return h.funcionario === f.id && h.referencia === ref; });
        }).map(function (f) { return f.nome; }) };
      }
    }
    // Conferir dos últimos 3 dias com cupom e Cielo importada
    var quadros = [];
    if (d.cielo) {
      var dias = {};
      d.confs.forEach(function (c) { if (c.tipo === "fechamento" && c.cupom && c.data >= P.somarDias(hoje, -2)) dias[c.data] = true; });
      Object.keys(dias).sort().reverse().forEach(function (t) {
        quadros.push({ data: t, quadro: IV.quadroDoDia({ caixas: u.caixas, conferencias: d.confs, vendas: d.cielo, maquinas: d.maquinas,
          trocas: d.trocas, banco: d.banco || [], data: t, cielo: window.Cielo, bancoBB: window.Banco }) });
      });
    }
    var escutaNovas = d.escuta ? +d.escuta.novo || 0 : null;
    var base = { hoje: hoje, caixas: u.caixas, conferencias: d.confs, escutaNovas: escutaNovas, equipe: equipe };
    var ind = P.indicadores(base);
    itensAtencao = P.atencao(Object.assign({}, base, { cielo: contarPorDia(d.cielo), banco: contarPorDia(d.banco), quadros: quadros, holerites: holerites }));
    var difs = P.diferencasPorDia(d.confs, P.somarDias(hoje, -13), hoje);

    var html = '<div class="kpis">' +
      kpi("Caixas hoje", ind.caixas.fechados + " de " + ind.caixas.total + " fechados",
        ind.caixas.abertos ? ind.caixas.abertos + (ind.caixas.abertos === 1 ? " aberto agora" : " abertos agora") : "Nenhum aberto agora", "#caixa") +
      (ind.ultimoDia ? kpi("Dinheiro · " + u.dataBR(ind.ultimoDia.data).slice(0, 5), textoDif(ind.ultimoDia.diferenca),
        ind.ultimoDia.fechamentos + (ind.ultimoDia.fechamentos === 1 ? " fechamento" : " fechamentos") +
        (ind.ultimoDia.pendentes ? " · " + ind.ultimoDia.pendentes + " sem cupom" : ""), "#conferir", classeDif(ind.ultimoDia.diferenca), ind.ultimoDia.data)
        : kpi("Dinheiro", "Sem dados", "Ainda não há fechamento com cupom", "#caixa")) +
      kpi("Mensagens novas", escutaNovas == null ? "—" : String(escutaNovas), "Veneza Escuta", "#escuta-mensagens") +
      (ind.equipe ? kpi("Equipe hoje", ind.equipe.naEscala + " na escala",
        ind.equipe.ausentes ? ind.equipe.ausentes + (ind.equipe.ausentes === 1 ? " ausente" : " ausentes") : "Ninguém ausente", "#rh-escala")
        : kpi("Equipe hoje", "—", "Cadastre a equipe em RH", "#rh")) +
      "</div>";

    html += '<div class="visao-grade">' +
      '<section class="bloco"><h2>Diferença do dinheiro por dia</h2><p class="muted small">Últimos 14 dias · soma dos caixas (fechamentos com cupom)</p>' +
      '<div class="grafico-caixa"></div>' + "</section>" +
      '<section class="bloco"><h2>O que precisa de atenção</h2>' +
      (itensAtencao.length ? '<ul class="atencao">' + itensAtencao.map(function (x, i) {
        return '<li><a href="' + esc(x.link) + '" class="atencao-item" data-item="' + i + '"><span class="atencao-icone nivel-' + x.nivel + '">' + icone(x.icone) + "</span>" +
          '<span class="atencao-texto"><strong>' + esc(x.titulo) + "</strong><span>" + esc(x.detalhe) + "</span></span>" + icone("seta") + "</a></li>";
      }).join("") + "</ul>"
        : '<div class="tudo-certo">' + icone("ok") + "<div><strong>Tudo em dia</strong><p class=\"muted small\">Nenhum caixa aberto de dias anteriores, nenhum cupom faltando e nenhuma diferença recente.</p></div></div>") +
      "</section></div>";
    var el = $("visao-conteudo");
    el.innerHTML = html;
    el.dataset.pronto = "1";
    // o gráfico é desenhado na largura que sobrou (1 unidade = 1 pixel: letras do mesmo tamanho no celular e no computador)
    var caixaG = el.querySelector(".grafico-caixa");
    caixaG.innerHTML = grafico(difs, caixaG.clientWidth || 320);
    // números nas áreas do menu
    marcar("caixa", itensAtencao.filter(function (x) { return /#(caixa|historico|importar|conferir)/.test(x.link) && x.nivel !== "info"; }).length);
    marcar("escuta", escutaNovas || 0);
    marcar("rh", equipe ? equipe.faltas.length : 0);
  }

  function marcar(modulo, n) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-badge="' + modulo + '"]'), function (b) {
      b.textContent = n > 99 ? "99+" : String(n);
      b.hidden = !n;
    });
  }

  function textoDif(v) { return v === 0 ? "Caixa bateu" : (v > 0 ? "Sobra de " : "Falta de ") + brl(Math.abs(v)); }
  function classeDif(v) { return v === 0 ? "ok" : v > 0 ? "aviso" : "erro"; }
  function kpi(rotulo, valor, sub, link, classe, data) {
    return '<a class="kpi" href="' + link + '"' + (data ? ' data-ir-data="' + data + '"' : "") + '><span class="kpi-rotulo">' + esc(rotulo) + "</span>" +
      '<span class="kpi-valor' + (classe ? " kpi-" + classe : "") + '">' + esc(valor) + '</span><span class="kpi-sub">' + esc(sub) + "</span></a>";
  }

  // Barras da diferença por dia (positivo = sobra, negativo = falta), em SVG, sem biblioteca
  function grafico(difs, largura) {
    var com = difs.filter(function (x) { return x.diferenca != null; });
    if (!com.length) return '<p class="vazio">Ainda não há fechamentos com cupom nestes dias.</p>';
    var max = Math.max.apply(null, com.map(function (x) { return Math.abs(x.diferenca); }).concat([100]));
    var W = Math.max(280, Math.round(largura)), H = 180, top = 10, base = 22, alt = H - top - base, meio = top + alt / 2, larg = W / difs.length;
    var passo = larg < 30 ? 2 : 1;
    var barras = difs.map(function (x, i) {
      var cx = i * larg, rot = (difs.length - 1 - i) % passo ? "" : '<text x="' + (cx + larg / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + x.data.slice(8) + "</text>";
      if (x.diferenca == null) return rot;
      var h = Math.max(2, Math.abs(x.diferenca) / max * (alt / 2 - 4));
      var y = x.diferenca >= 0 ? meio - h : meio;
      var cls = x.diferenca === 0 ? "barra-zero" : x.diferenca > 0 ? "barra-sobra" : "barra-falta";
      return '<rect class="' + cls + '" x="' + (cx + larg * 0.18) + '" y="' + y + '" width="' + (larg * 0.64) + '" height="' + h + '" rx="3">' +
        "<title>" + u.dataBR(x.data) + ": " + textoDif(x.diferenca) + "</title></rect>" + rot;
    }).join("");
    return '<svg class="grafico-dif" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Diferença do dinheiro por dia">' +
      '<line class="grade" x1="0" x2="' + W + '" y1="' + meio + '" y2="' + meio + '"/>' + barras + "</svg>" +
      '<p class="muted xs">Verde = sobra · vermelho = falta · maior diferença: ' + esc(brl(max)) + ". Toque numa barra para ver o valor.</p>";
  }

  function iniciar(utilidades) {
    u = utilidades;
    $("visao-conteudo").addEventListener("click", function (ev) {
      var a = ev.target.closest("[data-item], [data-ir-data]");
      if (!a) return;
      var data = a.dataset.irData || (itensAtencao[+a.dataset.item] || {}).data;
      if (data && a.getAttribute("href") === "#conferir") { ev.preventDefault(); window.Conferir.irPara(data); }
    });
  }

  window.Visao = { iniciar: iniciar, mostrar: carregar };
})();
