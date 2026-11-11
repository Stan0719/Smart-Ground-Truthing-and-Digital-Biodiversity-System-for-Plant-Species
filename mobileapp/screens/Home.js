import { useAppTranslation, t, translateLabel, translateUIMessage } from "../translations/i18n";
// Home.js
import LanguageSelector from "../components/LanguageSelector";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import React, { useCallback, useEffect, useRef, useState } from 'react';

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
  PanResponder,
  Linking,
  FlatList,
  RefreshControl,
} from 'react-native';

import { getSpeciesImageSource } from '../data/speciesImages';
import { fetchSpeciesCatalog } from '../utils/plantApi';
import RefreshButton from '../components/RefreshButton';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const COLORS = {
  lightGreen: '#E7F2E2',
  paleGreen: '#E9F7E4',
  green: '#468585',
  darkGreen: '#468585',
  deepGreen: '#234B3A',
  cream: '#F7FBF4',
  offWhite: '#F7FBF4',
  textGreen: '#6D7F75',
  darkText: '#234B3A',
  mutedText: '#6D7F75',
  white: '#FFFFFF',
  journeyBackground: '#F7FBF4',
  beforeBackground: '#E7F2E2',
};

const CARD_WIDTH = SCREEN_WIDTH < 500 ? 190 : 240;
const CARD_GAP = SCREEN_WIDTH < 500 ? 14 : 18;

const ABOUT_STACK_IMAGES = [
  {
    id: 'niah-cave',
    source: require('../assets/cave1.jpeg'),
    accessibilityLabel: 'Niah Cave',
  },
  {
    id: 'niah-cave-interior',
    source: require('../assets/cave4.png'),
    accessibilityLabel: 'Niah Cave interior',
  },
  {
    id: 'niah-landscape',
    source: require('../assets/cave3.png'),
    accessibilityLabel: 'Niah Cave landscape',
  },
  {
    id: 'niah-cave-interior-secondary',
    source: require('../assets/cave2.png'),
    accessibilityLabel: 'Interior of Niah Cave',
  },
];

const ABOUT_STACK_SWIPE_THRESHOLD = 75;
const ABOUT_STACK_ANIMATION_DURATION = 300;

export function SpeciesCardImage({ species }) {
  useAppTranslation();
  const source = getSpeciesImageSource(species, undefined, {
    allowUnmappedRemote: false,
    preferVerifiedBackend: true,
  });
  const [failedSource, setFailedSource] = useState(null);

  if (!source || failedSource === source) {
    return (
      <View style={styles.plantImagePlaceholder}>
        <Text style={styles.plantPlaceholderIcon}>🌿</Text>
        <Text style={styles.plantPlaceholderText}>{t("speciesDetail.plantImageComingSoon")}</Text>
      </View>
    );
  }

  return <Image source={source} style={styles.plantImageActual} resizeMode="cover" onError={() => setFailedSource(source)} />;
}


// ==================================================
// REVEAL ANIMATION
// ==================================================

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


// ==================================================
// ABOUT IMAGE STACK
// ==================================================

const AboutImageStack = () => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  const translateX = useRef(new Animated.Value(0)).current;
  const isAnimatingRef = useRef(false);
  const didDrag = useRef(false);

  const resetTopCard = () => {
    Animated.spring(translateX, {
      toValue: 0,
      tension: 90,
      friction: 10,
      useNativeDriver: true,
    }).start();
  };

  const changeImage = (direction) => {
    if (isAnimatingRef.current) return;

    isAnimatingRef.current = true;
    setIsAnimating(true);

    Animated.timing(translateX, {
      toValue: direction === 'next' ? -SCREEN_WIDTH : SCREEN_WIDTH,
      duration: ABOUT_STACK_ANIMATION_DURATION,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setActiveIndex((current) => (
          direction === 'next'
            ? (current + 1) % ABOUT_STACK_IMAGES.length
            : (current - 1 + ABOUT_STACK_IMAGES.length) % ABOUT_STACK_IMAGES.length
        ));
      }

      translateX.setValue(0);
      didDrag.current = false;
      isAnimatingRef.current = false;
      setIsAnimating(false);
    });
  };

  const panResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gestureState) => (
      !isAnimatingRef.current &&
      Math.abs(gestureState.dx) > 6 &&
      Math.abs(gestureState.dx) > Math.abs(gestureState.dy)
    ),
    onPanResponderGrant: () => {
      didDrag.current = true;
      translateX.stopAnimation();
    },
    onPanResponderMove: (_, gestureState) => {
      translateX.setValue(gestureState.dx);
    },
    onPanResponderRelease: (_, gestureState) => {
      if (Math.abs(gestureState.dx) >= ABOUT_STACK_SWIPE_THRESHOLD) {
        changeImage(gestureState.dx < 0 ? 'next' : 'previous');
      } else {
        resetTopCard();
      }
    },
    onPanResponderTerminate: resetTopCard,
  });

  const topCardRotation = translateX.interpolate({
    inputRange: [-SCREEN_WIDTH, 0, SCREEN_WIDTH],
    outputRange: ['-10deg', '0deg', '10deg'],
    extrapolate: 'clamp',
  });

  const topCardOpacity = translateX.interpolate({
    inputRange: [-SCREEN_WIDTH * 0.75, 0, SCREEN_WIDTH * 0.75],
    outputRange: [0, 1, 0],
    extrapolate: 'clamp',
  });

  const visibleCards = [2, 1, 0];

  return (
    <View style={styles.aboutStackWrapper}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={t("home.previousNiahImage")}
        activeOpacity={0.75}
        disabled={isAnimating}
        hitSlop={6}
        onPress={() => changeImage('previous')}
        style={[styles.aboutStackArrow, styles.aboutStackArrowLeft]}
      >
        <Text style={styles.aboutStackArrowText}>‹</Text>
      </TouchableOpacity>

      <View style={styles.aboutStackDeck}>
        {visibleCards.map((depth) => {
          const imageIndex = (activeIndex + depth) % ABOUT_STACK_IMAGES.length;
          const image = ABOUT_STACK_IMAGES[imageIndex];
          const isTopCard = depth === 0;

          const cardStyle = isTopCard
            ? {
                opacity: topCardOpacity,
                transform: [
                  { translateX },
                  { rotate: topCardRotation },
                ],
                zIndex: 3,
              }
            : {
                transform: [
                  { translateX: depth * 7 },
                  { translateY: depth * 7 },
                  { rotate: `${depth * 4}deg` },
                  { scale: 1 - depth * 0.06 },
                ],
                zIndex: 3 - depth,
              };

          return (
            <Animated.View
              key={`${image.id}-${depth}`}
              style={[styles.aboutStackCard, cardStyle]}
              {...(isTopCard ? panResponder.panHandlers : {})}
            >
              <TouchableOpacity
                activeOpacity={0.96}
                disabled={!isTopCard || isAnimating}
                onPressIn={() => {
                  didDrag.current = false;
                }}
                onPress={() => {
                  if (!didDrag.current) changeImage('next');
                }}
                style={styles.aboutStackCardPressable}
              >
                <Image
                  source={image.source}
                  style={styles.aboutStackImage}
                  resizeMode="cover"
                  accessible={isTopCard}
                  accessibilityLabel={isTopCard ? image.accessibilityLabel : undefined}
                />
              </TouchableOpacity>
            </Animated.View>
          );
        })}
      </View>

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={t("home.nextNiahImage")}
        activeOpacity={0.75}
        disabled={isAnimating}
        hitSlop={6}
        onPress={() => changeImage('next')}
        style={[styles.aboutStackArrow, styles.aboutStackArrowRight]}
      >
        <Text style={styles.aboutStackArrowText}>›</Text>
      </TouchableOpacity>
    </View>
  );
};


