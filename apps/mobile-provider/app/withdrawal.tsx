import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  FlatList,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';

const API_BASE = 'https://construconnect-api.orionsystem.workers.dev/v1';

const PIX_TYPES = [
  { label: 'CPF', hint: '000.000.000-00' },
  { label: 'CNPJ', hint: '00.000.000/0001-00' },
  { label: 'Celular', hint: '+55 (11) 99999-9999' },
  { label: 'E-mail', hint: 'email@exemplo.com' },
  { label: 'Chave aleatória', hint: '32 dígitos' },
];

interface Withdrawal {
  id: string;
  amount: number;
  pix_key: string;
  status: 'requested' | 'processing' | 'completed' | 'failed';
  created_at: string;
  processed_at: string | null;
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  requested: { label: 'Solicitado', color: Colors.warningAmber },
  processing: { label: 'Processando', color: '#3B82F6' },
  completed: { label: 'Concluído', color: Colors.successGreen },
  failed: { label: 'Falhou', color: Colors.dangerRed },
};

function formatCurrency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function WithdrawalScreen() {
  const [balance, setBalance] = useState(0);
  const [pending, setPending] = useState(0);
  const [amount, setAmount] = useState('');
  const [pixType, setPixType] = useState(0);
  const [pixKey, setPixKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingBalance, setLoadingBalance] = useState(true);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [userId, setUserId] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  async function getAuthHeader() {
    const { data: { session } } = await supabase.auth.getSession();
    return session ? { Authorization: `Bearer ${session.access_token}` } : null;
  }

  async function loadData() {
    setLoadingBalance(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const headers = await getAuthHeader();
    if (!headers) return;

    const [balRes, listRes] = await Promise.all([
      fetch(`${API_BASE}/providers/${user.id}/balance`, { headers: headers as any }),
      fetch(`${API_BASE}/providers/${user.id}/withdrawals`, { headers: headers as any }),
    ]);

    if (balRes.ok) {
      const b = await balRes.json() as { available: number; pending: number };
      setBalance(b.available);
      setPending(b.pending);
    }

    if (listRes.ok) {
      const l = await listRes.json() as { withdrawals: Withdrawal[] };
      setWithdrawals(l.withdrawals);
    }

    setLoadingBalance(false);
  }

  async function handleWithdraw() {
    const amountNum = parseFloat(amount.replace(',', '.'));
    if (!amountNum || amountNum <= 0) {
      Alert.alert('Valor inválido', 'Digite um valor válido para o saque.');
      return;
    }
    if (amountNum > balance) {
      Alert.alert('Saldo insuficiente', `Seu saldo disponível é ${formatCurrency(balance)}.`);
      return;
    }
    if (!pixKey.trim()) {
      Alert.alert('Chave Pix', 'Informe sua chave Pix para receber o valor.');
      return;
    }

    Alert.alert(
      'Confirmar saque',
      `Sacar ${formatCurrency(amountNum)} para a chave Pix:\n${pixKey}`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Confirmar',
          onPress: async () => {
            setLoading(true);
            try {
              const headers = await getAuthHeader();
              if (!headers) return;

              const res = await fetch(`${API_BASE}/providers/${userId}/withdrawal`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers as any },
                body: JSON.stringify({ amount: amountNum, pix_key: pixKey.trim() }),
              });

              const data = await res.json() as any;
              if (!res.ok) throw new Error(data.message ?? 'Erro ao solicitar saque.');

              Alert.alert(
                '✅ Saque solicitado!',
                'Seu saque foi solicitado e será processado em até 1 dia útil.',
                [{ text: 'OK' }]
              );
              setAmount('');
              setPixKey('');
              loadData();
            } catch (err: any) {
              Alert.alert('Erro', err.message);
            } finally {
              setLoading(false);
            }
          },
        },
      ]
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
          <Text style={s.headerTitle}>Meus Ganhos</Text>
        </View>

        {/* Cards de saldo */}
        {loadingBalance ? (
          <ActivityIndicator style={{ marginVertical: 20 }} color={Colors.primary} />
        ) : (
          <View style={s.balanceRow}>
            <View style={[s.balanceCard, { flex: 1.5 }]}>
              <Text style={s.balanceLabel}>Saldo disponível</Text>
              <Text style={s.balanceValue}>{formatCurrency(balance)}</Text>
              <Text style={s.balanceSub}>Pronto para saque</Text>
            </View>
            <View style={[s.balanceCard, { flex: 1, marginLeft: 10, backgroundColor: '#FFFBEB' }]}>
              <Text style={s.balanceLabel}>Pendente</Text>
              <Text style={[s.balanceValue, { fontSize: 16, color: Colors.warningAmber }]}>
                {formatCurrency(pending)}
              </Text>
              <Text style={s.balanceSub}>A confirmar</Text>
            </View>
          </View>
        )}

        {/* Formulário de saque */}
        <View style={s.card}>
          <Text style={s.sectionTitle}>Solicitar saque via Pix</Text>

          <Text style={s.fieldLabel}>Valor do saque</Text>
          <View style={s.amountRow}>
            <Text style={s.currencySymbol}>R$</Text>
            <TextInput
              style={s.amountInput}
              placeholder="0,00"
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
            />
            <TouchableOpacity
              onPress={() => setAmount(balance.toFixed(2).replace('.', ','))}
              style={s.maxBtn}
            >
              <Text style={s.maxBtnText}>Máximo</Text>
            </TouchableOpacity>
          </View>

          <Text style={s.fieldLabel}>Tipo de chave Pix</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
            {PIX_TYPES.map((t, i) => (
              <TouchableOpacity
                key={i}
                style={[s.typeChip, pixType === i && s.typeChipActive]}
                onPress={() => { setPixType(i); setPixKey(''); }}
              >
                <Text style={[s.typeChipText, pixType === i && s.typeChipTextActive]}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={s.fieldLabel}>Chave Pix</Text>
          <TextInput
            style={s.input}
            placeholder={PIX_TYPES[pixType].hint}
            value={pixKey}
            onChangeText={setPixKey}
            autoCapitalize="none"
            keyboardType={pixType === 2 ? 'phone-pad' : pixType === 3 ? 'email-address' : 'default'}
          />

          <TouchableOpacity
            style={[s.btnPrimary, (loading || !amount || !pixKey) && s.btnDisabled]}
            onPress={handleWithdraw}
            disabled={loading || !amount || !pixKey}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.btnPrimaryText}>Solicitar saque</Text>
            }
          </TouchableOpacity>

          <Text style={s.disclaimer}>
            Saques são processados em até 1 dia útil, de segunda a sexta, das 9h às 18h.
          </Text>
        </View>

        {/* Histórico de saques */}
        {withdrawals.length > 0 && (
          <View style={s.card}>
            <Text style={s.sectionTitle}>Histórico de saques</Text>
            {withdrawals.map((w) => {
              const st = STATUS_CONFIG[w.status] ?? { label: w.status, color: Colors.textSecondary };
              return (
                <View key={w.id} style={s.withdrawalRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.withdrawalAmount}>{formatCurrency(Number(w.amount))}</Text>
                    <Text style={s.withdrawalKey} numberOfLines={1}>{w.pix_key}</Text>
                    <Text style={s.withdrawalDate}>{formatDate(w.created_at)}</Text>
                  </View>
                  <View style={[s.statusBadge, { backgroundColor: st.color + '20' }]}>
                    <Text style={[s.statusText, { color: st.color }]}>{st.label}</Text>
                  </View>
                </View>
              );
            })}
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

  balanceRow: { flexDirection: 'row', marginBottom: 16 },
  balanceCard: {
    backgroundColor: Colors.cardWhite, borderRadius: 14,
    padding: 16, borderWidth: 1, borderColor: Colors.border,
  },
  balanceLabel: { fontSize: 11, color: Colors.textSecondary, marginBottom: 4 },
  balanceValue: { fontSize: 22, fontWeight: '700', color: Colors.textPrimary },
  balanceSub: { fontSize: 10, color: Colors.textSecondary, marginTop: 2 },

  card: {
    backgroundColor: Colors.cardWhite, borderRadius: 14,
    padding: 16, marginBottom: 16,
    borderWidth: 1, borderColor: Colors.border,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary, marginBottom: 14 },

  fieldLabel: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, marginBottom: 6 },
  amountRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 10, paddingHorizontal: 12, marginBottom: 14,
  },
  currencySymbol: { fontSize: 16, color: Colors.textPrimary, marginRight: 4 },
  amountInput: { flex: 1, fontSize: 20, fontWeight: '700', color: Colors.textPrimary, paddingVertical: 12 },
  maxBtn: { backgroundColor: Colors.primary + '20', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  maxBtnText: { fontSize: 11, color: Colors.primary, fontWeight: '600' },

  typeChip: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 7, marginRight: 8,
  },
  typeChipActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '15' },
  typeChipText: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500' },
  typeChipTextActive: { color: Colors.primary, fontWeight: '700' },

  input: {
    backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, color: Colors.textPrimary, marginBottom: 16,
  },

  btnPrimary: {
    backgroundColor: Colors.primary, borderRadius: 12,
    paddingVertical: 15, alignItems: 'center',
  },
  btnDisabled: { opacity: 0.4 },
  btnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  disclaimer: { fontSize: 11, color: Colors.textSecondary, textAlign: 'center', marginTop: 12, lineHeight: 16 },

  withdrawalRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  withdrawalAmount: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  withdrawalKey: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  withdrawalDate: { fontSize: 11, color: Colors.textSecondary, marginTop: 1 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 11, fontWeight: '700' },
});
