import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, TextInput, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';

const API_BASE = 'https://construconnect-api.orionsystem.workers.dev/v1';

interface Rating {
  label: string;
  value: number;
  icon: keyof typeof Ionicons.glyphMap;
}

interface Question {
  key: 'overall_rating' | 'punctuality' | 'behavior' | 'cleanliness' | 'material_quality';
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const QUESTIONS: Question[] = [
  { key: 'overall_rating', label: 'Avaliação geral', description: 'Como foi o serviço em geral?', icon: 'star-outline' },
  { key: 'punctuality', label: 'Pontualidade', description: 'O prestador chegou no horário combinado?', icon: 'time-outline' },
  { key: 'behavior', label: 'Comportamento', description: 'Profissionalismo e educação do prestador', icon: 'thumbs-up-outline' },
  { key: 'cleanliness', label: 'Limpeza', description: 'Local deixado limpo após o serviço?', icon: 'water-outline' },
  { key: 'material_quality', label: 'Qualidade de materiais', description: 'Qualidade dos materiais utilizados', icon: 'layers-outline' },
];

export default function ReportScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [existing, setExisting] = useState<any>(null);

  const [ratings, setRatings] = useState<Record<string, number>>({
    overall_rating: 0,
    punctuality: 0,
    behavior: 0,
    cleanliness: 0,
    material_quality: 0,
  });

  const [estimatedTime, setEstimatedTime] = useState('');
  const [actualTime, setActualTime] = useState('');
  const [comments, setComments] = useState('');
  const [issues, setIssues] = useState('');

  useEffect(() => {
    loadExisting();
  }, [id]);

