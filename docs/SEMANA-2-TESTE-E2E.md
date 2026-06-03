# SEMANA 2 — Plano de Testes E2E

## Visão Geral
Testes end-to-end para o sistema de avaliações (ratings) em ambos os apps:
- **mobile-client**: Avaliar prestadores após conclusão de serviço
- **mobile-provider**: Visualizar avaliações recebidas e nota média

---

## TESTE E2E 1: Cliente avalia serviço completo

### Fluxo
1. Cliente marca um serviço como "concluído" 
2. Modal de avaliação aparece automaticamente
3. Cliente seleciona 4 estrelas
4. Cliente digita comentário: "Ótimo trabalho"
5. Clica botão "Enviar Avaliação"
6. Modal exibe mensagem de sucesso (✓)
7. Cliente navega para "Minhas Avaliações"
8. Avaliação aparece na lista com 4⭐ e comentário

### Validações Obrigatórias
- [ ] Modal aparece apenas após status "completed" no serviço
- [ ] Não é possível enviar sem selecionar score (botão disabled)
- [ ] Comentário máximo 200 caracteres respeitado
- [ ] API retorna HTTP 201 com ID da rating
- [ ] Rating refletido no histórico < 2 segundos
- [ ] Modal fecha automaticamente após sucesso (1.5s)
- [ ] Não pode avaliar o mesmo serviço 2x (erro 409 Conflict)

### Passos Detalhados

#### Setup
```bash
# Terminal 1: Mobile Client
cd apps/mobile-client
npm start

# Terminal 2: API (se local)
cd apps/api
npm run dev
```

#### Execução

1. **Login**
   ```
   - Email: cliente@test.com
   - Senha: test123
   ```

2. **Criar ou aceitar serviço**
   ```
   - Navegar para "Tracking"
   - Selecionar serviço em andamento
   - Clicar "Marcar como Concluído"
   ```

3. **Modal aparece**
   ```
   Esperar 1-2 segundos
   Verificar: Modal com "Avaliar [Provider Name]"
   ```

4. **Selecionar 4 estrelas**
   ```
   - Clicar na 4ª estrela
   - Verificar: visual feedback (⭐⭐⭐⭐☆)
   - Verificar: label "4 estrelas selecionadas"
   ```

5. **Digitar comentário**
   ```
   - Clicar no campo de texto
   - Digitar: "Ótimo trabalho!"
   - Verificar: counter "13/200"
   ```

6. **Enviar avaliação**
   ```
   - Clicar "Enviar Avaliação"
   - Verificar: spinner no botão (< 1s)
   - Verificar: resposta de sucesso (✓)
   - Verificar: modal fecha em 1.5s
   ```

7. **Verificar no histórico**
   ```
   - Navegar para "(tabs)/ratings-history" ou menu
   - Verificar: rating aparece no topo da lista
   - Verificar: score 4⭐, comentário, data
   - Verificar: timestamp < 5s de quando enviou
   ```

### Testes de Erro

#### Erro: Selecionar score 0
```
- Clicar "Enviar Avaliação" sem estrela
- Esperar: alert ou mensagem de erro
- Verificar: botão permanece disabled
- Ação esperada: usuário seleciona score
```

#### Erro: Avaliar 2x mesmo serviço
```
- Completar TESTE E2E 1
- Navegar de volta (fechar app)
- Abrir novamente
- Marcar mesmo serviço como concluído
- Modal aparece novamente
- Tentar enviar
- Esperar: erro HTTP 409 "Já avaliado"
```

#### Erro: Desconectar internet durante envio
```
- Iniciar avaliação
- Clicar "Enviar"
- Ativar Airplane Mode imediatamente
- Esperar: erro "Erro de conexão"
- Desativar Airplane Mode
- Clicar "Tentar Novamente"
- Esperar: sucesso (deve fazer retry automático)
```

#### Erro: Comentário > 200 caracteres
```
- Colar texto com 201+ caracteres
- Verificar: input trunca em 200 (não aceita mais)
- Verificar: counter mostra "200/200"
```

