# US-006: Design Tokens & Wireframes - Sistema de Avaliações

## Design Tokens

### Cores
```
Primary:        #FF6B35  (Orange)
Success Green:  #22C55E
Warning Yellow: #EABB00
Error Red:      #E63946
Text Primary:   #1F2937  (Dark Gray)
Text Secondary: #6B7280  (Medium Gray)
Border:         #E5E7EB  (Light Gray)
Background:     #F9FAFB  (Very Light Gray)
Card White:     #FFFFFF
```

### Tipografia
```
Heading 1: 24px, Bold (700)
Heading 2: 20px, Bold (700)
Heading 3: 18px, Bold (700)
Body:      14px, Regular (400)
Caption:   13px, Regular (400)
Small:     12px, Regular (400)
Tiny:      11px, Regular (400)
```

### Spacing
```
xs:  4px
sm:  8px
md:  12px
lg:  16px
xl:  20px
2xl: 24px
3xl: 32px
```

### Componentes Reutilizáveis

#### 1. StarRating
```typescript
interface StarRatingProps {
  score: number;           // 0-5
  interactive?: boolean;   // default: true
  size?: 'sm' | 'md' | 'lg'; // 24px | 44px | 56px
  onChangeScore?: (score: number) => void;
}

Estados:
- Vazio: ☆☆☆☆☆
- Selecionado: ⭐⭐☆☆☆ (highlight color: primary)
- Hover: Escurecimento suave (opacity: 0.8)
```

#### 2. RatingCard
```typescript
interface RatingCardProps {
  score: number;
  comment?: string;
  providerName: string;
  clientName?: string;
  date: string;
  category?: string;
  variant: 'given' | 'received'; // Dado ou recebido
}

Cores por Score:
- 5-4 ⭐: Green (#22C55E) - left border
- 3 ⭐: Yellow (#EABB00) - left border
- 2-1 ⭐: Red (#E63946) - left border
```

#### 3. RatingDistribution
```typescript
interface RatingDistributionProps {
  distribution: { [score: number]: number };
  total: number;
}

Exibe gráfico de barras horizontal:
5⭐ [████████░░] 28
4⭐ [██████░░░░] 18
3⭐ [███░░░░░░░] 6
2⭐ [██░░░░░░░░] 3
1⭐ [░░░░░░░░░░] 1
```

---

## Wireframes ASCII

### TELA 1: Modal de Avaliação (após conclusão de serviço)

```
┌─────────────────────────────────────┐
│  ════════════════════════════════   │
│        AVALIAR JOÃO SILVA           │
│     Como foi o serviço?             │
│────────────────────────────────────│
│                                     │
│         ☆  ☆  ☆  ☆  ☆            │
│                                     │
│    4 estrelas selecionadas          │
│                                     │
│  [Deixe um comentário (opcional)]  │
│  ┌──────────────────────────────┐  │
│  │ Excelente trabalho! Voltaria  │  │
│  │ a contratar.                  │  │
│  └──────────────────────────────┘  │
│                         38/200      │
│────────────────────────────────────│
│                                     │
│  ┌──────────────┐  ┌──────────────┐│
│  │ Talvez Depois│  │ Enviar      ││
│  └──────────────┘  └──────────────┘│
│                                     │
└─────────────────────────────────────┘

ESTADOS:
- Vazio (nenhuma estrela)
- Selecionado (estrelas preenchidas)
- Loading (spinner no botão)
- Sucesso (✓ com mensagem)
- Erro (banner vermelho)
```

### TELA 2: Histórico de Avaliações Dadas (mobile-client)

```
┌──────────────────────────────────┐
│ MINHAS AVALIAÇÕES                │
│ 12 avaliações realizadas         │
├──────────────────────────────────┤
│                                  │
│ João Silva                   4⭐ │
│ Alvenaria                        │
│ "Ótimo trabalho! Voltaria a      │
│  contratar."                     │
│ 25/05/2026                       │
│─────────────────────────────────│
│                                  │
│ Maria Oliveira               5⭐ │
│ Hidráulica                       │
│ 23/05/2026                       │
│─────────────────────────────────│
│                                  │
│ Carlos Santos                3⭐ │
│ Pintura                          │
│ "Acabamento poderia ser melhor"  │
│ 21/05/2026                       │
│                                  │
│ [INFINITE SCROLL / PULL-TO-REFRESH]
│                                  │
└──────────────────────────────────┘

CARDS:
┌─────────────────────┐
│ João Silva      4⭐ │
│ Alvenaria           │
│                     │
│ "Comentário aqui"   │
│ 25/05/2026          │
└─────────────────────┘
```