// ==================================================
// HOME SCREEN
// ==================================================

export default function Home({ navigation }) {
  useAppTranslation();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef(null);
  const carouselRef = useRef(null);

  const [carouselIndex, setCarouselIndex] = useState(0);
  const [species, setSpecies] = useState([]);
  const [speciesLoading, setSpeciesLoading] = useState(true);
  const [speciesError, setSpeciesError] = useState('');
  const speciesRequestRef = useRef(null);
  const mountedRef = useRef(false);

  const loadSpecies = useCallback(() => {
    if (speciesRequestRef.current) return speciesRequestRef.current;
    const request = (async () => {
      try {
        setSpeciesLoading(true);
        setSpeciesError('');
        const result = await fetchSpeciesCatalog();
        if (mountedRef.current) setSpecies(result);
      } catch (error) {
        if (mountedRef.current) {
          setSpeciesError(error.message || 'Unable to load species.');
        }
      } finally {
        if (mountedRef.current) setSpeciesLoading(false);
        if (speciesRequestRef.current === request) speciesRequestRef.current = null;
      }
    })();
    speciesRequestRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadSpecies();
    const unsubscribe = navigation.addListener('focus', loadSpecies);
    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, [navigation, loadSpecies]);


  // ==================================================
  // AUTOMATIC CAROUSEL
  // ==================================================

  useEffect(() => {
    if (!species.length) return;

    const interval = setInterval(() => {
      setCarouselIndex((current) => {
        const next = current + 1;

        if (next >= species.length) {
          return 0;
        }

        return next;
      });
    }, 4000);

    return () => clearInterval(interval);
  }, [species.length]);


  useEffect(() => {
    if (!carouselRef.current) return;

    carouselRef.current.scrollToOffset({
      offset: carouselIndex * (CARD_WIDTH + CARD_GAP),
      animated: true,
    });
  }, [carouselIndex]);


  // ==================================================
  // CAROUSEL BUTTONS
  // ==================================================

  const moveCarousel = (direction) => {
    if (!species.length) return;

    setCarouselIndex((current) => {
      let next = current + direction;

      if (next < 0) {
        next = species.length - 1;
      }

      if (next >= species.length) {
        next = 0;
      }

      return next;
    });
  };


  // ==================================================
  // NAVIGATION
  // ==================================================

  const goToPlants = () => {
    navigation.navigate('PlantsTab');
  };


  const openGoogleMaps = () => {
    Linking.openURL(
      'https://www.google.com/maps/search/?api=1&query=Niah+National+Park%2C+Sarawak%2C+Malaysia'
    );
  };


  

const openPlant = (plant) => {
  navigation
    .getParent()
    ?.navigate('PlantsTab', {
      screen: 'SpeciesDetail',
      params: {
        slug: plant.slug,
        speciesId: plant.id,
        species: plant,
      },
    });
};




  // ==================================================
  // PLANT CARD
  // ==================================================

const renderPlant = ({ item }) => {
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      style={styles.plantCard}
      onPress={() => openPlant(item)}
    >
      <View style={styles.plantImage}>
        <SpeciesCardImage species={item} />
      </View>

      <View style={styles.plantInfo}>
        <Text style={styles.plantName}>
          {item.name}
        </Text>

        <Text style={styles.scientificName}>
          {item.scientificName}
        </Text>

<TouchableOpacity
  onPress={() => openPlant(item)}
  activeOpacity={0.7}
  style={styles.viewPlantButton}
  hitSlop={5}
>
  <Text style={styles.viewPlant}>{t("home.viewDetails")}</Text>
</TouchableOpacity>

      </View>
    </TouchableOpacity>
  );
};


  return (
    <View style={styles.container}>

      <View style={[styles.languageHeader, { paddingTop: Math.max(insets.top, 8) }]}>
        <LanguageSelector />
      </View>

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={speciesLoading}
            onRefresh={() => void loadSpecies()}
            tintColor={COLORS.darkGreen}
            colors={[COLORS.darkGreen]}
          />
        }
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

            <RevealView>
              <Text style={styles.eyebrow}>{t("home.niahNationalPark")}</Text>
            </RevealView>


            <RevealView delay={120}>
              <Text style={styles.heroTitle}>{t("home.discoverThe")}{' '}
                <Text style={styles.heroHighlight}>{t("home.biodiversity")}</Text>{' '}{t("home.ofNiah")}</Text>
            </RevealView>


            <RevealView delay={240}>
              <Text style={styles.heroDescription}>{t("home.exploreThePlantsBiodiversityAndNaturalHeritageOfOneOf")}</Text>
            </RevealView>


            <RevealView delay={360}>
              <View style={styles.heroActions}>

                <TouchableOpacity
                  style={styles.exploreButton}
                  onPress={goToPlants}
                  activeOpacity={0.8}
                  hitSlop={5}
                >
                  <Text style={styles.exploreButtonText}>{t("home.explorePlants")}</Text>
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
  <AboutImageStack />
</RevealView>


            {/* Content */}

            <RevealView
              direction="right"
              delay={100}
              style={styles.aboutContent}
            >

              <Text style={styles.sectionLabel}>{t("home.aboutNiah")}</Text>


              <Text style={styles.aboutTitle}>{t("home.niahNationalPark2")}</Text>


              <Text style={styles.aboutDescription}>{t("home.niahNationalParkIsAUnescoWorldHeritageSiteKnown")}</Text>


              <Text style={styles.aboutDescription}>{t("home.theParkIsHomeToTheFamousNiahCavesWhere")}</Text>


              {/* Key Facts */}

              <View style={styles.aboutFacts}>

                <RevealView style={styles.factCard}>
                  <Text style={styles.factNumber}>
                    40,000+
                  </Text>

                  <Text style={styles.factLabel}>{t("home.yearsOfHumanHistory")}</Text>
                </RevealView>


                <RevealView
                  delay={100}
                  style={styles.factCard}
                >
                  <Text style={styles.factNumber}>{t("home.unesco")}</Text>

                  <Text style={styles.factLabel}>{t("home.worldHeritageSite")}</Text>
                </RevealView>


                <RevealView
                  delay={200}
                  style={styles.factCard}
                >
                  <Text style={styles.factNumber}>{t("home.rich")}</Text>

                  <Text style={styles.factLabel}>{t("home.naturalBiodiversity")}</Text>
                </RevealView>

              </View>

            </RevealView>

          </View>


          {/* ==================================================
              EXPLORE NIAH
          ================================================== */}

          <View style={styles.exploreNiah}>

            <View style={styles.exploreNiahHeading}>

              <RevealView>
                <Text style={styles.sectionLabel}>{t("home.exploreNiah")}</Text>
              </RevealView>


              <RevealView delay={100}>
                <Text style={styles.exploreNiahTitle}>{t("home.discoverNiahSRemarkableLandscapes")}</Text>
              </RevealView>


              <RevealView delay={200}>
                <Text style={styles.exploreNiahDescription}>{t("home.fromVastLimestoneCavesToAncientRockArtAndTropical")}</Text>
              </RevealView>

            </View>


            {/* Attraction Cards */}

            <View style={styles.attractionGrid}>

              <RevealView
                style={[
                  styles.attractionCard,
                  styles.attractionFeatured,
                ]}
              >

                <ImageBackground
                  source={require('../assets/greatcave.jpg')}
                  style={styles.attractionBackground}
                  imageStyle={styles.attractionImage}
                >

                  <View style={styles.attractionOverlay} />

                  <View style={styles.attractionContent}>

                    <Text style={styles.featuredLabel}>{t("home.featuredLandscape")}</Text>

                    <Text style={styles.attractionTitle}>{t("home.greatCave")}</Text>

                    <Text style={styles.attractionDescription}>{t("home.stepInsideNiahSSpectacularLimestoneCaveSystemAndExplore")}</Text>

                  </View>

                </ImageBackground>

              </RevealView>


              <RevealView
                delay={100}
                style={[
                  styles.attractionCard,
                  styles.attractionSmall,
                ]}
              >

                <ImageBackground
                  source={require('../assets/b1.jpg')}
                  style={styles.attractionBackground}
                  imageStyle={styles.paintedCaveImage}
                >

                  <View style={styles.attractionOverlay} />

                  <View style={styles.attractionContentSmall}>

                    <Text style={styles.attractionTitleSmall}>{t("home.paintedCave")}</Text>

                    <Text style={styles.attractionDescriptionSmall}>{t("home.discoverPrehistoricRockPaintingsAndTracesOfNiahSAncient")}</Text>

                  </View>

                </ImageBackground>

              </RevealView>


              <RevealView
                delay={200}
                style={[
                  styles.attractionCard,
                  styles.attractionSmall,
                ]}
              >

                <ImageBackground
                  source={require('../assets/hero.jpg')}
                  style={styles.attractionBackground}
                  imageStyle={styles.rainforestImage}
                >

                  <View style={styles.attractionOverlay} />

                  <View style={styles.attractionContentSmall}>

                    <Text style={styles.attractionTitleSmall}>{t("home.rainforestTrails")}</Text>

                    <Text style={styles.attractionDescriptionSmall}>{t("home.walkThroughLushTropicalRainforestAndBoardwalksOnTheJourney")}</Text>

                  </View>

                </ImageBackground>

              </RevealView>

            </View>

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
                    <Text style={styles.visitorSectionLabel}>{t("home.whyNiah")}</Text>
                  </RevealView>


                  <RevealView delay={100}>
                    <Text style={styles.whyNiahTitle}>{t("home.whereNatureMeetsHumanHistory")}</Text>
                  </RevealView>


                  <RevealView delay={200}>
                    <Text style={styles.whyNiahDescription}>{t("home.hiddenWithinTheRainforestsOfNorthernSarawakNiahNationalPark")}</Text>
                  </RevealView>

                </View>


                {/* Visitor Information */}

                <View style={styles.visitorInfo}>

                  <RevealView>
                    <Text style={styles.visitorTitle}>{t("home.planYourVisit")}</Text>
                  </RevealView>


                  <View style={styles.visitorCards}>

                    {/* Opening Hours */}

                    <RevealView style={styles.visitorCard}>

                      <View style={styles.visitorIcon}>
                        <Text style={styles.iconText}>
                          ◷
                        </Text>
                      </View>

                      <Text style={styles.visitorLabel}>{t("home.openingHours")}</Text>

                      <Text style={styles.visitorValue}>{t("home.daily8Am5Pm")}</Text>

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

                      <Text style={styles.visitorLabel}>{t("home.location")}</Text>

                      <Text style={styles.visitorValue}>{t("home.niahMiriDivision")}</Text>

                      <TouchableOpacity
                        onPress={openGoogleMaps}
                        activeOpacity={0.7}
                        hitSlop={8}
                      >
                        <Text style={styles.mapLink}>{t("home.viewOnGoogleMaps")}</Text>
                      </TouchableOpacity>

                    </RevealView>


                    {/* Main Experience */}

                    <RevealView
                      delay={160}
                      style={styles.visitorCard}
                    >

                      <View style={styles.visitorIcon}>
                        <Text style={styles.iconText}>
                          ◇
                        </Text>
                      </View>

                      <Text style={styles.visitorLabel}>{t("home.mainExperience")}</Text>

                      <Text style={styles.visitorValue}>{t("home.caveRainforestTrekking")}</Text>

                    </RevealView>


                    {/* Best Period */}

                    <RevealView
                      delay={240}
                      style={styles.visitorCard}
                    >

                      <View style={styles.visitorIcon}>
                        <Text style={styles.iconText}>
                          ☼
                        </Text>
                      </View>

                      <Text style={styles.visitorLabel}>{t("home.bestPeriod")}</Text>

                      <Text style={styles.visitorValue}>{t("home.marchSeptember")}</Text>

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

                      <Text style={styles.visitorLabel}>{t("home.fromMiri")}</Text>

                      <Text style={styles.visitorValue}>{t("home.about15Hours")}</Text>

                    </RevealView>

                  </View>

                </View>

              </View>

            </ImageBackground>

          </View>

        </View>


        {/* ==================================================
            JOURNEY TO THE GREAT CAVE
        ================================================== */}

        <View style={styles.journeySection}>

          <View style={styles.journeyContainer}>

            <View style={styles.journeyHeading}>

              <RevealView>
                <Text style={styles.sectionLabel}>{t("home.yourJourney")}</Text>
              </RevealView>


              <RevealView delay={100}>
                <Text style={styles.journeyTitle}>{t("home.theAdventureBeginsBeforeTheCave")}</Text>
              </RevealView>


              <RevealView delay={200}>
                <Text style={styles.journeyDescription}>{t("home.followTheJourneyFromTheParkHeadquartersThroughRainforestHeritage")}</Text>
              </RevealView>

            </View>


            {/* Journey Route */}

            <View style={styles.journeyRoute}>

              <JourneyItem
                number="01"
                title={t("home.parkHq")}
                subtitle="Begin your visit"
              />

              <JourneyItem
                number="02"
                title={t("home.riverCrossing")}
                subtitle="Cross into the forest"
                delay={80}
              />

              <JourneyItem
                number="03"
                title={t("home.archaeologyMuseum")}
                subtitle="Discover Niah's story"
                delay={160}
              />

              <JourneyItem
                number="04"
                title={t("home.rainforestBoardwalk")}
                subtitle="Walk beneath the canopy"
                delay={240}
              />

              <JourneyItem
                number="05"
                title={t("home.traderSCave")}
                subtitle="Enter the cave landscape"
                delay={320}
              />

              <JourneyItem
                number="06"
                title={t("home.greatCave")}
                subtitle="The main destination"
                highlight
                delay={400}
              />

              <JourneyItem
                number="07"
                title={t("home.paintedCave")}
                subtitle="Ancient art awaits"
                delay={480}
              />

            </View>

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
                  <Text style={styles.sectionLabel}>{t("home.exploreTheSpecies")}</Text>
                </RevealView>

                <RevealView delay={100}>
                  <View style={styles.exploreTitleRow}>
                    <Text style={styles.exploreTitle}>{t("home.speciesOfNiah")}</Text>
                    <RefreshButton
                      onPress={() => void loadSpecies()}
                      loading={speciesLoading}
                      label={t("species.refreshSpecies")}
                      testID="home-species-refresh"
                    />
                  </View>
                </RevealView>

                <RevealView delay={200}>
                  <Text style={styles.exploreDescription}>{t("home.discoverTheDiverseTreeFlowerFernAndClimberSpeciesFound")}</Text>
                </RevealView>

              </View>


              <RevealView delay={300}>

                <TouchableOpacity
                  style={styles.exploreMoreButton}
                  onPress={goToPlants}
                  activeOpacity={0.8}
                  hitSlop={5}
                >

                  <Text style={styles.exploreMoreText}>{t("home.exploreMorePlantSpecies")}</Text>

                  <Text style={styles.buttonArrow}>
                    →
                  </Text>

                </TouchableOpacity>

              </RevealView>

            </View>


            {/* Plant Carousel */}

            <FlatList
              ref={carouselRef}
              data={species}
              renderItem={renderPlant}
              keyExtractor={(item) => String(item.id)}
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

            {speciesLoading && (
              <Text style={styles.exploreDescription}>{t("home.loadingSpeciesFromTheDatabase")}</Text>
            )}
            {!speciesLoading && !!speciesError && (
              <Text style={[styles.exploreDescription, { color: '#B42318' }]}>{translateUIMessage(speciesError)}</Text>
            )}
            {!speciesLoading && !speciesError && species.length === 0 && (
              <Text style={styles.exploreDescription}>{t("home.noSpeciesAreAvailableForYourAccountYetAConservation")}</Text>
            )}


            {/* Carousel Controls */}

            <View style={styles.carouselControls}>

              <TouchableOpacity
                style={styles.carouselButton}
                onPress={() => moveCarousel(-1)}
                activeOpacity={0.7}
                hitSlop={5}
              >
                <Text style={styles.carouselButtonText}>
                  ←
                </Text>
              </TouchableOpacity>


              <TouchableOpacity
                style={styles.carouselButton}
                onPress={() => moveCarousel(1)}
                activeOpacity={0.7}
                hitSlop={5}
              >
                <Text style={styles.carouselButtonText}>
                  →
                </Text>
              </TouchableOpacity>

            </View>

          </View>

        </View>


        {/* ==================================================
            BEFORE YOU EXPLORE
        ================================================== */}

        <View style={styles.beforeExplore}>

          <View style={styles.beforeExploreContainer}>

            <View style={styles.beforeExploreHeading}>

              <View style={styles.beforeExploreTitleContainer}>

                <RevealView>
                  <Text style={styles.sectionLabel}>{t("home.beforeYouExplore")}</Text>
                </RevealView>


                <RevealView delay={100}>
                  <Text style={styles.beforeExploreTitle}>{t("home.comePreparedForTheAdventure")}</Text>
                </RevealView>

              </View>


              <RevealView delay={200}>
                <Text style={styles.beforeExploreDescription}>{t("home.aLittlePreparationWillMakeYourJourneyThroughNiahS")}</Text>
              </RevealView>

            </View>


            {/* Preparation Grid */}

            <View style={styles.preparationGrid}>

              <PreparationItem
                icon="♢"
                title={t("home.goodFootwear")}
                description="Wear comfortable shoes with good grip as trails and cave surfaces can be slippery."
              />

              <PreparationItem
                icon="◉"
                title={t("home.bringATorch")}
                description="Some sections of the caves are naturally dark, so bring a reliable torch."
                delay={100}
              />

              <PreparationItem
                icon="♧"
                title={t("home.carryWater")}
                description="Stay hydrated during the walk through the tropical rainforest and cave system."
                delay={200}
              />

              <PreparationItem
                icon="☀"
                title={t("home.insectRepellent")}
                description="Bring insect repellent for greater comfort while travelling through the rainforest."
                delay={300}
              />

            </View>

          </View>

        </View>

      </ScrollView>

    </View>
  );
}


