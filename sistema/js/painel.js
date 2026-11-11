/*
 * Visão geral: indicadores do dia e "O que precisa de atenção". Funções puras (navegador e Node), só com
 * dados reais do sistema (nada inventado: sem dado, o item simplesmente não aparece).
 */
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica(require("./calculos.js"));
  else raiz.Painel = fabrica(raiz.Calculos);
})(typeof self !== "undefined" ? self : this, function (C) {
  "use strict";

  var ORDEM = { erro: 0, aviso: 1, info: 2 };

  function somarDias(t, n) {
    var p = String(t).split("-"), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
    return d.toISOString().slice(0, 10);
  }
  function diasEntre(de, ate) {
    var r = [];
    for (var t = de; t <= ate; t = somarDias(t, 1)) r.push(t);
    return r;
  }
  function diaMes(t) { return C.dataBR(t).slice(0, 5); }
  function lista(itens, max) {
    max = max || 3;
    return itens.length > max ? itens.slice(0, max).join(", ") + " e mais " + (itens.length - max) : itens.join(", ");
  }
  function nomeCaixa(caixas, id) { var c = (caixas || []).filter(function (x) { return x.id === id; })[0]; return c ? (c.curto || c.id) : id; }

  // Diferença do dinheiro por dia (soma dos fechamentos com diferença calculada; pendentes à parte)
  function diferencasPorDia(conferencias, de, ate) {
    return diasEntre(de, ate).map(function (t) {
      var f = (conferencias || []).filter(function (c) { return c.tipo === "fechamento" && c.data === t; });
      var calc = f.filter(function (c) { return c.pendente !== true && c.diferenca_centavos != null; });
      return { data: t, fechamentos: f.length, pendentes: f.length - calc.length,
        diferenca: calc.length ? calc.reduce(function (s, c) { return s + c.diferenca_centavos; }, 0) : null };
    });
  }

  // Números do alto da Visão geral
  function indicadores(p) {
    var sits = (p.caixas || []).map(function (cx) { return C.situacaoDoCaixa(p.conferencias, cx.id, p.hoje); });
    var dias = diferencasPorDia(p.conferencias, somarDias(p.hoje, -30), p.hoje).filter(function (d) { return d.diferenca != null; });
    var ultimo = dias[dias.length - 1] || null;
    return {
      caixas: { total: sits.length, fechados: sits.filter(function (s) { return s.estado === "fechado"; }).length,
        abertos: sits.filter(function (s) { return s.estado === "aberto"; }).length },
      ultimoDia: ultimo,
      escutaNovas: p.escutaNovas == null ? null : p.escutaNovas,
      equipe: p.equipe ? { naEscala: p.equipe.trabalhando.length, ausentes: p.equipe.faltas.length + p.equipe.atestados.length,
        folgas: p.equipe.folgas.length } : null
    };
  }

  /*
   * "O que precisa de atenção": [{ nivel: erro|aviso|info, icone, titulo, detalhe, link, data? }]
   * p = { hoje, caixas, conferencias (últimos dias), cielo: {data: n}, banco: {data: n}, quadros: [{data, quadro}],
   *       escutaNovas, equipe (RH.equipeDoDia), holerites: { rotulo, faltando: [nomes] } }
   */
  function atencao(p) {
    var r = [], hoje = p.hoje, caixas = p.caixas || [], confs = p.conferencias || [];
    var brl = C.formatarBRL;
    // caixas abertos hoje
    caixas.forEach(function (cx) {
      var s = C.situacaoDoCaixa(confs, cx.id, hoje);
      if (s.estado === "aberto") {
        r.push({ nivel: "info", icone: "caixa", titulo: (cx.curto || cx.id) + " aberto desde " + C.horaCurta(s.ultima.hora),
          detalhe: "Feche o caixa no fim do turno.", link: "#caixa" });
      }
    });
    // caixas que ficaram abertos em dias anteriores
    var diasConf = {};
    confs.forEach(function (c) { if (c.data < hoje) diasConf[c.data] = true; });
    Object.keys(diasConf).sort().reverse().forEach(function (t) {
      caixas.forEach(function (cx) {
        var s = C.situacaoDoCaixa(confs, cx.id, t);
        if (s.estado === "aberto") {
          r.push({ nivel: "aviso", icone: "relogio", titulo: (cx.curto || cx.id) + " ficou aberto em " + diaMes(t),
            detalhe: "Tem abertura às " + C.horaCurta(s.ultima.hora) + " e nenhum fechamento depois.", link: "#historico" });
        }
      });
    });
    // fechamentos esperando o cupom
    var pend = confs.filter(function (c) { return C.ehPendente(c); })
      .sort(function (a, b) { return (b.data + b.hora).localeCompare(a.data + a.hora); });
    if (pend.length) {
      r.push({ nivel: "aviso", icone: "caixa", titulo: pend.length + (pend.length === 1 ? " fechamento sem o cupom do Diamante" : " fechamentos sem o cupom do Diamante"),
        detalhe: lista(pend.map(function (c) { return nomeCaixa(caixas, c.caixa) + " · " + diaMes(c.data); })) + ". Importe o PDF para ver a diferença.",
        link: "#importar" });
    }
    // diferenças do dinheiro nos últimos 3 dias
    confs.filter(function (c) {
      return c.tipo === "fechamento" && c.pendente !== true && c.diferenca_centavos && c.data >= somarDias(hoje, -2);
    }).sort(function (a, b) { return (b.data + b.hora).localeCompare(a.data + a.hora); }).forEach(function (c) {
      var d = c.diferenca_centavos;
      r.push({ nivel: d < 0 ? "erro" : "aviso", icone: "alerta",
        titulo: nomeCaixa(caixas, c.caixa) + " fechou com " + (d < 0 ? "falta" : "sobra") + " de " + brl(Math.abs(d)),
        detalhe: diaMes(c.data) + " · fechado às " + C.horaCurta(c.hora) + (c.operador ? " · " + c.operador : ""),
        link: "#conferir", data: c.data });
    });
    // arquivos que faltam importar (dias com fechamento com cupom)
    var comCupom = {};
    confs.forEach(function (c) { if (c.tipo === "fechamento" && c.cupom && c.data >= somarDias(hoje, -7)) comCupom[c.data] = true; });
    var dias = Object.keys(comCupom).sort().reverse();
    var semCielo = dias.filter(function (t) { return p.cielo && !p.cielo[t]; });
    var semBanco = dias.filter(function (t) { return p.banco && !p.banco[t] && t < hoje; });
    if (semCielo.length) r.push({ nivel: "aviso", icone: "cartao", titulo: "Vendas da Cielo não importadas",
      detalhe: "Dias com fechamento: " + lista(semCielo.map(diaMes)) + ".", link: "#importar" });
    if (semBanco.length) r.push({ nivel: "aviso", icone: "banco", titulo: "Extrato do Banco do Brasil não importado",
      detalhe: "Dias com fechamento: " + lista(semBanco.map(diaMes)) + ".", link: "#importar" });
    // cartões e PIX com diferença no dia
    (p.quadros || []).forEach(function (x) {
      var q = x.quadro, partes = [];
      if (!q || !q.temCielo) return;
      [["debito", "Débito"], ["credito", "Crédito"], ["pix", "PIX maquininha"]].forEach(function (f) {
        var v = q.dia[f[0]];
        if (v) partes.push(f[1] + ": Cielo " + brl(Math.abs(v)) + (v > 0 ? " a mais" : " a menos"));
      });
      if (q.pixDelivery && q.pixDelivery.diferenca) {
        partes.push("PIX Delivery: BB " + brl(Math.abs(q.pixDelivery.diferenca)) + (q.pixDelivery.diferenca > 0 ? " a mais" : " a menos"));
      }
      if (partes.length) r.push({ nivel: "aviso", icone: "cartao", titulo: "Cartões e PIX de " + diaMes(x.data) + " com diferença",
        detalhe: partes.join("; ") + ".", link: "#conferir", data: x.data });
    });
    // Veneza Escuta
    if (p.escutaNovas > 0) r.push({ nivel: "info", icone: "mensagem",
      titulo: p.escutaNovas + (p.escutaNovas === 1 ? " mensagem nova" : " mensagens novas") + " no Veneza Escuta",
      detalhe: "Sugestões, reclamações, elogios e produtos em falta.", link: "#escuta-mensagens" });
    // RH
    var e = p.equipe;
    if (e && e.faltas.length) r.push({ nivel: "aviso", icone: "pessoas", titulo: e.faltas.length + (e.faltas.length === 1 ? " falta hoje" : " faltas hoje"),
      detalhe: lista(e.faltas.map(function (x) { return x.nome; })) + ".", link: "#rh-ocorrencias" });
    if (e && e.atestados.length) r.push({ nivel: "info", icone: "pessoas", titulo: "Atestado hoje",
      detalhe: lista(e.atestados.map(function (x) { return x.nome; })) + ".", link: "#rh-ocorrencias" });
    if (p.holerites && p.holerites.faltando.length) r.push({ nivel: "info", icone: "pessoas",
      titulo: "Holerite de " + p.holerites.rotulo + " não registrado",
      detalhe: lista(p.holerites.faltando) + ".", link: "#rh-resumo" });
    return r.map(function (x, i) { x._i = i; return x; }).sort(function (a, b) { return ORDEM[a.nivel] - ORDEM[b.nivel] || a._i - b._i; })
      .map(function (x) { delete x._i; return x; });
  }

  return { somarDias: somarDias, diasEntre: diasEntre, diferencasPorDia: diferencasPorDia, indicadores: indicadores, atencao: atencao };
});
