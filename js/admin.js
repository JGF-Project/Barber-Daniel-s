/* ============================================================
   BARBER DANIEL'S — PAINEL DO BARBEIRO (admin)
   ------------------------------------------------------------
   Agenda, serviços/preços e horários de funcionamento.
   O acesso é validado em duas camadas: aqui (papel = admin)
   e no banco (Row Level Security).
============================================================ */

'use strict';

const Estado = {
  sessao: null,
  ehAdmin: false,
};

/* ============================================================
   AUTENTICAÇÃO E CONTROLE DE ACESSO
============================================================ */
const AuthAdmin = {
  async init() {
    $('#form-entrar').addEventListener('submit', (e) => this.entrar(e));
    $('#botao-sair').addEventListener('click', () => sb.auth.signOut());
    $('#link-esqueci-senha').addEventListener('click', () => this.mostrarRecuperar());
    $('#link-voltar-entrar').addEventListener('click', () => this.mostrarLogin());
    $('#form-recuperar').addEventListener('submit', (e) => this.recuperarSenha(e));

    sb.auth.onAuthStateChange((_evento, sessao) => {
      Estado.sessao = sessao;
      this.avaliarAcesso();
    });

    const { data } = await sb.auth.getSession();
    Estado.sessao = data.session;
    await this.avaliarAcesso();
  },

  async entrar(evento) {
    evento.preventDefault();
    const botao = $('button[type="submit"]', evento.target);
    botao.classList.add('carregando');
    botao.disabled = true;
    $('#erro-auth').hidden = true;

    const { error } = await sb.auth.signInWithPassword({
      email: $('#entrar-email').value.trim(),
      password: $('#entrar-senha').value,
    });

    botao.classList.remove('carregando');
    botao.disabled = false;

    if (error) {
      $('#erro-auth').textContent = 'Email ou senha incorretos.';
      $('#erro-auth').hidden = false;
    }
  },

  mostrarLogin() {
    $('#form-entrar').hidden = false;
    $('#form-recuperar').hidden = true;
    $('#erro-auth').hidden = true;
    $('#info-auth').hidden = true;
  },

  mostrarRecuperar() {
    $('#form-entrar').hidden = true;
    $('#form-recuperar').hidden = false;
    $('#erro-auth').hidden = true;
    $('#info-auth').hidden = true;
  },

  async recuperarSenha(evento) {
    evento.preventDefault();
    const botao = $('button[type="submit"]', evento.target);
    botao.classList.add('carregando');
    botao.disabled = true;

    const { error } = await sb.auth.resetPasswordForEmail($('#recuperar-email').value.trim(), {
      redirectTo: `${window.location.origin}/redefinir-senha.html`,
    });

    botao.classList.remove('carregando');
    botao.disabled = false;

    // Mensagem genérica sempre — não revela se o email tem conta ou não
    const info = $('#info-auth');
    if (error && error.status !== 429) {
      $('#erro-auth').textContent = 'Não foi possível enviar o link agora. Tente novamente em instantes.';
      $('#erro-auth').hidden = false;
      return;
    }
    info.textContent = 'Se esse email tiver uma conta, enviamos um link para redefinir a senha.';
    info.hidden = false;
    evento.target.reset();
  },

  /** Decide qual tela mostrar: login, painel ou "sem acesso" */
  async avaliarAcesso() {
    const login = $('#area-auth');
    const painel = $('#painel-admin');
    const semAcesso = $('#sem-acesso');
    const usuario = $('#area-usuario');

    if (!Estado.sessao) {
      login.hidden = false;
      painel.hidden = true;
      semAcesso.hidden = true;
      usuario.hidden = true;
      return;
    }

    // Admin é por barbearia: a mesma conta pode administrar várias unidades.
    // Aqui só decidimos o que mostrar — quem garante de verdade é a RLS,
    // que usa essa mesma função nas policies.
    const [{ data: ehAdmin }, { data: perfil }] = await Promise.all([
      sb.rpc('sou_admin_de', { p_barbearia: BARBEARIA_ID }),
      sb.from('perfis').select('nome').eq('id', Estado.sessao.user.id).maybeSingle(),
    ]);

    Estado.ehAdmin = ehAdmin === true;
    usuario.hidden = false;
    $('#usuario-nome').textContent = perfil?.nome || Estado.sessao.user.email;
    login.hidden = true;

    if (Estado.ehAdmin) {
      painel.hidden = false;
      semAcesso.hidden = true;
      Agenda.carregar();
      Relatorios.carregar();
      Servicos.carregar();
      Assinantes.carregar();
      Barbeiros.carregar(); // popula barbeiros e, em seguida, o seletor + horários
    } else {
      painel.hidden = true;
      semAcesso.hidden = false;
    }
  },
};

/** Mensagem de feedback temporária do painel (tipo: 'info' | 'erro') */
function feedback(texto, tipo = 'info') {
  const el = $('#feedback-admin');
  el.textContent = texto;
  el.classList.toggle('app-erro', tipo === 'erro');
  el.classList.toggle('app-info', tipo !== 'erro');
  el.hidden = false;
  window.clearTimeout(feedback._timer);
  feedback._timer = window.setTimeout(() => (el.hidden = true), 4000);
}

/**
 * Modal de confirmação dentro do site (substitui window.confirm).
 * Retorna uma Promise que resolve true (confirmar) ou false (voltar/fechar).
 */