// ==================================================
// JOURNEY ITEM
// ==================================================

const JourneyItem = ({
  number,
  title,
  subtitle,
  highlight = false,
  delay = 0,
}) => {
  return (
    <RevealView
      delay={delay}
      style={[
        styles.journeyItem,
        highlight && styles.journeyHighlight,
      ]}
    >

      <View
        style={[
          styles.journeyMarker,
          highlight && styles.journeyMarkerHighlight,
        ]}
      >
        <Text
          style={[
            styles.journeyMarkerText,
            highlight && styles.journeyMarkerTextHighlight,
          ]}
        >
          {number}
        </Text>
      </View>


      <View style={styles.journeyItemText}>

        <Text
          style={[
            styles.journeyItemTitle,
            highlight && styles.journeyItemTitleHighlight,
          ]}
        >
          {translateLabel(title)}
        </Text>

        <Text style={styles.journeyItemSubtitle}>
          {translateLabel(subtitle)}
        </Text>

      </View>

    </RevealView>
  );
};


// ==================================================
// PREPARATION ITEM
// ==================================================

const PreparationItem = ({
  icon,
  title,
  description,
  delay = 0,
}) => {
  return (
    <RevealView
      delay={delay}
      style={styles.preparationItem}
    >

      <View style={styles.preparationIcon}>
        <Text style={styles.preparationIconText}>
          {icon}
        </Text>
      </View>


      <View style={styles.preparationContent}>

        <Text style={styles.preparationTitle}>
          {translateLabel(title)}
        </Text>

        <Text style={styles.preparationDescription}>
          {translateLabel(description)}
        </Text>

      </View>

    </RevealView>
  );
};


