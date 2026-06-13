import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, ScrollView, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';

import { API_BASE } from '@/lib/config';

type PlanId = 'free' | 'pro' | 'premium';

const PLANS: {
  id: PlanId;
  label: string;
  price: string;
  priceNum: number;
  commission: string;
  jobs: string;
  features: string[];
  color: string;
  recommended?: boolean;
}[] = [
  {
    id: 'free',
    label: 'Free',
    price: 'Grátis',
    priceNum: 0,
    commission: '10% por serviço',
    jobs: 'Até 5 chamados/mês',
    color: Colors.textSecondary,
    features: [
      '5 chamados por mês',
      'Posição padrão na busca',
      '10% de comissão',
      'Chat com clientes',
      'Avaliações de clientes',
    ],
  },
  {
    id: 'pro',
    label: 'Pro',
    price: 'R$ 49,90/mês',
    priceNum: 49.90,
    commission: '8% por serviço',
    jobs: 'Chamados ilimitados',
    color: Colors.primary,
    recommended: true,
    features: [
      'Chamados ilimitados',
      'Destaque na busca',
      '8% de comissão (economia!)',
      'Badge Pro no perfil',
      'Suporte prioritário',
    ],
  },
  {
    id: 'premium',
    label: 'Premium',
    price: 'R$ 99,90/mês',
    priceNum: 99.90,
    commission: '6% por serviço',
    jobs: 'Chamados ilimitados',
    color: '#7C3AED',
    features: [
      'Tudo do Pro +',
      '6% de comissão (menor taxa!)',
      'Badge Verificado',
      'Analytics de performance',
      'Destaque máximo na busca',
    ],
  },
];