### TELA 3: Dashboard de Ratings (mobile-provider)

```
┌──────────────────────────────────┐
│ SEU PERFIL                       │
├──────────────────────────────────┤
│                                  │
│ ┌──────────────────────────────┐ │
│ │  4.8 ⭐                      │ │
│ │ Sua nota                      │ │
│ │ (28 avaliações)               │ │
│ │                               │ │
│ │ 5⭐ [████████░░] 18           │ │
│ │ 4⭐ [██████░░░░] 8            │ │
│ │ 3⭐ [██░░░░░░░░] 2            │ │
│ │ 2⭐ [░░░░░░░░░░] 0            │ │
│ │ 1⭐ [░░░░░░░░░░] 0            │ │
│ │                               │ │
│ │ Ver todas as avaliações →    │ │
│ └──────────────────────────────┘ │
│                                  │
└──────────────────────────────────┘

WIDGET PLACEMENT:
Acima de "Histórico de Serviços"
ou na aba de perfil
```

### TELA 4: Histórico de Avaliações Recebidas (mobile-provider)

```
┌──────────────────────────────────┐
│ AVALIAÇÕES RECEBIDAS             │
│ 28 avaliações                    │
├──────────────────────────────────┤
│                                  │
│ [ Todas ] [ 5⭐ ] [ 4⭐ ] [ 3⭐ ] │
│ [ 2⭐ ] [ 1⭐ ]                  │
│────────────────────────────────│
│                                  │
│ ┌──────────────────────────────┐ │
│ │ 👤 Cliente Anônimo       5⭐ │ │
│ │    Alvenaria                 │ │
│ │ "Trabalho impecável!"        │ │
│ │ 25/05/2026                   │ │
│ └──────────────────────────────┘ │
│                                  │
│ ┌──────────────────────────────┐ │
│ │ 👤 João S.              4⭐ │ │
│ │    Hidráulica                │ │
│ │ 23/05/2026                   │ │
│ └──────────────────────────────┘ │
│                                  │
│ [INFINITE SCROLL / PULL-TO-REFRESH]
│                                  │
└──────────────────────────────────┘

CARD DETAILS:
┌─────────────────────────────────┐
│ ┌──┐  Cliente Anônimo       4⭐ │
│ │👤│  Alvenaria                 │
│ └──┘                             │
│                                  │
│ "Comentário do cliente aqui..."  │
│ 25/05/2026                       │
└─────────────────────────────────┘

LEFT BORDER COLORS:
- 5-4 ⭐: Green (#22C55E)
- 3 ⭐: Yellow (#EABB00)
- 1-2 ⭐: Red (#E63946)
```

---

## Componentes Reutilizáveis

### StarRating Component
```typescript
// apps/mobile-client/components/StarRating.tsx
export function StarRating({
  score,
  interactive = true,
  size = 'md',
  onChangeScore,
}: StarRatingProps) {
  const sizes = {
    sm: 24,
    md: 44,
    lg: 56,
  };

  return (
    <View style={styles.container}>
      {[1, 2, 3, 4, 5].map((star) => (
        <TouchableOpacity
          key={star}
          disabled={!interactive}
          onPress={() => onChangeScore?.(star)}
        >
          <Text style={{ fontSize: sizes[size] }}>
            {star <= score ? '⭐' : '☆'}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}
```

### RatingCard Component
```typescript
// apps/mobile-client/components/RatingCard.tsx
export function RatingCard({
  score,
  comment,
  providerName,
  date,
  category,
}: RatingCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.name}>{providerName}</Text>
          {category && <Text style={styles.category}>{category}</Text>}
        </View>
        <View style={styles.score}>
          <Text>{score}⭐</Text>
        </View>
      </View>
      {comment && <Text style={styles.comment}>"{comment}"</Text>}
      <Text style={styles.date}>
        {new Date(date).toLocaleDateString('pt-BR')}
      </Text>
    </View>
  );
}
```

---

## Checklist de Implementação

- [x] Design tokens definidos (cores, spacing, tipografia)
- [x] 4 telas desenhadas em wireframe
- [x] Componentes reutilizáveis: StarRating, RatingCard, RatingDistribution
- [x] Estados para modal: vazio, selecionado, loading, sucesso, erro
- [x] Filtros para histórico recebido (5⭐, 4⭐, 3⭐, 2⭐, 1⭐)
- [x] Distribuição visual em gráfico de barras

---

## Links de Referência

- Cores: `/constants/colors.ts`
- Temas: `/contexts/ThemeContext.tsx`
- Ícones: `@expo/vector-icons` (Ionicons)