// ==================================================
// STYLES
// ==================================================

const styles = StyleSheet.create({
  languageHeader: {
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingBottom: 8,
    backgroundColor: COLORS.offWhite,
  },

  // ==================================================
  // CONTAINER
  // ==================================================

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
  width: '100%',
  height: SCREEN_WIDTH <= 500 ? 430 : 690,
  justifyContent: 'center',
  overflow: 'hidden',
},
  

  
  heroImage: {
    resizeMode: 'cover',
  },

  heroOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(8, 24, 17, 0.50)',
  },


heroContent: {
  alignItems: 'flex-start',
  alignSelf: 'stretch',
  paddingHorizontal: SCREEN_WIDTH < 500 ? 20 : 24,
},

eyebrow: {
  marginBottom: SCREEN_WIDTH < 500 ? 13 : 20,
  color: COLORS.lightGreen,
  fontSize: SCREEN_WIDTH < 500 ? 10 : 14,
  fontWeight: '700',
  letterSpacing: SCREEN_WIDTH < 500 ? 2.8 : 4,
},

  
heroTitle: {
  color: COLORS.cream,
  fontSize:
    SCREEN_WIDTH < 500
      ? 36
      : SCREEN_WIDTH < 900
        ? 58
        : 72,
  lineHeight:
    SCREEN_WIDTH < 500
      ? 41
      : SCREEN_WIDTH < 900
        ? 62
        : 76,
  fontWeight: '800',
},

