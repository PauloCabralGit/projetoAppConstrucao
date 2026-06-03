# Classificação etária (IARC) + Segurança de Dados — ambos os apps

Estas respostas valem para o app Cliente e o Prestador (conteúdo equivalente).

## Questionário de classificação etária (Play Console → Classificação de conteúdo)
Responda o questionário IARC. Respostas recomendadas:

| Pergunta | Resposta |
|---|---|
| Categoria do app | Aplicativo (utilitário/social/comunicação) |
| Contém violência | Não |
| Contém conteúdo sexual / nudez | Não |
| Linguagem imprópria / palavrões | Não |
| Drogas, álcool, tabaco | Não |
| Jogos de azar / apostas (gambling) | Não |
| Compras digitais | **Sim** (assinaturas do prestador / pagamentos no app) |
| Os usuários interagem / trocam mensagens (UGC) | **Sim** (chat entre cliente e profissional) |
| Compartilha a localização do usuário | **Sim** (localização para conectar e acompanhar serviços) |
| Conteúdo gerado por usuários é compartilhado | **Sim** (fotos, descrições, avaliações) |

Resultado esperado: **Livre / Classificação L (Everyone)**, com avisos de "interação entre usuários", "compartilha localização" e "compras digitais". (O app é destinado a maiores de 18 — mantenha isso na descrição/termos, mas o IARC tende a classificar como Livre pelo tipo de conteúdo.)

## Formulário "Segurança dos dados" (Data Safety) — Play Console
Declare a coleta abaixo (coerente com a política de privacidade):

**Dados pessoais**
- Nome — coletado, vinculado ao usuário. Finalidade: funcionalidade do app, conta.
- E-mail — coletado, vinculado. Finalidade: conta, comunicação.
- Telefone — coletado, vinculado. Finalidade: funcionalidade (contato entre as partes).

**Localização**
- Localização aproximada e precisa — coletada, vinculada. Finalidade: funcionalidade do app (encontrar e acompanhar serviços).

**Fotos / vídeos**
- Fotos — coletadas, vinculadas. Finalidade: funcionalidade (evidências do serviço).

**Mensagens no app**
- Mensagens — coletadas, vinculadas. Finalidade: funcionalidade (chat).

**Informações financeiras**
- Informações de pagamento — processadas pelo MercadoPago. Declare conforme o fluxo (em geral: coletadas para funcionalidade; não armazenamos número de cartão).

**Identificadores do dispositivo**
- ID do dispositivo / token de push — coletado. Finalidade: notificações, segurança.

**Práticas de segurança**
- Dados são criptografados em trânsito: **Sim**.
- O usuário pode solicitar a exclusão dos dados: **Sim** (in-app e por e-mail).
- URL de exclusão de conta: https://projetoappconstrucao.pages.dev/exclusao-de-conta.html
