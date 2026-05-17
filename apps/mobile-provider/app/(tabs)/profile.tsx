import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';

interface ProviderProfile {
  full_name: string;
  email: string;
  city: string;
  phone: string;
  specialties: string;
  is_available: boolean;
}

function getInitials(name: string): string {
  const parts = name.trim().split(' ');
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export default function ProviderProfileScreen() {
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [togglingAvailability, setTogglingAvailability] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    setUserId(user.id);

    const { data } = await supabase
      .from('profiles')
      .select('full_name, email, city, phone, specialties, is_available')
      .eq('id', user.id)
      .single();

    if (data) {
      setProfile(data as ProviderProfile);
    } else {
      setProfile({
        full_name: user.user_metadata?.full_name ?? 'Prestador',
        email: user.email ?? '',
        city: '',
        phone: '',
        specialties: '',
        is_available: false,
      });
    }
    setLoading(false);
  }

  async function handleToggleAvailability(value: boolean) {
    if (!userId) return;
    setTogglingAvailability(true);

    const { error } = await supabase
      .from('profiles')
      .update({ is_available: value })
      .eq('id', userId);

    setTogglingAvailability(false);
    if (!error) {
      setProfile((prev) => prev ? { ...prev, is_available: value } : prev);
    } else {
      Alert.alert('Erro', 'Não foi possível atualizar sua disponibilidade.');
    }
  }

  async function handleSignOut() {
    Alert.alert(
      'Sair da conta',
      'Tem certeza que deseja sair?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sair',
          style: 'destructive',
          onPress: async () => {
            setSigningOut(true);
            await supabase.auth.signOut();
            setSigningOut(false);
            router.replace('/(auth)/login');
          },
        },
      ]
    );
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
  const isAvailable = profile?.is_available ?? false;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.headerBanner}>
        <Text style={styles.headerTitle}>Meu Perfil</Text>
      </View>

      <View style={styles.content}>
        <View style={styles.avatarCard}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <Text style={styles.userName}>{profile?.full_name ?? 'Prestador'}</Text>
          <Text style={styles.userEmail}>{profile?.email ?? ''}</Text>
          {profile?.specialties ? (
            <View style={styles.specialtiesBadge}>
              <Ionicons name="construct-outline" size={14} color={Colors.darkNavy} />
              <Text style={styles.specialtiesText} numberOfLines={1}>
                {profile.specialties}
              </Text>
            </View>
          ) : null}

          <View style={styles.ratingRow}>
            <Ionicons name="star" size={16} color={Colors.warningAmber} />
            <Text style={styles.ratingText}>4.9</Text>
            <Text style={styles.ratingSubtext}> • Avaliação média</Text>
          </View>
        </View>

        <View style={styles.availabilityCard}>
          <View style={styles.availabilityLeft}>
            <View style={[styles.availabilityDot, { backgroundColor: isAvailable ? Colors.successGreen : Colors.textSecondary }]} />
            <View>
              <Text style={styles.availabilityTitle}>
                {isAvailable ? 'Disponível' : 'Ocupado'}
              </Text>
              <Text style={styles.availabilityDesc}>
                {isAvailable
                  ? 'Você está recebendo chamados'
                  : 'Você não está recebendo chamados'}
              </Text>
            </View>
          </View>
          {togglingAvailability ? (
            <ActivityIndicator color={Colors.successGreen} />
          ) : (
            <Switch
              value={isAvailable}
              onValueChange={handleToggleAvailability}
              trackColor={{ false: Colors.border, true: Colors.successGreen }}
              thumbColor={Colors.cardWhite}
            />
          )}
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoCardTitle}>Informações</Text>

          <InfoRow icon="mail-outline" label="E-mail" value={profile?.email ?? '—'} />
          <InfoRow icon="call-outline" label="Telefone" value={profile?.phone || '—'} />
          <InfoRow icon="location-outline" label="Cidade" value={profile?.city || '—'} />
          <InfoRow icon="construct-outline" label="Especialidades" value={profile?.specialties || '—'} isLast />
        </View>

        <TouchableOpacity
          style={[styles.signOutButton, signingOut && styles.signOutButtonDisabled]}
          onPress={handleSignOut}
          disabled={signingOut}
        >
          {signingOut ? (
            <ActivityIndicator color={Colors.dangerRed} />
          ) : (
            <>
              <Ionicons name="log-out-outline" size={20} color={Colors.dangerRed} />
              <Text style={styles.signOutText}>Sair da conta</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

interface InfoRowProps {
  icon: string;
  label: string;
  value: string;
  isLast?: boolean;
}

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

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerBanner: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.darkNavy,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.cardWhite,
  },
  content: {
    flex: 1,
    padding: 20,
    gap: 14,
  },
  avatarCard: {
    backgroundColor: Colors.cardWhite,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  avatarCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: Colors.darkNavy,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: Colors.darkNavy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  avatarText: {
    fontSize: 26,
    fontWeight: '700',
    color: Colors.cardWhite,
  },
  userName: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 4,
    textAlign: 'center',
  },
  userEmail: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 10,
    textAlign: 'center',
  },
  specialtiesBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.background,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 10,
    maxWidth: '90%',
  },
  specialtiesText: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.darkNavy,
    flex: 1,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginLeft: 4,
  },
  ratingSubtext: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  availabilityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.cardWhite,
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  availabilityLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  availabilityDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  availabilityTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  availabilityDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  infoCard: {
    backgroundColor: Colors.cardWhite,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  infoCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  infoRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  infoRowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EFF3F8',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  infoRowContent: {
    flex: 1,
  },
  infoRowLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 2,
  },
  infoRowValue: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.textPrimary,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1.5,
    borderColor: Colors.dangerRed,
    borderRadius: 12,
    height: 52,
  },
  signOutButtonDisabled: {
    opacity: 0.7,
  },
  signOutText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.dangerRed,
  },
});
