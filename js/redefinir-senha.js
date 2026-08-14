/* ============================================================
   BARBER DANIEL'S — REDEFINIR SENHA
   ------------------------------------------------------------
   Página aberta a partir do link enviado por resetPasswordForEmail().

   Dois formatos de link chegam aqui:

   1. ?token_hash=...&type=recovery  (o que o modelo de e-mail manda hoje)
      O token só é consumido no verifyOtp() abaixo, que é um POST nosso.
      Varredura de e-mail e navegador embutido do Gmail fazem GET, e GET
      não queima mais o link — era essa a causa do "link inválido": o
      Gmail abria o link antes do Safari e gastava o token de uso único.

   2. #access_token=... na hash (formato antigo do {{ .ConfirmationURL }})
      Aí o próprio SDK cria a sessão e avisa pelo PASSWORD_RECOVERY.
      Mantido para os e-mails que já foram enviados no formato velho.
============================================================ */

'use strict';

let linkValido = false;

function mostrarFormulario() {
  linkValido = true;
  $('#verificando-link').hidden = true;
  $('#link-invalido').hidden = true;
  $('#form-nova-senha').hidden = false;
}

function mostrarLinkInvalido() {
  if (linkValido) return; // já liberou o formulário, ignora
  $('#verificando-link').hidden = true;
  $('#link-invalido').hidden = false;
}

// Formato 2: o SDK lê a hash sozinho e avisa quando a sessão sai.
sb.auth.onAuthStateChange((evento) => {
  if (evento === 'PASSWORD_RECOVERY') mostrarFormulario();
});

/** Decide se o link vale, conforme o formato em que ele chegou. */
async function validarLink() {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.slice(1));

  // Quando o /verify do Supabase já recusa o link, ele devolve o motivo aqui.
  // Sem isto a tela ficaria 8s "verificando" para só então dizer o óbvio.
  if (query.get('error') || hash.get('error')) return mostrarLinkInvalido();

  const tokenHash = query.get('token_hash');
  if (tokenHash) {
    const { error } = await sb.auth.verifyOtp({
      token_hash: tokenHash,
      type: query.get('type') || 'recovery',
    });
    // Tira o token da barra de endereço: não precisa mais dele e não é
    // coisa para ficar em histórico ou ser compartilhada sem querer.
    window.history.replaceState(null, '', window.location.pathname);
    return error ? mostrarLinkInvalido() : mostrarFormulario();
  }

  // Formato 2: se o evento não chegar, o link já era. Celular em rede ruim
  // precisa de mais que os 4s de antes.
  window.setTimeout(mostrarLinkInvalido, 8000);
}

document.addEventListener('DOMContentLoaded', () => {
  $('#ano-atual').textContent = new Date().getFullYear();

  $('#form-nova-senha').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const senha = $('#nova-senha').value;
    const confirmacao = $('#confirmar-senha').value;
    const erro = $('#erro-redefinir');
    erro.hidden = true;

    if (senha.length < 6) {
      erro.textContent = 'A senha precisa ter pelo menos 6 caracteres.';
      erro.hidden = false;
      return;
    }
    if (senha !== confirmacao) {
      erro.textContent = 'As senhas não coincidem.';
      erro.hidden = false;
      return;
    }

    const botao = $('button[type="submit"]', evento.target);
    botao.classList.add('carregando');
    botao.disabled = true;

    const { error } = await sb.auth.updateUser({ password: senha });

    botao.classList.remove('carregando');
    botao.disabled = false;

    if (error) {
      const msg = (error.message || '').toLowerCase();
      erro.textContent = msg.includes('same') || msg.includes('different')
        ? 'A nova senha não pode ser igual à anterior. Escolha uma senha diferente.'
        : 'Não foi possível salvar a nova senha. Tente novamente.';
      erro.hidden = false;
      return;
    }

    $('#form-nova-senha').hidden = true;
    $('#sucesso-redefinir').hidden = false;
    $('#sucesso-redefinir-titulo').focus();
  });

  validarLink();
});