---

## TESTE E2E 2: Prestador vê nota atualizada

### Fluxo
1. Prestador abre app
2. Navega para perfil/dashboard
3. Vê widget com nota atual (ex: 4.2⭐ / 28 avaliações)
4. Um cliente avalia o prestador com 5⭐
5. Prestador atualiza dashboard (pull-to-refresh)
6. Nota deve estar > 4.2⭐ (recalculada)
7. Número de avaliações aumenta para 29

### Validações Obrigatórias
- [ ] Widget exibe avg_score com 1 decimal
- [ ] Widget exibe distribuição correta (5, 4, 3, 2, 1)
- [ ] Link "Ver todas as avaliações" leva a tela paginada
- [ ] Paginação funciona (limit=50, infinite scroll)
- [ ] Pull-to-refresh atualiza stats
- [ ] Filtros por score funcionam (5⭐, 4⭐, etc)

### Passos Detalhados

#### Setup (2 dispositivos/emuladores)

**Dispositivo A: Cliente**
```
- Email: cliente@test.com
- App: mobile-client
```

**Dispositivo B: Prestador**
```
- Email: prestador@test.com
- App: mobile-provider
```

#### Execução

1. **Prestador abre dashboard**
   ```
   Dispositivo B:
   - Login como prestador
   - Navegar para "(tabs)/profile" ou similar
   - Verificar: RatingWidget visível
   - Anotar: avg_score atual (ex: 4.2)
   - Anotar: total_count (ex: 28)
   ```

2. **Cliente avalia prestador (paralelo)**
   ```
   Dispositivo A:
   - Login como cliente
   - Executar TESTE E2E 1 completo
   - Selecionar prestador correspondente
   - Enviar avaliação 5⭐
   ```

3. **Prestador atualiza (pull-to-refresh)**
   ```
   Dispositivo B:
   - Manter app aberto
   - Fazer gesto pull-down no widget
   - Esperar: spinner de refresh
   - Verificar: stats atualizam
   - Novo avg_score = (28*4.2 + 1*5) / 29 = ~4.27
   - total_count = 29
   ```

4. **Verificar distribuição**
   ```
   Antes: distribution[5] = X
   Depois: distribution[5] = X+1
   
   Gráfico de barras deve ser refeito
   ```

5. **Clicar "Ver todas as avaliações"**
   ```
   - Clicar link no widget
   - Tela deve abrir em "/ratings-received"
   - Verificar: última avaliação (5⭐) está no topo
   - Cliente anônimo ou nome do cliente
   ```

6. **Testar filtros**
   ```
   - Clicar botão "5⭐"
   - Verificar: lista filtra para apenas 5⭐
   - Novíssima avaliação deve estar visível
   - Clicar "Todas"
   - Verificar: lista volta ao estado anterior
   ```

7. **Testar paginação**
   ```
   - Scroll até o final da lista
   - Mais avaliações devem carregar (infinite scroll)
   - Verificar: loading spinner antes de carregar
   ```

### Testes de Erro

#### Erro: Rating tardia
```
- Cliente avalia
- Prestador aguarda 15+ segundos
- Pull-to-refresh
- Stats devem estar sincronizadas
```

#### Erro: Múltiplas avaliações simultâneas
```
- 3 clientes avaliam o mesmo prestador
- Prestador faz refresh
- Todos os 3 ratings devem aparecer
- avg_score deve estar correto (média de todos)
```

---

## TESTE E2E 3: Casos de erro e edge cases

### Erro: Avaliar 2x mesmo serviço
- [ ] Cliente avalia serviço A com 4⭐
- [ ] Tenta avaliar novamente (ou API tenta)
- [ ] Retorna HTTP 409: "Serviço já avaliado"
- [ ] Alert exibe mensagem clara

### Erro: Score inválido
- [ ] API recebe score = 0
- [ ] Retorna HTTP 400: "Score deve estar entre 1-5"
- [ ] Cliente não pode chegar a isso (button disabled)

