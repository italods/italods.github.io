# Site do Italo / Sistema Veneza

Site pessoal do Italo Pereira, hospedado na **Vercel** (projeto ligado a este repositório; a
branch `main` vai para produção e as outras branches geram uma prévia). A Vercel serve os arquivos
estáticos da raiz como estão; o `vercel.json` só tem a regra `/q/:token` → `/escuta/index.html`
(QR codes) e cabeçalhos noindex. Domínio: https://italods.com.br/ (sistema em https://italods.com.br/sistema/). Dentro dele fica o **Sistema Veneza**, o sistema gerencial do
Supermercado Veneza (Paes Landim - PI), usado só pelo Italo e pela irmã (sócia). O sistema tem duas
áreas: **Conferência de caixa**, **Veneza Escuta** (sugestões, reclamações, elogios e produtos em
falta enviados pelos clientes por QR codes nas plaquinhas da loja), **Cartões** (conciliação dos
pagamentos da Cielo e taxas do contrato) e **RH** (funcionários, escala, ocorrências, resumo do mês).

Tudo é HTML/CSS/JS puro, sem framework e sem etapa de build. O que estiver no `main` vai ao ar.

## Estrutura

```
index.html        ← página inicial do Supermercado Veneza: cartões para cada ferramenta,
                    link discreto para o Sistema no rodapé
styles/veneza.css ← visual comum do site (cores, topo "‹ Supermercado Veneza", cartões, campos,
                    botões, rodapé). Mesmas cores do sistema/css/sistema.css: mudou uma, mude a outra
calculadora_precos.html, Cheques.html, conversor-extenso.html
                  ← ferramentas (não quebrar). Usam styles/veneza.css + um <style> próprio; o
                    <script> de cada uma é o original. Ferramenta nova: copiar o topo/rodapé de uma
                    delas e incluir um cartão em index.html
js/extenso.js     ← valor em reais por extenso (centavos), usado por Cheques e Conversor, com testes
styles/style.css, avatar.svg, 2.png, .melhorias.html ← restos do site antigo, não usados
(compras.html e linkwhatsapp.html foram removidas a pedido do Italo)
sistema/
  index.html        ← app de página única: login + área "Conferência de caixa" (Caixa, Histórico,
                      Sangrias, Relatório) + área "Veneza Escuta" (Visão geral, Mensagens,
                      Plaquinhas, Catálogo). Rotas por hash (#caixa, #escuta-mensagens...)
  plaquinhas.html   ← impressão das plaquinhas (A6, 4 por A4), QR em SVG; exige login
  config.js         ← URL do Supabase, chave anon, CAIXAS, OPERADORES, MOTIVOS e ESCUTA
                      (URL_PUBLICA dos QR codes, DOMINIO_DEFINITIVO, LOGO, SETORES)
  css/sistema.css   ← visual (celular primeiro, claro/escuro por prefers-color-scheme)
  js/calculos.js    ← contas puras em centavos (navegador + Node)
  js/formatos.js    ← texto do WhatsApp e CSV (puras, navegador + Node)
  js/diamante.js    ← cupom "Fechamento de turno" do ERP Diamante: lê o texto do PDF (pdf.js) ou
                      colado, confere as somas, esperado por forma, nome abreviado (puras + testes)
  js/cielo.js       ← CSV de vendas detalhado da Cielo: leitura (colunas pelo nome, Windows-1252),
                      totalizador, chave anti-duplicação, caixa da venda (máquina + troca), cupom × Cielo
  js/banco.js       ← extrato CSV do Banco do Brasil: data real da descrição, categorias (repasse
                      Cielo, PIX da maquininha, PIX de cliente, outro), chave, PIX Delivery do dia
  js/investigar.js  ← "Investigar diferença": explica a diferença de uma forma (venda exata, forma
                      trocada, outro caixa, não aprovada, PIX na chave, combinação, repetida), casa
                      PIX da maquininha × BB (taxa/atraso) e recebimentos PIX Delivery × BB
  js/feriados.js    ← feriados nacionais (com Carnaval, dia sem banco) e dias úteis (prazo; depois RH)
  js/recebiveis.js  ← conciliação: CSV de Recebíveis da Cielo, taxa do contrato × cobrada (1 centavo
                      de tolerância), prazo em dias úteis, vendas sem pagamento, repasse no BB
  js/cartoes.js     ← área "Cartões": abas Conciliação (#cartoes) e Taxas (#cartoes-taxas)
  js/rh.js          ← RH (puras + testes): escala rotativa, dia do funcionário, resumo do mês, texto
  js/rh-admin.js    ← área "RH": Funcionários (#rh), Escala, Ocorrências, Resumo
  js/importar.js    ← aba "Importar" (Conferência de caixa): prévias do CSV da Cielo e do extrato do
                      BB, CNPJ da loja, máquinas, trocas
  js/cupons.js      ← aba "Importar" > "Cupons do Diamante": vários PDFs de uma vez, cada um no seu
                      fechamento (terminal + dia, de preferência o "falta o cupom")
  js/db.js          ← acesso ao Supabase + modo demonstração (?demo=1, guarda no localStorage)
  js/app.js         ← telas e eventos do caixa, login e troca de áreas
  js/escuta-db.js   ← Veneza Escuta: chamadas às funções do banco + demonstração (?demo=1)
  js/escuta-admin.js← Veneza Escuta: telas do painel
escuta/             ← formulário PÚBLICO dos clientes (sem login): index.html, escuta.css,
                      escuta.js, privacidade.html. Fundo branco, verde #123E30/#267357, dourado
                      da logo. Endereço: /q/<token> (QR) ou /escuta/ (sem plaquinha)
assets/logo-veneza.png ← logo oficial (preta, fundo transparente, versão sem a onda). No topo verde do
                    formulário ela aparece branca (filtro no escuta.css); nas plaquinhas, preta
supabase/schema.sql ← caixa: tabelas, gatilhos e RLS (colar no SQL Editor; pode rodar de novo)
supabase/rh.sql   ← RH: rh_funcionarios, rh_turmas, rh_horarios, rh_ocorrencias, rh_feriados,
                      rh_holerites (rodar depois do schema.sql; pode rodar de novo)
supabase/escuta.sql ← Veneza Escuta: tabelas, funções, RLS e pasta privada de fotos (rodar
                      depois do schema.sql; pode rodar de novo)
supabase/testes/    ← Supabase simulado + testes SQL (caixa.test.sql, escuta.test.sql; só para
                      Postgres local, nunca no Supabase)
tests/*.test.js     ← testes em Node dos cálculos, formatos e extenso
```

