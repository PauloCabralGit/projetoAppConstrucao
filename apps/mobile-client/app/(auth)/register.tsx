import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';

const API_BASE = 'https://construconnect-api.orionsystem.workers.dev/v1';

type Role = 'client' | 'builder' | 'contractor';

const ROLES: { key: Role; label: string }[] = [
  { key: 'client', label: 'Cliente' },
  { key: 'builder', label: 'Pedreiro' },
  { key: 'contractor', label: 'Empreiteiro' },
];

export default function RegisterScreen() {
  const [role, setRole] = useState<Role>('client');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [document, setDocument] = useState('');
  const [password, setPassword] = useState('');
  const [specialties, setSpecialties] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [acceptsUrgent, setAcceptsUrgent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isProvider = role !== 'client';

  async function handleRegister() {
    if (!name.trim() || !email.trim() || !password.trim() || !phone.trim() || !city.trim()) {
      setError('Preencha todos os campos obrigatórios.');
      return;
    }
    setError('');
    setLoading(true);

    const { data, error: authError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          full_name: name.trim(),
          role,
        },
      },
    });

    if (authError || !data.user) {
      setLoading(false);
      setError(authError?.message ?? 'Erro ao criar conta.');
      return;
    }

    try {
      const body: Record<string, unknown> = {
        user_id: data.user.id,
        full_name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        city: city.trim(),
        document: document.trim(),
        role,
      };

      if (isProvider) {
        body.specialties = specialties.trim();
        body.company_name = companyName.trim();
        body.accepts_urgent = acceptsUrgent;
      }

      const response = await fetch(`${API_BASE}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const json = await response.json();
        setError(json?.message ?? 'Erro ao registrar perfil.');
        setLoading(false);
        return;
      }
    } catch {
      setError('Erro de conexão. Tente novamente.');
      setLoading(false);
      return;
    }

    setLoading(false);
    router.replace('/(tabs)/home');
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <View style={styles.logoCircle}>
              <Text style={styles.logoText}>CC</Text>
            </View>
            <Text style={styles.title}>Criar conta</Text>
            <Text style={styles.subtitle}>Junte-se ao ConstruConnect</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Tipo de conta</Text>
            <View style={styles.roleRow}>
              {ROLES.map((r) => (
                <TouchableOpacity
                  key={r.key}
                  style={[styles.rolePill, role === r.key && styles.rolePillActive]}
                  onPress={() => setRole(r.key)}
                >
                  <Text style={[styles.rolePillText, role === r.key && styles.rolePillTextActive]}>
                    {r.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sectionTitle}>Dados pessoais</Text>

            <InputField
              label="Nome completo"
              icon="person-outline"
              value={name}
              onChangeText={setName}
              placeholder="Seu nome completo"
            />
            <InputField
              label="E-mail"
              icon="mail-outline"
              value={email}
              onChangeText={setEmail}
              placeholder="seu@email.com"
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <InputField
              label="Telefone"
              icon="call-outline"
              value={phone}
              onChangeText={setPhone}
              placeholder="(11) 99999-9999"
              keyboardType="phone-pad"
            />
            <InputField
              label="Cidade"
              icon="location-outline"
              value={city}
              onChangeText={setCity}
              placeholder="Sua cidade"
            />
            <InputField
              label="CPF / CNPJ"
              icon="card-outline"
              value={document}
              onChangeText={setDocument}
              placeholder="000.000.000-00"
              keyboardType="numeric"
            />
            <InputField
              label="Senha"
              icon="lock-closed-outline"
              value={password}
              onChangeText={setPassword}
              placeholder="Mínimo 6 caracteres"
              secureTextEntry
            />

            {isProvider && (
              <>
                <Text style={styles.sectionTitle}>Dados profissionais</Text>
                <InputField
                  label="Especialidades"
                  icon="construct-outline"
                  value={specialties}
                  onChangeText={setSpecialties}
                  placeholder="Ex: Alvenaria, Elétrica, Hidráulica"
                />
                <InputField
                  label="Nome da empresa (opcional)"
                  icon="business-outline"
                  value={companyName}
                  onChangeText={setCompanyName}
                  placeholder="Nome da sua empresa"
                />
                <View style={styles.switchRow}>
                  <View style={styles.switchInfo}>
                    <Ionicons name="flash-outline" size={20} color={Colors.warningAmber} />
                    <View style={styles.switchTextCol}>
                      <Text style={styles.switchLabel}>Aceita serviços urgentes</Text>
                      <Text style={styles.switchDesc}>Receba chamados com atendimento imediato</Text>
                    </View>
                  </View>
                  <Switch
                    value={acceptsUrgent}
                    onValueChange={setAcceptsUrgent}
                    trackColor={{ false: Colors.border, true: Colors.primary }}
                    thumbColor={Colors.cardWhite}
                  />
                </View>
              </>
            )}

            {error !== '' && (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle-outline" size={16} color={Colors.dangerRed} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
              onPress={handleRegister}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={Colors.cardWhite} />
              ) : (
                <Text style={styles.primaryButtonText}>Criar conta</Text>
              )}
            </TouchableOpacity>

            <View style={styles.loginRow}>
              <Text style={styles.loginText}>Já tem conta? </Text>
              <Link href="/(auth)/login" asChild>
                <TouchableOpacity>
                  <Text style={styles.loginLink}>Entrar</Text>
                </TouchableOpacity>
              </Link>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

interface InputFieldProps {
  label: string;
  icon: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'numeric';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  secureTextEntry?: boolean;
}

function InputField({
  label,
  icon,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  autoCapitalize = 'words',
  secureTextEntry = false,
}: InputFieldProps) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <View style={styles.inputWrapper}>
        <Ionicons name={icon as 'person-outline'} size={18} color={Colors.textSecondary} style={styles.inputIcon} />
        <TextInput
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={Colors.textSecondary}
          value={value}
          onChangeText={onChangeText}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          secureTextEntry={secureTextEntry}
          autoCorrect={false}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  flex: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logoCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  logoText: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.cardWhite,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  card: {
    backgroundColor: Colors.cardWhite,
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 16,
    marginBottom: 12,
  },
  roleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  rolePill: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 24,
    paddingVertical: 10,
    alignItems: 'center',
  },
  rolePillActive: {
    borderColor: Colors.primary,
    backgroundColor: '#FFF4EE',
  },
  rolePillText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  rolePillTextActive: {
    color: Colors.primary,
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    backgroundColor: Colors.background,
    paddingHorizontal: 12,
    height: 46,
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
    marginBottom: 14,
  },
  switchInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
  },
  switchTextCol: {
    flex: 1,
  },
  switchLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  switchDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    gap: 8,
  },
  errorText: {
    fontSize: 14,
    color: Colors.dangerRed,
    flex: 1,
  },
  primaryButton: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  primaryButtonDisabled: {
    opacity: 0.7,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.cardWhite,
    letterSpacing: 0.5,
  },
  loginRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 20,
    alignItems: 'center',
  },
  loginText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  loginLink: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primary,
  },
});
