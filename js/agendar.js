/* ============================================================
   BARBER DANIEL'S — PÁGINA DE AGENDAMENTO (cliente)
   ------------------------------------------------------------
   Fluxo: escolher serviço → dia → horário → confirmar.
   O login/cadastro só é exigido na hora de confirmar.
============================================================ */

'use strict';

/* Grade de horários candidatos: um início a cada 15 minutos.
   15 (e não 30) para que o próximo horário livre encaixe logo após serviços
   de duração variável — ex.: um corte de 75min às 16:00 libera as 17:15. */
const PASSO_MINUTOS = 15;
/* Antecedência mínima para agendar (em minutos) */
const ANTECEDENCIA_MIN = 30;
/* Nomes completos dos meses para o cabeçalho do calendário */
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
/* Até quantos meses à frente o cliente pode navegar e agendar */
const MESES_A_FRENTE = 3;

const Estado = {
  sessao: null,
  barbeiros: [],
  servicos: [],
  horariosPorBarbeiro: {},      // { barbeiroId: { dia_semana: {abre, fecha, fechado} } }
  bloqueiosPorBarbeiro: {},     // { barbeiroId: [{inicio, fim} em ms] } — ausências/férias
  barbeiroEscolhido: null,
  semPreferencia: false,        // true = "qualquer barbeiro disponível"
  servicosEscolhidos: [],      // pode escolher mais de um serviço (soma duração e preço)
  diaEscolhido: null,          // { ymd, diaSemana }
  horarioEscolhido: null,      // Date de início
  mesVisivel: null,            // Date (dia 1, em UTC) do mês exibido no calendário
  aguardandoConfirmacao: false, // true quando o login foi pedido no meio da confirmação
  assinatura: null,            // { servico_id, nome, descricao, usados, restantes, usado_semana } ou null
  agendouComoVisitante: false, // esconde "ver meus agendamentos" no sucesso
};

/** O serviço escolhido é o plano mensal? (só cabe um, e sozinho) */
function planoSelecionado() {
  return Estado.servicosEscolhidos.some((s) => s.assinatura);
}

/* ============================================================
   MODAL — substitui os pop-ups nativos (window.confirm/alert)
============================================================ */
/** Abre o modal #modal-confirma. Resolve true (confirmar) ou false (voltar/fechar). */
function abrirModal({ titulo, texto, confirmarLabel = 'Confirmar', mostrarVoltar = true }) {
  return new Promise((resolve) => {
    const modal = $('#modal-confirma');
    const btnOk = $('#modal-confirmar');
    const btnVoltar = $('#modal-voltar');
    const fechaveis = [...modal.querySelectorAll('[data-fechar-modal]')];

    $('#modal-titulo').textContent = titulo;
    $('#modal-texto').textContent = texto;
    btnOk.textContent = confirmarLabel;
    btnVoltar.hidden = !mostrarVoltar;

    modal.hidden = false;
    $('#modal-titulo').focus();

    const encerrar = (resultado) => {
      modal.hidden = true;
      btnVoltar.hidden = false; // restaura para o próximo uso
      btnOk.removeEventListener('click', aoConfirmar);
      fechaveis.forEach((el) => el.removeEventListener('click', aoVoltar));
      document.removeEventListener('keydown', aoTeclar);
      resolve(resultado);
    };
    const aoConfirmar = () => encerrar(true);
    const aoVoltar = () => encerrar(false);
    const aoTeclar = (e) => { if (e.key === 'Escape') encerrar(false); };

    btnOk.addEventListener('click', aoConfirmar);
    fechaveis.forEach((el) => el.addEventListener('click', aoVoltar));
    document.addEventListener('keydown', aoTeclar);
  });
}

/** Pergunta sim/não (dois botões). Retorna Promise<boolean>. */
const confirmar = (opcoes) => abrirModal({ ...opcoes, mostrarVoltar: true });

/** Aviso simples (um botão). */
const avisar = (titulo, texto) => abrirModal({ titulo, texto, confirmarLabel: 'Entendi', mostrarVoltar: false });

/* ============================================================
   ASSINATURA
   ------------------------------------------------------------
   Quem não é assinante nunca vê nada disso: a RPC devolve vazio e a
   linha do plano nem chega em `servicos` (a policy servicos_leitura
   só a entrega para o dono do plano).
============================================================ */
const Assinatura = {
  /** Marca automaticamente agendamentos de assinatura confirmados que passaram 1h como "concluído" */
  async marcarAtrasados() {
    if (!Estado.sessao) return;
    const agora = Date.now();
    const { data: agendamentos } = await sb
      .from('agendamentos')
      .select('id, inicio, status, via_assinatura')
      .eq('cliente_id', Estado.sessao.user.id)
      .eq('barbearia_id', BARBEARIA_ID)
      .eq('status', 'confirmado')
      .eq('via_assinatura', true);

    if (!agendamentos) return;
    const atrasados = agendamentos.filter(a => {
      const inicioMs = new Date(a.inicio).getTime();
      return inicioMs + 60 * 60 * 1000 < agora; // passou 1h do horário
    });

    if (atrasados.length) {
      await Promise.all(atrasados.map(a =>
        sb.from('agendamentos').update({ status: 'concluido' }).eq('id', a.id)
      ));
    }
  },

  /** Recarrega o plano e a cota. p_inicio = mês/semana que interessa consultar. */
  async carregar(inicio = null) {
    if (!Estado.sessao) {
      Estado.assinatura = null;
      this.aplicar();
      return;
    }
    await this.marcarAtrasados(); // marca automaticamente antes de recarregar cota
    const args = inicio ? { p_inicio: inicio.toISOString() } : {};
    const { data } = await sb.rpc('minha_assinatura', args);
    Estado.assinatura = data?.[0] || null;
    this.aplicar();
  },

  /** Liga/desliga tudo que é visível só para assinante */
  aplicar() {
    const a = Estado.assinatura;
    $('#selo-assinante').hidden = !a;
    $('#aba-assinatura').hidden = !a;

    if (!a) {
      // Se estava na aba da assinatura e a pessoa saiu da conta, volta para "novo"
      if (!$('#painel-assinatura').hidden) Abas.mostrar('novo');
      return;
    }

    $('#plano-nome').textContent = a.nome;
    $('#plano-descricao').textContent = a.descricao || '';
    $('#plano-cota').innerHTML = this.textoCota();
    $('#plano-pezinhos-cota').innerHTML = this.textoQuotaPezinhos();
  },

  /** Frase da cota, usada na aba e no card do plano */
  textoCota() {
    const a = Estado.assinatura;
    if (!a) return '';
    if (a.restantes <= 0) {
      return 'Você já usou as <strong>4 visitas deste mês</strong>. A cota volta no mês que vem.';
    }
    if (a.usado_semana) {
      return `Restam <strong>${a.restantes} de 4</strong> este mês, mas a visita <strong>desta semana</strong> já foi usada.`;
    }
    return `Restam <strong>${a.restantes} de 4</strong> este mês · 1 por semana · seg a sex`;
  },

  /** Cota de pezinhos (mesmo que cortes, mas campo separado) */
  textoQuotaPezinhos() {
    const a = Estado.assinatura;
    if (!a) return '';
    // ponytail: reutiliza mesma lógica de cortes, assumindo campos pezinhos_restantes/pezinhos_usado_semana
    // Se o banco não tiver, mostra padrão
    const restantes = a.pezinhos_restantes ?? a.restantes;
    const usadoSemana = a.pezinhos_usado_semana ?? a.usado_semana;
    if (restantes <= 0) {
      return 'Você já usou os <strong>4 pezinhos deste mês</strong>. A cota volta no mês que vem.';
    }
    if (usadoSemana) {
      return `Restam <strong>${restantes} de 4</strong> este mês, mas o pezinho <strong>desta semana</strong> já foi usado.`;
    }
    return `Restam <strong>${restantes} de 4</strong> este mês · 1 por semana · seg a sex`;
  },

  /** Pode agendar pelo plano no horário/dia escolhido? */
  bloqueio() {
    const a = Estado.assinatura;
    if (!a) return 'Plano indisponível.';

    // Se escolheu Pezinhos
    const escolheuPezinhos = Estado.servicosEscolhidos.some((s) => s.nome === 'Pezinhos');
    if (escolheuPezinhos) {
      const pezRest = a.pezinhos_restantes ?? a.restantes;
      const pezUsado = a.pezinhos_usado_semana ?? a.usado_semana;
      if (pezRest <= 0) return 'Você já usou os 4 pezinhos deste mês.';
      if (pezUsado) return 'Você já usou seu pezinho desta semana.';
      return null;
    }

    // Se escolheu Corte/plano normal
    if (a.restantes <= 0) return 'Você já usou as 4 visitas deste mês.';
    if (a.usado_semana) return 'Você já usou sua visita desta semana.';
    return null;
  },
};

