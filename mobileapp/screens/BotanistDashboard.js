import LanguageSelector from "../components/LanguageSelector";
import { useAppTranslation, t, translateLabel, translateUIMessage } from "../translations/i18n";
import React, {
  useState,
} from "react";

import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Image,
} from "react-native";

import { submissionStatus } from "../utils/botanistRecords";
import { useBotanistRecords } from "../utils/useBotanistRecords";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useBotanistNotifications } from "../utils/useBotanistNotifications";


export default function BotanistDashboardScreen({
  route,
  navigation,
  onLogout,
}) {
  useAppTranslation();

  const botanist =
    route.params?.botanist;
  const { unreadCount, error: notificationError } = useBotanistNotifications(botanist?.id);

  const { plants: myPlants, requests, loading, loaded, error, refresh } = useBotanistRecords(botanist?.id);
  const [tab, setTab] = useState("plants");
  const [filters, setFilters] = useState({ plants: "all", requests: "all" });
  const filter = filters[tab];
  const setFilter = (value) => setFilters((previous) => ({ ...previous, [tab]: value }));
  const pendingApproval = myPlants.filter((plant) => submissionStatus(plant.status) === "pending");
  const approvedPlants = myPlants.filter((plant) => submissionStatus(plant.status) === "approved");
  const displayedPlants = myPlants.filter((plant) => filter === "all" || submissionStatus(plant.status) === filter);
  const displayedRequests = requests.filter((request) => filter === "all" || submissionStatus(request.request_status) === filter);
  const data = tab === "plants" ? displayedPlants : displayedRequests;
  const date = (value) => value ? new Date(value).toLocaleDateString() : "";
  function statusBadge(status) {
    const kind = submissionStatus(status);
    return <View style={[styles.badge, kind === "approved" ? styles.approvedBadge : kind === "rejected" ? styles.rejectedBadge : styles.pendingBadge]}>
      <Text style={kind === "approved" ? styles.approvedText : kind === "rejected" ? styles.rejectedText : styles.pendingText}>{translateLabel(status)}</Text>
    </View>;
  }

  // =====================================================
  // LOGOUT
  // =====================================================

  function handleLogout() {

    if (onLogout) {
      onLogout();
      return;
    }

    navigation.goBack();
  }


  // =====================================================
  // PLANT PRESS
  // =====================================================

  function handlePlantPress(plant) {
    navigation.navigate("BotanistPlantDetail", {
      plantId: plant.id,
      botanist,
      plant,
    });
  }


  // =====================================================
  // ADD PLANT
  // =====================================================

  function handleAddPlant() {

    navigation.navigate(
      "AddPlant",
      {
        botanist,
      }
    );
  }


  // =====================================================
  // QR CODE MANAGEMENT
  // =====================================================

  function handleQRCodeManagement() {

    navigation.navigate(
      "PlantQRCode",
      {
        botanist,
      }
    );
  }

  // function handleFieldCollection() {
  //   navigation.navigate("FieldCollection");
  // }

  // function handlePersistentKnowledge() {
  //   navigation.navigate("PersistentKnowledge");
  // }


  // =====================================================
  // RENDER PLANT
  // =====================================================

  function renderRecord({ item }) {
    const isPlant = tab === "plants";
    const title = isPlant ? item.scientificName : item.scientific_name;
    const status = isPlant ? item.status : item.request_status;
    const meta = isPlant
      ? [["speciesScientificName", item.speciesDetails?.scientificName], ["health", item.healthStatus], ["growth", item.growthStage]]
      : [["commonName", item.common_name], ["genus", item.genus_name], ["family", item.family_name]];
    return <TouchableOpacity testID={`${isPlant ? "plant-record" : "species-request"}-${isPlant ? item.id : item.request_id}`} style={styles.plantCard} activeOpacity={0.8} accessibilityRole="button"
      accessibilityLabel={title} onPress={() => isPlant ? handlePlantPress(item) : navigation.navigate("BotanistSpeciesRequestDetail", { requestId: String(item.request_id), botanist })}>
      <View style={styles.recordBody}>
        {item.thumbnail ? <Image source={item.thumbnail} style={styles.thumbnail} accessibilityLabel={t("submissions.photo")} />
          : <View style={styles.thumbnailPlaceholder}><Ionicons name={isPlant ? "leaf-outline" : "flask-outline"} size={26} color="#468585" /></View>}
        <View style={styles.plantInfo}>
          <Text style={styles.recordType}>{t(isPlant ? "submissions.plantId" : "submissions.requestId")} {isPlant ? item.id : item.request_id}</Text>
          <Text style={styles.scientificName}>{title || t("submissions.notRecorded")}</Text>
          {meta.filter(([, value]) => value).map(([key, value]) => <Text key={key} style={styles.commonName}>{t(`submissions.${key}`)}: {["health", "growth"].includes(key) ? translateLabel(value) : value}</Text>)}
          {!!(isPlant ? item.registeredAt : item.submitted_at) && <Text style={styles.plantId}>{t("submissions.submitted")}: {date(isPlant ? item.registeredAt : item.submitted_at)}</Text>}
        </View>
        <Ionicons name="chevron-forward" size={21} color="#468585" />
      </View>
      <View style={styles.cardFooter}>{statusBadge(status)}
        {!!(isPlant && item.observationStatus) && <Text style={styles.plantId}>{t("botanistRecords.observationStatus")}{translateLabel(item.observationStatus)}</Text>}
      </View>
    </TouchableOpacity>;
  }

  // =====================================================
  // EMPTY LIST
  // =====================================================

  function renderEmpty() {
    if (loading && !loaded) return <View style={styles.emptyContainer}><Text style={styles.commonName}>{t("botanistRecords.loading")}</Text></View>;
    if (error) return <View style={styles.emptyContainer}>
      <Text style={styles.commonName} accessibilityRole="alert">{error.split("\n").map(translateUIMessage).join("\n")}</Text>
      <TouchableOpacity style={styles.emptyButton} onPress={refresh}><Text style={styles.emptyButtonText}>{t("common.tryAgain")}</Text></TouchableOpacity>
    </View>;

    return (
      <View
        style={
          styles.emptyContainer
        }
      >

        <Text
          style={
            styles.emptyIcon
          }
        >
          🌿
        </Text>


        <Text
          style={
            styles.emptyTitle
          }
        >{t(tab === "plants" ? "submissions.noPlants" : "submissions.noRequests")}</Text>


        <Text
          style={
            styles.emptyText
          }
        >{t("submissions.emptyHint")}</Text>


        <TouchableOpacity
          style={
            styles.emptyButton
          }
          onPress={
            handleAddPlant
          }
        >

          <Text
            style={
              styles.emptyButtonText
            }
          >{t("botanistDashboard.addPlantRecord")}</Text>

        </TouchableOpacity>

      </View>
    );
  }


  // =====================================================
  // UI
  // =====================================================

  return (
    <View
      style={styles.container}
    >

      <FlatList
        data={data}
        refreshing={loading}
        onRefresh={refresh}
        ListHeaderComponent={<>
      {/* HEADER */}

      <View
        style={styles.header}
      >

        <View
          style={styles.headerInfo}
        >

          <Text
            style={styles.greeting}
          >{t("botanistDashboard.hello")}{" "}
            {botanist?.name ||
              t("botanistDashboard.botanist")} 👋
          </Text>


          <Text
            style={styles.subtitle}
          >{t("botanistDashboard.manageYourPlantRecords")}</Text>

        </View>


        <View style={styles.headerControls}>
        <LanguageSelector />
        <View style={styles.headerActions}>
        <TouchableOpacity
          style={styles.notificationButton}
          onPress={() => navigation.navigate("BotanistNotifications")}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={notificationError ? t("botanistDashboard.notificationsUpdatesCouldNotRefresh") : t("botanistDashboard.notificationsUnread", { unreadCount: unreadCount })}
        >
          <Ionicons name="notifications-outline" size={21} color="#468585" />
          {unreadCount > 0 && <View style={styles.notificationBadge}>
            <Text style={styles.notificationBadgeText}>{unreadCount > 99 ? "99+" : unreadCount}</Text>
          </View>}
        </TouchableOpacity>
        <TouchableOpacity
          style={
            styles.logoutButton
          }
          activeOpacity={0.8}
          onPress={
            handleLogout
          }
        >

          <Text
            style={
              styles.logoutText
            }
          >{t("botanistDashboard.logout")}</Text>

        </TouchableOpacity>
        </View>
        </View>

      </View>


      {/* STATISTICS */}

      <View
        style={styles.statsRow}
      >

        {/* MY PLANTS */}

        <TouchableOpacity
          onPress={() => { setTab("plants"); setFilters((previous) => ({ ...previous, plants: "all" })); void refresh(); }}
          style={styles.statCard}
        >

          <Text
            style={styles.statIcon}
          >
            🌿
          </Text>


          <Text
            style={styles.statNumber}
          >
            {myPlants.length}
          </Text>


          <Text
            style={styles.statLabel}
          >{t("botanistDashboard.myPlants")}</Text>

        </TouchableOpacity>


        {/* PENDING */}

        <TouchableOpacity
          onPress={() => { setFilter("pending"); void refresh(); }}
          style={styles.statCard}
        >

          <Text
            style={styles.statIcon}
          >
            ⏳
          </Text>


          <Text
            style={styles.statNumber}
          >
            {pendingApproval.length}
          </Text>


          <Text
            style={styles.statLabel}
          >{t("botanistDashboard.pendingApproval")}</Text>

        </TouchableOpacity>


        {/* APPROVED */}

        <TouchableOpacity
          onPress={() => { setFilter("approved"); void refresh(); }}
          style={styles.statCard}
        >

          <Text
            style={styles.statIcon}
          >
            ✓
          </Text>


          <Text
            style={styles.statNumber}
          >
            {approvedPlants.length}
          </Text>


          <Text
            style={styles.statLabel}
          >{t("botanistDashboard.approved")}</Text>

        </TouchableOpacity>

      </View>


      {/* QR MANAGEMENT */}

      <TouchableOpacity
        style={
          styles.qrManagementButton
        }
        activeOpacity={0.8}
        onPress={
          handleQRCodeManagement
        }
      >

        <View
          style={
            styles.qrManagementIcon
          }
        >

          <Text
            style={
              styles.qrManagementIconText
            }
          >
            ▦
          </Text>

        </View>


        <View
          style={
            styles.qrManagementInfo
          }
        >

          <Text
            style={
              styles.qrManagementTitle
            }
          >{t("botanistDashboard.qrCodeManagement")}</Text>


          <Text
            style={
              styles.qrManagementSubtitle
            }
          >{t("botanistDashboard.generateAndManageQrCodes")}</Text>

        </View>


        <Text
          style={styles.arrow}
        >
          ›
        </Text>

      </TouchableOpacity>


      {/* ADD PLANT */}

      <TouchableOpacity
        style={styles.addButton}
        activeOpacity={0.8}
        onPress={
          handleAddPlant
        }
      >

        <Text
          style={
            styles.addButtonText
          }
        >{t("botanistDashboard.addNewPlantRecord")}</Text>

      </TouchableOpacity>

      {/*
      <TouchableOpacity
        style={styles.addButton}
        activeOpacity={0.8}
        onPress={handleFieldCollection}
      >
        <Text style={styles.addButtonText}>Open Field Collection</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.addButton}
        activeOpacity={0.8}
        onPress={handlePersistentKnowledge}
      >
        <Text style={styles.addButtonText}>Plant Knowledge &amp; Map</Text>
      </TouchableOpacity>
      */}


      <Text style={styles.sectionTitle}>{t("submissions.title")}</Text>
      <View style={styles.tabs} accessibilityRole="tablist">
        {["plants", "requests"].map((value) => <TouchableOpacity key={value} testID={`submissions-tab-${value}`} accessibilityRole="tab"
          accessibilityState={{ selected: tab === value }} onPress={() => setTab(value)} style={[styles.tab, tab === value && styles.activeTab]}>
          <Ionicons name={value === "plants" ? "leaf-outline" : "flask-outline"} size={18} color={tab === value ? "#FFFFFF" : "#468585"} />
          <Text style={[styles.tabLabel, tab === value && styles.activeTabLabel]}>{t(value === "plants" ? "botanistDashboard.myPlantRecords" : "botanistRecords.speciesRequests")}</Text>
          <Text style={[styles.tabCount, tab === value && styles.activeTabLabel]}>{value === "plants" ? myPlants.length : requests.length}</Text>
        </TouchableOpacity>)}
      </View>
      <View style={styles.filters}>
        {["all", "pending", "approved", "rejected"].map((value) => <TouchableOpacity key={value} accessibilityRole="button"
          accessibilityState={{ selected: filter === value }} onPress={() => setFilter(value)} style={[styles.filterChip, filter === value && styles.selectedFilter]}>
          <Text style={[styles.filterLabel, filter === value && styles.selectedFilterLabel]}>{t(`submissions.${value}`)}</Text>
        </TouchableOpacity>)}
      </View>
{!!error && <Text style={styles.errorText} accessibilityRole="alert">{error.split("\n").map(translateUIMessage).join("\n")}</Text>}</>}
        keyExtractor={(item) => `${tab}:${tab === "plants" ? item.id : item.request_id}`}
        renderItem={renderRecord}
        ListEmptyComponent={renderEmpty}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={data.length === 0 ? styles.emptyList : styles.list}
      />

    </View>
  );
}