  async function loadExisting() {
    if (!id) return;
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(`${API_BASE}/service-requests/${id}/report`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (res.ok) {
        const raw = await res.text();
        const data = raw ? JSON.parse(raw) : {};
        if (data.report) {
          setExisting(data.report);
          setRatings({
            overall_rating: data.report.overall_rating || 0,
            punctuality: data.report.punctuality || 0,
            behavior: data.report.behavior || 0,
            cleanliness: data.report.cleanliness || 0,
            material_quality: data.report.material_quality || 0,
          });
          setEstimatedTime(String(data.report.estimated_time || ''));
          setActualTime(String(data.report.actual_time || ''));
          setComments(data.report.comments || '');
          setIssues(data.report.issues_found || '');
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    const allRated = Object.values(ratings).every(r => r > 0);
    if (!allRated) {
      Alert.alert('Campos obrigatórios', 'Preencha todas as avaliações.');
      return;
    }

    if (!id) {
      Alert.alert('Erro', 'Chamado inválido.');
      return;
    }

    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        Alert.alert('Sessão expirada', 'Faça login novamente para enviar o relatório.');
        return;
      }

      const res = await fetch(`${API_BASE}/service-requests/${id}/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          overall_rating: ratings.overall_rating,
          punctuality: ratings.punctuality,
          behavior: ratings.behavior,
          cleanliness: ratings.cleanliness,
          material_quality: ratings.material_quality,
          estimated_time: estimatedTime ? parseInt(estimatedTime, 10) : undefined,
          actual_time: actualTime ? parseInt(actualTime, 10) : undefined,
          comments: comments.trim() || undefined,
          issues_found: issues.trim() || undefined,
        }),
      });

      // Guard JSON parsing: the server may return non-JSON (e.g. an HTML 500
      // page or empty body), which would make res.json() throw and mask the
      // real status. Read as text first, then parse defensively.
      const raw = await res.text();
      let parsed: any = null;
      if (raw) {
        try { parsed = JSON.parse(raw); } catch { parsed = null; }
      }

      if (!res.ok) {
        const serverMessage =
          parsed?.message ||
          (raw && raw.length < 300 ? raw : '') ||
          `Erro ${res.status} ao salvar relatório`;
        throw new Error(serverMessage);
      }

      Alert.alert('✅ Sucesso', 'Relatório salvo com sucesso!', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      Alert.alert('Erro', err?.message || 'Falha ao salvar');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={s.container}>
        <ActivityIndicator style={{ flex: 1 }} color={Colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.scroll}>

        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
          </TouchableOpacity>
          <Text style={s.title}>Relatório do Serviço</Text>
        </View>

        {existing && (
          <View style={s.infoBox}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.successGreen} />
            <Text style={s.infoText}>Relatório já preenchido. Atualize as informações se necessário.</Text>
          </View>
        )}

        {/* Ratings */}
        {QUESTIONS.map((q) => (
          <View key={q.key} style={s.questionCard}>
            <View style={s.questionHeader}>
              <Ionicons name={q.icon} size={18} color={Colors.primary} />
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={s.questionLabel}>{q.label}</Text>
                <Text style={s.questionDesc}>{q.description}</Text>
              </View>
            </View>

            {/* Star rating */}
            <View style={s.starsRow}>
              {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity
                  key={star}
                  onPress={() => setRatings(prev => ({ ...prev, [q.key]: star }))}
                  style={s.starBtn}
                >
                  <Ionicons
                    name={star <= ratings[q.key] ? 'star' : 'star-outline'}
                    size={28}
                    color={star <= ratings[q.key] ? Colors.primary : Colors.border}
                  />
                </TouchableOpacity>
              ))}
            </View>

            {/* Rating label */}
            {ratings[q.key] > 0 && (
              <Text style={[s.ratingLabel, { color: getRatingColor(ratings[q.key]) }]}>
                {getRatingLabel(ratings[q.key])}
              </Text>
            )}
          </View>
        ))}

        {/* Time inputs */}
        <View style={s.timeSection}>
          <Text style={s.sectionTitle}>Tempo gasto</Text>

          <View style={s.timeRow}>
            <View style={s.timeInput}>
              <Text style={s.timeLabel}>Tempo estimado (min)</Text>
              <TextInput
                style={s.input}
                placeholder="Ex: 120"
                value={estimatedTime}
                onChangeText={setEstimatedTime}
                keyboardType="number-pad"
                placeholderTextColor={Colors.border}
              />
            </View>

            <View style={s.timeInput}>
              <Text style={s.timeLabel}>Tempo real (min)</Text>
              <TextInput
                style={s.input}
                placeholder="Ex: 150"
                value={actualTime}
                onChangeText={setActualTime}
                keyboardType="number-pad"
                placeholderTextColor={Colors.border}
              />
            </View>
          </View>
        </View>

        {/* Comments */}
        <View style={s.textSection}>
          <Text style={s.sectionTitle}>Observações gerais</Text>
          <TextInput
            style={[s.input, s.textArea]}
            placeholder="Deixe seus comentários sobre o serviço..."
            placeholderTextColor={Colors.border}
            value={comments}
            onChangeText={setComments}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        {/* Issues */}
        <View style={s.textSection}>
          <Text style={s.sectionTitle}>Problemas identificados (se houver)</Text>
          <TextInput
            style={[s.input, s.textArea]}
            placeholder="Descreva qualquer problema encontrado..."
            placeholderTextColor={Colors.border}
            value={issues}
            onChangeText={setIssues}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>

        {/* Submit Button */}
        <TouchableOpacity
          style={[s.submitBtn, submitting && s.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={s.submitBtnText}>
              {existing ? 'Atualizar Relatório' : 'Enviar Relatório'}
            </Text>
          )}
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

function getRatingColor(rating: number): string {
  if (rating <= 2) return '#EF4444';
  if (rating <= 3) return '#F59E0B';
  return Colors.successGreen;
}

function getRatingLabel(rating: number): string {
  const labels = ['', 'Ruim', 'Fraco', 'Bom', 'Muito bom', 'Excelente'];
  return labels[rating] || '';
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 16, paddingBottom: 40 },

  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 12 },
  title: { fontSize: 20, fontWeight: '700', color: Colors.textPrimary, flex: 1 },

  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  infoText: { flex: 1, fontSize: 12, color: Colors.successGreen, fontWeight: '500' },

  questionCard: {
    backgroundColor: Colors.cardWhite,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  questionHeader: { flexDirection: 'row', marginBottom: 12 },
  questionLabel: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  questionDesc: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },

  starsRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 8 },
  starBtn: { padding: 4 },
  ratingLabel: { textAlign: 'center', fontSize: 12, fontWeight: '600', marginTop: 4 },

  timeSection: { marginBottom: 20 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, marginBottom: 12 },
  timeRow: { flexDirection: 'row', gap: 12 },
  timeInput: { flex: 1 },
  timeLabel: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500', marginBottom: 6 },

  textSection: { marginBottom: 20 },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: Colors.textPrimary,
    backgroundColor: Colors.background,
  },
  textArea: { minHeight: 100, paddingTop: 12 },

  submitBtn: {
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 30,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