/* ============================================================
   SESSÃO / AUTENTICAÇÃO
============================================================ */
const Auth = {
  async init() {
    const { data } = await sb.auth.getSession();
    Estado.sessao = data.session;
    this.renderizar();
    await Assinatura.carregar();

    let usuarioAtual = data.session?.user?.id ?? null;

    sb.auth.onAuthStateChange(async (_evento, sessao) => {
      Estado.sessao = sessao;
      this.renderizar();

      // Só recarrega quando a identidade muda de fato — o SDK dispara esse
      // callback também em refresh de token, e recarregar ali competiria
      // com o render que já está na tela.
      const novoUsuario = sessao?.user?.id ?? null;
      if (novoUsuario !== usuarioAtual) {
        usuarioAtual = novoUsuario;
        // Entrar/sair muda quem é assinante, e com isso a lista de serviços:
        // a linha do plano só é entregue pela policy ao dono dela.
        await Assinatura.carregar();
        await Agendamento.carregarServicos();
      }

      // Se o login foi pedido durante uma confirmação, retoma o fluxo
      if (sessao && Estado.aguardandoConfirmacao) {
        Estado.aguardandoConfirmacao = false;
        $('#area-auth').hidden = true;
        Agendamento.confirmar();
      }
    });

    // Alternância entre "Entrar" e "Criar conta"
    $('#aba-entrar').addEventListener('click', () => this.alternarAba('entrar'));
    $('#aba-criar').addEventListener('click', () => this.alternarAba('criar'));

    // Recuperação de senha
    $('#link-esqueci-senha').addEventListener('click', () => this.mostrarRecuperar());
    $('#link-voltar-entrar').addEventListener('click', () => this.alternarAba('entrar'));
    $('#form-recuperar').addEventListener('submit', (e) => this.recuperarSenha(e));

    // Máscara de celular no cadastro
    $('#criar-celular').addEventListener('input', (e) => {
      e.target.value = mascararCelular(e.target.value);
    });

    $('#form-entrar').addEventListener('submit', (e) => this.entrar(e));
    $('#form-criar').addEventListener('submit', (e) => this.criarConta(e));
    $('#botao-sair').addEventListener('click', () => sb.auth.signOut());
  },

  renderizar() {
    const area = $('#area-usuario');
    if (Estado.sessao) {
      area.hidden = false;
      const nome = Estado.sessao.user.user_metadata?.nome || Estado.sessao.user.email;
      $('#usuario-nome').textContent = `Olá, ${nome.split(' ')[0]}`;
      $('#area-auth').hidden = true;
    } else {
      area.hidden = true;
    }
  },

  alternarAba(qual) {
    const entrar = qual === 'entrar';
    $('#abas-auth').hidden = false;
    $('#aba-entrar').classList.toggle('ativa', entrar);
    $('#aba-entrar').setAttribute('aria-selected', entrar);
    $('#aba-criar').classList.toggle('ativa', !entrar);
    $('#aba-criar').setAttribute('aria-selected', !entrar);
    $('#form-entrar').hidden = !entrar;
    $('#form-criar').hidden = entrar;
    $('#form-recuperar').hidden = true;
    this.mensagem('', '');
  },

  mostrarRecuperar() {
    $('#abas-auth').hidden = true;
    $('#form-entrar').hidden = true;
    $('#form-criar').hidden = true;
    $('#form-recuperar').hidden = false;
    this.mensagem('', '');
  },

  async recuperarSenha(evento) {
    evento.preventDefault();
    const botao = $('button[type="submit"]', evento.target);
    this.carregando(botao, true);

    const { error } = await sb.auth.resetPasswordForEmail($('#recuperar-email').value.trim(), {
      redirectTo: `${window.location.origin}/redefinir-senha.html`,
    });

    this.carregando(botao, false);

    // Mensagem genérica sempre — não revela se o email tem conta ou não
    if (error && error.status !== 429) {
      this.mensagem('erro', 'Não foi possível enviar o link agora. Tente novamente em instantes.');
      return;
    }
    this.mensagem('info', 'Se esse email tiver uma conta, enviamos um link para redefinir a senha.');
    evento.target.reset();
  },

  mostrar() {
    const area = $('#area-auth');
    area.hidden = false;
    // A saída "sem conta" só faz sentido no meio de uma confirmação;
    // em "Meus agendamentos" não há agendamento para concluir.
    $('#voltar-visitante-area').hidden = !Estado.aguardandoConfirmacao;
    this.mensagem('info', Estado.aguardandoConfirmacao
      ? 'Entre na sua conta para concluir — ou volte e agende só com nome e telefone.'
      : 'Entre na sua conta para ver seus agendamentos.');
    area.scrollIntoView({ behavior: 'smooth', block: 'center' });
  },

  mensagem(tipo, texto) {
    const erro = $('#erro-auth');
    const info = $('#info-auth');
    erro.hidden = tipo !== 'erro';
    info.hidden = tipo !== 'info';
    if (tipo === 'erro') erro.textContent = texto;
    if (tipo === 'info') info.textContent = texto;
  },

  async entrar(evento) {
    evento.preventDefault();
    const botao = $('button[type="submit"]', evento.target);
    this.carregando(botao, true);

    const { error } = await sb.auth.signInWithPassword({
      email: $('#entrar-email').value.trim(),
      password: $('#entrar-senha').value,
    });

    this.carregando(botao, false);

    if (error) {
      const msg = /confirm/i.test(error.message)
        ? 'Confirme seu email antes de entrar — enviamos um link para sua caixa de entrada.'
        : 'Email ou senha incorretos. Tente novamente.';
      this.mensagem('erro', msg);
    }
  },

  async criarConta(evento) {
    evento.preventDefault();
    const nome = $('#criar-nome').value.trim();
    const celular = $('#criar-celular').value;
    const email = $('#criar-email').value.trim();
    const senha = $('#criar-senha').value;

    if (nome.length < 3) return this.mensagem('erro', 'Informe seu nome completo.');
    if (celular.replace(/\D/g, '').length < 11) return this.mensagem('erro', 'Informe o celular com DDD.');
    if (senha.length < 6) return this.mensagem('erro', 'A senha precisa ter pelo menos 6 caracteres.');

    const botao = $('button[type="submit"]', evento.target);
    this.carregando(botao, true);

    const { data, error } = await sb.auth.signUp({
      email,
      password: senha,
      options: { data: { nome, celular, barbearia_id: BARBEARIA_ID } },
    });

    this.carregando(botao, false);

    if (error) {
      const msg = /already registered/i.test(error.message)
        ? 'Este email já tem conta. Use a aba "Entrar".'
        : 'Não foi possível criar a conta. Verifique os dados e tente de novo.';
      return this.mensagem('erro', msg);
    }

    // Se o projeto exige confirmação de email, ainda não há sessão
    if (!data.session) {
      this.mensagem('info', 'Conta criada! Enviamos um link de confirmação para o seu email. Depois de confirmar, volte aqui e entre.');
      this.alternarAba('entrar');
    }
  },

  carregando(botao, ativo) {
    botao.classList.toggle('carregando', ativo);
    botao.disabled = ativo;
  },
};

