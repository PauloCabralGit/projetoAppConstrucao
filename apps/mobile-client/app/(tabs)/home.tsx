import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  Dimensions,
  Platform,
  Image,
  Modal,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
let ExpoSpeechRecognitionModule: any = null;
let useSpeechRecognitionEvent: (event: string, handler: any) => void = () => {};
const speechAvailable = (() => {
  try {
    const mod = require('expo-speech-recognition');
    ExpoSpeechRecognitionModule = mod.ExpoSpeechRecognitionModule;
    useSpeechRecognitionEvent = mod.useSpeechRecognitionEvent;
    return true;
  } catch {
    return false;
  }
})();

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

import { API_BASE } from '@/lib/config';

const CATEGORIES = [
  { key: 'alvenaria', label: 'Alvenaria', icon: 'layers-outline' },
  { key: 'hidraulica', label: 'Hidráulica', icon: 'water-outline' },
  { key: 'eletrica', label: 'Elétrica', icon: 'flash-outline' },
  { key: 'pintura', label: 'Pintura', icon: 'color-palette-outline' },
  { key: 'piso', label: 'Piso', icon: 'grid-outline' },
  { key: 'acabamento', label: 'Acabamento', icon: 'hammer-outline' },
  { key: 'acessibilidade', label: 'Acessibilidade', icon: 'accessibility-outline' },
];

interface ProviderMarker {
  id: string;
  latitude?: number;
  longitude?: number;
  full_name: string;
  specialties: string;
  city?: string;
  accessibility_specialist?: boolean;
}

