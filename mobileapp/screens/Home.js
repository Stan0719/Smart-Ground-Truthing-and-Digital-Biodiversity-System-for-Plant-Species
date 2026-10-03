// Home.js

import React, { useEffect, useRef, useState } from 'react';

import {
  View,
  Text,
  StyleSheet,
  ImageBackground,
  Image,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Animated,
  Linking,
  FlatList,
} from 'react-native';

import { plants } from '../data/mockData';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const COLORS = {
  lightGreen: '#DEF9C4',
  paleGreen: '#E0EBDD',
  green: '#50B498',
  darkGreen: '#468585',
  deepGreen: '#173F34',
  cream: '#FFF6DC',
  offWhite: '#F8F6EE',
  textGreen: '#405F5B',
  darkText: '#254B42',
  mutedText: '#60756F',
  white: '#FFFFFF',
};

const CARD_WIDTH = SCREEN_WIDTH < 500 ? 235 : 280;
const CARD_GAP = 22;

// --------------------------------------------------
// Animated Section
// --------------------------------------------------

const RevealView = ({
  children,
  delay = 0,
  direction = 'up',
  style,
}) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(
    new Animated.Value(
      direction === 'left'
        ? -24
        : direction === 'right'
          ? 24
          : 22
    )
  ).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 620,
        delay,
        useNativeDriver: true, 
      }),

      Animated.timing(translate, {
        toValue: 0,
        duration: 620,
        delay,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity,
          transform: [{ translateX: translate }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
};

// --------------------------------------------------
// Home Screen
// --------------------------------------------------

export default function Home({ navigation }) {
  const scrollRef = useRef(null);

  const carouselRef = useRef(null);

  const [carouselIndex, setCarouselIndex] = useState(0);

  // Duplicate plants to create continuous-looking carousel
  const carouselPlants = [...plants, ...plants];

  // ------------------------------------------------
  // Automatic carousel
  // ------------------------------------------------

  useEffect(() => {
    const interval = setInterval(() => {
      setCarouselIndex((current) => {
        const next = current + 1;

        if (next >= plants.length) {
          return 0;
        }

        return next;
      });
    }, 4000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!carouselRef.current) return;

    carouselRef.current.scrollToOffset({
      offset: carouselIndex * (CARD_WIDTH + CARD_GAP),
      animated: true,
    });
  }, [carouselIndex]);

  // ------------------------------------------------
  // Carousel buttons
  // ------------------------------------------------

  const moveCarousel = (direction) => {
    setCarouselIndex((current) => {
      let next = current + direction;

      if (next < 0) {
        next = plants.length - 1;
      }

      if (next >= plants.length) {
        next = 0;
      }

      return next;
    });
  };

  // ------------------------------------------------
  // Navigation
  // ------------------------------------------------

  const goToPlants = () => {
    navigation.navigate('PlantsTab');
  };

  const goToAbout = () => {
    navigation.navigate('About');
  };

  const openGoogleMaps = () => {
    Linking.openURL(
      'https://www.google.com/maps/search/?api=1&query=Niah+National+Park%2C+Sarawak%2C+Malaysia'
    );
  };

  const openPlant = (plant) => {
  navigation.navigate('PlantsTab', {
    screen: 'PlantDetails',
    params: {
      slug: plant.slug,
    },
  });
};

  // ------------------------------------------------
  // Render plant card
  // ------------------------------------------------

  const renderPlant = ({ item }) => {
    return (
      <TouchableOpacity
        activeOpacity={0.9}
        style={styles.plantCard}
        onPress={() => openPlant(item)}
      >
        <View style={styles.plantImage}>
          <View style={styles.plantImagePlaceholder}>
            <Text style={styles.plantPlaceholderIcon}>
              🌿
            </Text>
          </View>

          <View style={styles.categoryBadge}>
            <Text style={styles.categoryText}>
              {item.category}
            </Text>
          </View>
        </View>

        <View style={styles.plantInfo}>
          <Text style={styles.plantName}>
            {item.name}
          </Text>

          <Text style={styles.scientificName}>
            {item.scientificName}
          </Text>

          <Text style={styles.viewPlant}>
            VIEW PLANT →
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>

      {/* ==================================================
          MAIN SCROLL
      ================================================== */}

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >

        {/* ==================================================
            HERO
        ================================================== */}

        <ImageBackground
          source={require('../assets/hero.jpg')}
          style={styles.hero}
          imageStyle={styles.heroImage}
        >
          <View style={styles.heroOverlay} />

          <View style={styles.heroContent}>

            <RevealView delay={0}>
              <Text style={styles.eyebrow}>
                NIAH NATIONAL PARK
              </Text>
            </RevealView>

            <RevealView delay={120}>
              <Text style={styles.heroTitle}>
                Discover the{' '}
                <Text style={styles.heroHighlight}>
                  Biodiversity
                </Text>{' '}
                of Niah
              </Text>
            </RevealView>

            <RevealView delay={240}>
              <Text style={styles.heroDescription}>
                Explore the plants, biodiversity, and natural
                heritage of one of Sarawak's most remarkable
                national parks.
              </Text>
            </RevealView>

            <RevealView delay={360}>
              <View style={styles.heroActions}>

                <TouchableOpacity
                  style={styles.exploreButton}
                  onPress={goToPlants}
                  activeOpacity={0.8}
                >
                  <Text style={styles.exploreButtonText}>
                    Explore Plants
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.learnButton}
                  onPress={goToAbout}
                  activeOpacity={0.8}
                >
                  <Text style={styles.learnButtonText}>
                    Learn About Niah
                  </Text>
                </TouchableOpacity>

              </View>
            </RevealView>

          </View>
        </ImageBackground>


        {/* ==================================================
            ABOUT NIAH
        ================================================== */}

        <View style={styles.aboutSection}>

          <View style={styles.aboutContainer}>

            {/* Image */}

            <RevealView
              direction="left"
              style={styles.aboutImageWrapper}
            >
              <Image
                source={require('../assets/b1.jpg')}
                style={styles.aboutImage}
                resizeMode="cover"
              />
            </RevealView>


            {/* Content */}

            <RevealView
              direction="right"
              delay={100}
              style={styles.aboutContent}
            >

              <Text style={styles.sectionLabel}>
                ABOUT NIAH
              </Text>

              <Text style={styles.aboutTitle}>
                Niah National Park
              </Text>

              <Text style={styles.aboutDescription}>
                Niah National Park is a UNESCO World Heritage
                Site known for its remarkable archaeological
                significance, extensive cave systems,
                prehistoric remains, rock art, and rich
                biodiversity.
              </Text>

              <Text style={styles.aboutDescription}>
                The park is home to the famous Niah Caves,
                where evidence of prehistoric human settlement
                provides valuable insight into the early
                history of Borneo.
              </Text>


              {/* Key Facts */}

              <View style={styles.aboutFacts}>

                <RevealView style={styles.factCard}>
                  <Text style={styles.factNumber}>
                    40,000+
                  </Text>

                  <Text style={styles.factLabel}>
                    Years of Human History
                  </Text>
                </RevealView>

                <RevealView
                  delay={100}
                  style={styles.factCard}
                >
                  <Text style={styles.factNumber}>
                    UNESCO
                  </Text>

                  <Text style={styles.factLabel}>
                    World Heritage Site
                  </Text>
                </RevealView>

                <RevealView
                  delay={200}
                  style={styles.factCard}
                >
                  <Text style={styles.factNumber}>
                    Rich
                  </Text>

                  <Text style={styles.factLabel}>
                    Natural Biodiversity
                  </Text>
                </RevealView>

              </View>

            </RevealView>

          </View> 


          {/* ==================================================
              VISITOR OVERVIEW
          ================================================== */}

          <View style={styles.visitorOverview}>

            <ImageBackground
              source={require('../assets/b1.jpg')}
              style={styles.visitorBackground}
              imageStyle={styles.visitorBackgroundImage}
            >
              <View style={styles.visitorOverlay} />

              <View style={styles.visitorContent}>

                {/* Why Niah */}

                <View style={styles.whyNiah}>

                  <RevealView>
                    <Text style={styles.visitorSectionLabel}>
                      WHY NIAH?
                    </Text>
                  </RevealView>

                  <RevealView delay={100}>
                    <Text style={styles.whyNiahTitle}>
                      Where nature meets human history
                    </Text>
                  </RevealView>

                  <RevealView delay={200}>
                    <Text style={styles.whyNiahDescription}>
                      Hidden within the rainforests of northern
                      Sarawak, Niah National Park is a remarkable
                      meeting point of nature and human history.
                      Its vast limestone caves preserve
                      archaeological discoveries, prehistoric
                      paintings, and evidence of people who lived
                      here thousands of years ago.
                    </Text>
                  </RevealView>

                </View>


                {/* Visitor Information */}

                <View style={styles.visitorInfo}>

                  <RevealView>
                    <Text style={styles.visitorTitle}>
                      Plan your visit
                    </Text>
                  </RevealView>

                  <View style={styles.visitorCards}>

                    {/* Opening hours */}

                    <RevealView style={styles.visitorCard}>
                      <View style={styles.visitorIcon}>
                        <Text style={styles.iconText}>
                          ◷
                        </Text>
                      </View>

                      <Text style={styles.visitorLabel}>
                        OPENING HOURS
                      </Text>

                      <Text style={styles.visitorValue}>
                        Daily, 8 AM–5 PM
                      </Text>
                    </RevealView>


                    {/* Location */}

                    <RevealView
                      delay={80}
                      style={styles.visitorCard}
                    >
                      <View style={styles.visitorIcon}>
                        <Text style={styles.iconText}>
                          ⌖
                        </Text>
                      </View>

                      <Text style={styles.visitorLabel}>
                        LOCATION
                      </Text>

                      <Text style={styles.visitorValue}>
                        Niah, Miri Division
                      </Text>

                      <TouchableOpacity
                        onPress={openGoogleMaps}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.mapLink}>
                          View on Google Maps →
                        </Text>
                      </TouchableOpacity>
                    </RevealView>


                    {/* Experience */}

                    <RevealView
                      delay={160}
                      style={styles.visitorCard}
                    >
                      <View style={styles.visitorIcon}>
                        <Text style={styles.iconText}>
                          ◇
                        </Text>
                      </View>

                      <Text style={styles.visitorLabel}>
                        MAIN EXPERIENCE
                      </Text>

                      <Text style={styles.visitorValue}>
                        Cave & rainforest trekking
                      </Text>
                    </RevealView>


                    {/* Best period */}

                    <RevealView
                      delay={240}
                      style={styles.visitorCard}
                    >
                      <View style={styles.visitorIcon}>
                        <Text style={styles.iconText}>
                          ☼
                        </Text>
                      </View>

                      <Text style={styles.visitorLabel}>
                        BEST PERIOD
                      </Text>

                      <Text style={styles.visitorValue}>
                        March–September
                      </Text>
                    </RevealView>


                    {/* From Miri */}

                    <RevealView
                      delay={320}
                      style={styles.visitorCard}
                    >
                      <View style={styles.visitorIcon}>
                        <Text style={styles.iconText}>
                          ↝
                        </Text>
                      </View>

                      <Text style={styles.visitorLabel}>
                        FROM MIRI
                      </Text>

                      <Text style={styles.visitorValue}>
                        About 1.5 hours
                      </Text>
                    </RevealView>

                  </View>

                </View>

              </View>
            </ImageBackground>

          </View>

        </View>


        {/* ==================================================
            EXPLORE PLANTS
        ================================================== */}

        <View style={styles.exploreSection}>

          <View style={styles.exploreContainer}>

            {/* Header */}

            <View style={styles.exploreHeader}>

              <View style={styles.exploreHeading}>

                <RevealView>
                  <Text style={styles.sectionLabel}>
                    EXPLORE THE FLORA
                  </Text>
                </RevealView>

                <RevealView delay={100}>
                  <Text style={styles.exploreTitle}>
                    Plants of Niah
                  </Text>
                </RevealView>

                <RevealView delay={200}>
                  <Text style={styles.exploreDescription}>
                    Discover the remarkable plants found
                    throughout Niah National Park.
                  </Text>
                </RevealView>

              </View>


              <RevealView delay={300}>

                <TouchableOpacity
                  style={styles.exploreMoreButton}
                  onPress={goToPlants}
                  activeOpacity={0.8}
                >
                  <Text style={styles.exploreMoreText}>
                    Explore More Plants
                  </Text>

                  <Text style={styles.buttonArrow}>
                    →
                  </Text>
                </TouchableOpacity>

              </RevealView>

            </View>


            {/* ==================================================
                PLANT CAROUSEL
            ================================================== */}

            <FlatList
              ref={carouselRef}
              data={carouselPlants}
              renderItem={renderPlant}
              keyExtractor={(item, index) =>
                `${item.slug}-${index}`
              }
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.carouselContent}
              ItemSeparatorComponent={() => (
                <View style={{ width: CARD_GAP }} />
              )}
              snapToInterval={CARD_WIDTH + CARD_GAP}
              decelerationRate="fast"
              getItemLayout={(data, index) => ({
                length: CARD_WIDTH + CARD_GAP,
                offset:
                  (CARD_WIDTH + CARD_GAP) * index,
                index,
              })}
            />


            {/* Carousel controls */}

            <View style={styles.carouselControls}>

              <TouchableOpacity
                style={styles.carouselButton}
                onPress={() => moveCarousel(-1)}
                activeOpacity={0.7}
              >
                <Text style={styles.carouselButtonText}>
                  ←
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.carouselButton}
                onPress={() => moveCarousel(1)}
                activeOpacity={0.7}
              >
                <Text style={styles.carouselButtonText}>
                  →
                </Text>
              </TouchableOpacity>

            </View>

          </View>

        </View>

      </ScrollView>

    </View>
  );
}


