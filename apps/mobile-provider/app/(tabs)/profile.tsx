import { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  Alert, Modal, TextInput, ScrollView, KeyboardAvoidingView, Platform, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';

const API_BASE = 'https://construconnect-api.orionsystem.workers.dev/v1';

interface ProviderProfile {
  full_name: string;
  email: string;
  city: string;
  phone: string;
  company_name: string;
  accepts_emergency_jobs: boolean;
  status: 'available' | 'busy' | 'offline';
  specialties: string;
  pix_key: string;
}

function getInitials(name: string): string {
  const parts = name.trim().split(' ');
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export default function ProviderProfileScreen() {
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [togglingAvailability, setTogglingAvailability] = useState(false);
  const [editVisible, setEditVisible] = useState(false);

  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editSpecialties, setEditSpecialties] = useState('');
  const [editCompany, setEditCompany] = useState('');
  const [editUrgent, setEditUrgent] = useState(false);
  const [editPixKey, setEditPixKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => { loadProfile(); }, []);

  async function loadProfile() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    setUserId(user.id);

    const [userRes, providerRes] = await Promise.all([
      supabase.from('app_users').select('full_name, email, city, phone, pix_key').eq('id', user.id).single(),
      supabase
        .from('provider_profiles')
        .select('company_name, accepts_emergency_jobs, status, provider_skills(skills(label))')
        .eq('user_id', user.id)
        .single(),
    ]);

    const userData = userRes.data as any;
    const providerData = providerRes.data as any;
    const specialties = (providerData?.provider_skills ?? [])
      .map((ps: any) => ps?.skills?.label)
      .filter(Boolean)
      .join(', ');

    setProfile({
      full_name: userData?.full_name ?? user.user_metadata?.full_name ?? 'Prestador',
      email: userData?.email ?? user.email ?? '',
      city: userData?.city ?? '',
      phone: userData?.phone ?? '',
      company_name: providerData?.company_name ?? '',
      accepts_emergency_jobs: providerData?.accepts_emergency_jobs ?? false,
      status: providerData?.status ?? 'available',
      specialties,
      pix_key: userData?.pix_key ?? '',
    });
    setLoading(false);
  }

  function openEdit() {
    setEditName(profile?.full_name ?? '');
    setEditPhone(profile?.phone ?? '');
    setEditCity(profile?.city ?? '');
    setEditSpecialties(profile?.specialties ?? '');
    setEditCompany(profile?.company_name ?? '');
    setEditUrgent(profile?.accepts_emergency_jobs ?? false);
    setEditPixKey(profile?.pix_key ?? '');
    setSaveError('');
    setEditVisible(true);
  }

  async function handleSave() {
    if (!editName.trim() || !editPhone.trim() || !editCity.trim()) {
      setSaveError('Nome, telefone e cidade são obrigatórios.');
      return;
    }
    if (!userId) return;
    setSaving(true);
    setSaveError('');

    try {
      const res = await fetch(`${API_BASE}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          fullName: editName.trim(),
          phone: editPhone.trim(),
          city: editCity.trim(),
          specialties: editSpecialties.trim(),
          companyName: editCompany.trim(),
          acceptsEmergencyJobs: editUrgent,
          pixKey: editPixKey.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) { setSaveError(json?.message ?? 'Erro ao salvar.'); setSaving(false); return; }

      setProfile((prev) => prev ? {
        ...prev,
        full_name: editName.trim(),
        phone: editPhone.trim(),
        city: editCity.trim(),
        specialties: editSpecialties.trim(),
        company_name: editCompany.trim(),
        accepts_emergency_jobs: editUrgent,
        pix_key: editPixKey.trim(),
      } : prev);
      setEditVisible(false);
    } catch {
      setSaveError('Erro de conexão. Tente novamente.');
    }
    setSaving(false);
  }

  async function handleToggleAvailability(value: boolean) {
    if (!userId) return;
    setTogglingAvailability(true);
    const newStatus = value ? 'available' : 'busy';

    try {
      const res = await fetch(`${API_BASE}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          fullName: profile?.full_name ?? '',
          phone: profile?.phone ?? '',
          city: profile?.city ?? '',
          status: newStatus,
        }),
      });
      if (res.ok) {
        setProfile((prev) => prev ? { ...prev, status: newStatus } : prev);
      } else {
        Alert.alert('Erro', 'Não foi possível atualizar sua disponibilidade.');
      }
    } catch {
      Alert.alert('Erro', 'Erro de conexão.');
    }
    setTogglingAvailability(false);
  }

  async function handleSignOut() {
    Alert.alert('Sair da conta', 'Tem certeza que deseja sair?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Sair', style: 'destructive',
        onPress: async () => {
          setSigningOut(true);
          await supabase.auth.signOut();
          setSigningOut(false);
          router.replace('/(auth)/login');
        },
      },
    ]);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const initials = profile ? getInitials(profile.full_name) : '?';
  const isAvailable = profile?.status === 'available';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.headerBanner}>
        <Text style={styles.headerTitle}>Meu Perfil</Text>
        <TouchableOpacity style={styles.editBtn} onPress={openEdit}>
          <Ionicons name="create-outline" size={20} color={Colors.cardWhite} />
          <Text style={styles.editBtnText}>Editar</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.avatarCard}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <Text style={styles.userName}>{profile?.full_name ?? 'Prestador'}</Text>
          <Text style={styles.userEmail}>{profile?.email ?? ''}</Text>
          {profile?.specialties ? (
            <View style={styles.specialtiesBadge}>
              <Ionicons name="construct-outline" size={14} color={Colors.darkNavy} />
              <Text style={styles.specialtiesText} numberOfLines={2}>{profile.specialties}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.availabilityCard}>
          <View style={styles.availabilityLeft}>
            <View style={[styles.availabilityDot, { backgroundColor: isAvailable ? Colors.successGreen : Colors.textSecondary }]} />
            <View>
              <Text style={styles.availabilityTitle}>{isAvailable ? 'Disponível' : 'Ocupado'}</Text>
              <Text style={styles.availabilityDesc}>
                {isAvailable ? 'Recebendo chamados' : 'Não recebendo chamados'}
              </Text>
            </View>
          </View>
          {togglingAvailability
            ? <ActivityIndicator color={Colors.successGreen} />
            : <Switch
                value={isAvailable}
                onValueChange={handleToggleAvailability}
                trackColor={{ false: Colors.border, true: Colors.successGreen }}
                thumbColor={Colors.cardWhite}
              />}
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoCardTitle}>Informações</Text>
          <InfoRow icon="mail-outline" label="E-mail" value={profile?.email ?? '—'} />
          <InfoRow icon="call-outline" label="Telefone" value={profile?.phone || '—'} />
          <InfoRow icon="location-outline" label="Cidade" value={profile?.city || '—'} />
          <InfoRow icon="business-outline" label="Empresa" value={profile?.company_name || '—'} />
          <InfoRow icon="construct-outline" label="Especialidades" value={profile?.specialties || '—'} />
          <InfoRow icon="qr-code-outline" label="Chave Pix" value={profile?.pix_key || '—'} />
          <InfoRow
            icon="flash-outline"
            label="Aceita urgentes"
            value={profile?.accepts_emergency_jobs ? 'Sim' : 'Não'}
            isLast
          />
        </View>

        <TouchableOpacity
          style={[styles.signOutButton, signingOut && styles.buttonDisabled]}
          onPress={handleSignOut}
          disabled={signingOut}
        >
          {signingOut
            ? <ActivityIndicator color={Colors.dangerRed} />
            : <><Ionicons name="log-out-outline" size={20} color={Colors.dangerRed} /><Text style={styles.signOutText}>Sair da conta</Text></>}
        </TouchableOpacity>
      </ScrollView>

      {/* Edit Modal */}
      <Modal visible={editVisible} animationType="slide" transparent onRequestClose={() => setEditVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Editar perfil</Text>
              <TouchableOpacity onPress={() => setEditVisible(false)} hitSlop={12}>
                <Ionicons name="close" size={24} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.sectionLabel}>Dados pessoais</Text>
              <EditField label="Nome completo" icon="person-outline" value={editName} onChangeText={setEditName} placeholder="Seu nome" />
              <EditField label="Telefone" icon="call-outline" value={editPhone} onChangeText={setEditPhone} placeholder="(11) 99999-9999" keyboardType="phone-pad" />
              <EditField label="Cidade" icon="location-outline" value={editCity} onChangeText={setEditCity} placeholder="Sua cidade" />

              <Text style={styles.sectionLabel}>Dados profissionais</Text>
              <EditField
                label="Especialidades (separadas por vírgula)"
                icon="construct-outline"
                value={editSpecialties}
                onChangeText={setEditSpecialties}
                placeholder="Ex: Alvenaria, Elétrica, Pintura"
              />
              <EditField label="Nome da empresa (opcional)" icon="business-outline" value={editCompany} onChangeText={setEditCompany} placeholder="Nome da empresa" />

              <Text style={styles.sectionLabel}>Pagamento</Text>
              <EditField
                label="Chave Pix (CPF, e-mail, telefone ou aleatória)"
                icon="qr-code-outline"
                value={editPixKey}
                onChangeText={setEditPixKey}
                placeholder="Sua chave Pix"
              />

              <View style={styles.switchRow}>
                <View style={styles.switchLeft}>
                  <Ionicons name="flash-outline" size={20} color={Colors.warningAmber} />
                  <View>
                    <Text style={styles.switchLabel}>Aceita serviços urgentes</Text>
                    <Text style={styles.switchDesc}>Receba chamados com atendimento imediato</Text>
                  </View>
                </View>
                <Switch
                  value={editUrgent}
                  onValueChange={setEditUrgent}
                  trackColor={{ false: Colors.border, true: Colors.primary }}
                  thumbColor={Colors.cardWhite}
                />
              </View>

              {saveError !== '' && (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle-outline" size={16} color={Colors.dangerRed} />
                  <Text style={styles.errorText}>{saveError}</Text>
                </View>
              )}

              <TouchableOpacity
                style={[styles.saveButton, saving && styles.buttonDisabled]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.saveButtonText}>Salvar alterações</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