function confirmar({ titulo = 'Tem certeza?', texto = '', confirmarLabel = 'Confirmar' } = {}) {
  return new Promise((resolve) => {
    const modal = $('#modal-confirma');
    const btnOk = $('#modal-confirmar');
    const fechaveis = [...modal.querySelectorAll('[data-fechar-modal]')];

    $('#modal-titulo').textContent = titulo;
    $('#modal-texto').textContent = texto;
    btnOk.textContent = confirmarLabel;

    modal.hidden = false;
    $('#modal-titulo').focus(); // foco no diálogo (leitores de tela / Esc)

    const encerrar = (resultado) => {
      modal.hidden = true;
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

/**
 * Modal de edição de valor dentro do site (substitui window.prompt, que no
 * celular abre o pop-up feio do navegador). Recebe e devolve CENTAVOS, mas
 * mostra e lê reais — digitar "35,50" é o que o barbeiro espera.
 * Resolve null se ele voltar/fechar.
 */
function pedirValor(centavosAtuais) {
  return new Promise((resolve) => {
    const modal = $('#modal-valor');
    const form = $('#form-valor');
    const input = $('#modal-valor-input');
    const fechaveis = [...modal.querySelectorAll('[data-fechar-valor]')];

    input.value = (centavosAtuais / 100).toFixed(2).replace('.', ',');
    modal.hidden = false;
    input.focus();
    input.select();

    const encerrar = (resultado) => {
      modal.hidden = true;
      form.removeEventListener('submit', aoSalvar);
      fechaveis.forEach((el) => el.removeEventListener('click', aoVoltar));
      document.removeEventListener('keydown', aoTeclar);
      resolve(resultado);
    };
    const aoSalvar = (e) => {
      e.preventDefault();
      // Aceita "35", "35,50" e "35.50"; qualquer lixo vira 0 (= falta).
      const reais = parseFloat(input.value.replace(/\s/g, '').replace(',', '.'));
      encerrar(Number.isFinite(reais) && reais > 0 ? Math.round(reais * 100) : 0);
    };
    const aoVoltar = () => encerrar(null);
    const aoTeclar = (e) => { if (e.key === 'Escape') encerrar(null); };

    form.addEventListener('submit', aoSalvar);
    fechaveis.forEach((el) => el.addEventListener('click', aoVoltar));
    document.addEventListener('keydown', aoTeclar);
  });
}

/* ============================================================
   AGENDA
============================================================ */
const Agenda = {
  barbeiros: [],
  dia: null, // "yyyy-mm-dd" no fuso da barbearia
  LIVRE_MINIMO_MS: 5 * 60000, // gaps menores que isso são só folga de arredondamento, não "horário livre"

  init() {
    this.dia = partesNoFuso(new Date()).ymd;
    $('#agenda-barbeiro')?.addEventListener('change', () => this.carregar());
    // Delegado: os dias e as setas de semana são recriados a cada render de montarFaixaSemana()
    $('#agenda-semana')?.addEventListener('click', (e) => {
      const semana = e.target.closest('[data-semana]');
      if (semana) return this.mudarSemana(parseInt(semana.dataset.semana, 10));
      if (e.target.closest('.agenda-semana__hoje')) return this.irParaHoje();
      const dia = e.target.closest('[data-dia]');
      if (dia) { this.dia = dia.dataset.dia; this.carregar(); }
    });
    $('#limpar-finalizados')?.addEventListener('click', () => this.limparFinalizados());
    $('#agenda-sair')?.addEventListener('click', () => sb.auth.signOut());
  },

  /** Preenche o seletor de barbeiros; chamado por Barbeiros.carregar() */
  popularSeletor(barbeiros) {
    this.barbeiros = barbeiros || [];
    const seletor = $('#agenda-barbeiro');
    if (!seletor) return;
    const anterior = seletor.value;

    if (!this.barbeiros.length) {
      seletor.innerHTML = '';
      $('#agenda-resumo').innerHTML = '';
      $('#lista-agenda').innerHTML = '<p class="app-aviso-passo">Cadastre um barbeiro na aba Barbeiros para ver a agenda.</p>';
      return;
    }

    seletor.innerHTML = this.barbeiros.map((b) => `<option value="${b.id}">${escaparHtml(b.nome)}</option>`).join('');
    if (anterior && this.barbeiros.some((b) => b.id === anterior)) seletor.value = anterior;
    this.carregar();
  },

  mudarSemana(delta) {
    const d = new Date(`${this.dia}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + delta * 7);
    this.dia = d.toISOString().slice(0, 10);
    this.carregar();
  },

  irParaHoje() {
    this.dia = partesNoFuso(new Date()).ymd;
    this.carregar();
  },

  /** Domingo (yyyy-mm-dd) da semana que contém o dia informado */
  domingoDaSemana(ymd) {
    const d = new Date(`${ymd}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return d.toISOString().slice(0, 10);
  },

  /** Cabeçalho com o intervalo da semana (calendário + setas) e a faixa de 7 dias clicáveis */
  montarFaixaSemana() {
    const area = $('#agenda-semana');
    if (!area) return;
    const domingo = this.domingoDaSemana(this.dia);
    const dias = [...Array(7)].map((_, i) => {
      const d = new Date(`${domingo}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      return d.toISOString().slice(0, 10);
    });
    const rotulo = (ymd) => {
      const d = new Date(`${ymd}T12:00:00Z`);
      return `${d.getUTCDate()} ${MESES_CURTOS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    };

    area.innerHTML = `
      <div class="agenda-semana__cabecalho">
        <button class="agenda-semana__hoje" type="button" title="Ir para hoje" aria-label="Ir para hoje">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>
        </button>
        <span class="agenda-semana__intervalo">${rotulo(dias[0])} à ${rotulo(dias[6])}</span>
        <button class="agenda-nav__seta" type="button" data-semana="-1" aria-label="Semana anterior">‹</button>
        <button class="agenda-nav__seta" type="button" data-semana="1" aria-label="Próxima semana">›</button>
      </div>
      <div class="agenda-semana__dias">
        ${dias.map((ymd) => {
          const d = new Date(`${ymd}T12:00:00Z`);
          const ativo = ymd === this.dia;
          const temAgendamento = this._diasComAgendamento?.has(ymd);
          return `<button class="agenda-semana__dia${ativo ? ' agenda-semana__dia--ativo' : ''}" type="button" data-dia="${ymd}">
            <span class="agenda-semana__abrev">${DIAS_CURTOS[d.getUTCDay()].toUpperCase()}</span>
            <span class="agenda-semana__numero">${d.getUTCDate()}</span>
            <span class="agenda-semana__ponto"${temAgendamento ? '' : ' hidden'}></span>
          </button>`;
        }).join('')}
      </div>`;
  },

  /** Quais dias da semana em exibição têm agendamento — só para os pontinhos da faixa. Cacheado por barbeiro+semana. */
  async atualizarPontosSemana(barbeiroId, domingo) {
    const chave = `${barbeiroId}:${domingo}`;
    if (this._semanaPontosCarregada === chave) return;
    const inicio = new Date(`${domingo}T00:00:00${OFFSET}`);
    const fim = new Date(inicio.getTime() + 7 * 86400000);
    const { data, error } = await sb.from('agendamentos')
      .select('inicio')
      .eq('barbearia_id', BARBEARIA_ID)
      .eq('barbeiro_id', barbeiroId)
      .neq('status', 'cancelado')
      .gte('inicio', inicio.toISOString())
      .lt('inicio', fim.toISOString());
    // a tela pode ter mudado de semana/barbeiro enquanto isto rodava — só aplica se ainda é o que está em exibição
    if (error || this.domingoDaSemana(this.dia) !== domingo || $('#agenda-barbeiro')?.value !== barbeiroId) return;
    this._semanaPontosCarregada = chave;
    this._diasComAgendamento = new Set(data.map((a) => partesNoFuso(new Date(a.inicio)).ymd));
    this.montarFaixaSemana();
  },

  async carregar() {
    const barbeiroId = $('#agenda-barbeiro')?.value;
    const area = $('#lista-agenda');
    if (!barbeiroId) return; // popularSeletor já mostrou o aviso de "sem barbeiro"

    this.montarFaixaSemana();
    this.atualizarPontosSemana(barbeiroId, this.domingoDaSemana(this.dia)); // roda em paralelo, redesenha a faixa quando os pontinhos chegarem
    area.innerHTML = '<p class="app-carregando">Carregando agenda…</p>';
    this.carregarResumo(barbeiroId);

    const diaSemana = new Date(`${this.dia}T12:00:00Z`).getUTCDay();
    const inicioDia = new Date(`${this.dia}T00:00:00${OFFSET}`);
    const fimDia = new Date(inicioDia.getTime() + 86400000);

    const [agendamentosRes, horarioRes] = await Promise.all([
      sb.from('agendamentos')
        .select('id, inicio, fim, status, via_assinatura, valor_centavos, cliente_nome, cliente_celular, agendamento_servicos(servicos(nome, preco_centavos)), perfis(nome, celular)')
        .eq('barbearia_id', BARBEARIA_ID)
        .eq('barbeiro_id', barbeiroId)
        .neq('status', 'cancelado') // cancelado libera o horário: some do dia, o intervalo aparece como livre
        .gte('inicio', inicioDia.toISOString())
        .lt('inicio', fimDia.toISOString())
        .order('inicio', { ascending: true }),
      sb.from('horarios_funcionamento').select('*').eq('barbeiro_id', barbeiroId).eq('dia_semana', diaSemana).maybeSingle(),
    ]);

    if (agendamentosRes.error || horarioRes.error) {
      area.innerHTML = '<p class="app-erro">Erro ao carregar a agenda.</p>';
      return;
    }

    area.innerHTML = this.montarLinhaDoTempo(agendamentosRes.data, horarioRes.data);
    this.ligarAcoes(area);
  },

  /** Cartões "Hoje" e "Esta semana" (mesma semana, seg. a partir do domingo). Uma consulta só. */
  async carregarResumo(barbeiroId) {
    const area = $('#agenda-resumo');
    const hojeYmd = partesNoFuso(new Date()).ymd;
    const inicioHoje = new Date(`${hojeYmd}T00:00:00${OFFSET}`);
    const fimHoje = new Date(inicioHoje.getTime() + 86400000);
    const inicioSemana = new Date(`${this.domingoDaSemana(hojeYmd)}T00:00:00${OFFSET}`);
    const fimSemana = new Date(inicioSemana.getTime() + 7 * 86400000);

    const { data, error } = await sb.from('agendamentos')
      .select('inicio, via_assinatura, valor_centavos, agendamento_servicos(servicos(preco_centavos))')
      .eq('barbearia_id', BARBEARIA_ID)
      .eq('barbeiro_id', barbeiroId)
      .neq('status', 'cancelado')
      .gte('inicio', inicioSemana.toISOString())
      .lt('inicio', fimSemana.toISOString());

    if (error) { area.innerHTML = ''; return; }

    const daHoje = data.filter((a) => {
      const t = new Date(a.inicio);
      return t >= inicioHoje && t < fimHoje;
    });
    const somar = (lista) => lista.reduce((s, a) => s + valorCobrado(a), 0);

    area.innerHTML = `
      <div class="agenda-resumo__cartao agenda-resumo__cartao--destaque">
        <span class="agenda-resumo__rotulo">Hoje</span>
        <span class="agenda-resumo__valor">${formatarPreco(somar(daHoje))}</span>
        <span class="agenda-resumo__numero">${daHoje.length}</span>
      </div>
      <div class="agenda-resumo__cartao">
        <span class="agenda-resumo__rotulo">Esta semana</span>
        <span class="agenda-resumo__valor">${formatarPreco(somar(data))}</span>
        <span class="agenda-resumo__numero">${data.length}</span>
      </div>`;
  },

  /** Monta a coluna: uma linha de hora cheia para cada hora do expediente (10:00, 11:00, 12:00…),
   * igual ao app de referência do Daniel — não só nas horas em que algo começa. Atendimento ou
   * "livre" à direita, agrupados na hora em que começam; hora sem nada começando nela fica em branco. */
  montarLinhaDoTempo(agendamentos, horario) {
    if (!horario || horario.fechado || !horario.abre || !horario.fecha) {
      return '<p class="app-aviso-passo">O barbeiro não atende neste dia.</p>';
    }

    const abre = new Date(`${this.dia}T${horario.abre}${OFFSET}`).getTime();
    const fecha = new Date(`${this.dia}T${horario.fecha}${OFFSET}`).getTime();

    // Preenche os vãos entre atendimentos (e antes/depois deles) com blocos "livre"
    const eventos = [];
    let cursor = abre;
    for (const a of agendamentos) {
      const inicio = new Date(a.inicio).getTime();
      const fim = new Date(a.fim).getTime();
      if (inicio > cursor + this.LIVRE_MINIMO_MS) eventos.push({ livre: true, inicio: cursor, fim: inicio });
      eventos.push({ livre: false, agendamento: a, inicio, fim });
      cursor = Math.max(cursor, fim);
    }
    if (fecha > cursor + this.LIVRE_MINIMO_MS) eventos.push({ livre: true, inicio: cursor, fim: fecha });

    if (!eventos.length) {
      return '<p class="app-aviso-passo">Nenhum horário de expediente neste dia.</p>';
    }

    // Fuso da barbearia é fixo (-03:00, Brasil não tem mais horário de verão — ver supabase.js),
    // então "hora cheia local" dá pra calcular só deslocando o epoch, sem Intl por linha.
    const TRES_HORAS_MS = 3 * 3600000;
    const horaCheiaLocal = (ms) => Math.floor((ms - TRES_HORAS_MS) / 3600000);
    const horaParaMs = (h) => h * 3600000 + TRES_HORAS_MS;

    const primeiraHora = horaCheiaLocal(abre);
    const ultimaHora = horaCheiaLocal(fecha - 1); // fecha é exclusivo: -1ms evita uma hora vazia extra quando fecha cai certinho na hora cheia
    const linhas = [];
    for (let h = primeiraHora; h <= ultimaHora; h++) {
      const doHora = eventos.filter((ev) => horaCheiaLocal(ev.inicio) === h);
      const rotulo = formatarHora(new Date(horaParaMs(h)).toISOString());
      if (!doHora.length) {
        linhas.push(`<span class="linha-tempo__hora">${rotulo}</span><span class="linha-tempo__vazio"></span>`);
        continue;
      }
      doHora.forEach((ev, i) => {
        const bloco = ev.livre ? this.blocoLivre(ev) : this.blocoAgendamento(ev.agendamento);
        linhas.push(`<span class="linha-tempo__hora">${i === 0 ? rotulo : ''}</span>${bloco}`);
      });
    }

    return `<div class="linha-tempo">${linhas.join('')}</div>`;
  },

  blocoLivre(ev) {
    const inicio = formatarHora(new Date(ev.inicio).toISOString());
    const fim = formatarHora(new Date(ev.fim).toISOString());
    return `<div class="bloco-livre">${inicio} – ${fim} <strong>Disponível</strong></div>`;
  },

  blocoAgendamento(a) {
    const podeAgir = a.status === 'confirmado';
    // Assinatura fica fora do apagar: remover a linha devolveria a cota do mês.
    const podeApagar = (a.status === 'cancelado' || a.status === 'concluido') && !a.via_assinatura;
    const serv = servicosResumo(a);
    // Visitante não tem perfil — nome e telefone vêm da própria linha.
    const cliente = a.perfis?.nome || a.cliente_nome || 'Cliente';
    const celular = a.perfis?.celular || a.cliente_celular || 'sem celular';
    const semConta = !a.perfis && a.cliente_nome ? ' · <em>sem cadastro</em>' : '';
    // Valor cobrado de fato: o que o barbeiro editou, ou a soma dos serviços.
    const centavos = valorCobrado(a);
    const editado = a.valor_centavos !== null && a.valor_centavos !== undefined;
    const blocoValor = a.via_assinatura
      ? '<span class="valor-display">incluso no plano</span>'
      : `<span class="valor-editar" data-centavos="${centavos}">
           <span class="valor-display">${formatarPreco(centavos)}</span>
           ${editado ? '<span class="valor-marca" title="Valor editado pelo barbeiro">editado</span>' : ''}
           <button class="valor-btn" type="button" title="Editar valor ou marcar como falta" aria-label="Editar valor">✏</button>
         </span>`;

    return `
    <article class="bloco-agendamento vidro" data-id="${a.id}" data-valor="${centavos}" data-via-assinatura="${a.via_assinatura}">
      <div class="bloco-agendamento__topo">
        <span class="bloco-agendamento__hora">${formatarHora(a.inicio)} – ${formatarHora(a.fim)}</span>
        <span class="etiqueta-status etiqueta-status--${a.status}">${ROTULO_STATUS[a.status] || a.status}</span>
      </div>
      <div class="bloco-agendamento__corpo">
        <strong>${a.via_assinatura ? '<span class="cartao-agendamento__coroa" title="Pelo plano mensal">♛</span> ' : ''}${escaparHtml(cliente)}</strong>
        <span>${escaparHtml(serv.nomes)} · ${escaparHtml(celular)}${semConta}</span>
      </div>
      <div class="bloco-agendamento__rodape">
        ${blocoValor}
        <div class="cartao-agendamento__acoes">
          ${podeAgir ? `<button class="botao botao--fantasma botao--pequeno acao-cancelar" type="button">Cancelar</button>` : ''}
          ${podeApagar ? `<button class="acao-apagar" type="button" aria-label="Apagar agendamento" title="Apagar do histórico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6"/><path d="M10 11v6M14 11v6"/></svg></button>` : ''}
        </div>
      </div>
    </article>`;
  },

  /** Liga os cliques dos blocos recém-renderizados: editar valor, cancelar, apagar */
  ligarAcoes(area) {
    // Editar valor: clica no ícone ✏ e edita no modal do site
    $$('.valor-btn', area).forEach((b) => {
      b.addEventListener('click', async () => {
        const span = b.closest('.valor-editar');
        const cartao = b.closest('.bloco-agendamento');
        const centavos = await pedirValor(parseInt(span.dataset.centavos));
        if (centavos === null) return; // voltou/fechou

        // Zerar o valor é como o barbeiro marca falta: some do faturamento.
        const status = centavos === 0 ? 'falta' : 'confirmado';
        const { error } = await sb
          .from('agendamentos')
          .update({ valor_centavos: centavos, status })
          .eq('id', cartao.dataset.id);
        if (error) return feedback('Não foi possível salvar o valor. Tente novamente.', 'erro');

        feedback(centavos === 0
          ? 'Marcado como falta — fora do faturamento.'
          : `Valor atualizado para ${formatarPreco(centavos)}.`);
        this.carregar();
        Relatorios.carregar(); // faturamento acompanha o valor editado
      });
    });

    // Ações de cancelar
    const mudarStatus = async (cartao, status) => {
      const { error: erro } = await sb
        .from('agendamentos')
        .update({ status })
        .eq('id', cartao.dataset.id);
      if (erro) return feedback('Não foi possível atualizar. Tente novamente.', 'erro');
      feedback({
        cancelado: 'Agendamento cancelado.',
        falta: 'Marcado como falta.',
      }[status]);
      this.carregar();
    };
    $$('.acao-cancelar', area).forEach((b) =>
      b.addEventListener('click', async () => {
        const ok = await confirmar({
          titulo: 'Cancelar agendamento?',
          texto: 'O horário do cliente será liberado. Esta ação não pode ser desfeita.',
          confirmarLabel: 'Sim, cancelar',
        });
        if (ok) mudarStatus(b.closest('.bloco-agendamento'), 'cancelado');
      }));

    // Apagar um agendamento finalizado (cancelado/concluído)
    $$('.acao-apagar', area).forEach((b) =>
      b.addEventListener('click', async () => {
        const ok = await confirmar({
          titulo: 'Apagar agendamento?',
          texto: 'O registro será removido do histórico permanentemente.',
          confirmarLabel: 'Sim, apagar',
        });
        if (!ok) return;
        const { error: erro } = await sb
          .from('agendamentos')
          .delete()
          .eq('id', b.closest('.bloco-agendamento').dataset.id);
        if (erro) return feedback('Não foi possível apagar. Tente novamente.', 'erro');
        feedback('Agendamento apagado.');
        this.carregar();
      }));
  },

  /** Apaga de uma vez todos os agendamentos cancelados/concluídos */
  async limparFinalizados() {
    const ok = await confirmar({
      titulo: 'Limpar finalizados?',
      texto: 'Todos os agendamentos cancelados e concluídos serão apagados permanentemente.',
      confirmarLabel: 'Sim, apagar todos',
    });
    if (!ok) return;
    // 'falta' de fora de propósito: apagar devolveria a cota da assinatura,
    // e é justamente a falta que o regulamento manda cobrar.
    const { data, error } = await sb
      .from('agendamentos')
      .delete()
      .eq('barbearia_id', BARBEARIA_ID)
      .eq('via_assinatura', false)
      .in('status', ['cancelado', 'concluido'])
      .select('id');
    if (error) return feedback('Não foi possível limpar. Tente novamente.', 'erro');
    feedback(data?.length ? `${data.length} agendamento(s) apagado(s).` : 'Nada para apagar.');
    this.carregar();
  },
};

/* ============================================================
   SERVIÇOS E PREÇOS
============================================================ */
const Servicos = {
  init() {
    $('#form-novo-servico').addEventListener('submit', (e) => this.adicionar(e));
  },

  async carregar() {
    const area = $('#lista-servicos-admin');
    // Planos ficam fora daqui: neles "Preço (R$)" é o valor por atendimento,
    // não a mensalidade, e editar isso no formulário genérico confunde.
    // Eles são gerenciados na aba Assinantes.
    const { data, error } = await sb
      .from('servicos')
      .select('*')
      .eq('barbearia_id', BARBEARIA_ID)
      .eq('assinatura', false)
      .order('criado_em');

    if (error) {
      area.innerHTML = '<p class="app-erro">Erro ao carregar serviços.</p>';
      return;
    }

    area.innerHTML = data
      .map(
        (s) => `
      <form class="linha-servico vidro ${s.ativo ? '' : 'linha-servico--inativo'}" data-id="${s.id}">
        <div class="formulario__campo">
          <label>Nome
            <input type="text" name="nome" value="${escaparHtml(s.nome)}" required>
          </label>
        </div>
        <div class="formulario__campo">
          <label>Descrição
            <input type="text" name="descricao" value="${escaparHtml(s.descricao || '')}">
          </label>
        </div>
        <div class="linha-servico__numeros">
          <div class="formulario__campo">
            <label>Preço (R$)
              <input type="number" name="preco" min="0" step="0.01" value="${(s.preco_centavos / 100).toFixed(2)}" required>
            </label>
          </div>
          <div class="formulario__campo">
            <label>Duração (min)
              <input type="number" name="duracao" min="10" max="240" step="5" value="${s.duracao_min}" required>
            </label>
          </div>
        </div>
        <div class="linha-servico__acoes">
          <label class="alternador">
            <input type="checkbox" name="ativo" ${s.ativo ? 'checked' : ''}>
            <span>Ativo</span>
          </label>
          <button class="botao botao--primario botao--pequeno" type="submit">Salvar</button>
          <button class="acao-apagar acao-remover-servico" type="button" aria-label="Remover serviço" title="Remover serviço"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6"/><path d="M10 11v6M14 11v6"/></svg></button>
        </div>
      </form>`
      )
      .join('');

    $$('.linha-servico', area).forEach((form) => {
      form.addEventListener('submit', (e) => this.salvar(e, form));
    });
    $$('.acao-remover-servico', area).forEach((botao) =>
      botao.addEventListener('click', () => this.remover(botao.closest('.linha-servico'))));
  },

  async salvar(evento, form) {
    evento.preventDefault();
    const { error } = await sb
      .from('servicos')
      .update({
        nome: form.nome.value.trim(),
        descricao: form.descricao.value.trim(),
        preco_centavos: Math.round(parseFloat(form.preco.value) * 100),
        duracao_min: parseInt(form.duracao.value, 10),
        ativo: form.ativo.checked,
      })
      .eq('id', form.dataset.id);

    if (error) return feedback('Não foi possível salvar. Confira os valores.', 'erro');
    feedback('Serviço atualizado.');
    this.carregar();
  },

  async adicionar(evento) {
    evento.preventDefault();
    const { error } = await sb.from('servicos').insert({
      nome: $('#novo-nome').value.trim(),
      descricao: $('#novo-descricao').value.trim(),
      preco_centavos: Math.round(parseFloat($('#novo-preco').value) * 100),
      duracao_min: parseInt($('#novo-duracao').value, 10),
      barbearia_id: BARBEARIA_ID,
    });

    if (error) return feedback('Não foi possível adicionar. Confira os valores.', 'erro');
    evento.target.reset();
    feedback('Serviço adicionado.');
    this.carregar();
  },

  async remover(linha) {
    const nome = linha.nome.value.trim() || 'este serviço';
    const ok = await confirmar({
      titulo: 'Remover serviço?',
      texto: `${nome} será removido. Serviços com agendamentos não podem ser removidos — desative-o em vez de remover, se preferir mantê-lo no histórico.`,
      confirmarLabel: 'Sim, remover',
    });
    if (!ok) return;

    const { error } = await sb.from('servicos').delete().eq('id', linha.dataset.id);
    if (error) {
      // 23503 = chave estrangeira: existem agendamentos com este serviço
      const temAgenda = error.code === '23503';
      return feedback(
        temAgenda
          ? 'Este serviço tem agendamentos vinculados. Desative-o em vez de remover.'
          : 'Não foi possível remover o serviço.',
        'erro'
      );
    }
    feedback('Serviço removido.');
    this.carregar();
  },
};

/* ============================================================
   ASSINANTES (planos mensais)
   ------------------------------------------------------------
   O vínculo é por e-mail, não por conta: o barbeiro cadastra antes
   mesmo de a pessoa ter conta. Quem faz a ligação e-mail -> conta é
   assinantes_admin(), porque `perfis` não guarda e-mail.
============================================================ */
const Assinantes = {
  planos: [],

  init() {
    $('#form-novo-assinante').addEventListener('submit', (e) => this.adicionar(e));
  },

  async carregar() {
    const area = $('#lista-assinantes');

    const [planos, assinantes] = await Promise.all([
      sb.from('servicos').select('id, nome, descricao, preco_centavos')
        .eq('barbearia_id', BARBEARIA_ID).eq('assinatura', true).eq('ativo', true).order('preco_centavos'),
      sb.rpc('assinantes_admin', { p_barbearia: BARBEARIA_ID }),
    ]);

    if (planos.error || assinantes.error) {
      area.innerHTML = '<p class="app-erro">Erro ao carregar os assinantes.</p>';
      return;
    }

    this.planos = planos.data || [];
    $('#assinante-plano').innerHTML = this.planos
      .map((p) => `<option value="${p.id}">${escaparHtml(p.nome)}</option>`)
      .join('');

    const lista = assinantes.data || [];
    if (!lista.length) {
      area.innerHTML = '<p class="app-aviso-passo">Nenhum assinante cadastrado ainda.</p>';
      return;
    }

    area.innerHTML = lista
      .map((a) => {
        const restantes = Math.max(0, 4 - a.usados_mes);
        return `
        <article class="cartao-agendamento vidro" data-id="${a.id}">
          <div class="cartao-agendamento__info">
            <strong>${escaparHtml(a.nome || a.email)}</strong>
            <span>${escaparHtml(a.plano)} · ${escaparHtml(a.email)}</span>
            <small class="cartao-agendamento__nota">
              ${a.tem_conta
                ? `Usou ${a.usados_mes} de 4 este mês · restam ${restantes}`
                : 'Ainda não criou a conta — o plano vale assim que ela entrar com esse e-mail.'}
            </small>
          </div>
          <div class="cartao-agendamento__acoes">
            <span class="etiqueta-status ${a.tem_conta ? 'etiqueta-status--concluido' : 'etiqueta-status--cancelado'}">
              ${a.tem_conta ? 'Ativo' : 'Sem conta'}
            </span>
            <button class="botao botao--perigo botao--pequeno acao-remover-assinante" type="button">Remover</button>
          </div>
        </article>`;
      })
      .join('');

    $$('.acao-remover-assinante', area).forEach((botao) =>
      botao.addEventListener('click', () => this.remover(botao.closest('[data-id]'))));
  },

  async adicionar(evento) {
    evento.preventDefault();
    const email = $('#assinante-email').value.trim().toLowerCase();
    const servicoId = $('#assinante-plano').value;

    if (!email || !servicoId) return feedback('Informe o e-mail e escolha o plano.', 'erro');

    const { error } = await sb.from('assinaturas').insert({
      email,
      servico_id: servicoId,
      barbearia_id: BARBEARIA_ID,
    });

    if (error) {
      // 23505 = já existe assinatura para esse e-mail nesta barbearia
      return feedback(
        error.code === '23505'
          ? 'Esse e-mail já é assinante. Remova antes para trocar de plano.'
          : 'Não foi possível adicionar. Tente novamente.',
        'erro'
      );
    }
    feedback('Assinante adicionado.');
    evento.target.reset();
    this.carregar();
  },

  async remover(cartao) {
    const ok = await confirmar({
      titulo: 'Remover assinante?',
      texto: 'Ele perde o acesso ao plano na próxima vez que abrir o site. Os agendamentos já feitos continuam na agenda.',
      confirmarLabel: 'Sim, remover',
    });
    if (!ok) return;

    const { error } = await sb.from('assinaturas').delete().eq('id', cartao.dataset.id);
    if (error) return feedback('Não foi possível remover. Tente novamente.', 'erro');
    feedback('Assinante removido.');
    this.carregar();
  },
};

/* ============================================================
   BARBEIROS (equipe)
============================================================ */
const Barbeiros = {
  init() {
    $('#form-novo-barbeiro').addEventListener('submit', (e) => this.adicionar(e));
  },

  async carregar() {
    const area = $('#lista-barbeiros-admin');
    const { data, error } = await sb
      .from('barbeiros')
      .select('*')
      .eq('barbearia_id', BARBEARIA_ID)
      .order('criado_em');

    if (error) {
      area.innerHTML = '<p class="app-erro">Erro ao carregar barbeiros.</p>';
      return;
    }

    if (!data.length) {
      area.innerHTML = '<p class="app-aviso-passo">Nenhum barbeiro cadastrado. Adicione o primeiro abaixo.</p>';
    } else {
      area.innerHTML = data
        .map(
          (b) => `
        <form class="linha-servico vidro" data-id="${b.id}">
          <div class="formulario__campo">
            <label>Nome do barbeiro
              <input type="text" name="nome" value="${escaparHtml(b.nome)}" maxlength="80" required>
            </label>
          </div>
          <div class="linha-servico__acoes">
            <button class="botao botao--primario botao--pequeno" type="submit">Salvar</button>
            <button class="botao botao--perigo botao--pequeno acao-remover-barbeiro" type="button">Remover</button>
          </div>
        </form>`
        )
        .join('');

      $$('form.linha-servico', area).forEach((form) =>
        form.addEventListener('submit', (e) => this.salvar(e, form)));
      $$('.acao-remover-barbeiro', area).forEach((botao) =>
        botao.addEventListener('click', () => this.remover(botao.closest('[data-id]'))));
    }

    // Os seletores das abas Agenda, Horários, Relatórios e Ausências refletem a lista atual
    Agenda.popularSeletor(data);
    Horarios.popularSeletor(data);
    Relatorios.popularSeletor(data);
    Ausencias.popularSeletor(data);
  },

  async adicionar(evento) {
    evento.preventDefault();
    const nome = $('#novo-barbeiro-nome').value.trim();
    if (nome.length < 2) return feedback('Informe o nome do barbeiro.', 'erro');

    const { error } = await sb.from('barbeiros').insert({ nome, barbearia_id: BARBEARIA_ID });
    if (error) return feedback('Não foi possível adicionar o barbeiro.', 'erro');

    evento.target.reset();
    feedback('Barbeiro adicionado. Configure os horários dele na aba Horários.');
    this.carregar();
  },

  async salvar(evento, form) {
    evento.preventDefault();
    const nome = form.nome.value.trim();
    if (nome.length < 2) return feedback('Informe o nome do barbeiro.', 'erro');

    const { error } = await sb.from('barbeiros').update({ nome }).eq('id', form.dataset.id);
    if (error) return feedback('Não foi possível salvar o nome.', 'erro');

    feedback('Nome do barbeiro atualizado.');
    this.carregar();
  },

  async remover(linha) {
    const nome = $('input[name="nome"]', linha)?.value.trim() || 'este barbeiro';
    const ok = await confirmar({
      titulo: 'Remover barbeiro?',
      texto: `${nome} e os horários dele serão removidos. Barbeiros com agendamentos não podem ser removidos.`,
      confirmarLabel: 'Sim, remover',
    });
    if (!ok) return;

    const { error } = await sb.from('barbeiros').delete().eq('id', linha.dataset.id);
    if (error) {
      // 23503 = chave estrangeira: existem agendamentos deste barbeiro
      const temAgenda = error.code === '23503';
      return feedback(
        temAgenda
          ? 'Este barbeiro tem agendamentos. Conclua ou apague os agendamentos dele antes de remover.'
          : 'Não foi possível remover o barbeiro.',
        'erro'
      );
    }
    feedback('Barbeiro removido.');
    this.carregar();
  },
};

/* ============================================================
   HORÁRIOS DE FUNCIONAMENTO (por barbeiro)
============================================================ */
const Horarios = {
  init() {
    $('#form-horarios').addEventListener('submit', (e) => this.salvar(e));
    $('#horarios-barbeiro').addEventListener('change', () => this.carregar());
    $('#limpar-almoco').addEventListener('click', () => {
      $('#almoco-inicio').value = '';
      $('#almoco-fim').value = '';
    });
  },

  /** Preenche o seletor de barbeiros; chamado por Barbeiros.carregar() */
  popularSeletor(barbeiros) {
    this.barbeiros = barbeiros || []; // guarda p/ ler o almoço do barbeiro escolhido
    const seletor = $('#horarios-barbeiro');
    const anterior = seletor.value;

    if (!barbeiros || !barbeiros.length) {
      seletor.innerHTML = '';
      $('#lista-horarios-admin').innerHTML = '<p class="app-aviso-passo">Cadastre um barbeiro na aba Barbeiros para definir horários.</p>';
      return;
    }

    seletor.innerHTML = barbeiros
      .map((b) => `<option value="${b.id}">${escaparHtml(b.nome)}</option>`)
      .join('');
    // Mantém a seleção anterior se o barbeiro ainda existir
    if (anterior && barbeiros.some((b) => b.id === anterior)) seletor.value = anterior;
    this.carregar();
  },

  async carregar() {
    const area = $('#lista-horarios-admin');
    const barbeiroId = $('#horarios-barbeiro').value;
    if (!barbeiroId) {
      area.innerHTML = '<p class="app-aviso-passo">Cadastre um barbeiro na aba Barbeiros para definir horários.</p>';
      return;
    }

    // almoço do barbeiro escolhido (vem do select('*') de Barbeiros.carregar)
    const barb = (this.barbeiros || []).find((b) => b.id === barbeiroId);
    $('#almoco-inicio').value = barb?.almoco_inicio ? barb.almoco_inicio.slice(0, 5) : '';
    $('#almoco-fim').value = barb?.almoco_fim ? barb.almoco_fim.slice(0, 5) : '';

    const { data, error } = await sb
      .from('horarios_funcionamento')
      .select('*')
      .eq('barbeiro_id', barbeiroId)
      .order('dia_semana');

    if (error) {
      area.innerHTML = '<p class="app-erro">Erro ao carregar horários.</p>';
      return;
    }

    area.innerHTML = data
      .map(
        (h) => `
      <div class="linha-horario vidro" data-dia="${h.dia_semana}">
        <span class="linha-horario__dia">${DIAS_SEMANA[h.dia_semana]}</span>
        <label class="alternador">
          <input type="checkbox" class="campo-fechado" ${h.fechado ? 'checked' : ''}>
          <span>Fechado</span>
        </label>
        <label class="linha-horario__hora">Abre
          <input type="time" class="campo-abre" value="${h.abre ? h.abre.slice(0, 5) : '09:00'}" ${h.fechado ? 'disabled' : ''}>
        </label>
        <label class="linha-horario__hora">Fecha
          <input type="time" class="campo-fecha" value="${h.fecha ? h.fecha.slice(0, 5) : '20:00'}" ${h.fechado ? 'disabled' : ''}>
        </label>
      </div>`
      )
      .join('');

    // "Fechado" desabilita os campos de hora do dia
    $$('.linha-horario', area).forEach((linha) => {
      $('.campo-fechado', linha).addEventListener('change', (e) => {
        $('.campo-abre', linha).disabled = e.target.checked;
        $('.campo-fecha', linha).disabled = e.target.checked;
      });
    });
  },

  async salvar(evento) {
    evento.preventDefault();
    const barbeiroId = $('#horarios-barbeiro').value;
    if (!barbeiroId) return feedback('Selecione um barbeiro.', 'erro');

    const botao = $('#botao-salvar-horarios');
    botao.classList.add('carregando');
    botao.disabled = true;

    let houveErro = false;

    for (const linha of $$('#lista-horarios-admin .linha-horario')) {
      const fechado = $('.campo-fechado', linha).checked;
      const abre = $('.campo-abre', linha).value;
      const fecha = $('.campo-fecha', linha).value;

      if (!fechado && (!abre || !fecha || abre >= fecha)) {
        feedback(`Horário inválido em ${DIAS_SEMANA[linha.dataset.dia]}: abertura deve ser antes do fechamento.`, 'erro');
        houveErro = true;
        break;
      }

      const { error } = await sb
        .from('horarios_funcionamento')
        .update({
          fechado,
          abre: fechado ? null : abre,
          fecha: fechado ? null : fecha,
        })
        .eq('barbeiro_id', barbeiroId)
        .eq('dia_semana', Number(linha.dataset.dia));

      if (error) {
        feedback(`Erro ao salvar ${DIAS_SEMANA[linha.dataset.dia]}.`, 'erro');
        houveErro = true;
        break;
      }
    }

    // Almoço (opcional): precisa de início E fim, com início antes do fim
    if (!houveErro) {
      const almIni = $('#almoco-inicio').value;
      const almFim = $('#almoco-fim').value;
      if ((almIni && !almFim) || (!almIni && almFim) || (almIni && almFim && almIni >= almFim)) {
        feedback('Almoço inválido: preencha início e fim, com o início antes do fim (ou deixe ambos vazios).', 'erro');
        houveErro = true;
      } else {
        const { error: eAlm } = await sb.from('barbeiros')
          .update({ almoco_inicio: almIni || null, almoco_fim: almFim || null })
          .eq('id', barbeiroId);
        if (eAlm) { feedback('Erro ao salvar o almoço.', 'erro'); houveErro = true; }
        else {
          const b = (this.barbeiros || []).find((x) => x.id === barbeiroId);
          if (b) { b.almoco_inicio = almIni || null; b.almoco_fim = almFim || null; }
        }
      }
    }

    botao.classList.remove('carregando');
    botao.disabled = false;
    if (!houveErro) feedback('Horários e almoço salvos com sucesso.');
  },
};

/* ============================================================
   AUSÊNCIAS / FÉRIAS / BLOQUEIOS (por barbeiro)
============================================================ */
const Ausencias = {
  init() {
    $('#form-nova-ausencia').addEventListener('submit', (e) => this.adicionar(e));
    $('#ausencias-barbeiro').addEventListener('change', () => this.carregar());
  },

  popularSeletor(barbeiros) {
    const seletor = $('#ausencias-barbeiro');
    const anterior = seletor.value;
    if (!barbeiros || !barbeiros.length) {
      seletor.innerHTML = '';
      $('#lista-ausencias').innerHTML = '<p class="app-aviso-passo">Cadastre um barbeiro na aba Barbeiros primeiro.</p>';
      return;
    }
    seletor.innerHTML = barbeiros.map((b) => `<option value="${b.id}">${escaparHtml(b.nome)}</option>`).join('');
    if (anterior && barbeiros.some((b) => b.id === anterior)) seletor.value = anterior;
    this.carregar();
  },

  async carregar() {
    const area = $('#lista-ausencias');
    const barbeiroId = $('#ausencias-barbeiro').value;
    if (!barbeiroId) return;

    const { data, error } = await sb
      .from('bloqueios')
      .select('id, inicio, fim, motivo')
      .eq('barbeiro_id', barbeiroId)
      .gt('fim', new Date().toISOString())
      .order('inicio');

    if (error) { area.innerHTML = '<p class="app-erro">Erro ao carregar ausências.</p>'; return; }
    if (!data.length) { area.innerHTML = '<p class="app-aviso-passo">Nenhuma ausência futura para este barbeiro.</p>'; return; }

    area.innerHTML = data.map((b) => `
      <article class="cartao-agendamento vidro" data-id="${b.id}">
        <div class="cartao-agendamento__info">
          <strong>${formatarDataHora(b.inicio)} → ${formatarDataHora(b.fim)}</strong>
          <span>${escaparHtml(b.motivo || 'Indisponível')}</span>
        </div>
        <div class="cartao-agendamento__acoes">
          <button class="acao-apagar acao-remover-ausencia" type="button" aria-label="Remover ausência" title="Remover ausência"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6"/><path d="M10 11v6M14 11v6"/></svg></button>
        </div>
      </article>`).join('');

    $$('.acao-remover-ausencia', area).forEach((btn) =>
      btn.addEventListener('click', () => this.remover(btn.closest('[data-id]').dataset.id)));
  },

  async adicionar(evento) {
    evento.preventDefault();
    const barbeiroId = $('#ausencias-barbeiro').value;
    if (!barbeiroId) return feedback('Selecione um barbeiro.', 'erro');

    const ini = $('#ausencia-inicio').value; // ex.: "2026-07-24T10:00" (hora local da barbearia)
    const fim = $('#ausencia-fim').value;
    if (!ini || !fim) return feedback('Informe início e fim da ausência.', 'erro');

    const inicioIso = new Date(`${ini}:00${OFFSET}`).toISOString();
    const fimIso = new Date(`${fim}:00${OFFSET}`).toISOString();
    if (fimIso <= inicioIso) return feedback('O fim deve ser depois do início.', 'erro');

    const { error } = await sb.from('bloqueios').insert({
      barbeiro_id: barbeiroId,
      inicio: inicioIso,
      fim: fimIso,
      motivo: $('#ausencia-motivo').value.trim() || null,
      barbearia_id: BARBEARIA_ID,
    });
    if (error) return feedback('Não foi possível adicionar a ausência.', 'erro');

    evento.target.reset();
    feedback('Ausência adicionada. Os horários nesse período ficam indisponíveis.');
    this.carregar();
  },

  async remover(id) {
    const ok = await confirmar({
      titulo: 'Remover ausência?',
      texto: 'O barbeiro volta a ficar disponível nesse período.',
      confirmarLabel: 'Sim, remover',
    });
    if (!ok) return;
    const { error } = await sb.from('bloqueios').delete().eq('id', id);
    if (error) return feedback('Não foi possível remover.', 'erro');
    feedback('Ausência removida.');
    this.carregar();
  },
};

/* ============================================================
   RELATÓRIOS (dashboard do mês)
   ------------------------------------------------------------
   Conta cortes concluídos, agendados e cancelados no mês
   corrente e apura o faturamento — medido SÓ pelos concluídos.
============================================================ */
const Relatorios = {
  mesCalendario: null, // Date (UTC, dia 1) do mês exibido no seletor de período
  rangeInicio: null,   // ymd do início do período personalizado
  rangeFim: null,      // ymd do fim do período personalizado

  init() {
    $('#relatorios-atualizar')?.addEventListener('click', () => this.carregar());
    $('#relatorios-barbeiro')?.addEventListener('change', () => this.carregar());
    this.montarCalendario();
  },

  formatarData(ymd) {
    const [a, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(a, m - 1, d)).toLocaleDateString('pt-BR', { timeZone: 'UTC', day: '2-digit', month: 'short' });
  },

  /** Renderiza o calendário de escolha de período: 1º clique marca o início, 2º marca o fim */
  montarCalendario() {
    const area = $('#relatorios-calendario');
    if (!area) return;

    const hojeYmd = partesNoFuso(new Date()).ymd;
    const [hAno, hMes] = hojeYmd.split('-').map(Number);
    if (!this.mesCalendario) this.mesCalendario = new Date(Date.UTC(hAno, hMes - 1, 1));
    const ano = this.mesCalendario.getUTCFullYear();
    const mes = this.mesCalendario.getUTCMonth();

    const chaveMes = (a, m) => `${a}-${String(m + 1).padStart(2, '0')}`;
    const podeAvancar = chaveMes(ano, mes) < hojeYmd.slice(0, 7); // sem relatório do futuro

    const primeiro = new Date(Date.UTC(ano, mes, 1));
    const lead = (primeiro.getUTCDay() + 6) % 7; // 0=seg … 6=dom
    const inicioGrade = new Date(Date.UTC(ano, mes, 1 - lead));
    const semana = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

    let celulas = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(inicioGrade.getTime() + i * 86400000);
      const cm = d.getUTCMonth();
      const ymd = `${d.getUTCFullYear()}-${String(cm + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      const futuro = ymd > hojeYmd;
      const noIntervalo = this.rangeInicio && this.rangeFim && ymd > this.rangeInicio && ymd < this.rangeFim;
      const extremo = ymd === this.rangeInicio || ymd === this.rangeFim;

      const cls = ['dia-cel'];
      if (cm !== mes) cls.push('dia-cel--fora');
      if (futuro) cls.push('dia-cel--fechado');
      else cls.push('dia-cel--livre');
      if (ymd === hojeYmd) cls.push('dia-cel--hoje');
      if (noIntervalo) cls.push('dia-cel--intervalo');
      if (extremo) cls.push('dia-cel--escolhido');

      const attrs = futuro ? 'disabled' : `data-ymd="${ymd}"`;
      celulas += `<button type="button" class="${cls.join(' ')}" ${attrs}>${d.getUTCDate()}</button>`;
    }

    const rotulo = this.rangeInicio
      ? (this.rangeFim ? `${this.formatarData(this.rangeInicio)} — ${this.formatarData(this.rangeFim)}` : `${this.formatarData(this.rangeInicio)} — escolha o dia final`)
      : 'Selecione o dia inicial e o dia final do período.';

    area.innerHTML = `
      <p class="app-aviso-passo">${rotulo}</p>
      <div class="calendario__topo">
        <span class="calendario__mes">${primeiro.toLocaleDateString('pt-BR', { timeZone: 'UTC', month: 'long', year: 'numeric' })}</span>
        <div class="calendario__nav">
          <button type="button" class="calendario__seta" data-nav="-1" aria-label="Mês anterior">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <button type="button" class="calendario__seta" data-nav="1" aria-label="Próximo mês" ${podeAvancar ? '' : 'disabled'}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
          </button>
        </div>
      </div>
      <div class="calendario__semana">${semana.map((s) => `<span>${s}</span>`).join('')}</div>
      <div class="calendario__grade">${celulas}</div>
      ${this.rangeInicio ? '<button class="link-sutil" type="button" id="relatorios-periodo-limpar">Voltar para o mês atual</button>' : ''}`;

    $$('.calendario__seta', area).forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        this.mesCalendario = new Date(Date.UTC(ano, mes + Number(btn.dataset.nav), 1));
        this.montarCalendario();
      });
    });

    $$('.dia-cel--livre', area).forEach((btn) => {
      btn.addEventListener('click', () => {
        const ymd = btn.dataset.ymd;
        if (!this.rangeInicio || this.rangeFim) {
          this.rangeInicio = ymd;
          this.rangeFim = null;
        } else if (ymd < this.rangeInicio) {
          this.rangeFim = this.rangeInicio;
          this.rangeInicio = ymd;
        } else {
          this.rangeFim = ymd;
        }
        this.montarCalendario();
        if (this.rangeInicio && this.rangeFim) this.carregar();
      });
    });

    $('#relatorios-periodo-limpar')?.addEventListener('click', () => {
      this.rangeInicio = null;
      this.rangeFim = null;
      this.montarCalendario();
      this.carregar();
    });
  },

  /** Preenche o seletor: "Todos os barbeiros" + cada barbeiro. Chamado por Barbeiros.carregar() */
  popularSeletor(barbeiros) {
    const seletor = $('#relatorios-barbeiro');
    if (!seletor) return;
    const anterior = seletor.value;
    seletor.innerHTML = ['<option value="">Todos os barbeiros</option>']
      .concat((barbeiros || []).map((b) => `<option value="${b.id}">${escaparHtml(b.nome)}</option>`))
      .join('');
    if (anterior && (barbeiros || []).some((b) => b.id === anterior)) seletor.value = anterior;
  },

  /** Início do mês corrente e do mês seguinte, no fuso da barbearia */
  intervaloMes() {
    const { ymd } = partesNoFuso(new Date());
    const [ano, mes] = ymd.split('-').map(Number);
    const dois = (n) => String(n).padStart(2, '0');
    const inicio = new Date(`${ano}-${dois(mes)}-01T00:00:00${OFFSET}`);
    const proxAno = mes === 12 ? ano + 1 : ano;
    const proxMes = mes === 12 ? 1 : mes + 1;
    const fim = new Date(`${proxAno}-${dois(proxMes)}-01T00:00:00${OFFSET}`);
    return { inicio, fim };
  },

  /** Início do mês anterior, no fuso da barbearia */
  inicioMesAnterior() {
    const { ymd } = partesNoFuso(new Date());
    const [ano, mes] = ymd.split('-').map(Number);
    const dois = (n) => String(n).padStart(2, '0');
    const a = mes === 1 ? ano - 1 : ano;
    const m = mes === 1 ? 12 : mes - 1;
    return new Date(`${a}-${dois(m)}-01T00:00:00${OFFSET}`);
  },

  /** Hora (0–23) de um timestamp no fuso da barbearia */
  horaNoFuso(iso) {
    return Number(new Intl.DateTimeFormat('pt-BR', {
      timeZone: FUSO, hour: '2-digit', hourCycle: 'h23',
    }).format(new Date(iso)));
  },

  /** Item mais frequente por uma chave. Retorna { chave, total } ou null. */
  top(itens, chaveDe) {
    const contagem = new Map();
    for (const it of itens) {
      const k = chaveDe(it);
      if (k === null || k === undefined) continue;
      contagem.set(k, (contagem.get(k) || 0) + 1);
    }
    let chave = null, total = 0;
    for (const [k, n] of contagem) if (n > total) { total = n; chave = k; }
    return total ? { chave, total } : null;
  },

  /** Variação percentual entre dois números. Retorna { txt, cls }. */
  variacao(atual, anterior) {
    // Sem base no mês passado (era zero): não dá para calcular %, só informar que não há comparação
    if (!anterior) return { txt: 'sem dados no mês passado', cls: atual ? 'sobe' : '' };
    const pct = Math.round(((atual - anterior) / anterior) * 100);
    return { txt: `${pct >= 0 ? '+' : ''}${pct}% vs. mês passado`, cls: pct >= 0 ? 'sobe' : 'desce' };
  },

  async carregar() {
    const area = $('#relatorios-conteudo');
    area.innerHTML = '<p class="app-carregando">Carregando relatórios…</p>';

    // Período personalizado (calendário) tem prioridade sobre o mês corrente.
    const comPeriodo = Boolean(this.rangeInicio && this.rangeFim);
    let inicio, fim, rotulo;
    if (comPeriodo) {
      inicio = new Date(`${this.rangeInicio}T00:00:00${OFFSET}`);
      fim = new Date(new Date(`${this.rangeFim}T00:00:00${OFFSET}`).getTime() + 86400000);
      rotulo = `${this.formatarData(this.rangeInicio)} a ${this.formatarData(this.rangeFim)}`;
    } else {
      ({ inicio, fim } = this.intervaloMes());
      rotulo = inicio.toLocaleDateString('pt-BR', { timeZone: FUSO, month: 'long', year: 'numeric' });
    }
    $('#relatorios-mes').textContent = rotulo;

    const barbeiroId = $('#relatorios-barbeiro')?.value;
    const consulta = (de, ate, campos) => {
      let q = sb.from('agendamentos').select(campos)
        .eq('barbearia_id', BARBEARIA_ID)
        .gte('inicio', de.toISOString()).lt('inicio', ate.toISOString());
      if (barbeiroId) q = q.eq('barbeiro_id', barbeiroId); // vazio = total da barbearia
      return q;
    };

    // Comparação com "mesmo trecho do mês anterior" só faz sentido no modo mês corrente.
    const buscaAnterior = comPeriodo ? Promise.resolve({ data: [] }) : (() => {
      const prevInicio = this.inicioMesAnterior();
      const prevFim = new Date(prevInicio.getTime() + (Date.now() - inicio.getTime()));
      return consulta(prevInicio, prevFim, 'status, via_assinatura, valor_centavos, agendamento_servicos(servicos(preco_centavos))');
    })();

    // A mensalidade é receita do MÊS, não da visita. Só entra na visão de mês
    // fechado e da barbearia inteira: num recorte de dias ela não caberia, e
    // por barbeiro não dá para dividir (o assinante é da barbearia, não de um).
    const comMensalidades = !comPeriodo && !barbeiroId;
    const buscaAssinantes = comMensalidades
      ? sb.from('assinaturas').select('servicos(mensalidade_centavos)').eq('barbearia_id', BARBEARIA_ID)
      : Promise.resolve({ data: [] });

    const [atual, anterior, assinantes] = await Promise.all([
      consulta(inicio, fim, 'status, inicio, via_assinatura, valor_centavos, agendamento_servicos(servicos(nome, preco_centavos))'),
      buscaAnterior,
      buscaAssinantes,
    ]);

    if (atual.error || anterior.error || assinantes.error) {
      area.innerHTML = '<p class="app-erro">Erro ao carregar os relatórios.</p>';
      return;
    }

    const data = atual.data;
    // ponytail: faturamento agora conta desde "confirmado" (não precisa esperar "concluído")
    // Falta = valor zerado, desconta automaticamente
    const prestado = (a) => a.status !== 'cancelado';
    const concluidos = data.filter(prestado);
    const ativos = data.filter((a) => a.status !== 'cancelado');
    // Só o que foi cobrado no balcão: visita de assinante vale 0 aqui.
    const faturamentoServicos = concluidos.reduce((s, a) => s + valorCobrado(a), 0);
    const mensalidades = (assinantes.data || [])
      .reduce((s, a) => s + (a.servicos?.mensalidade_centavos || 0), 0);
    const faturamento = faturamentoServicos + mensalidades;

    const prevConcluidos = anterior.data.filter(prestado);
    const prevFaturamento = prevConcluidos.reduce((s, a) => s + valorCobrado(a), 0);

    // cada serviço individual dos agendamentos ativos (um agendamento pode ter vários)
    const servicosVendidos = ativos.flatMap((a) => servicosResumo(a).itens);

    area.innerHTML = this.render({
      comPeriodo,
      concluidos: concluidos.length,
      agendados: data.filter((a) => a.status === 'confirmado').length,
      cancelados: data.filter((a) => a.status === 'cancelado').length,
      faturamento,
      faturamentoServicos,
      mensalidades,
      assinantes: (assinantes.data || []).length,
      comMensalidades,
      // Compara só serviços: não há histórico de assinantes para comparar
      // mensalidade de um mês com a do outro.
      varFaturamento: comPeriodo ? null : this.variacao(faturamentoServicos, prevFaturamento),
      varCortes: comPeriodo ? null : this.variacao(concluidos.length, prevConcluidos.length),
      servicoTop: this.top(servicosVendidos, (s) => s.nome),
      diaTop: this.top(ativos, (a) => partesNoFuso(new Date(a.inicio)).diaSemana),
      horaTop: this.top(ativos, (a) => this.horaNoFuso(a.inicio)),
    });
  },

  render(m) {
    const cartao = (tipo, icone, valor, rotulo) => `
      <div class="rel-cartao rel-cartao--${tipo}">
        <span class="rel-cartao__icone" aria-hidden="true">${icone}</span>
        <strong class="rel-cartao__valor">${valor}</strong>
        <span class="rel-cartao__rotulo">${rotulo}</span>
      </div>`;

    const destaque = (rotulo, valor, sub) => `
      <div class="rel-destaque">
        <span>${rotulo}</span>
        <strong>${valor}</strong>
        ${sub ? `<small>${sub}</small>` : ''}
      </div>`;

    const iCheck = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
    const iCal = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';
    const iX = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

    const servicoNome = m.servicoTop ? escaparHtml(m.servicoTop.chave) : '—';
    const diaNome = m.diaTop ? DIAS_SEMANA[m.diaTop.chave] : '—';
    const horaFaixa = m.horaTop ? `${m.horaTop.chave}h–${m.horaTop.chave + 1}h` : '—';

    return `
      <div class="rel-cartoes">
        ${cartao('concluido', iCheck, m.concluidos, 'Cortes concluídos')}
        ${cartao('agendado', iCal, m.agendados, 'Agendados')}
        ${cartao('cancelado', iX, m.cancelados, 'Cancelados')}
      </div>

      <div class="rel-financeiro vidro">
        <div class="rel-financeiro__topo">
          <span class="rel-financeiro__rotulo">Faturamento ${m.comPeriodo ? 'do período' : 'do mês'}</span>
          <span class="rel-financeiro__nota">${m.comMensalidades
            ? 'Serviços do mês + mensalidades'
            : 'Somente serviços realizados no período'}</span>
        </div>
        <strong class="rel-financeiro__valor">${formatarPreco(m.faturamento)}</strong>
        ${m.comPeriodo ? '' : `
        <p class="rel-comparacao">
          <span class="rel-variacao rel-variacao--${m.varFaturamento.cls}">Serviços: ${m.varFaturamento.txt}</span>
          <span class="rel-variacao rel-variacao--${m.varCortes.cls}">Cortes: ${m.varCortes.txt}</span>
          <small>Compara até o mesmo dia do mês anterior, não o mês inteiro</small>
        </p>`}
        <div class="rel-financeiro__extra">
          <div>
            <span>Serviços realizados</span>
            <strong>${formatarPreco(m.faturamentoServicos)}</strong>
          </div>
          ${m.comMensalidades ? `
          <div>
            <span>Mensalidades${m.assinantes ? ` · ${m.assinantes} assinante${m.assinantes > 1 ? 's' : ''}` : ''}</span>
            <strong>${formatarPreco(m.mensalidades)}</strong>
          </div>` : ''}
          <div>
            <span>Atendimentos</span>
            <strong>${m.concluidos}</strong>
          </div>
        </div>
      </div>

      <div class="rel-destaques vidro">
        ${destaque('Serviço mais vendido', servicoNome, m.servicoTop ? `${m.servicoTop.total} no mês` : 'sem dados ainda')}
        ${destaque('Dia mais cheio', diaNome, m.diaTop ? `${m.diaTop.total} atendimentos` : 'sem dados ainda')}
        ${destaque('Horário de pico', horaFaixa, m.horaTop ? `${m.horaTop.total} atendimentos` : 'sem dados ainda')}
      </div>`;
  },
};

/* ============================================================
   ABAS DO PAINEL
============================================================ */
const AbasAdmin = {
  init() {
    const mapa = {
      agenda: 'painel-agenda',
      relatorios: 'painel-relatorios',
      servicos: 'painel-servicos',
      assinantes: 'painel-assinantes',
      barbeiros: 'painel-barbeiros',
      horarios: 'painel-horarios',
      ausencias: 'painel-ausencias',
    };
    Object.keys(mapa).forEach((chave) => {
      $(`#aba-${chave}`).addEventListener('click', () => {
        Object.entries(mapa).forEach(([k, painelId]) => {
          const ativa = k === chave;
          $(`#aba-${k}`).classList.toggle('ativa', ativa);
          $(`#aba-${k}`).setAttribute('aria-selected', ativa);
          $(`#${painelId}`).hidden = !ativa;
        });
        // Recarrega os números sempre que a aba é aberta
        if (chave === 'relatorios') Relatorios.carregar();
        if (chave === 'assinantes') Assinantes.carregar();
      });
    });
  },
};

/* ============================================================
   MENU DO PAINEL (mobile) — gaveta lateral aberta pelo hambúrguer
============================================================ */
const MenuPainel = {
  init() {
    this.botao = $('#painel-menu-toggle');
    this.painel = $('#abas-lateral');
    this.fundo = $('#painel-overlay');
    if (!this.botao || !this.painel) return;

    this.botao.addEventListener('click', () => this.alternar());
    this.fundo?.addEventListener('click', () => this.fechar());

    // Escolher uma seção fecha a gaveta automaticamente
    $$('.aba', this.painel).forEach((aba) => {
      aba.addEventListener('click', () => this.fechar());
    });

    document.addEventListener('keydown', (evento) => {
      if (evento.key === 'Escape' && this.estaAberto()) {
        this.fechar();
        this.botao.focus();
      }
    });
  },

  estaAberto() {
    return this.botao.getAttribute('aria-expanded') === 'true';
  },

  alternar() {
    this.estaAberto() ? this.fechar() : this.abrir();
  },

  abrir() {
    this.botao.setAttribute('aria-expanded', 'true');
    this.botao.setAttribute('aria-label', 'Fechar menu');
    this.painel.classList.add('aberta');
    this.fundo?.classList.add('aberta');
    document.body.style.overflow = 'hidden';
  },

  fechar() {
    this.botao.setAttribute('aria-expanded', 'false');
    this.botao.setAttribute('aria-label', 'Abrir menu');
    this.painel.classList.remove('aberta');
    this.fundo?.classList.remove('aberta');
    document.body.style.overflow = '';
  },
};

/* ============================================================
   DROPDOWN ESTILIZADO
   ------------------------------------------------------------
   Substitui a lista nativa do <select> (que segue o estilo do
   navegador/SO) por uma lista no visual do site, mantendo o
   <select> por trás — todo o resto do código lê .value e o
   evento 'change' normalmente. Se o JS falhar, o select nativo
   (já estilizado no CSS) continua funcionando.
============================================================ */
function estilizarSelect(select) {
  const wrap = document.createElement('div');
  wrap.className = 'select-bonito';
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(select);
  select.classList.add('select-bonito__nativo');

  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = 'select-bonito__botao';
  botao.setAttribute('aria-haspopup', 'listbox');
  botao.setAttribute('aria-expanded', 'false');

  const lista = document.createElement('div');
  lista.className = 'select-bonito__lista';
  lista.setAttribute('role', 'listbox');
  lista.hidden = true;

  wrap.append(botao);
  // A lista vai direto no <body>, não dentro do wrap: um ancestral com
  // backdrop-filter (.vidro, usado nos formulários) vira o "containing
  // block" de todo position:fixed dentro dele, então top/left calculados
  // para a viewport saem errados se a lista ficar presa ali dentro.
  document.body.appendChild(lista);

  const fechar = () => { lista.hidden = true; botao.classList.remove('aberto'); botao.setAttribute('aria-expanded', 'false'); };
  const posicionar = () => {
    const r = botao.getBoundingClientRect();
    lista.style.top = `${r.bottom + 6}px`;
    lista.style.left = `${r.left}px`;
    lista.style.width = `${r.width}px`;
  };
  const abrir = () => {
    posicionar(); // recalcula a cada abertura — a página pode ter rolado ou o layout mudado
    lista.hidden = false;
    botao.classList.add('aberto');
    botao.setAttribute('aria-expanded', 'true');
  };

  // A posição também precisa ser refeita DEPOIS de aberta: a fonte do Google
  // Fonts pode terminar de carregar um instante depois do clique (comum em
  // 4G) e empurrar todo o layout, deixando a lista presa na posição antiga
  // enquanto o botão já está em outro lugar — o vão que aparecia entre eles.
  document.fonts?.ready.then(() => { if (!lista.hidden) posicionar(); });
  window.addEventListener('resize', () => { if (!lista.hidden) posicionar(); });

  // Rolar a página é o gatilho mais comum de todos: o botão está no fluxo
  // normal e se move com o scroll, mas a lista é position:fixed presa nas
  // coordenadas do clique — sem isto ela ficava para trás, "flutuando"
  // longe do botão. Fecha em vez de tentar seguir: mais simples e sem o
  // custo de recalcular a cada evento de scroll. capture:true pega o
  // scroll de qualquer contêiner rolável, não só da página inteira.
  window.addEventListener('scroll', (e) => {
    // e.target do scroll da própria janela é o objeto `window`, não um nó —
    // .contains() só aceita Node, daí o "instanceof Node" antes de checar.
    if (!lista.hidden && !(e.target instanceof Node && lista.contains(e.target))) fechar();
  }, { capture: true, passive: true });

  function render() {
    const atual = select.options[select.selectedIndex];
    botao.textContent = atual ? atual.textContent : 'Selecione…';
    lista.innerHTML = '';
    [...select.options].forEach((opt) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'select-bonito__opcao' + (opt.selected ? ' select-bonito__opcao--ativa' : '');
      item.textContent = opt.textContent;
      item.setAttribute('role', 'option');
      item.addEventListener('click', () => {
        select.value = opt.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        fechar();
        render();
      });
      lista.appendChild(item);
    });
  }

  botao.addEventListener('click', () => (lista.hidden ? abrir() : fechar()));
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target) && !lista.contains(e.target)) fechar(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });

  // As options são preenchidas dinamicamente (popularSeletor) — re-renderiza sozinho
  new MutationObserver(render).observe(select, { childList: true });
  render();
}

/* ============================================================
   INICIALIZAÇÃO
============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  $('#ano-atual').textContent = new Date().getFullYear();
  AbasAdmin.init();
  MenuPainel.init();
  Agenda.init();
  Relatorios.init();
  Servicos.init();
  Assinantes.init();
  Barbeiros.init();
  Horarios.init();
  Ausencias.init();
  AuthAdmin.init();

  // Dropdowns estilizados em todos os seletores do painel
  ['#agenda-barbeiro', '#horarios-barbeiro', '#relatorios-barbeiro', '#ausencias-barbeiro', '#assinante-plano']
    .forEach((sel) => { const el = $(sel); if (el) estilizarSelect(el); });
});
