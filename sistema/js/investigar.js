/*
 * "Investigar diferença": procura o que explica a diferença entre o cupom do Diamante e o que entrou
 * (Cielo e Banco do Brasil). Funções puras, centavos inteiros. Só SUGERE: quem decide é o Italo.
 */
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica();
  else raiz.Investigar = fabrica();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var NOMES = { debito: "débito", credito: "crédito", pix: "PIX da maquininha", pix_delivery: "PIX Delivery" };

  function brl(v) { return (v / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
  function minutos(h) {
    var m = /^(\d{1,2}):(\d{2})/.exec(String(h || ""));
    return m ? +m[1] * 60 + +m[2] : null;
  }
  function hora(h) { return String(h || "").slice(0, 5); }

  /*
   * Combinações de até maxItens itens cuja soma é exatamente "alvo". Devolve no máximo "limite" combinações,
   * das menores para as maiores. itens = [{ valor_centavos, ... }]
   */
  function combinacoes(itens, alvo, maxItens, limite) {
    maxItens = maxItens || 3; limite = limite || 5;
    var r = [];
    var lista = (itens || []).filter(function (x) { return x.valor_centavos > 0 && x.valor_centavos <= alvo; });
    if (alvo <= 0) return r;
    for (var k = 1; k <= maxItens && r.length < limite; k++) {
      (function busca(inicio, resto, escolhidos) {
        if (r.length >= limite) return;
        if (escolhidos.length === k) { if (resto === 0) r.push(escolhidos.slice()); return; }
        for (var i = inicio; i < lista.length; i++) {
          if (lista[i].valor_centavos > resto) continue;
          escolhidos.push(lista[i]);
          busca(i + 1, resto - lista[i].valor_centavos, escolhidos);
          escolhidos.pop();
          if (r.length >= limite) return;
        }
      })(0, alvo, []);
    }
    return r;
  }

  function descrever(v) {
    return brl(v.valor_centavos) + " às " + hora(v.hora) + (v.bandeira && v.forma !== "pix" ? " (" + v.bandeira + ")" : "") +
      (v.pagador ? " de " + v.pagador : "");
  }

  /*
   * Explica a diferença de uma forma de cartão/PIX da maquininha (Cielo − Diamante) num caixa e dia.
   * p = { forma, diferenca, vendas: vendas aprovadas da Cielo do caixa (todas as formas),
   *       naoAprovadas: [...], difs: { debito, credito, pix } deste caixa,
   *       difsOutroCaixa: { debito, credito, pix } (opcional), bbTerceiros: [...] (opcional) }
   * Devolve [{ tipo, texto, itens }], da explicação mais provável para a menos provável.
   */
  function explicarDiferenca(p) {
    var d = p.diferenca, alvo = Math.abs(d), r = [];
    if (!d) return r;
    var daForma = (p.vendas || []).filter(function (v) { return v.forma === p.forma; });
    var nome = NOMES[p.forma] || p.forma;

    // 1. Outra forma com a diferença oposta: venda registrada na forma errada
    Object.keys(p.difs || {}).forEach(function (f) {
      if (f === p.forma || p.difs[f] !== -d) return;
      var deQual = d > 0 ? daForma : (p.vendas || []).filter(function (v) { return v.forma === f; });
      var exatas = deQual.filter(function (v) { return v.valor_centavos === alvo; });
      r.push({ tipo: "forma_trocada", itens: exatas,
        texto: d > 0
          ? "Uma venda de " + brl(alvo) + " passou no " + nome + " na Cielo, mas foi registrada como " + (NOMES[f] || f) + " no Diamante (o " + (NOMES[f] || f) + " está " + brl(alvo) + " a menos)."
          : "Uma venda de " + brl(alvo) + " foi registrada como " + nome + " no Diamante, mas passou no " + (NOMES[f] || f) + " na Cielo." });
    });
    // 2. O outro caixa tem a diferença oposta na mesma forma: passou na máquina do outro caixa
    if (p.difsOutroCaixa && p.difsOutroCaixa[p.forma] === -d) {
      r.push({ tipo: "outro_caixa", itens: [],
        texto: d > 0 ? "O outro caixa tem " + brl(alvo) + " a menos no " + nome + ": a venda pode ter sido registrada lá e passada na máquina deste caixa."
          : "O outro caixa tem " + brl(alvo) + " a mais no " + nome + ": a venda pode ter sido passada na máquina do outro caixa (registre uma troca de máquina, se foi o caso)." });
    }
    if (d > 0) {
      // Cielo tem MAIS: venda que passou na máquina e não foi registrada (ou registrada em dinheiro)
      var exatas = daForma.filter(function (v) { return v.valor_centavos === alvo; });
      exatas.forEach(function (v) {
        r.push({ tipo: "venda_exata", itens: [v], texto: "A venda de " + descrever(v) + " na Cielo tem exatamente o valor da diferença: pode não ter sido registrada no Diamante (ou foi registrada em dinheiro)." });
      });
      // venda repetida (mesmo valor em poucos minutos)
      daForma.forEach(function (v, i) {
        daForma.slice(i + 1).forEach(function (w) {
          var dm = Math.abs((minutos(w.hora) || 0) - (minutos(v.hora) || 0));
          if (v.valor_centavos === w.valor_centavos && v.valor_centavos === alvo && dm <= 5) {
            r.push({ tipo: "repetida", itens: [v, w], texto: "Duas vendas de " + brl(alvo) + " em " + dm + " min (" + hora(v.hora) + " e " + hora(w.hora) + "): pode ter passado duas vezes." });
          }
        });
      });
      if (!exatas.length) {
        combinacoes(daForma, alvo, 3, 3).filter(function (c) { return c.length > 1; }).forEach(function (c) {
          r.push({ tipo: "combinacao", itens: c, texto: "Estas vendas somam a diferença: " + c.map(descrever).join(" + ") + "." });
        });
      }
    } else {
      // Diamante tem MAIS: registrado na forma, mas não entrou na Cielo
      (p.naoAprovadas || []).filter(function (v) { return v.forma === p.forma && v.valor_centavos === alvo; }).forEach(function (v) {
        r.push({ tipo: "nao_aprovada", itens: [v], texto: "Há uma venda NÃO APROVADA de " + descrever(v) + ": o cliente pode ter pago de outro jeito e o caixa registrou como " + nome + "." });
      });
      if (p.forma === "pix") {
        var bb = (p.bbTerceiros || []);
        bb.filter(function (l) { return l.valor_centavos === alvo; }).forEach(function (l) {
          r.push({ tipo: "pix_chave", itens: [l], texto: "Um PIX de cliente de " + descrever(l) + " caiu direto na conta (chave PIX): pode ter sido registrado como PIX da maquininha em vez de PIX Delivery." });
        });
        if (!bb.some(function (l) { return l.valor_centavos === alvo; })) {
          combinacoes(bb, alvo, 2, 3).filter(function (c) { return c.length > 1; }).forEach(function (c) {
            r.push({ tipo: "pix_chave", itens: c, texto: "Estes PIX de clientes na conta somam a diferença: " + c.map(descrever).join(" + ") + " (registrados como PIX da maquininha?)." });
          });
        }
      }
    }
    if (!r.length) {
      r.push({ tipo: "nada", itens: [], texto: d > 0
        ? "Nenhuma venda (ou combinação de até 3) da Cielo tem o valor da diferença. Confira a lista de vendas abaixo com as notas do caixa."
        : "Não achei venda não aprovada nem PIX na conta com esse valor. Pode ter sido uma venda registrada no " + nome + " e paga em dinheiro: confira a contagem do dinheiro." });
    }
    return r;
  }

  /*
   * Casa os PIX da maquininha da Cielo (valor bruto) com os PIX que caíram no BB com o CNPJ da loja
   * (valor líquido, já sem a taxa, alguns minutos depois). taxa máxima 3%, atraso 0 a 60 min;
   * o que sobra tenta casar no mesmo dia em qualquer horário depois (caiu atrasado).
   * Devolve { pares: [{ cielo, bb, taxa, atraso }], soCielo, soBB, taxaMedia }
   */
  function casarPixMaquininha(pixCielo, bbMaquininha) {
    var cielo = (pixCielo || []).slice().sort(function (a, b) { return String(a.hora).localeCompare(String(b.hora)); });
    var bb = (bbMaquininha || []).slice();
    var usados = {}, pares = [], soCielo = [];
    function tentar(c, maxAtraso) {
      var melhor = null;
      bb.forEach(function (l, j) {
        if (usados[j] || l.data !== c.data) return;
        var atraso = (minutos(l.hora) || 0) - (minutos(c.hora) || 0);
        var taxa = 1 - l.valor_centavos / c.valor_centavos;
        if (atraso < 0 || atraso > maxAtraso || taxa < 0 || taxa > 0.03) return;
        if (!melhor || atraso < melhor.atraso) melhor = { j: j, atraso: atraso, taxa: taxa };
      });
      return melhor;
    }
    var pendentes = [];
    cielo.forEach(function (c) {
      var m = tentar(c, 60);
      if (m) { usados[m.j] = true; pares.push({ cielo: c, bb: bb[m.j], taxa: m.taxa, atraso: m.atraso }); }
      else pendentes.push(c);
    });
    pendentes.forEach(function (c) {
      var m = tentar(c, 24 * 60);
      if (m) { usados[m.j] = true; pares.push({ cielo: c, bb: bb[m.j], taxa: m.taxa, atraso: m.atraso, atrasado: true }); }
      else soCielo.push(c);
    });
    var soBB = bb.filter(function (l, j) { return !usados[j]; });
    var bruto = pares.reduce(function (s, x) { return s + x.cielo.valor_centavos; }, 0);
    var liquido = pares.reduce(function (s, x) { return s + x.bb.valor_centavos; }, 0);
    return { pares: pares, soCielo: soCielo, soBB: soBB, taxaMedia: bruto ? 1 - liquido / bruto : 0 };
  }

  /*
   * Casa os recebimentos em PIX Delivery do cupom (fiado pago por PIX, um por cliente) com os PIX de
   * clientes no BB: primeiro valor exato, depois valor próximo (até R$ 2,00 ou 1%).
   * Devolve { exatos: [{ cupom, bb }], proximos: [{ cupom, bb, diferenca }], soCupom, soBB }
   */
  function casarPixDelivery(recebCupom, bbTerceiros) {
    var bb = (bbTerceiros || []).slice(), usados = {};
    var exatos = [], proximos = [], soCupom = [];
    var cupom = (recebCupom || []).filter(function (r) { return r.forma === "pix_delivery"; });
    var pendentes = [];
    cupom.forEach(function (r) {
      var j = bb.findIndex(function (l, k) { return !usados[k] && l.valor_centavos === r.valor; });
      if (j >= 0) { usados[j] = true; exatos.push({ cupom: r, bb: bb[j] }); } else pendentes.push(r);
    });
    pendentes.forEach(function (r) {
      var lim = Math.max(200, Math.round(r.valor * 0.01)), melhor = -1, melhorDif = Infinity;
      bb.forEach(function (l, k) {
        var dif = Math.abs(l.valor_centavos - r.valor);
        if (!usados[k] && dif <= lim && dif < melhorDif) { melhor = k; melhorDif = dif; }
      });
      if (melhor >= 0) { usados[melhor] = true; proximos.push({ cupom: r, bb: bb[melhor], diferenca: bb[melhor].valor_centavos - r.valor }); }
      else soCupom.push(r);
    });
    return { exatos: exatos, proximos: proximos, soCupom: soCupom, soBB: bb.filter(function (l, k) { return !usados[k]; }) };
  }

  return {
    combinacoes: combinacoes,
    explicarDiferenca: explicarDiferenca,
    casarPixMaquininha: casarPixMaquininha,
    casarPixDelivery: casarPixDelivery
  };
});