## Regras do projeto

- **Repositório público.** Nenhum dado do caixa no código. Só podem estar no código a URL do
  projeto Supabase e a chave pública `anon`. Nunca a `service_role`, senhas ou e-mails reais de
  autorizados (eles vão direto no banco).
- **Segurança no banco**: RLS ligado em todas as tabelas; só quem está em `usuarios_autorizados`
  lê ou grava (`public.autorizado()`). Visitante sem login (`anon`) não tem acesso a nada.
- **Dinheiro sempre em centavos inteiros** (`bigint` no banco, inteiros no JS). Nada de float nas
  contas; `toLocaleString("pt-BR", {style:"currency", currency:"BRL"})` só para mostrar.
- Fórmulas: `Esperado = Fundo + Vendas dinheiro + Recebimentos dinheiro + Suprimentos − Sangrias`;
  `Diferença = Contado − Esperado` (positivo = Sobra, negativo = Falta, zero = Caixa bateu).
  O banco recalcula totais/esperado/diferença por gatilho (`conferencia_calcular`) e refaz os
  fechamentos quando uma sangria/suprimento muda. Se mudar uma fórmula, mude em `calculos.js`,
  no `schema.sql` e nos testes.
- **Tela do Caixa** (nov/2026): abre no início (situação de cada caixa no dia + "Nova contagem"); a
  contagem só começa depois de escolher o caixa e Abertura/Fechamento. Caixa aberto não abre de novo
  (`C.podeRegistrar` na tela e gatilho `conferencia_regras` no banco: duas aberturas seguidas no mesmo
  caixa e dia são recusadas); fechar sem abertura só avisa. Fechamento sem cupom fica `pendente`
  ("Falta o cupom": sem esperado/diferença, fora do Relatório) e já conta como caixa fechado; o cupom
  entra depois em Importar > Cupons do Diamante (`db.anexarCupom`) ou editando. Aviso quando a abertura
  não bate com o fundo do cupom. Contagem não salva aparece no início ("Contagem em andamento").
