import { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  Alert, Modal, TextInput, ScrollView, KeyboardAvoidingView, Platform, Switch, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';

import { API_BASE } from '@/lib/config';

interface UserProfile {
  full_name: string;
  email: string;
  city: string;
  phone: string;
  role: string;
}

function getInitials(name: string): string {
  const parts = name.trim().split(' ');
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function getRoleLabel(role: string): string {
  const map: Record<string, string> = { client: 'Cliente', builder: 'Pedreiro', contractor: 'Empreiteiro' };
  return map[role] ?? role;
}

export default function ProfileScreen() {
  const { isDark, toggleTheme } = useTheme();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [editVisible, setEditVisible] = useState(false);

  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editCity, setEditCity] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [telemedicine, setTelemedicine] = useState<{ partner_name: string; partner_description: string; access_url?: string; verified: boolean } | null>(null);
  const [showTelemedicineSheet, setShowTelemedicineSheet] = useState(false);

  useEffect(() => { loadProfile(); }, []);

  async function loadProfile() {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!session || !user) { setLoading(false); return; }
    setUserId(user.id);

    try {
      const res = await fetch(`${API_BASE}/profile`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const raw = await res.text();
      let data: any = null;
      try { data = JSON.parse(raw); } catch { data = null; }

      const p = data?.profile;
      if (res.ok && p) {
        setProfile({
          full_name: p.full_name ?? user.user_metadata?.full_name ?? 'Usuário',
          email: p.email ?? user.email ?? '',
          city: p.city ?? '',
          phone: p.phone ?? '',
          role: p.role ?? user.user_metadata?.role ?? 'client',
        });
      } else {
        setProfile({
          full_name: user.user_metadata?.full_name ?? 'Usuário',
          email: user.email ?? '',
          city: '',
          phone: '',
          role: user.user_metadata?.role ?? 'client',
        });
      }
    } catch {
      setProfile({
        full_name: user.user_metadata?.full_name ?? 'Usuário',
        email: user.email ?? '',
        city: '',
        phone: '',
        role: user.user_metadata?.role ?? 'client',
      });
    }
    // Telemedicina — fire-and-forget, não bloqueia o perfil
    fetch(`${API_BASE}/telemedicine/config`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setTelemedicine(d); })
      .catch(() => {});

    setLoading(false);
  }

  async function handleTelemedicineAccess() {
    if (!telemedicine?.access_url) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      fetch(`${API_BASE}/telemedicine/access-log`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_role: 'client' }),
      }).catch(() => {});
    }
    Linking.openURL(telemedicine.access_url).catch(() => Alert.alert('Erro', 'Não foi possível abrir o link.'));
    setShowTelemedicineSheet(false);
  }

  function openEdit() {
    setEditName(profile?.full_name ?? '');
    setEditPhone(profile?.phone ?? '');
    setEditCity(profile?.city ?? '');
    setSaveError('');
    setEditVisible(true);
  }

  async function handleSave() {
    if (!editName.trim() || !editPhone.trim() || !editCity.trim()) {
      setSaveError('Preencha todos os campos.');
      return;
    }
    if (!userId) return;
    setSaving(true);
    setSaveError('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setSaveError('Sessão expirada. Faça login novamente.'); setSaving(false); return; }

      const res = await fetch(`${API_BASE}/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          userId,
          fullName: editName.trim(),
          phone: editPhone.trim(),
          city: editCity.trim(),
        }),
      });

      const raw = await res.text();
      let data: any = null;
      try { data = JSON.parse(raw); } catch { data = null; }

      if (!res.ok) {
        setSaveError(data?.message ?? 'Não foi possível salvar. Tente novamente.');
        setSaving(false);
        return;
      }

      setProfile((prev) => prev
        ? { ...prev, full_name: editName.trim(), phone: editPhone.trim(), city: editCity.trim() }
        : prev);
      setEditVisible(false);
    } catch {
      setSaveError('Erro de conexão. Tente novamente.');
    }
    setSaving(false);
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

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Perfil</Text>
        <TouchableOpacity style={styles.editBtn} onPress={openEdit}>
          <Ionicons name="create-outline" size={20} color={Colors.primary} />
          <Text style={styles.editBtnText}>Editar</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.avatarCard}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <Text style={styles.userName}>{profile?.full_name ?? 'Usuário'}</Text>
          <Text style={styles.userEmail}>{profile?.email ?? ''}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>{getRoleLabel(profile?.role ?? 'client')}</Text>
          </View>
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoCardTitle}>Informações</Text>
          <InfoRow icon="mail-outline" label="E-mail" value={profile?.email ?? '—'} />
          <InfoRow icon="call-outline" label="Telefone" value={profile?.phone || '—'} />
          <InfoRow icon="location-outline" label="Cidade" value={profile?.city || '—'} />
          <InfoRow icon="shield-checkmark-outline" label="Tipo de conta" value={getRoleLabel(profile?.role ?? 'client')} isLast />
        </View>

        {telemedicine && telemedicine.partner_name ? (
          telemedicine.verified ? (
            <TouchableOpacity style={styles.telemedicineCard} onPress={() => setShowTelemedicineSheet(true)} activeOpacity={0.85}>
              <View style={styles.telemedicineIcon}>
                <Ionicons name="medkit-outline" size={24} color="#0EA5E9" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.telemedicineTitle}>{telemedicine.partner_name}</Text>
                <Text style={styles.telemedicineDesc} numberOfLines={2}>{telemedicine.partner_description}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
            </TouchableOpacity>
          ) : (
            <View style={styles.telemedicineCardBlocked}>
              <View style={[styles.telemedicineIcon, { backgroundColor: Colors.border }]}>
                <Ionicons name="medkit-outline" size={24} color={Colors.textSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.telemedicineTitle, { color: Colors.textSecondary }]}>{telemedicine.partner_name}</Text>
                <Text style={styles.telemedicineBlockedDesc}>Disponível apenas para usuários verificados.</Text>
                <TouchableOpacity onPress={() => router.push('/identity-verification' as any)}>
                  <Text style={styles.telemedicineVerifyLink}>Complete sua verificação para acessar →</Text>
                </TouchableOpacity>
              </View>
            </View>
          )
        ) : null}

        {/* Bottom sheet telemedicina */}
        <Modal visible={showTelemedicineSheet} transparent animationType="slide" onRequestClose={() => setShowTelemedicineSheet(false)}>
          <TouchableOpacity style={styles.telemedicineOverlay} activeOpacity={1} onPress={() => setShowTelemedicineSheet(false)}>
            <View style={styles.telemedicineSheet}>
              <View style={styles.telemedicineSheetHandle} />
              <View style={styles.telemedicineSheetIcon}>
                <Ionicons name="medkit" size={36} color="#0EA5E9" />
              </View>
              <Text style={styles.telemedicineSheetTitle}>{telemedicine?.partner_name}</Text>
              <Text style={styles.telemedicineSheetDesc}>{telemedicine?.partner_description}</Text>
              <TouchableOpacity style={styles.telemedicineAccessBtn} onPress={handleTelemedicineAccess}>
                <Ionicons name="open-outline" size={18} color={Colors.cardWhite} />
                <Text style={styles.telemedicineAccessTxt}>Acessar agora</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowTelemedicineSheet(false)}>
                <Text style={styles.telemedicineCancelTxt}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>

        <TouchableOpacity style={styles.faqBtn} onPress={() => router.push('/(tabs)/faq' as any)}>
          <Ionicons name="help-circle-outline" size={22} color={Colors.primary} />
          <Text style={styles.faqBtnText}>FAQ e Suporte</Text>
          <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
        </TouchableOpacity>

        <View style={styles.themeCard}>
          <View style={styles.themeLeft}>
            <Ionicons name={isDark ? 'moon' : 'sunny-outline'} size={20} color={isDark ? '#818CF8' : Colors.warningAmber} />
            <View>
              <Text style={styles.themeTitle}>{isDark ? 'Modo escuro ativo' : 'Modo claro ativo'}</Text>
              <Text style={styles.themeDesc}>Toque para alternar o tema do app</Text>
            </View>
          </View>
          <Switch
            value={isDark}
            onValueChange={toggleTheme}
            trackColor={{ false: Colors.border, true: '#818CF8' }}
            thumbColor={Colors.cardWhite}
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

            <ScrollView showsVerticalScrollIndicator={false}>
              <EditField label="Nome completo" icon="person-outline" value={editName} onChangeText={setEditName} placeholder="Seu nome" />
              <EditField label="Telefone" icon="call-outline" value={editPhone} onChangeText={setEditPhone} placeholder="(11) 99999-9999" keyboardType="phone-pad" />
              <EditField label="Cidade" icon="location-outline" value={editCity} onChangeText={setEditCity} placeholder="Sua cidade" />

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
        <Ionicons name={icon as 'mail-outline'} size={18} color={Colors.primary} />
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
  placeholder?: string; keyboardType?: 'default' | 'phone-pad' | 'email-address';
  secureTextEntry?: boolean;
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
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.cardWhite,
  },
  headerTitle: { fontSize: 24, fontWeight: '700', color: Colors.textPrimary },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 6 },
  editBtnText: { fontSize: 14, fontWeight: '600', color: Colors.primary },
  content: { padding: 20, gap: 16 },
  avatarCard: {
    backgroundColor: Colors.cardWhite, borderRadius: 16, padding: 24,
    alignItems: 'center', shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  avatarCircle: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center', marginBottom: 12,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  avatarText: { fontSize: 28, fontWeight: '700', color: Colors.cardWhite },
  userName: { fontSize: 20, fontWeight: '700', color: Colors.textPrimary, marginBottom: 4, textAlign: 'center' },
  userEmail: { fontSize: 14, color: Colors.textSecondary, marginBottom: 12, textAlign: 'center' },
  roleBadge: {
    backgroundColor: '#FFF4EE', borderRadius: 20, paddingHorizontal: 16,
    paddingVertical: 6, borderWidth: 1, borderColor: Colors.primary,
  },
  roleText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  infoCard: {
    backgroundColor: Colors.cardWhite, borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  infoCardTitle: {
    fontSize: 14, fontWeight: '700', color: Colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12,
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  infoRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  infoRowIcon: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFF4EE',
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  infoRowContent: { flex: 1 },
  infoRowLabel: { fontSize: 12, color: Colors.textSecondary, marginBottom: 2 },
  infoRowValue: { fontSize: 15, fontWeight: '500', color: Colors.textPrimary },
  faqBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.cardWhite, borderRadius: 14, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  faqBtnText: { flex: 1, fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  themeCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.cardWhite, borderRadius: 14, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  themeLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  themeTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  themeDesc: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  signOutButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#FEF2F2', borderWidth: 1.5, borderColor: Colors.dangerRed,
    borderRadius: 12, height: 52,
  },
  buttonDisabled: { opacity: 0.7 },
  signOutText: { fontSize: 15, fontWeight: '700', color: Colors.dangerRed },
  // Modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalSheet: {
    backgroundColor: Colors.cardWhite, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40, maxHeight: '85%',
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border,
    alignSelf: 'center', marginBottom: 20,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: Colors.textPrimary },
  fieldGroup: { marginBottom: 16 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: Colors.textPrimary, marginBottom: 6 },
  fieldWrapper: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: Colors.border,
    borderRadius: 10, backgroundColor: Colors.background, paddingHorizontal: 12, height: 46,
  },
  fieldIcon: { marginRight: 8 },
  fieldInput: { flex: 1, fontSize: 15, color: Colors.textPrimary },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FEF2F2', borderRadius: 8, padding: 12, marginBottom: 16,
  },
  errorText: { fontSize: 14, color: Colors.dangerRed, flex: 1 },
  saveButton: {
    backgroundColor: Colors.primary, borderRadius: 12, height: 52,
    justifyContent: 'center', alignItems: 'center', marginTop: 8,
  },
  saveButtonText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  telemedicineCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#F0F9FF', borderRadius: 14, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: '#BAE6FD',
  },
  telemedicineCardBlocked: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: Colors.background, borderRadius: 14, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: Colors.border,
  },
  telemedicineIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#E0F2FE', justifyContent: 'center', alignItems: 'center',
  },
  telemedicineTitle: { fontSize: 15, fontWeight: '700', color: '#0C4A6E', marginBottom: 2 },
  telemedicineDesc: { fontSize: 13, color: '#0369A1', lineHeight: 18 },
  telemedicineBlockedDesc: { fontSize: 13, color: Colors.textSecondary, marginBottom: 4 },
  telemedicineVerifyLink: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  telemedicineOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end',
  },
  telemedicineSheet: {
    backgroundColor: Colors.cardWhite, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: Platform.OS === 'ios' ? 44 : 28, alignItems: 'center', gap: 12,
  },
  telemedicineSheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, marginBottom: 8 },
  telemedicineSheetIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#E0F2FE', justifyContent: 'center', alignItems: 'center' },
  telemedicineSheetTitle: { fontSize: 20, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  telemedicineSheetDesc: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  telemedicineAccessBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#0EA5E9', borderRadius: 12, height: 52, width: '100%',
  },
  telemedicineAccessTxt: { fontSize: 16, fontWeight: '700', color: Colors.cardWhite },
  telemedicineCancelTxt: { fontSize: 14, color: Colors.textSecondary, paddingVertical: 8 },
});
