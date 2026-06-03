import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  ScrollView,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';

const API_BASE = 'https://construconnect-api.orionsystem.workers.dev/v1';

type PaymentMethod = 'pix' | 'card' | 'cash';

interface PixData {
  qrCode: string;
  qrCodeBase64: string;
  mpPaymentId: string;
  amount: number;
  platformFee: number;
  providerAmount: number;
}

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function maskCard(num: string) {
  const clean = num.replace(/\D/g, '').slice(0, 16);
  return clean.replace(/(.{4})/g, '$1 ').trim();
}

export default function PaymentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loading, setLoading] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>('pix');
  const [pixData, setPixData] = useState<PixData | null>(null);
  const [pixConfirmed, setPixConfirmed] = useState(false);
  const [amount, setAmount] = useState(0);
  const [providerName, setProviderName] = useState('');
  const [category, setCategory] = useState('');

  // Card form state
  const [cardNumber, setCardNumber] = useState('');
  const [cardName, setCardName] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [installments, setInstallments] = useState(1);
  const [mpPublicKey, setMpPublicKey] = useState('');

  useEffect(() => {
    loadServiceData();
    loadMpPublicKey();
  }, [id]);

  async function loadServiceData() {
    const { data } = await supabase
      .from('service_requests')
      .select(`
        quote_amount, category,
        provider_user_id,
        app_users!provider_user_id(full_name)
      `)
      .eq('id', id)
      .maybeSingle();

    if (data) {
      setAmount(Number(data.quote_amount ?? 0));
      setCategory(data.category ?? '');
      const users = data.app_users as any;
      setProviderName(
        Array.isArray(users) ? users[0]?.full_name ?? '' : users?.full_name ?? ''
      );
    }
  }

  async function loadMpPublicKey() {
    try {
      const res = await fetch(`${API_BASE}/mp-public-key`);
      if (res.ok) {
        const data = await res.json() as { publicKey: string };
        setMpPublicKey(data.publicKey);
      }
    } catch {}
  }

  async function getAuthHeader(): Promise<{ Authorization: string } | null> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    return { Authorization: `Bearer ${session.access_token}` };
  }

  // ── PIX ──────────────────────────────────────────────────────────────────────
  async function handleGeneratePix() {
    setLoading(true);
    try {
      const headers = await getAuthHeader();
      if (!headers) { Alert.alert('Sessão expirada', 'Faça login novamente.'); return; }

      const res = await fetch(`${API_BASE}/service-requests/${id}/create-pix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
      });
      const data = await res.json() as any;
      if (!res.ok) throw new Error(data.message ?? 'Erro ao gerar Pix.');
      setPixData(data as PixData);
    } catch (err: any) {
      Alert.alert('Erro', err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCopyPix() {
    if (!pixData?.qrCode) return;
    await Clipboard.setStringAsync(pixData.qrCode);
    Alert.alert('Copiado!', 'Código Pix copiado para a área de transferência.');
  }

  function pollPixStatus() {
    // Supabase realtime subscription para payment_status
    const subscription = supabase
      .channel(`payment-${id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'service_requests',
        filter: `id=eq.${id}`,
      }, (payload) => {
        const updated = payload.new as { payment_status?: string };
        if (updated.payment_status === 'confirmed') {
          subscription.unsubscribe();
          setPixConfirmed(true);
        }
      })
      .subscribe();
  }

  useEffect(() => {
    if (pixData) pollPixStatus();
  }, [pixData]);

  // ── CARTÃO ────────────────────────────────────────────────────────────────────
  async function tokenizeCard(): Promise<string | null> {
    if (!mpPublicKey) {
      Alert.alert('Configuração', 'Chave pública MP não carregada.');
      return null;
    }

    const [month, year] = cardExpiry.split('/');
    const body = {
      card_number: cardNumber.replace(/\s/g, ''),
      expiration_month: Number(month),
      expiration_year: Number(`20${year}`),
      security_code: cardCvv,
      cardholder: { name: cardName.toUpperCase() },
    };

    const res = await fetch('https://api.mercadopago.com/v1/card_tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mpPublicKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json() as any;
      Alert.alert('Cartão inválido', err?.message ?? 'Verifique os dados do cartão.');
      return null;
    }

    const data = await res.json() as { id: string };
    return data.id;
  }

  async function handleCardPayment() {
    if (!cardNumber || !cardName || !cardExpiry || !cardCvv) {
      Alert.alert('Atenção', 'Preencha todos os dados do cartão.');
      return;
    }

    setLoading(true);
    try {
      const token = await tokenizeCard();
      if (!token) return;

      const headers = await getAuthHeader();
      if (!headers) { Alert.alert('Sessão expirada', 'Faça login novamente.'); return; }

      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from('app_users')
        .select('email')
        .eq('id', user?.id ?? '')
        .maybeSingle();

      const res = await fetch(`${API_BASE}/service-requests/${id}/create-card-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          token,
          installments,
          payment_method_id: 'visa', // detectado pelo token no MP
          payer_email: (profile as any)?.email ?? '',
        }),
      });

      const data = await res.json() as any;
      if (!res.ok) throw new Error(data.message ?? 'Erro no pagamento.');

      if (data.status === 'approved') {
        Alert.alert('✅ Aprovado!', 'Pagamento no cartão aprovado com sucesso!', [
          { text: 'OK', onPress: () => router.replace('/(tabs)/requests') },
        ]);
      } else if (data.status === 'in_process') {
        Alert.alert('⏳ Em processamento', 'Seu pagamento está sendo processado. Você será notificado em instantes.');
        router.replace('/(tabs)/requests');
      } else {
        Alert.alert('❌ Recusado', `Pagamento recusado: ${data.statusDetail ?? 'verifique os dados do cartão.'}`);
      }
    } catch (err: any) {
      Alert.alert('Erro', err.message);
    } finally {
      setLoading(false);
    }
  }

  // ── DINHEIRO ──────────────────────────────────────────────────────────────────
  async function handleCashPayment() {
    const headers = await getAuthHeader();
    if (!headers) return;
    const { data: { user } } = await supabase.auth.getUser();

    await fetch(`${API_BASE}/service-requests/${id}/payment-send`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ client_user_id: user?.id, payment_method: 'cash' }),
    });

    Alert.alert('💵 Pagamento informado', 'Informe ao prestador que o pagamento foi efetuado em dinheiro.', [
      { text: 'OK', onPress: () => router.replace('/(tabs)/requests') },
    ]);
  }

  // ── Tela de PIX confirmado ────────────────────────────────────────────────────
  if (pixConfirmed) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.successBox}>
          <Text style={s.successIcon}>✅</Text>
          <Text style={s.successTitle}>Pagamento confirmado!</Text>
          <Text style={s.successSub}>Seu Pix foi aprovado automaticamente.</Text>
          <Text style={s.successSub}>
            {providerName} receberá{' '}
            {formatCurrency(pixData?.providerAmount ?? 0)}
          </Text>
          <TouchableOpacity
            style={s.btnPrimary}
            onPress={() => router.replace('/(tabs)/requests')}
          >
            <Text style={s.btnPrimaryText}>Ver meus pedidos</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Pagamento</Text>
        </View>

        {/* Resumo do serviço */}
        <View style={s.summary}>
          <Text style={s.summaryLabel}>Serviço</Text>
          <Text style={s.summaryValue}>{category} — {providerName}</Text>
          <View style={s.divider} />
          <View style={s.row}>
            <Text style={s.summaryLabel}>Valor total</Text>
            <Text style={s.summaryAmount}>{formatCurrency(amount)}</Text>
          </View>
        </View>

        {/* Seleção de método */}
        {!pixData && (
          <>
            <Text style={s.sectionTitle}>Como deseja pagar?</Text>
            <View style={s.methodRow}>
              {(['pix', 'card', 'cash'] as PaymentMethod[]).map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[s.methodCard, method === m && s.methodCardActive]}
                  onPress={() => setMethod(m)}
                >
                  <Text style={s.methodIcon}>
                    {m === 'pix' ? '⚡' : m === 'card' ? '💳' : '💵'}
                  </Text>
                  <Text style={[s.methodLabel, method === m && s.methodLabelActive]}>
                    {m === 'pix' ? 'Pix' : m === 'card' ? 'Cartão' : 'Dinheiro'}
                  </Text>
                  {m === 'card' && <Text style={s.methodSub}>até 12x</Text>}
                  {m === 'pix' && <Text style={s.methodSub}>Instantâneo</Text>}
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {/* PIX */}
        {method === 'pix' && (
          pixData ? (
            <View style={s.pixBox}>
              <Text style={s.pixTitle}>Escaneie o QR Code</Text>
              {pixData.qrCodeBase64 ? (
                <Image
                  source={{ uri: `data:image/png;base64,${pixData.qrCodeBase64}` }}
                  style={s.qrImage}
                />
              ) : null}
              <Text style={s.pixAmount}>{formatCurrency(pixData.amount)}</Text>
              <Text style={s.pixInfo}>Confirmação automática após pagamento</Text>

              <TouchableOpacity style={s.copyBtn} onPress={handleCopyPix}>
                <Ionicons name="copy-outline" size={16} color={Colors.primary} />
                <Text style={s.copyBtnText}>Copiar código Pix</Text>
              </TouchableOpacity>

              <ActivityIndicator style={{ marginTop: 16 }} color={Colors.primary} />
              <Text style={s.waitingText}>Aguardando confirmação…</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={s.btnPrimary}
              onPress={handleGeneratePix}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.btnPrimaryText}>Gerar QR Code Pix</Text>
              }
            </TouchableOpacity>
          )
        )}

        {/* CARTÃO */}
        {method === 'card' && (
          <View style={s.cardForm}>
            <Text style={s.fieldLabel}>Número do cartão</Text>
            <TextInput
              style={s.input}
              placeholder="0000 0000 0000 0000"
              keyboardType="numeric"
              maxLength={19}
              value={cardNumber}
              onChangeText={(v) => setCardNumber(maskCard(v))}
            />
            <Text style={s.fieldLabel}>Nome no cartão</Text>
            <TextInput
              style={s.input}
              placeholder="NOME COMO NO CARTÃO"
              autoCapitalize="characters"
              value={cardName}
              onChangeText={setCardName}
            />
            <View style={s.row}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={s.fieldLabel}>Validade</Text>
                <TextInput
                  style={s.input}
                  placeholder="MM/AA"
                  keyboardType="numeric"
                  maxLength={5}
                  value={cardExpiry}
                  onChangeText={(v) => {
                    const clean = v.replace(/\D/g, '');
                    setCardExpiry(clean.length > 2 ? `${clean.slice(0,2)}/${clean.slice(2)}` : clean);
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.fieldLabel}>CVV</Text>
                <TextInput
                  style={s.input}
                  placeholder="123"
                  keyboardType="numeric"
                  maxLength={4}
                  secureTextEntry
                  value={cardCvv}
                  onChangeText={setCardCvv}
                />
              </View>
            </View>

            <Text style={s.fieldLabel}>Parcelamento</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              {[1, 2, 3, 6, 12].map((n) => {
                const hasInterest = n > 3;
                const installAmt = hasInterest
                  ? (amount * Math.pow(1.0299, n)) / n
                  : amount / n;
                return (
                  <TouchableOpacity
                    key={n}
                    style={[s.installCard, installments === n && s.installCardActive]}
                    onPress={() => setInstallments(n)}
                  >
                    <Text style={[s.installN, installments === n && { color: '#fff' }]}>
                      {n}x
                    </Text>
                    <Text style={[s.installAmt, installments === n && { color: '#fff' }]}>
                      {formatCurrency(installAmt)}
                    </Text>
                    {!hasInterest && (
                      <Text style={[s.installNoFee, installments === n && { color: '#d1fae5' }]}>
                        sem juros
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <TouchableOpacity
              style={s.btnPrimary}
              onPress={handleCardPayment}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.btnPrimaryText}>
                    Pagar {formatCurrency(installments > 3 ? (amount * Math.pow(1.0299, installments)) : amount)}
                  </Text>
              }
            </TouchableOpacity>
            <Text style={s.secureNote}>🔒 Pagamento seguro via MercadoPago</Text>
          </View>
        )}

        {/* DINHEIRO */}
        {method === 'cash' && (
          <View style={s.cashBox}>
            <Text style={s.cashInfo}>
              Combine o pagamento em dinheiro diretamente com o prestador.
              Após pagar, toque no botão abaixo para confirmar.
            </Text>
            <Text style={s.cashAmount}>{formatCurrency(amount)}</Text>
            <TouchableOpacity
              style={[s.btnPrimary, { backgroundColor: Colors.successGreen }]}
              onPress={handleCashPayment}
            >
              <Text style={s.btnPrimaryText}>Confirmar pagamento em dinheiro</Text>
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  backBtn: { marginRight: 12 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },

  summary: {
    backgroundColor: Colors.cardWhite,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  summaryLabel: { fontSize: 12, color: Colors.textSecondary, marginBottom: 2 },
  summaryValue: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary, marginBottom: 8 },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryAmount: { fontSize: 20, fontWeight: '700', color: Colors.textPrimary },

  sectionTitle: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary, marginBottom: 12 },
  methodRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  methodCard: {
    flex: 1, backgroundColor: Colors.cardWhite,
    borderRadius: 12, borderWidth: 1.5, borderColor: Colors.border,
    paddingVertical: 14, alignItems: 'center',
  },
  methodCardActive: { borderColor: Colors.primary, backgroundColor: '#FFF5F0' },
  methodIcon: { fontSize: 22, marginBottom: 4 },
  methodLabel: { fontSize: 13, fontWeight: '600', color: Colors.textPrimary },
  methodLabelActive: { color: Colors.primary },
  methodSub: { fontSize: 10, color: Colors.textSecondary, marginTop: 2 },

  btnPrimary: {
    backgroundColor: Colors.primary, borderRadius: 12,
    paddingVertical: 16, alignItems: 'center', marginTop: 8,
  },
  btnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  pixBox: { alignItems: 'center', paddingVertical: 20 },
  pixTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary, marginBottom: 16 },
  qrImage: { width: 220, height: 220, borderRadius: 8, marginBottom: 12 },
  pixAmount: { fontSize: 22, fontWeight: '700', color: Colors.textPrimary, marginBottom: 4 },
  pixInfo: { fontSize: 12, color: Colors.textSecondary, marginBottom: 16 },
  copyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: Colors.primary, borderRadius: 8,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  copyBtnText: { color: Colors.primary, fontWeight: '600', fontSize: 13 },
  waitingText: { color: Colors.textSecondary, fontSize: 12, marginTop: 8 },

  cardForm: {},
  fieldLabel: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, marginBottom: 4, marginTop: 10 },
  input: {
    backgroundColor: Colors.cardWhite, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, color: Colors.textPrimary,
  },
  installCard: {
    backgroundColor: Colors.cardWhite, borderWidth: 1.5, borderColor: Colors.border,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center', marginRight: 8,
  },
  installCardActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  installN: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  installAmt: { fontSize: 11, color: Colors.textSecondary },
  installNoFee: { fontSize: 9, color: Colors.successGreen },
  secureNote: { textAlign: 'center', color: Colors.textSecondary, fontSize: 11, marginTop: 12 },

  cashBox: { alignItems: 'center', paddingVertical: 20 },
  cashInfo: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', marginBottom: 20, lineHeight: 22 },
  cashAmount: { fontSize: 28, fontWeight: '700', color: Colors.textPrimary, marginBottom: 24 },

  successBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  successIcon: { fontSize: 56, marginBottom: 16 },
  successTitle: { fontSize: 22, fontWeight: '700', color: Colors.textPrimary, marginBottom: 8 },
  successSub: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', marginBottom: 4 },
});