/* ============================================================
   AGENDAMENTO — passos, grade de horários e confirmação
============================================================ */
const Agendamento = {
  async init() {
    await Promise.all([this.carregarBarbeiros(), this.carregarServicos()]);
    this.montarDias();
    $('#botao-confirmar').addEventListener('click', () => this.confirmar());
    $('#botao-agendar-outro').addEventListener('click', () => this.reiniciar());
    $('#botao-ver-meus').addEventListener('click', async () => {
      await this.reiniciar();
      Abas.mostrar('meus');
    });
  },

  async carregarBarbeiros() {
    const { data, error } = await sb
      .from('barbeiros')
      .select('id, nome')
      .eq('ativo', true)
      .eq('barbearia_id', BARBEARIA_ID)
      .order('criado_em');

    const area = $('#lista-barbeiros');
    if (error || !data?.length) {
      area.innerHTML = '<p class="app-erro">Nenhum barbeiro disponível no momento.</p>';
      return;
    }

    Estado.barbeiros = data;
    const cartaoQualquer = `
        <button class="opcao-servico opcao-servico--curinga vidro" type="button" data-id="qualquer">
          <span class="opcao-servico__nome">Sem preferência</span>
          <span class="opcao-servico__descricao">Corto com quem estiver disponível</span>
        </button>`;
    area.innerHTML = cartaoQualquer + data
      .map(
        (b) => `
        <button class="opcao-servico vidro" type="button" data-id="${b.id}">
          <span class="opcao-servico__nome">${escaparHtml(b.nome)}</span>
        </button>`
      )
      .join('');

    $$('.opcao-servico', area).forEach((botao) => {
      botao.addEventListener('click', async () => {
        $$('.opcao-servico', area).forEach((b) => b.classList.remove('escolhido'));
        botao.classList.add('escolhido');
        Estado.semPreferencia = botao.dataset.id === 'qualquer';
        Estado.barbeiroEscolhido = Estado.semPreferencia
          ? null
          : Estado.barbeiros.find((b) => b.id === botao.dataset.id);
        // Trocar de barbeiro zera dia/horário e recarrega a disponibilidade dele
        Estado.diaEscolhido = null;
        Estado.horarioEscolhido = null;
        await this.carregarHorarios();
        this.montarDias();
        this.montarSlots();
        this.atualizarResumo();
      });
    });
  },

  async carregarServicos() {
    const { data, error } = await sb
      .from('servicos')
      .select('id, nome, descricao, preco_centavos, duracao_min, assinatura')
      .eq('ativo', true)
      .eq('barbearia_id', BARBEARIA_ID)
      .order('assinatura', { ascending: false })  // plano primeiro
      .order('preco_centavos');

    const area = $('#lista-servicos');
    if (error || !data?.length) {
      area.innerHTML = '<p class="app-erro">Não foi possível carregar os serviços. Recarregue a página.</p>';
      return;
    }

    // A RLS libera as linhas de plano também para o admin (ele precisa vê-las
    // na aba Assinantes). Na tela de agendar, só o dono do plano pode ver a
    // própria linha — qualquer outra linha de plano fica de fora daqui.
    const meuPlanoId = Estado.assinatura?.servico_id;
    const visiveis = data.filter((s) => !s.assinatura || s.id === meuPlanoId);

    Estado.servicos = visiveis;
    // Um serviço que sumiu da lista (ex.: perdeu o plano ao sair da conta)
    // não pode continuar selecionado no estado.
    Estado.servicosEscolhidos = Estado.servicosEscolhidos.filter((e) => visiveis.some((s) => s.id === e.id));

    const bloqueio = Assinatura.bloqueio();
    area.innerHTML = visiveis.map((s) => this.cartaoServico(s, bloqueio)).join('');

    $$('.opcao-servico', area).forEach((botao) => {
      // Marca o que já estava escolhido (a lista é re-renderizada em login/logout)
      if (Estado.servicosEscolhidos.some((x) => x.id === botao.dataset.id)) {
        botao.classList.add('escolhido');
      }
      if (botao.disabled) return;

      botao.addEventListener('click', () => {
        const s = Estado.servicos.find((x) => x.id === botao.dataset.id);
        const i = Estado.servicosEscolhidos.findIndex((x) => x.id === s.id);

        if (i >= 0) {
          Estado.servicosEscolhidos.splice(i, 1); // desmarca
        } else if (s.assinatura) {
          // ponytail: permite dois planos de assinatura (Cortes + Pezinhos)
          const jaTemPlano = Estado.servicosEscolhidos.some((x) => x.assinatura);
          if (jaTemPlano && s.nome !== 'Pezinhos' && !Estado.servicosEscolhidos.some((x) => x.nome === 'Pezinhos')) {
            // Trocar de plano (não é Pezinhos)
            Estado.servicosEscolhidos = Estado.servicosEscolhidos.filter((x) => x.nome === 'Pezinhos');
            Estado.servicosEscolhidos.push(s);
          } else if (jaTemPlano && s.nome === 'Pezinhos' && !Estado.servicosEscolhidos.some((x) => x.nome === 'Pezinhos')) {
            // Adicionar Pezinhos ao lado do plano existente
            Estado.servicosEscolhidos.push(s);
          } else if (!jaTemPlano) {
            // Primeiro plano
            Estado.servicosEscolhidos.push(s);
          }
        } else {
          // Escolher um avulso abandona o plano, pelo mesmo motivo.
          Estado.servicosEscolhidos = Estado.servicosEscolhidos.filter((x) => !x.assinatura);
          Estado.servicosEscolhidos.push(s);
        }

        $$('.opcao-servico', area).forEach((b) => {
          b.classList.toggle('escolhido', Estado.servicosEscolhidos.some((x) => x.id === b.dataset.id));
        });

        Estado.horarioEscolhido = null;
        this.atualizarTotalServicos();
        this.montarDias();
        this.montarSlots();
        this.atualizarResumo();
      });
    });
  },

  /** HTML de um serviço. O plano ganha coroa, cota explícita e trava. */
  cartaoServico(s, bloqueio) {
    if (!s.assinatura) {
      return `
        <button class="opcao-servico vidro" type="button" data-id="${s.id}">
          <span class="opcao-servico__nome">${escaparHtml(s.nome)}</span>
          <span class="opcao-servico__descricao">${escaparHtml(s.descricao || '')}</span>
          <span class="opcao-servico__base">
            <strong>${formatarPreco(s.preco_centavos)}</strong>
            <small>${s.duracao_min} min</small>
          </span>
        </button>`;
    }

    const travado = Boolean(bloqueio);
    return `
      <button class="opcao-servico opcao-servico--plano vidro${travado ? ' opcao-servico--travado' : ''}"
              type="button" data-id="${s.id}"${travado ? ' disabled' : ''}>
        <span class="opcao-servico__nome">
          <svg class="opcao-servico__coroa" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M3 7l4.5 3.5L12 4l4.5 6.5L21 7l-1.8 11.2a1 1 0 0 1-1 .8H5.8a1 1 0 0 1-1-.8L3 7z"/>
          </svg>
          ${escaparHtml(s.nome)}
        </span>
        <span class="opcao-servico__descricao">${escaparHtml(s.descricao || '')}</span>
        <span class="opcao-servico__cota${travado ? ' opcao-servico__cota--travado' : ''}">
          ${travado ? escaparHtml(bloqueio) : Assinatura.textoCota()}
        </span>
        <span class="opcao-servico__base">
          <strong>${travado ? 'Indisponível' : 'Incluso no plano'}</strong>
          <small>${s.duracao_min} min</small>
        </span>
      </button>`;
  },

  /** Ids dos barbeiros relevantes: um só (escolhido) ou todos os ativos ("sem preferência") */
  barbeiroIds() {
    if (Estado.semPreferencia) return Estado.barbeiros.map((b) => b.id);
    return Estado.barbeiroEscolhido ? [Estado.barbeiroEscolhido.id] : [];
  },

  async carregarHorarios() {
    Estado.horariosPorBarbeiro = {};
    Estado.bloqueiosPorBarbeiro = {};
    const ids = this.barbeiroIds();
    if (!ids.length) return;

    const [horarios, bloqueios] = await Promise.all([
      sb.from('horarios_funcionamento').select('*').in('barbeiro_id', ids),
      sb.from('bloqueios').select('barbeiro_id, inicio, fim').in('barbeiro_id', ids)
        .gt('fim', new Date().toISOString()),
    ]);

    (horarios.data || []).forEach((h) => {
      (Estado.horariosPorBarbeiro[h.barbeiro_id] ??= {})[h.dia_semana] = h;
    });
    // guarda em ms para comparar rápido no calendário (férias/ausências que cobrem o dia todo)
    (bloqueios.data || []).forEach((b) => {
      (Estado.bloqueiosPorBarbeiro[b.barbeiro_id] ??= []).push({
        inicio: new Date(b.inicio).getTime(),
        fim: new Date(b.fim).getTime(),
      });
    });
  },

  /** Dia disponível: existe ao menos 1 barbeiro (dos relevantes) aberto e sem ausência cobrindo o dia todo */
  diaDisponivel(ymd, diaSemana) {
    // Plano mensal atende exclusivamente de segunda a sexta (regulamento).
    // Sem isso a pessoa escolheria sábado e só levaria o erro na confirmação.
    if (planoSelecionado() && (diaSemana === 0 || diaSemana === 6)) return false;

    return this.barbeiroIds().some((id) => {
      const config = (Estado.horariosPorBarbeiro[id] || {})[diaSemana];
      if (!config || config.fechado || !config.abre || !config.fecha) return false;
      const abre = new Date(`${ymd}T${config.abre}${OFFSET}`).getTime();
      const fecha = new Date(`${ymd}T${config.fecha}${OFFSET}`).getTime();
      const bloqueios = Estado.bloqueiosPorBarbeiro[id] || [];
      const bloqueadoTotal = bloqueios.some((b) => b.inicio <= abre && b.fim >= fecha);
      return !bloqueadoTotal;
    });
  },

  /** Renderiza o calendário mensal (grade) e liga a navegação de mês */
  montarDias() {
    const area = $('#lista-dias');

    if (!this.barbeiroIds().length) {
      area.innerHTML = '<p class="app-aviso-passo">Escolha o barbeiro para ver os dias disponíveis.</p>';
      return;
    }

    // "Hoje" no fuso da barbearia (ex.: "2026-07-02")
    const hojeYmd = partesNoFuso(new Date()).ymd;
    const [hAno, hMes] = hojeYmd.split('-').map(Number);

    // Mês exibido — usa UTC/dia 1 para contas de calendário estáveis
    if (!Estado.mesVisivel) Estado.mesVisivel = new Date(Date.UTC(hAno, hMes - 1, 1));
    const ano = Estado.mesVisivel.getUTCFullYear();
    const mes = Estado.mesVisivel.getUTCMonth(); // 0–11

    // Limites de navegação: do mês atual até MESES_A_FRENTE meses adiante
    const chaveMes = (a, m) => `${a}-${String(m + 1).padStart(2, '0')}`;
    const chaveVisivel = chaveMes(ano, mes);
    const chaveAtual = hojeYmd.slice(0, 7);
    const limite = new Date(Date.UTC(hAno, hMes - 1 + MESES_A_FRENTE, 1));
    const chaveMax = chaveMes(limite.getUTCFullYear(), limite.getUTCMonth());
    const podeVoltar = chaveVisivel > chaveAtual;
    const podeAvancar = chaveVisivel < chaveMax;

    // Início da grade: segunda-feira da semana que contém o dia 1
    const primeiro = new Date(Date.UTC(ano, mes, 1));
    const lead = (primeiro.getUTCDay() + 6) % 7; // 0=seg … 6=dom
    const inicio = new Date(Date.UTC(ano, mes, 1 - lead));

    const semana = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

    // 42 células = 6 semanas
    let celulas = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(inicio.getTime() + i * 86400000);
      const cm = d.getUTCMonth();
      const cd = d.getUTCDate();
      const ymd = `${d.getUTCFullYear()}-${String(cm + 1).padStart(2, '0')}-${String(cd).padStart(2, '0')}`;
      const diaSemana = d.getUTCDay(); // 0=dom … 6=sáb

      const noMes = cm === mes;
      const passado = ymd < hojeYmd;
      const indisponivel = !this.diaDisponivel(ymd, diaSemana);
      const ehHoje = ymd === hojeYmd;
      const selecionado = Estado.diaEscolhido && Estado.diaEscolhido.ymd === ymd;
      const clicavel = noMes && !passado && !indisponivel;

      const cls = ['dia-cel'];
      if (!noMes) cls.push('dia-cel--fora');
      if (noMes && passado) cls.push('dia-cel--passado');
      if (noMes && !passado && indisponivel) cls.push('dia-cel--fechado');
      if (clicavel) cls.push('dia-cel--livre');
      if (ehHoje && noMes) cls.push('dia-cel--hoje');
      if (selecionado) cls.push('dia-cel--escolhido');

      const attrs = clicavel
        ? `data-ymd="${ymd}" data-dia-semana="${diaSemana}"`
        : `disabled${noMes && !passado && indisponivel ? ' title="Nenhum horário disponível neste dia"' : ''}`;
      celulas += `<button type="button" class="${cls.join(' ')}" ${attrs}>${cd}</button>`;
    }

    area.innerHTML = `
      <div class="calendario__topo">
        <span class="calendario__mes">${MESES[mes]} ${ano}</span>
        <div class="calendario__nav">
          <button type="button" class="calendario__seta" data-nav="-1" aria-label="Mês anterior" ${podeVoltar ? '' : 'disabled'}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <button type="button" class="calendario__seta" data-nav="1" aria-label="Próximo mês" ${podeAvancar ? '' : 'disabled'}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
          </button>
        </div>
      </div>
      <div class="calendario__semana">${semana.map((s) => `<span>${s}</span>`).join('')}</div>
      <div class="calendario__grade">${celulas}</div>`;

    // Navegação de mês
    $$('.calendario__seta', area).forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        Estado.mesVisivel = new Date(Date.UTC(ano, mes + Number(btn.dataset.nav), 1));
        this.montarDias();
      });
    });

    // Seleção de dia
    $$('.dia-cel--livre', area).forEach((btn) => {
      btn.addEventListener('click', () => {
        Estado.diaEscolhido = {
          ymd: btn.dataset.ymd,
          diaSemana: Number(btn.dataset.diaSemana),
        };
        Estado.horarioEscolhido = null;
        this.montarDias(); // re-renderiza para mover o destaque
        this.montarSlots();
        this.atualizarResumo();
      });
    });
  },

  /** Calcula e exibe os horários livres do dia escolhido (união entre os barbeiros relevantes) */
  async montarSlots() {
    const area = $('#lista-horarios');
    const ids = this.barbeiroIds();

    if (!ids.length || !Estado.servicosEscolhidos.length || !Estado.diaEscolhido) {
      area.innerHTML = '<p class="app-aviso-passo">Selecione o barbeiro, o serviço e o dia para ver os horários livres.</p>';
      return;
    }

    area.innerHTML = '<p class="app-carregando">Buscando horários…</p>';

    const { ymd, diaSemana } = Estado.diaEscolhido;

    // Intervalos já ocupados de cada barbeiro no dia (função pública, sem dados pessoais)
    const resultados = await Promise.all(
      ids.map((id) => sb.rpc('horarios_ocupados', { dia: ymd, barbeiro: id }))
    );
    if (resultados.some((r) => r.error)) {
      area.innerHTML = '<p class="app-erro">Erro ao buscar horários. Tente novamente.</p>';
      return;
    }

    const duracaoMs = this.duracaoTotalMin() * 60000; // soma de todos os serviços escolhidos
    const agora = Date.now() + ANTECEDENCIA_MIN * 60000;

    // Cada barbeiro entra como candidato com seu próprio expediente + ocupações do dia
    const candidatos = ids
      .map((id, i) => {
        const config = (Estado.horariosPorBarbeiro[id] || {})[diaSemana];
        if (!config || config.fechado || !config.abre || !config.fecha) return null;
        return {
          abre: new Date(`${ymd}T${config.abre}${OFFSET}`).getTime(),
          fecha: new Date(`${ymd}T${config.fecha}${OFFSET}`).getTime(),
          ocupados: (resultados[i].data || []).map((o) => ({
            inicio: new Date(o.inicio).getTime(),
            fim: new Date(o.fim).getTime(),
          })),
        };
      })
      .filter(Boolean);

    // Slot livre = algum candidato cobre [inicio, fim] com o expediente dele e sem conflito
    const janelaInicio = candidatos.length ? Math.min(...candidatos.map((c) => c.abre)) : 0;
    const janelaFim = candidatos.length ? Math.max(...candidatos.map((c) => c.fecha)) : 0;

    const slots = [];
    for (let t = janelaInicio; t + duracaoMs <= janelaFim; t += PASSO_MINUTOS * 60000) {
      const inicio = t;
      const fim = t + duracaoMs;
      if (inicio < agora) continue; // horário já passou (ou muito em cima)

      const disponivel = candidatos.some((c) =>
        inicio >= c.abre && fim <= c.fecha &&
        !c.ocupados.some((o) => inicio < o.fim && fim > o.inicio)
      );
      if (disponivel) slots.push(new Date(inicio));
    }

    if (slots.length === 0) {
      area.innerHTML = '<p class="app-aviso-passo">Nenhum horário livre neste dia. Escolha outro dia.</p>';
      return;
    }

    area.innerHTML = slots
      .map((d) => `<button class="opcao-horario" type="button" data-iso="${d.toISOString()}">${formatarHora(d.toISOString())}</button>`)
      .join('');

    $$('.opcao-horario', area).forEach((botao) => {
      botao.addEventListener('click', () => {
        $$('.opcao-horario').forEach((b) => b.classList.remove('escolhido'));
        botao.classList.add('escolhido');
        Estado.horarioEscolhido = new Date(botao.dataset.iso);
        this.atualizarResumo();
      });
    });
  },

  duracaoTotalMin() {
    return Estado.servicosEscolhidos.reduce((s, x) => s + x.duracao_min, 0);
  },

  precoTotalCentavos() {
    return Estado.servicosEscolhidos.reduce((s, x) => s + x.preco_centavos, 0);
  },

  /** Mostra, já no passo de serviços, o total (qtd · tempo · valor) do que foi escolhido */
  atualizarTotalServicos() {
    const el = $('#servicos-total');
    const n = Estado.servicosEscolhidos.length;
    el.hidden = n === 0;
    if (n === 0) return;

    if (planoSelecionado()) {
      // Já foi pago na mensalidade — mostrar preço aqui confundiria.
      el.innerHTML = `Pelo seu plano · ${this.duracaoTotalMin()} min · <strong>sem cobrança no dia</strong>`;
      return;
    }
    el.innerHTML =
      `${n} serviço${n > 1 ? 's' : ''} · ${this.duracaoTotalMin()} min · ` +
      `total <strong>${formatarPreco(this.precoTotalCentavos())}</strong>`;
  },

  atualizarResumo() {
    const resumo = $('#resumo');
    const temBarbeiro = Estado.barbeiroEscolhido || Estado.semPreferencia;
    const completo = temBarbeiro && Estado.servicosEscolhidos.length && Estado.diaEscolhido && Estado.horarioEscolhido;
    resumo.hidden = !completo;
    $('#erro-agendar').hidden = true;
    if (!completo) return;

    const nomes = Estado.servicosEscolhidos.map((s) => escaparHtml(s.nome)).join(' + ');
    const comBarbeiro = Estado.semPreferencia
      ? 'sem preferência de barbeiro'
      : `com <strong>${escaparHtml(Estado.barbeiroEscolhido.nome)}</strong>`;
    const valor = planoSelecionado()
      ? '<strong>Incluso no plano</strong>'
      : `<strong>${formatarPreco(this.precoTotalCentavos())}</strong>`;
    $('#resumo-texto').innerHTML =
      `<strong>${nomes}</strong> ${comBarbeiro} — ${valor} · ` +
      `${formatarDataHora(Estado.horarioEscolhido.toISOString())} · ${this.duracaoTotalMin()} min`;
  },

  async confirmar() {
    // Sem login: oferece agendar só com nome e telefone (criar conta é opcional)
    if (!Estado.sessao) {
      Estado.aguardandoConfirmacao = true;
      Visitante.mostrar();
      return;
    }

    const botao = $('#botao-confirmar');
    botao.classList.add('carregando');
    botao.disabled = true;
    $('#erro-agendar').hidden = true;

    const inicio = Estado.horarioEscolhido;

    // RPC atômica: cria o agendamento + serviços e soma a duração no servidor.
    // (p_barbeiro nulo = "sem preferência": o próprio servidor escolhe quem está livre)
    // via_assinatura é derivado no servidor a partir de servicos.assinatura.
    const { error } = await sb.rpc('criar_agendamento', {
      p_barbeiro: Estado.semPreferencia ? null : Estado.barbeiroEscolhido.id,
      p_servico_ids: Estado.servicosEscolhidos.map((s) => s.id),
      p_inicio: inicio.toISOString(),
    });

    botao.classList.remove('carregando');
    botao.disabled = false;

    if (error) {
      this.mostrarErro(error);
      // A cota pode ter sido o motivo — recarrega para o card refletir a verdade
      if (planoSelecionado()) {
        await Assinatura.carregar(inicio);
        await this.carregarServicos();
      }
      return;
    }

    Estado.agendouComoVisitante = false;
    if (planoSelecionado()) await Assinatura.carregar();
    this.mostrarSucesso(inicio);
  },

  /** Mensagem de erro da RPC. As do plano vêm prontas do servidor e dizem
      exatamente qual regra barrou — repassar genérico geraria ligação. */
  mostrarErro(error) {
    const el = $('#erro-agendar');
    const conflito = error.code === '23P01';
    const doPlano = /visita|plano|segunda a sexta/i.test(error.message || '');
    // 42501/22023 são os códigos que a RPC usa para TODAS as suas próprias
    // validações (conta de outra barbearia, horário fora do expediente, etc.)
    // — a mensagem já vem pronta e específica; só o erro realmente inesperado
    // (rede, bug) cai no texto genérico.
    const erroConhecido = error.code === '42501' || error.code === '22023';

    el.textContent = conflito
      ? 'Esse horário acabou de ficar indisponível. Escolha outro, por favor.'
      : doPlano
        ? `${error.message} Você ainda pode agendar pelos serviços avulsos.`
        : erroConhecido
          ? error.message
          : 'Não foi possível concluir o agendamento. Tente novamente.';
    el.hidden = false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (conflito) this.montarSlots();
  },

  mostrarSucesso(inicio) {
    const nomes = Estado.servicosEscolhidos.map((s) => s.nome).join(' + ');
    const quemTexto = Estado.semPreferencia ? '' : ` com ${Estado.barbeiroEscolhido.nome}`;
    $('#sucesso-agendar-texto').textContent =
      `${nomes}${quemTexto} — ${formatarDataHora(inicio.toISOString())}. Te esperamos!`;
    // Visitante não tem onde consultar depois — o botão abriria a tela de login.
    $('#botao-ver-meus').hidden = Estado.agendouComoVisitante;
    $('#area-visitante').hidden = true;
    $('#area-auth').hidden = true;
    $('#painel-novo').querySelectorAll('.passo, .resumo').forEach((el) => (el.hidden = true));
    $('#sucesso-agendar').hidden = false;
    $('#sucesso-agendar-titulo').focus();
  },

  async reiniciar() {
    Estado.barbeiroEscolhido = null;
    Estado.semPreferencia = false;
    Estado.servicosEscolhidos = [];
    Estado.diaEscolhido = null;
    Estado.horarioEscolhido = null;
    Estado.horariosPorBarbeiro = {};
    Estado.bloqueiosPorBarbeiro = {};
    Estado.mesVisivel = null; // volta o calendário para o mês atual
    Estado.agendouComoVisitante = false;
    $('#botao-ver-meus').hidden = false;
    $$('.opcao-servico, .opcao-horario').forEach((b) => b.classList.remove('escolhido'));
    // Redesenha o card do plano com a cota já atualizada
    await this.carregarServicos();
    this.atualizarTotalServicos(); // esconde o total
    this.montarDias(); // re-renderiza o calendário sem dia selecionado
    $('#lista-horarios').innerHTML = '<p class="app-aviso-passo">Selecione o barbeiro, o serviço e o dia para ver os horários livres.</p>';
    $('#resumo').hidden = true;
    $('#sucesso-agendar').hidden = true;
    $('#painel-novo').querySelectorAll('.passo').forEach((el) => (el.hidden = false));
  },
};

