# SEMANA 2 — Guia de Integração dos Componentes

Instruções para integrar os novos componentes de avaliações (ratings) nas telas existentes.

---

## 1. Integrar RatingModal na Tela de Tracking (mobile-client)

### Arquivo: `apps/mobile-client/app/tracking/[id].tsx`

Quando o usuário marca um serviço como "concluído", o modal de avaliação deve aparecer.

```typescript
import { useState } from 'react';
import RatingModal from '@/app/rating-modal';
import { useRating } from '@/hooks/useRating';

export default function TrackingScreen() {
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [selectedProviderName, setSelectedProviderName] = useState('');
  const { submitRating } = useRating();

  const handleCompleteService = async (serviceId: string, providerName: string) => {
    // Marcar como concluído no backend
    await updateServiceStatus(serviceId, 'completed');
    
    // Mostrar modal de avaliação
    setSelectedServiceId(serviceId);
    setSelectedProviderName(providerName);
    setShowRatingModal(true);
  };

  return (
    <>
      {/* ... tela existente ... */}
      
      <RatingModal
        visible={showRatingModal}
        serviceId={selectedServiceId}
        providerName={selectedProviderName}
        onClose={() => {
          setShowRatingModal(false);
          setSelectedServiceId('');
        }}
        onSubmit={async (rating) => {
          await submitRating(selectedServiceId, rating.score, rating.comment);
        }}
      />
    </>
  );
}
```

---

## 2. Adicionar Navegação para Histórico de Avaliações (mobile-client)

### Arquivo: `apps/mobile-client/app/(tabs)/_layout.tsx`

Adicionar aba ou menu item para "Minhas Avaliações".

```typescript
// Na seção de routes do Tabs
{
  name: 'ratings-history',
  options: {
    title: 'Minhas Avaliações',
    tabBarIcon: ({ color, size }) => (
      <Ionicons name="star" size={size} color={color} />
    ),
  },
}
```

Ou adicionar no menu hambúrguer:

```typescript
// Em um drawer ou menu
<TouchableOpacity onPress={() => router.push('/ratings-history')}>
  <Ionicons name="star-outline" size={24} />
  <Text>Minhas Avaliações</Text>
</TouchableOpacity>
```

---

## 3. Integrar RatingWidget no Perfil (mobile-provider)

### Arquivo: `apps/mobile-provider/app/(tabs)/profile.tsx`

Importar e adicionar o widget na tela de perfil.

```typescript
import { RatingWidget } from '@/components/RatingWidget';
import { supabase } from '@/lib/supabase';

export default function ProfileScreen() {
  const [userId, setUserId] = useState('');

  useEffect(() => {
    const getUser = async () => {
      const { data } = await supabase.auth.getUser();
      setUserId(data.user?.id || '');
    };
    getUser();
  }, []);

  return (
    <ScrollView>
      {/* ... info pessoal ... */}
      
      {userId && (
        <RatingWidget
          providerId={userId}
          onNavigateToDetails={() => router.push('/ratings-received')}
        />
      )}
      
      {/* ... histórico de serviços ... */}
    </ScrollView>
  );
}
```

---

## 4. Adicionar Rota para Histórico de Avaliações Recebidas (mobile-provider)

### Arquivo: `apps/mobile-provider/app/(tabs)/_layout.tsx`

Adicionar aba para "Avaliações Recebidas".

```typescript
{
  name: 'ratings-received',
  options: {
    title: 'Avaliações Recebidas',
    headerShown: false,
    tabBarIcon: ({ color, size }) => (
      <Ionicons name="star" size={size} color={color} />
    ),
  },
}
```

Ou como rota de navegação:

```typescript
// Em app.json ou _layout.tsx
{
  name: 'ratings-received',
  options: {
    headerShown: true,
    title: 'Avaliações',
  }
}
```

---

## 5. Atualizar Router (app.json / Routes)

Se estiver usando Expo Router com pastas de abas, verificar que as rotas estão corretas.

### Estrutura esperada:
```
apps/mobile-client/
├── app/
│   ├── (tabs)/
│   │   ├── _layout.tsx
│   │   ├── home.tsx
│   │   ├── profile.tsx
│   │   └── ratings-history.tsx ← NEW
│   ├── rating-modal.tsx ← NEW
│   └── ...

apps/mobile-provider/
├── app/
│   ├── (tabs)/
│   │   ├── _layout.tsx
│   │   ├── jobs.tsx
│   │   ├── profile.tsx
│   │   └── ratings-received.tsx ← NEW
│   └── ...
```

---

## 6. Variáveis de Ambiente

Certificar que o `API_BASE` está configurado corretamente em ambos os apps.

### File: `apps/mobile-client/.env.local`
```
EXPO_PUBLIC_API_BASE=https://construconnect-api.orionsystem.workers.dev/v1
EXPO_PUBLIC_SUPABASE_URL=https://...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

### File: `apps/mobile-provider/.env.local`
```
EXPO_PUBLIC_API_BASE=https://construconnect-api.orionsystem.workers.dev/v1
EXPO_PUBLIC_SUPABASE_URL=https://...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

Atualizar `API_BASE` nos hooks se necessário:

```typescript
// hooks/useRating.ts
const API_BASE = process.env.EXPO_PUBLIC_API_BASE || 'https://construconnect-api.orionsystem.workers.dev/v1';
```