heroDescription: {
  maxWidth: 560,
  marginTop: SCREEN_WIDTH < 500 ? 18 : 28,
  marginBottom: SCREEN_WIDTH < 500 ? 24 : 36,
  color: '#E0EBDD',
  fontSize: SCREEN_WIDTH < 500 ? 14 : 17,
  lineHeight: SCREEN_WIDTH < 500 ? 22 : 30,
},


  heroHighlight: {
    color: '#7DD1B9',
  },

  heroActions: {
    flexDirection: 'row',
  },

exploreButton: {
  minHeight: SCREEN_WIDTH < 500 ? 44 : undefined,
  paddingVertical: SCREEN_WIDTH < 500 ? 11 : 14,
  paddingHorizontal: SCREEN_WIDTH < 500 ? 21 : 28,
  borderRadius: SCREEN_WIDTH < 500 ? 24 : 30,
  backgroundColor: COLORS.cream,
  justifyContent: 'center',
},

exploreButtonText: {
  color: COLORS.darkGreen,
  fontSize: SCREEN_WIDTH < 500 ? 13 : 14,
  fontWeight: '700',
  textAlign: 'center',
},


  // ==================================================
  // ABOUT
  // ==================================================

aboutSection: {
  paddingVertical:
    SCREEN_WIDTH < 500
      ? 52
      : 100,
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
  gap: SCREEN_WIDTH < 500 ? 30 : 50,
},

  aboutImageWrapper: {
    width: '100%',
    flex: 1,
  },

  aboutImage: {
    width: '100%',

    height:
      SCREEN_WIDTH <= 900
        ? 250
        : 470,

    borderRadius: 20,
  },

aboutImageWrapper: {
  width: '100%',
  flex: 1,
},

aboutStackWrapper: {
  width: '100%',
  height: SCREEN_WIDTH <= 500 ? 292 : SCREEN_WIDTH <= 900 ? 320 : 470,
  position: 'relative',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'visible',
},

aboutStackDeck: {
  width: SCREEN_WIDTH < 500 ? '80%' : '80%',
  maxWidth: 430,
  aspectRatio: 1,
  position: 'relative',
  overflow: 'visible',
},

aboutStackCard: {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  overflow: 'hidden',
  borderRadius: SCREEN_WIDTH < 500 ? 18 : 24,
  backgroundColor: COLORS.paleGreen,
  shadowColor: COLORS.darkGreen,
  shadowOffset: { width: 0, height: 9 },
  shadowOpacity: 0.18,
  shadowRadius: 14,
  elevation: 6,
},

aboutStackCardPressable: {
  width: '100%',
  height: '100%',
},

aboutStackImage: {
  width: '100%',
  height: '100%',
},

aboutStackArrow: {
  position: 'absolute',
  top: '50%',
  width: 44,
  height: 44,
  marginTop: -22,
  alignItems: 'center',
  justifyContent: 'center',
  borderWidth: 1,
  borderColor: 'rgba(70, 133, 133, 0.2)',
  borderRadius: 999,
  backgroundColor: COLORS.cream,
  shadowColor: COLORS.darkGreen,
  shadowOffset: { width: 0, height: 5 },
  shadowOpacity: 0.15,
  shadowRadius: 8,
  elevation: 5,
  zIndex: 10,
},

aboutStackArrowLeft: {
  left: 0,
},

aboutStackArrowRight: {
  right: 0,
},

aboutStackArrowText: {
  marginTop: -2,
  color: COLORS.darkGreen,
  fontSize: SCREEN_WIDTH < 500 ? 25 : 31,
  lineHeight: SCREEN_WIDTH < 500 ? 28 : 33,
  fontWeight: '500',
},


  aboutContent: {
    width: '100%',
    flex: 1,
  },

sectionLabel: {
  marginBottom: SCREEN_WIDTH < 500 ? 9 : 14,
  color: COLORS.green,
  fontSize: SCREEN_WIDTH < 500 ? 10 : 13,
  fontWeight: '700',
  letterSpacing: SCREEN_WIDTH < 500 ? 2 : 3,
},

aboutTitle: {
  marginBottom: SCREEN_WIDTH < 500 ? 16 : 24,
  color: COLORS.darkGreen,
  fontSize:
    SCREEN_WIDTH < 500
      ? 30
      : 52,
  lineHeight:
    SCREEN_WIDTH < 500
      ? 35
      : 58,
  fontWeight: '800',
},

aboutDescription: {
  marginBottom: SCREEN_WIDTH < 500 ? 14 : 18,
  color: COLORS.textGreen,
  fontSize: SCREEN_WIDTH < 500 ? 14 : 16,
  lineHeight: SCREEN_WIDTH < 500 ? 22 : 29,
},


  // ==================================================
  // FACTS
  // ==================================================

aboutFacts: {
  flexDirection: SCREEN_WIDTH < 600 ? 'column' : 'row',
  gap: SCREEN_WIDTH < 500 ? 8 : 12,
  marginTop: SCREEN_WIDTH < 500 ? 14 : 20,
},

factCard: {
  flex: 1,
  paddingVertical: SCREEN_WIDTH < 500 ? 12 : 18,
  paddingHorizontal: SCREEN_WIDTH < 500 ? 8 : 14,
  borderRadius: SCREEN_WIDTH < 500 ? 10 : 14,
  backgroundColor: 'rgba(255, 246, 220, 0.7)',
  borderWidth: 1,
  borderColor: 'rgba(70, 133, 133, 0.12)',
},

factNumber: {
  marginBottom: 6,
  color: COLORS.darkGreen,
  fontSize: SCREEN_WIDTH < 500 ? 16 : 20,
  fontWeight: '800',
},

factLabel: {
  color: '#55716D',
  fontSize: SCREEN_WIDTH < 500 ? 10 : 11,
  lineHeight: SCREEN_WIDTH < 500 ? 14 : 16,
},


  // ==================================================
  // EXPLORE NIAH
  // ==================================================

exploreNiah: {
  width: '88%',
  maxWidth: 1200,
  alignSelf: 'center',
  marginTop:
    SCREEN_WIDTH < 500
      ? 54
      : 100,
},

exploreNiahHeading: {
  maxWidth: 760,
  marginBottom: SCREEN_WIDTH < 500 ? 28 : 42,
},

