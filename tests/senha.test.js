// Testes do "Esqueci minha senha" e da troca de senha. Rodar com: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../sistema/js/formatos.js");

test("hash das abas do sistema não é retorno de e-mail", () => {
  assert.equal(F.lerRetornoSenha(""), null);
  assert.equal(F.lerRetornoSenha("#caixa"), null);
  assert.equal(F.lerRetornoSenha("#escuta-mensagens"), null);
  assert.equal(F.lerRetornoSenha(undefined), null);
});

test("link de recuperação válido devolve os tokens", () => {
  const r = F.lerRetornoSenha("#access_token=aaa.bbb.ccc&expires_at=1&expires_in=3600&refresh_token=xyz&token_type=bearer&type=recovery");
  assert.deepEqual(r, { access_token: "aaa.bbb.ccc", refresh_token: "xyz", tipo: "recovery" });
});

test("link de convite também serve para criar a senha", () => {
  const r = F.lerRetornoSenha("#access_token=t1&refresh_token=r1&type=invite");
  assert.equal(r.tipo, "invite");
  assert.equal(r.access_token, "t1");
});

test("link expirado ou já usado dá mensagem clara", () => {
  const r = F.lerRetornoSenha("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
  assert.match(r.erro, /expirou/);
  assert.equal(r.access_token, undefined);
});

test("outro erro do Supabase também vira mensagem", () => {
  const r = F.lerRetornoSenha("#error=server_error&error_description=Algo+deu+errado");
  assert.match(r.erro, /Não foi possível usar o link/);
});

test("link sem refresh_token é recusado", () => {
  assert.match(F.lerRetornoSenha("#access_token=abc&type=recovery").erro, /incompleto/);
});

test("tipo desconhecido é recusado", () => {
  assert.match(F.lerRetornoSenha("#access_token=a&refresh_token=b&type=outra").erro, /desconhecido/);
});

test("pedaço com codificação inválida não quebra", () => {
  const r = F.lerRetornoSenha("#access_token=a&refresh_token=b&lixo=%E0%A4%A&type=recovery");
  assert.equal(r.refresh_token, "b");
});

test("validação da senha nova", () => {
  assert.match(F.validarNovaSenha("1234567", "1234567"), /8 caracteres/);
  assert.match(F.validarNovaSenha("a".repeat(73), "a".repeat(73)), /72/);
  assert.match(F.validarNovaSenha(" senhaboa", " senhaboa"), /espaço/);
  assert.match(F.validarNovaSenha("senhaboa1", "senhaboa2"), /não são iguais/);
  assert.equal(F.validarNovaSenha("Veneza2026!", "Veneza2026!"), null);
  assert.match(F.validarNovaSenha(undefined, undefined), /8 caracteres/);
});
