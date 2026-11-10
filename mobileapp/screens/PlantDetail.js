import { t, translateLabel, translateUIMessage, dateLocale, useAppTranslation, translateFieldValue } from "../translations/i18n";
// screens/PlantDetail.js

import React, { useCallback, useEffect, useRef, useState } from "react";

import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  RefreshControl,
  Modal,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";

import {
  getPlantById,
  getSpeciesBySlug,
} from "../data/mockData";
import { fetchPlantDetail, getPlantDisplayObservation, getObservationRecorderDisplayName, getPlantRegisteredByDisplayName, isOwnedPendingPlant, selectLatestApprovedObservation } from "../utils/plantApi";
import RefreshButton from "../components/RefreshButton";
import BackButton from "../components/BackButton";
import FavouriteHeart from "../components/FavouriteHeart";
import useVisitorFavourites from "../hooks/useVisitorFavourites";
import { getPlantLocationDisplay } from "../utils/plantLocationDisplay";
import { stepPhotoIndex, uniquePlantPhotos } from "../utils/plantPhotoGallery";
import { fetchPlantObservationEligibility } from "../utils/fieldSync";
import { DetailSkeletonContent } from "../components/BotanicalSkeleton";


export default function PlantDetail({
  route,
  navigation,
  user,
}) {
  useAppTranslation();
  const { plantId } = route.params || {};
  const focusObservationId = route.params?.focusObservationId;
  const isBotanist = user?.role?.toLowerCase() === "botanist";
  const isVisitor = user?.role?.toLowerCase() === "visitor";
  const favourites = useVisitorFavourites(user);
  const [plant, setPlant] = useState(null);
  const [observationEligibility, setObservationEligibility] = useState("checking");
  const [failedPhotoUris, setFailedPhotoUris] = useState([]);
  const [selectedPhotoUri, setSelectedPhotoUri] = useState(null);
  const [imageViewerVisible, setImageViewerVisible] = useState(false);
  const locationDisplay = getPlantLocationDisplay(plant?.location, user?.role);
  const ownPendingPlant = isBotanist && isOwnedPendingPlant(plant, user?.id);
  const locationZoneValue = locationDisplay.zone || (
    locationDisplay.status === "restricted"
      ? t("map.locationRestricted")
      : plant?.currentStatus === "Approved" || ownPendingPlant
        ? t("plant.notRecorded")
        : t("plantDetail.locationUnavailableUntilApproved")
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const requestRef = useRef(null);
  const activePlantIdRef = useRef(plantId);
  const plantApprovalStatus = String(observationEligibility === "checking"
    ? plant?.currentStatus || "checking"
    : observationEligibility).trim().toLowerCase();
  const canAddObservation = plantApprovalStatus === "approved";
  const isPendingInitialReview = plant?.currentStatus === "Pending Review";
  const showObservationHistory = isBotanist && !isPendingInitialReview;
  const observationBlockedMessageKey = plantApprovalStatus === "pending review" || plantApprovalStatus === "pending"
    ? "fieldCollection.plantObservationPendingApproval"
    : plantApprovalStatus === "rejected"
      ? "fieldCollection.plantObservationRejected"
      : plantApprovalStatus === "correction required" || plantApprovalStatus === "correctionrequired"
        ? "fieldCollection.plantObservationCorrectionRequired"
        : plantApprovalStatus === "checking"
          ? "fieldCollection.checkingPlantApproval"
          : "fieldCollection.plantObservationEligibilityUnavailable";

  /* eslint-disable react-hooks/set-state-in-effect -- clear the previous record when the route target changes. */
  useEffect(() => {
    activePlantIdRef.current = plantId;
    requestRef.current = null;
    setSelectedPhotoUri(null);
    setFailedPhotoUris([]);
    setImageViewerVisible(false);
    setPlant(null);
    setObservationEligibility("checking");
  }, [plantId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const loadPlant = useCallback((isRefresh = false) => {
    if (requestRef.current) return requestRef.current;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setErrorMessage("");
    if (isBotanist) setObservationEligibility("checking");

    if (!/^\d+$/.test(String(plantId ?? ""))) {
      setPlant(getPlantById(plantId) || null);
      setLoading(false);
      setRefreshing(false);
      return Promise.resolve();
    }

    const request = (async () => {
      try {
        const options = { includeObservations: isBotanist, accountId: user?.id };
        let backendPlant;
        if (isBotanist) {
          try {
            backendPlant = await fetchPlantDetail(plantId, { ...options, scopeMine: true });
          } catch (error) {
            if (error?.status !== 404) throw error;
            backendPlant = await fetchPlantDetail(plantId, options);
          }
        } else {
          backendPlant = await fetchPlantDetail(plantId, options);
        }
        if (String(activePlantIdRef.current) === String(plantId)) {
          setPlant(backendPlant);
          if (isBotanist) {
            const eligibility = await fetchPlantObservationEligibility(user?.id, plantId);
            if (String(activePlantIdRef.current) === String(plantId)) setObservationEligibility(eligibility);
          }
        }
      } catch (error) {
        if (String(activePlantIdRef.current) === String(plantId)) {
          setErrorMessage(error.message || "Unable to load this plant record.");
          if (isBotanist) setObservationEligibility("unavailable");
        }
      } finally {
        if (String(activePlantIdRef.current) === String(plantId)) {
          if (requestRef.current === request) requestRef.current = null;
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();
    requestRef.current = request;
    return request;
  }, [plantId, isBotanist, user]);

  useFocusEffect(useCallback(() => {
    void loadPlant(false);
  }, [loadPlant]));

  // =====================================================
  // PLANT NOT FOUND
  // =====================================================

  if (loading && !plant) {
    return (
      <View style={styles.viewerRoot}>
        <ScrollView style={styles.container} contentContainerStyle={{ flexGrow: 1 }}>
          <View style={styles.header}><View style={styles.heroToolbar}>
            <BackButton label={t("plant.back")} variant="glass" onPress={() => navigation.goBack()} />
            <RefreshButton onPress={() => { void loadPlant(false); }} loading={loading} label={t("common.refresh")} testID="plant-detail-loading-retry" />
          </View></View>
          <DetailSkeletonContent label={t("plantDetail.loadingPlantRecord")} sections={4} />
        </ScrollView>
      </View>
    );
  }

  if (!plant) {
    return (
      <View style={styles.notFoundContainer}>

        <View style={[styles.heroToolbar, { width: "100%", justifyContent: "space-between" }]}>
          <BackButton label={t("plant.back")} variant="glass" onPress={() => navigation.goBack()} />
          <RefreshButton onPress={() => { void loadPlant(false); }} loading={loading} label={t("common.tryAgain")} testID="plant-detail-error-retry" />
        </View>

        <Text style={styles.notFoundIcon}>
          🌿
        </Text>

        <Text style={styles.notFoundTitle}>{errorMessage ? t("plantDetail.plantDetailsUnavailable") : t("plantDetail.plantRecordNotFound")}</Text>

        <Text style={styles.notFoundText}>
          {errorMessage || t("plantDetail.thePlantRecordYouAreLookingForDoesNotExist")}
        </Text>

      </View>
    );
  }


  // =====================================================
  // FIND SPECIES
  // =====================================================

  const selectedSpecies = plant.species || getSpeciesBySlug(plant.speciesSlug) || {
    name: plant.commonName,
    scientificName: plant.scientificName,
    genus: plant.genus,
  };
  const displayedObservation = getPlantDisplayObservation(plant);
  const plantPhotos = uniquePlantPhotos(plant.photos);
  const displayablePhotos = plantPhotos.filter((photo) => !failedPhotoUris.includes(photo.uri));
  const selectedPhoto = displayablePhotos.find((photo) => photo.uri === selectedPhotoUri) || displayablePhotos[0] || null;
  const activePhotoIndex = selectedPhoto ? displayablePhotos.findIndex((photo) => photo.uri === selectedPhoto.uri) : 0;
  const changePhoto = (direction) => setSelectedPhotoUri(displayablePhotos[stepPhotoIndex(activePhotoIndex, direction, displayablePhotos.length)]?.uri || null);
  const failPhoto = (uri, ownerPlantId = plantId) => {
    if (String(activePlantIdRef.current) !== String(ownerPlantId)) return;
    const failed = new Set([...failedPhotoUris, uri]);
    if (plantPhotos.every((photo) => failed.has(photo.uri))) setImageViewerVisible(false);
    setFailedPhotoUris((current) => current.includes(uri) ? current : [...current, uri]);
  };


  // =====================================================
  // SORT OBSERVATIONS
  // =====================================================

  const sortedObservations = [
    ...(plant.observations || []),
  ].sort((a, b) => {
    return (
      new Date(b.date).getTime() -
      new Date(a.date).getTime()
    );
  });


  // =====================================================
  // LATEST APPROVED OBSERVATION
  // =====================================================

  const latestApprovedObservation = selectLatestApprovedObservation(plant.observations || []);


  // =====================================================
  // SCREEN
  // =====================================================

  return (
    <View style={styles.viewerRoot}>
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing || favourites.refreshing}
          onRefresh={() => { void loadPlant(true); void favourites.refresh(true); }}
          tintColor="#468585"
          colors={["#468585"]}
        />
      }
    >

      {/* =================================================
    PLANT HERO
================================================= */}

<View style={styles.header}>
  {!!errorMessage && (
    <Text style={styles.refreshError}>{translateUIMessage(errorMessage)}</Text>
  )}
  <View style={styles.heroToolbar}>
  <BackButton label={t("plant.back")} variant="glass" onPress={() => navigation.goBack()} />
  <RefreshButton
    onPress={() => { void loadPlant(true); void favourites.refresh(true); }}
    loading={loading || refreshing || favourites.refreshing}
    label={t("common.refresh")}
    testID="plant-detail-refresh"
  />
  {isVisitor && <FavouriteHeart
    active={favourites.isFavourite("plant", plant.plantId)}
    pending={favourites.isPending("plant", plant.plantId)}
    disabled={favourites.loading}
    onPress={() => void favourites.toggle("plant", plant.plantId)}
  />}
  </View>
  {!!favourites.mutationError && <Text accessibilityRole="alert" style={styles.refreshError}>{translateUIMessage(favourites.mutationError)}</Text>}

  <View style={styles.heroGrid}>
    {/* Plant image */}
    <View style={styles.imageColumn}>
      <View style={styles.imageFrame}>
        {selectedPhoto ? (
          <TouchableOpacity style={styles.mainImageTap} accessibilityRole="button" accessibilityLabel={`${t("plantDetail.photoNumber", { value0: activePhotoIndex + 1 })}, ${activePhotoIndex + 1} / ${displayablePhotos.length}`} activeOpacity={0.95} onPress={() => setImageViewerVisible(true)}>
            <Image
              source={{ uri: selectedPhoto.uri, ...(selectedPhoto.headers ? { headers: selectedPhoto.headers } : {}) }}
              style={styles.plantImage}
              resizeMode="cover"
              onError={() => failPhoto(selectedPhoto.uri)}
            />
          </TouchableOpacity>
        ) : (
          <View style={styles.imagePlaceholder}>
            <Text style={styles.placeholderIcon}>🌿</Text>
            <Text style={styles.placeholderText}>
              {plant.photoLoadError || (plantPhotos.length > 0 && displayablePhotos.length === 0)
                ? t("plantDetail.photoUnavailable")
                : t("plantDetail.fieldPhotographComingSoon")}
            </Text>
          </View>
        )}
      </View>

      {displayablePhotos.length > 1 && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbnailList}>
            {displayablePhotos.map((photo, index) => (
              <TouchableOpacity
                key={photo.uri}
                accessibilityRole="button"
                accessibilityLabel={`${t("plantDetail.photoNumber", { value0: index + 1 })}, ${index + 1} / ${displayablePhotos.length}`}
                accessibilityState={{ selected: index === activePhotoIndex }}
                onPress={() => setSelectedPhotoUri(photo.uri)}
                style={[styles.thumbnailButton, index === activePhotoIndex && styles.thumbnailSelected]}
              >
                <Image source={{ uri: photo.uri, ...(photo.headers ? { headers: photo.headers } : {}) }} style={styles.thumbnailImage} resizeMode="cover" onError={() => failPhoto(photo.uri)} />
              </TouchableOpacity>
            ))}
          </ScrollView>
          <View style={styles.photoNavigation}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("plantDetail.previousPhoto")} onPress={() => changePhoto(-1)} style={styles.photoNavButton}>
              <Text style={styles.photoNavText}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.photoCounter}>{activePhotoIndex + 1} / {displayablePhotos.length}</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("plantDetail.nextPhoto")} onPress={() => changePhoto(1)} style={styles.photoNavButton}>
              <Text style={styles.photoNavText}>›</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>

    {/* Plant information */}
    <View style={styles.heroCopy}>
      <Text style={styles.headerLabel}>{t("plantDetail.plantRecord")}</Text>

      <Text style={styles.plantId}>{t("fieldCollection.plant")}{plant.plantId}
      </Text>

      <Text style={styles.speciesName}>
        {plant.plantScientificName || t("plant.notRecorded")}
      </Text>

      <Text style={styles.scientificName}>
        {selectedSpecies?.name ? `${t("plantDetail.species")}: ${selectedSpecies.name}` : ""}
      </Text>

      <View style={styles.heroBadges}>
        {isBotanist && (
          <Text style={styles.heroBadge}>
            {translateLabel(displayedObservation?.healthStatus || t("plant.notRecorded"))}
          </Text>
        )}

        <Text style={styles.heroBadge}>
          {translateLabel(displayedObservation?.lifeStage || t("plant.notRecorded"))}
        </Text>

        {isBotanist && (
          <Text style={styles.heroBadge}>
            {locationZoneValue}
          </Text>
        )}
      </View>
    </View>
  </View>
</View>

      {/* =================================================
          CURRENT PLANT RECORD
      ================================================= */}

      <View style={styles.section}>

        <Text style={styles.sectionLabel}>{plant.currentStatus === "Approved" ? t("plantDetail.currentVerifiedRecord") : t("plantDetail.submittedPlantInformation")}</Text>

        <Text style={styles.sectionTitle}>{t("plantDetail.plantInformation")}</Text>


        <View style={styles.card}>

          <InfoRow
            label={t("plantDetail.plantId")}
            value={plant.plantId}
          />

          {isBotanist && plant.latestSubmission?.status ? (
            <InfoRow
              label={t("botanistRecords.observationStatus")}
              value={translateLabel(plant.latestSubmission.status)}
            />
          ) : null}

          <InfoRow
            label={t("plantDetail.species")}
            value={
              selectedSpecies
                ? selectedSpecies.name
                : plant.speciesSlug
            }
          />

          <InfoRow
            label={t("plantDetail.scientificName")}
            value={plant.plantScientificName || t("plant.notRecorded")}
            italic
          />

          <InfoRow
            label={t("plant.height")}
            value={displayedObservation?.heightCm != null ? `${displayedObservation.heightCm} cm` : t("plant.notRecorded")}
          />

          {isBotanist && (
            <InfoRow
              label={t("plantDetail.healthStatus")}
              value={displayedObservation?.healthStatus || t("plant.notRecorded")}
            />
          )}

          <InfoRow
            label={t("plant.lifeStage")}
            value={
              displayedObservation?.lifeStage || t("plant.notRecorded")
            }
          />

          <InfoRow
            label={t("plant.genus")}
              value={selectedSpecies?.genus || t("plant.notRecorded")}
          />

          <InfoRow
            label={t("plantDetail.lastVerified")}
            value={formatDate(plant.latestApproved?.date)}
          />

          {isBotanist && (
            <InfoRow
              label={t("plantDetail.locationZone")}
              value={locationZoneValue}
            />
          )}

          <InfoRow
            label={t("botanistPlantDetail.morphology")}
            value={
              displayedObservation?.morphology || t("plant.notRecorded")
            }
          />

          {plant.currentStatus !== "Approved" && displayedObservation?.notes ? (
            <InfoRow label={t("plantDetail.notes")} value={displayedObservation.notes} />
          ) : null}

        </View>

      </View>

      {/* =================================================
          STAFF RECORD
      ================================================= */}

      {isBotanist && (
      <View style={styles.staffSection}>

        <Text style={styles.sectionLabel}>{t("plantDetail.staffRecord")}</Text>


        {/* GPS */}

        <View style={styles.subSection}>

          <Text style={styles.subSectionTitle}>{t("plantDetail.gpsInformation")}</Text>


          {locationDisplay.status === "available" ? (
            <>
              <InfoRow label={t("botanistPlantDetail.latitude")} value={formatCoordinate(locationDisplay.latitude)} />
              <InfoRow label={t("botanistPlantDetail.longitude")} value={formatCoordinate(locationDisplay.longitude)} />
            </>
          ) : (
            <InfoRow
              label={t("map.location")}
              value={locationDisplay.status === "restricted" ? t("map.locationRestricted") : plant.currentStatus === "Approved" ? t("map.locationNotRecorded") : t("plantDetail.locationUnavailableUntilApproved")}
            />
          )}

          <InfoRow
            label={t("plantDetail.altitude")}
            value={locationDisplay.status === "restricted" ? t("map.locationRestricted") : locationDisplay.altitudeM != null ? `${locationDisplay.altitudeM} m` : plant.currentStatus === "Approved" ? t("plant.notRecorded") : t("plantDetail.locationUnavailableUntilApproved")}
          />

          <InfoRow
            label={t("plantDetail.gpsAccuracy")}
            value={locationDisplay.status === "restricted" ? t("map.locationRestricted") : locationDisplay.accuracyM != null ? `± ${locationDisplay.accuracyM} m` : plant.currentStatus === "Approved" ? t("plant.notRecorded") : t("plantDetail.locationUnavailableUntilApproved")}
          />

        </View>


        {/* QR CODE */}

        <View style={styles.subSection}>

          <Text style={styles.subSectionTitle}>{t("plantDetail.qrTag")}</Text>


          <InfoRow
            label={t("plantDetail.qrCode")}
            value={plant.qr?.label || plant.qr?.code || t("plant.notRecorded")}
          />


          <View
            style={[
              styles.qrStatus,
              plant.qr?.status === "Active"
                ? styles.qrActive
                : styles.qrInactive,
            ]}
          >

            <Text
              style={[
                styles.qrStatusText,
                plant.qr?.status === "Active"
                  ? styles.qrActiveText
                  : styles.qrInactiveText,
              ]}
            >
              {translateLabel(plant.qr?.status || t("plant.notRecorded"))}
            </Text>

          </View>

        </View>


        {/* REGISTRATION */}

        <View style={styles.subSection}>

          <Text style={styles.subSectionTitle}>{t("plantDetail.registration")}</Text>


          <InfoRow
            label={t("plantDetail.registeredBy")}
            value={getPlantRegisteredByDisplayName(plant, user, t("plantDetail.unknownBotanist"))}
          />

          <InfoRow
            label={t("plantDetail.registeredAt")}
            value={formatDate(
              plant.registeredAt
            )}
          />

        </View>

      </View>
      )}

      {isBotanist && plant.currentStatus === "Approved" && (
        <View style={styles.addObservationSection}>
          <TouchableOpacity
            style={[styles.addObservationButton, !canAddObservation && styles.addObservationButtonDisabled]}
            disabled={!canAddObservation}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canAddObservation }}
            activeOpacity={0.8}
            onPress={() =>
              navigation.navigate("AddObservation", {
                plantId: plant.plantId,
              })
            }
          >
            <Text style={styles.addObservationButtonText}>{t("plantDetail.addNewObservation")}</Text>
          </TouchableOpacity>
          {!canAddObservation && <Text style={styles.addObservationUnavailableText}>{t(observationBlockedMessageKey)}</Text>}
        </View>
      )}

      {/* =================================================
          LATEST VERIFIED OBSERVATION
      ================================================= */}

      {showObservationHistory && (
        <View style={styles.observesection}>

          <Text style={styles.sectionLabel}>{t("plantDetail.latestVerifiedObservation")}</Text>

          <Text style={styles.sectionTitle}>{t("plantDetail.observationDetails")}</Text>

          {latestApprovedObservation ? (
          <View style={styles.observationCard}>

            <InfoRow
              label={t("plantDetail.recordedBy")}
              value={
                getObservationRecorderDisplayName(latestApprovedObservation, user, t("plantDetail.unknownBotanist"))
              }
            />

            <InfoRow
              label={t("plantDetail.date")}
              value={formatDate(
                latestApprovedObservation.date
              )}
            />

            <InfoRow
              label={t("plant.height")}
              value={latestApprovedObservation.heightCm != null ? `${latestApprovedObservation.heightCm} cm` : t("plant.notRecorded")}
            />

            <InfoRow
              label={t("plantDetail.healthStatus")}
              value={
                latestApprovedObservation.healthStatus
              }
            />

            <InfoRow
              label={t("plant.lifeStage")}
              value={
                latestApprovedObservation.lifeStage
              }
            />

            <InfoRow
              label={t("botanistPlantDetail.morphology")}
              value={
                latestApprovedObservation.morphology
              }
            />

            <InfoRow
              label={t("plantDetail.notes")}
              value={
                latestApprovedObservation.notes
              }
            />

            {latestApprovedObservation.taxonomy ? (
              <InfoRow label={t("recordEdits.taxonomy")} value={latestApprovedObservation.taxonomy} />
            ) : null}

            <ObservationPhotos photos={latestApprovedObservation.photos} />

          </View>
          ) : (
            <View style={styles.emptyHistory}>
              <Text style={styles.emptyText}>{t("plantDetail.noVerifiedObservationAvailable")}</Text>
            </View>
          )}

        </View>
      )}


      {/* =================================================
          OBSERVATION HISTORY
      ================================================= */}

      {showObservationHistory && (
      <View style={styles.historySection}>

        <Text style={styles.sectionLabel}>{t("plantDetail.observationHistory")}</Text>

        <Text style={styles.sectionTitle}>{t("plantDetail.fieldRecordTimeline")}</Text>


        {sortedObservations.length === 0 ? (

          <View style={styles.emptyHistory}>

            <Text style={styles.emptyText}>{t("plantDetail.noObservationHistoryAvailable")}</Text>

          </View>

        ) : (

          sortedObservations.map(
            (observation) => (
              <ObservationCard
                key={observation.observationId}
                observation={observation}
                user={user}
                initiallyOpen={String(observation.observationId) === String(focusObservationId)}
              />
            )
          )

        )}

      </View>
      )}

    </ScrollView>
    <Modal visible={imageViewerVisible && Boolean(selectedPhoto)} animationType="fade" onRequestClose={() => setImageViewerVisible(false)}>
      <View style={styles.imageViewer}>
        <View style={styles.viewerTopBar}>
          <View />
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("plantDetail.closeImageViewer")} onPress={() => setImageViewerVisible(false)} style={styles.viewerCloseButton}>
            <Text style={styles.viewerCloseText}>×</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.viewerStage}>
          {selectedPhoto ? (
            <Image
              key={selectedPhoto.uri}
              source={{ uri: selectedPhoto.uri, ...(selectedPhoto.headers ? { headers: selectedPhoto.headers } : {}) }}
              style={styles.viewerImage}
              resizeMode="contain"
              onError={() => failPhoto(selectedPhoto.uri)}
            />
          ) : <Text style={styles.viewerFallback}>{t("plantDetail.fieldPhotographComingSoon")}</Text>}
          {displayablePhotos.length > 1 && (
            <>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("plantDetail.previousPhoto")} onPress={() => changePhoto(-1)} style={[styles.viewerNavButton, styles.viewerNavPrevious]}>
                <Text style={styles.viewerNavText}>‹</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("plantDetail.nextPhoto")} onPress={() => changePhoto(1)} style={[styles.viewerNavButton, styles.viewerNavNext]}>
                <Text style={styles.viewerNavText}>›</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
        {displayablePhotos.length > 1 && <Text style={styles.viewerCounter}>{activePhotoIndex + 1} / {displayablePhotos.length}</Text>}
      </View>
    </Modal>
    </View>
  );
}