exploreNiahTitle: {
  color: '#234B3A',
  fontSize:
    SCREEN_WIDTH < 500
      ? 30
      : 54,
  lineHeight:
    SCREEN_WIDTH < 500
      ? 36
      : 60,
  fontWeight: '800',
},

exploreNiahDescription: {
  maxWidth: 680,
  marginTop: SCREEN_WIDTH < 500 ? 12 : 18,
  color: '#60756F',
  fontSize: SCREEN_WIDTH < 500 ? 14 : 16,
  lineHeight: SCREEN_WIDTH < 500 ? 22 : 28,
},


  // ==================================================
  // ATTRACTIONS
  // ==================================================

attractionGrid: {
  flexDirection:
    SCREEN_WIDTH <= 500
      ? 'column'
      : 'row',
  flexWrap: 'wrap',
  gap: SCREEN_WIDTH < 500 ? 14 : 20,
},

attractionCard: {
  overflow: 'hidden',
  borderRadius: SCREEN_WIDTH < 500 ? 20 : 24,
  backgroundColor: '#315F54',
  elevation: 6,
},

attractionFeatured: {
  width:
    SCREEN_WIDTH <= 500
      ? '100%'
      : SCREEN_WIDTH <= 900
        ? '100%'
        : '55%',
  height:
    SCREEN_WIDTH <= 500
      ? 315
      : SCREEN_WIDTH <= 900
        ? 420
        : 530,
},

attractionSmall: {
  width:
    SCREEN_WIDTH <= 500
      ? '100%'
      : SCREEN_WIDTH <= 900
        ? '47%'
        : '40%',
  height:
    SCREEN_WIDTH <= 500
      ? 225
      : 255,
},

  attractionBackground: {
    flex: 1,
  },

  attractionImage: {
    resizeMode: 'cover',
  },

  paintedCaveImage: {
    resizeMode: 'cover',
  },

  rainforestImage: {
    resizeMode: 'cover',
  },

  attractionOverlay: {
    ...StyleSheet.absoluteFillObject,

    backgroundColor: 'rgba(11, 37, 29, 0.52)',
  },

attractionContent: {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  padding:
    SCREEN_WIDTH < 500
      ? 20
      : 38,
},

attractionContentSmall: {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  padding: SCREEN_WIDTH < 500 ? 18 : 30,
},

featuredLabel: {
  marginBottom: SCREEN_WIDTH < 500 ? 7 : 10,
  color: '#BCE8C9',
  fontSize: SCREEN_WIDTH < 500 ? 9 : 10,
  fontWeight: '700',
  letterSpacing: SCREEN_WIDTH < 500 ? 1.5 : 2,
},

attractionTitle: {
  color: COLORS.cream,
  fontSize:
    SCREEN_WIDTH < 500
      ? 26
      : 36,
  lineHeight: SCREEN_WIDTH < 500 ? 31 : 40,
  fontWeight: '800',
},

attractionTitleSmall: {
  color: COLORS.cream,
  fontSize: SCREEN_WIDTH < 500 ? 21 : 27,
  lineHeight: SCREEN_WIDTH < 500 ? 26 : 32,
  fontWeight: '800',
},

attractionDescription: {
  maxWidth: 590,
  marginTop: 8,
  color: '#E3EEE7',
  fontSize: SCREEN_WIDTH < 500 ? 12 : 13,
  lineHeight: SCREEN_WIDTH < 500 ? 18 : 21,
},

attractionDescriptionSmall: {
  marginTop: 8,
  color: '#E3EEE7',
  fontSize: SCREEN_WIDTH < 500 ? 12 : 13,
  lineHeight: SCREEN_WIDTH < 500 ? 18 : 21,
},


  // ==================================================
  // VISITOR OVERVIEW
  // ==================================================

visitorOverview: {
  width:
    SCREEN_WIDTH < 500
      ? '92%'
      : '88%',
  maxWidth: 1200,
  alignSelf: 'center',
  marginTop:
    SCREEN_WIDTH < 500
      ? 40
      : 90,
  overflow: 'hidden',
  borderRadius:
    SCREEN_WIDTH < 500
      ? 18
      : 28,
  backgroundColor: COLORS.deepGreen,
  elevation:
    SCREEN_WIDTH < 500
      ? 4
      : 8,
},

  visitorBackground: {
    width: '100%',
  },

  visitorBackgroundImage: {
    resizeMode: 'cover',
  },

  visitorOverlay: {
    ...StyleSheet.absoluteFillObject,

    backgroundColor: 'rgba(15, 51, 40, 0.84)',
  },

visitorContent: {
  padding:
    SCREEN_WIDTH < 500
      ? 16
      : 48,
},

whyNiahTitle: {
  color: COLORS.cream,
  fontSize:
    SCREEN_WIDTH < 500
      ? 22
      : 36,
  lineHeight:
    SCREEN_WIDTH < 500
      ? 27
      : 43,
  fontWeight: '800',
},

  visitorSectionLabel: {
    color: '#A9E7C4',

    fontSize:
      SCREEN_WIDTH < 500
        ? 10
        : 13,
    fontWeight: '700',

    letterSpacing:
      SCREEN_WIDTH < 500
        ? 2
        : 3,
  },

  whyNiahTitle: {
    color: COLORS.cream,

    fontSize:
      SCREEN_WIDTH < 500
        ? 23
        : 36,

    lineHeight:
      SCREEN_WIDTH < 500
        ? 28
        : 43,

    fontWeight: '800',
  },

whyNiahDescription: {
  marginTop:
    SCREEN_WIDTH < 500
      ? 7
      : 12,
  paddingTop:
    SCREEN_WIDTH < 500
      ? 12
      : 22,
  borderTopWidth: 1,
  borderTopColor: 'rgba(224, 235, 221, 0.24)',
  color: '#E0EBDD',
  fontSize:
    SCREEN_WIDTH < 500
      ? 13
      : 16,
  lineHeight:
    SCREEN_WIDTH < 500
      ? 20
      : 29,
},

  // ==================================================
  // VISITOR INFO
  // ==================================================

  visitorInfo: {
    marginTop:
      SCREEN_WIDTH < 500
        ? 20
        : 38,

    paddingTop:
      SCREEN_WIDTH < 500
        ? 18
        : 30,

    borderTopWidth: 1,
    borderTopColor:
      'rgba(224, 235, 221, 0.2)',
  },

