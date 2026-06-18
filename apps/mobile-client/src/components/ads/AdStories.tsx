import React from 'react';
import { ScrollView, TouchableOpacity, Image, Text, View, StyleSheet } from 'react-native';
import { Colors } from '../../constants/colors';

export interface AdBanner {
  id: string;
  title: string;
  advertiser_name: string;
  image_url: string;
  image_urls?: string[] | null;
  link_url: string | null;
  priority: number;
}

interface AdStoriesProps {
  ads: AdBanner[];
  onPress: (ad: AdBanner) => void;
}

export default function AdStories({ ads, onPress }: AdStoriesProps) {
  if (!ads || ads.length === 0) return null;

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {ads.map((ad) => (
          <TouchableOpacity
            key={ad.id}
            style={styles.item}
            onPress={() => onPress(ad)}
            accessibilityLabel={`Propaganda de ${ad.advertiser_name}`}
            accessibilityRole="button"
          >
            <View style={styles.circle}>
              <Image
                source={{ uri: ad.image_url }}
                style={styles.image}
                defaultSource={require('../../../assets/icon.png')}
              />
            </View>
            <Text style={styles.label} numberOfLines={1}>
              {ad.advertiser_name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const CIRCLE_SIZE = 56;

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 16,
  },
  item: {
    alignItems: 'center',
    width: 64,
  },
  circle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    borderWidth: 2,
    borderColor: Colors.secondary,
    overflow: 'hidden',
  },
  image: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
  },
  label: {
    fontSize: 10,
    color: Colors.textPrimary,
    marginTop: 4,
    maxWidth: 64,
    textAlign: 'center',
  },
});
