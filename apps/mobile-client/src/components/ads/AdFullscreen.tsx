import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Image,
  Text,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  Linking,
  StatusBar,
  SafeAreaView,
  Animated,
} from 'react-native';
import { API_BASE } from '@/lib/config';
import { AdBanner } from './AdStories';

interface AdFullscreenProps {
  ad: AdBanner | null;
  onClose: () => void;
}

const STORY_DURATION = 5000; // 5s por imagem (auto-avanço)

function getCTA(linkUrl: string | null): { label: string; color: string } | null {
  if (!linkUrl) return null;
  if (linkUrl.includes('wa.me')) return { label: 'Falar no WhatsApp', color: '#25D366' };
  return { label: 'Ver oferta', color: '#D4860A' };
}

function getImages(ad: AdBanner): string[] {
  const gallery = Array.isArray(ad.image_urls) ? ad.image_urls.filter(Boolean) : [];
  if (gallery.length > 0) return gallery;
  return ad.image_url ? [ad.image_url] : [];
}

async function registerClick(adId: string) {
  try {
    await fetch(`${API_BASE}/ads/${adId}/click`, { method: 'POST' });
  } catch {
    // silencia erros de rede
  }
}

export default function AdFullscreen({ ad, onClose }: AdFullscreenProps) {
  const [index, setIndex] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;
  const animation = useRef<Animated.CompositeAnimation | null>(null);

  const images = ad ? getImages(ad) : [];
  const total = images.length;

  // Reinicia no primeiro slide sempre que abrir um novo anúncio.
  useEffect(() => {
    setIndex(0);
  }, [ad?.id]);

  // Auto-avanço: anima a barra do slide atual e passa para o próximo ao concluir.
  useEffect(() => {
    if (!ad || total === 0) return;

    progress.setValue(0);
    animation.current = Animated.timing(progress, {
      toValue: 1,
      duration: STORY_DURATION,
      useNativeDriver: false,
    });
    animation.current.start(({ finished }) => {
      if (finished) {
        if (index < total - 1) {
          setIndex((i) => i + 1);
        } else {
          onClose();
        }
      }
    });

    return () => {
      animation.current?.stop();
    };
  }, [ad?.id, index, total]);

  if (!ad || total === 0) return null;

  const cta = getCTA(ad.link_url);

  const goNext = () => {
    if (index < total - 1) setIndex((i) => i + 1);
    else onClose();
  };

  const goPrev = () => {
    if (index > 0) setIndex((i) => i - 1);
    else progress.setValue(0);
  };

  const handleCTA = async () => {
    await registerClick(ad.id);
    if (ad.link_url) {
      await Linking.openURL(ad.link_url).catch(() => {});
    }
  };

  return (
    <Modal
      visible={!!ad}
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <StatusBar hidden />
      <View style={styles.container}>
        {/* Imagem atual */}
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <Image
            source={{ uri: images[index] }}
            style={styles.image}
            resizeMode="cover"
          />
        </View>

        {/* Zonas de toque: esquerda volta, direita avança */}
        <View style={styles.touchZones}>
          <Pressable style={styles.touchZone} onPress={goPrev} />
          <Pressable style={styles.touchZone} onPress={goNext} />
        </View>

        {/* Cabeçalho: barras de progresso + fechar */}
        <SafeAreaView style={styles.header}>
          <View style={styles.progressRow}>
            {images.map((_, i) => (
              <View key={i} style={styles.progressTrack}>
                <Animated.View
                  style={[
                    styles.progressFill,
                    {
                      width:
                        i < index
                          ? '100%'
                          : i === index
                          ? progress.interpolate({
                              inputRange: [0, 1],
                              outputRange: ['0%', '100%'],
                            })
                          : '0%',
                    },
                  ]}
                />
              </View>
            ))}
          </View>

          <View style={styles.headerControls}>
            <Text style={styles.headerAdvertiser} numberOfLines={1}>
              {ad.advertiser_name}
            </Text>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              accessibilityLabel="Fechar propaganda"
              accessibilityRole="button"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.closeIcon}>X</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>

        {/* Rodapé com título e CTA */}
        <View style={styles.footer}>
          <Text style={styles.adTitle} numberOfLines={2}>
            {ad.title}
          </Text>

          {cta && (
            <TouchableOpacity
              style={[styles.ctaBtn, { backgroundColor: cta.color }]}
              onPress={handleCTA}
              accessibilityLabel={`${cta.label} de ${ad.advertiser_name}`}
              accessibilityRole="link"
            >
              <Text style={styles.ctaText}>{cta.label}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  image: {
    ...StyleSheet.absoluteFillObject,
  },
  touchZones: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
  },
  touchZone: {
    flex: 1,
  },
  header: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    paddingHorizontal: 12,
  },
  progressRow: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 8,
  },
  progressTrack: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.35)',
    overflow: 'hidden',
  },
  progressFill: {
    height: 3,
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
  },
  headerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    gap: 12,
  },
  headerAdvertiser: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 4,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(10,10,10,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeIcon: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 24,
    paddingBottom: 40,
    backgroundColor: 'rgba(10,10,10,0.75)',
  },
  adTitle: {
    fontSize: 15,
    color: '#FFFFFF',
    fontWeight: '600',
    marginBottom: 16,
  },
  ctaBtn: {
    height: 52,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
