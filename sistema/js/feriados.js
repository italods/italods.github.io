/*
 * Feriados nacionais do Brasil e dias úteis. Funções puras (navegador e Node).
 * Usado na conciliação de cartões (prazo "1 dia útil") e, depois, no RH.
 * Datas no formato "AAAA-MM-DD". Feriados estaduais/municipais: passar em "extras".
 */
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica();
  else raiz.Feriados = fabrica();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function iso(d) {
    return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
  }
  function data(t) { var p = String(t).split("-"); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function somarDias(t, n) { var d = data(t); d.setUTCDate(d.getUTCDate() + n); return iso(d); }

  // Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher)
  function pascoa(ano) {
    var a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
    var f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    var mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
    return ano + "-" + String(mes).padStart(2, "0") + "-" + String(dia).padStart(2, "0");
  }

  // { "AAAA-MM-DD": "nome" } dos feriados nacionais do ano (Carnaval entra como ponto facultativo bancário)
  function nacionais(ano) {
    var r = {};
    [["01-01", "Confraternização Universal"], ["04-21", "Tiradentes"], ["05-01", "Dia do Trabalho"],
      ["09-07", "Independência"], ["10-12", "Nossa Senhora Aparecida"], ["11-02", "Finados"],
      ["11-15", "Proclamação da República"], ["11-20", "Dia da Consciência Negra"], ["12-25", "Natal"]]
      .forEach(function (f) { r[ano + "-" + f[0]] = f[1]; });
    var p = pascoa(ano);
    r[somarDias(p, -48)] = "Carnaval (segunda)";
    r[somarDias(p, -47)] = "Carnaval (terça)";
    r[somarDias(p, -2)] = "Sexta-feira Santa";
    r[somarDias(p, 60)] = "Corpus Christi";
    return r;
  }

  function ehFeriado(t, extras) {
    var ano = +String(t).slice(0, 4);
    return !!(nacionais(ano)[t] || (extras && extras[t]));
  }
  function ehDiaUtil(t, extras) {
    var s = data(t).getUTCDay();
    return s !== 0 && s !== 6 && !ehFeriado(t, extras);
  }
  // n-ésimo dia útil depois de t (n = 0 → o próprio dia, se for útil; senão o próximo)
  function diaUtil(t, n, extras) {
    var d = t;
    if (n === 0) { while (!ehDiaUtil(d, extras)) d = somarDias(d, 1); return d; }
    while (n > 0) { d = somarDias(d, 1); if (ehDiaUtil(d, extras)) n--; }
    return d;
  }
  // Quantos dias úteis de a até b (a exclusivo, b inclusivo). Negativo se b < a.
  function diasUteisEntre(a, b, extras) {
    if (a === b) return 0;
    var sinal = b > a ? 1 : -1, d = a, n = 0;
    while (d !== b) { d = somarDias(d, sinal); if (ehDiaUtil(d, extras)) n += sinal; }
    return n;
  }

  return { pascoa: pascoa, nacionais: nacionais, ehFeriado: ehFeriado, ehDiaUtil: ehDiaUtil, diaUtil: diaUtil,
    diasUteisEntre: diasUteisEntre, somarDias: somarDias };
});