export default function SubscriptionScreen() {
  const [currentPlan, setCurrentPlan] = useState<PlanId>('free');
  const [jobsUsed, setJobsUsed] = useState(0);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [periodEnd, setPeriodEnd] = useState<string | null>(null);

  useEffect(() => { loadCurrentPlan(); }, []);

  async function getAuthHeader() {
    const { data: { session } } = await supabase.auth.getSession();
    return session ? { Authorization: `Bearer ${session.access_token}` } : null;
  }

  async function loadCurrentPlan() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const headers = await getAuthHeader();
    if (!headers) return;

    try {
      const res = await fetch(`${API_BASE}/providers/${user.id}/subscription`, { headers: headers as any });
      if (res.ok) {
        const d = await res.json() as any;
        setCurrentPlan(d.plan ?? 'free');
        setJobsUsed(d.monthly_job_count ?? 0);
        setPeriodEnd(d.current_period_end ?? null);
      }
    } catch {}
    setFetching(false);
  }

  async function handleSelectPlan(plan: PlanId) {
    if (plan === currentPlan) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    if (plan === 'free') {
      Alert.alert(
        'Downgrade para Free',
        'Você voltará para o plano gratuito com limite de 5 chamados/mês. Confirmar?',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Confirmar', onPress: () => confirmPlan(user.id, plan, '') },
        ]
      );
      return;
    }

    const { data: profile } = await supabase
      .from('app_users').select('email').eq('id', user.id).single();
    const email = (profile as any)?.email ?? '';

    Alert.alert(
      `Assinar plano ${plan === 'pro' ? 'Pro' : 'Premium'}`,
      `Você será redirecionado para o MercadoPago para completar o pagamento.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Continuar', onPress: () => confirmPlan(user.id, plan, email) },
      ]
    );
  }

  async function confirmPlan(userId: string, plan: PlanId, email: string) {
    setLoading(true);
    try {
      const headers = await getAuthHeader();
      if (!headers) return;

      const res = await fetch(`${API_BASE}/providers/${userId}/subscription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers as any },
        body: JSON.stringify({ plan, payer_email: email }),
      });

      const data = await res.json() as any;
      if (!res.ok) throw new Error(data.message ?? 'Erro ao processar.');

      if (plan === 'free') {
        setCurrentPlan('free');
        Alert.alert('✅ Plano atualizado', 'Você está agora no plano gratuito.');
        return;
      }

      if (data.initPoint) {
        await Linking.openURL(data.initPoint);
        Alert.alert(
          '⏳ Aguardando pagamento',
          'Complete o pagamento no MercadoPago. Seu plano será ativado automaticamente após a confirmação.',
          [{ text: 'OK', onPress: () => loadCurrentPlan() }]
        );
      }
    } catch (err: any) {
      Alert.alert('Erro', err.message);
    } finally {
      setLoading(false);
    }
  }

  if (fetching) {
    return (
      <SafeAreaView style={s.container}>
        <ActivityIndicator style={{ flex: 1 }} color={Colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.scroll}>

        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Planos</Text>
        </View>

        <Text style={s.subtitle}>
          Escolha o plano ideal para o seu negócio
        </Text>

        {/* Status atual */}
        {currentPlan !== 'free' && periodEnd && (
          <View style={s.statusBar}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.successGreen} />
            <Text style={s.statusText}>
              Plano ativo até {new Date(periodEnd).toLocaleDateString('pt-BR')}
            </Text>
          </View>
        )}
        {currentPlan === 'free' && (
          <View style={[s.statusBar, { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }]}>
            <Ionicons name="time-outline" size={16} color={Colors.warningAmber} />
            <Text style={[s.statusText, { color: Colors.warningAmber }]}>
              Plano Free: {jobsUsed}/5 chamados usados este mês
            </Text>
          </View>
        )}

        {PLANS.map((plan) => {
          const isActive = currentPlan === plan.id;
          return (
            <View
              key={plan.id}
              style={[
                s.planCard,
                isActive && { borderColor: plan.color, borderWidth: 2 },
                plan.recommended && !isActive && s.planCardRecommended,
              ]}
            >
              {plan.recommended && (
                <View style={[s.recommendedBadge, { backgroundColor: plan.color }]}>
                  <Text style={s.recommendedText}>Mais popular</Text>
                </View>
              )}

              <View style={s.planHeader}>
                <View>
                  <Text style={[s.planLabel, { color: plan.color }]}>{plan.label}</Text>
                  <Text style={s.planPrice}>{plan.price}</Text>
                </View>
                {isActive && (
                  <View style={[s.activeBadge, { backgroundColor: plan.color + '20' }]}>
                    <Text style={[s.activeBadgeText, { color: plan.color }]}>Ativo</Text>
                  </View>
                )}
              </View>

              <View style={s.planMeta}>
                <View style={s.metaItem}>
                  <Ionicons name="briefcase-outline" size={14} color={Colors.textSecondary} />
                  <Text style={s.metaText}>{plan.jobs}</Text>
                </View>
                <View style={s.metaItem}>
                  <Ionicons name="cash-outline" size={14} color={Colors.textSecondary} />
                  <Text style={s.metaText}>{plan.commission}</Text>
                </View>
              </View>

              {plan.features.map((f, i) => (
                <View key={i} style={s.featureRow}>
                  <Ionicons name="checkmark" size={16} color={plan.color} />
                  <Text style={s.featureText}>{f}</Text>
                </View>
              ))}

              {!isActive && (
                <TouchableOpacity
                  style={[s.selectBtn, { backgroundColor: plan.color }]}
                  onPress={() => handleSelectPlan(plan.id)}
                  disabled={loading}
                >
                  {loading
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={s.selectBtnText}>
                        {plan.id === 'free' ? 'Usar gratuitamente' : `Assinar ${plan.label}`}
                      </Text>
                  }
                </TouchableOpacity>
              )}
            </View>
          );
        })}

        <Text style={s.disclaimer}>
          Planos pagos são cobrados mensalmente via MercadoPago. Cancele quando quiser.
          A comissão é descontada automaticamente de cada serviço pago pelo app.
        </Text>

      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  backBtn: { marginRight: 12 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  subtitle: { fontSize: 14, color: Colors.textSecondary, marginBottom: 16 },

  statusBar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#ECFDF5', borderColor: '#A7F3D0',
    borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 16,
  },
  statusText: { fontSize: 12, color: Colors.successGreen, fontWeight: '500' },

  planCard: {
    backgroundColor: Colors.cardWhite, borderRadius: 16,
    padding: 18, marginBottom: 14,
    borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden', position: 'relative',
  },
  planCardRecommended: { borderColor: Colors.primary + '40' },

  recommendedBadge: {
    position: 'absolute', top: 0, right: 0,
    paddingHorizontal: 12, paddingVertical: 5,
    borderBottomLeftRadius: 12,
  },
  recommendedText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  planHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  planLabel: { fontSize: 18, fontWeight: '800', marginBottom: 2 },
  planPrice: { fontSize: 14, color: Colors.textPrimary, fontWeight: '600' },
  activeBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  activeBadgeText: { fontSize: 11, fontWeight: '700' },

  planMeta: { flexDirection: 'row', gap: 16, marginBottom: 14 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: Colors.textSecondary },

  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  featureText: { fontSize: 13, color: Colors.textPrimary },

  selectBtn: { borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: 12 },
  selectBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  disclaimer: { fontSize: 11, color: Colors.textSecondary, textAlign: 'center', lineHeight: 16, marginTop: 8 },
});
