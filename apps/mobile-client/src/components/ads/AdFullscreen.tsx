import React from 'react';
import {
  Modal,
  View,
  Image,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  StatusBar,
  SafeAreaView,
} from 'react-native';
import { API_BASE } from '@/lib/config';
import { AdBanner } from './AdStories';

interface AdFullscreenProps {
  ad: AdBanner | null;
  onClose: () => void;
}

function getCTA(linkUrl: string | null): { label: string; color: string } | null {
  if (!linkUrl) return null;
  if (linkUrl.includes('wa.me')) return { label: 'Falar no WhatsApp', color: '#25D366' };
  return { label: 'Ver oferta', color: '#D4860A' };
}

function registerClick(adId: string) {
  fetch(`${API_BASE}/ads/${adId}/click`, { method: 'POST' }).catch(() => {
    // fire-and-forget — silencia erros de rede
  });
}

export default function AdFullscreen({ ad, onClose }: AdFullscreenProps) {
  if (!ad) return null;

  const cta = getCTA(ad.link_url);

  const handleCTA = async () => {
    registerClick(ad.id);
    if (ad.link_url) {
      await Linking.openURL(ad.link_url).catch(() => {});
    }
  };

  return (
    <Modal
      visible={!!ad}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <StatusBar hidden />
      <View style={styles.container}>
        <Image
          source={{ uri: ad.image_url }}
          style={styles.image}
          resizeMode="cover"
        />

        {/* Botao fechar */}
        <SafeAreaView style={styles.header}>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onClose}
            accessibilityLabel="Fechar propaganda"
            accessibilityRole="button"
          >
            <Text style={styles.closeIcon}>X</Text>
          </TouchableOpacity>
        </SafeAreaView>

        {/* Rodape com nome e CTA */}
        <View style={styles.footer}>
          <Text style={styles.advertiserName} numberOfLines={1}>
            {ad.advertiser_name}
          </Text>
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
  header: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    padding: 16,
  },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(10,10,10,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeIcon: {
    color: '#FFFFFF',
    fontSize: 18,
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
  advertiserName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  adTitle: {
    fontSize: 13,
    color: '#CCCCCC',
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