// =====================================================
// INFO ROW
// =====================================================

function InfoRow({
  label,
  value,
  italic = false,
}) {
  useAppTranslation();
  return (
    <View style={styles.infoRow}>

      <Text style={styles.infoLabel}>
        {translateLabel(label)}
      </Text>

      <Text
        style={[
          styles.infoValue,
          italic && styles.italicValue,
        ]}
      >
        {translateFieldValue(label, value || "-")}
      </Text>

    </View>
  );
}


// =====================================================
// OBSERVATION CARD
// =====================================================

function ObservationCard({ observation, user, initiallyOpen = false }) {
  useAppTranslation();
  const [isOpen, setIsOpen] = useState(initiallyOpen);

  return (
    <View style={styles.historyCard}>
      <TouchableOpacity
        style={styles.historyHeader}
        onPress={() => setIsOpen(!isOpen)}
        activeOpacity={0.8}
      >
        <View style={styles.historyHeaderText}>
          <Text style={styles.observationDate}>
            {formatDate(observation.date)}
          </Text>

          <Text style={styles.recordedBy}>{t("plantDetail.recordedBy2")}{getObservationRecorderDisplayName(observation, user, t("plantDetail.unknownBotanist"))}
          </Text>
        </View>

        <View style={styles.observationHeaderRight}>
          <View
            style={[
              styles.statusBadge,
              observation.status === "Approved"
                ? styles.approvedBadge
                : styles.pendingBadge,
            ]}
          >
            <Text
              style={[
                styles.statusText,
                observation.status === "Approved"
                  ? styles.approvedText
                  : styles.pendingText,
              ]}
            >
              {translateLabel(observation.status)}
            </Text>
          </View>

          <Text style={styles.observationArrow}>
            {isOpen ? "▲" : "▼"}
          </Text>
        </View>
      </TouchableOpacity>

      {isOpen && (
        <View>
          <View style={styles.divider} />

          <Text style={styles.observationId}>
            {t("plantDetail.fieldObservation")}
          </Text>

          <Text style={styles.observationSummary}>
            {observation.heightCm != null ? t("plantDetail.cm", { heightCm: observation.heightCm }) : t("plantDetail.heightNotRecorded")}
            {" • "}
            {observation.healthStatus || t("plant.notRecorded")}
            {" • "}
            {observation.lifeStage || t("plant.notRecorded")}
          </Text>

          <Text style={styles.historyLabel}>{t("botanistPlantDetail.morphology")}</Text>

          <Text style={styles.historyValue}>
            {observation.morphology || t("plant.notRecorded")}
          </Text>

          {observation.notes && (
            <>
              <Text style={styles.historyLabel}>{t("plantDetail.notes")}</Text>

              <Text style={styles.notes}>
                {observation.notes}
              </Text>
            </>
          )}

          {observation.taxonomy ? (
            <>
              <Text style={styles.historyLabel}>{t("recordEdits.taxonomy")}</Text>
              <Text style={styles.historyValue}>{observation.taxonomy}</Text>
            </>
          ) : null}

          <ObservationPhotos photos={observation.photos} />
        </View>
      )}
    </View>
  );
}

