/*
 * Configuração do Sistema Veneza.
 * O repositório é PÚBLICO: aqui só podem ficar a URL do projeto e a chave "anon" (pública).
 * Nunca coloque aqui a chave "service_role" nem senhas.
 */
window.VENEZA_CONFIG = {
  // Supabase > Project Settings > API (ou "Connect")
  SUPABASE_URL: "COLE_AQUI_A_URL_DO_PROJETO",
  SUPABASE_ANON_KEY: "COLE_AQUI_A_CHAVE_ANON",

  // Caixas da loja. Para incluir um novo, copie uma linha e troque o id e os nomes.
  // O "id" fica gravado no banco: depois de usar, não mude o id de um caixa.
  CAIXAS: [
    { id: "caixa1", nome: "Caixa 1 (Terminal 1)", curto: "Caixa 1" },
    { id: "caixa2", nome: "Caixa 2 (Terminal 3)", curto: "Caixa 2" }
  ],

  // Sugestões no campo Operador / Responsável (pode digitar outro nome)
  OPERADORES: ["Italo", "Irmã", "Cida"],

  // Sugestões de motivo para sangria e suprimento
  MOTIVOS: ["Levado ao cofre", "Pagamento fornecedor", "Reforço de moedas", "Reforço de troco", "Despesa da loja"]
};
