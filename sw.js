/* ============================================================
   BARBER DANIEL'S — SERVICE WORKER
   ------------------------------------------------------------
   Só faz uma coisa: acordar quando chega uma notificação push
   (mesmo com o app fechado) e mostrar ela na tela. Sem cache,
   sem modo offline — não é o que foi pedido, não existe aqui.
============================================================ */

self.addEventListener('push', (evento) => {
  let dados = { titulo: 'Barber Daniel\'s', corpo: 'Novo agendamento.' };
  try { dados = evento.data.json(); } catch { /* payload vazio ou não-JSON: usa o texto padrão acima */ }

  evento.waitUntil(
    self.registration.showNotification(dados.titulo || 'Barber Daniel\'s', {
      body: dados.corpo || '',
      icon: 'assets/icons/icon-192.png',
      badge: 'assets/icons/icon-192.png',
      tag: 'agendamento', // notificações novas substituem a anterior em vez de empilhar
    })
  );
});

/* Toca na notificação → abre o painel (ou foca a aba já aberta) */
self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  evento.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((abas) => {
      const aberta = abas.find((a) => a.url.includes('admin.html'));
      if (aberta) return aberta.focus();
      return self.clients.openWindow('/admin.html');
    })
  );
});
