import { useState, useEffect, useRef } from 'react';
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
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const API_BASE = 'https://construconnect-api.orionsystem.workers.dev/v1';

const CATEGORIES = [
  { key: 'alvenaria', label: 'Alvenaria', icon: 'layers-outline' },
  { key: 'hidraulica', label: 'Hidráulica', icon: 'water-outline' },
  { key: 'eletrica', label: 'Elétrica', icon: 'flash-outline' },
  { key: 'pintura', label: 'Pintura', icon: 'color-palette-outline' },
  { key: 'piso', label: 'Piso', icon: 'grid-outline' },
  { key: 'acabamento', label: 'Acabamento', icon: 'hammer-outline' },
];

interface ProviderMarker {
  id: string;
  latitude?: number;
  longitude?: number;
  full_name: string;
  specialties: string;
  city?: string;
}

const DEFAULT_REGION: Region = {
  latitude: -23.5505,
  longitude: -46.6333,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

export default function HomeScreen() {
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

  useEffect(() => {
    requestLocation();
    fetchProviders();
    return () => { locationSubRef.current?.remove(); };
  }, []);

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
          const result = await ImagePicker.launchCameraAsync({ quality: 0.7, base64: true });
          if (!result.canceled && result.assets[0].base64) {
            setPhotos((prev) => [...prev, { uri: result.assets[0].uri, base64: result.assets[0].base64! }]);
          }
        },
      },
      {
        text: 'Galeria',
        onPress: async () => {
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
        await fetch(`${API_BASE}/photos/upload`, {
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
      } catch {}
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
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const response = await fetch(`${API_BASE}/service-requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          client_user_id: user.id,
          category: selectedCategory,
          description: description.trim(),
          latitude: region.latitude,
          longitude: region.longitude,
        }),
      });

      if (!response.ok) {
        Alert.alert('Erro', 'Não foi possível criar a solicitação. Tente novamente.');
        setSubmitting(false);
        return;
      }

      const data = await response.json();
      const requestId = data?.id ?? data?.service_request?.id;

      if (requestId && photos.length > 0) {
        await uploadPhotos(requestId);
      }

      setSubmitting(false);
      setSelectedCategory('');
      setDescription('');
      setPhotos([]);

      if (requestId) {
        router.push(`/tracking/${requestId}`);
      } else {
        router.push('/(tabs)/requests');
      }
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
            description={p.specialties}
          >
            <View style={styles.providerMarker}>
              <Ionicons name="construct" size={16} color={Colors.cardWhite} />
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

      <View style={styles.bottomCard}>
        <View style={styles.bottomCardHandle} />
        <Text style={styles.cardTitle}>Solicitar serviço</Text>
        <Text style={styles.cardSubtitle}>Selecione a categoria</Text>

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

        <View style={styles.descriptionWrapper}>
          <TextInput
            style={styles.descriptionInput}
            placeholder="Descreva o serviço que você precisa..."
            placeholderTextColor={Colors.textSecondary}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
            maxLength={500}
            textAlignVertical="top"
          />
          <Text style={styles.charCount}>{description.length}/500</Text>
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

        <TouchableOpacity
          style={[styles.searchButton, submitting && styles.searchButtonDisabled]}
          onPress={handleRequestService}
          disabled={submitting}
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
  charCount: {
    fontSize: 11,
    color: Colors.textSecondary,
    textAlign: 'right',
    marginTop: 4,
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
});
