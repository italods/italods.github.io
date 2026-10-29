# Site do Italo / Sistema Veneza

Site pessoal do Italo Pereira, hospedado na **Vercel** (projeto ligado a este repositório; a
branch `main` vai para produção e as outras branches geram uma prévia). A Vercel serve os arquivos
estáticos da raiz como estão; o `vercel.json` só tem a regra `/q/:token` → `/escuta/index.html`
(QR codes) e cabeçalhos noindex. Domínio: https://italods.com.br/ (sistema em https://italods.com.br/sistema/). Dentro dele fica o **Sistema Veneza**, o sistema gerencial do
Supermercado Veneza (Paes Landim - PI), usado só pelo Italo e pela irmã (sócia). O sistema tem duas
áreas: **Conferência de caixa** e **Veneza Escuta** (sugestões, reclamações, elogios e produtos em
falta enviados pelos clientes por QR codes nas plaquinhas da loja).

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
  js/db.js          ← acesso ao Supabase + modo demonstração (?demo=1, guarda no localStorage)
  js/app.js         ← telas e eventos do caixa, login e troca de áreas
  js/escuta-db.js   ← Veneza Escuta: chamadas às funções do banco + demonstração (?demo=1)
  js/escuta-admin.js← Veneza Escuta: telas do painel
escuta/             ← formulário PÚBLICO dos clientes (sem login): index.html, escuta.css,
                      escuta.js, privacidade.html. Fundo branco, verde #123E30/#267357, dourado
                      da logo. Endereço: /q/<token> (QR) ou /escuta/ (sem plaquinha)
assets/logo-veneza.png ← logo oficial (ainda não enviada; sem ela aparece o nome em texto)
supabase/schema.sql ← caixa: tabelas, gatilhos e RLS (colar no SQL Editor; pode rodar de novo)
supabase/escuta.sql ← Veneza Escuta: tabelas, funções, RLS e pasta privada de fotos (rodar
                      depois do schema.sql; pode rodar de novo)
supabase/testes/    ← Supabase simulado + testes SQL (só para Postgres local, nunca no Supabase)
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
- Contas novas vão em `calculos.js`/`formatos.js` (funções puras) com teste, não em `app.js`.
- **Celular primeiro**: botões de no mínimo 48px, sem rolagem lateral em 360–390px de largura.
- Tudo em **português do Brasil**, visual limpo, sem gradientes.
- Páginas do sistema com `<meta name="robots" content="noindex">`.
- Bibliotecas só por CDN com versão exata (jsDelivr/cdnjs): supabase-js 2.109.0, jsPDF 2.5.2,
  Chart.js 4.5.1. jsPDF e Chart.js são carregados só quando usados.
- Não apagar nem renomear as páginas antigas. Para incluir um caixa, editar `CAIXAS` em
  `sistema/config.js` (não mudar o `id` de um caixa já usado).
- Erros devem ser claros (sem internet, sessão expirada, sem permissão) e nunca apagar o que foi
  digitado: a contagem fica em rascunho no `localStorage` até salvar.

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
- Enquanto `ESCUTA.DOMINIO_DEFINITIVO` for `false`, as plaquinhas saem marcadas "TESTE".
- Fora do escopo por enquanto (pedido do Italo): integração com WhatsApp e premiação por sugestões.
- Não mostrar indicadores inventados: sem dados, dizer que ainda não há dados.

## Testes

```bash
node --test tests/*.test.js
```

Inclui o texto por extenso (tests/extenso.test.js) e os números reais de 23/10/2026 (Caixa 1: falta R$ 54,38; Caixa 2: sobra R$ 863,92).

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
```

## Publicar

1. Rodar os testes e conferir as telas em `?demo=1` (celular 390px e computador, claro e escuro).
2. Commits pequenos, mensagens em português.
   **Autor dos commits: `Italo Pereira <italopereira007@hotmail.com>`** (configurar com
   `git config user.name "Italo Pereira"` e `git config user.email "italopereira007@hotmail.com"`).
   A Vercel (plano Hobby) bloqueia a publicação quando o autor do commit não é o dono da conta;
   commits com outro autor não vão ao ar. **Não colocar a linha `Co-Authored-By:`** (nem de
   assistentes) na mensagem: com coautor a publicação falha. Pedido do Italo.
   Para conferir se publicou: o status do commit no GitHub (contexto "Vercel") deve ficar
   `success`; `failure` = não foi ao ar.
3. Enviar para `main` (a Vercel publica sozinha em 1–2 minutos). Um push em outra branch só gera
   uma prévia na Vercel, que usa o mesmo Supabase: cuidado ao testar lá, os dados são os reais.
4. Mudança no banco: atualizar o `.sql` da área (`schema.sql` ou `escuta.sql`) de forma que possa
   rodar de novo sem apagar dados (`if not exists`, `add column if not exists`, `create or
   replace`), atualizar os testes SQL e avisar o Italo para colar o arquivo no SQL Editor.
   Backup: o plano gratuito do Supabase não guarda cópias para baixar; os CSVs do Histórico e das
   Mensagens servem de cópia manual.
