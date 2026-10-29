/*
 * Valor em reais por extenso, para cheques e recibos.
 * Recebe CENTAVOS inteiros (ex.: 147500 = R$ 1.475,00). Usado no navegador e nos testes em Node.
 *
 *   Extenso.reais(147500) -> "mil quatrocentos e setenta e cinco reais"
 *   Extenso.reais(150000) -> "mil e quinhentos reais"
 *   Extenso.reais(100000000) -> "um milhão de reais"
 */
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica();
  else raiz.Extenso = fabrica();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove",
    "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
  var DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
  var CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos",
    "setecentos", "oitocentos", "novecentos"];

  // 0 a 999
  function ate999(n) {
    if (n === 0) return "";
    if (n === 100) return "cem";
    var partes = [];
    var c = Math.floor(n / 100), resto = n % 100;
    if (c) partes.push(CENTENAS[c]);
    if (resto) {
      if (resto < 20) partes.push(UNIDADES[resto]);
      else {
        var d = Math.floor(resto / 10), u = resto % 10;
        partes.push(u ? DEZENAS[d] + " e " + UNIDADES[u] : DEZENAS[d]);
      }
    }
    return partes.join(" e ");
  }

  var ESCALAS = [
    { valor: 1e12, um: "trilhão", varios: "trilhões" },
    { valor: 1e9, um: "bilhão", varios: "bilhões" },
    { valor: 1e6, um: "milhão", varios: "milhões" },
    { valor: 1e3, um: "mil", varios: "mil" }
  ];

  // Número inteiro por extenso ("mil quatrocentos e setenta e cinco")
  function inteiro(n) {
    n = Math.floor(Math.abs(n));
    if (n === 0) return "zero";
    var grupos = [];
    ESCALAS.forEach(function (e) {
      var q = Math.floor(n / e.valor);
      n = n % e.valor;
      if (!q) return;
      var texto;
      if (e.valor === 1e3) texto = q === 1 ? "mil" : ate999(q) + " mil";
      else texto = (q === 1 ? "um " + e.um : inteiro(q) + " " + e.varios);
      grupos.push({ texto: texto, valor: q });
    });
    if (n) grupos.push({ texto: ate999(n), valor: n });
    if (grupos.length === 1) return grupos[0].texto;
    // "e" antes do último grupo quando ele é menor que 100 ou uma centena redonda:
    // mil e quinhentos, dois mil e um, mas mil quatrocentos e setenta e cinco
    var ultimo = grupos[grupos.length - 1];
    var usarE = ultimo.valor < 100 || ultimo.valor % 100 === 0;
    var inicio = grupos.slice(0, -1).map(function (g) { return g.texto; }).join(" ");
    return inicio + (usarE ? " e " : " ") + ultimo.texto;
  }

  function reais(centavos) {
    centavos = Math.round(Number(centavos) || 0);
    if (centavos < 0) centavos = -centavos;
    var r = Math.floor(centavos / 100);
    var c = centavos % 100;
    if (r === 0 && c === 0) return "zero reais";
    var partes = [];
    if (r) {
      var moeda = r === 1 ? "real" : "reais";
      // "um milhão de reais", "dois bilhões de reais"
      if (r >= 1e6 && r % 1e6 === 0) moeda = "de reais";
      partes.push(inteiro(r) + " " + moeda);
    }
    if (c) partes.push(inteiro(c) + (c === 1 ? " centavo" : " centavos"));
    return partes.join(" e ");
  }

  return { reais: reais, inteiro: inteiro };
});