### Erro: Comentário vazio é OK
- [ ] Cliente não digita comentário
- [ ] Envia com score=4, comment=""
- [ ] API aceita (comment é opcional)
- [ ] Rating aparece no histórico sem comentário

### Erro: Timeout > 10 segundos
- [ ] Enviar avaliação
- [ ] Throttle network (2G lento)
- [ ] Esperar 10+ segundos
- [ ] App deve dar timeout gracefully
- [ ] Alert: "Tempo limite excedido"

### Erro: API 500 Server Error
- [ ] Enviar avaliação
- [ ] API retorna 500
- [ ] Alert mostra: "Erro do servidor. Tente novamente."
- [ ] Usuário pode fazer retry

### Erro: Histórico vazio
- [ ] Novo cliente sem avaliações
- [ ] Navegar para ratings-history
- [ ] Empty state: "Nenhuma avaliação ainda"
- [ ] Ícone de estrela 
- [ ] Texto descritivo

---

## TESTE DE PERFORMANCE

### Teste 1: Carregar 500 ratings
```
Requisição: GET /v1/ratings/given?limit=500
Esperado:   Tempo < 1 segundo
Validação:  Loading spinner não fica > 2s
            List renderiza smooth sem lag
```

### Teste 2: Lista paginada (infinite scroll)
```
Setup:    Histórico com 150+ ratings
Ação:     Scroll até final
Validação: 1º fetch: 50 items (< 500ms)
           2º fetch: 50 items (< 500ms)
           Sem N+1 queries no backend
```

### Teste 3: Widget stats com 1M avaliações
```
Request: GET /v1/providers/{id}/ratings?limit=1
Validado: Retorna apenas agregado (1 query)
         Tempo resposta < 200ms
         Cálculo avg_score + distribuição OK
```

### Teste 4: Renderização 100+ cards
```
Setup:    FlatList com 100 rating cards
Validado: FPS > 55 (smooth scroll)
         Memory não cresce > 50MB
         Sem crashes
```

---

## Matriz de Testes

| Teste | Dispositivo | Status | Pass/Fail | Observações |
|-------|-------------|--------|-----------|------------|
| E2E 1: Cliente avalia | mobile-client | Ready | - | |
| E2E 2: Prestador vê update | mobile-provider | Ready | - | |
| E2E 3.1: Avaliar 2x | mobile-client | Ready | - | |
| E2E 3.2: Score inválido | mobile-client | Ready | - | |
| E2E 3.3: Comentário vazio | mobile-client | Ready | - | |
| E2E 3.4: Timeout | mobile-client | Ready | - | |
| E2E 3.5: API 500 | mobile-client | Ready | - | |
| E2E 3.6: Histórico vazio | mobile-client | Ready | - | |
| Perf 1: 500 ratings | mobile-client | Ready | - | |
| Perf 2: Infinite scroll | mobile-client | Ready | - | |
| Perf 3: 1M stats | mobile-provider | Ready | - | |
| Perf 4: 100+ cards | mobile-client | Ready | - | |

---

## Checklist Final

### Pré-teste
- [ ] Ambos os apps compilam sem erros
- [ ] API está online (ou local dev)
- [ ] Dados de teste criados (clientes, prestadores)
- [ ] Supabase conectado
- [ ] Network throttling pronto (para teste de timeout)

### Pós-teste
- [ ] Todos os E2E passaram
- [ ] Todos os edge cases tratados
- [ ] Performance dentro dos targets
- [ ] Screenshots capturados
- [ ] Bugs documentados em GitHub Issues

---

## Ferramentas de Teste

```bash
# Teste manual
- Expo Snack (live preview)
- Android Emulator / iOS Simulator
- Network Throttling (DevTools)

# Teste automatizado (futuro)
- Detox (React Native E2E)
- Jest (Unit tests)
```

---

## Data de Conclusão

- **Início**: 2026-06-02
- **Meta**: 2026-06-07
- **Responsável**: QA Engineer

---

*Documento referência para SEMANA 2 — Testing & Deployment Phase*