function ObservationPhotos({ photos }) {
  if (!photos?.length) return null;
  return (
    <View style={styles.observationPhotosSection}>
      <Text style={styles.historyLabel}>{t("plantDetail.observationPhotos")}</Text>
      <View style={styles.observationPhotosRow}>
        {photos.map((photo, index) => (
          <Image
            key={photo.id}
            source={{ uri: photo.uri, ...(photo.headers ? { headers: photo.headers } : {}) }}
            style={styles.observationPhoto}
            resizeMode="cover"
            accessibilityLabel={t("plantDetail.photoNumber", { value0: index + 1 })}
          />
        ))}
      </View>
    </View>
  );
}


// =====================================================
// DATE FORMAT
// =====================================================

function formatDate(dateString) {
  if (!dateString) {
    return "-";
  }
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString(dateLocale(), {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatCoordinate(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))
    ? Number(value).toFixed(6)
    : "Not recorded";
}


// =====================================================
// STYLES
// =====================================================

const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: "#F7FBF4",
  },

  viewerRoot: { flex: 1 },
  imageColumn: { width: "100%" },
  mainImageTap: { width: "100%", height: "100%" },
  thumbnailList: { gap: 9, paddingTop: 11, paddingHorizontal: 2 },
  thumbnailButton: { width: 64, height: 64, overflow: "hidden", borderRadius: 10, borderWidth: 2, borderColor: "transparent", backgroundColor: "#DCE8D6" },
  thumbnailSelected: { borderColor: "#468585" },
  thumbnailImage: { width: "100%", height: "100%" },
  photoNavigation: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 18, paddingTop: 7 },
  photoNavButton: { width: 38, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 17, backgroundColor: "#DCE8D6" },
  photoNavText: { color: "#315B49", fontSize: 24, lineHeight: 28, fontWeight: "700" },
  photoCounter: { minWidth: 42, color: "#405F56", textAlign: "center", fontSize: 13, fontWeight: "700" },
  imageViewer: { flex: 1, paddingHorizontal: 12, paddingTop: 30, paddingBottom: 18, backgroundColor: "#101812" },
  viewerTopBar: { height: 48, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  viewerCloseButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: "#FFFFFF20" },
  viewerCloseText: { color: "#FFFFFF", fontSize: 30, lineHeight: 34 },
  viewerStage: { flex: 1, alignItems: "center", justifyContent: "center" },
  viewerImage: { width: "100%", height: "100%" },
  viewerFallback: { color: "#FFFFFF", fontSize: 14 },
  viewerNavButton: { position: "absolute", top: "45%", width: 46, height: 54, alignItems: "center", justifyContent: "center", borderRadius: 27, backgroundColor: "#FFFFFF35" },
  viewerNavPrevious: { left: 4 },
  viewerNavNext: { right: 4 },
  viewerNavText: { color: "#FFFFFF", fontSize: 36, lineHeight: 40, fontWeight: "600" },
  viewerCounter: { paddingVertical: 12, color: "#FFFFFF", textAlign: "center", fontSize: 14, fontWeight: "700" },


  // ===================================================
  // HEADER
  // ===================================================

  