- **Histórico de edições**: tabela `versoes` (gatilho `guardar_versao`) guarda como cada conferência ou
  sangria/suprimento estava antes de editar/apagar; Histórico > "Últimas alterações" > Desfazer.
  Recálculo por outro gatilho não conta como edição. Só o banco grava em `versoes`.
- Contas novas vão em `calculos.js`/`formatos.js`/`diamante.js` (funções puras) com teste, não em `app.js`.
- **Cupom do Diamante** (Conferência 2.0, nov/2026): no Fechamento, "Importar PDF do cupom" lê o PDF
  no aparelho (pdf.js; o arquivo não é enviado) ou "Digitar o cupom". O cupom vai na coluna
  `conferencias.cupom` (jsonb, centavos). Com cupom, o gatilho tira dele fundo, vendas/recebimentos
  em dinheiro, PIX/débito/crédito/carteira e as **sangrias** (decisão do Italo: valem as do cupom);
  as lançadas no sistema ficam em `sangrias_lancadas_centavos` só para comparar. O banco
  (`cupom_normalizar`) aceita só os campos conhecidos e **abrevia o nome** dos clientes dos
  recebimentos ("MARIA A."). O terminal do cupom escolhe o caixa (`CAIXAS[].terminal` no config.js).
  Nunca colocar cupons, CSVs ou extratos reais no repositório: amostras ficam em `privado/`.
- **Cielo**: aba Importar lê o CSV no aparelho e grava em `cielo_vendas` só data, hora, forma,
  bandeira, valor, status, máquina, NSU, autorização, ID/TxID do PIX e o pagador abreviado (o banco
  abrevia de novo). Sem número de cartão, CPF/CNPJ nem instituições. `chave` única: reimportar não
  duplica (`upsert ... ignoreDuplicates`). Números de máquina ficam só no banco (`maquinas`, com o
  caixa padrão); `maquina_trocas` = máquina em outro caixa num dia (horário opcional). No fechamento
  com cupom, o quadro "Conferência por forma" compara débito, crédito e PIX da maquininha do cupom
  (vendas + recebimentos) com a Cielo do caixa e dia. Na tela, mostrar só o final da máquina.
- **Banco do Brasil**: aba Importar lê o extrato CSV e grava em `banco_lancamentos` só as
  **entradas** (saídas e saldos são descartados no aparelho). A data/hora vem da descrição
  ("DD/MM HH:MM DOC NOME"), não do lançamento. CPF/CNPJ dos pagadores nunca são gravados (só
  `pagador_tipo` pf/pj e o nome abreviado); `documento` é o nº do documento do BB. O PIX da
  maquininha é reconhecido pelo **CNPJ da loja**, guardado só em `configuracoes.cnpj_loja` (o
  sistema sugere o CNPJ que mais aparece e o Italo confirma). O repasse da Cielo é reconhecido pelo
  nome "CIELO". No fechamento, o PIX Delivery é conferido por **dia** (cupons de todos os caixas ×
  PIX de clientes no BB), porque o BB não diz o caixa. Ainda falta OFX/Excel (sem amostra).
- **Investigar diferença**: botão em cada forma com diferença no quadro "Conferência por forma".
  Só sugere (não muda nada sozinho) e, sem explicação, diz que não achou. No PIX Delivery, o Italo
  marca cada PIX de cliente que sobrou como de um caixa ou "Não é venda" (`banco_lancamentos.caixa`
  = id do caixa ou `fora`; `fora` sai da conta do PIX Delivery).
- **Cartões (conciliação)**: taxas do contrato só no banco (`cielo_taxas`; nunca no código nem nos
  testes, que usam taxas inventadas), em centésimos de % (1,23% = 123) e sempre mostradas/digitadas como
  "1,23%". Recebíveis em `cielo_recebiveis` (sem cartão, banco, agência, conta, estabelecimento). Taxa
  esperada = arredondar(bruto × taxa) por lançamento. O repasse "CIELO S.A" no BB é só de cartões (o
  PIX da maquininha cai um por venda). "Vendas sem pagamento" só olha o período coberto pelos
  recebíveis importados. Parcelado (contrato atual): todas as parcelas pagas no dia útil seguinte.
