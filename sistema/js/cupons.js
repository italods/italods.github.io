/*
 * Aba "Importar" > "Cupons do Diamante": um ou vários PDFs de "Fechamento de turno" de uma vez.
 * Cada cupom vai para o fechamento salvo do seu caixa (pelo terminal) e dia, de preferência o que está
 * "falta o cupom" (Diamante.fechamentoDoCupom). O PDF é lido no aparelho; nada é gravado antes de "Gravar".
 */
(function () {
  "use strict";
  var Dm = window.Diamante;
  var C = window.Calculos;
  var u = null;        // utilidades do app (db, toast, mostrarErro, lerTextoPdf, ...)
  var itens = [];      // { nome, cupom, erros, destino, erro, marcado, resultado }

  function $(id) { return document.getElementById(id); }
  function esc(s) { return u.escapar(s); }

  function lerArquivos(lista) {
    u.limparErro();
    var arquivos = Array.prototype.slice.call(lista || []);
    if (!arquivos.length) return;
    var ruins = arquivos.filter(function (a) { return !/\.pdf$/i.test(a.name || "") && a.type !== "application/pdf"; });
    if (ruins.length) { u.mostrarErro({ message: "Escolha só os PDFs de \"Fechamento de turno\" (" + ruins[0].name + " não é PDF)." }); return; }
    if (arquivos.length > 20) { u.mostrarErro({ message: "Escolha no máximo 20 cupons de uma vez." }); return; }
    var rotulo = $("cupons-importar");
    rotulo.classList.add("ocupado");
    $("cupons-previa").hidden = false;
    $("cupons-previa").innerHTML = '<p class="vazio">Lendo ' + arquivos.length + (arquivos.length === 1 ? " PDF" : " PDFs") + "…</p>";
    // um de cada vez (o leitor de PDF é pesado no celular)
    var lidos = [];
    arquivos.reduce(function (p, arq) {
      return p.then(function () {
        if (arq.size > 10 * 1024 * 1024) { lidos.push({ nome: arq.name, erro: "Arquivo grande demais para um cupom." }); return; }
        return u.lerTextoPdf(arq).then(function (texto) {
          var r = Dm.lerCupom(texto);
          if (!r.cupom || r.erros.some(function (e) { return /resumo das formas|Fechamento de turno/.test(e); })) {
            lidos.push({ nome: arq.name, erro: r.erros[0] || "Não consegui ler o cupom." });
          } else {
            lidos.push({ nome: arq.name, cupom: r.cupom, avisosLeitura: r.erros });
          }
        }, function (e) { lidos.push({ nome: arq.name, erro: e.message || "Não consegui ler o PDF." }); });
      });
    }, Promise.resolve()).then(function () {
      var datas = lidos.filter(function (x) { return x.cupom && x.cupom.data; }).map(function (x) { return x.cupom.data; }).sort();
      if (!datas.length) return [];
      return u.db.listarConferencias({ de: datas[0], ate: datas[datas.length - 1] });
    }).then(function (confs) {
      itens = distribuir(lidos, confs || []);
      desenhar();
    }).catch(function (e) {
      itens = [];
      $("cupons-previa").hidden = true;
      u.mostrarErro(e);
    }).then(function () {
      rotulo.classList.remove("ocupado");
      $("cupons-arquivo").value = "";
    });
  }

  // Liga cada cupom a um fechamento; dois cupons do mesmo lote não vão para o mesmo fechamento
  function distribuir(lidos, confs) {
    var copia = confs.map(function (c) { return Object.assign({}, c); });
    return lidos.map(function (x) {
      if (!x.cupom) return { nome: x.nome, erro: x.erro, marcado: false };
      var m = Dm.fechamentoDoCupom(u.caixas, copia, x.cupom);
      var somas = Dm.conferirCupom(x.cupom);
      var it = { nome: x.nome, cupom: x.cupom, caixa: m.caixa, destino: m.conferencia || null, erro: m.erro || "",
        avisos: (x.avisosLeitura || []).map(function (t) { return { nivel: "aviso", texto: t }; }).concat(somas) };
      if (it.destino) {
        var ab = C.aberturaAntes(copia, it.destino);
        if (ab && ab.total_centavos !== x.cupom.fundo) {
          it.avisos.push({ nivel: "aviso", texto: "A abertura das " + u.horaCurta(ab.hora) + " contou " + u.brl(ab.total_centavos) +
            ", mas o fundo no cupom é " + u.brl(x.cupom.fundo) + "." });
        }
        it.destino.cupom = { turno: x.cupom.turno };   // ocupado neste lote
        it.destino = confs.filter(function (c) { return c.id === it.destino.id; })[0];
      }
      it.marcado = !!it.destino && !somas.some(function (a) { return a.nivel === "erro"; });
      return it;
    });
  }

  function desenhar() {
    var el = $("cupons-previa");
    if (!itens.length) { el.hidden = true; el.innerHTML = ""; return; }
    var podem = itens.filter(function (x) { return x.destino && !x.resultado; });
    el.hidden = false;
    el.innerHTML = '<ul class="lista-cupons">' + itens.map(function (x, i) {
      var c = x.cupom;
      var cab = c ? esc((x.caixa ? x.caixa.curto : "Terminal " + (c.terminal || "?")) + " · " + u.dataBR(c.data) +
        (c.turno ? " · turno " + c.turno : "") + (c.encerramento ? " · encerrado " + u.horaCurta(c.encerramento) : "")) : esc(x.nome);
      var corpo;
      if (x.resultado) {
        corpo = '<p class="' + (x.resultado.erro ? "msg-erro" : "msg-ok") + '">' + esc(x.resultado.erro || x.resultado.texto) + "</p>";
      } else if (x.destino) {
        var d = x.destino;
        corpo = '<label class="marcar"><input type="checkbox" data-item="' + i + '"' + (x.marcado ? " checked" : "") + " /> " +
          "Gravar no fechamento das " + esc(u.horaCurta(d.hora)) + " (contado " + esc(u.brl(d.total_centavos)) +
          (C.ehPendente(d) ? ", falta o cupom" : "") + ")</label>";
      } else {
        corpo = '<p class="msg-erro">' + esc(x.erro) + "</p>";
      }
      var avisos = (x.avisos || []).filter(function () { return !x.resultado; }).map(function (a) {
        return '<li class="' + (a.nivel === "erro" ? "msg-erro" : "msg-aviso") + '">' + esc(a.texto) + "</li>";
      }).join("");
      return '<li><p><strong>' + cab + "</strong>" + (c ? '<br><small class="suave">' + esc(x.nome) + "</small>" : "") + "</p>" + corpo +
        (avisos ? '<ul class="cupom-avisos">' + avisos + "</ul>" : (c && x.destino && !x.resultado ? '<p class="msg-ok mini">As somas do cupom batem.</p>' : "")) +
        "</li>";
    }).join("") + "</ul>" +
      '<div class="acoes">' +
      '<button type="button" class="botao" id="cupons-cancelar">' + (podem.length ? "Cancelar" : "Fechar") + "</button>" +
      (podem.length ? '<button type="button" class="botao primario" id="cupons-gravar">Gravar cupons marcados</button>' : "") +
      "</div>";
  }

  function gravar() {
    var marcados = itens.filter(function (x) { return x.destino && x.marcado && !x.resultado; });
    if (!marcados.length) { u.toast("Marque pelo menos um cupom."); return; }
    var botao = $("cupons-gravar");
    u.ocupado(botao, true, "Gravando…");
    marcados.reduce(function (p, x) {
      return p.then(function () {
        return u.db.anexarCupom(x.destino.id, x.cupom).then(function (salvo) {
          x.resultado = { texto: "Gravado: " + u.nomeCaixa(salvo.caixa) + " · " + u.dataBR(salvo.data) + " · " +
            window.Formatos.linhaDiferenca(salvo.diferenca_centavos) };
        }, function (e) { x.resultado = { erro: e.message }; });
      });
    }, Promise.resolve()).then(function () {
      var ok = marcados.filter(function (x) { return !x.resultado.erro; }).length;
      u.toast(ok + (ok === 1 ? " cupom gravado." : " cupons gravados."));
      if (u.aoGravar) u.aoGravar();
      desenhar();
    });
  }

  function iniciar(utilidades) {
    u = utilidades;
    $("cupons-arquivo").addEventListener("change", function (ev) { lerArquivos(ev.target.files); });
    $("cupons-importar").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); $("cupons-arquivo").click(); }
    });
    $("cupons-previa").addEventListener("change", function (ev) {
      if (ev.target.dataset.item == null) return;
      itens[+ev.target.dataset.item].marcado = ev.target.checked;
    });
    $("cupons-previa").addEventListener("click", function (ev) {
      if (ev.target.id === "cupons-gravar") gravar();
      if (ev.target.id === "cupons-cancelar") { itens = []; desenhar(); }
    });
  }

  window.CuponsDiamante = { iniciar: iniciar };
})();
