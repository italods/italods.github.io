/*
 * Cálculos do Sistema Veneza.
 * Funções puras, sem tela e sem banco: rodam no navegador e no Node (testes).
 * Todo valor em dinheiro é um número inteiro de CENTAVOS. Nunca usar float para somar.
 */
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica();
  else raiz.Calculos = fabrica();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Valores em centavos
  var CEDULAS = [200, 500, 1000, 2000, 5000, 10000];
  var MOEDAS = [5, 10, 25, 50, 100];
  var FUNDO_PADRAO = 30000; // R$ 300,00
  var TROCO_PADRAO = 30000; // R$ 300,00

  function inteiro(n) {
    n = Number(n);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }

  // Quantidade digitada: só inteiros >= 0
  function quantidade(n) {
    var q = inteiro(n);
    return q > 0 ? q : 0;
  }

  // contagem = { "200": 25, "5000": 9, ... } (chave = valor em centavos)
  function calcularContagem(contagem) {
    contagem = contagem || {};
    function linhas(valores) {
      return valores.map(function (v) {
        var q = quantidade(contagem[v]);
        return { valor: v, quantidade: q, subtotal: v * q };
      });
    }
    function soma(ls) {
      return ls.reduce(function (s, l) { return s + l.subtotal; }, 0);
    }
    var cedulas = linhas(CEDULAS);
    var moedas = linhas(MOEDAS);
    var totalCedulas = soma(cedulas);
    var totalMoedas = soma(moedas);
    return {
      cedulas: cedulas,
      moedas: moedas,
      totalCedulas: totalCedulas,
      totalMoedas: totalMoedas,
      total: totalCedulas + totalMoedas
    };
  }

  // Esperado = Fundo + Vendas em dinheiro + Recebimentos em dinheiro + Suprimentos − Sangrias
  function calcularEsperado(p) {
    return inteiro(p.fundo) + inteiro(p.vendas) + inteiro(p.recebimentos) +
      inteiro(p.suprimentos) - inteiro(p.sangrias);
  }

  // Diferença = Contado − Esperado (positivo = sobra, negativo = falta)
  function calcularDiferenca(contado, esperado) {
    return inteiro(contado) - inteiro(esperado);
  }

  function classificarDiferenca(dif) {
    dif = inteiro(dif);
    if (dif > 0) return "sobra";
    if (dif < 0) return "falta";
    return "bateu";
  }

  // Quanto vai para o cofre depois de separar o troco de amanhã
  function calcularCofre(contado, trocoAmanha) {
    return inteiro(contado) - inteiro(trocoAmanha);
  }

  // Soma sangrias e suprimentos de uma lista, opcionalmente filtrando por data e caixa
  function somarMovimentos(movimentos, data, caixa) {
    var r = { sangrias: 0, suprimentos: 0 };
    (movimentos || []).forEach(function (m) {
      if (data && m.data !== data) return;
      if (caixa && m.caixa !== caixa) return;
      if (m.tipo === "sangria") r.sangrias += inteiro(m.valor_centavos);
      else if (m.tipo === "suprimento") r.suprimentos += inteiro(m.valor_centavos);
    });
    return r;
  }

  // Fundo do fechamento = total da última abertura do mesmo caixa no mesmo dia (ou padrão)
  function fundoDoDia(conferencias, data, caixa) {
    var aberturas = (conferencias || []).filter(function (c) {
      return c.tipo === "abertura" && c.data === data && c.caixa === caixa;
    });
    if (!aberturas.length) return FUNDO_PADRAO;
    aberturas.sort(function (a, b) { return String(a.hora).localeCompare(String(b.hora)); });
    return inteiro(aberturas[aberturas.length - 1].total_centavos);
  }

  // Calcula um fechamento completo a partir dos dados digitados
  function calcularFechamento(p) {
    var cont = calcularContagem(p.contagem);
    var contado = p.contado != null ? inteiro(p.contado) : cont.total;
    var esperado = calcularEsperado(p);
    var diferenca = calcularDiferenca(contado, esperado);
    return {
      contado: contado,
      esperado: esperado,
      diferenca: diferenca,
      situacao: classificarDiferenca(diferenca),
      cofre: calcularCofre(contado, p.trocoAmanha == null ? TROCO_PADRAO : p.trocoAmanha)
    };
  }

  /*
   * Converte texto digitado em centavos. Aceita "1.037,08", "1037,08", "1037.08",
   * "R$ 17", "17,5". Devolve null se não for um valor válido (ou negativo).
   */
  function reaisParaCentavos(texto) {
    if (typeof texto === "number") {
      if (!Number.isFinite(texto) || texto < 0) return null;
      texto = texto.toFixed(2);
    }
    var s = String(texto == null ? "" : texto).replace(/R\$/gi, "").replace(/[\s ]/g, "");
    if (s === "") return null;
    var inteiraParte, fracao;
    if (s.indexOf(",") >= 0) {
      if (!/^\d{1,3}(\.\d{3})*(,\d{0,2})?$|^\d+(,\d{0,2})?$/.test(s)) return null;
      var partes = s.replace(/\./g, "").split(",");
      inteiraParte = partes[0];
      fracao = partes[1] || "";
    } else if (/^\d+\.\d{1,2}$/.test(s)) {
      var p2 = s.split(".");
      inteiraParte = p2[0];
      fracao = p2[1];
    } else if (/^\d{1,3}(\.\d{3})+$|^\d+$/.test(s)) {
      inteiraParte = s.replace(/\./g, "");
      fracao = "";
    } else {
      return null;
    }
    fracao = (fracao + "00").slice(0, 2);
    return parseInt(inteiraParte || "0", 10) * 100 + parseInt(fracao, 10);
  }

  // Formata centavos como moeda brasileira (só para mostrar; a conta já foi feita em inteiros)
  function formatarBRL(centavos) {
    return (inteiro(centavos) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
      .replace(/ /g, " ");
  }

  // Valor da cédula/moeda: R$ 2 / R$ 0,25 / R$ 1,00 (como no modelo do WhatsApp)
  function rotuloValor(centavos) {
    if (centavos >= 200) return "R$ " + centavos / 100;
    return formatarBRL(centavos);
  }

  // Data ISO (2026-10-23) -> 23/10/2026
  function dataBR(iso) {
    if (!iso) return "";
    var p = String(iso).slice(0, 10).split("-");
    return p[2] + "/" + p[1] + "/" + p[0];
  }

  // Hora "19:18:00" -> "19:18"
  function horaCurta(h) {
    return String(h || "").slice(0, 5);
  }

  /*
   * Resumo do mês. Recebe conferências e movimentos já filtrados pelo mês.
   * Só fechamentos contam para sobras/faltas.
   */
  function resumoMensal(conferencias, movimentos) {
    function novoGrupo(nome) {
      return { nome: nome, fechamentos: 0, sobras: 0, faltas: 0, saldo: 0, maiorFalta: 0, maiorSobra: 0 };
    }
    function acumular(g, dif) {
      g.fechamentos += 1;
      if (dif > 0) g.sobras += dif;
      if (dif < 0) g.faltas += -dif;
      g.saldo += dif;
      if (dif > g.maiorSobra) g.maiorSobra = dif;
      if (-dif > g.maiorFalta) g.maiorFalta = -dif;
    }

    var porCaixa = {}, porOperador = {}, porDia = {};
    var totais = { sangrias: 0, suprimentos: 0, vendasDinheiro: 0, fechamentos: 0, saldo: 0 };

    (conferencias || []).forEach(function (c) {
      if (c.tipo !== "fechamento") return;
      var dif = inteiro(c.diferenca_centavos);
      var op = (c.operador || "").trim() || "(sem operador)";
      acumular(porCaixa[c.caixa] = porCaixa[c.caixa] || novoGrupo(c.caixa), dif);
      acumular(porOperador[op] = porOperador[op] || novoGrupo(op), dif);
      totais.vendasDinheiro += inteiro(c.vendas_dinheiro_centavos);
      totais.fechamentos += 1;
      totais.saldo += dif;
      var d = porDia[c.data] = porDia[c.data] || { data: c.data, caixas: {}, diferenca: 0, vendasDinheiro: 0, sangrias: 0, suprimentos: 0 };
      d.caixas[c.caixa] = (d.caixas[c.caixa] || 0) + dif;
      d.diferenca += dif;
      d.vendasDinheiro += inteiro(c.vendas_dinheiro_centavos);
    });

    (movimentos || []).forEach(function (m) {
      var v = inteiro(m.valor_centavos);
      var d = porDia[m.data] = porDia[m.data] || { data: m.data, caixas: {}, diferenca: 0, vendasDinheiro: 0, sangrias: 0, suprimentos: 0 };
      if (m.tipo === "sangria") { totais.sangrias += v; d.sangrias += v; }
      if (m.tipo === "suprimento") { totais.suprimentos += v; d.suprimentos += v; }
    });

    function lista(obj) {
      return Object.keys(obj).sort().map(function (k) { return obj[k]; });
    }
    return {
      porCaixa: lista(porCaixa),
      porOperador: lista(porOperador),
      porDia: lista(porDia),
      totais: totais
    };
  }

  return {
    CEDULAS: CEDULAS,
    MOEDAS: MOEDAS,
    FUNDO_PADRAO: FUNDO_PADRAO,
    TROCO_PADRAO: TROCO_PADRAO,
    calcularContagem: calcularContagem,
    calcularEsperado: calcularEsperado,
    calcularDiferenca: calcularDiferenca,
    classificarDiferenca: classificarDiferenca,
    calcularCofre: calcularCofre,
    calcularFechamento: calcularFechamento,
    somarMovimentos: somarMovimentos,
    fundoDoDia: fundoDoDia,
    reaisParaCentavos: reaisParaCentavos,
    formatarBRL: formatarBRL,
    rotuloValor: rotuloValor,
    dataBR: dataBR,
    horaCurta: horaCurta,
    resumoMensal: resumoMensal
  };
});
