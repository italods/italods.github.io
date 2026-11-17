/*
 * Lê o texto de uma FOTO do cupom "Fechamento de turno" no próprio aparelho (Tesseract.js, por CDN, carregado só
 * quando usado). A foto não é enviada a lugar nenhum. O texto lido passa por Diamante.lerCupomFoto, que corrige
 * os erros mais comuns da leitura; as somas do cupom e a revisão na tela pegam o que ainda estiver errado.
 */
(function () {
  "use strict";
  var V = "5.1.1";
  var LIB = "https://cdn.jsdelivr.net/npm/tesseract.js@" + V + "/dist/tesseract.min.js";
  var OPCOES = {
    workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@" + V + "/dist/worker.min.js",
    corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@" + V,
    langPath: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/por@1.0.0/4.0.0_best_int"
  };
  var biblioteca = null, trabalhador = null, aoProgresso = null;

  function carregarBiblioteca() {
    if (window.Tesseract) return Promise.resolve();
    if (!biblioteca) {
      biblioteca = new Promise(function (ok, falha) {
        var s = document.createElement("script");
        s.src = LIB;
        s.onload = ok;
        s.onerror = function () { biblioteca = null; falha(new Error("Não foi possível carregar o leitor de fotos. Confira a internet e tente de novo.")); };
        document.head.appendChild(s);
      });
    }
    return biblioteca;
  }

  function prepararTrabalhador() {
    if (trabalhador) return trabalhador;
    trabalhador = carregarBiblioteca().then(function () {
      return window.Tesseract.createWorker("por", 1, Object.assign({}, OPCOES, {
        logger: function (m) {
          if (!aoProgresso) return;
          if (m.status === "recognizing text") aoProgresso("Lendo a foto… " + Math.round((m.progress || 0) * 100) + "%");
          else if (/loading|initializ/i.test(m.status || "")) aoProgresso("Preparando o leitor (só na primeira vez demora)…");
        }
      }));
    }).then(function (w) {
      return w.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" }).then(function () { return w; });
    }, function (e) { trabalhador = null; throw e; });
    return trabalhador;
  }

  // Abre a foto (já virada pela orientação da câmera)
  function abrirImagem(arquivo) {
    if (window.createImageBitmap) {
      return createImageBitmap(arquivo, { imageOrientation: "from-image" }).catch(function () { return createImageBitmap(arquivo); });
    }
    return new Promise(function (ok, falha) {
      var img = new Image(), url = URL.createObjectURL(arquivo);
      img.onload = function () { URL.revokeObjectURL(url); ok(img); };
      img.onerror = function () { URL.revokeObjectURL(url); falha(new Error("Não consegui abrir esta foto.")); };
      img.src = url;
    });
  }

  /*
   * Prepara a foto para a leitura: tamanho bom para o leitor (cupom estreito: ~1400 px de largura),
   * tons de cinza e contraste esticado (papel térmico costuma sair cinza-claro).
   */
  function prepararImagem(img) {
    var w = img.width, h = img.height;
    var escala = Math.min(3, Math.max(0.3, 1400 / w));
    if (w * escala > 2400) escala = 2400 / w;
    var cw = Math.round(w * escala), ch = Math.round(h * escala);
    if (ch > 6000) { escala *= 6000 / ch; cw = Math.round(w * escala); ch = 6000; }
    var c = document.createElement("canvas");
    c.width = cw; c.height = ch;
    var ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cw, ch);
    var dados = ctx.getImageData(0, 0, cw, ch), p = dados.data, hist = new Uint32Array(256), n = cw * ch, i;
    for (i = 0; i < p.length; i += 4) {
      var g = (p[i] * 299 + p[i + 1] * 587 + p[i + 2] * 114) / 1000 | 0;
      p[i] = g; hist[g]++;
    }
    // estica o contraste entre 2% mais escuros e 2% mais claros
    var acc = 0, baixo = 0, alto = 255;
    for (i = 0; i < 256; i++) { acc += hist[i]; if (acc > n * 0.02) { baixo = i; break; } }
    acc = 0;
    for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc > n * 0.02) { alto = i; break; } }
    var faixa = Math.max(1, alto - baixo);
    for (i = 0; i < p.length; i += 4) {
      var v = Math.max(0, Math.min(255, (p[i] - baixo) * 255 / faixa));
      p[i] = p[i + 1] = p[i + 2] = v;
    }
    if (FotoCupom.limiar) limiarAdaptativo(p, cw, ch);
    ctx.putImageData(dados, 0, 0);
    return c;
  }

  /*
   * Preto e branco por regiões (média da vizinhança): tira sombra e fundo cinza do papel térmico.
   * Um ponto fica preto quando é bem mais escuro que a média da região em volta.
   */
  function limiarAdaptativo(p, w, h) {
    var raio = Math.max(8, Math.round(w / 45)), soma = new Float64Array((w + 1) * (h + 1)), x, y;
    for (y = 1; y <= h; y++) {
      var linha = 0;
      for (x = 1; x <= w; x++) {
        linha += p[((y - 1) * w + (x - 1)) * 4];
        soma[y * (w + 1) + x] = soma[(y - 1) * (w + 1) + x] + linha;
      }
    }
    var saida = new Uint8Array(w * h);
    for (y = 0; y < h; y++) {
      var y0 = Math.max(0, y - raio), y1 = Math.min(h, y + raio + 1);
      for (x = 0; x < w; x++) {
        var x0 = Math.max(0, x - raio), x1 = Math.min(w, x + raio + 1);
        var area = (y1 - y0) * (x1 - x0);
        var s = soma[y1 * (w + 1) + x1] - soma[y0 * (w + 1) + x1] - soma[y1 * (w + 1) + x0] + soma[y0 * (w + 1) + x0];
        saida[y * w + x] = p[(y * w + x) * 4] < (s / area) * 0.85 ? 0 : 255;
      }
    }
    for (var i = 0; i < w * h; i++) p[i * 4] = p[i * 4 + 1] = p[i * 4 + 2] = saida[i];
  }

  // Lê o texto da foto. progresso(texto) recebe mensagens para mostrar na tela.
  function lerTexto(arquivo, progresso) {
    if (!arquivo || !/^image\//.test(arquivo.type || "") && !/\.(jpe?g|png|webp|heic|heif)$/i.test(arquivo.name || "")) {
      return Promise.reject(new Error("Escolha uma foto do cupom (JPG ou PNG)."));
    }
    if (arquivo.size > 25 * 1024 * 1024) return Promise.reject(new Error("Foto grande demais (mais de 25 MB)."));
    aoProgresso = progresso || null;
    if (aoProgresso) aoProgresso("Preparando a foto…");
    return Promise.all([abrirImagem(arquivo), prepararTrabalhador()]).then(function (r) {
      var canvas = prepararImagem(r[0]);
      return r[1].recognize(canvas);
    }, function (e) {
      if (/heic|heif/i.test(arquivo.type + arquivo.name)) throw new Error("Este navegador não abre fotos HEIC. Na câmera do iPhone, use \"Mais compatível\" (JPG) ou tire a foto pelo próprio sistema.");
      throw e;
    }).then(function (res) {
      aoProgresso = null;
      return (res && res.data && res.data.text) || "";
    }, function (e) { aoProgresso = null; throw e; });
  }

  var FotoCupom = { lerTexto: lerTexto, prepararImagem: prepararImagem, limiar: true };
  window.FotoCupom = FotoCupom;
})();