/* ============================================================
   VISITANTE — agendar sem conta (nome + telefone)
   ------------------------------------------------------------
   Não há tela de acompanhamento: o agendamento aparece só no painel
   do barbeiro. Quem quiser gerenciar sozinho cria conta.
============================================================ */
const Visitante = {
  init() {
    $('#form-visitante').addEventListener('submit', (e) => this.enviar(e));
    $('#visitante-celular').addEventListener('input', (e) => {
      e.target.value = mascararCelular(e.target.value);
    });
    // Trocas entre "sem conta" e "com conta"
    $('#link-usar-conta').addEventListener('click', () => {
      $('#area-visitante').hidden = true;
      Auth.mostrar();
    });
    $('#link-sem-conta').addEventListener('click', () => {
      $('#area-auth').hidden = true;
      this.mostrar();
    });
  },

  mostrar() {
    const area = $('#area-visitante');
    area.hidden = false;
    $('#erro-visitante').hidden = true;
    area.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('#visitante-nome').focus();
  },

  erro(texto) {
    const el = $('#erro-visitante');
    el.textContent = texto;
    el.hidden = false;
  },

  async enviar(evento) {
    evento.preventDefault();
    const nome = $('#visitante-nome').value.trim();
    const celular = $('#visitante-celular').value;

    if (nome.length < 3) return this.erro('Informe seu nome completo.');
    if (celular.replace(/\D/g, '').length !== 11) return this.erro('Informe o celular com DDD.');

    const botao = $('button[type="submit"]', evento.target);
    botao.classList.add('carregando');
    botao.disabled = true;
    $('#erro-visitante').hidden = true;

    const inicio = Estado.horarioEscolhido;
    const { error } = await sb.rpc('criar_agendamento_visitante', {
      p_barbeiro: Estado.semPreferencia ? null : Estado.barbeiroEscolhido.id,
      p_servico_ids: Estado.servicosEscolhidos.map((s) => s.id),
      p_inicio: inicio.toISOString(),
      p_nome: nome,
      p_celular: celular,
    });

    botao.classList.remove('carregando');
    botao.disabled = false;

    if (error) {
      if (error.code === '23P01') {
        $('#area-visitante').hidden = true;
        Agendamento.mostrarErro(error);
        return;
      }
      // As validações da RPC já vêm em português e são específicas
      this.erro(error.message || 'Não foi possível concluir o agendamento. Tente novamente.');
      return;
    }

    Estado.aguardandoConfirmacao = false;
    Estado.agendouComoVisitante = true;
    evento.target.reset();
    Agendamento.mostrarSucesso(inicio);
  },
};