header: {
  paddingHorizontal: 20,
  paddingTop: 50,
  paddingBottom: 30,
  backgroundColor: "#E7F2E2",
},

refreshError: {
  marginBottom: 14,
  paddingHorizontal: 14,
  paddingVertical: 10,
  borderRadius: 12,
  color: "#8A2D2D",
  backgroundColor: "#FCE8E6",
  fontSize: 12,
  lineHeight: 18,
},

heroToolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20 },

heroGrid: {
  flexDirection: "column",
  gap: 22,
},

imageFrame: {
  width: "100%",
  height: 260,
  borderRadius: 20,
  overflow: "hidden",
  backgroundColor: "#DCE8D6",
},

plantImage: {
  width: "100%",
  height: "100%",
},

imagePlaceholder: {
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
  backgroundColor: "#DCE8D6",
},

placeholderIcon: {
  fontSize: 42,
  marginBottom: 12,
},

placeholderText: {
  color: "#577265",
  fontSize: 12,
  textAlign: "center",
},

heroCopy: {
  paddingHorizontal: 2,
},

headerLabel: {
  alignSelf: "flex-start",
  marginBottom: 10,
  color: "#468585",
  fontSize: 10,
  fontWeight: "700",
  letterSpacing: 1.5,
},

plantId: {
  color: "#234B3A",
  fontSize: 30,
  fontWeight: "700",
  letterSpacing: -0.6,
},