---

## 7. Testes de Integração

### Teste 1: Modal aparece após conclusão
```bash
1. Mobile Client: Completar serviço
2. Verificar: Modal aparece com nome do prestador
3. Selecionar 4 estrelas
4. Enviar avaliação
5. Verificar: Sucesso (✓)
```

### Teste 2: Histórico carrega
```bash
1. Mobile Client: Ir para "Minhas Avaliações"
2. Verificar: Lista carrega (< 1s)
3. Verificar: Avaliação anterior aparece
4. Pull-to-refresh
5. Verificar: Dados atualizam
```

### Teste 3: Widget atualiza
```bash
1. Mobile Provider: Abrir Perfil
2. Anotar: Score atual (ex: 4.2)
3. (Paralelo) Cliente avalia com 5⭐
4. Mobile Provider: Pull-to-refresh no widget
5. Verificar: Score sobe (ex: 4.27)
```

### Teste 4: Filtros funcionam
```bash
1. Mobile Provider: Ir para "Avaliações Recebidas"
2. Clicar botão "5⭐"
3. Verificar: Lista filtra
4. Clicar "Todas"
5. Verificar: Lista volta ao normal
```

---

## 8. Styling & Temas

Se estiver usando Context para temas, certificar compatibilidade:

```typescript
// Em RatingModal.tsx
import { useTheme } from '@/contexts/ThemeContext';

export default function RatingModal(...) {
  const { colors } = useTheme();
  
  return (
    <View style={{ backgroundColor: colors.cardWhite }}>
      {/* componentes */}
    </View>
  );
}
```

**Verificação**:
- [x] RatingModal usa `Colors` constants
- [x] RatingsHistoryScreen usa theme context
- [x] RatingWidget usa `Colors`
- [x] RatingsReceivedScreen usa theme context

---

## 9. Acessibilidade

Todos os componentes implementam:

- [x] `accessibilityRole="button"` em TouchableOpacity
- [x] `accessibilityLabel` descritivos
- [x] `accessibilityState` para loading/disabled
- [x] Semântica HTML5 (listas, headers)

Validar com:
```bash
# iOS
Accessibility Inspector > Settings > Enable Accessibility
# Android
Settings > Accessibility > TalkBack
```

---

## 10. Erros Comuns & Soluções

### Erro: "useRating is not defined"
```
Solução: 
import { useRating } from '@/hooks/useRating';
// Certificar que o arquivo existe em:
// apps/mobile-client/hooks/useRating.ts
```

### Erro: "API_BASE is not defined"
```
Solução:
Usar EXPO_PUBLIC_API_BASE ou hardcoded URL:
const API_BASE = 'https://construconnect-api.orionsystem.workers.dev/v1';
```

### Erro: "colors.cardWhite is undefined"
```
Solução:
Importar Colors:
import { Colors } from '@/constants/colors';
// Ou usar useTheme()
```

### Erro: FlatList não renderiza
```
Solução:
- Verificar que `data` não é undefined/null
- Verificar `keyExtractor` é único
- Verificar `renderItem` retorna um View
```

### Erro: Modal não aparece
```
Solução:
- Verificar que `visible` está true
- Verificar que `onClose` não fecha o componente pai
- Verificar que Modal não está dentro de outro Modal
```

---

## 11. Logging & Debug

Para debug da integração:

```typescript
// Em useRating.ts
console.log('[useRating] Submitting:', { serviceRequestId, score, comment });
console.log('[useRating] Response:', response);

// Em RatingModal.tsx
console.log('[RatingModal] Opening for:', { serviceId, providerName });
console.log('[RatingModal] Success:', success);

// Em RatingsHistoryScreen
console.log('[RatingsHistoryScreen] Loaded ratings:', ratings.length);
```

Desabilitar logs em produção:
```typescript
const DEBUG = __DEV__; // true em dev, false em prod
if (DEBUG) console.log(...);
```

---

## 12. Checklist Final

Antes de fazer deploy, verificar:

- [ ] Todos os imports estão corretos
- [ ] API_BASE aponta para URL correta
- [ ] Supabase está conectado
- [ ] Temas/cores aplicadas corretamente
- [ ] RatingModal aparece após serviço concluído
- [ ] RatingsHistoryScreen carrega lista
- [ ] RatingWidget aparece no perfil
- [ ] RatingsReceivedScreen filtra corretamente
- [ ] Pull-to-refresh funciona
- [ ] Infinite scroll funciona
- [ ] Testes E2E passam
- [ ] Acessibilidade OK (TalkBack/VoiceOver)
- [ ] Performance OK (< 1s load)

---

## 13. Links de Referência

- [Documentação US-006 (Design)](./US-006-DESIGN-TOKENS.md)
- [Plano de Testes](./SEMANA-2-TESTE-E2E.md)
- [Status Geral](./SEMANA-2-STATUS.md)
- [API Spec](/docs/API-SPEC.md)

---

## 14. Suporte

Dúvidas ou problemas?

1. Verificar `/docs/SEMANA-2-TESTE-E2E.md` para testes
2. Verificar `/docs/API-SPEC.md` para endpoints
3. Verificar logs do Expo: `npx expo start --dev-client`
4. Verificar network em Chrome DevTools: `http://localhost:8081`

---

**Data de Atualização**: 2026-06-02  
**Status**: Pronto para integração
