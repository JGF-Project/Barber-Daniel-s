/* ============================================================
   BARBER DANIEL'S — SCRIPTS
   ------------------------------------------------------------
   Módulos:
   01. Utilitários
   02. Cabeçalho (fundo ao rolar)
   03. Menu mobile
   04. Scroll reveal (animações de entrada)
   05. Link ativo na navegação
   06. Rodapé (ano automático)
   ------------------------------------------------------------
   O agendamento e a área do cliente ficam em js/agendar.js;
   o painel do barbeiro, em js/admin.js.
============================================================ */

'use strict';

/* ============================================================
   01. UTILITÁRIOS
============================================================ */
const $ = (seletor, contexto = document) => contexto.querySelector(seletor);
const $$ = (seletor, contexto = document) => [...contexto.querySelectorAll(seletor)];

/** Respeita a preferência do usuário por menos movimento */
const movimentoReduzido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ============================================================
   02. CABEÇALHO — ganha fundo de vidro após rolar a página
============================================================ */
const Cabecalho = {
  init() {
    const cabecalho = $('#cabecalho');
    if (!cabecalho) return;

    const atualizar = () => {
      cabecalho.classList.toggle('rolado', window.scrollY > 24);
    };

    // 'passive' evita bloquear a rolagem; estado inicial já é aplicado
    window.addEventListener('scroll', atualizar, { passive: true });
    atualizar();
  },
};

/* ============================================================
   03. MENU MOBILE — abre/fecha painel com acessibilidade
============================================================ */
const MenuMobile = {
  init() {
    this.botao = $('.menu-toggle');
    this.painel = $('#menu');
    if (!this.botao || !this.painel) return;

    this.botao.addEventListener('click', () => this.alternar());

    // Fecha ao clicar em qualquer link do menu
    $$('a', this.painel).forEach((link) => {
      link.addEventListener('click', () => this.fechar());
    });

    // Fecha com a tecla Escape e devolve o foco ao botão
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
    document.body.style.overflow = 'hidden'; // trava a rolagem de fundo
  },

  fechar() {
    this.botao.setAttribute('aria-expanded', 'false');
    this.botao.setAttribute('aria-label', 'Abrir menu');
    this.painel.classList.remove('aberta');
    document.body.style.overflow = '';
  },
};

/* ============================================================
   04. SCROLL REVEAL — revela elementos conforme entram na tela
============================================================ */
const ScrollReveal = {
  init() {
    const elementos = $$('[data-reveal]');
    if (elementos.length === 0) return;

    // Sem suporte ou com movimento reduzido: mostra tudo de imediato
    if (movimentoReduzido || !('IntersectionObserver' in window)) {
      elementos.forEach((el) => el.classList.add('revelado'));
      return;
    }

    const observador = new IntersectionObserver(
      (entradas) => {
        entradas.forEach((entrada) => {
          if (entrada.isIntersecting) {
            entrada.target.classList.add('revelado');
            observador.unobserve(entrada.target); // anima apenas uma vez
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
    );

    elementos.forEach((el) => observador.observe(el));
  },
};

/* ============================================================
   05. LINK ATIVO — destaca no menu a seção visível
============================================================ */
const NavegacaoAtiva = {
  init() {
    const secoes = $$('main section[id]');
    const links = $$('.navegacao__link');
    if (secoes.length === 0 || links.length === 0) return;

    const observador = new IntersectionObserver(
      (entradas) => {
        entradas.forEach((entrada) => {
          if (!entrada.isIntersecting) return;
          links.forEach((link) => {
            const alvo = link.getAttribute('href') === `#${entrada.target.id}`;
            link.classList.toggle('ativo', alvo);
          });
        });
      },
      // Faixa central da tela define qual seção está "ativa"
      { rootMargin: '-40% 0px -55% 0px' }
    );

    secoes.forEach((secao) => observador.observe(secao));
  },
};

/* ============================================================
   06. RODAPÉ — mantém o ano do copyright sempre atual
============================================================ */
const Rodape = {
  init() {
    const ano = $('#ano-atual');
    if (ano) ano.textContent = new Date().getFullYear();
  },
};

/* ============================================================
   INICIALIZAÇÃO
============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  Cabecalho.init();
  MenuMobile.init();
  ScrollReveal.init();
  NavegacaoAtiva.init();
  Rodape.init();
});