/* ============================================================
   MEUS AGENDAMENTOS
============================================================ */
const MeusAgendamentos = {
  async carregar() {
    const area = $('#lista-meus');

    if (!Estado.sessao) {
      area.innerHTML = '<p class="app-aviso-passo">Entre na sua conta para ver seus agendamentos.</p>';
      Auth.mostrar();
      return;
    }

    area.innerHTML = '<p class="app-carregando">Carregando…</p>';

    // cliente_id explícito é essencial aqui: a policy de leitura também libera
    // admins a ver TODOS os agendamentos da barbearia (para a Agenda do painel).
    // Sem esse filtro, uma conta que é admin via admins_barbearia enxergaria os
    // agendamentos de outros clientes nesta tela de "Meus agendamentos".
    const { data, error } = await sb
      .from('agendamentos')
      .select('id, inicio, fim, status, via_assinatura, agendamento_servicos(servicos(nome, preco_centavos))')
      .eq('cliente_id', Estado.sessao.user.id)
      .eq('barbearia_id', BARBEARIA_ID)
      .order('inicio', { ascending: false })
      .limit(50);

    if (error) {
      area.innerHTML = '<p class="app-erro">Erro ao carregar seus agendamentos.</p>';
      return;
    }

    if (!data.length) {
      area.innerHTML = '<p class="app-aviso-passo">Você ainda não tem agendamentos. Que tal marcar o primeiro?</p>';
      return;
    }

    const agora = Date.now();
    // Agendamentos de assinatura ficam fora do "limpar": apagar a linha
    // devolveria a cota do mês (a contagem lê a tabela). A policy no banco
    // também recusa — sem este filtro o botão só fingiria que funcionou,
    // porque um delete que não casa linha nenhuma não retorna erro.
    const podeApagarItem = (a) => (a.status === 'cancelado' || a.status === 'concluido') && !a.via_assinatura;
    const temFinalizados = data.some(podeApagarItem);

    // Ícone de lixeira reutilizado nos botões
    const svgLixeira = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6"/><path d="M10 11v6M14 11v6"/></svg>';

    const toolbar = temFinalizados
      ? `<div class="lista-toolbar">
           <button class="botao-limpar" type="button" id="limpar-finalizados-cliente">${svgLixeira} Limpar cancelados e concluídos</button>
         </div>`
      : '';

    const cards = data
      .map((a) => {
        const inicioMs = new Date(a.inicio).getTime();
        const futuro = inicioMs > agora;
        // ponytail: cancelamento de assinatura só vale com 1h de antecedência.
        // Abaixo disso conta como concluído. A policy no banco recusa de qualquer jeito.
        const diferencaMs = inicioMs - agora;
        const travadoPor1h = a.via_assinatura && diferencaMs <= 60 * 60 * 1000;
        const podeCancelar = a.status === 'confirmado' && futuro && !travadoPor1h;
        const podeApagar = podeApagarItem(a);
        const serv = servicosResumo(a);
        const valor = a.via_assinatura ? 'Pelo seu plano' : formatarPreco(serv.total);
        return `
        <article class="cartao-agendamento vidro" data-id="${a.id}">
          <div class="cartao-agendamento__info">
            <strong>${a.via_assinatura ? '<span class="cartao-agendamento__coroa" title="Agendamento da assinatura">♛</span> ' : ''}${escaparHtml(serv.nomes)}</strong>
            <span>${formatarDataHora(a.inicio)} · ${valor}</span>
            ${a.status === 'confirmado' && futuro && travadoPor1h
              ? '<small class="cartao-agendamento__nota">Faltam menos de 1h — cancelamento não é mais possível. Este agendamento será contabilizado.</small>'
              : ''}
          </div>
          <div class="cartao-agendamento__acoes">
            <span class="etiqueta-status etiqueta-status--${a.status}">${ROTULO_STATUS[a.status] || a.status}</span>
            ${podeCancelar ? '<button class="botao botao--fantasma botao--pequeno acao-cancelar" type="button">Cancelar</button>' : ''}
            ${podeApagar ? `<button class="acao-apagar" type="button" aria-label="Apagar agendamento" title="Apagar do histórico">${svgLixeira}</button>` : ''}
          </div>
        </article>`;
      })
      .join('');

    area.innerHTML = toolbar + cards;

    // Cancelar (agendamentos confirmados futuros)
    $$('.acao-cancelar', area).forEach((botao) => {
      botao.addEventListener('click', async () => {
        const cartao = botao.closest('.cartao-agendamento');
        const ok = await confirmar({
          titulo: 'Cancelar agendamento?',
          texto: 'Seu horário será liberado. Você pode marcar outro quando quiser.',
          confirmarLabel: 'Sim, cancelar',
        });
        if (!ok) return;

        botao.disabled = true;
        const { error: erroCancelar } = await sb
          .from('agendamentos')
          .update({ status: 'cancelado' })
          .eq('id', cartao.dataset.id);

        if (erroCancelar) {
          botao.disabled = false;
          await avisar('Ops!', 'Não foi possível cancelar. Se faltam menos de 1h para o horário, não é mais possível cancelar.');
          return;
        }
        await Assinatura.carregar(); // cancelar com 1h+ devolve a visita
        this.carregar();
      });
    });

    // Apagar um do histórico (cancelado/concluído)
    $$('.acao-apagar', area).forEach((botao) => {
      botao.addEventListener('click', async () => {
        const cartao = botao.closest('.cartao-agendamento');
        const ok = await confirmar({
          titulo: 'Apagar agendamento?',
          texto: 'Ele será removido do seu histórico permanentemente.',
          confirmarLabel: 'Sim, apagar',
        });
        if (!ok) return;

        botao.disabled = true;
        const { error: erroApagar } = await sb
          .from('agendamentos')
          .delete()
          .eq('id', cartao.dataset.id);

        if (erroApagar) {
          botao.disabled = false;
          await avisar('Ops!', 'Não foi possível apagar. Tente novamente.');
          return;
        }
        this.carregar();
      });
    });

    // Limpar todos os finalizados de uma vez
    const btnLimpar = $('#limpar-finalizados-cliente');
    if (btnLimpar) {
      btnLimpar.addEventListener('click', async () => {
        const ok = await confirmar({
          titulo: 'Limpar histórico?',
          texto: 'Todos os seus agendamentos cancelados e concluídos serão apagados permanentemente.',
          confirmarLabel: 'Sim, apagar todos',
        });
        if (!ok) return;
        const { error: erroLimpar } = await sb
          .from('agendamentos')
          .delete()
          .eq('via_assinatura', false)   // apagar assinatura devolveria a cota
          .in('status', ['cancelado', 'concluido']);
        if (erroLimpar) {
          await avisar('Ops!', 'Não foi possível limpar. Tente novamente.');
          return;
        }
        this.carregar();
      });
    }
  },
};

