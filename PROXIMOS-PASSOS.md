# Barber Daniel's — o que falta

## 1. Criar a conta admin do barbeiro (pendente: e-mail do Daniel)

`jgfcompanyfr@gmail.com` **já está pronta** — é a mesma conta e a mesma senha da RR.
Uma conta agora pode administrar várias barbearias (tabela `admins_barbearia`),
então é só entrar em `admin.html` do Barber Daniel's com o login de sempre.

Para o barbeiro:

1. Ele cria a conta pela própria página `agendar.html` do site do Barber Daniel's
   (ele define a senha). **Tem que ser pelo site** — criar pelo painel do Supabase
   falha, porque a trigger `criar_perfil()` exige o `barbearia_id` que só o
   cadastro do site envia.
2. Depois de confirmar o e-mail, rode no SQL editor do Supabase:

```sql
insert into admins_barbearia (usuario_id, barbearia_id)
select id, 'f9f49a8b-18dd-471d-b5f8-c860e9105cec'
from auth.users where email = 'EMAIL_DO_DANIEL_AQUI'
on conflict do nothing;
```

## 2. Ajustar com o barbeiro antes de publicar

| Onde | O que |
|---|---|
| Painel → Serviços e preços | Preços e durações são **chute meu**: Corte Navalhado R$40/40min, Corte Social R$35/30min, Barba R$30/25min, Sobrancelha R$15/15min, Pezinho R$15/15min |
| Painel → Horários | Hoje está no padrão 09:00–20:00, seg a sáb, domingo fechado |
| Painel → Assinantes | Os dois planos já existem. A **duração** deles (40min e 60min) define quanto tempo da agenda cada visita ocupa |
| `index.html` rodapé | Endereço, telefone, Instagram, WhatsApp — tudo **placeholder** |
| `index.html` galeria | Vazia, esperando as fotos dele |
| `assets/images/barbearia-ambiente.jpg` | Textura de fundo do hero (16% de opacidade) herdada do template. Trocar se quiser |

## 3. Publicar

O `vercel.json` já tem os cabeçalhos de segurança. O CSP libera o domínio do
Supabase, que é o mesmo — não precisa mexer.

Ao criar o projeto na Vercel, apontar para esta pasta. Depois de ter o domínio,
preencher em `index.html`: `<link rel="canonical">`, `og:url` e `og:image`
(removi os da RR para não apontarem para o site errado).

## Referência

- `BARBEARIA_ID` = `f9f49a8b-18dd-471d-b5f8-c860e9105cec` (em `js/supabase.js:21`)
- Servidor local: porta 5603 (`.claude/launch.json`)
- Banco: mesmo projeto Supabase da RR (`giduojgtoyjyxfndusqy`), tenants separados
