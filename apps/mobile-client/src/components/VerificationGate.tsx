import { useEffect, useState, useCallback } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';

const API_BASE = 'https://construconnect-api.orionsystem.workers.dev/v1';

type Status = 'loading' | 'unverified' | 'pending' | 'rejected' | 'approved';

// Gate de verificação de identidade. Enquanto o usuário logado não estiver
// "approved", bloqueia o app inteiro com um Modal: captura selfie + documento
// (RG/CNH) e envia para revisão manual do admin.
export function VerificationGate({ userId, role }: { userId: string | null; role: 'client' | 'provider' }) {
  const [status, setStatus] = useState<Status>('loading');
  const [adminNote, setAdminNote] = useState<string | null>(null);
  const [docType, setDocType] = useState<'rg' | 'cnh'>('rg');
  const [selfie, setSelfie] = useState<string | null>(null);
  const [document, setDocument] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const authHeader = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session ? { Authorization: `Bearer ${session.access_token}` } : null;
  }, []);

  const loadStatus = useCallback(async () => {
    const headers = await authHeader();
    if (!headers) { setStatus('loading'); return; }
    try {
      const res = await fetch(`${API_BASE}/verifications/me`, { headers: headers as any });
      const data = await res.json();
      setStatus((data.status as Status) ?? 'unverified');
      setAdminNote(data.verification?.admin_note ?? null);
    } catch {
      setStatus('unverified');
    }
  }, [authHeader]);

  useEffect(() => {
    if (!userId) { setStatus('loading'); return; }
    setStatus('loading');
    loadStatus();
  }, [userId, loadStatus]);

  async function capture(which: 'selfie' | 'document') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permissão necessária', 'Permita o acesso à câmera para verificar sua identidade.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.6,
      base64: true,
      cameraType: which === 'selfie' ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]?.base64) {
      if (which === 'selfie') setSelfie(result.assets[0].base64);
      else setDocument(result.assets[0].base64);
    }
  }

  async function submit() {
    if (!selfie || !document) {
      Alert.alert('Faltam fotos', 'Tire a selfie e a foto do documento antes de enviar.');
      return;
    }
    setSubmitting(true);
    try {
      const headers = await authHeader();
      if (!headers) return;
      const res = await fetch(`${API_BASE}/verifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(headers as any) },
        body: JSON.stringify({ doc_type: docType, role, selfie_data: selfie, document_data: document }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any).message ?? 'Erro ao enviar.');
      setSelfie(null); setDocument(null);
      setStatus('pending');
    } catch (e: any) {
      Alert.alert('Erro', e.message ?? 'Erro ao enviar.');
    } finally {
      setSubmitting(false);
    }
  }

  // Não bloqueia sem usuário logado nem quando já aprovado.
  if (!userId || status === 'approved') return null;

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={st.container}>
        {status === 'loading' ? (
          <ActivityIndicator size="large" color={Colors.primary} />
        ) : status === 'pending' ? (
          <View style={st.center}>
            <Ionicons name="hourglass-outline" size={64} color={Colors.warningAmber} />
            <Text style={st.title}>Verificação em análise</Text>
            <Text style={st.body}>
              Recebemos seus documentos. Assim que um responsável aprovar, você poderá usar o app.
            </Text>
            <TouchableOpacity style={st.btnSecondary} onPress={loadStatus}>
              <Text style={st.btnSecondaryText}>Já fui aprovado? Atualizar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.logout} onPress={() => supabase.auth.signOut()}>
              <Text style={st.logoutText}>Sair da conta</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled">
            <Ionicons name="shield-checkmark-outline" size={56} color={Colors.primary} style={{ alignSelf: 'center' }} />
            <Text style={st.title}>Verificação de identidade</Text>
            <Text style={st.body}>
              Para sua segurança, confirme sua identidade: tire uma selfie e a foto de um documento com foto (RG ou CNH).
            </Text>

            {status === 'rejected' && (
              <View style={st.rejectedBox}>
                <Text style={st.rejectedTitle}>Verificação anterior reprovada</Text>
                {adminNote ? <Text style={st.rejectedNote}>Motivo: {adminNote}</Text> : null}
                <Text style={st.rejectedNote}>Reenvie com boa iluminação e dados legíveis.</Text>
              </View>
            )}

            <Text style={st.label}>Tipo de documento</Text>
            <View style={st.docRow}>
              {(['rg', 'cnh'] as const).map((t) => (
                <TouchableOpacity key={t} style={[st.docChip, docType === t && st.docChipActive]} onPress={() => setDocType(t)}>
                  <Text style={[st.docChipText, docType === t && st.docChipTextActive]}>{t.toUpperCase()}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <CaptureCard label="Selfie" icon="person-circle-outline" done={!!selfie} onPress={() => capture('selfie')} />
            <CaptureCard label={`Foto do ${docType.toUpperCase()}`} icon="card-outline" done={!!document} onPress={() => capture('document')} />

            <TouchableOpacity
              style={[st.btnPrimary, (!selfie || !document || submitting) && st.btnDisabled]}
              onPress={submit}
              disabled={!selfie || !document || submitting}
            >
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={st.btnPrimaryText}>Enviar para verificação</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={st.logout} onPress={() => supabase.auth.signOut()}>
              <Text style={st.logoutText}>Sair da conta</Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function CaptureCard({ label, icon, done, onPress }: { label: string; icon: any; done: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[st.capture, done && st.captureDone]} onPress={onPress}>
      <Ionicons name={done ? 'checkmark-circle' : icon} size={28} color={done ? Colors.successGreen : Colors.primary} />
      <Text style={st.captureText}>{done ? `${label} ✓` : label}</Text>
      <Ionicons name="camera-outline" size={20} color={Colors.textSecondary} />
    </TouchableOpacity>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, justifyContent: 'center', padding: 24 },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingVertical: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: '800', color: Colors.textPrimary, textAlign: 'center', marginTop: 12 },
  body: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, marginTop: 6, marginBottom: 8 },
  label: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary, marginTop: 8 },
  docRow: { flexDirection: 'row', gap: 10 },
  docChip: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center', backgroundColor: Colors.cardWhite },
  docChipActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '15' },
  docChipText: { fontSize: 15, fontWeight: '700', color: Colors.textSecondary },
  docChipTextActive: { color: Colors.primary },
  capture: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.border, borderStyle: 'dashed', backgroundColor: Colors.cardWhite },
  captureDone: { borderColor: Colors.successGreen, borderStyle: 'solid', backgroundColor: Colors.successGreen + '12' },
  captureText: { flex: 1, fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  btnPrimary: { backgroundColor: Colors.primary, paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 12 },
  btnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  btnDisabled: { opacity: 0.5 },
  btnSecondary: { marginTop: 20, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.primary },
  btnSecondaryText: { color: Colors.primary, fontWeight: '700', fontSize: 14 },
  rejectedBox: { backgroundColor: Colors.dangerRed + '12', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Colors.dangerRed + '40' },
  rejectedTitle: { color: Colors.dangerRed, fontWeight: '800', marginBottom: 4 },
  rejectedNote: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  logout: { marginTop: 16, alignItems: 'center', padding: 10 },
  logoutText: { color: Colors.textSecondary, fontSize: 13, textDecorationLine: 'underline' },
});