const DEFAULT_REGION: Region = {
  latitude: -23.5505,
  longitude: -46.6333,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

export default function HomeScreen() {
  const { colors } = useTheme();
  const { providerId, providerName, preCategory } = useLocalSearchParams<{ providerId?: string; providerName?: string; preCategory?: string }>();
  const mapRef = useRef<MapView>(null);
  const mapReadyRef = useRef(false);
  const pendingRegionRef = useRef<Region | null>(null);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);

  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [locationGranted, setLocationGranted] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [description, setDescription] = useState('');
  const [providers, setProviders] = useState<ProviderMarker[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [photos, setPhotos] = useState<{ uri: string; base64: string }[]>([]);
  const [scheduledDate, setScheduledDate] = useState<Date | null>(null);
  const [showScheduler, setShowScheduler] = useState(false);
  const [pickerDay, setPickerDay] = useState<number>(0);
  const [pickerTime, setPickerTime] = useState<string>('');
  const [listening, setListening] = useState(false);

  useEffect(() => {
    requestLocation();
    fetchProviders();
    const poll = setInterval(fetchProviders, 20000);
    return () => { locationSubRef.current?.remove(); clearInterval(poll); };
  }, []);

  useEffect(() => {
    if (preCategory) setSelectedCategory(preCategory);
  }, [preCategory]);

  useSpeechRecognitionEvent('result', useCallback((event: any) => {
    const transcript: string = event.results?.[0]?.transcript ?? '';
    if (transcript) {
      setDescription((prev) => {
        const separator = prev.trim() ? ' ' : '';
        return (prev + separator + transcript).slice(0, 500);
      });
    }
  }, []));

  useSpeechRecognitionEvent('end', useCallback(() => {
    setListening(false);
  }, []));

  useSpeechRecognitionEvent('error', useCallback(() => {
    setListening(false);
  }, []));

  async function handleVoiceInput() {
    if (listening) {
      ExpoSpeechRecognitionModule.stop();
      setListening(false);
      return;
    }
    const { granted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!granted) {
      Alert.alert('Permissão necessária', 'Ative o microfone nas configurações para usar a entrada por voz.');
      return;
    }
    setListening(true);
    ExpoSpeechRecognitionModule.start({ lang: 'pt-BR', interimResults: false, maxAlternatives: 1 });
  }

  function goToRegion(newRegion: Region) {
    setRegion(newRegion);
    if (mapReadyRef.current) {
      mapRef.current?.animateToRegion(newRegion, 600);
    } else {
      pendingRegionRef.current = newRegion;
    }
  }

  function handleMapReady() {
    mapReadyRef.current = true;
    if (pendingRegionRef.current) {
      mapRef.current?.animateToRegion(pendingRegionRef.current, 600);
      pendingRegionRef.current = null;
    }
  }

  async function requestLocation() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;
    setLocationGranted(true);

    // watchPositionAsync: first callback gives a real fix immediately
    locationSubRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, timeInterval: 10000, distanceInterval: 30 },
      (loc) => {
        const newRegion: Region = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          latitudeDelta: 0.03,
          longitudeDelta: 0.03,
        };
        goToRegion(newRegion);
        // Only animate on first fix; after that let user pan freely
        locationSubRef.current?.remove();
        locationSubRef.current = null;
      }
    );
  }

  async function pickPhoto() {
    Alert.alert('Adicionar foto', 'Como deseja adicionar?', [
      {
        text: 'Câmera',
        onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert('Permissão negada', 'Permita o acesso à câmera nas configurações do dispositivo.');
            return;
          }
          const result = await ImagePicker.launchCameraAsync({ quality: 0.7, base64: true });
          if (!result.canceled && result.assets[0].base64) {
            setPhotos((prev) => [...prev, { uri: result.assets[0].uri, base64: result.assets[0].base64! }]);
          }
        },
      },
      {
        text: 'Galeria',
        onPress: async () => {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert('Permissão negada', 'Permita o acesso à galeria nas configurações do dispositivo.');
            return;
          }
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.7,
            base64: true,
          });
          if (!result.canceled && result.assets[0].base64) {
            setPhotos((prev) => [...prev, { uri: result.assets[0].uri, base64: result.assets[0].base64! }]);
          }
        },
      },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  }

  async function uploadPhotos(requestId: string) {
    for (const photo of photos) {
      try {
        const res = await fetch(`${API_BASE}/photos/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            request_id: requestId,
            photo_type: 'client_request',
            file_data: photo.base64,
            file_name: `client_${Date.now()}.jpg`,
            mime_type: 'image/jpeg',
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          console.warn('[uploadPhotos] erro:', err);
        }
      } catch (e) {
        console.warn('[uploadPhotos] falha de rede:', e);
      }
    }
  }

  async function fetchProviders() {
    setLoadingProviders(true);
    try {
      const response = await fetch(`${API_BASE}/providers/available`);
      if (response.ok) {
        const data = await response.json();
        setProviders(data?.providers ?? []);
      }
    } catch {
      // Providers load silently
    } finally {
      setLoadingProviders(false);
    }
  }

  const TIME_SLOTS = [
    { label: 'Manhã (08h–12h)', hour: 8 },
    { label: 'Tarde (13h–17h)', hour: 13 },
    { label: 'Noite (18h–21h)', hour: 18 },
  ];

  function getDateOptions() {
    const days: { label: string; index: number; date: Date }[] = [];
    const now = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      const label = i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
      days.push({ label, index: i, date: d });
    }
    return days;
  }

  function confirmSchedule() {
    const opts = getDateOptions();
    const chosen = opts[pickerDay];
    const slot = TIME_SLOTS.find(t => t.label === pickerTime);
    if (!chosen || !slot) { Alert.alert('Selecione data e horário'); return; }
    const d = new Date(chosen.date);
    d.setHours(slot.hour, 0, 0, 0);
    setScheduledDate(d);
    setShowScheduler(false);
  }

  function formatScheduledDate(d: Date) {
    const slotLabel = TIME_SLOTS.find(t => t.hour === d.getHours())?.label.split(' ')[0] ?? '';
    return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }) + ' — ' + slotLabel;
  }

  async function handleRequestService() {
    if (!selectedCategory) {
      Alert.alert('Categoria obrigatória', 'Selecione o tipo de serviço desejado.');
      return;
    }
    if (!description.trim()) {
      Alert.alert('Descrição obrigatória', 'Descreva o serviço que precisa.');
      return;
    }

    setSubmitting(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSubmitting(false);
      router.replace('/(auth)/login');
      return;
    }

    try {
      const { data: profile } = await supabase
        .from('app_users')
        .select('city')
        .eq('id', user.id)
        .maybeSingle();
      const city = profile?.city ?? '';

      const scheduledStr = scheduledDate
        ? scheduledDate.toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];

      const { data: reqData, error: reqError } = await supabase
        .from('service_requests')
        .insert({
          client_user_id: user.id,
          category: selectedCategory,
          description: description.trim(),
          status: 'requested',
          city,
          budget_min: 0,
          budget_max: 0,
          scheduled_date: scheduledStr,
          latitude: region.latitude,
          longitude: region.longitude,
        })
        .select('id')
        .single();

      if (reqError) {
        Alert.alert('Erro', reqError.message);
        setSubmitting(false);
        return;
      }

      const requestId = reqData.id;

      if (photos.length > 0) {
        await uploadPhotos(requestId);
      }

      // Notifica prestadores via API (fire and forget)
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      fetch(`${API_BASE}/service-requests/${requestId}/notify-providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          category: selectedCategory,
          city,
          ...(providerId ? { preferred_provider_id: providerId } : {}),
        }),
      }).catch(() => {});

      setSubmitting(false);
      setSelectedCategory('');
      setDescription('');
      setPhotos([]);
      setScheduledDate(null);

      router.push(`/tracking/${requestId}`);
    } catch {
      Alert.alert('Erro de conexão', 'Verifique sua internet e tente novamente.');
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={DEFAULT_REGION}
        showsUserLocation={locationGranted}
        showsMyLocationButton={false}
        showsCompass={false}
        onMapReady={handleMapReady}
      >
        {providers.filter(p => p.latitude != null && p.longitude != null).map((p) => (
          <Marker
            key={p.id}
            coordinate={{ latitude: p.latitude!, longitude: p.longitude! }}
            title={p.full_name}
            description={p.accessibility_specialist ? `♿ Especialista em Acessibilidade • ${p.specialties}` : p.specialties}
          >
            <View style={[styles.providerMarker, p.accessibility_specialist && styles.providerMarkerAccessibility]}>
              <Ionicons
                name={p.accessibility_specialist ? 'accessibility' : 'construct'}
                size={16}
                color={Colors.cardWhite}
              />
            </View>
          </Marker>
        ))}
      </MapView>

      {locationGranted && (
        <TouchableOpacity
          style={styles.myLocationButton}
          onPress={async () => {
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
            if (!loc) return;
            goToRegion({ latitude: loc.coords.latitude, longitude: loc.coords.longitude, latitudeDelta: 0.03, longitudeDelta: 0.03 });
          }}
        >
          <Ionicons name="locate" size={22} color={Colors.primary} />
        </TouchableOpacity>
      )}

      <View style={[styles.bottomCard, { backgroundColor: colors.cardWhite }]}>
        <View style={[styles.bottomCardHandle, { backgroundColor: colors.border }]} />
        <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Solicitar serviço</Text>
        <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>Selecione a categoria</Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoriesScroll}
        >
          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat.key}
              style={[
                styles.categoryChip,
                selectedCategory === cat.key && styles.categoryChipActive,
              ]}
              onPress={() => setSelectedCategory(cat.key)}
              accessibilityRole="radio"
              accessibilityLabel={cat.label}
              accessibilityState={{ selected: selectedCategory === cat.key }}
            >
              <Ionicons
                name={cat.icon as 'layers-outline'}
                size={16}
                color={selectedCategory === cat.key ? Colors.cardWhite : Colors.primary}
              />
              <Text
                style={[
                  styles.categoryChipText,
                  selectedCategory === cat.key && styles.categoryChipTextActive,
                ]}
              >
                {cat.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Provider pre-selection banner */}
        {providerName ? (
          <View style={styles.providerBanner}>
            <Ionicons name="person-circle-outline" size={18} color={Colors.primary} />
            <Text style={styles.providerBannerText} numberOfLines={1}>
              Solicitando para: <Text style={{ fontWeight: '700' }}>{providerName}</Text>
            </Text>
            <TouchableOpacity
              hitSlop={8}
              onPress={() => router.setParams({ providerId: '', providerName: '' })}
            >
              <Ionicons name="close-circle" size={18} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={[styles.descriptionWrapper, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <TextInput
            style={[styles.descriptionInput, { color: colors.textPrimary }]}
            placeholder="Descreva o serviço que você precisa..."
            placeholderTextColor={colors.textSecondary}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
            maxLength={500}
            textAlignVertical="top"
            accessibilityLabel="Descrição do serviço"
            accessibilityHint="Descreva com detalhes o serviço que você precisa. Você pode usar o botão de microfone para ditar."
          />
          <View style={styles.descriptionFooter}>
            <Text style={[styles.charCount, { color: colors.textSecondary }]}>{description.length}/500</Text>
            {speechAvailable && (
              <TouchableOpacity
                onPress={handleVoiceInput}
                style={[styles.micBtn, listening && styles.micBtnActive]}
                accessibilityRole="button"
                accessibilityLabel={listening ? 'Parar gravação de voz' : 'Iniciar ditado por voz'}
                accessibilityHint="Dita a descrição do serviço usando o microfone"
              >
                <Ionicons
                  name={listening ? 'stop-circle' : 'mic-outline'}
                  size={22}
                  color={listening ? Colors.dangerRed : Colors.primary}
                />
              </TouchableOpacity>
            )}
          </View>
        </View>

        <View style={styles.photosSection}>
          <Text style={styles.photosSectionLabel}>Fotos do serviço (opcional)</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.photosRow}
          >
            {photos.map((p, i) => (
              <View key={i} style={styles.photoThumbWrap}>
                <Image source={{ uri: p.uri }} style={styles.photoThumb} />
                <TouchableOpacity
                  style={styles.removePhotoBtn}
                  onPress={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  <Ionicons name="close-circle" size={20} color={Colors.dangerRed} />
                </TouchableOpacity>
              </View>
            ))}
            {photos.length < 5 && (
              <TouchableOpacity style={styles.addPhotoBtn} onPress={pickPhoto}>
                <Ionicons name="camera-outline" size={22} color={Colors.primary} />
                <Text style={styles.addPhotoBtnText}>Foto</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>

        {/* Scheduling */}
        <TouchableOpacity
          style={styles.scheduleBtn}
          onPress={() => { setPickerDay(0); setPickerTime(''); setShowScheduler(true); }}
        >
          <Ionicons name="calendar-outline" size={18} color={Colors.primary} />
          <Text style={styles.scheduleBtnText} numberOfLines={1}>
            {scheduledDate ? formatScheduledDate(scheduledDate) : 'Agendar para uma data (opcional)'}
          </Text>
          {scheduledDate && (
            <TouchableOpacity hitSlop={8} onPress={() => setScheduledDate(null)}>
              <Ionicons name="close-circle" size={18} color={Colors.textSecondary} />
            </TouchableOpacity>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.searchButton, submitting && styles.searchButtonDisabled]}
          onPress={handleRequestService}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="Buscar profissional"
          accessibilityHint="Envia sua solicitação e busca profissionais disponíveis"
          accessibilityState={{ disabled: submitting, busy: submitting }}
        >
          {submitting ? (
            <ActivityIndicator color={Colors.cardWhite} />
          ) : (
            <>
              <Ionicons name="search" size={20} color={Colors.cardWhite} />
              <Text style={styles.searchButtonText}>Buscar profissional</Text>
            </>
          )}
        </TouchableOpacity>

        {loadingProviders && (
          <View style={styles.providersLoadingRow}>
            <ActivityIndicator size="small" color={Colors.textSecondary} />
            <Text style={styles.providersLoadingText}>Carregando profissionais...</Text>
          </View>
        )}
        {!loadingProviders && (
          <View style={styles.providersCountRow}>
            <View style={[styles.onlineDot, providers.length === 0 && { backgroundColor: Colors.textSecondary }]} />
            <Text style={styles.providersCountText}>
              {providers.length > 0
                ? `${providers.length} profissional${providers.length !== 1 ? 'is' : ''} disponível${providers.length !== 1 ? 'is' : ''}`
                : 'Nenhum profissional disponível no momento'}
            </Text>
          </View>
        )}
      </View>

      {/* Schedule modal */}
      <Modal visible={showScheduler} transparent animationType="slide" onRequestClose={() => setShowScheduler(false)}>
        <View style={styles.scheduleOverlay}>
          <View style={styles.scheduleSheet}>
            <View style={styles.scheduleHandle} />
            <Text style={styles.scheduleTitle}>Agendar serviço</Text>

            <Text style={styles.scheduleSection}>Data</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scheduleDaysRow}>
              {getDateOptions().map((opt) => (
                <TouchableOpacity
                  key={opt.index}
                  style={[styles.scheduleDayChip, pickerDay === opt.index && styles.scheduleDayChipActive]}
                  onPress={() => setPickerDay(opt.index)}
                >
                  <Text style={[styles.scheduleDayText, pickerDay === opt.index && styles.scheduleDayTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.scheduleSection}>Horário</Text>
            <View style={styles.scheduleTimesRow}>
              {TIME_SLOTS.map((slot) => (
                <TouchableOpacity
                  key={slot.label}
                  style={[styles.scheduleTimeChip, pickerTime === slot.label && styles.scheduleTimeChipActive]}
                  onPress={() => setPickerTime(slot.label)}
                >
                  <Text style={[styles.scheduleTimeText, pickerTime === slot.label && styles.scheduleTimeTextActive]}>
                    {slot.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.scheduleActions}>
              <TouchableOpacity style={styles.scheduleCancelBtn} onPress={() => setShowScheduler(false)}>
                <Text style={styles.scheduleCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.scheduleConfirmBtn, (!pickerTime) && { opacity: 0.5 }]}
                onPress={confirmSchedule}
                disabled={!pickerTime}
              >
                <Text style={styles.scheduleConfirmText}>Confirmar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  map: {
    width: '100%',
    height: SCREEN_HEIGHT,
    position: 'absolute',
  },
  providerMarker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.cardWhite,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  providerMarkerAccessibility: {
    backgroundColor: '#1D4ED8',
  },
  myLocationButton: {
    position: 'absolute',
    top: 56,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.cardWhite,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  bottomCard: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.cardWhite,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 36 : 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 16,
  },
  bottomCardHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  cardSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 12,
  },
  categoriesScroll: {
    paddingRight: 8,
    gap: 8,
    marginBottom: 16,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: '#FFF4EE',
  },
  categoryChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  categoryChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
  },
  categoryChipTextActive: {
    color: Colors.cardWhite,
  },
  providerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFF4EE',
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  providerBannerText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textPrimary,
  },
  descriptionWrapper: {
    marginBottom: 16,
  },
  descriptionInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: Colors.textPrimary,
    backgroundColor: Colors.background,
    minHeight: 80,
  },
  descriptionFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    paddingHorizontal: 2,
  },
  charCount: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  micBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFF4EE',
  },
  micBtnActive: {
    backgroundColor: '#FEF2F2',
  },
  searchButton: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    height: 52,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  searchButtonDisabled: {
    opacity: 0.7,
  },
  searchButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.cardWhite,
  },
  providersLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
  },
  providersLoadingText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  providersCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.successGreen,
  },
  providersCountText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  photosSection: {
    marginBottom: 4,
  },
  photosSectionLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
    marginBottom: 8,
  },
  photosRow: {
    gap: 8,
    alignItems: 'center',
  },
  photoThumbWrap: {
    width: 64,
    height: 64,
    position: 'relative',
  },
  photoThumb: {
    width: 64,
    height: 64,
    borderRadius: 8,
  },
  removePhotoBtn: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: Colors.cardWhite,
    borderRadius: 10,
  },
  addPhotoBtn: {
    width: 64,
    height: 64,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFF4EE',
    gap: 2,
  },
  addPhotoBtnText: {
    fontSize: 10,
    color: Colors.primary,
    fontWeight: '600',
  },
  scheduleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    height: 44,
    backgroundColor: Colors.background,
    marginBottom: 12,
  },
  scheduleBtnText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  scheduleOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  scheduleSheet: {
    backgroundColor: Colors.cardWhite,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 44 : 28,
    gap: 14,
  },
  scheduleHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: 4,
  },
  scheduleTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  scheduleSection: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  scheduleDaysRow: { gap: 8, paddingRight: 4 },
  scheduleDayChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  scheduleDayChipActive: { borderColor: Colors.primary, backgroundColor: '#FFF4EE' },
  scheduleDayText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  scheduleDayTextActive: { color: Colors.primary },
  scheduleTimesRow: { gap: 8 },
  scheduleTimeChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  scheduleTimeChipActive: { borderColor: Colors.primary, backgroundColor: '#FFF4EE' },
  scheduleTimeText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  scheduleTimeTextActive: { color: Colors.primary },
  scheduleActions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  scheduleCancelBtn: {
    flex: 1,
    height: 50,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scheduleCancelText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  scheduleConfirmBtn: {
    flex: 2,
    height: 50,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scheduleConfirmText: { fontSize: 15, fontWeight: '700', color: Colors.cardWhite },
});
