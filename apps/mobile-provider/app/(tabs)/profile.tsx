import { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  Alert, Modal, TextInput, ScrollView, KeyboardAvoidingView, Platform, Switch, Image, Share, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';

import { API_BASE } from '@/lib/config';

interface PortfolioPhoto {
  id: string;
  url: string;
  caption?: string;
  category?: string;
}

interface Certification {
  id: string;
  name: string;
  url: string;
  issued_by?: string;
  issued_date?: string;
}

interface ProviderProfile {
  full_name: string;
  email: string;
  city: string;
  phone: string;
  company_name: string;
  accepts_emergency_jobs: boolean;
  accessibility_specialist: boolean;
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
  const { isDark, toggleTheme } = useTheme();
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
  const [editAccessibility, setEditAccessibility] = useState(false);
  const [editPixKey, setEditPixKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [portfolio, setPortfolio] = useState<PortfolioPhoto[]>([]);
  const [loadingPortfolio, setLoadingPortfolio] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [certifications, setCertifications] = useState<Certification[]>([]);
  const [loadingCerts, setLoadingCerts] = useState(false);
  const [certModalVisible, setCertModalVisible] = useState(false);
  const [certName, setCertName] = useState('');
  const [certIssuedBy, setCertIssuedBy] = useState('');
  const [certImageBase64, setCertImageBase64] = useState('');
  const [certImageName, setCertImageName] = useState('');
  const [uploadingCert, setUploadingCert] = useState(false);
  const [telemedicine, setTelemedicine] = useState<{ partner_name: string; partner_description: string; access_url?: string; verified: boolean } | null>(null);
  const [showTelemedicineSheet, setShowTelemedicineSheet] = useState(false);

  useEffect(() => { loadProfile(); }, []);
  useEffect(() => {
    if (userId) {
      loadPortfolio();
      loadCertifications();
    }
  }, [userId]);

  async function loadProfile() {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) { setLoading(false); return; }
    setUserId(user.id);

    let profileData: any = null;
    try {
      const res = await fetch(`${API_BASE}/profile`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const text = await res.text();
      try { profileData = JSON.parse(text)?.profile ?? null; } catch { profileData = null; }
    } catch {
      profileData = null;
    }

    const resolvedStatus = profileData?.status ?? 'available';

    setProfile({
      full_name: profileData?.full_name ?? user.user_metadata?.full_name ?? 'Prestador',
      email: profileData?.email ?? user.email ?? '',
      city: profileData?.city ?? '',
      phone: profileData?.phone ?? '',
      company_name: profileData?.company_name ?? '',
      accepts_emergency_jobs: profileData?.accepts_emergency_jobs ?? false,
      accessibility_specialist: profileData?.accessibility_specialist ?? false,
      status: 'available',
      specialties: profileData?.specialties ?? '',
      pix_key: profileData?.pix_key ?? '',
    });

    // Auto set online when app opens
    if (resolvedStatus !== 'available') {
      await supabase
        .from('provider_profiles')
        .update({ status: 'available' })
        .eq('user_id', user.id)
        .then(() => {});
    }

    // Telemedicina
    if (session?.access_token) {
      fetch(`${API_BASE}/telemedicine/config`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setTelemedicine(d); })
        .catch(() => {});
    }

    setLoading(false);
  }

  async function handleTelemedicineAccess() {
    if (!telemedicine?.access_url) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      fetch(`${API_BASE}/telemedicine/access-log`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_role: 'provider' }),
      }).catch(() => {});
    }
    Linking.openURL(telemedicine.access_url).catch(() => Alert.alert('Erro', 'Não foi possível abrir o link.'));
    setShowTelemedicineSheet(false);
  }

  function openEdit() {
    setEditName(profile?.full_name ?? '');
    setEditPhone(profile?.phone ?? '');
    setEditCity(profile?.city ?? '');
    setEditSpecialties(profile?.specialties ?? '');
    setEditCompany(profile?.company_name ?? '');
    setEditUrgent(profile?.accepts_emergency_jobs ?? false);
    setEditAccessibility(profile?.accessibility_specialist ?? false);
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
          companyName: editCompany.trim(),
          specialties: editSpecialties.trim(),
          acceptsEmergencyJobs: editUrgent,
          accessibilitySpecialist: editAccessibility,
          status: profile?.status ?? 'available',
          pixKey: editPixKey.trim(),
        }),
      });

      if (!res.ok) {
        let message = 'Não foi possível salvar. Tente novamente.';
        try { message = JSON.parse(await res.text())?.message ?? message; } catch { /* keep default */ }
        setSaveError(message);
        setSaving(false);
        return;
      }

      setProfile((prev) => prev ? {
        ...prev,
        full_name: editName.trim(),
        phone: editPhone.trim(),
        city: editCity.trim(),
        specialties: editSpecialties.trim(),
        company_name: editCompany.trim(),
        accepts_emergency_jobs: editUrgent,
        accessibility_specialist: editAccessibility,
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
    const newStatus = value ? 'available' : 'offline';
    try {
      const { error } = await supabase
        .from('provider_profiles')
        .update({ status: newStatus })
        .eq('user_id', userId);
      if (!error) {
        setProfile((prev) => prev ? { ...prev, status: newStatus } : prev);
      } else {
        Alert.alert('Erro', 'Não foi possível atualizar sua disponibilidade.');
      }
    } catch {
      Alert.alert('Erro', 'Erro de conexão.');
    }
    setTogglingAvailability(false);
  }

  async function loadPortfolio() {
    if (!userId) return;
    setLoadingPortfolio(true);
    try {
      const res = await fetch(`${API_BASE}/providers/${userId}/portfolio`);
      if (res.ok) {
        const data = await res.json();
        setPortfolio(data.photos ?? []);
      }
    } finally {
      setLoadingPortfolio(false);
    }
  }

  async function handleAddPortfolioPhoto() {
    if (!userId) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permissão negada', 'Permita o acesso à galeria.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7, base64: true });
    if (result.canceled || !result.assets[0].base64) return;

    setUploadingPhoto(true);
    try {
      const res = await fetch(`${API_BASE}/providers/${userId}/portfolio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_data: result.assets[0].base64, file_name: `portfolio_${Date.now()}.jpg`, mime_type: 'image/jpeg' }),
      });
      if (res.ok) {
        await loadPortfolio();
      } else {
        Alert.alert('Erro', 'Não foi possível enviar a foto.');
      }
    } catch {
      Alert.alert('Erro', 'Erro de conexão.');
    }
    setUploadingPhoto(false);
  }

  async function loadCertifications() {
    if (!userId) return;
    setLoadingCerts(true);
    try {
      const res = await fetch(`${API_BASE}/providers/${userId}/certifications`);
      if (res.ok) {
        const data = await res.json();
        setCertifications(data.certifications ?? []);
      }
    } finally {
      setLoadingCerts(false);
    }
  }

  async function handlePickCertImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permissão negada', 'Permita o acesso à galeria.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7, base64: true });
    if (result.canceled || !result.assets[0].base64) return;
    setCertImageBase64(result.assets[0].base64);
    setCertImageName(`cert_${Date.now()}.jpg`);
  }

  async function handleSubmitCertification() {
    if (!certName.trim()) { Alert.alert('Nome obrigatório', 'Digite o nome da certificação.'); return; }
    if (!certImageBase64) { Alert.alert('Imagem obrigatória', 'Selecione a foto da certificação.'); return; }
    if (!userId) return;
    setUploadingCert(true);
    try {
      const res = await fetch(`${API_BASE}/providers/${userId}/certifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_data: certImageBase64,
          file_name: certImageName,
          mime_type: 'image/jpeg',
          name: certName.trim(),
          issued_by: certIssuedBy.trim() || undefined,
        }),
      });
      if (res.ok) {
        await loadCertifications();
        setCertModalVisible(false);
        setCertName('');
        setCertIssuedBy('');
        setCertImageBase64('');
        setCertImageName('');
      } else {
        const json = await res.json();
        Alert.alert('Erro', json?.message ?? 'Não foi possível enviar.');
      }
    } catch {
      Alert.alert('Erro', 'Erro de conexão.');
    }
    setUploadingCert(false);
  }

  async function handleDeleteCertification(certId: string) {
    if (!userId) return;
    Alert.alert('Remover certificação', 'Deseja remover esta certificação?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover', style: 'destructive',
        onPress: async () => {
          await fetch(`${API_BASE}/providers/${userId}/certifications/${certId}`, { method: 'DELETE' }).catch(() => {});
          setCertifications((prev) => prev.filter((c) => c.id !== certId));
        },
      },
    ]);
  }

  async function handleDeletePortfolioPhoto(photoId: string) {
    if (!userId) return;
    Alert.alert('Remover foto', 'Deseja remover esta foto do portfólio?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover', style: 'destructive',
        onPress: async () => {
          await fetch(`${API_BASE}/providers/${userId}/portfolio/${photoId}`, { method: 'DELETE' }).catch(() => {});
          setPortfolio((prev) => prev.filter((p) => p.id !== photoId));
        },
      },
    ]);
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
          {profile?.accessibility_specialist ? (
            <View style={styles.accessibilityBadge}>
              <Ionicons name="accessibility-outline" size={14} color="#1D4ED8" />
              <Text style={styles.accessibilityBadgeText}>Especialista em Acessibilidade</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.availabilityCard}>
          <View style={styles.availabilityLeft}>
            <View style={[styles.availabilityDot, { backgroundColor: isAvailable ? Colors.successGreen : Colors.dangerRed }]} />
            <View>
              <Text style={styles.availabilityTitle}>{isAvailable ? 'Online — Disponível' : 'Offline'}</Text>
              <Text style={styles.availabilityDesc}>
                {isAvailable ? 'Recebendo chamados normalmente' : 'Toque para voltar a receber chamados'}
              </Text>
            </View>
          </View>
          {togglingAvailability
            ? <ActivityIndicator color={Colors.successGreen} />
            : <Switch
                value={isAvailable}
                onValueChange={handleToggleAvailability}
                trackColor={{ false: Colors.dangerRed, true: Colors.successGreen }}
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

        {/* Portfolio */}
        <View style={styles.portfolioCard}>
          <View style={styles.portfolioHeader}>
            <Text style={styles.portfolioTitle}>Portfólio</Text>
            <TouchableOpacity
              style={[styles.addPhotoBtn, uploadingPhoto && { opacity: 0.6 }]}
              onPress={handleAddPortfolioPhoto}
              disabled={uploadingPhoto}
            >
              {uploadingPhoto
                ? <ActivityIndicator size="small" color={Colors.cardWhite} />
                : <Ionicons name="add" size={18} color={Colors.cardWhite} />}
            </TouchableOpacity>
          </View>

          {loadingPortfolio ? (
            <ActivityIndicator color={Colors.primary} style={{ marginTop: 12 }} />
          ) : portfolio.length === 0 ? (
            <View style={styles.portfolioEmpty}>
              <Ionicons name="images-outline" size={32} color={Colors.border} />
              <Text style={styles.portfolioEmptyText}>Adicione fotos dos seus trabalhos{'\n'}para atrair mais clientes.</Text>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.portfolioRow}>
              {portfolio.map((photo) => (
                <View key={photo.id} style={styles.portfolioThumbWrap}>
                  <Image source={{ uri: photo.url }} style={styles.portfolioThumb} />
                  <TouchableOpacity
                    style={styles.portfolioDeleteBtn}
                    onPress={() => handleDeletePortfolioPhoto(photo.id)}
                  >
                    <Ionicons name="trash-outline" size={14} color={Colors.cardWhite} />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}
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
          <Ionicons name="help-circle-outline" size={22} color={Colors.darkNavy} />
          <Text style={styles.faqBtnText}>FAQ e Suporte</Text>
          <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
        </TouchableOpacity>

        {/* Dark Mode */}
        <View style={styles.availabilityCard}>
          <View style={styles.availabilityLeft}>
            <Ionicons name={isDark ? 'moon' : 'sunny-outline'} size={20} color={isDark ? '#818CF8' : Colors.warningAmber} />
            <View>
              <Text style={styles.availabilityTitle}>{isDark ? 'Modo escuro ativo' : 'Modo claro ativo'}</Text>
              <Text style={styles.availabilityDesc}>Toque para alternar o tema do app</Text>
            </View>
          </View>
          <Switch
            value={isDark}
            onValueChange={toggleTheme}
            trackColor={{ false: Colors.border, true: '#818CF8' }}
            thumbColor={Colors.cardWhite}
          />
        </View>

        {/* Certificações */}
        <View style={styles.portfolioCard}>
          <View style={styles.portfolioHeader}>
            <Text style={styles.portfolioTitle}>Certificações e Documentos</Text>
            <TouchableOpacity style={styles.addPhotoBtn} onPress={() => setCertModalVisible(true)}>
              <Ionicons name="add" size={18} color={Colors.cardWhite} />
            </TouchableOpacity>
          </View>

          {loadingCerts ? (
            <ActivityIndicator color={Colors.primary} style={{ marginTop: 12 }} />
          ) : certifications.length === 0 ? (
            <View style={styles.portfolioEmpty}>
              <Ionicons name="ribbon-outline" size={32} color={Colors.border} />
              <Text style={styles.portfolioEmptyText}>Adicione certificados, alvarás{'\n'}ou documentos profissionais.</Text>
            </View>
          ) : (
            <View style={styles.certList}>
              {certifications.map((cert) => (
                <View key={cert.id} style={styles.certItem}>
                  <View style={styles.certIcon}>
                    <Ionicons name="ribbon-outline" size={20} color={Colors.darkNavy} />
                  </View>
                  <View style={styles.certInfo}>
                    <Text style={styles.certName}>{cert.name}</Text>
                    {cert.issued_by ? <Text style={styles.certMeta}>Emitido por: {cert.issued_by}</Text> : null}
                  </View>
                  <TouchableOpacity onPress={() => handleDeleteCertification(cert.id)} hitSlop={10}>
                    <Ionicons name="trash-outline" size={18} color={Colors.dangerRed} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>

        <TouchableOpacity
          style={styles.shareProfileButton}
          onPress={() => Share.share({
            message: `${profile?.full_name ?? 'Prestador'} — ${profile?.specialties || profile?.company_name || 'ConstruConnect'}\n📍 ${profile?.city || ''}\n\nContrate via ConstruConnect!`,
            title: profile?.full_name ?? 'Meu perfil',
          })}
        >
          <Ionicons name="share-social-outline" size={20} color={Colors.darkNavy} />
          <Text style={styles.shareProfileText}>Compartilhar meu perfil</Text>
        </TouchableOpacity>

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

      {/* Certification Modal */}
      <Modal visible={certModalVisible} animationType="slide" transparent onRequestClose={() => setCertModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Nova Certificação</Text>
              <TouchableOpacity onPress={() => setCertModalVisible(false)} hitSlop={12}>
                <Ionicons name="close" size={24} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <EditField
                label="Nome da certificação"
                icon="ribbon-outline"
                value={certName}
                onChangeText={setCertName}
                placeholder="Ex: NR-35, CREA, Alvará..."
              />
              <EditField
                label="Emitido por (opcional)"
                icon="business-outline"
                value={certIssuedBy}
                onChangeText={setCertIssuedBy}
                placeholder="Ex: SENAI, MTE, Prefeitura..."
              />
              <TouchableOpacity style={styles.certPickImageBtn} onPress={handlePickCertImage}>
                <Ionicons name={certImageBase64 ? 'checkmark-circle' : 'image-outline'} size={20} color={certImageBase64 ? Colors.successGreen : Colors.darkNavy} />
                <Text style={[styles.certPickImageText, certImageBase64 && { color: Colors.successGreen }]}>
                  {certImageBase64 ? 'Imagem selecionada' : 'Selecionar foto / documento'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveButton, uploadingCert && styles.buttonDisabled]}
                onPress={handleSubmitCertification}
                disabled={uploadingCert}
              >
                {uploadingCert
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.saveButtonText}>Salvar certificação</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

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

              <View style={styles.switchRow}>
                <View style={styles.switchLeft}>
                  <Ionicons name="accessibility-outline" size={20} color="#1D4ED8" />
                  <View>
                    <Text style={styles.switchLabel}>Especialista em Acessibilidade</Text>
                    <Text style={styles.switchDesc}>Rampas, barras de apoio, adaptações para PcD</Text>
                  </View>
                </View>
                <Switch
                  value={editAccessibility}
                  onValueChange={setEditAccessibility}
                  trackColor={{ false: Colors.border, true: '#3B82F6' }}
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
  accessibilityBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#EFF6FF',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: '#BFDBFE', maxWidth: '90%',
  },
  accessibilityBadgeText: { fontSize: 13, fontWeight: '600', color: '#1D4ED8' },
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
  portfolioCard: {
    backgroundColor: Colors.cardWhite,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  portfolioHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  portfolioTitle: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8 },
  addPhotoBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  portfolioEmpty: { alignItems: 'center', gap: 8, paddingVertical: 16 },
  portfolioEmptyText: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  portfolioRow: { gap: 10, paddingRight: 4 },
  portfolioThumbWrap: { position: 'relative', borderRadius: 10, overflow: 'hidden' },
  portfolioThumb: { width: 90, height: 90, borderRadius: 10 },
  portfolioDeleteBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  faqBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.cardWhite, borderRadius: 14, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  faqBtnText: { flex: 1, fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  certList: { gap: 8 },
  certItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.background, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: Colors.border,
  },
  certIcon: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#EFF3F8',
    justifyContent: 'center', alignItems: 'center',
  },
  certInfo: { flex: 1 },
  certName: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  certMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  certPickImageBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1.5, borderColor: Colors.darkNavy, borderRadius: 10,
    padding: 14, marginBottom: 16, borderStyle: 'dashed',
  },
  certPickImageText: { fontSize: 14, fontWeight: '600', color: Colors.darkNavy },
  shareProfileButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.cardWhite, borderWidth: 1.5, borderColor: Colors.darkNavy,
    borderRadius: 12, height: 52,
  },
  shareProfileText: { fontSize: 15, fontWeight: '700', color: Colors.darkNavy },
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