interface InfoRowProps { icon: string; label: string; value: string; isLast?: boolean; }
function InfoRow({ icon, label, value, isLast = false }: InfoRowProps) {
  return (
    <View style={[styles.infoRow, !isLast && styles.infoRowBorder]}>
      <View style={styles.infoRowIcon}>
        <Ionicons name={icon as 'mail-outline'} size={18} color={Colors.darkNavy} />
      </View>
      <View style={styles.infoRowContent}>
        <Text style={styles.infoRowLabel}>{label}</Text>
        <Text style={styles.infoRowValue}>{value}</Text>
      </View>
    </View>
  );
}

interface EditFieldProps {
  label: string; icon: string; value: string; onChangeText: (t: string) => void;
  placeholder?: string; keyboardType?: 'default' | 'phone-pad';
}
function EditField({ label, icon, value, onChangeText, placeholder, keyboardType = 'default' }: EditFieldProps) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldWrapper}>
        <Ionicons name={icon as 'person-outline'} size={18} color={Colors.textSecondary} style={styles.fieldIcon} />
        <TextInput
          style={styles.fieldInput}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={Colors.textSecondary}
          keyboardType={keyboardType}
          autoCorrect={false}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  headerBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)',
    backgroundColor: Colors.darkNavy,
  },
  headerTitle: { fontSize: 24, fontWeight: '700', color: Colors.cardWhite },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 6 },
  editBtnText: { fontSize: 14, fontWeight: '600', color: Colors.cardWhite },
  content: { padding: 20, gap: 14 },
  avatarCard: {
    backgroundColor: Colors.cardWhite, borderRadius: 16, padding: 20, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  avatarCircle: {
    width: 76, height: 76, borderRadius: 38, backgroundColor: Colors.darkNavy,
    justifyContent: 'center', alignItems: 'center', marginBottom: 12,
    shadowColor: Colors.darkNavy, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  avatarText: { fontSize: 26, fontWeight: '700', color: Colors.cardWhite },
  userName: { fontSize: 20, fontWeight: '700', color: Colors.textPrimary, marginBottom: 4, textAlign: 'center' },
  userEmail: { fontSize: 13, color: Colors.textSecondary, marginBottom: 10, textAlign: 'center' },
  specialtiesBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.background,
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: Colors.border, maxWidth: '90%',
  },
  specialtiesText: { fontSize: 13, fontWeight: '500', color: Colors.darkNavy, flex: 1 },
  availabilityCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.cardWhite, borderRadius: 14, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  availabilityLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  availabilityDot: { width: 12, height: 12, borderRadius: 6 },
  availabilityTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  availabilityDesc: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  infoCard: {
    backgroundColor: Colors.cardWhite, borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  infoCardTitle: {
    fontSize: 13, fontWeight: '700', color: Colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12,
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  infoRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  infoRowIcon: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#EFF3F8',
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  infoRowContent: { flex: 1 },
  infoRowLabel: { fontSize: 12, color: Colors.textSecondary, marginBottom: 2 },
  infoRowValue: { fontSize: 15, fontWeight: '500', color: Colors.textPrimary },
  signOutButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#FEF2F2', borderWidth: 1.5, borderColor: Colors.dangerRed,
    borderRadius: 12, height: 52,
  },
  buttonDisabled: { opacity: 0.7 },
  signOutText: { fontSize: 15, fontWeight: '700', color: Colors.dangerRed },
  // Modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  modalSheet: {
    backgroundColor: Colors.cardWhite, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40, maxHeight: '90%',
  },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: Colors.textPrimary },
  sectionLabel: {
    fontSize: 12, fontWeight: '700', color: Colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12, marginTop: 8,
  },
  fieldGroup: { marginBottom: 14 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: Colors.textPrimary, marginBottom: 6 },
  fieldWrapper: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: Colors.border,
    borderRadius: 10, backgroundColor: Colors.background, paddingHorizontal: 12, height: 46,
  },
  fieldIcon: { marginRight: 8 },
  fieldInput: { flex: 1, fontSize: 15, color: Colors.textPrimary },
  switchRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#FFFBEB', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: '#FDE68A', marginBottom: 16,
  },
  switchLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 },
  switchLabel: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  switchDesc: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FEF2F2', borderRadius: 8, padding: 12, marginBottom: 16,
  },
  errorText: { fontSize: 14, color: Colors.dangerRed, flex: 1 },
  saveButton: {
    backgroundColor: Colors.darkNavy, borderRadius: 12, height: 52,
    justifyContent: 'center', alignItems: 'center', marginTop: 4, marginBottom: 8,
  },
  saveButtonText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