- **Celular primeiro**: botões de no mínimo 48px, sem rolagem lateral em 360–390px de largura.
- Tudo em **português do Brasil**, visual limpo, sem gradientes.
- Páginas do sistema com `<meta name="robots" content="noindex">`.
- Bibliotecas só por CDN com versão exata (jsDelivr/cdnjs): supabase-js 2.109.0, jsPDF 2.5.2,
  Chart.js 4.5.1, pdf.js (pdfjs-dist) 4.10.38 (build "legacy", módulo carregado com `import()`).
  jsPDF, Chart.js e pdf.js são carregados só quando usados.
- Não apagar nem renomear as páginas antigas. Para incluir um caixa, editar `CAIXAS` em
  `sistema/config.js` (não mudar o `id` de um caixa já usado).
- Erros devem ser claros (sem internet, sessão expirada, sem permissão) e nunca apagar o que foi
  digitado: a contagem fica em rascunho no `localStorage` até salvar.
- **Login e senha** (Supabase Auth, e-mail + senha): o login tem "Esqueci minha senha"
  (`resetPasswordForEmail`, o link volta para `/sistema/`) e o topo tem "Trocar senha"
  (`updateUser`). O link do e-mail chega como `#access_token=...&type=recovery`; o `app.js` lê com
  `Formatos.lerRetornoSenha`, chama `setSession`, limpa o endereço e mostra "Criar senha nova"
  (o cliente usa `detectSessionInUrl: false` porque as abas usam o `#`). Se o link cair na página
  inicial, o `index.html` da raiz repassa para `/sistema/`. No Supabase: Authentication > URL
  Configuration com Site URL `https://italods.com.br` e `https://italods.com.br/sistema/` nas
  Redirect URLs. Limite do plano gratuito: o e-mail padrão do Supabase só chega a membros da equipe
  do projeto e a poucos envios por hora; para outra pessoa, criar o usuário em Authentication >
  Users > Add user (senha provisória, "Auto Confirm") e ela troca em "Trocar senha".

### RH
- Dados dos funcionários **só no banco** (nunca no código nem nos testes: nomes inventados). Ficha:
  nome, função, admissão, telefone, salário (centavos), turma, desligamento (preenchido = desligado) e
  observações. Sem CPF nem endereço (decisão do Italo). O resumo para o contador não leva salário.
- Escala: horários (entrada/saída de segunda a sábado; domingo fechado) e turmas que **revezam toda
  semana** (manhã/tarde). Semana de referência em `configuracoes.rh_semana_ref` (segunda-feira): nela a
  turma de ordem 0 faz o horário de ordem 0; a cada semana avançam um horário. Na tela o Italo escolhe
  "nesta semana faz" e o sistema calcula a referência.
- Ocorrências: folga, falta (justificada ou não), atestado (dias corridos a partir da data) e feriado
  trabalhado. Feriados nacionais vêm de `feriados.js`; municipais/estaduais em `rh_feriados`. A loja
  abre em alguns feriados: quem trabalhou é marcado. Carnaval e Corpus Christi = ponto facultativo
  (dia normal no comércio).
- Holerite: só o registro de recebimento (mês e data), nunca o arquivo. Funcionário com histórico
  não se apaga (chave estrangeira): preencher o desligamento.
- Resumo do mês: faltas, atestados, folgas, feriados trabalhados; WhatsApp + PDF.

### Veneza Escuta
- Cliente (papel `anon`) não lê nenhuma tabela. Só chama `escuta_plaquinha`, `escuta_buscar_produtos`
  e `escuta_enviar`, e só **cria** arquivo em `escuta-fotos/envios/<id do envio>/<uuid>.jpg`.
  Toda validação fica no banco (`escuta_enviar`): tipo, tamanhos, telefone, consentimento,
  plaquinha ativa, foto existente, limite de 8 envios/10 min e 40/dia por rede, campo-armadilha e
  tempo mínimo. O `id` do envio vem do aparelho: reenviar não duplica.