speciesName: {
  marginTop: 8,
  color: "#6D7F75",
  fontSize: 19,
  fontWeight: "600",
  lineHeight: 26,
},

scientificName: {
  marginTop: 5,
  color: "#6D7F75",
  fontSize: 14,
  fontStyle: "italic",
  lineHeight: 21,
},

heroBadges: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 18,
},

heroBadge: {
  overflow: "hidden",
  paddingHorizontal: 12,
  paddingVertical: 8,
  borderRadius: 20,
  backgroundColor: "#D2E4D0",
  color: "#468585",
  fontSize: 11,
  fontWeight: "600",
},


  // ===================================================
  // SECTION
  // ===================================================

  section: {
    padding: 22,
  },

  observesection: {
    padding: 22,
    paddingTop:30,
    paddingBottom: 50,
    marginBottom:20,
    backgroundColor: "#E9F7E4",
  }, 

  sectionLabel: {
    marginBottom: 8,
    color: "#468585",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.7,
  },

  sectionTitle: {
    marginBottom: 18,
    color: "#234B3A",
    fontSize: 27,
    fontWeight: "600",
  },


  // ===================================================
  // CARD
  // ===================================================

  card: {
    padding: 18,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    elevation: 3,
    shadowColor: "#21392C",
    shadowOpacity: 0.08,
    shadowRadius: 10,
  },

  addObservationSection: {
    paddingHorizontal: 22,
    paddingBottom: 26,
  },

  addObservationButton: {
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: "#468585",
  },
  addObservationButtonDisabled: { opacity: 0.52 },
  addObservationUnavailableText: { marginTop: 8, color: "#77501D", fontSize: 13, lineHeight: 19 },

  addObservationButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },

  infoRow: {
    marginBottom: 17,
  },

  infoLabel: {
    marginBottom: 4,
    color: "#7C8982",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },

  infoValue: {
    color: "#234B3A",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
  },

  italicValue: {
    fontStyle: "italic",
  },


  // ===================================================
  // STAFF
  // ===================================================

  staffSection: {
    marginHorizontal: 20,
    marginBottom: 50,
    padding: 20,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    elevation: 3,
    shadowColor: "#21392C",
    shadowOpacity: 0.08,
    shadowRadius: 10,
  },

  subSection: {
    marginTop: 8,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: "#E6E8E0",
  },

  subSectionTitle: {
    marginBottom: 15,
    color: "#234B3A",
    fontSize: 16,
    fontWeight: "700",
  },


  // ===================================================
  // QR STATUS
  // ===================================================

  qrStatus: {
    alignSelf: "flex-start",
    marginTop: -5,
    marginBottom: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },

  qrActive: {
    backgroundColor: "#D8EBD9",
  },

  qrInactive: {
    backgroundColor: "#F4E0DE",
  },

  qrStatusText: {
    fontSize: 9,
    fontWeight: "700",
    textTransform: "uppercase",
  },

  qrActiveText: {
    color: "#34785D",
  },

  qrInactiveText: {
    color: "#A34E45",
  },


  // ===================================================
  // LATEST OBSERVATION
  // ===================================================

  observationCard: {
    padding: 18,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    elevation: 2,
    shadowOpacity: 0.06,
    shadowRadius: 8,
  },

  observationHeaderRight: {
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
},

