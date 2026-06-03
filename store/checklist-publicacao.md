# Checklist de publicação na Play Store — ConstruConnect

## Assets já gerados (nesta pasta /store)
- [x] Ícone 512×512 — `cliente/icon-512.png` e `prestador/icon-512.png`
- [x] Feature graphic 1024×500 — `cliente/feature-graphic-1024x500.png` e `prestador/feature-graphic-1024x500.png`
- [x] Descrições (curta + completa) — `cliente/descricao.md` e `prestador/descricao.md`
- [x] Classificação etária + Data Safety — `classificacao-etaria.md`
- [x] Política de privacidade — publicada em /apps/web/public/privacidade.html
- [x] Exclusão de conta — publicada em /apps/web/public/exclusao-de-conta.html

## Falta produzir (precisa do app rodando)
- [ ] **Screenshots de celular** — mínimo 2, recomendado 4–8, por app.
      Tamanho: 1080×1920 (retrato) ou similar (proporção 9:16). PNG/JPG.
      Como capturar: rode o app no celular/emulador e tire prints das telas principais
      (cliente: home/pedido, orçamentos, acompanhamento no mapa, pagamento;
       prestador: chamados, serviço ativo, ganhos, plano).

## Conteúdo da ficha (preencher no Play Console, por app)
- [ ] Nome do app, descrição curta e completa (ver descricao.md)
- [ ] Ícone 512×512
- [ ] Feature graphic 1024×500
- [ ] Screenshots
- [ ] Categoria (Cliente: Casa e decoração | Prestador: Negócios)
- [ ] E-mail de contato
- [ ] URL da política de privacidade: https://projetoappconstrucao.pages.dev/privacidade.html
- [ ] Classificação de conteúdo (questionário IARC)
- [ ] Segurança dos dados (Data Safety)
- [ ] Público-alvo e conteúdo (faixa etária)
- [ ] Anúncios: o app contém anúncios? Não
- [ ] URL de exclusão de conta: https://projetoappconstrucao.pages.dev/exclusao-de-conta.html

## Build e envio (ver guia já passado no chat)
- [ ] `eas build --platform android --profile production` (cliente e prestador)
- [ ] Configurar `google-services-key.json` (service account) nas duas pastas
- [ ] `eas submit --platform android --profile production --latest`

## Observações
- Cada app é uma ficha separada na Play Store (pacotes distintos).
- O e-mail de contato/privacidade está como paulinhocabral90@gmail.com — troque por um e-mail
  de suporte oficial se desejar.