// =====================================================
// STYLES
// =====================================================

const styles =
  StyleSheet.create({

    tabs: { flexDirection: "row", backgroundColor: "#E7F2E2", borderRadius: 14, padding: 4, gap: 4, marginBottom: 12 },
    tab: { flex: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 12, borderRadius: 11, minHeight: 48 },
    activeTab: { backgroundColor: "#468585" },
    tabLabel: { color: "#376A57", fontWeight: "700", fontSize: 12, flexShrink: 1 },
    activeTabLabel: { color: "#FFFFFF" },
    tabCount: { color: "#468585", fontSize: 11, fontWeight: "700" },
    filters: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 14 },
    filterChip: { borderRadius: 20, paddingHorizontal: 13, paddingVertical: 10, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DCE8D6", minHeight: 40 },
    selectedFilter: { backgroundColor: "#E1F0EA", borderColor: "#468585" },
    filterLabel: { color: "#718078", fontSize: 12 }, selectedFilterLabel: { color: "#234B3A", fontWeight: "700" },
    recordBody: { flexDirection: "row", alignItems: "center", gap: 12 },
    recordType: { color: "#468585", fontSize: 11, fontWeight: "700", marginBottom: 5 },
    thumbnail: { width: 58, height: 68, borderRadius: 12 },
    thumbnailPlaceholder: { width: 58, height: 68, borderRadius: 12, backgroundColor: "#EDF5E9", alignItems: "center", justifyContent: "center" },
    cardFooter: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#EFF3ED" },
    errorText: { color: "#A34436", backgroundColor: "#FFF2EB", padding: 12, borderRadius: 10, marginBottom: 10, lineHeight: 20 },
    container: {
      flex: 1,
      backgroundColor: "#F7FBF4",
      paddingHorizontal: 20,
      paddingTop: 50,
    },


    // -------------------------------------------------
    // HEADER
    // -------------------------------------------------

    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 20,
    },


    headerInfo: {
      flex: 1,
      paddingRight: 10,
    },

    headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
    headerControls: { alignItems: "flex-end", gap: 6, flexShrink: 0 },
    notificationButton: { width: 44, height: 44, borderRadius: 12, backgroundColor: "#E7F2E2", alignItems: "center", justifyContent: "center" },
    notificationBadge: { position: "absolute", top: -4, right: -4, minWidth: 19, height: 19, paddingHorizontal: 4, borderRadius: 10, backgroundColor: "#B84F43", borderWidth: 2, borderColor: "#F7FBF4", alignItems: "center", justifyContent: "center" },
    notificationBadgeText: { color: "#FFFFFF", fontSize: 9, fontWeight: "700" },


    greeting: {
      fontSize: 24,
      fontWeight: "700",
      color: "#234B3A",
    },


    subtitle: {
      marginTop: 4,
      fontSize: 14,
      color: "#6D7F75",
    },


    logoutButton: {
      minHeight: 44,
      justifyContent: "center",
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: 10,
      backgroundColor: "#E7F2E2",
    },


    logoutText: {
      fontSize: 13,
      fontWeight: "600",
      color: "#468585",
    },


    // -------------------------------------------------
    // STATISTICS
    // -------------------------------------------------

    statsRow: {
      flexDirection: "row",
      gap: 10,
      marginBottom: 18,
    },


    statCard: {
      flex: 1,
      minHeight: 105,
      backgroundColor: "#FFFFFF",
      borderRadius: 16,
      padding: 12,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: "#E2EDE0",
    },


    statIcon: {
      fontSize: 22,
      marginBottom: 4,
    },


    statNumber: {
      fontSize: 22,
      fontWeight: "700",
      color: "#468585",
    },


    statLabel: {
      marginTop: 3,
      textAlign: "center",
      fontSize: 11,
      color: "#6D7F75",
    },


    // -------------------------------------------------
    // QR MANAGEMENT
    // -------------------------------------------------

    qrManagementButton: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: "#E9F7E4",
      borderRadius: 16,
      padding: 15,
      marginBottom: 12,
    },


    qrManagementIcon: {
      width: 46,
      height: 46,
      borderRadius: 12,
      backgroundColor: "#9CDBA6",
      alignItems: "center",
      justifyContent: "center",
    },


    qrManagementIconText: {
      fontSize: 26,
      color: "#234B3A",
      fontWeight: "700",
    },


    qrManagementInfo: {
      flex: 1,
      marginLeft: 12,
    },


    qrManagementTitle: {
      fontSize: 15,
      fontWeight: "700",
      color: "#234B3A",
    },


    qrManagementSubtitle: {
      marginTop: 3,
      fontSize: 12,
      color: "#6D7F75",
    },


    arrow: {
      fontSize: 28,
      color: "#468585",
      marginLeft: 8,
    },


    // -------------------------------------------------
    // ADD BUTTON
    // -------------------------------------------------

    addButton: {
      backgroundColor: "#468585",
      borderRadius: 14,
      paddingVertical: 15,
      alignItems: "center",
      marginBottom: 20,
    },


    addButtonText: {
      color: "#FFFFFF",
      fontSize: 15,
      fontWeight: "700",
    },


    // -------------------------------------------------
    // SECTION
    // -------------------------------------------------

    sectionTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: "#234B3A",
      marginBottom: 10,
    },


    list: {
      paddingBottom: 30,
    },


    // -------------------------------------------------
    // PLANT CARD
    // -------------------------------------------------

    plantCard: {
      shadowColor: "#234B3A", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
      backgroundColor: "#FFFFFF",
      borderRadius: 16,
      padding: 15,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: "#E2EDE0",
    },


    plantInfo: {
      flex: 1,
      paddingRight: 10,
    },


    scientificName: {
      fontSize: 15,
      fontWeight: "700",
      fontStyle: "italic",
      color: "#234B3A",
    },


    commonName: {
      marginTop: 3,
      fontSize: 13,
      color: "#6D7F75",
    },


    plantId: {
      marginTop: 7,
      fontSize: 11,
      color: "#8A9991",
    },


    qrText: {
      marginTop: 3,
      fontSize: 11,
      color: "#8A9991",
    },


    badges: {
      alignItems: "flex-end",
      gap: 5,
    },


    badge: {
      paddingVertical: 5,
      paddingHorizontal: 9,
      borderRadius: 8,
    },


    pendingBadge: {
      backgroundColor: "#FFF1D6",
    },


    pendingText: {
      fontSize: 10,
      fontWeight: "700",
      color: "#B97900",
    },


    approvedBadge: {
      backgroundColor: "#E1F4E3",
    },


    approvedText: {
      fontSize: 10,
      fontWeight: "700",
      color: "#398344",
    },


    rejectedBadge: {
      backgroundColor: "#FCE2E2",
    },


    rejectedText: {
      fontSize: 10,
      fontWeight: "700",
      color: "#B84444",
    },


    qrBadge: {
      backgroundColor: "#E2F1F0",
    },


    qrStatusText: {
      fontSize: 10,
      fontWeight: "700",
      color: "#468585",
    },


    // -------------------------------------------------
    // EMPTY
    // -------------------------------------------------

    emptyList: {
      flexGrow: 1,
    },


    emptyContainer: {
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 25,
      paddingVertical: 50,
    },


    emptyIcon: {
      fontSize: 45,
      marginBottom: 12,
    },


    emptyTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: "#234B3A",
    },


    emptyText: {
      marginTop: 8,
      textAlign: "center",
      lineHeight: 20,
      fontSize: 13,
      color: "#718078",
    },


    emptyButton: {
      marginTop: 18,
      backgroundColor: "#468585",
      paddingVertical: 12,
      paddingHorizontal: 18,
      borderRadius: 12,
    },


    emptyButtonText: {
      color: "#FFFFFF",
      fontSize: 13,
      fontWeight: "700",
    },

  });