observationArrow: {
  color: "#468585",
  fontSize: 10,
  fontWeight: "700",
},


  // ===================================================
  // HISTORY
  // ===================================================

  historySection: {
    padding: 22,
  },

  historyCard: {
    marginBottom: 14,
    padding: 16,
    borderRadius: 15,
    backgroundColor: "#FFFFFF",
    elevation: 2,
    shadowColor: "#21392C",
    shadowOpacity: 0.06,
    shadowRadius: 8,
  },

  historyHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  historyHeaderText: {
    flex: 1,
  },

  observationDate: {
    color: "#234B3A",
    fontSize: 13,
    fontWeight: "700",
  },

  recordedBy: {
    marginTop: 4,
    color: "#7C8982",
    fontSize: 10,
  },

  statusBadge: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
  },

  approvedBadge: {
    backgroundColor: "#D8EBD9",
  },

  pendingBadge: {
    backgroundColor: "#F4E7D2",
  },

  statusText: {
    fontSize: 8,
    fontWeight: "700",
    textTransform: "uppercase",
  },

  approvedText: {
    color: "#34785D",
  },

  pendingText: {
    color: "#8A6939",
  },

  divider: {
    height: 1,
    marginVertical: 13,
    backgroundColor: "#E7E8E1",
  },

  observationId: {
    color: "#234B3A",
    fontSize: 12,
    fontWeight: "700",
  },

  observationSummary: {
    marginTop: 6,
    color: "#6D7F75",
    fontSize: 11,
    fontWeight: "600",
  },

  historyLabel: {
    marginTop: 13,
    marginBottom: 4,
    color: "#7C8982",
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },

  historyValue: {
    color: "#6D7F75",
    fontSize: 11,
    lineHeight: 17,
  },

  observationPhotosSection: {
    marginTop: 4,
  },

  observationPhotosRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },

  observationPhoto: {
    width: 82,
    height: 82,
    borderRadius: 10,
    backgroundColor: "#E8EDDA",
  },

  notes: {
    color: "#6C7973",
    fontSize: 11,
    lineHeight: 17,
    fontStyle: "italic",
  },

  emptyHistory: {
    padding: 25,
    alignItems: "center",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#E2EDE0",
    borderRadius: 15,
  },

  emptyText: {
    color: "#6D7F75",
    fontSize: 12,
  },

  // ===================================================
  // NOT FOUND
  // ===================================================

  notFoundContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 30,
    backgroundColor: "#F7FBF4",
  },

  notFoundIcon: {
    fontSize: 50,
  },

  notFoundTitle: {
    marginTop: 15,
    color: "#234B3A",
    fontSize: 24,
    fontWeight: "600",
  },

  notFoundText: {
    marginTop: 8,
    color: "#6D7F75",
    fontSize: 12,
    textAlign: "center",
  },

});