visitorTitle: {
  color: COLORS.cream,
  fontSize:
    SCREEN_WIDTH < 500
      ? 21
      : 34,
  fontWeight: '800',
},

  visitorCards: {
  marginTop:
    SCREEN_WIDTH < 500
      ? 12
      : 22,

  flexDirection: 'row',

  flexWrap: 'wrap',

  gap:
    SCREEN_WIDTH < 500
      ? 8
      : 15,
},

  visitorCard: {
  minHeight:
    SCREEN_WIDTH < 500
      ? 126
      : 168,

  width:
    SCREEN_WIDTH < 600
      ? '48%'
      : SCREEN_WIDTH < 1000
        ? '47%'
        : '18%',

  paddingVertical:
    SCREEN_WIDTH < 500
      ? 11
      : 22,

  paddingHorizontal:
    SCREEN_WIDTH < 500
      ? 11
      : 20,

  borderWidth: 1,

  borderColor:
    'rgba(214, 229, 209, 0.72)',

  borderRadius:
    SCREEN_WIDTH < 500
      ? 13
      : 18,

  backgroundColor:
    'rgba(255, 250, 235, 0.94)',
},

  visitorIcon: {
    width:
      SCREEN_WIDTH < 500
        ? 32
        : 44,
    height:
      SCREEN_WIDTH < 500
        ? 32
        : 44,

    marginBottom:
      SCREEN_WIDTH < 500
        ? 9
        : 19,

    alignItems: 'center',
    justifyContent: 'center',

    borderWidth: 1,
    borderColor:
      'rgba(70, 133, 133, 0.2)',

    borderRadius:
      SCREEN_WIDTH < 500
        ? 9
        : 14,

    backgroundColor: '#E6EEE1',
  },

  iconText: {
    color: '#3F786B',

    fontSize:
      SCREEN_WIDTH < 500
        ? 17
        : 23,
    fontWeight: '500',
  },

  visitorLabel: {
    marginBottom:
      SCREEN_WIDTH < 500
        ? 4
        : 7,

    color: '#607C75',

    fontSize:
      SCREEN_WIDTH < 500
        ? 9
        : 11,
    fontWeight: '700',

    letterSpacing:
      SCREEN_WIDTH < 500
        ? 0.4
        : 0.7,
  },

  visitorValue: {
    color: '#294F47',

    fontSize:
      SCREEN_WIDTH < 500
        ? 12
        : 15,
    fontWeight: '700',

    lineHeight:
      SCREEN_WIDTH < 500
        ? 16
        : 22,
  },

  mapLink: {
    marginTop:
      SCREEN_WIDTH < 500
        ? 5
        : 12,

    color: '#4B7F70',

    fontSize:
      SCREEN_WIDTH < 500
        ? 9
        : 11,
    lineHeight:
      SCREEN_WIDTH < 500
        ? 13
        : 16,
    fontWeight: '700',
  },


  // ==================================================
  // JOURNEY
  // ==================================================

journeySection: {
  paddingVertical:
    SCREEN_WIDTH < 500
      ? 54
      : 110,
  backgroundColor: COLORS.journeyBackground,
},

  journeyContainer: {
    width: '88%',
    maxWidth: 1200,

    alignSelf: 'center',
  },

journeyHeading: {
  maxWidth: 760,
  marginBottom:
    SCREEN_WIDTH < 500
      ? 32
      : 75,
},

journeyTitle: {
  color: '#234B3A',
  fontSize:
    SCREEN_WIDTH < 500
      ? 30
      : 54,
  lineHeight:
    SCREEN_WIDTH < 500
      ? 36
      : 60,
  fontWeight: '800',
},

journeyDescription: {
  maxWidth: 680,
  marginTop: SCREEN_WIDTH < 500 ? 12 : 18,
  color: '#60756F',
  fontSize: SCREEN_WIDTH < 500 ? 14 : 16,
  lineHeight: SCREEN_WIDTH < 500 ? 22 : 28,
},

  journeyRoute: {
    flexDirection:
      SCREEN_WIDTH <= 700
        ? 'column'
        : 'row',

    justifyContent: 'space-between',

    gap:
      SCREEN_WIDTH <= 700
        ? 0
        : 5,
  },

  journeyItem: {
    flex:
      SCREEN_WIDTH <= 700
        ? undefined
        : 1,

    minWidth: 0,

    alignItems:
      SCREEN_WIDTH <= 700
        ? 'flex-start'
        : 'center',

    flexDirection:
      SCREEN_WIDTH <= 700
        ? 'row'
        : 'column',

    textAlign: 'center',
  },

journeyMarker: {
  width: SCREEN_WIDTH < 500 ? 48 : 56,
  height: SCREEN_WIDTH < 500 ? 48 : 56,
  borderWidth: SCREEN_WIDTH < 500 ? 6 : 7,
  borderColor: COLORS.journeyBackground,
  borderRadius: 50,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#E7F2E2',
  elevation: 2,
},

  journeyMarkerHighlight: {
    backgroundColor: '#468585',

    borderColor: COLORS.journeyBackground,

    transform: [{ scale: 1.12 }],
  },

  journeyMarkerText: {
    color: '#3C755F',

    fontSize: 10,
    fontWeight: '800',
  },

  journeyMarkerTextHighlight: {
    color: COLORS.white,
  },

journeyItemText: {
  marginTop:
    SCREEN_WIDTH <= 700
      ? 0
      : 17,
  marginLeft:
    SCREEN_WIDTH <= 700
      ? 15
      : 0,
  marginBottom:
    SCREEN_WIDTH <= 700
      ? 20
      : 0,
  alignItems:
    SCREEN_WIDTH <= 700
      ? 'flex-start'
      : 'center',
},

  journeyItemTitle: {
    color: '#31584C',

    fontSize: 12,

    lineHeight: 17,

    fontWeight: '700',

    textAlign:
      SCREEN_WIDTH <= 700
        ? 'left'
        : 'center',
  },

  journeyItemTitleHighlight: {
    color: '#246149',

    fontSize: 14,
  },

  journeyItemSubtitle: {
    marginTop: 5,

    color: '#85958E',

    fontSize: 11,

    lineHeight: 14,

    textAlign:
      SCREEN_WIDTH <= 700
        ? 'left'
        : 'center',
  },


  // ==================================================
  // EXPLORE PLANTS
  // ==================================================

exploreSection: {
  paddingVertical:
    SCREEN_WIDTH < 500
      ? 56
      : 110,
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
  gap: SCREEN_WIDTH < 500 ? 18 : 30,
  marginBottom: SCREEN_WIDTH < 500 ? 30 : 48,
},
  exploreHeading: {
    maxWidth: 650,

    flex: 1,
  },

  exploreTitle: {
    flexShrink: 1,
    color: '#234B3A',
    fontSize:
      SCREEN_WIDTH < 500
        ? 30
        : 54,
    lineHeight:
      SCREEN_WIDTH < 500
        ? 36
        : 60,
    fontWeight: '800',
  },

  exploreTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SCREEN_WIDTH < 500 ? 12 : 16,
  },

exploreDescription: {
  maxWidth: 560,
  marginTop: SCREEN_WIDTH < 500 ? 12 : 18,
  color: COLORS.mutedText,
  fontSize: SCREEN_WIDTH < 500 ? 14 : 16,
  lineHeight: SCREEN_WIDTH < 500 ? 22 : 27,
},

exploreMoreButton: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: SCREEN_WIDTH < 500 ? 8 : 14,
  minHeight: SCREEN_WIDTH < 500 ? 44 : undefined,
  paddingVertical: SCREEN_WIDTH < 500 ? 11 : 14,
  paddingHorizontal: SCREEN_WIDTH < 500 ? 16 : 22,
  borderWidth: 1,
  borderColor: 'rgba(70, 133, 133, 0.25)',
  borderRadius: 999,
  backgroundColor: COLORS.cream,
},

