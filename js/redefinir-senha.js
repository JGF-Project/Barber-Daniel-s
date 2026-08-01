/* ============================================================
   BARBER DANIEL'S — REDEFINIR SENHA
   ------------------------------------------------------------
   Página aberta a partir do link enviado por resetPasswordForEmail().
   O Supabase troca o token da URL por uma sessão temporária e
   dispara o evento PASSWORD_RECOVERY — só então liberamos o formulário.
============================================================ */

'use strict';

let linkValido = false;

function mostrarFormulario() {
  linkValido = true;
  $('#verificando-link').hidden = true;
  $('#form-nova-senha').hidden = false;
}

function mostrarLinkInvalido() {
  if (linkValido) return; // já liberou o formulário, ignora
  $('#verificando-link').hidden = true;
  $('#link-invalido').hidden = false;
}

sb.auth.onAuthStateChange((evento) => {
  if (evento === 'PASSWORD_RECOVERY') mostrarFormulario();
});

document.addEventListener('DOMContentLoaded', () => {
  $('#ano-atual').textContent = new Date().getFullYear();

  // Se o link já tiver sido consumido/expirado, o evento nunca chega
  setTimeout(mostrarLinkInvalido, 4000);

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
      const msg = error.message || error.status || '';
      const mesmaAnterior = msg.toLowerCase().includes('same') || msg.toLowerCase().includes('previous') || msg.toLowerCase().includes('password');
      if (mesmaAnterior && senha === $('#nova-senha').value) {
        erro.textContent = 'A nova senha não pode ser igual à anterior. Escolha uma senha diferente.';
      } else {
        erro.textContent = 'Não foi possível salvar a nova senha. Tente novamente.';
      }
      erro.hidden = false;
      return;
    }

    $('#form-nova-senha').hidden = true;
    $('#sucesso-redefinir').hidden = false;
    $('#sucesso-redefinir-titulo').focus();
  });
});