/* ============================================================
   ABAS PRINCIPAIS (novo / meus)
============================================================ */
const Abas = {
  // aba -> painel. Virou mapa porque agora são três (a de assinatura
  // só fica visível para assinante).
  mapa: {
    novo: ['#aba-novo', '#painel-novo'],
    meus: ['#aba-meus', '#painel-meus'],
    assinatura: ['#aba-assinatura', '#painel-assinatura'],
  },

  init() {
    Object.keys(this.mapa).forEach((qual) => {
      $(this.mapa[qual][0]).addEventListener('click', () => this.mostrar(qual));
    });

    // Link direto: agendar.html#meus abre a aba de agendamentos
    if (location.hash === '#meus') this.mostrar('meus');
  },

  mostrar(qual) {
    Object.entries(this.mapa).forEach(([nome, [aba, painel]]) => {
      const ativa = nome === qual;
      $(aba).classList.toggle('ativa', ativa);
      $(aba).setAttribute('aria-selected', ativa);
      $(painel).hidden = !ativa;
    });
    $('#area-auth').hidden = true;
    $('#area-visitante').hidden = true;
    if (qual === 'meus') MeusAgendamentos.carregar();
  },
};

/* ============================================================
   INICIALIZAÇÃO
============================================================ */
document.addEventListener('DOMContentLoaded', async () => {
  $('#ano-atual').textContent = new Date().getFullYear();
  Abas.init();
  Visitante.init();
  await Auth.init();
  await Agendamento.init();
  if (location.hash === '#meus') MeusAgendamentos.carregar();
});