exploreMoreText: {
  color: COLORS.darkGreen,
  fontSize: SCREEN_WIDTH < 500 ? 12 : 13,
  fontWeight: '700',
},

  buttonArrow: {
    color: COLORS.darkGreen,

    fontSize: SCREEN_WIDTH < 500 ? 15 : 18,
  },


  // ==================================================
  // PLANT CAROUSEL
  // ==================================================

  carouselContent: {
    paddingVertical: 10,

    paddingRight: 20,
  },

plantImageActual: {
  width: '100%',
  height: '100%',
},

  plantCard: {
    width: CARD_WIDTH,

    overflow: 'hidden',

    borderWidth: 1,
    borderColor:
      '#E2EDE0',

    borderRadius: 18,

    backgroundColor: COLORS.white,

    elevation: 4,
  },

  plantImage: {
    width: '100%',

    height: CARD_WIDTH * 0.68,

    position: 'relative',

    overflow: 'hidden',

    backgroundColor: '#E9F7E4',
  },

  plantImagePlaceholder: {
    flex: 1,

    alignItems: 'center',
    justifyContent: 'center',

    backgroundColor: '#E7F2E2',
  },

  plantPlaceholderIcon: {
    fontSize: 55,
  },
  plantPlaceholderText: {
    marginTop: 6,
    color: COLORS.mutedText,
    fontSize: 11,
    textAlign: 'center',
  },

  plantInfo: {
    paddingVertical: SCREEN_WIDTH < 500 ? 13 : 15,
    paddingHorizontal: SCREEN_WIDTH < 500 ? 14 : 16,
  },

  plantName: {
    color: COLORS.darkText,

    fontSize: SCREEN_WIDTH < 500 ? 17 : 19,
    fontWeight: '600',

    lineHeight: SCREEN_WIDTH < 500 ? 21 : 23,
  },

  scientificName: {
    marginTop: 4,

    color: '#6D7F75',

    fontSize: SCREEN_WIDTH < 500 ? 12 : 13,
    fontStyle: 'italic',
  },

  viewPlant: {
    color: '#468585',

    fontSize: SCREEN_WIDTH < 500 ? 10 : 11,
    fontWeight: '700',

    letterSpacing: 0.7,
  },

  
viewPlantButton: {
  alignSelf: 'flex-start',
  minHeight: SCREEN_WIDTH < 500 ? 34 : 40,
  marginTop: SCREEN_WIDTH < 500 ? 4 : 7,
  paddingVertical: SCREEN_WIDTH < 500 ? 7 : 10,
  paddingRight: SCREEN_WIDTH < 500 ? 8 : 10,
  justifyContent: 'center',
},



  // ==================================================
  // CAROUSEL CONTROLS
  // ==================================================

  carouselControls: {
    marginTop: 22,

    flexDirection: 'row',

    justifyContent: 'center',

    gap: 9,
  },

carouselButton: {
  width: SCREEN_WIDTH < 500 ? 42 : 38,
  height: SCREEN_WIDTH < 500 ? 42 : 38,
  alignItems: 'center',
  justifyContent: 'center',
  borderWidth: 1,
  borderColor: 'rgba(70, 133, 133, 0.24)',
  borderRadius: SCREEN_WIDTH < 500 ? 12 : 12,
  backgroundColor: COLORS.cream,
},

carouselButtonText: {
  color: COLORS.darkGreen,
  fontSize: SCREEN_WIDTH < 500 ? 17 : 18,
},


  // ==================================================
  // BEFORE YOU EXPLORE
  // ==================================================
  // ==================================================
  // BEFORE YOU EXPLORE
  // ==================================================

beforeExplore: {
  width: '100%',
  paddingVertical: SCREEN_WIDTH < 500 ? 48 : 100,
  backgroundColor: COLORS.beforeBackground,
},

beforeExploreHeading: {
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: SCREEN_WIDTH < 500 ? 12 : 20,
  marginBottom: SCREEN_WIDTH < 500 ? 26 : 42,
},

  beforeExploreContainer: {
    width: SCREEN_WIDTH < 500 ? '90%' : '88%',
    maxWidth: 1200,
    alignSelf: 'center',
  },



  beforeExploreTitleContainer: {
    width: '100%',
    flex: 1,
  },

beforeExploreTitle: {
  color: '#234B3A',
  fontSize:
    SCREEN_WIDTH < 360
      ? 27
      : SCREEN_WIDTH < 500
        ? 30
        : SCREEN_WIDTH < 900
          ? 42
          : 54,
  lineHeight:
    SCREEN_WIDTH < 360
      ? 33
      : SCREEN_WIDTH < 500
        ? 36
        : SCREEN_WIDTH < 900
          ? 50
          : 60,
  fontWeight: '800',
},

beforeExploreDescription: {
  width: '100%',
  color: '#60756F',
  fontSize: SCREEN_WIDTH < 500 ? 14 : 16,
  lineHeight: SCREEN_WIDTH < 500 ? 22 : 28,
  marginBottom: 0,
},


  // ==================================================
  // PREPARATION GRID
  // ==================================================

  // PREPARATION GRID

preparationGrid: {
  marginTop: SCREEN_WIDTH < 500 ? 0 : 12,
  flexDirection: 'row',
  flexWrap: 'wrap',
  justifyContent: 'space-between',
  rowGap: SCREEN_WIDTH < 500 ? 12 : 18,
  columnGap: SCREEN_WIDTH < 500 ? 0 : 18,
},

preparationItem: {
  width:
    SCREEN_WIDTH < 500
      ? '48%'
      : SCREEN_WIDTH < 900
        ? '48%'
        : '23%',

  flexGrow: 0,
  flexShrink: 0,
  minWidth: 0,

  paddingVertical: SCREEN_WIDTH < 500 ? 16 : 22,
  paddingHorizontal: SCREEN_WIDTH < 500 ? 12 : 18,

  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 12,

  borderWidth: 1,
  borderColor: 'rgba(70, 133, 133, 0.18)',
  borderRadius: 16,
  backgroundColor: 'rgba(247, 251, 244, 0.92)',
},

preparationIcon: {
  width: SCREEN_WIDTH < 500 ? 36 : 44,
  height: SCREEN_WIDTH < 500 ? 36 : 44,
  flexShrink: 0,

  alignItems: 'center',
  justifyContent: 'center',

  borderRadius: 12,
  backgroundColor: '#E7F2E2',
},

preparationIconText: {
  color: '#3C7763',
  fontSize: SCREEN_WIDTH < 500 ? 19 : 22,
},

preparationContent: {
  width: '100%',
  minWidth: 0,
},

preparationTitle: {
  marginBottom: 7,
  color: '#31584C',
  fontSize: SCREEN_WIDTH < 500 ? 13 : 15,
  lineHeight: SCREEN_WIDTH < 500 ? 18 : 22,
  fontWeight: '700',
},

preparationDescription: {
  color: '#71817A',
  fontSize: SCREEN_WIDTH < 500 ? 11 : 13,
  lineHeight: SCREEN_WIDTH < 500 ? 17 : 21,
},

});