// ==================================================
// STYLES
// ==================================================

const styles = StyleSheet.create({

  // ------------------------------------------------
  // Container
  // ------------------------------------------------

  container: {
    flex: 1,
    backgroundColor: COLORS.offWhite,
  },

  scrollContent: {
    paddingBottom: 0,
  },


  // ==================================================
  // HERO
  // ==================================================

  hero: {
    height: 630,
    width: '100%',
    justifyContent: 'center',
    overflow: 'hidden',
  },

  heroImage: {
    resizeMode: 'cover',
  },

  heroOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,

    backgroundColor: 'rgba(30, 45, 40, 0.58)',
  },

  heroContent: {
    width: '88%',
    maxWidth: 620,
    alignSelf: 'center',

    paddingVertical: 80,

    alignItems: 'flex-start',
  },

  eyebrow: {
    marginBottom: 20,

    color: COLORS.lightGreen,

    fontSize: 14,
    fontWeight: '700',

    letterSpacing: 4,
  },

  heroTitle: {
    color: COLORS.cream,

    fontSize:
      SCREEN_WIDTH < 500
        ? 42
        : SCREEN_WIDTH < 900
          ? 58
          : 72,

    lineHeight:
      SCREEN_WIDTH < 500
        ? 47
        : SCREEN_WIDTH < 900
          ? 62
          : 76,

    fontWeight: '800',
  },

  heroHighlight: {
    color: '#7DD1B9',
  },

  heroDescription: {
    maxWidth: 560,

    marginTop: 28,
    marginBottom: 36,

    color: '#E0EBDD',

    fontSize: 17,
    lineHeight: 30,
  },

  heroActions: {
    flexDirection:
      SCREEN_WIDTH < 500
        ? 'column'
        : 'row',

    gap: 14,

    width:
      SCREEN_WIDTH < 500
        ? '100%'
        : undefined,
  },

  exploreButton: {
    paddingVertical: 14,
    paddingHorizontal: 28,

    borderRadius: 30,

    backgroundColor: COLORS.cream,
  },

  exploreButtonText: {
    color: COLORS.darkGreen,

    fontSize: 14,
    fontWeight: '700',

    textAlign: 'center',
  },

  learnButton: {
    paddingVertical: 13,
    paddingHorizontal: 26,

    borderWidth: 1,
    borderColor: 'rgba(224, 235, 221, 0.6)',

    borderRadius: 30,

    backgroundColor: 'transparent',
  },

  learnButtonText: {
    color: COLORS.white,

    fontSize: 14,
    fontWeight: '600',

    textAlign: 'center',
  },


  // ==================================================
  // ABOUT
  // ==================================================

  aboutSection: {
    paddingVertical: 100,

    backgroundColor: COLORS.paleGreen,
  },

  aboutContainer: {
    width: '88%',
    maxWidth: 1200,

    alignSelf: 'center',

    flexDirection:
      SCREEN_WIDTH <= 900
        ? 'column'
        : 'row',

    alignItems: 'center',

    gap: 50,
  },

  aboutImageWrapper: {
    flex: 1,

    width: '100%',
  },

  aboutImage: {
    width: '100%',

    height:
      SCREEN_WIDTH <= 900
        ? 250
        : 470,

    borderRadius: 20,
  },

  aboutContent: {
    flex: 1,

    width: '100%',
  },

  sectionLabel: {
    marginBottom: 14,

    color: COLORS.green,

    fontSize: 13,
    fontWeight: '700',

    letterSpacing: 3,
  },

  aboutTitle: {
    marginBottom: 24,

    color: COLORS.darkGreen,

    fontSize:
      SCREEN_WIDTH < 500
        ? 38
        : 52,

    lineHeight:
      SCREEN_WIDTH < 500
        ? 43
        : 58,

    fontWeight: '800',
  },

  aboutDescription: {
    marginBottom: 18,

    color: COLORS.textGreen,

    fontSize: 16,
    lineHeight: 29,
  },


  // ==================================================
  // FACTS
  // ==================================================

  aboutFacts: {
    flexDirection:
      SCREEN_WIDTH < 600
        ? 'column'
        : 'row',

    gap: 12,

    marginTop: 20,
  },

  factCard: {
    flex: 1,

    paddingVertical: 18,
    paddingHorizontal: 14,

    borderRadius: 14,

    backgroundColor: 'rgba(255, 246, 220, 0.7)',

    borderWidth: 1,
    borderColor: 'rgba(70, 133, 133, 0.12)',
  },

  factNumber: {
    marginBottom: 6,

    color: COLORS.darkGreen,

    fontSize: 20,
    fontWeight: '800',
  },

  factLabel: {
    color: '#55716D',

    fontSize: 11,
    lineHeight: 16,
  },


  // ==================================================
  // VISITOR OVERVIEW
  // ==================================================

  visitorOverview: {
    width: '88%',
    maxWidth: 1200,

    alignSelf: 'center',

    marginTop: 80,

    overflow: 'hidden',

    borderRadius: 28,

    backgroundColor: COLORS.deepGreen,

    elevation: 8,
  },

  visitorBackground: {
    width: '100%',
  },

  visitorBackgroundImage: {
    resizeMode: 'cover',
  },

  visitorOverlay: {
    ...StyleSheet.absoluteFillObject,

    backgroundColor:
      'rgba(15, 51, 40, 0.84)',
  },

  visitorContent: {
    padding:
      SCREEN_WIDTH < 500
        ? 30
        : 48,
  },

  whyNiah: {
    gap: 14,
  },

  visitorSectionLabel: {
    color: '#A9E7C4',

    fontSize: 13,
    fontWeight: '700',

    letterSpacing: 3,
  },

  whyNiahTitle: {
    color: COLORS.cream,

    fontSize:
      SCREEN_WIDTH < 500
        ? 28
        : 36,

    lineHeight:
      SCREEN_WIDTH < 500
        ? 34
        : 43,

    fontWeight: '800',
  },

  whyNiahDescription: {
    marginTop: 12,

    paddingTop: 22,

    borderTopWidth: 1,
    borderTopColor:
      'rgba(224, 235, 221, 0.24)',

    color: '#E0EBDD',

    fontSize: 16,
    lineHeight: 29,
  },


  // ==================================================
  // VISITOR INFO
  // ==================================================

  visitorInfo: {
    marginTop: 38,

    paddingTop: 30,

    borderTopWidth: 1,
    borderTopColor:
      'rgba(224, 235, 221, 0.2)',
  },

  visitorTitle: {
    color: COLORS.cream,

    fontSize:
      SCREEN_WIDTH < 500
        ? 28
        : 34,

    fontWeight: '800',
  },

  visitorCards: {
    marginTop: 22,

    flexDirection:
      SCREEN_WIDTH < 600
        ? 'column'
        : 'row',

    flexWrap: 'wrap',

    gap: 15,
  },

  visitorCard: {
    minHeight: 168,

    width:
      SCREEN_WIDTH < 600
        ? '100%'
        : SCREEN_WIDTH < 1000
          ? '47%'
          : '18%',

    paddingVertical: 22,
    paddingHorizontal: 20,

    borderWidth: 1,
    borderColor: 'rgba(214, 229, 209, 0.72)',

    borderRadius: 18,

    backgroundColor:
      'rgba(255, 250, 235, 0.94)',

    justifyContent: 'flex-start',
  },

  visitorIcon: {
    width: 44,
    height: 44,

    marginBottom: 19,

    alignItems: 'center',
    justifyContent: 'center',

    borderWidth: 1,
    borderColor:
      'rgba(70, 133, 133, 0.2)',

    borderRadius: 14,

    backgroundColor: '#E6EEE1',
  },

  iconText: {
    color: '#3F786B',

    fontSize: 23,
    fontWeight: '500',
  },

  visitorLabel: {
    marginBottom: 7,

    color: '#607C75',

    fontSize: 11,
    fontWeight: '700',

    letterSpacing: 0.7,
  },

  visitorValue: {
    color: '#294F47',

    fontSize: 15,
    fontWeight: '700',

    lineHeight: 22,
  },

  mapLink: {
    marginTop: 12,

    color: '#4B7F70',

    fontSize: 11,
    fontWeight: '700',
  },


  // ==================================================
  // EXPLORE PLANTS
  // ==================================================

  exploreSection: {
    paddingVertical: 110,

    backgroundColor: COLORS.offWhite,

    overflow: 'hidden',
  },

  exploreContainer: {
    width: '88%',
    maxWidth: 1200,

    alignSelf: 'center',
  },

  exploreHeader: {
    flexDirection:
      SCREEN_WIDTH < 900
        ? 'column'
        : 'row',

    alignItems:
      SCREEN_WIDTH < 900
        ? 'flex-start'
        : 'flex-end',

    justifyContent: 'space-between',

    gap: 30,

    marginBottom: 48,
  },

  exploreHeading: {
    maxWidth: 650,

    flex: 1,
  },

  exploreTitle: {
    color: '#315F5F',

    fontSize:
      SCREEN_WIDTH < 500
        ? 38
        : 54,

    lineHeight:
      SCREEN_WIDTH < 500
        ? 44
        : 60,

    fontWeight: '800',
  },

  exploreDescription: {
    maxWidth: 560,

    marginTop: 18,

    color: COLORS.mutedText,

    fontSize: 16,
    lineHeight: 27,
  },

  exploreMoreButton: {
    flexDirection: 'row',

    alignItems: 'center',

    gap: 14,

    paddingVertical: 14,
    paddingHorizontal: 22,

    borderWidth: 1,
    borderColor:
      'rgba(70, 133, 133, 0.25)',

    borderRadius: 999,

    backgroundColor: COLORS.cream,
  },

  exploreMoreText: {
    color: COLORS.darkGreen,

    fontSize: 13,
    fontWeight: '700',
  },

  buttonArrow: {
    color: COLORS.darkGreen,

    fontSize: 18,
  },


  // ==================================================
  // PLANT CAROUSEL
  // ==================================================

  carouselContent: {
    paddingVertical: 10,

    paddingRight: 20,
  },

  plantCard: {
    width: CARD_WIDTH,

    overflow: 'hidden',

    borderWidth: 1,
    borderColor:
      'rgba(49, 91, 70, 0.1)',

    borderRadius: 20,

    backgroundColor: COLORS.white,

    elevation: 4,
  },

  plantImage: {
    width: '100%',
    height: CARD_WIDTH * 0.75,

    position: 'relative',

    overflow: 'hidden',

    backgroundColor: '#DCE8D6',
  },

  plantImagePlaceholder: {
    flex: 1,

    alignItems: 'center',
    justifyContent: 'center',

    backgroundColor: '#C5DCC9',
  },

  plantPlaceholderIcon: {
    fontSize: 55,
  },

  categoryBadge: {
    position: 'absolute',

    top: 14,
    right: 14,

    paddingVertical: 7,
    paddingHorizontal: 11,

    borderRadius: 999,

    backgroundColor:
      'rgba(20, 54, 37, 0.86)',
  },

  categoryText: {
    color: COLORS.white,

    fontSize: 10,
    fontWeight: '700',

    letterSpacing: 0.5,
  },

  plantInfo: {
    minHeight: 115,

    paddingVertical: 20,
    paddingHorizontal: 20,
  },

  plantName: {
    color: COLORS.darkText,

    fontSize: 22,
    fontWeight: '600',

    lineHeight: 27,
  },

  scientificName: {
    marginTop: 7,

    color: '#88735D',

    fontSize: 14,
    fontStyle: 'italic',
  },

  viewPlant: {
    marginTop: 18,

    color: '#508A6A',

    fontSize: 12,
    fontWeight: '700',

    letterSpacing: 0.7,
  },


  // ==================================================
  // CAROUSEL CONTROLS
  // ==================================================

  carouselControls: {
    marginTop: 22,

    flexDirection: 'row',

    justifyContent: 'flex-end',

    gap: 9,
  },

  carouselButton: {
    width: 38,
    height: 38,

    alignItems: 'center',
    justifyContent: 'center',

    borderWidth: 1,
    borderColor:
      'rgba(70, 133, 133, 0.24)',

    borderRadius: 12,

    backgroundColor: COLORS.cream,
  },

  carouselButtonText: {
    color: COLORS.darkGreen,

    fontSize: 18,
  },

});