- Painel: funções `escuta_*` com `security definer` que chamam `escuta_exigir_admin()`.
  Gravações só por essas funções (tabelas sem insert/update/delete para `authenticated`).
- Fotos: pasta privada; o painel abre com link temporário (`createSignedUrl`, 10 min).
- Token da plaquinha é aleatório e **nunca muda** (editar nome/setor mantém o QR). Plaquinha com
  mensagens não se apaga: desativa. Desativada não aceita envios.
- Imagem de produto só vem do catálogo (nunca de URL enviada pelo navegador).
- Nome/telefone são apagados 12 meses após o envio (dentro de `escuta_enviar`).
- Open Food Facts: consultado só pelo administrador (aba Catálogo), nunca a cada letra do cliente;
  busca por nome no máximo a cada 7 s (limite da API: 10/min). O cliente busca no catálogo local.
  Mostrar a atribuição "Open Food Facts (ODbL / CC BY-SA)" onde aparecerem dados/fotos deles.
- `ESCUTA.DOMINIO_DEFINITIVO` é `true` desde 03/11/2026 (italods.com.br é o domínio dos QR). Com `false`,
  as plaquinhas saem marcadas "TESTE". Nunca mudar `URL_PUBLICA` depois de pendurar plaquinhas.
- Fora do escopo por enquanto (pedido do Italo): integração com WhatsApp e premiação por sugestões.
- Não mostrar indicadores inventados: sem dados, dizer que ainda não há dados.

## Testes

```bash
node --test tests/*.test.js
```

Inclui o "Esqueci minha senha" (tests/senha.test.js), o texto por extenso (tests/extenso.test.js) e os números reais de 23/10/2026 (Caixa 1: falta R$ 54,38; Caixa 2: sobra R$ 863,92).

Para ver as telas localmente:

```bash
python3 -m http.server 8000
# abrir http://localhost:8000/sistema/?demo=1  (modo demonstração, sem Supabase)
```

Formulário dos clientes em demonstração: `http://localhost:8000/escuta/?demo=1` (crie uma plaquinha
no painel em `?demo=1` e use `?q=<token>&demo=1`). O `/q/<token>` só funciona na Vercel (rewrite).

Banco (Postgres local, nunca no Supabase de produção):

```bash
createdb teste
psql -d teste -f supabase/testes/supabase-simulado.sql
psql -d teste -f supabase/schema.sql
psql -d teste -f supabase/escuta.sql
psql -d teste -f supabase/testes/escuta.test.sql   # termina com TODOS_OS_TESTES_PASSARAM
psql -d teste -f supabase/testes/caixa.test.sql    # idem (cupom do Diamante)
psql -d teste -f supabase/rh.sql
psql -d teste -f supabase/testes/rh.test.sql       # idem (RH)
```

## Publicar

1. Rodar os testes e conferir as telas em `?demo=1` (celular 390px e computador, claro e escuro).
2. Commits pequenos, mensagens em português.
   **Autor dos commits: `Italo Pereira <italopereira007@hotmail.com>`** (configurar com
   `git config user.name "Italo Pereira"` e `git config user.email "italopereira007@hotmail.com"`).
   Para conferir se publicou: o status do commit no GitHub (contexto "Vercel") deve ficar
   `success`; `failure` = não foi ao ar (o motivo aparece na página do deploy na Vercel).
   Em out/2026 todos os deploys falharam porque o projeto na Vercel estava com Node.js 20.x
   (descontinuado): a correção é em Settings > Node.js Version, não no código.
3. Enviar para `main` (a Vercel publica sozinha em 1–2 minutos). Um push em outra branch só gera
   uma prévia na Vercel, que usa o mesmo Supabase: cuidado ao testar lá, os dados são os reais.
4. Mudança no banco: atualizar o `.sql` da área (`schema.sql`, `escuta.sql` ou `rh.sql`) de forma que possa
   rodar de novo sem apagar dados (`if not exists`, `add column if not exists`, `create or
   replace`), atualizar os testes SQL e avisar o Italo para colar o arquivo no SQL Editor.
   Backup: o plano gratuito do Supabase não guarda cópias para baixar; os CSVs do Histórico e das
   Mensagens servem de cópia manual.
